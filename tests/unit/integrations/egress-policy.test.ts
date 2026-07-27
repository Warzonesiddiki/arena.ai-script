import { EgressPolicy, EgressPolicyError, type ConnectorInput } from '../../../src/integrations/egress-policy';
import * as fs from 'node:fs';
import * as path from 'node:path';

function connector(overrides: Partial<ConnectorInput> = {}): ConnectorInput {
  return {
    id: 'github',
    allowedHosts: ['api.github.com'],
    allowedMethods: ['GET', 'POST'],
    allowedPathPrefixes: ['/repos'],
    grantedScopes: ['repo:read'],
    maxBodyBytes: 1_024,
    followRedirects: false,
    approvedByHuman: true,
    ...overrides,
  };
}

describe('EgressPolicy', () => {
  it('performs no network I/O anywhere in the module', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../src/integrations/egress-policy.ts'), 'utf8');
    // Strip comments so the doc block explaining "there is no fetch here" is not
    // itself mistaken for a fetch call.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    for (const forbidden of [/\bfetch\s*\(/u, /\bXMLHttpRequest\b/u, /\bWebSocket\b/u, /\bsendBeacon\b/u, /\bimport\s*\(/u, /\bnavigator\b/u]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it('denies by default when no connector is registered', () => {
    const policy = new EgressPolicy();
    const verdict = policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/x/y', method: 'GET' });

    expect(verdict).toEqual(expect.objectContaining({ allowed: false, reason: 'no-connector' }));
    expect(verdict.requiredHostPermission).toBeNull();
  });

  it('allows a request that satisfies every rule, without authorising an action', () => {
    const policy = new EgressPolicy();
    policy.register(connector());

    const verdict = policy.evaluate({
      connectorId: 'github', url: 'https://api.github.com/repos/acme/app/pulls', method: 'GET', requiredScopes: ['repo:read'], bodyBytes: 0,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.requiredHostPermission).toBe('https://api.github.com/*');
    expect(verdict.detail).toContain('authorises nothing on its own');
  });

  it('requires explicit human approval to register, toggle, or remove a connector', () => {
    const policy = new EgressPolicy();

    expect(() => policy.register(connector({ approvedByHuman: false as never }))).toThrow(EgressPolicyError);
    policy.register(connector());
    expect(() => policy.setEnabled('github', false, false as never)).toThrow(EgressPolicyError);
    expect(() => policy.remove('github', false as never)).toThrow(EgressPolicyError);

    policy.setEnabled('github', false, true);
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/a/b', method: 'GET' }).reason).toBe('connector-disabled');
    expect(policy.remove('github', true)).toBe(true);
  });

  it('refuses insecure schemes, embedded credentials, and private networks', () => {
    const policy = new EgressPolicy();
    policy.register(connector());

    const cases: Array<[string, string]> = [
      ['http://api.github.com/repos/a/b', 'insecure-scheme'],
      ['https://user:pass@api.github.com/repos/a/b', 'credential-in-url'],
      ['https://evil.example.com/repos/a/b', 'host-not-allowlisted'],
    ];
    for (const [url, reason] of cases) {
      expect(policy.evaluate({ connectorId: 'github', url, method: 'GET' }).reason).toBe(reason);
    }

    // Private-network hosts are refused even if a connector somehow lists them.
    const loopback = new EgressPolicy();
    expect(() => loopback.register(connector({ id: 'local', allowedHosts: ['127.0.0.1'] }))).toThrow(EgressPolicyError);
    const internal = new EgressPolicy();
    internal.register(connector({ id: 'internal', allowedHosts: ['db.internal'] }));
    expect(internal.evaluate({ connectorId: 'internal', url: 'https://db.internal/repos/a', method: 'GET' }).reason).toBe('private-network');
  });

  it('enforces method, path prefix, and scope allow lists', () => {
    const policy = new EgressPolicy();
    policy.register(connector());

    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/a/b', method: 'DELETE' }).reason).toBe('method-not-allowed');
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/users/a', method: 'GET' }).reason).toBe('path-not-allowlisted');
    // A prefix must match on a path boundary, not as a bare string prefix.
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repositories/a', method: 'GET' }).reason).toBe('path-not-allowlisted');
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos', method: 'GET' }).allowed).toBe(true);
    expect(policy.evaluate({
      connectorId: 'github', url: 'https://api.github.com/repos/a/b', method: 'POST', requiredScopes: ['repo:write'],
    }).reason).toBe('scope-not-granted');
  });

  it('bounds request bodies and blocks redirects unless explicitly permitted', () => {
    const policy = new EgressPolicy();
    policy.register(connector());

    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/a', method: 'POST', bodyBytes: 2_048 }).reason).toBe('body-too-large');
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/a', method: 'POST', bodyBytes: -1 }).reason).toBe('body-too-large');
    expect(policy.evaluate({ connectorId: 'github', url: 'https://api.github.com/repos/a', method: 'GET', followRedirect: true }).reason).toBe('redirect-not-allowed');

    const permissive = new EgressPolicy();
    permissive.register(connector({ id: 'redirects', followRedirects: true }));
    expect(permissive.evaluate({ connectorId: 'redirects', url: 'https://api.github.com/repos/a', method: 'GET', followRedirect: true }).allowed).toBe(true);
  });

  it('rejects malformed URLs and wildcard hosts at registration time', () => {
    const policy = new EgressPolicy();
    policy.register(connector());

    expect(policy.evaluate({ connectorId: 'github', url: 'not-a-url', method: 'GET' }).reason).toBe('malformed-url');
    expect(policy.evaluate({ connectorId: 'github', url: '', method: 'GET' }).reason).toBe('malformed-url');
    expect(policy.evaluate({ connectorId: 'github', url: `https://api.github.com/repos/${'a'.repeat(2_100)}`, method: 'GET' }).reason).toBe('malformed-url');

    // A wildcard host is exactly how an egress allow list leaks.
    expect(() => new EgressPolicy().register(connector({ id: 'wild', allowedHosts: ['*.github.com'] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'sch', allowedHosts: ['https://api.github.com'] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'trav', allowedPathPrefixes: ['/repos/../admin'] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'rel', allowedPathPrefixes: ['repos'] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'meth', allowedMethods: ['TRACE' as never] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'empty', allowedHosts: [] }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: 'body', maxBodyBytes: -1 }))).toThrow(EgressPolicyError);
    expect(() => new EgressPolicy().register(connector({ id: '../bad' }))).toThrow(EgressPolicyError);
  });

  it('rejects duplicate connectors and bounds the registry', () => {
    const policy = new EgressPolicy();
    policy.register(connector());
    expect(() => policy.register(connector())).toThrow(EgressPolicyError);

    const bounded = new EgressPolicy();
    for (let index = 0; index < 20; index += 1) bounded.register(connector({ id: `c-${index}` }));
    expect(() => bounded.register(connector({ id: 'overflow' }))).toThrow(EgressPolicyError);
    expect(bounded.list()).toHaveLength(20);
  });

  it('reports the host permissions a manifest would need for enabled connectors', () => {
    const policy = new EgressPolicy();
    policy.register(connector());
    policy.register(connector({ id: 'linear', allowedHosts: ['api.linear.app'] }));
    policy.register(connector({ id: 'off', allowedHosts: ['api.notion.com'], enabled: false }));

    expect(policy.requiredHostPermissions()).toEqual(['https://api.github.com/*', 'https://api.linear.app/*']);
  });

  it('has not silently granted any of these hosts in the shipped manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../extension/public/manifest.json'), 'utf8'));
    // Phase 7 integrations remain unshipped: only Arena hosts are granted.
    expect(manifest.host_permissions).toEqual(['https://arena.ai/*', 'https://*.arena.ai/*']);
    expect(manifest.permissions).not.toContain('downloads');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.permissions).not.toContain('cookies');
  });
});

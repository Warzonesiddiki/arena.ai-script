/**
 * Phase 7 prerequisite — deny-by-default egress policy.
 *
 * Phase 7 (GitHub, Linear/Notion, VS Code, Slack/Discord, file system) cannot
 * begin without a network threat model. This module is that threat model
 * expressed as executable, testable policy.
 *
 * **It performs no network I/O.** There is no `fetch`, no `XMLHttpRequest`, and
 * no socket anywhere in this file. It only *evaluates whether a request would be
 * permitted*, so the rules can be written and adversarially tested before any
 * host permission is ever requested. A permitted verdict is a precondition for
 * an integration, never an action.
 */

const MAX_CONNECTORS = 20;
const MAX_URL_CHARS = 2_048;
const MAX_SCOPE_CHARS = 64;

export type EgressMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type EgressDenyReason =
  | 'no-connector'
  | 'connector-disabled'
  | 'connector-not-approved'
  | 'insecure-scheme'
  | 'host-not-allowlisted'
  | 'method-not-allowed'
  | 'path-not-allowlisted'
  | 'scope-not-granted'
  | 'credential-in-url'
  | 'private-network'
  | 'redirect-not-allowed'
  | 'body-too-large'
  | 'malformed-url';

export interface ConnectorDefinition {
  id: string;
  /** Exact hosts only. Wildcards are rejected: a wildcard is how egress rules leak. */
  allowedHosts: readonly string[];
  allowedMethods: readonly EgressMethod[];
  /** Path prefixes, each beginning with `/`. */
  allowedPathPrefixes: readonly string[];
  grantedScopes: readonly string[];
  maxBodyBytes: number;
  followRedirects: boolean;
  approvedByHuman: true;
  enabled: boolean;
}

export interface ConnectorInput extends Omit<ConnectorDefinition, 'enabled'> {
  enabled?: boolean;
}

export interface EgressRequest {
  connectorId: string;
  url: string;
  method: EgressMethod;
  requiredScopes?: readonly string[];
  bodyBytes?: number;
  followRedirect?: boolean;
}

export interface EgressVerdict {
  allowed: boolean;
  connectorId: string;
  reason: EgressDenyReason | 'allowed';
  detail: string;
  /** Host permission an integration would need. Requesting it stays a separate, reviewed step. */
  requiredHostPermission: string | null;
}

export class EgressPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EgressPolicyError';
  }
}

/** Hosts that must never be reachable, even if a connector names them. */
const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  'localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal', '169.254.169.254',
]);

const PRIVATE_IPV4 = /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/u;

export class EgressPolicy {
  private readonly connectors = new Map<string, ConnectorDefinition>();

  /** Registers a connector. Requires explicit human approval. */
  public register(input: ConnectorInput): ConnectorDefinition {
    if (input.approvedByHuman !== true) throw new EgressPolicyError('Registering an egress connector requires explicit human approval.');
    if (this.connectors.size >= MAX_CONNECTORS) throw new EgressPolicyError(`At most ${MAX_CONNECTORS} connectors are supported.`);
    const connector = sanitizeConnector(input);
    if (this.connectors.has(connector.id)) throw new EgressPolicyError(`Connector "${connector.id}" already exists.`);
    this.connectors.set(connector.id, connector);
    return cloneConnector(connector);
  }

  public setEnabled(connectorId: string, enabled: boolean, approvedByHuman: true): ConnectorDefinition {
    if (approvedByHuman !== true) throw new EgressPolicyError('Changing connector state requires explicit human approval.');
    const connector = this.connectors.get(validateIdentifier(connectorId, 'connectorId'));
    if (!connector) throw new EgressPolicyError(`Unknown connector "${connectorId}".`);
    const updated = { ...connector, enabled };
    this.connectors.set(connectorId, updated);
    return cloneConnector(updated);
  }

  public remove(connectorId: string, approvedByHuman: true): boolean {
    if (approvedByHuman !== true) throw new EgressPolicyError('Removing a connector requires explicit human approval.');
    return this.connectors.delete(validateIdentifier(connectorId, 'connectorId'));
  }

  public list(): readonly ConnectorDefinition[] {
    return [...this.connectors.values()].map(cloneConnector).sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * Evaluates a hypothetical request. Deny-by-default: anything not explicitly
   * permitted is refused, and the first failing check wins.
   */
  public evaluate(request: EgressRequest): EgressVerdict {
    const connectorId = typeof request.connectorId === 'string' ? request.connectorId : '';
    const deny = (reason: EgressDenyReason, detail: string): EgressVerdict => ({ allowed: false, connectorId, reason, detail, requiredHostPermission: null });

    const connector = this.connectors.get(connectorId);
    if (!connector) return deny('no-connector', `No connector "${connectorId}" is registered. Egress is denied by default.`);
    if (connector.approvedByHuman !== true) return deny('connector-not-approved', `Connector "${connectorId}" is not human-approved.`);
    if (!connector.enabled) return deny('connector-disabled', `Connector "${connectorId}" is disabled.`);

    if (typeof request.url !== 'string' || request.url.length === 0 || request.url.length > MAX_URL_CHARS) {
      return deny('malformed-url', 'Request URL is missing or exceeds the length bound.');
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return deny('malformed-url', 'Request URL could not be parsed.');
    }

    if (url.protocol !== 'https:') return deny('insecure-scheme', `Only https is permitted; received "${url.protocol}".`);
    if (url.username !== '' || url.password !== '') return deny('credential-in-url', 'Credentials must never be embedded in a URL.');

    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || PRIVATE_IPV4.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
      return deny('private-network', `Host "${host}" targets a private or link-local network.`);
    }
    if (!connector.allowedHosts.includes(host)) {
      return deny('host-not-allowlisted', `Host "${host}" is not in the connector allow list.`);
    }
    if (!connector.allowedMethods.includes(request.method)) {
      return deny('method-not-allowed', `Method "${String(request.method)}" is not permitted for this connector.`);
    }
    if (!connector.allowedPathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) {
      return deny('path-not-allowlisted', `Path "${url.pathname}" is not in the connector allow list.`);
    }

    const requiredScopes = request.requiredScopes ?? [];
    const missingScope = requiredScopes.find((scope) => !connector.grantedScopes.includes(scope));
    if (missingScope !== undefined) return deny('scope-not-granted', `Scope "${missingScope}" has not been granted to this connector.`);

    const bodyBytes = request.bodyBytes ?? 0;
    if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 0) return deny('body-too-large', 'bodyBytes must be a non-negative safe integer.');
    if (bodyBytes > connector.maxBodyBytes) {
      return deny('body-too-large', `Body of ${bodyBytes} bytes exceeds the connector limit of ${connector.maxBodyBytes}.`);
    }
    if (request.followRedirect === true && !connector.followRedirects) {
      return deny('redirect-not-allowed', 'This connector does not permit redirect following; a redirect can move egress off the allow list.');
    }

    return {
      allowed: true,
      connectorId,
      reason: 'allowed',
      detail: `Request satisfies connector "${connectorId}" policy. A permitted verdict authorises nothing on its own.`,
      requiredHostPermission: `https://${host}/*`,
    };
  }

  /** Host permissions a manifest would need for the registered connectors. */
  public requiredHostPermissions(): readonly string[] {
    const hosts = new Set<string>();
    for (const connector of this.connectors.values()) {
      if (!connector.enabled) continue;
      for (const host of connector.allowedHosts) hosts.add(`https://${host}/*`);
    }
    return [...hosts].sort();
  }
}

function sanitizeConnector(input: ConnectorInput): ConnectorDefinition {
  validateIdentifier(input.id, 'connectorId');
  if (!Array.isArray(input.allowedHosts) || input.allowedHosts.length === 0) throw new EgressPolicyError('A connector requires at least one allowed host.');
  const allowedHosts = input.allowedHosts.map((host) => {
    if (typeof host !== 'string' || host.trim() === '') throw new EgressPolicyError('Allowed host must be a non-empty string.');
    const normalized = host.trim().toLowerCase();
    if (normalized.includes('*')) throw new EgressPolicyError(`Wildcard host "${host}" is not permitted; list exact hosts.`);
    if (normalized.includes('/') || normalized.includes(':')) throw new EgressPolicyError(`Host "${host}" must not include a scheme, port, or path.`);
    if (BLOCKED_HOSTS.has(normalized) || PRIVATE_IPV4.test(normalized)) throw new EgressPolicyError(`Host "${host}" targets a private network.`);
    return normalized;
  });

  if (!Array.isArray(input.allowedMethods) || input.allowedMethods.length === 0) throw new EgressPolicyError('A connector requires at least one allowed method.');
  const allowedMethods = input.allowedMethods.map((method) => {
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw new EgressPolicyError(`Method "${String(method)}" is not supported.`);
    return method;
  });

  if (!Array.isArray(input.allowedPathPrefixes) || input.allowedPathPrefixes.length === 0) throw new EgressPolicyError('A connector requires at least one allowed path prefix.');
  const allowedPathPrefixes = input.allowedPathPrefixes.map((prefix) => {
    if (typeof prefix !== 'string' || !prefix.startsWith('/')) throw new EgressPolicyError(`Path prefix "${String(prefix)}" must start with "/".`);
    if (prefix.includes('..')) throw new EgressPolicyError(`Path prefix "${prefix}" must not contain traversal segments.`);
    return prefix;
  });

  const grantedScopes = (input.grantedScopes ?? []).map((scope) => {
    if (typeof scope !== 'string' || scope.trim() === '' || scope.length > MAX_SCOPE_CHARS) throw new EgressPolicyError('Scope is invalid.');
    return scope.trim();
  });

  if (!Number.isSafeInteger(input.maxBodyBytes) || input.maxBodyBytes < 0) throw new EgressPolicyError('maxBodyBytes must be a non-negative safe integer.');

  return {
    id: input.id,
    allowedHosts,
    allowedMethods,
    allowedPathPrefixes,
    grantedScopes,
    maxBodyBytes: input.maxBodyBytes,
    followRedirects: input.followRedirects === true,
    approvedByHuman: true,
    enabled: input.enabled ?? true,
  };
}

function cloneConnector(connector: ConnectorDefinition): ConnectorDefinition {
  return {
    ...connector,
    allowedHosts: [...connector.allowedHosts],
    allowedMethods: [...connector.allowedMethods],
    allowedPathPrefixes: [...connector.allowedPathPrefixes],
    grantedScopes: [...connector.grantedScopes],
  };
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new EgressPolicyError(`${name} is invalid.`);
  return value;
}

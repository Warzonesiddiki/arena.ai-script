import { IDBFactory } from 'fake-indexeddb';
import { GovernedOrchestration } from '../../../src/background/governed-orchestration';
import { OrchestrationService } from '../../../src/background/orchestration-service';
import { BackgroundAgentStateStore } from '../../../src/background/background-agent-state';
import { AuditLog } from '../../../src/audit/audit-log';
import { RiskPolicyEngine, defaultRules } from '../../../src/safety/risk-policy-engine';
import { StorageLayer, type ChromeStorageArea } from '../../../src/storage/storage-layer';

class MemoryChromeStorage implements ChromeStorageArea {
  public readonly values = new Map<string, unknown>();
  public async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const requested = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys ? Object.keys(keys) : [...this.values.keys()];
    return Object.fromEntries(requested.flatMap((key) => this.values.has(key) ? [[key, this.values.get(key)]] : []));
  }
  public async set(items: Record<string, unknown>): Promise<void> { for (const [key, value] of Object.entries(items)) this.values.set(key, value); }
  public async remove(keys: string | string[]): Promise<void> { for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key); }
}

function storage(name = `gov-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({
    chromeStorage: new MemoryChromeStorage(),
    indexedDbFactory: new IDBFactory(),
    databaseName: name,
    now: () => 1_000,
    estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
  });
}

function build(overrides: { policy?: RiskPolicyEngine } = {}) {
  let clock = 1_000;
  const audit = new AuditLog({ storage: storage(), now: () => (clock += 10) });
  const stateStore = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
  const orchestration = new OrchestrationService({ planIdFactory: () => 'plan-1' });
  const governed = new GovernedOrchestration({ orchestration, audit, stateStore, ...overrides });
  return { governed, audit, stateStore, orchestration };
}

describe('GovernedOrchestration', () => {
  it('creates a plan, audits it, and persists durable control state', async () => {
    const { governed, audit, stateStore } = build();

    const result = await governed.create('Ship governed orchestration');

    expect(result.ok).toBe(true);
    expect(result.orchestration?.planId).toBe('plan-1');

    const entries = await audit.query({ category: 'lifecycle' });
    expect(entries[0]).toEqual(expect.objectContaining({ action: 'orchestration plan created', outcome: 'recorded', subjectId: 'plan-1' }));
    await expect(stateStore.restore()).resolves.toEqual(expect.objectContaining({ planId: 'plan-1' }));
  });

  it('audits a granted approval', async () => {
    const { governed, audit } = build();
    await governed.create('Ship it');

    const result = await governed.approve('planner-1');

    expect(result.ok).toBe(true);
    const approvals = await audit.query({ category: 'approval' });
    expect(approvals[0]).toEqual(expect.objectContaining({ action: 'task approved', outcome: 'granted', subjectId: 'planner-1', actor: 'human' }));
    await expect(audit.verify()).resolves.toEqual(expect.objectContaining({ valid: true }));
  });

  it('audits a refusal without mutating orchestration state', async () => {
    const { governed, audit, orchestration } = build();
    await governed.create('Ship it');

    // Coder cannot be approved before Planner.
    const result = await governed.approve('coder-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('planner-1');
    // The refused task is still awaiting approval.
    expect(orchestration.snapshot(false).cards.find((card) => card.id === 'coder-1')?.approvalRequired).toBe(true);
    const denials = await audit.query({ category: 'denial' });
    expect(denials[0]).toEqual(expect.objectContaining({ outcome: 'refused', subjectId: 'coder-1' }));
  });

  it('lets the policy engine refuse an approval and records why', async () => {
    const denyAll = new RiskPolicyEngine([{
      id: 'freeze-approvals',
      description: 'Temporarily deny every plan approval',
      order: 1,
      matches: (action) => action.kind === 'plan-approval',
      verdict: 'deny',
      riskLevel: 'critical',
      rationale: 'Approvals are frozen.',
    }]);
    const { governed, audit, orchestration } = build({ policy: denyAll });
    await governed.create('Ship it');

    const result = await governed.approve('planner-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Policy denies');
    expect(orchestration.snapshot(false).cards[0]?.approvalRequired).toBe(true);
    const policyEntries = await audit.query({ category: 'policy' });
    expect(policyEntries[0]).toEqual(expect.objectContaining({ action: 'approval refused by policy', outcome: 'refused' }));
    expect(policyEntries[0]?.detail.rule).toBe('freeze-approvals');
  });

  it('permits approval under the default constitutional rules', async () => {
    const { governed } = build({ policy: new RiskPolicyEngine(defaultRules()) });
    await governed.create('Ship it');
    await expect(governed.approve('planner-1')).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it('refuses an unknown task without touching the plan', async () => {
    const { governed, audit } = build();
    await governed.create('Ship it');

    const result = await governed.approve('critic-9');

    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('Unknown task') }));
    const denials = await audit.query({ category: 'denial' });
    expect(denials[0]?.detail.reason).toBe('unknown-task');
  });

  it('reports a create failure rather than throwing', async () => {
    const { governed, audit } = build();

    const result = await governed.create('   ');

    expect(result.ok).toBe(false);
    const denials = await audit.query({ category: 'denial' });
    expect(denials[0]?.action).toContain('creation failed');
  });

  it('survives a persistence failure without failing the request', async () => {
    const failing = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
    jest.spyOn(failing, 'saveSnapshot').mockRejectedValue(new Error('disk gone'));
    const errors: string[] = [];
    const governed = new GovernedOrchestration({
      orchestration: new OrchestrationService({ planIdFactory: () => 'plan-1' }),
      audit: new AuditLog({ storage: storage(), now: () => 1_000 }),
      stateStore: failing,
      onPersistError: (scope) => errors.push(scope),
    });

    // Durability must never be a correctness dependency.
    await expect(governed.create('Ship it')).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(errors).toContain('governed.persist');
  });

  it('restores durable control state and audits the restore', async () => {
    const chromeStorage = new MemoryChromeStorage();
    const indexedDbFactory = new IDBFactory();
    const shared = (): StorageLayer => new StorageLayer({
      chromeStorage, indexedDbFactory, databaseName: 'gov-restore', now: () => 1_000,
      estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
    });

    const first = new GovernedOrchestration({
      orchestration: new OrchestrationService({ planIdFactory: () => 'plan-1' }),
      audit: new AuditLog({ storage: storage(), now: () => 1_000 }),
      stateStore: new BackgroundAgentStateStore({ storage: shared(), now: () => 2_100_000_000_000 }),
    });
    await first.create('Ship it');

    const audit = new AuditLog({ storage: storage(), now: () => 3_000 });
    const revived = new GovernedOrchestration({
      orchestration: new OrchestrationService({ planIdFactory: () => 'plan-2' }),
      audit,
      stateStore: new BackgroundAgentStateStore({ storage: shared(), now: () => 2_100_000_000_000 }),
    });

    await expect(revived.restore()).resolves.toEqual(expect.objectContaining({ ok: true }));
    const lifecycle = await audit.query({ category: 'lifecycle' });
    expect(lifecycle.some((entry) => entry.action === 'control state restored')).toBe(true);
  });

  it('returns a status snapshot and an audit summary', async () => {
    const { governed } = build();
    await governed.create('Ship it');
    await governed.approve('planner-1');

    expect(governed.status()).toEqual(expect.objectContaining({ ok: true }));
    await expect(governed.auditSummary()).resolves.toEqual(expect.objectContaining({ verified: true, total: 2 }));
  });
});

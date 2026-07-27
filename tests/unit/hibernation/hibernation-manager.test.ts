import { IDBFactory } from 'fake-indexeddb';
import { HibernationManager, HibernationPolicyError, type HibernatedWorkflowRecord } from '../../../src/hibernation/hibernation-manager';
import type { BackgroundAgentControlState, BackgroundAgentRoleState } from '../../../src/background/background-agent-state';
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

function storage(indexedDbFactory = new IDBFactory(), chromeStorage = new MemoryChromeStorage(), databaseName = `aamp-hib-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({ chromeStorage, indexedDbFactory, databaseName, now: () => 1_000, estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }) });
}

function role(overrides: Partial<BackgroundAgentRoleState> = {}): BackgroundAgentRoleState {
  return {
    taskId: 'planner-1',
    role: 'planner',
    title: 'Create implementation plan',
    status: 'completed',
    dependsOn: [],
    progress: 1,
    approvalRequired: false,
    canApprove: false,
    approvalBlockedReason: null,
    estimatedCostUsd: 0.05,
    ...overrides,
  };
}

function state(overrides: Partial<BackgroundAgentControlState> = {}): BackgroundAgentControlState {
  return {
    schemaVersion: 1,
    savedAt: 1_000,
    suspended: false,
    planId: 'plan-1',
    goal: 'Ship Phase 5D hibernation',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 0, handoffs: 2 },
    roles: [
      role(),
      role({ taskId: 'coder-1', role: 'coder', title: 'Implement approved plan', status: 'pending', dependsOn: ['planner-1'], progress: 0, approvalRequired: true, canApprove: true, estimatedCostUsd: 0.25 }),
      role({ taskId: 'critic-1', role: 'critic', title: 'Review implementation', status: 'pending', dependsOn: ['coder-1'], progress: 0, approvalRequired: true, canApprove: false, estimatedCostUsd: 0.1 }),
    ],
    ...overrides,
  };
}

describe('HibernationManager', () => {
  it('compresses control state into a bounded record that drops derived fields', async () => {
    const manager = new HibernationManager({ storage: storage(), now: () => 5_000 });

    const record = await manager.hibernate(state());

    expect(record).toEqual(expect.objectContaining({
      planId: 'plan-1',
      hibernatedAt: 5_000,
      lastActivityAt: 1_000,
      resumeApprovalRequired: true,
    }));
    expect(record.digest).toMatch(/^hib-[a-z0-9]+$/u);
    expect(record.roles).toHaveLength(3);
    // Derived presentation fields are recomputed on resume, never persisted.
    for (const stored of record.roles) {
      expect(stored).not.toHaveProperty('progress');
      expect(stored).not.toHaveProperty('canApprove');
      expect(stored).not.toHaveProperty('approvalBlockedReason');
    }
    expect(JSON.stringify(record)).not.toContain('Arena');
  });

  it('round-trips a workflow and recomputes derived approval fields on resume', async () => {
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const manager = new HibernationManager({ storage: storage(indexedDbFactory, chromeStorage, 'hib-roundtrip'), now: () => 5_000 });
    await manager.hibernate(state());

    const reloaded = new HibernationManager({ storage: storage(indexedDbFactory, chromeStorage, 'hib-roundtrip'), now: () => 9_000 });
    const resumed = await reloaded.resume('plan-1', true);

    expect(resumed).toEqual(expect.objectContaining({ planId: 'plan-1', suspended: false, savedAt: 9_000, estimatedCostUsd: 0.4 }));
    expect(resumed.roles.map((entry) => entry.taskId)).toEqual(['planner-1', 'coder-1', 'critic-1']);
    expect(resumed.roles[0]).toEqual(expect.objectContaining({ status: 'completed', progress: 1, canApprove: false }));
    // coder-1's dependency completed, so it is approvable again.
    expect(resumed.roles[1]).toEqual(expect.objectContaining({ canApprove: true, approvalBlockedReason: null, progress: 0 }));
    // critic-1 still waits on the unapproved coder-1.
    expect(resumed.roles[2]?.canApprove).toBe(false);
    expect(resumed.roles[2]?.approvalBlockedReason).toContain('coder-1');

    // Resuming consumes the record.
    await expect(reloaded.peek('plan-1')).resolves.toBeNull();
    await expect(reloaded.resume('plan-1', true)).rejects.toBeInstanceOf(HibernationPolicyError);
  });

  it('requires explicit human approval to resume or discard, but not to hibernate', async () => {
    const manager = new HibernationManager({ storage: storage(), now: () => 5_000 });
    await manager.hibernate(state());

    await expect(manager.resume('plan-1', false as never)).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.discard('plan-1', false as never)).rejects.toBeInstanceOf(HibernationPolicyError);
    // The record survives both refused attempts.
    await expect(manager.peek('plan-1')).resolves.toEqual(expect.objectContaining({ planId: 'plan-1' }));
    await expect(manager.discard('plan-1', true)).resolves.toBe(true);
    await expect(manager.discard('plan-1', true)).resolves.toBe(false);
  });

  it('recommends hibernation deterministically and never for a running workflow', () => {
    const manager = new HibernationManager({ storage: storage(), now: () => 100_000, idleTimeoutMs: 10_000 });

    const [idle, active, suspended, running, finished] = manager.evaluate([
      state({ planId: 'idle-plan', savedAt: 1_000 }),
      state({ planId: 'active-plan', savedAt: 99_000 }),
      state({ planId: 'suspended-plan', savedAt: 99_000, suspended: true }),
      state({ planId: 'running-plan', savedAt: 1_000, roles: [role({ status: 'running' })] }),
      state({ planId: 'done-plan', savedAt: 99_000, roles: [role({ status: 'completed' })] }),
    ], 100_000);

    expect(idle).toEqual(expect.objectContaining({ recommended: true, idleMs: 99_000, reasons: ['idle-timeout'] }));
    expect(active).toEqual(expect.objectContaining({ recommended: false, reasons: [] }));
    expect(active?.summary).toContain('not recommended');
    expect(suspended?.reasons).toEqual(['suspended']);
    // A running task is never auto-recommended even when long idle.
    expect(running).toEqual(expect.objectContaining({ recommended: false }));
    expect(running?.reasons).toContain('idle-timeout');
    expect(finished?.reasons).toEqual(['no-runnable-work']);
  });

  it('re-hibernating a plan replaces the record instead of duplicating it', async () => {
    let current = 5_000;
    const manager = new HibernationManager({ storage: storage(), now: () => current });
    await manager.hibernate(state());
    current = 6_000;
    await manager.hibernate(state({ savedAt: 2_000 }));

    const records = await manager.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({ hibernatedAt: 6_000, lastActivityAt: 2_000 }));
  });

  it('bounds retention and prunes only expired records', async () => {
    let current = 5_000;
    const manager = new HibernationManager({ storage: storage(), now: () => current, maxAgeMs: 10_000 });
    await manager.hibernate(state({ planId: 'old-plan' }));
    current = 12_000;
    await manager.hibernate(state({ planId: 'new-plan' }));

    current = 20_000;
    await expect(manager.prune()).resolves.toEqual(['old-plan']);
    expect((await manager.list()).map((record) => record.planId)).toEqual(['new-plan']);
    // Pruning again is a no-op.
    await expect(manager.prune()).resolves.toEqual([]);
  });

  it('enforces the hibernated workflow retention cap', async () => {
    const manager = new HibernationManager({ storage: storage(), now: () => 5_000 });
    for (let index = 0; index < 20; index += 1) {
      await manager.hibernate(state({ planId: `plan-${index}` }));
    }
    await expect(manager.hibernate(state({ planId: 'overflow-plan' }))).rejects.toBeInstanceOf(HibernationPolicyError);
    expect(await manager.list()).toHaveLength(20);
  });

  it('rejects invalid control state and over-limit role counts', async () => {
    const manager = new HibernationManager({ storage: storage(), now: () => 5_000 });

    await expect(manager.hibernate(state({ planId: '../bad' }))).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.hibernate(state({ goal: '   ' }))).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.hibernate(state({ savedAt: -1 }))).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.hibernate(state({ estimatedCostUsd: -1 }))).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.hibernate(state({ roles: [role({ role: 'overlord' as never })] }))).rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.hibernate(state({ roles: [role({ status: 'bogus' as never })] }))).rejects.toBeInstanceOf(HibernationPolicyError);
    // Phase 6 roles are accepted; six role states still exceed the 5-agent ceiling.
    await expect(manager.hibernate(state({ roles: [role({ role: 'executor' })] }))).resolves.toEqual(expect.objectContaining({ planId: 'plan-1' }));
    await expect(manager.hibernate(state({ roles: ['a', 'b', 'c', 'd', 'e', 'f'].map((taskId) => role({ taskId })) })))
      .rejects.toBeInstanceOf(HibernationPolicyError);
    await expect(manager.peek('../bad')).rejects.toBeInstanceOf(HibernationPolicyError);
  });

  it('rejects a tampered hibernated record on load and on resume', async () => {
    const chromeStorage = new MemoryChromeStorage();
    const indexedDbFactory = new IDBFactory();
    const layer = storage(indexedDbFactory, chromeStorage, 'hib-tamper');
    const manager = new HibernationManager({ storage: layer, now: () => 5_000 });
    const record = await manager.hibernate(state());

    const tamperedLayer = storage(new IDBFactory(), new MemoryChromeStorage(), 'hib-tampered-2');
    const tampered: HibernatedWorkflowRecord = { ...record, goal: 'Silently rewritten goal' };
    await tamperedLayer.putLarge('hibernation:workflows:v1', { schemaVersion: 1, records: [tampered] });

    const reader = new HibernationManager({ storage: tamperedLayer, now: () => 6_000 });
    await expect(reader.list()).rejects.toBeInstanceOf(HibernationPolicyError);

    const forgedApproval = storage(new IDBFactory(), new MemoryChromeStorage(), 'hib-forged');
    await forgedApproval.putLarge('hibernation:workflows:v1', {
      schemaVersion: 1,
      records: [{ ...record, resumeApprovalRequired: false }],
    });
    const forgedReader = new HibernationManager({ storage: forgedApproval, now: () => 6_000 });
    await expect(forgedReader.list()).rejects.toBeInstanceOf(HibernationPolicyError);
  });
});

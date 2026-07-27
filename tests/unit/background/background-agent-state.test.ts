import { IDBFactory } from 'fake-indexeddb';
import { BackgroundAgentStateError, BackgroundAgentStateStore } from '../../../src/background/background-agent-state';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
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

function storage(): StorageLayer {
  return new StorageLayer({
    chromeStorage: new MemoryChromeStorage(),
    indexedDbFactory: new IDBFactory(),
    databaseName: `aamp-bg-agent-${Math.random().toString(36).slice(2)}`,
    now: () => 2_100_000_000_000,
    estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
  });
}

function snapshot(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Restore approved orchestration control state',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 2 },
    cards: [
      { id: 'planner-1', role: 'planner', title: 'Plan', status: 'completed', dependsOn: [], estimatedCostUsd: 0.05, progress: 1, approvalRequired: false, canApprove: false, approvalBlockedReason: null },
      { id: 'coder-1', role: 'coder', title: 'Code', status: 'running', dependsOn: ['planner-1'], estimatedCostUsd: 0.25, progress: 0.5, approvalRequired: false, canApprove: false, approvalBlockedReason: null },
      { id: 'critic-1', role: 'critic', title: 'Review', status: 'pending', dependsOn: ['coder-1'], estimatedCostUsd: 0.1, progress: 0, approvalRequired: true, canApprove: false, approvalBlockedReason: 'Coder must complete first.' },
    ],
    ...overrides,
  };
}

describe('BackgroundAgentStateStore', () => {
  it('persists and restores bounded orchestration control-plane state', async () => {
    const store = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });

    const saved = await store.saveSnapshot(snapshot({ goal: 'x'.repeat(5_000) }));
    const restored = await store.restore();

    expect(saved).toEqual(expect.objectContaining({ planId: 'plan-1', suspended: false }));
    expect(restored).toEqual(expect.objectContaining({
      schemaVersion: 1,
      goal: 'x'.repeat(4_000),
      safety: { activeAgents: 1, handoffs: 2 },
      roles: expect.arrayContaining([expect.objectContaining({ taskId: 'coder-1', role: 'coder', status: 'running' })]),
    }));
  });

  it('marks restored state suspended/resumed without launching work', async () => {
    const store = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
    await store.saveSnapshot(snapshot());

    await expect(store.markSuspended('plan-1')).resolves.toEqual(expect.objectContaining({ suspended: true }));
    await expect(store.markResumed('plan-1')).resolves.toEqual(expect.objectContaining({ suspended: false }));
    await expect(store.markSuspended('other-plan')).rejects.toBeInstanceOf(BackgroundAgentStateError);
  });

  it('clears state for inactive snapshots', async () => {
    const store = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
    await store.saveSnapshot(snapshot());
    await expect(store.saveSnapshot({ active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } })).resolves.toBeNull();
    await expect(store.restore()).resolves.toBeNull();
  });

  it('rejects unsafe or out-of-policy restore state', async () => {
    const store = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
    // 5 agents is the phase6 ceiling, so 6 is the rejection boundary.
    await expect(store.saveSnapshot(snapshot({ safety: { activeAgents: 6, handoffs: 0 } }))).rejects.toBeInstanceOf(BackgroundAgentStateError);
    const overCapacity = ['e1', 'e2', 'e3'].map((id) => ({ ...snapshot().cards[0]!, id }));
    await expect(store.saveSnapshot(snapshot({ cards: [...snapshot().cards, ...overCapacity] }))).rejects.toBeInstanceOf(BackgroundAgentStateError);
    await expect(store.saveSnapshot(snapshot({ planId: '../bad' }))).rejects.toBeInstanceOf(BackgroundAgentStateError);
  });

  it('returns cloned state so callers cannot mutate persisted role arrays', async () => {
    const store = new BackgroundAgentStateStore({ storage: storage(), now: () => 2_100_000_000_000 });
    const saved = await store.saveSnapshot(snapshot());
    if (!saved) throw new Error('expected saved state');
    (saved.roles as Array<unknown>).push({ bad: true });

    const restored = await store.restore();
    expect(restored?.roles).toHaveLength(3);
  });
});

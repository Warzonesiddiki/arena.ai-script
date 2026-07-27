import { IDBFactory } from 'fake-indexeddb';
import { RecoveryPolicyError, RecoverySnapshotManager } from '../../../src/recovery/recovery-snapshot-manager';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { AgentDashboardCard } from '../../../src/orchestration/dashboard-state';
import type { HealthSnapshot } from '../../../src/health/orchestration-health-monitor';
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

function storage(indexedDbFactory = new IDBFactory(), chromeStorage = new MemoryChromeStorage(), databaseName = `aamp-rec-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({ chromeStorage, indexedDbFactory, databaseName, now: () => 1_000, estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }) });
}

function card(overrides: Partial<AgentDashboardCard> = {}): AgentDashboardCard {
  return {
    id: 'planner-1',
    role: 'planner',
    title: 'Create implementation plan',
    status: 'completed',
    dependsOn: [],
    estimatedCostUsd: 0.05,
    progress: 1,
    approvalRequired: false,
    canApprove: false,
    approvalBlockedReason: null,
    ...overrides,
  };
}

function orchestration(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Ship Phase 5E recovery',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 2 },
    cards: [
      card(),
      card({ id: 'coder-1', role: 'coder', title: 'Implement approved plan', status: 'running', dependsOn: ['planner-1'], progress: 0.5, estimatedCostUsd: 0.25 }),
      card({ id: 'critic-1', role: 'critic', title: 'Review implementation', status: 'pending', dependsOn: ['coder-1'], progress: 0, approvalRequired: true, canApprove: false, estimatedCostUsd: 0.1 }),
    ],
    ...overrides,
  };
}

function health(status: HealthSnapshot['status']): HealthSnapshot {
  return {
    generatedAt: 5_000,
    status,
    issues: [],
    metrics: {
      activeAgents: 1, handoffs: 2, maxHandoffs: 12, handoffUsageRatio: 2 / 12,
      pendingApprovals: 1, runningTasks: 1, blockedTasks: 0, failedTasks: 0, budgetUsageRatio: 0.4,
    },
  };
}

describe('RecoverySnapshotManager', () => {
  it('captures integrity-checked snapshots that hold no prompts or file content', async () => {
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => 'snap-1' });

    const snapshot = await manager.capture(orchestration(), 'pre-approval', health('attention'));

    expect(snapshot).toEqual(expect.objectContaining({
      id: 'snap-1', planId: 'plan-1', trigger: 'pre-approval', healthStatus: 'attention', restoreApprovalRequired: true,
    }));
    expect(snapshot.digest).toMatch(/^rec-[a-z0-9]+$/u);
    expect(snapshot.roles.map((role) => role.approved)).toEqual([true, true, false]);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ['prompt', 'conversation', 'apiKey', 'secret', 'rawContent']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps a per-plan ring buffer without evicting other plans', async () => {
    let current = 1_000;
    let index = 0;
    const manager = new RecoverySnapshotManager({
      storage: storage(), now: () => (current += 10), idFactory: () => `snap-${index++}`, maxSnapshotsPerPlan: 3,
    });

    for (let capture = 0; capture < 5; capture += 1) await manager.capture(orchestration(), 'periodic');
    await manager.capture(orchestration({ planId: 'plan-2' }), 'manual');

    const planOne = await manager.list('plan-1');
    expect(planOne).toHaveLength(3);
    expect(planOne.map((entry) => entry.id)).toEqual(['snap-2', 'snap-3', 'snap-4']);
    expect(await manager.list('plan-2')).toHaveLength(1);
    expect(await manager.list()).toHaveLength(4);
  });

  it('proposes a deterministic approval-gated recovery plan and never self-executes', async () => {
    let current = 1_000;
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => (current += 100), idFactory: () => `snap-${current}` });
    await manager.capture(orchestration(), 'pre-approval');

    const failing = orchestration({
      cards: [
        card(),
        card({ id: 'coder-1', role: 'coder', title: 'Implement approved plan', status: 'failed', dependsOn: ['planner-1'], progress: 1, estimatedCostUsd: 0.25 }),
        card({ id: 'critic-1', role: 'critic', title: 'Review implementation', status: 'blocked', dependsOn: ['coder-1'], progress: 1, approvalRequired: true, canApprove: false, approvalBlockedReason: 'dependency "coder-1" is failed', estimatedCostUsd: 0.1 }),
      ],
    });

    const proposal = await manager.proposeRecovery(failing, health('critical'));

    expect(proposal.autoExecutable).toBe(false);
    expect(proposal.snapshotId).toBe('snap-1100');
    expect(proposal.steps.map((step) => step.kind)).toEqual([
      'resume-from-snapshot', 'reset-failed-task', 'investigate-blocker',
    ]);
    expect(proposal.steps.every((step) => step.requiresApproval)).toBe(true);
    expect(proposal.rationale).toContain('explicit human approval');
    expect(proposal.confidence).toBe('high');
  });

  it('never proposes a snapshot that already contains the failure', async () => {
    let current = 1_000;
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => (current += 100), idFactory: () => `snap-${current}` });
    const failedCards = [card(), card({ id: 'coder-1', role: 'coder', status: 'failed', dependsOn: ['planner-1'] })];

    await manager.capture(orchestration({ cards: failedCards }), 'post-transition');
    const proposal = await manager.proposeRecovery(orchestration({ cards: failedCards }));

    expect(proposal.snapshotId).toBeNull();
    expect(proposal.confidence).toBe('low');
    expect(proposal.rationale).toContain('no clean recovery snapshot');
    expect(proposal.steps.map((step) => step.kind)).toEqual(['reset-failed-task']);
  });

  it('reports progress loss and requires re-approval of previously approved work', async () => {
    let current = 1_000;
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => (current += 100), idFactory: () => `snap-${current}` });
    await manager.capture(orchestration({
      cards: [card({ status: 'pending', approvalRequired: false }), card({ id: 'coder-1', role: 'coder', status: 'pending', dependsOn: ['planner-1'], approvalRequired: false })],
    }), 'manual');

    const advanced = orchestration({
      cards: [
        card({ status: 'completed', approvalRequired: true }),
        card({ id: 'coder-1', role: 'coder', status: 'completed', dependsOn: ['planner-1'], approvalRequired: true }),
      ],
    });
    const proposal = await manager.proposeRecovery(advanced, health('attention'));

    expect(proposal.progressLossCount).toBe(2);
    expect(proposal.confidence).toBe('low');
    expect(proposal.steps.filter((step) => step.kind === 'reapprove-task').map((step) => step.taskId)).toEqual(['planner-1', 'coder-1']);
    expect(proposal.rationale).toContain('regress 2 task(s)');
  });

  it('reports no action for a healthy workflow and for no workflow at all', async () => {
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => 'snap-1' });
    await manager.capture(orchestration(), 'manual');

    const healthy = await manager.proposeRecovery(orchestration());
    expect(healthy.steps.map((step) => step.kind)).toEqual(['resume-from-snapshot']);

    const idle = await manager.proposeRecovery({ active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } });
    expect(idle.steps).toEqual([expect.objectContaining({ kind: 'no-action-required', requiresApproval: false })]);
    expect(idle.snapshotId).toBeNull();

    const noSnapshots = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000 });
    const empty = await noSnapshots.proposeRecovery(orchestration());
    expect(empty.steps).toEqual([expect.objectContaining({ kind: 'no-action-required' })]);
    expect(empty.rationale).toContain('no clean recovery snapshot');
  });

  it('requires explicit human approval to restore or discard', async () => {
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => 'snap-1' });
    await manager.capture(orchestration(), 'manual');

    await expect(manager.restore('snap-1', false as never)).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.discardPlan('plan-1', false as never)).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.restore('snap-1', true)).resolves.toEqual(expect.objectContaining({ id: 'snap-1' }));
    await expect(manager.restore('snap-missing', true)).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.discardPlan('plan-1', true)).resolves.toBe(1);
    await expect(manager.discardPlan('plan-1', true)).resolves.toBe(0);
  });

  it('persists snapshots across instances and rejects tampered books', async () => {
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const manager = new RecoverySnapshotManager({ storage: storage(indexedDbFactory, chromeStorage, 'rec-reload'), now: () => 5_000, idFactory: () => 'snap-1' });
    const original = await manager.capture(orchestration(), 'manual');

    const reloaded = new RecoverySnapshotManager({ storage: storage(indexedDbFactory, chromeStorage, 'rec-reload'), now: () => 9_000 });
    await expect(reloaded.get('snap-1')).resolves.toEqual(expect.objectContaining({ planId: 'plan-1' }));

    const tamperedLayer = storage(new IDBFactory(), new MemoryChromeStorage(), 'rec-tampered');
    await tamperedLayer.putLarge('recovery:snapshots:v1', { schemaVersion: 1, snapshots: [{ ...original, goal: 'rewritten' }] });
    await expect(new RecoverySnapshotManager({ storage: tamperedLayer }).list()).rejects.toBeInstanceOf(RecoveryPolicyError);

    const forgedLayer = storage(new IDBFactory(), new MemoryChromeStorage(), 'rec-forged');
    await forgedLayer.putLarge('recovery:snapshots:v1', { schemaVersion: 1, snapshots: [{ ...original, restoreApprovalRequired: false }] });
    await expect(new RecoverySnapshotManager({ storage: forgedLayer }).list()).rejects.toBeInstanceOf(RecoveryPolicyError);
  });

  it('rejects invalid snapshots, triggers, identifiers, and plan limits', async () => {
    const manager = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => 'snap-1' });

    await expect(manager.capture({ active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } }))
      .rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.capture(orchestration(), 'webhook' as never)).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.capture(orchestration({ planId: '../bad' }))).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.capture(orchestration({ cards: [card({ role: 'researcher' as never })] }))).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.capture(orchestration({ cards: [card(), card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c' })] }))).rejects.toBeInstanceOf(RecoveryPolicyError);
    await expect(manager.get('../bad')).rejects.toBeInstanceOf(RecoveryPolicyError);

    let index = 0;
    const bounded = new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => `snap-${index++}` });
    for (let plan = 0; plan < 10; plan += 1) await bounded.capture(orchestration({ planId: `plan-${plan}` }), 'manual');
    await expect(bounded.capture(orchestration({ planId: 'plan-overflow' }), 'manual')).rejects.toBeInstanceOf(RecoveryPolicyError);
  });
});

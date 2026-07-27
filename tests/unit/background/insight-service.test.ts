import { IDBFactory } from 'fake-indexeddb';
import { InsightService } from '../../../src/background/insight-service';
import { HibernationManager } from '../../../src/hibernation/hibernation-manager';
import { RecoverySnapshotManager } from '../../../src/recovery/recovery-snapshot-manager';
import { Tracer } from '../../../src/observability/tracer';
import { StorageLayer, type ChromeStorageArea } from '../../../src/storage/storage-layer';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { AgentDashboardCard } from '../../../src/orchestration/dashboard-state';
import type { BackgroundAgentControlState } from '../../../src/background/background-agent-state';

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
    databaseName: `insight-${Math.random().toString(36).slice(2)}`,
    now: () => 1_000,
    estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
  });
}

function card(overrides: Partial<AgentDashboardCard> = {}): AgentDashboardCard {
  return {
    id: 'planner-1', role: 'planner', title: 'Plan', status: 'completed', dependsOn: [],
    estimatedCostUsd: 0.05, progress: 1, approvalRequired: false, canApprove: false, approvalBlockedReason: null,
    ...overrides,
  };
}

function orchestration(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true, planId: 'plan-1', goal: 'Ship insights', estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 2 }, cards: [card()],
    ...overrides,
  };
}

function service(tracer = new Tracer({ now: () => 1_000 })): InsightService {
  return new InsightService({
    tracer,
    recovery: new RecoverySnapshotManager({ storage: storage(), now: () => 5_000, idFactory: () => 'snap-1' }),
    hibernation: new HibernationManager({ storage: storage(), now: () => 5_000, idleTimeoutMs: 1_000 }),
    now: () => 5_000,
  });
}

describe('InsightService', () => {
  it('builds a bounded read-only snapshot that actions nothing', async () => {
    const snapshot = await service().build(orchestration());

    expect(snapshot.autoActioned).toBe(false);
    expect(snapshot.generatedAt).toBe(5_000);
    expect(snapshot.recovery.autoExecutable).toBe(false);
    expect(snapshot.focus.headline).toBeTruthy();
    expect(snapshot.health.status).toBe('healthy');
    expect(snapshot.cost).toEqual(expect.objectContaining({ status: expect.any(String), stopRecommended: false }));
  });

  it('reports no cost section when there is no active workflow', async () => {
    const snapshot = await service().build({
      active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 },
    });

    expect(snapshot.cost).toBeNull();
    expect(snapshot.focus.items[0]?.kind).toBe('idle');
  });

  it('surfaces failures through focus and health together', async () => {
    const snapshot = await service().build(orchestration({
      cards: [card(), card({ id: 'coder-1', role: 'coder', status: 'failed' })],
    }));

    expect(snapshot.health.status).toBe('critical');
    expect(snapshot.focus.items[0]?.kind).toBe('failed-task');
  });

  it('summarises trace replay from real tracer output', async () => {
    const tracer = new Tracer({ now: () => 1_000 });
    tracer.record('orchestration.plan.created', 'info', { planId: 'plan-1' });
    tracer.recordError('orchestration.task.failed', new Error('boom'));

    const snapshot = await service(tracer).build(orchestration());

    expect(snapshot.replay.totalEvents).toBe(2);
    expect(snapshot.replay.correlationIds.length).toBeGreaterThan(0);
  });

  it('captures a recovery point only for an active workflow', async () => {
    const insights = service();

    await expect(insights.captureRecoveryPoint(orchestration())).resolves.toBe('snap-1');
    await expect(insights.captureRecoveryPoint({
      active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 },
    })).resolves.toBeNull();
  });

  it('recommends hibernation for idle control state', () => {
    const state: BackgroundAgentControlState = {
      schemaVersion: 1, savedAt: 1_000, suspended: false, planId: 'plan-1', goal: 'Idle work',
      estimatedCostUsd: 0.1, safety: { activeAgents: 0, handoffs: 0 },
      roles: [{
        taskId: 'planner-1', role: 'planner', title: 'Plan', status: 'pending', dependsOn: [],
        progress: 0, approvalRequired: true, canApprove: true, approvalBlockedReason: null, estimatedCostUsd: 0.05,
      }],
    };

    const candidates = service().hibernationCandidates([state]);
    expect(candidates[0]).toEqual(expect.objectContaining({ planId: 'plan-1', recommended: true }));
  });

  it('produces a deterministic analytics report', () => {
    const tracer = new Tracer({ now: () => 1_000 });
    tracer.record('orchestration.plan.created', 'info', { planId: 'plan-1' });

    const report = service(tracer).analyticsReport(orchestration());
    expect(report.generatedAt).toBe(5_000);
    expect(report.roles.length).toBeGreaterThan(0);
  });
});

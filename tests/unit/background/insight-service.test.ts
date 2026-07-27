import { IDBFactory } from 'fake-indexeddb';
import { InsightService } from '../../../src/background/insight-service';
import { HibernationManager } from '../../../src/hibernation/hibernation-manager';
import { RecoverySnapshotManager } from '../../../src/recovery/recovery-snapshot-manager';
import { Tracer } from '../../../src/observability/tracer';
import { StorageLayer, type ChromeStorageArea } from '../../../src/storage/storage-layer';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { AgentDashboardCard } from '../../../src/orchestration/dashboard-state';
import type { BackgroundAgentControlState } from '../../../src/background/background-agent-state';
import type { AgentPlan, PlanTask } from '../../../src/orchestration/types';
import type { AgentMemoryNode } from '../../../src/memory/agent-memory-graph';
import type { ExtensionConfig } from '../../../src/configuration/config-proposal';
import type { WorkflowCostRecord } from '../../../src/analytics/cost-attribution';

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

describe('InsightService phase integrations', () => {
  function planTask(overrides: Partial<PlanTask> = {}): PlanTask {
    return {
      id: 'planner-1', role: 'planner', title: 'Plan', instructions: 'plan it',
      dependsOn: [], estimatedCostUsd: 0.05, status: 'pending', ...overrides,
    };
  }

  function plan(): AgentPlan {
    return {
      id: 'plan-1', goal: 'Ship it', createdAt: 1_000, maxConcurrentAgents: 3,
      tasks: [planTask(), planTask({ id: 'coder-1', role: 'coder', dependsOn: ['planner-1'], estimatedCostUsd: 0.1 })],
    };
  }

  function memoryNode(overrides: Partial<AgentMemoryNode> = {}): AgentMemoryNode {
    return {
      id: 'mem-1', title: 'Scope context explicitly', summary: 'Only send selected files.',
      kind: 'lesson', tags: ['safety'], scope: { workflowId: 'plan-1', taskId: 'coder-1', filePaths: [] },
      evidence: [], source: { type: 'approved-reflection', approvedByHuman: true },
      createdAt: 1_000, updatedAt: 1_000, expiresAt: null, embedding: [], ...overrides,
    };
  }

  function extensionConfig(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
    return {
      capabilityTier: 'phase3', workflowBudgetUsd: 0.5, agentBudgetUsd: 0.3,
      stallTimeoutMs: 120_000, budgetWarnRatio: 0.8, maxTraceEvents: 1_000,
      notificationVerbosity: 'normal', ...overrides,
    };
  }

  function costRecord(overrides: Partial<WorkflowCostRecord> = {}): WorkflowCostRecord {
    return {
      workflowId: 'wf-1', completedAt: 1_000, budgetUsd: 1,
      entries: [{ taskId: 'coder-1', role: 'coder', costUsd: 0.2, status: 'completed' }],
      ...overrides,
    };
  }

  it('Phase 15: compares strategies against the service budget and applies nothing', () => {
    const comparison = service().simulateStrategies(plan(), [
      { id: 'full', label: 'Approve both', approvals: ['planner-1', 'coder-1'] },
      { id: 'partial', label: 'Planner only', approvals: ['planner-1'] },
    ]);

    expect(comparison.autoApplied).toBe(false);
    expect(comparison.planId).toBe('plan-1');
    // The service passes its own workflow budget through to the simulator.
    expect(comparison.budgetUsd).toBe(0.5);
    expect(comparison.recommendedStrategyId).toBe('full');
  });

  it('Phase 15: reports no feasible strategy when the service budget is too small', () => {
    const tight = new InsightService({ tracer: new Tracer({ now: () => 1_000 }), workflowBudgetUsd: 0.01, now: () => 5_000 });
    const comparison = tight.simulateStrategies(plan(), [{ id: 'full', label: 'All', approvals: ['planner-1', 'coder-1'] }]);

    expect(comparison.recommendedStrategyId).toBeNull();
    expect(comparison.rationale).toContain('No simulated strategy is feasible');
  });

  it('Phase 18: distills approved memory and stamps the service clock', () => {
    const pack = service().distillKnowledge([memoryNode(), memoryNode({ id: 'mem-2' })], 'pack-1', 'Safety lessons');

    expect(pack).toEqual(expect.objectContaining({
      id: 'pack-1', name: 'Safety lessons', createdAt: 5_000, importApprovalRequired: true,
    }));
    // Two identical summaries collapse into one reinforced entry.
    expect(pack.entries).toHaveLength(1);
    expect(pack.entries[0]?.mergedCount).toBe(2);
  });

  it('Phase 18: refuses to distill memory that is not human-approved', () => {
    const unapproved = memoryNode({ id: 'mem-9', source: { type: 'manual', approvedByHuman: false as never } });
    expect(() => service().distillKnowledge([unapproved], 'pack-1', 'Bad pack')).toThrow();
  });

  it('Phase 17: attributes cost across workflows using the service clock', () => {
    const report = service().costAttribution([
      costRecord(),
      costRecord({ workflowId: 'wf-2', completedAt: 2_000, entries: [{ taskId: 'critic-1', role: 'critic', costUsd: 0.9, status: 'failed' }] }),
    ]);

    expect(report.generatedAt).toBe(5_000);
    expect(report.workflowCount).toBe(2);
    // The failed critic task is counted as waste.
    expect(report.totalWastedUsd).toBe(0.9);
    expect(report.roles.map((role) => role.role)).toEqual(['critic', 'coder']);
  });

  it('Phase 16: proposes nothing for a healthy workflow', () => {
    expect(service().proposeConfigChanges(extensionConfig(), orchestration())).toEqual([]);
  });

  it('Phase 16: derives proposals from live health and supplied attribution', () => {
    const insights = service();
    const attributionReport = insights.costAttribution([
      costRecord({ workflowId: 'wf-1', budgetUsd: 0.1, entries: [{ taskId: 'coder-1', role: 'coder', costUsd: 0.5, status: 'failed' }] }),
      costRecord({ workflowId: 'wf-2', completedAt: 2_000, budgetUsd: 0.1, entries: [{ taskId: 'coder-2', role: 'coder', costUsd: 0.5, status: 'failed' }] }),
    ]);

    const proposals = insights.proposeConfigChanges(extensionConfig(), orchestration(), attributionReport);

    // Every proposal is inert and approval-gated, whatever the evidence.
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) expect(proposal.requiresApproval).toBe(true);
    // Wasted spend should tighten the warn ratio rather than loosen anything.
    expect(proposals.map((proposal) => proposal.key)).toContain('budgetWarnRatio');
    expect(proposals[0]?.restrictive).toBe(true);
  });

  it('Phase 16: never proposes a change to the immutable safety model', () => {
    const insights = service();
    const attributionReport = insights.costAttribution([
      costRecord({ workflowId: 'wf-1', budgetUsd: 0.1, entries: [{ taskId: 'coder-1', role: 'coder', costUsd: 0.5, status: 'failed' }] }),
      costRecord({ workflowId: 'wf-2', completedAt: 2_000, budgetUsd: 0.1, entries: [{ taskId: 'coder-2', role: 'coder', costUsd: 0.5, status: 'failed' }] }),
    ]);

    const keys = insights.proposeConfigChanges(extensionConfig(), orchestration(), attributionReport).map((proposal) => proposal.key);
    for (const immutable of ['requireHumanApproval', 'allowAutomaticExecution', 'allowArbitraryDom', 'allowNetworkEgress', 'auditLogEnabled']) {
      expect(keys).not.toContain(immutable);
    }
  });
});

import { OrchestrationHealthMonitor, OrchestrationHealthMonitorError } from '../../../src/health/orchestration-health-monitor';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { CausalCostEvent } from '../../../src/debugging/causal-trace-debugger';
import type { TraceEvent } from '../../../src/observability/tracer';

function snapshot(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Monitor workflow health',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 4 },
    cards: [
      {
        id: 'planner-1',
        role: 'planner',
        title: 'Plan',
        status: 'completed',
        dependsOn: [],
        estimatedCostUsd: 0.05,
        progress: 1,
        approvalRequired: false,
        canApprove: false,
        approvalBlockedReason: null,
      },
      {
        id: 'coder-1',
        role: 'coder',
        title: 'Code',
        status: 'running',
        dependsOn: ['planner-1'],
        estimatedCostUsd: 0.25,
        progress: 0.5,
        approvalRequired: false,
        canApprove: false,
        approvalBlockedReason: null,
      },
      {
        id: 'critic-1',
        role: 'critic',
        title: 'Review',
        status: 'pending',
        dependsOn: ['coder-1'],
        estimatedCostUsd: 0.1,
        progress: 0,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Coder has not completed.',
      },
    ],
    ...overrides,
  };
}

function trace(taskId: string, status: string, timestamp: number): TraceEvent {
  return { id: `${taskId}-${status}-${timestamp}`, correlationId: 'corr-1', parentId: null, name: 'orchestration.task.statusChanged', level: 'info', timestamp, attributes: { taskId, status } };
}

function costEvent(projectedWorkflowTotalUsd: number, workflowBudgetUsd = 1): CausalCostEvent {
  return {
    name: 'cost:projection',
    timestamp: 1,
    payload: {
      workflowId: 'workflow-1',
      agentId: 'coder',
      estimatedCostUsd: 0.1,
      workflowSpentUsd: 0,
      workflowReservedUsd: 0,
      projectedWorkflowTotalUsd,
      workflowBudgetUsd,
      agentSpentUsd: 0,
      projectedAgentTotalUsd: 0.1,
      agentBudgetUsd: null,
    },
  };
}

describe('OrchestrationHealthMonitor', () => {
  it('detects stalled running tasks from task status trace timing', () => {
    const monitor = new OrchestrationHealthMonitor({ stallTimeoutMs: 100 });
    const result = monitor.evaluate({ orchestration: snapshot(), traceEvents: [trace('coder-1', 'running', 1_000)], now: 1_150 });

    expect(result.status).toBe('critical');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'stalled-task', severity: 'critical', taskId: 'coder-1' }),
    ]));
    expect(result.metrics.runningTasks).toBe(1);
  });

  it('does not report a stall after terminal status trace clears running state', () => {
    const monitor = new OrchestrationHealthMonitor({ stallTimeoutMs: 100 });
    const result = monitor.evaluate({
      orchestration: snapshot({ cards: snapshot().cards.map((card) => card.id === 'coder-1' ? { ...card, status: 'blocked' } : card) }),
      traceEvents: [trace('coder-1', 'running', 1_000), trace('coder-1', 'blocked', 1_050)],
      now: 1_200,
    });

    expect(result.issues.some((issue) => issue.kind === 'stalled-task')).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'blocked-task', taskId: 'coder-1' })]));
  });

  it('detects handoff, active-agent, approval, and budget risks without taking action', () => {
    const monitor = new OrchestrationHealthMonitor({ handoffWarningRatio: 0.75, budgetWarningRatio: 0.8 });
    const result = monitor.evaluate({
      orchestration: snapshot({ safety: { activeAgents: 3, handoffs: 10 } }),
      costEvents: [costEvent(0.81, 1)],
      now: 2_000,
    });

    expect(result.status).toBe('attention');
    expect(result.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(['handoff-risk', 'agent-capacity', 'approval-wait', 'budget-risk']));
    expect(result.metrics).toEqual(expect.objectContaining({ activeAgents: 3, handoffs: 10, budgetUsageRatio: 0.81 }));
    expect(result.issues.every((issue) => !/auto|automatically/iu.test(issue.recommendedAction))).toBe(true);
  });

  it('marks exhausted budget and failed tasks as critical', () => {
    const monitor = new OrchestrationHealthMonitor();
    const failedCards = snapshot().cards.map((card) => card.id === 'coder-1' ? { ...card, status: 'failed' as const } : card);
    const blockedCost: CausalCostEvent = {
      name: 'cost:blocked',
      timestamp: 1,
      payload: {
        workflowId: 'workflow-1',
        agentId: 'coder',
        estimatedCostUsd: 0.1,
        workflowSpentUsd: 0,
        workflowReservedUsd: 0,
        projectedWorkflowTotalUsd: 1.2,
        workflowBudgetUsd: 1,
        agentSpentUsd: 0,
        projectedAgentTotalUsd: 0.1,
        agentBudgetUsd: null,
        allowed: false,
        reason: 'workflow-budget-exceeded',
        reservationId: null,
      },
    };
    const result = monitor.evaluate({
      orchestration: snapshot({ cards: failedCards, safety: { activeAgents: 0, handoffs: 12 } }),
      costEvents: [blockedCost],
      now: 2_000,
    });

    expect(result.status).toBe('critical');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'failed-task', severity: 'critical', taskId: 'coder-1' }),
      expect.objectContaining({ kind: 'handoff-risk', severity: 'critical' }),
      expect.objectContaining({ kind: 'budget-risk', severity: 'critical' }),
    ]));
  });

  it('reports healthy when no deterministic risk is present', () => {
    const monitor = new OrchestrationHealthMonitor();
    const healthy = snapshot({
      safety: { activeAgents: 0, handoffs: 0 },
      cards: snapshot().cards.map((card) => ({ ...card, status: 'completed', approvalRequired: false, canApprove: false, approvalBlockedReason: null })),
    });

    expect(monitor.evaluate({ orchestration: healthy, now: 1_000 })).toEqual(expect.objectContaining({ status: 'healthy', issues: [] }));
  });

  it('rejects invalid monitor configuration and timestamps', () => {
    expect(() => new OrchestrationHealthMonitor({ stallTimeoutMs: 0 })).toThrow(OrchestrationHealthMonitorError);
    expect(() => new OrchestrationHealthMonitor({ budgetWarningRatio: 2 })).toThrow(OrchestrationHealthMonitorError);
    expect(() => new OrchestrationHealthMonitor().evaluate({ orchestration: snapshot(), now: 0 })).toThrow(OrchestrationHealthMonitorError);
  });
});

import { PerformanceAnalyticsEngine, PerformanceAnalyticsError } from '../../../src/analytics/performance-analytics';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { CausalCostEvent } from '../../../src/debugging/causal-trace-debugger';
import type { HealthSnapshot } from '../../../src/health/orchestration-health-monitor';
import type { AgentMemoryGraphRecord } from '../../../src/memory/agent-memory-graph';
import type { TraceEvent } from '../../../src/observability/tracer';
import type { PostTaskReflectionReport } from '../../../src/reflection/post-task-reflection';

function orchestration(): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Analytics',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 2 },
    cards: [
      { id: 'planner-1', role: 'planner', title: 'Plan', status: 'completed', dependsOn: [], estimatedCostUsd: 0.05, progress: 1, approvalRequired: false, canApprove: false, approvalBlockedReason: null },
      { id: 'coder-1', role: 'coder', title: 'Code', status: 'blocked', dependsOn: ['planner-1'], estimatedCostUsd: 0.25, progress: 0.5, approvalRequired: true, canApprove: false, approvalBlockedReason: 'Budget risk.' },
      { id: 'critic-1', role: 'critic', title: 'Review', status: 'pending', dependsOn: ['coder-1'], estimatedCostUsd: 0.1, progress: 0, approvalRequired: true, canApprove: false, approvalBlockedReason: 'Coder blocked.' },
    ],
  };
}

function traceEvents(): TraceEvent[] {
  return [
    { id: 't1', correlationId: 'c1', parentId: null, name: 'orchestration.plan.created', level: 'info', timestamp: 1, attributes: {} },
    { id: 't2', correlationId: 'c1', parentId: 't1', name: 'orchestration.task.statusChanged', level: 'warn', timestamp: 2, attributes: { taskId: 'coder-1' } },
    { id: 't3', correlationId: 'c2', parentId: null, name: 'recovery.failed', level: 'error', timestamp: 3, attributes: {} },
  ];
}

function costEvents(): CausalCostEvent[] {
  return [{
    name: 'cost:blocked',
    timestamp: 1,
    payload: {
      workflowId: 'workflow-1',
      agentId: 'coder',
      estimatedCostUsd: 0.25,
      workflowSpentUsd: 0.1,
      workflowReservedUsd: 0.2,
      projectedWorkflowTotalUsd: 0.9,
      workflowBudgetUsd: 1,
      agentSpentUsd: 0,
      projectedAgentTotalUsd: 0.25,
      agentBudgetUsd: 0.3,
      allowed: false,
      reason: 'workflow-budget-exceeded',
      reservationId: null,
    },
  }];
}

function health(): HealthSnapshot {
  return {
    generatedAt: 4,
    status: 'critical',
    issues: [
      { id: 'health:budget-risk:workflow', kind: 'budget-risk', severity: 'critical', summary: 'Budget exhausted', taskId: null, observedAt: 4, evidence: {}, recommendedAction: 'Review budget.' },
      { id: 'health:approval-wait:critic-1', kind: 'approval-wait', severity: 'info', summary: 'Approval wait', taskId: 'critic-1', observedAt: 4, evidence: {}, recommendedAction: 'Approve dependency.' },
    ],
    metrics: { activeAgents: 1, handoffs: 2, maxHandoffs: 12, handoffUsageRatio: 0.167, pendingApprovals: 2, runningTasks: 0, blockedTasks: 1, failedTasks: 0, budgetUsageRatio: 0.9 },
  };
}

function memory(): AgentMemoryGraphRecord {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'mem-1', title: 'Lesson', summary: 'Budget lesson', kind: 'lesson', tags: ['budget'], scope: { workflowId: 'plan-1', taskId: '', filePaths: [] }, evidence: [], source: { type: 'manual', approvedByHuman: true }, createdAt: 1, updatedAt: 1, expiresAt: 6, embedding: ['budget'] },
      { id: 'mem-2', title: 'Constraint', summary: 'Approval constraint', kind: 'constraint', tags: ['approval'], scope: { workflowId: 'plan-1', taskId: '', filePaths: [] }, evidence: [], source: { type: 'manual', approvedByHuman: true }, createdAt: 1, updatedAt: 1, expiresAt: null, embedding: ['approval'] },
    ],
    edges: [{ fromId: 'mem-1', toId: 'mem-2', relation: 'relates-to', createdAt: 1 }],
  };
}

function reflection(): PostTaskReflectionReport {
  return {
    schemaVersion: 1,
    generatedAt: 5,
    workflow: { planId: 'plan-1', goal: 'Analytics', status: 'blocked', estimatedCostUsd: 0.4 },
    tasks: [],
    findings: [{ id: 'finding-1', severity: 'critical', summary: 'Critical finding', evidenceNodeIds: [] }],
    recommendations: [{ id: 'rec-1', kind: 'testing', summary: 'Add tests', requiresApproval: false }],
    memoryCandidates: [{ id: 'candidate-1', title: 'Candidate', summary: 'Memory candidate', kind: 'lesson', tags: ['reflection'], workflowId: 'plan-1' }],
    modelReflection: { status: 'not-requested' },
  };
}

describe('PerformanceAnalyticsEngine', () => {
  it('aggregates bounded workflow, role, cost, trace, health, memory, and reflection analytics', () => {
    const report = new PerformanceAnalyticsEngine().build({
      orchestration: orchestration(),
      traceEvents: traceEvents(),
      costEvents: costEvents(),
      health: health(),
      memory: memory(),
      reflection: reflection(),
      generatedAt: 10,
    });

    expect(report.workflow).toEqual(expect.objectContaining({ active: true, taskCount: 3, completedTasks: 1, blockedTasks: 1, pendingApprovals: 2, averageProgress: 0.5 }));
    expect(report.roles).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'coder', blockedTasks: 1, estimatedCostUsd: 0.25 })]));
    expect(report.cost).toEqual(expect.objectContaining({ projectedWorkflowCostUsd: 0.9, actualWorkflowCostUsd: 0.1, reservedWorkflowCostUsd: 0.2, blockedCostEvents: 1, budgetRiskRatio: 0.9 }));
    expect(report.traces).toEqual(expect.objectContaining({ totalEvents: 3, correlationCount: 2, errorEvents: 1, warningEvents: 1 }));
    expect(report.health).toEqual(expect.objectContaining({ status: 'critical', issueCount: 2, criticalIssues: 1 }));
    expect(report.memory).toEqual(expect.objectContaining({ nodeCount: 2, edgeCount: 1, expiringNodes: 1 }));
    expect(report.reflection).toEqual(expect.objectContaining({ status: 'blocked', criticalFindings: 1, memoryCandidateCount: 1 }));
    expect(report.recommendations).toEqual(expect.arrayContaining([
      'Address critical health issues before approving additional execution.',
      'Review workflow budget projections before reserving additional agent work.',
      'Review reflection memory candidates manually before persistence.',
    ]));
  });

  it('returns safe empty analytics without optional inputs', () => {
    const report = new PerformanceAnalyticsEngine().build({ generatedAt: 1 });

    expect(report.workflow).toEqual(expect.objectContaining({ active: false, taskCount: 0, averageProgress: 0 }));
    expect(report.health.status).toBe('unknown');
    expect(report.cost.projectedWorkflowCostUsd).toBeNull();
    expect(report.recommendations).toEqual(['No immediate deterministic analytics action is required.']);
  });

  it('bounds trace and cost inputs and reports truncation', () => {
    const traces = Array.from({ length: 1_005 }, (_, index): TraceEvent => ({ id: `t-${index}`, correlationId: `c-${index}`, parentId: null, name: 'event', level: 'info', timestamp: index, attributes: {} }));
    const costs = Array.from({ length: 505 }, () => costEvents()[0]!);
    const report = new PerformanceAnalyticsEngine().build({ traceEvents: traces, costEvents: costs, generatedAt: 1 });

    expect(report.truncated).toBe(true);
    expect(report.traces.totalEvents).toBe(1_000);
  });

  it('rejects invalid timestamps and limits', () => {
    const engine = new PerformanceAnalyticsEngine();
    expect(() => engine.build({ generatedAt: 0 })).toThrow(PerformanceAnalyticsError);
    expect(() => engine.build({ generatedAt: 1, maxTraceEvents: 0 })).toThrow(PerformanceAnalyticsError);
  });
});

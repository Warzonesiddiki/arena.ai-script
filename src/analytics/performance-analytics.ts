import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';
import type { CausalCostEvent } from '../debugging/causal-trace-debugger';
import type { HealthSnapshot } from '../health/orchestration-health-monitor';
import type { AgentMemoryGraphRecord } from '../memory/agent-memory-graph';
import type { TraceEvent } from '../observability/tracer';
import type { PostTaskReflectionReport } from '../reflection/post-task-reflection';

const MAX_TRACE_EVENTS = 1_000;
const MAX_COST_EVENTS = 500;
const MAX_TOP_EVENTS = 20;
const MAX_ROLE_METRICS = 8;
const MAX_RECOMMENDATIONS = 20;
const MAX_KEY_CHARS = 120;

export interface AnalyticsInput {
  orchestration?: OrchestrationServiceSnapshot | null;
  traceEvents?: readonly TraceEvent[];
  costEvents?: readonly CausalCostEvent[];
  health?: HealthSnapshot | null;
  reflection?: PostTaskReflectionReport | null;
  memory?: AgentMemoryGraphRecord | null;
  generatedAt?: number;
  maxTraceEvents?: number;
  maxCostEvents?: number;
}

export interface RoleAnalytics {
  role: string;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  failedTasks: number;
  pendingApprovals: number;
  estimatedCostUsd: number;
  averageProgress: number;
}

export interface CostAnalytics {
  projectedWorkflowCostUsd: number | null;
  actualWorkflowCostUsd: number | null;
  reservedWorkflowCostUsd: number | null;
  blockedCostEvents: number;
  budgetRiskRatio: number | null;
}

export interface TraceAnalytics {
  totalEvents: number;
  eventsByLevel: Readonly<Record<string, number>>;
  eventsByName: readonly { name: string; count: number }[];
  correlationCount: number;
  errorEvents: number;
  warningEvents: number;
  truncated: boolean;
}

export interface HealthAnalytics {
  status: 'healthy' | 'attention' | 'critical' | 'unknown';
  issueCount: number;
  criticalIssues: number;
  warningIssues: number;
  topIssueKinds: readonly { kind: string; count: number }[];
}

export interface MemoryAnalytics {
  nodeCount: number;
  edgeCount: number;
  nodesByKind: Readonly<Record<string, number>>;
  expiringNodes: number;
}

export interface ReflectionAnalytics {
  status: string | null;
  findingCount: number;
  criticalFindings: number;
  recommendationCount: number;
  memoryCandidateCount: number;
  modelReflectionStatus: string | null;
}

export interface PerformanceAnalyticsReport {
  schemaVersion: 1;
  generatedAt: number;
  workflow: {
    active: boolean;
    planId: string | null;
    taskCount: number;
    completedTasks: number;
    blockedTasks: number;
    failedTasks: number;
    pendingApprovals: number;
    averageProgress: number;
  };
  roles: readonly RoleAnalytics[];
  cost: CostAnalytics;
  traces: TraceAnalytics;
  health: HealthAnalytics;
  memory: MemoryAnalytics;
  reflection: ReflectionAnalytics;
  recommendations: readonly string[];
  truncated: boolean;
}

export class PerformanceAnalyticsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PerformanceAnalyticsError';
  }
}

/**
 * Phase 4E deterministic analytics aggregator.
 *
 * It computes bounded metrics from already-scoped traces, orchestration, cost,
 * health, memory, and reflection state. It does not collect new telemetry,
 * persist analytics, access DOM, invoke models, or execute tools.
 */
export class PerformanceAnalyticsEngine {
  public build(input: AnalyticsInput): PerformanceAnalyticsReport {
    const generatedAt = input.generatedAt ?? Date.now();
    if (!Number.isSafeInteger(generatedAt) || generatedAt <= 0) throw new PerformanceAnalyticsError('generatedAt must be a positive safe-integer timestamp.');
    const maxTraceEvents = boundedLimit(input.maxTraceEvents ?? MAX_TRACE_EVENTS, MAX_TRACE_EVENTS, 'maxTraceEvents');
    const maxCostEvents = boundedLimit(input.maxCostEvents ?? MAX_COST_EVENTS, MAX_COST_EVENTS, 'maxCostEvents');
    const traceEvents = [...(input.traceEvents ?? [])].slice(-maxTraceEvents);
    const costEvents = [...(input.costEvents ?? [])].slice(-maxCostEvents);
    const tracesTruncated = (input.traceEvents?.length ?? 0) > traceEvents.length;
    const costsTruncated = (input.costEvents?.length ?? 0) > costEvents.length;

    const workflow = workflowAnalytics(input.orchestration ?? null);
    const roles = roleAnalytics(input.orchestration ?? null);
    const cost = costAnalytics(costEvents, input.health ?? null);
    const traces = traceAnalytics(traceEvents, tracesTruncated);
    const health = healthAnalytics(input.health ?? null);
    const memory = memoryAnalytics(input.memory ?? null, generatedAt);
    const reflection = reflectionAnalytics(input.reflection ?? null);
    const recommendations = analyticsRecommendations({ workflow, cost, traces, health, memory, reflection });

    return {
      schemaVersion: 1,
      generatedAt,
      workflow,
      roles,
      cost,
      traces,
      health,
      memory,
      reflection,
      recommendations,
      truncated: tracesTruncated || costsTruncated,
    };
  }
}

function workflowAnalytics(orchestration: OrchestrationServiceSnapshot | null): PerformanceAnalyticsReport['workflow'] {
  const cards = orchestration?.cards ?? [];
  return {
    active: Boolean(orchestration?.active),
    planId: orchestration?.planId ?? null,
    taskCount: cards.length,
    completedTasks: cards.filter((card) => card.status === 'completed').length,
    blockedTasks: cards.filter((card) => card.status === 'blocked').length,
    failedTasks: cards.filter((card) => card.status === 'failed').length,
    pendingApprovals: cards.filter((card) => card.approvalRequired).length,
    averageProgress: average(cards.map((card) => card.progress)),
  };
}

function roleAnalytics(orchestration: OrchestrationServiceSnapshot | null): readonly RoleAnalytics[] {
  const grouped = new Map<string, NonNullable<OrchestrationServiceSnapshot['cards']>>();
  for (const card of orchestration?.cards ?? []) grouped.set(card.role, [...(grouped.get(card.role) ?? []), card]);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, MAX_ROLE_METRICS)
    .map(([role, cards]) => ({
      role,
      totalTasks: cards.length,
      completedTasks: cards.filter((card) => card.status === 'completed').length,
      blockedTasks: cards.filter((card) => card.status === 'blocked').length,
      failedTasks: cards.filter((card) => card.status === 'failed').length,
      pendingApprovals: cards.filter((card) => card.approvalRequired).length,
      estimatedCostUsd: roundCurrency(cards.reduce((total, card) => total + card.estimatedCostUsd, 0)),
      averageProgress: average(cards.map((card) => card.progress)),
    }));
}

function costAnalytics(events: readonly CausalCostEvent[], health: HealthSnapshot | null): CostAnalytics {
  let projectedWorkflowCostUsd: number | null = null;
  let actualWorkflowCostUsd: number | null = null;
  let reservedWorkflowCostUsd: number | null = null;
  let blockedCostEvents = 0;
  let budgetRiskRatio = health?.metrics.budgetUsageRatio ?? null;

  for (const event of events) {
    const payload = event.payload as unknown as Record<string, unknown>;
    if (typeof payload.projectedWorkflowTotalUsd === 'number') projectedWorkflowCostUsd = Math.max(projectedWorkflowCostUsd ?? 0, payload.projectedWorkflowTotalUsd);
    if (typeof payload.workflowSpentUsd === 'number') actualWorkflowCostUsd = Math.max(actualWorkflowCostUsd ?? 0, payload.workflowSpentUsd);
    if (typeof payload.workflowReservedUsd === 'number') reservedWorkflowCostUsd = Math.max(reservedWorkflowCostUsd ?? 0, payload.workflowReservedUsd);
    if (event.name === 'cost:blocked' || payload.allowed === false) blockedCostEvents += 1;
    if (typeof payload.workflowBudgetUsd === 'number' && payload.workflowBudgetUsd > 0) {
      const usage = typeof payload.projectedWorkflowTotalUsd === 'number'
        ? payload.projectedWorkflowTotalUsd / payload.workflowBudgetUsd
        : typeof payload.workflowSpentUsd === 'number'
          ? payload.workflowSpentUsd / payload.workflowBudgetUsd
          : null;
      if (usage !== null) budgetRiskRatio = Math.max(budgetRiskRatio ?? 0, usage);
    }
  }
  return {
    projectedWorkflowCostUsd: nullableCurrency(projectedWorkflowCostUsd),
    actualWorkflowCostUsd: nullableCurrency(actualWorkflowCostUsd),
    reservedWorkflowCostUsd: nullableCurrency(reservedWorkflowCostUsd),
    blockedCostEvents,
    budgetRiskRatio: budgetRiskRatio === null ? null : roundRatio(budgetRiskRatio),
  };
}

function traceAnalytics(events: readonly TraceEvent[], truncated: boolean): TraceAnalytics {
  const eventsByLevel: Record<string, number> = {};
  const eventsByName = new Map<string, number>();
  const correlations = new Set<string>();
  for (const event of events) {
    eventsByLevel[event.level] = (eventsByLevel[event.level] ?? 0) + 1;
    eventsByName.set(event.name, (eventsByName.get(event.name) ?? 0) + 1);
    correlations.add(event.correlationId);
  }
  return {
    totalEvents: events.length,
    eventsByLevel,
    eventsByName: topNameCounts(eventsByName, MAX_TOP_EVENTS),
    correlationCount: correlations.size,
    errorEvents: eventsByLevel.error ?? 0,
    warningEvents: eventsByLevel.warn ?? 0,
    truncated,
  };
}

function healthAnalytics(health: HealthSnapshot | null): HealthAnalytics {
  if (!health) return { status: 'unknown', issueCount: 0, criticalIssues: 0, warningIssues: 0, topIssueKinds: [] };
  const kinds = new Map<string, number>();
  for (const issue of health.issues) kinds.set(issue.kind, (kinds.get(issue.kind) ?? 0) + 1);
  return {
    status: health.status,
    issueCount: health.issues.length,
    criticalIssues: health.issues.filter((issue) => issue.severity === 'critical').length,
    warningIssues: health.issues.filter((issue) => issue.severity === 'warning').length,
    topIssueKinds: topKindCounts(kinds, MAX_TOP_EVENTS),
  };
}

function memoryAnalytics(memory: AgentMemoryGraphRecord | null, generatedAt: number): MemoryAnalytics {
  if (!memory) return { nodeCount: 0, edgeCount: 0, nodesByKind: {}, expiringNodes: 0 };
  const nodesByKind: Record<string, number> = {};
  for (const node of memory.nodes) nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
  return {
    nodeCount: memory.nodes.length,
    edgeCount: memory.edges.length,
    nodesByKind,
    expiringNodes: memory.nodes.filter((node) => node.expiresAt !== null && node.expiresAt <= generatedAt + 7 * 24 * 60 * 60 * 1000).length,
  };
}

function reflectionAnalytics(reflection: PostTaskReflectionReport | null): ReflectionAnalytics {
  if (!reflection) return { status: null, findingCount: 0, criticalFindings: 0, recommendationCount: 0, memoryCandidateCount: 0, modelReflectionStatus: null };
  return {
    status: reflection.workflow.status,
    findingCount: reflection.findings.length,
    criticalFindings: reflection.findings.filter((finding) => finding.severity === 'critical').length,
    recommendationCount: reflection.recommendations.length,
    memoryCandidateCount: reflection.memoryCandidates.length,
    modelReflectionStatus: reflection.modelReflection.status,
  };
}

function analyticsRecommendations(input: {
  workflow: PerformanceAnalyticsReport['workflow'];
  cost: CostAnalytics;
  traces: TraceAnalytics;
  health: HealthAnalytics;
  memory: MemoryAnalytics;
  reflection: ReflectionAnalytics;
}): readonly string[] {
  const recommendations: string[] = [];
  if (input.health.status === 'critical') recommendations.push('Address critical health issues before approving additional execution.');
  if (input.workflow.pendingApprovals > 0) recommendations.push('Resolve pending approvals in dependency order before progressing the workflow.');
  if ((input.cost.budgetRiskRatio ?? 0) >= 0.8) recommendations.push('Review workflow budget projections before reserving additional agent work.');
  if (input.traces.errorEvents > 0) recommendations.push('Inspect error trace correlations and add regression coverage for repeated failures.');
  if (input.reflection.memoryCandidateCount > 0) recommendations.push('Review reflection memory candidates manually before persistence.');
  if (input.memory.expiringNodes > 0) recommendations.push('Review expiring memory nodes and either refresh or let them expire according to retention policy.');
  if (recommendations.length === 0) recommendations.push('No immediate deterministic analytics action is required.');
  return recommendations.slice(0, MAX_RECOMMENDATIONS);
}

function topNameCounts(map: ReadonlyMap<string, number>, limit: number): Array<{ name: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name: name.slice(0, MAX_KEY_CHARS), count }));
}

function topKindCounts(map: ReadonlyMap<string, number>, limit: number): Array<{ kind: string; count: number }> {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([kind, count]) => ({ kind: kind.slice(0, MAX_KEY_CHARS), count }));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return roundRatio(values.reduce((total, value) => total + value, 0) / values.length);
}

function nullableCurrency(value: number | null): number | null {
  return value === null ? null : roundCurrency(value);
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function boundedLimit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PerformanceAnalyticsError(`${name} must be a positive safe integer.`);
  return Math.min(value, maximum);
}

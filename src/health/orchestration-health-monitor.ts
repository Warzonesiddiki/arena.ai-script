import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';
import type { CausalCostEvent } from '../debugging/causal-trace-debugger';
import type { TraceEvent } from '../observability/tracer';

const PHASE3_MAX_HANDOFFS = 12;
const PHASE3_MAX_ACTIVE_AGENTS = 3;
const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const DEFAULT_HANDOFF_WARNING_RATIO = 0.75;
const DEFAULT_BUDGET_WARNING_RATIO = 0.8;
const MAX_ISSUES = 50;

export type HealthIssueSeverity = 'info' | 'warning' | 'critical';
export type HealthIssueKind = 'stalled-task' | 'handoff-risk' | 'agent-capacity' | 'budget-risk' | 'approval-wait' | 'blocked-task' | 'failed-task';

export interface HealthMonitorOptions {
  stallTimeoutMs?: number;
  handoffWarningRatio?: number;
  budgetWarningRatio?: number;
  maxHandoffs?: number;
  maxActiveAgents?: number;
}

export interface HealthMonitorInput {
  orchestration: OrchestrationServiceSnapshot;
  traceEvents?: readonly TraceEvent[];
  costEvents?: readonly CausalCostEvent[];
  now: number;
}

export interface HealthIssue {
  id: string;
  kind: HealthIssueKind;
  severity: HealthIssueSeverity;
  summary: string;
  taskId: string | null;
  observedAt: number;
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  recommendedAction: string;
}

export interface HealthSnapshot {
  generatedAt: number;
  status: 'healthy' | 'attention' | 'critical';
  issues: readonly HealthIssue[];
  metrics: {
    activeAgents: number;
    handoffs: number;
    maxHandoffs: number;
    handoffUsageRatio: number;
    pendingApprovals: number;
    runningTasks: number;
    blockedTasks: number;
    failedTasks: number;
    budgetUsageRatio: number | null;
  };
}

/**
 * Phase 4D deterministic health monitor.
 *
 * It detects stalled tasks, handoff-limit risk, budget risk, and blocked/failed
 * lifecycle states from existing bounded orchestration, trace, and cost data.
 * It does not perform automatic recovery or launch agents.
 */
export class OrchestrationHealthMonitor {
  private readonly stallTimeoutMs: number;
  private readonly handoffWarningRatio: number;
  private readonly budgetWarningRatio: number;
  private readonly maxHandoffs: number;
  private readonly maxActiveAgents: number;

  public constructor(options: HealthMonitorOptions = {}) {
    this.stallTimeoutMs = positiveInteger(options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS, 'stallTimeoutMs');
    this.handoffWarningRatio = ratio(options.handoffWarningRatio ?? DEFAULT_HANDOFF_WARNING_RATIO, 'handoffWarningRatio');
    this.budgetWarningRatio = ratio(options.budgetWarningRatio ?? DEFAULT_BUDGET_WARNING_RATIO, 'budgetWarningRatio');
    this.maxHandoffs = positiveInteger(options.maxHandoffs ?? PHASE3_MAX_HANDOFFS, 'maxHandoffs');
    this.maxActiveAgents = positiveInteger(options.maxActiveAgents ?? PHASE3_MAX_ACTIVE_AGENTS, 'maxActiveAgents');
  }

  public evaluate(input: HealthMonitorInput): HealthSnapshot {
    if (!Number.isSafeInteger(input.now) || input.now <= 0) throw new OrchestrationHealthMonitorError('now must be a positive safe-integer timestamp.');
    const cards = input.orchestration.cards;
    const traceIndex = buildTaskTraceIndex(input.traceEvents ?? []);
    const issues: HealthIssue[] = [];

    for (const card of cards) {
      if (card.status === 'running') {
        const runningSince = traceIndex.runningSince.get(card.id);
        if (runningSince !== undefined && input.now - runningSince >= this.stallTimeoutMs) {
          issues.push(issue({
            kind: 'stalled-task',
            severity: 'critical',
            taskId: card.id,
            observedAt: input.now,
            summary: `${card.role} task has been running for ${input.now - runningSince}ms, exceeding the ${this.stallTimeoutMs}ms stall threshold.`,
            evidence: { taskId: card.id, role: card.role, runningSince, elapsedMs: input.now - runningSince, stallTimeoutMs: this.stallTimeoutMs },
            recommendedAction: 'Pause additional approvals, inspect the task trace, and require human approval before retrying or terminating the task.',
          }));
        }
      }
      if (card.status === 'blocked') {
        issues.push(issue({
          kind: 'blocked-task',
          severity: 'warning',
          taskId: card.id,
          observedAt: input.now,
          summary: `${card.role} task is blocked${card.approvalBlockedReason ? `: ${card.approvalBlockedReason}` : '.'}`,
          evidence: { taskId: card.id, role: card.role, approvalRequired: card.approvalRequired },
          recommendedAction: 'Resolve the blocker explicitly before approving downstream work.',
        }));
      }
      if (card.status === 'failed') {
        issues.push(issue({
          kind: 'failed-task',
          severity: 'critical',
          taskId: card.id,
          observedAt: input.now,
          summary: `${card.role} task failed: ${card.title}`,
          evidence: { taskId: card.id, role: card.role },
          recommendedAction: 'Review failure traces and add a regression test before retrying.',
        }));
      }
      if (card.approvalRequired && !card.canApprove) {
        issues.push(issue({
          kind: 'approval-wait',
          severity: 'info',
          taskId: card.id,
          observedAt: input.now,
          summary: `${card.role} task is waiting for dependency approval or completion.`,
          evidence: { taskId: card.id, role: card.role, dependencyCount: card.dependsOn.length },
          recommendedAction: 'Approve and complete prerequisite tasks in Planner → Coder → Critic order.',
        }));
      }
    }

    const handoffUsageRatio = input.orchestration.safety.handoffs / this.maxHandoffs;
    if (handoffUsageRatio >= 1) {
      issues.push(issue({
        kind: 'handoff-risk',
        severity: 'critical',
        taskId: null,
        observedAt: input.now,
        summary: `Handoff limit reached (${input.orchestration.safety.handoffs}/${this.maxHandoffs}).`,
        evidence: { handoffs: input.orchestration.safety.handoffs, maxHandoffs: this.maxHandoffs },
        recommendedAction: 'Stop further handoffs and require a human review of the workflow plan.',
      }));
    } else if (handoffUsageRatio >= this.handoffWarningRatio) {
      issues.push(issue({
        kind: 'handoff-risk',
        severity: 'warning',
        taskId: null,
        observedAt: input.now,
        summary: `Handoff usage is high (${input.orchestration.safety.handoffs}/${this.maxHandoffs}).`,
        evidence: { handoffs: input.orchestration.safety.handoffs, maxHandoffs: this.maxHandoffs, usageRatio: roundRatio(handoffUsageRatio) },
        recommendedAction: 'Avoid nonessential handoffs and consolidate next steps before proceeding.',
      }));
    }

    if (input.orchestration.safety.activeAgents >= this.maxActiveAgents) {
      issues.push(issue({
        kind: 'agent-capacity',
        severity: 'warning',
        taskId: null,
        observedAt: input.now,
        summary: `Active agents are at the Phase 3 cap (${input.orchestration.safety.activeAgents}/${this.maxActiveAgents}).`,
        evidence: { activeAgents: input.orchestration.safety.activeAgents, maxActiveAgents: this.maxActiveAgents },
        recommendedAction: 'Wait for an active task to finish before approving more execution.',
      }));
    }

    const budgetUsageRatio = budgetRatio(input.costEvents ?? []);
    if (budgetUsageRatio !== null) {
      if (budgetUsageRatio >= 1) {
        issues.push(issue({
          kind: 'budget-risk',
          severity: 'critical',
          taskId: null,
          observedAt: input.now,
          summary: `Workflow budget is exhausted or exceeded (${Math.round(budgetUsageRatio * 100)}%).`,
          evidence: { budgetUsageRatio: roundRatio(budgetUsageRatio) },
          recommendedAction: 'Do not approve more model/tool work until budget policy is reviewed.',
        }));
      } else if (budgetUsageRatio >= this.budgetWarningRatio) {
        issues.push(issue({
          kind: 'budget-risk',
          severity: 'warning',
          taskId: null,
          observedAt: input.now,
          summary: `Workflow budget usage is elevated (${Math.round(budgetUsageRatio * 100)}%).`,
          evidence: { budgetUsageRatio: roundRatio(budgetUsageRatio) },
          recommendedAction: 'Review cost projections before approving additional tasks.',
        }));
      }
    }

    const deduped = dedupeIssues(issues).slice(0, MAX_ISSUES);
    return {
      generatedAt: input.now,
      status: deduped.some((item) => item.severity === 'critical') ? 'critical' : deduped.length > 0 ? 'attention' : 'healthy',
      issues: deduped,
      metrics: {
        activeAgents: input.orchestration.safety.activeAgents,
        handoffs: input.orchestration.safety.handoffs,
        maxHandoffs: this.maxHandoffs,
        handoffUsageRatio: roundRatio(handoffUsageRatio),
        pendingApprovals: cards.filter((card) => card.approvalRequired).length,
        runningTasks: cards.filter((card) => card.status === 'running').length,
        blockedTasks: cards.filter((card) => card.status === 'blocked').length,
        failedTasks: cards.filter((card) => card.status === 'failed').length,
        budgetUsageRatio: budgetUsageRatio === null ? null : roundRatio(budgetUsageRatio),
      },
    };
  }
}

export class OrchestrationHealthMonitorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OrchestrationHealthMonitorError';
  }
}

interface IssueInput {
  kind: HealthIssueKind;
  severity: HealthIssueSeverity;
  summary: string;
  taskId: string | null;
  observedAt: number;
  evidence: Record<string, string | number | boolean | null>;
  recommendedAction: string;
}

function issue(input: IssueInput): HealthIssue {
  return {
    id: `health:${input.kind}:${input.taskId ?? 'workflow'}`,
    kind: input.kind,
    severity: input.severity,
    summary: input.summary.slice(0, 500),
    taskId: input.taskId,
    observedAt: input.observedAt,
    evidence: sanitizeEvidence(input.evidence),
    recommendedAction: input.recommendedAction.slice(0, 500),
  };
}

function buildTaskTraceIndex(events: readonly TraceEvent[]): { runningSince: Map<string, number> } {
  const runningSince = new Map<string, number>();
  for (const event of [...events].sort((left, right) => left.timestamp - right.timestamp)) {
    const taskId = stringAttribute(event.attributes.taskId);
    const status = stringAttribute(event.attributes.status);
    if (!taskId || !status) continue;
    if (status === 'running') runningSince.set(taskId, event.timestamp);
    if (status === 'completed' || status === 'failed' || status === 'blocked') runningSince.delete(taskId);
  }
  return { runningSince };
}

function budgetRatio(events: readonly CausalCostEvent[]): number | null {
  let ratio: number | null = null;
  for (const event of events) {
    const payload = event.payload as unknown as Record<string, unknown>;
    const budget = typeof payload.workflowBudgetUsd === 'number' ? payload.workflowBudgetUsd : null;
    const projected = typeof payload.projectedWorkflowTotalUsd === 'number' ? payload.projectedWorkflowTotalUsd : null;
    const spent = typeof payload.workflowSpentUsd === 'number' ? payload.workflowSpentUsd : null;
    if (budget && budget > 0) {
      const used = projected ?? spent;
      if (typeof used === 'number') ratio = Math.max(ratio ?? 0, used / budget);
    }
    if (event.name === 'cost:blocked') ratio = Math.max(ratio ?? 0, 1);
  }
  return ratio;
}

function dedupeIssues(issues: readonly HealthIssue[]): HealthIssue[] {
  const byId = new Map<string, HealthIssue>();
  for (const item of issues) {
    const existing = byId.get(item.id);
    if (!existing || severityRank(item.severity) > severityRank(existing.severity)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.id.localeCompare(right.id));
}

function severityRank(severity: HealthIssueSeverity): number {
  return severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0;
}

function sanitizeEvidence(evidence: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key)) continue;
    if (value === null || typeof value === 'boolean') sanitized[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
    else if (typeof value === 'string') sanitized[key] = value.slice(0, 200);
  }
  return sanitized;
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new OrchestrationHealthMonitorError(`${name} must be a positive safe integer.`);
  return value;
}

function ratio(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new OrchestrationHealthMonitorError(`${name} must be in the range (0, 1].`);
  return value;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

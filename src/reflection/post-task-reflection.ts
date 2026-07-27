import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';
import type { AgentMemoryInput, AgentMemoryKind } from '../memory/agent-memory-graph';
import type { CausalRootCause, CausalTraceGraph } from '../debugging/causal-trace-debugger';

const SCHEMA_VERSION = 1;
const MAX_GOAL_CHARS = 400;
const MAX_SUMMARY_CHARS = 800;
const MAX_FINDINGS = 20;
const MAX_RECOMMENDATIONS = 20;
const MAX_MEMORY_CANDIDATES = 5;
const MAX_MODEL_REFLECTION_CHARS = 2_000;

export type ReflectionWorkflowStatus = 'completed' | 'blocked' | 'failed' | 'in-progress' | 'not-started';
export type ReflectionSeverity = 'info' | 'warning' | 'critical';
export type ReflectionRecommendationKind = 'approval' | 'cost' | 'quality' | 'recovery' | 'memory' | 'testing';

export interface ReflectionTaskSummary {
  taskId: string;
  role: string;
  title: string;
  status: string;
  progress: number;
  approvalRequired: boolean;
  blocker: string | null;
}

export interface ReflectionFinding {
  id: string;
  severity: ReflectionSeverity;
  summary: string;
  evidenceNodeIds: readonly string[];
}

export interface ReflectionRecommendation {
  id: string;
  kind: ReflectionRecommendationKind;
  summary: string;
  requiresApproval: boolean;
}

export interface ReflectionMemoryCandidate {
  id: string;
  title: string;
  summary: string;
  kind: AgentMemoryKind;
  tags: readonly string[];
  workflowId: string;
  taskId?: string;
}

export type ModelReflection =
  | { status: 'not-requested' }
  | { status: 'approval-required'; reason: string }
  | { status: 'approved'; content: string; approvedAt: number };

export interface PostTaskReflectionReport {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: number;
  workflow: {
    planId: string | null;
    goal: string | null;
    status: ReflectionWorkflowStatus;
    estimatedCostUsd: number;
  };
  tasks: readonly ReflectionTaskSummary[];
  findings: readonly ReflectionFinding[];
  recommendations: readonly ReflectionRecommendation[];
  memoryCandidates: readonly ReflectionMemoryCandidate[];
  modelReflection: ModelReflection;
}

export interface PostTaskReflectionInput {
  orchestration: OrchestrationServiceSnapshot;
  causalGraph?: CausalTraceGraph | null;
  now?: number;
}

export interface ModelReflectionApproval {
  approvedByHuman: true;
  content: string;
  approvedAt: number;
}

export class PostTaskReflectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PostTaskReflectionError';
  }
}

/**
 * Phase 4C deterministic post-task reflection.
 *
 * It creates a bounded report from orchestration and causal-debugger state. It
 * does not call a model. If model-authored prose is supplied later, it must be
 * explicitly human-approved before it can be attached to the report.
 */
export class PostTaskReflectionBuilder {
  public build(input: PostTaskReflectionInput): PostTaskReflectionReport {
    const generatedAt = input.now ?? Date.now();
    const orchestration = input.orchestration;
    const workflowStatus = determineWorkflowStatus(orchestration);
    const tasks = orchestration.cards.map((card): ReflectionTaskSummary => ({
      taskId: card.id,
      role: card.role,
      title: card.title.slice(0, 160),
      status: card.status,
      progress: card.progress,
      approvalRequired: card.approvalRequired,
      blocker: card.approvalBlockedReason ? card.approvalBlockedReason.slice(0, 240) : null,
    }));
    const rootCauses = input.causalGraph?.rootCauses ?? [];
    const findings = buildFindings(orchestration, rootCauses);
    const recommendations = buildRecommendations(orchestration, findings, input.causalGraph ?? null);
    const memoryCandidates = buildMemoryCandidates(orchestration, findings, workflowStatus);

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      workflow: {
        planId: orchestration.planId,
        goal: orchestration.goal ? orchestration.goal.slice(0, MAX_GOAL_CHARS) : null,
        status: workflowStatus,
        estimatedCostUsd: orchestration.estimatedCostUsd,
      },
      tasks,
      findings,
      recommendations,
      memoryCandidates,
      modelReflection: { status: 'not-requested' },
    };
  }

  public markModelReflectionApprovalRequired(report: PostTaskReflectionReport, reason = 'Model-produced reflection requires explicit human approval.'): PostTaskReflectionReport {
    return cloneReport({ ...report, modelReflection: { status: 'approval-required', reason: reason.slice(0, 240) } });
  }

  public attachApprovedModelReflection(report: PostTaskReflectionReport, approval: ModelReflectionApproval): PostTaskReflectionReport {
    if (approval.approvedByHuman !== true) throw new PostTaskReflectionError('Model reflection content requires explicit human approval.');
    if (!Number.isSafeInteger(approval.approvedAt) || approval.approvedAt <= 0) throw new PostTaskReflectionError('approvedAt must be a positive safe-integer timestamp.');
    const content = sanitizeModelReflectionContent(approval.content);
    return cloneReport({ ...report, modelReflection: { status: 'approved', content, approvedAt: approval.approvedAt } });
  }

  public toMemoryInputs(report: PostTaskReflectionReport, approvedByHuman: true): AgentMemoryInput[] {
    if (approvedByHuman !== true) throw new PostTaskReflectionError('Persisting reflection memory requires explicit human approval.');
    return report.memoryCandidates.map((candidate): AgentMemoryInput => ({
      id: candidate.id,
      title: candidate.title,
      summary: candidate.summary,
      kind: candidate.kind,
      tags: candidate.tags,
      scope: {
        workflowId: candidate.workflowId,
        taskId: candidate.taskId,
      },
      source: { type: 'approved-reflection', approvedByHuman: true },
    }));
  }
}

function determineWorkflowStatus(orchestration: OrchestrationServiceSnapshot): ReflectionWorkflowStatus {
  if (!orchestration.active || orchestration.cards.length === 0) return 'not-started';
  if (orchestration.cards.some((card) => card.status === 'failed')) return 'failed';
  if (orchestration.cards.some((card) => card.status === 'blocked')) return 'blocked';
  if (orchestration.cards.every((card) => card.status === 'completed')) return 'completed';
  return 'in-progress';
}

function buildFindings(orchestration: OrchestrationServiceSnapshot, rootCauses: readonly CausalRootCause[]): ReflectionFinding[] {
  const findings: ReflectionFinding[] = [];
  const blockedTasks = orchestration.cards.filter((card) => card.status === 'blocked');
  const failedTasks = orchestration.cards.filter((card) => card.status === 'failed');
  const pendingApprovals = orchestration.cards.filter((card) => card.approvalRequired);

  for (const task of failedTasks) {
    findings.push({ id: `finding:failed:${task.id}`, severity: 'critical', summary: `${task.role} task failed: ${task.title}`.slice(0, MAX_SUMMARY_CHARS), evidenceNodeIds: [`task:${task.id}`] });
  }
  for (const task of blockedTasks) {
    findings.push({ id: `finding:blocked:${task.id}`, severity: 'warning', summary: `${task.role} task is blocked${task.approvalBlockedReason ? `: ${task.approvalBlockedReason}` : '.'}`.slice(0, MAX_SUMMARY_CHARS), evidenceNodeIds: [`task:${task.id}`] });
  }
  if (pendingApprovals.length > 0) {
    findings.push({
      id: 'finding:pending-approvals',
      severity: 'info',
      summary: `${pendingApprovals.length} task approval${pendingApprovals.length === 1 ? ' is' : 's are'} still required.`,
      evidenceNodeIds: pendingApprovals.map((task) => `task:${task.id}`),
    });
  }
  for (const cause of rootCauses.slice(0, 8)) {
    findings.push({
      id: `finding:root-cause:${safeId(cause.nodeId)}`,
      severity: cause.severity === 'error' ? 'critical' : 'warning',
      summary: cause.summary.slice(0, MAX_SUMMARY_CHARS),
      evidenceNodeIds: [cause.nodeId],
    });
  }
  if (findings.length === 0 && orchestration.active) {
    findings.push({ id: 'finding:no-blockers', severity: 'info', summary: 'No failed or blocked tasks were detected in the approved orchestration state.', evidenceNodeIds: [] });
  }
  return dedupeById(findings).slice(0, MAX_FINDINGS);
}

function buildRecommendations(orchestration: OrchestrationServiceSnapshot, findings: readonly ReflectionFinding[], graph: CausalTraceGraph | null): ReflectionRecommendation[] {
  const recommendations: ReflectionRecommendation[] = [];
  if (orchestration.cards.some((card) => card.approvalRequired)) {
    recommendations.push({ id: 'recommendation:resolve-approvals', kind: 'approval', summary: 'Review pending Planner/Coder/Critic approvals before attempting further lifecycle transitions.', requiresApproval: true });
  }
  if (graph?.rootCauses.some((cause) => cause.severity === 'blocked')) {
    recommendations.push({ id: 'recommendation:inspect-blockers', kind: 'recovery', summary: 'Inspect blocked causal nodes and resolve the earliest cost, dependency, or approval gate first.', requiresApproval: true });
  }
  if (findings.some((finding) => finding.severity === 'critical')) {
    recommendations.push({ id: 'recommendation:add-regression-test', kind: 'testing', summary: 'Add or update a regression test that reproduces the critical failure before retrying the task.', requiresApproval: false });
  }
  if (orchestration.estimatedCostUsd > 0) {
    recommendations.push({ id: 'recommendation:cost-review', kind: 'cost', summary: `Compare estimated workflow cost ($${orchestration.estimatedCostUsd.toFixed(2)}) with actual usage before approving more work.`, requiresApproval: false });
  }
  recommendations.push({ id: 'recommendation:memory-review', kind: 'memory', summary: 'Review reflection memory candidates manually before persisting them to the Agent Memory Graph.', requiresApproval: true });
  return dedupeById(recommendations).slice(0, MAX_RECOMMENDATIONS);
}

function buildMemoryCandidates(orchestration: OrchestrationServiceSnapshot, findings: readonly ReflectionFinding[], status: ReflectionWorkflowStatus): ReflectionMemoryCandidate[] {
  if (!orchestration.active || !orchestration.planId) return [];
  const candidates: ReflectionMemoryCandidate[] = [];
  const notableFindings = findings.filter((finding) => finding.severity !== 'info').slice(0, 3);
  for (const finding of notableFindings) {
    const taskId = finding.evidenceNodeIds.find((id) => id.startsWith('task:'))?.slice('task:'.length);
    candidates.push({
      id: `mem:reflection:${safeId(orchestration.planId)}:${safeId(finding.id)}`,
      title: `Reflection: ${finding.summary}`.slice(0, 160),
      summary: `Workflow ${orchestration.planId} ended ${status}; notable finding: ${finding.summary}`.slice(0, MAX_SUMMARY_CHARS),
      kind: finding.severity === 'critical' ? 'lesson' : 'constraint',
      tags: ['reflection', status, finding.severity],
      workflowId: orchestration.planId,
      taskId,
    });
  }
  if (candidates.length === 0 && status === 'completed') {
    candidates.push({
      id: `mem:reflection:${safeId(orchestration.planId)}:completed`,
      title: 'Reflection: workflow completed without detected blockers',
      summary: `Workflow ${orchestration.planId} completed without failed or blocked task states.`,
      kind: 'lesson',
      tags: ['reflection', 'completed'],
      workflowId: orchestration.planId,
    });
  }
  return candidates.slice(0, MAX_MEMORY_CANDIDATES);
}

function sanitizeModelReflectionContent(content: string): string {
  if (typeof content !== 'string' || !content.trim()) throw new PostTaskReflectionError('Model reflection content must be non-empty text.');
  return content.trim().replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, MAX_MODEL_REFLECTION_CHARS);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/gu, '-').slice(0, 80);
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function cloneReport(report: PostTaskReflectionReport): PostTaskReflectionReport {
  return {
    ...report,
    workflow: { ...report.workflow },
    tasks: report.tasks.map((task) => ({ ...task })),
    findings: report.findings.map((finding) => ({ ...finding, evidenceNodeIds: [...finding.evidenceNodeIds] })),
    recommendations: report.recommendations.map((recommendation) => ({ ...recommendation })),
    memoryCandidates: report.memoryCandidates.map((candidate) => ({ ...candidate, tags: [...candidate.tags] })),
    modelReflection: { ...report.modelReflection },
  };
}

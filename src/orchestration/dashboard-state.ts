import type { AgentPlan, AgentRole, PlanTask, TaskStatus } from './types';

export class OrchestrationTransitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OrchestrationTransitionError';
  }
}

export interface AgentDashboardCard {
  id: string;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  dependsOn: readonly string[];
  estimatedCostUsd: number;
  progress: number;
  approvalRequired: boolean;
  canApprove: boolean;
  approvalBlockedReason: string | null;
}

export interface OrchestrationDashboardSnapshot {
  active: boolean;
  planId: string | null;
  goal: string | null;
  cards: readonly AgentDashboardCard[];
  estimatedCostUsd: number;
}

/**
 * Read-only UI projection plus explicit Phase-3 lifecycle rules.
 *
 * Approval and execution state are deliberately separate: Phase 3E can approve
 * tasks for later work without launching a model, tab, or tool. Running a task
 * still requires all dependencies to have completed.
 */
export class OrchestrationDashboardState {
  private readonly approved = new Set<string>();
  private readonly statuses = new Map<string, TaskStatus>();

  public constructor(private readonly plan: AgentPlan) {
    plan.tasks.forEach((task) => this.statuses.set(task.id, task.status));
  }

  public approve(taskId: string): void {
    const task = this.requireTask(taskId);
    if (this.approved.has(taskId)) return;
    const status = this.currentStatus(taskId);
    if (status === 'blocked' || status === 'failed' || status === 'completed') {
      throw new OrchestrationTransitionError(`Task "${taskId}" cannot be approved from ${status} state.`);
    }
    const blockedReason = this.approvalBlockedReason(task);
    if (blockedReason !== null) throw new OrchestrationTransitionError(blockedReason);
    this.approved.add(taskId);
  }

  public isApproved(taskId: string): boolean {
    this.requireTask(taskId);
    return this.approved.has(taskId);
  }

  public setStatus(taskId: string, status: TaskStatus): void {
    const task = this.requireTask(taskId);
    assertTaskStatus(status);
    const current = this.currentStatus(taskId);
    if (current === status) return;

    if (isTerminal(current)) {
      throw new OrchestrationTransitionError(`Task "${taskId}" cannot transition from terminal state ${current} to ${status}.`);
    }
    if (!allowedNextStatuses(current).includes(status)) {
      throw new OrchestrationTransitionError(`Task "${taskId}" cannot transition from ${current} to ${status}.`);
    }
    if (status === 'running') {
      if (!this.approved.has(taskId)) throw new OrchestrationTransitionError(`Task "${taskId}" requires human approval before it can run.`);
      const incompleteDependency = task.dependsOn.find((dependencyId) => this.currentStatus(dependencyId) !== 'completed');
      if (incompleteDependency) {
        throw new OrchestrationTransitionError(`Task "${taskId}" requires dependency "${incompleteDependency}" to be completed before it can run.`);
      }
    }

    this.statuses.set(taskId, status);
  }

  public cards(): readonly AgentDashboardCard[] {
    return this.plan.tasks.map((task) => {
      const approvalBlockedReason = this.approvalBlockedReason(task);
      const approvalRequired = !this.approved.has(task.id);
      return {
        id: task.id,
        role: task.role,
        title: task.title,
        status: this.currentStatus(task.id),
        dependsOn: task.dependsOn,
        estimatedCostUsd: task.estimatedCostUsd,
        progress: statusProgress(this.currentStatus(task.id)),
        approvalRequired,
        canApprove: approvalRequired && approvalBlockedReason === null && !isTerminal(this.currentStatus(task.id)),
        approvalBlockedReason,
      };
    });
  }

  public totalEstimatedCostUsd(): number {
    return this.plan.tasks.reduce((total, task) => total + task.estimatedCostUsd, 0);
  }

  private approvalBlockedReason(task: PlanTask): string | null {
    for (const dependencyId of task.dependsOn) {
      const dependencyStatus = this.currentStatus(dependencyId);
      if (dependencyStatus === 'failed' || dependencyStatus === 'blocked') {
        return `Task "${task.id}" cannot be approved because dependency "${dependencyId}" is ${dependencyStatus}.`;
      }
      if (!this.approved.has(dependencyId) && dependencyStatus !== 'completed') {
        return `Task "${task.id}" requires dependency "${dependencyId}" to be approved before approval.`;
      }
    }
    return null;
  }

  private currentStatus(taskId: string): TaskStatus {
    this.requireTask(taskId);
    return this.statuses.get(taskId) ?? 'pending';
  }

  private requireTask(taskId: string): PlanTask {
    const task = this.plan.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new OrchestrationTransitionError(`Unknown task "${taskId}".`);
    return task;
  }
}

function statusProgress(status: TaskStatus): number {
  return status === 'completed' ? 1 : status === 'running' ? 0.5 : status === 'failed' || status === 'blocked' ? 1 : 0;
}

function isTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'blocked';
}

function allowedNextStatuses(status: TaskStatus): readonly TaskStatus[] {
  if (status === 'pending') return ['running', 'blocked'];
  if (status === 'running') return ['completed', 'failed', 'blocked'];
  return [];
}

function assertTaskStatus(status: TaskStatus): void {
  if (!['pending', 'running', 'completed', 'failed', 'blocked'].includes(status)) {
    throw new OrchestrationTransitionError(`Unsupported task status "${String(status)}".`);
  }
}

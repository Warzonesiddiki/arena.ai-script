import type { AgentPlan, AgentRole, TaskStatus } from './types';

export interface AgentDashboardCard {
  role: AgentRole;
  status: TaskStatus;
  dependsOn: readonly string[];
  estimatedCostUsd: number;
  progress: number;
  approvalRequired: boolean;
}

/** Read-only UI projection for the Phase 3 Side Panel dashboard. */
export class OrchestrationDashboardState {
  private readonly approved = new Set<string>();
  private readonly statuses = new Map<string, TaskStatus>();
  public constructor(private readonly plan: AgentPlan) {
    plan.tasks.forEach((task) => this.statuses.set(task.id, task.status));
  }

  public approve(taskId: string): void { this.requireTask(taskId); this.approved.add(taskId); }
  public setStatus(taskId: string, status: TaskStatus): void { this.requireTask(taskId); this.statuses.set(taskId, status); }
  public cards(): readonly AgentDashboardCard[] {
    return this.plan.tasks.map((task) => ({
      role: task.role,
      status: this.statuses.get(task.id) ?? 'pending',
      dependsOn: task.dependsOn,
      estimatedCostUsd: task.estimatedCostUsd,
      progress: statusProgress(this.statuses.get(task.id) ?? 'pending'),
      approvalRequired: !this.approved.has(task.id),
    }));
  }
  public totalEstimatedCostUsd(): number { return this.plan.tasks.reduce((total, task) => total + task.estimatedCostUsd, 0); }
  private requireTask(taskId: string): void { if (!this.plan.tasks.some((task) => task.id === taskId)) throw new Error(`Unknown task "${taskId}".`); }
}
function statusProgress(status: TaskStatus): number {
  return status === 'completed' ? 1 : status === 'running' ? 0.5 : status === 'failed' || status === 'blocked' ? 1 : 0;
}

import { CostGovernance } from '../governance/cost-governance';
import { OrchestrationDashboardState, type OrchestrationDashboardSnapshot } from '../orchestration/dashboard-state';
import { DeterministicOrchestrator } from '../orchestration/deterministic-orchestrator';
import type { AgentPlan, TaskStatus } from '../orchestration/types';
import { Tracer } from '../observability/tracer';

export interface OrchestrationServiceOptions {
  costGovernance?: CostGovernance;
  tracer?: Tracer;
  workflowId?: string;
  now?: () => number;
  planIdFactory?: () => string;
}

export interface OrchestrationServiceSnapshot extends OrchestrationDashboardSnapshot {
  safety: { activeAgents: number; handoffs: number };
}

/**
 * Worker-owned Phase 3E orchestration facade.
 *
 * It creates approval-only deterministic plans and records lifecycle telemetry.
 * It does not launch tabs, invoke models, execute tools, or mutate Arena content.
 */
export class OrchestrationService {
  private readonly costs: CostGovernance;
  private readonly tracer: Tracer;
  private readonly workflowId: string;
  private readonly orchestrator: DeterministicOrchestrator;
  private plan: AgentPlan | null = null;
  private dashboard: OrchestrationDashboardState | null = null;

  public constructor(options: OrchestrationServiceOptions = {}) {
    this.costs = options.costGovernance ?? new CostGovernance();
    this.tracer = options.tracer ?? new Tracer();
    this.workflowId = options.workflowId ?? 'phase3-current';
    if (!options.costGovernance) this.costs.configureWorkflow(this.workflowId, { workflowBudgetUsd: 0.5, agentBudgetUsd: 0.3 });
    this.orchestrator = new DeterministicOrchestrator({
      costGovernance: this.costs,
      now: options.now,
      idFactory: options.planIdFactory,
    });
  }

  public create(goal: string): OrchestrationServiceSnapshot {
    this.releaseActiveReservations();
    this.plan = this.orchestrator.createPlan(goal, this.workflowId);
    this.dashboard = new OrchestrationDashboardState(this.plan);
    const snapshot = this.snapshot(false);
    this.tracer.record('orchestration.plan.created', 'info', {
      planId: this.plan.id,
      taskCount: this.plan.tasks.length,
      maxConcurrentAgents: this.plan.maxConcurrentAgents,
      estimatedCostUsd: snapshot.estimatedCostUsd,
    });
    return snapshot;
  }

  public approve(taskId: string): OrchestrationServiceSnapshot {
    this.requireActivePlan();
    this.dashboard!.approve(taskId);
    this.orchestrator.approve(taskId);
    const task = this.plan!.tasks.find((candidate) => candidate.id === taskId)!;
    this.tracer.record('orchestration.task.approved', 'info', {
      planId: this.plan!.id,
      taskId,
      role: task.role,
      status: this.dashboard!.cards().find((card) => card.id === taskId)?.status ?? 'pending',
    });
    return this.snapshot(false);
  }

  public transition(taskId: string, status: TaskStatus): OrchestrationServiceSnapshot {
    this.requireActivePlan();
    this.dashboard!.setStatus(taskId, status);
    const task = this.plan!.tasks.find((candidate) => candidate.id === taskId)!;
    this.tracer.record('orchestration.task.statusChanged', 'info', {
      planId: this.plan!.id,
      taskId,
      role: task.role,
      status,
    });
    return this.snapshot(false);
  }

  public snapshot(trace = true): OrchestrationServiceSnapshot {
    const base = this.dashboard && this.plan
      ? {
        active: true,
        planId: this.plan.id,
        goal: this.plan.goal,
        cards: this.dashboard.cards(),
        estimatedCostUsd: this.dashboard.totalEstimatedCostUsd(),
      }
      : { active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0 };
    const snapshot = { ...base, safety: this.orchestrator.safetySnapshot() };
    if (trace) {
      this.tracer.record('orchestration.status.snapshot', 'debug', {
        active: snapshot.active,
        planId: snapshot.planId,
        taskCount: snapshot.cards.length,
        activeAgents: snapshot.safety.activeAgents,
        handoffs: snapshot.safety.handoffs,
      });
    }
    return snapshot;
  }

  private requireActivePlan(): void {
    if (!this.plan || !this.dashboard) throw new Error('No active orchestration plan.');
  }

  private releaseActiveReservations(): void {
    if (!this.plan) return;
    for (const task of this.plan.tasks) {
      if (task.costReservationId) this.costs.release(task.costReservationId);
    }
  }
}

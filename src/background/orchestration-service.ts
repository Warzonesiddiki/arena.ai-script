import { CostGovernance } from '../governance/cost-governance';
import { OrchestrationDashboardState } from '../orchestration/dashboard-state';
import { DeterministicOrchestrator } from '../orchestration/deterministic-orchestrator';
import type { AgentPlan } from '../orchestration/types';

export class OrchestrationService {
  private readonly costs = new CostGovernance();
  private readonly orchestrator: DeterministicOrchestrator;
  private plan: AgentPlan | null = null;
  private dashboard: OrchestrationDashboardState | null = null;
  public constructor() {
    this.costs.configureWorkflow('phase3-current', { workflowBudgetUsd: 0.5, agentBudgetUsd: 0.3 });
    this.orchestrator = new DeterministicOrchestrator({ costGovernance: this.costs });
  }
  public create(goal: string): ReturnType<OrchestrationService['snapshot']> {
    this.plan = this.orchestrator.createPlan(goal, 'phase3-current');
    this.dashboard = new OrchestrationDashboardState(this.plan);
    return this.snapshot();
  }
  public approve(taskId: string): ReturnType<OrchestrationService['snapshot']> {
    if (!this.plan || !this.dashboard) throw new Error('No active orchestration plan.');
    this.orchestrator.approve(taskId); this.dashboard.approve(taskId); return this.snapshot();
  }
  public snapshot() {
    return this.dashboard && this.plan ? { active: true, goal: this.plan.goal, cards: this.dashboard.cards(), estimatedCostUsd: this.dashboard.totalEstimatedCostUsd() } : { active: false, goal: null, cards: [], estimatedCostUsd: 0 };
  }
}

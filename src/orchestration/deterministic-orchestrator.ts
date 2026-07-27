import { CostGovernance } from '../governance/cost-governance';
import { ContextScopeEngine } from './context-scope';
import { OrchestrationSafetyGuard } from './safety-guard';
import { DEFAULT_CAPABILITY_TIER, tierLimits, type CapabilityTier } from './capability-tier';
import { DeterministicAgentRouter, planTaskToRoutable, type RoutingDecision } from './agent-router';
import type { AgentPlan, AgentRole, PlanTask, ScopedFile, WorkerRequest } from './types';

export interface OrchestratorOptions {
  now?: () => number;
  idFactory?: () => string;
  costGovernance: CostGovernance;
  contextScope?: ContextScopeEngine;
  safety?: OrchestrationSafetyGuard;
  tier?: CapabilityTier;
}

interface TaskTemplate {
  role: AgentRole;
  title: string;
  instruction: (goal: string) => string;
  dependsOn: readonly string[];
  estimatedCostUsd: number;
}

/**
 * Phase 3 template: Planner → Coder → Critic.
 */
const PHASE3_TEMPLATE: readonly TaskTemplate[] = [
  { role: 'planner', title: 'Create implementation plan', instruction: (goal) => `Decompose the approved goal into verifiable steps: ${goal}`, dependsOn: [], estimatedCostUsd: 0.05 },
  { role: 'coder', title: 'Implement approved plan', instruction: (goal) => `Implement the scoped changes for: ${goal}`, dependsOn: ['planner-1'], estimatedCostUsd: 0.25 },
  { role: 'critic', title: 'Review implementation', instruction: (goal) => `Review correctness, safety, and tests for: ${goal}`, dependsOn: ['coder-1'], estimatedCostUsd: 0.10 },
];

/**
 * Phase 6B template: Planner → Researcher → Coder → Executor → Critic.
 *
 * Researcher runs after Planner and feeds Coder; Executor verifies the Coder's
 * output before the Critic reviews. The graph stays a fixed, reviewable DAG —
 * no model chooses the shape.
 */
const PHASE6_TEMPLATE: readonly TaskTemplate[] = [
  { role: 'planner', title: 'Create implementation plan', instruction: (goal) => `Decompose the approved goal into verifiable steps: ${goal}`, dependsOn: [], estimatedCostUsd: 0.05 },
  { role: 'researcher', title: 'Gather scoped background', instruction: (goal) => `Collect only explicitly scoped reference material for: ${goal}`, dependsOn: ['planner-1'], estimatedCostUsd: 0.10 },
  { role: 'coder', title: 'Implement approved plan', instruction: (goal) => `Implement the scoped changes for: ${goal}`, dependsOn: ['planner-1', 'researcher-1'], estimatedCostUsd: 0.25 },
  { role: 'executor', title: 'Run approved verification', instruction: (goal) => `Run the approved verification steps for: ${goal}`, dependsOn: ['coder-1'], estimatedCostUsd: 0.15 },
  { role: 'critic', title: 'Review implementation', instruction: (goal) => `Review correctness, safety, and tests for: ${goal}`, dependsOn: ['executor-1'], estimatedCostUsd: 0.10 },
];

/** Deterministic planner: templated task graph; it never uses an LLM to coordinate agents. */
export class DeterministicOrchestrator {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly contextScope: ContextScopeEngine;
  private readonly safety: OrchestrationSafetyGuard;
  private readonly router: DeterministicAgentRouter;
  public readonly tier: CapabilityTier;

  public constructor(private readonly options: OrchestratorOptions) {
    this.tier = options.tier ?? DEFAULT_CAPABILITY_TIER;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `plan-${Math.random().toString(36).slice(2, 10)}`);
    this.contextScope = options.contextScope ?? new ContextScopeEngine();
    this.safety = options.safety ?? new OrchestrationSafetyGuard({ tier: this.tier });
    this.router = new DeterministicAgentRouter({ tier: this.tier });
  }

  public createPlan(goal: string, workflowId: string): AgentPlan {
    if (!goal.trim()) throw new TypeError('A non-empty goal is required.');
    const template = this.tier === 'phase6' ? PHASE6_TEMPLATE : PHASE3_TEMPLATE;
    const tasks: PlanTask[] = template.map((entry) => ({
      id: `${entry.role}-1`,
      role: entry.role,
      title: entry.title,
      instructions: entry.instruction(goal),
      dependsOn: entry.dependsOn,
      estimatedCostUsd: entry.estimatedCostUsd,
      status: 'pending' as const,
    }));

    tasks.forEach((item) => {
      const decision = this.options.costGovernance.reserve(workflowId, item.role, item.estimatedCostUsd);
      item.costReservationId = decision.reservationId;
      if (!decision.allowed) {
        item.status = 'blocked';
        item.costBlockedReason = decision.reason === 'agent-budget-exceeded' ? 'agent-budget-exceeded' : 'workflow-budget-exceeded';
      }
    });

    return {
      id: this.idFactory(),
      goal: goal.slice(0, 4_000),
      createdAt: this.now(),
      maxConcurrentAgents: tierLimits(this.tier).maxConcurrentAgents,
      tasks,
    };
  }

  public approve(taskId: string): void { this.safety.approve(taskId); }

  /**
   * Proposes a deterministic dispatch order for the plan under current load.
   * It starts nothing; the caller still needs approval to act on the result.
   */
  public route(plan: AgentPlan, approvedTaskIds: ReadonlySet<string>): RoutingDecision {
    return this.router.route({
      tasks: plan.tasks.map((task) => planTaskToRoutable(task, approvedTaskIds.has(task.id))),
      activeAgents: this.safety.snapshot().activeAgents,
    });
  }

  public createWorkerRequest(task: PlanTask, availableFiles: readonly ScopedFile[], requestedPaths: readonly string[]): WorkerRequest {
    this.safety.requireApproval(task.id);
    this.safety.startAgent(`${task.role}:${task.id}`);
    const context = this.contextScope.scope(task.instructions, requestedPaths, availableFiles);
    return { role: task.role, taskId: task.id, task: task.instructions, context, constraints: { maxTokens: 8_000, timeoutMs: 120_000 } };
  }

  public handoff(from: AgentRole, to: AgentRole): void {
    if (from === to) throw new TypeError('Agent handoff requires distinct roles.');
    this.safety.handoff();
  }

  public finish(task: PlanTask): void { this.safety.stopAgent(`${task.role}:${task.id}`); }
  public safetySnapshot(): ReturnType<OrchestrationSafetyGuard['snapshot']> { return this.safety.snapshot(); }
}

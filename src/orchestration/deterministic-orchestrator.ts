import { CostGovernance } from '../governance/cost-governance';
import { ContextScopeEngine } from './context-scope';
import { OrchestrationSafetyGuard } from './safety-guard';
import type { AgentPlan, AgentRole, PlanTask, ScopedContext, ScopedFile, WorkerRequest } from './types';

export interface OrchestratorOptions { now?: () => number; idFactory?: () => string; costGovernance: CostGovernance; contextScope?: ContextScopeEngine; safety?: OrchestrationSafetyGuard; }

/** Deterministic Phase-3 planner: templates task graph; it never uses an LLM to coordinate agents. */
export class DeterministicOrchestrator {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly contextScope: ContextScopeEngine;
  private readonly safety: OrchestrationSafetyGuard;
  public constructor(private readonly options: OrchestratorOptions) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `plan-${Math.random().toString(36).slice(2, 10)}`);
    this.contextScope = options.contextScope ?? new ContextScopeEngine();
    this.safety = options.safety ?? new OrchestrationSafetyGuard();
  }

  public createPlan(goal: string, workflowId: string): AgentPlan {
    if (!goal.trim()) throw new TypeError('A non-empty goal is required.');
    const tasks: PlanTask[] = [
      task('planner', 'Create implementation plan', `Decompose the approved goal into verifiable steps: ${goal}`, [], 0.05),
      task('coder', 'Implement approved plan', `Implement the scoped changes for: ${goal}`, ['planner'], 0.25),
      task('critic', 'Review implementation', `Review correctness, safety, and tests for: ${goal}`, ['coder'], 0.10),
    ];
    tasks.forEach((item) => {
      const decision = this.options.costGovernance.reserve(workflowId, item.role, item.estimatedCostUsd);
      if (!decision.allowed) item.status = 'blocked';
    });
    return { id: this.idFactory(), goal: goal.slice(0, 4_000), createdAt: this.now(), maxConcurrentAgents: 3, tasks };
  }

  public approve(taskId: string): void { this.safety.approve(taskId); }

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

function task(role: AgentRole, title: string, instructions: string, dependsOn: readonly string[], estimatedCostUsd: number): PlanTask {
  return { id: `${role}-1`, role, title, instructions, dependsOn, estimatedCostUsd, status: 'pending' };
}

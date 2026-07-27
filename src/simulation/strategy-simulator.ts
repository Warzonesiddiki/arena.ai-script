import { OrchestrationDashboardState } from '../orchestration/dashboard-state';
import { AdvancedCostController } from '../governance/advanced-cost-controls';
import { RiskPolicyEngine, type ProposedAction } from '../safety/risk-policy-engine';
import { tierLimits, type CapabilityTier } from '../orchestration/capability-tier';
import type { AgentPlan, PlanTask } from '../orchestration/types';

const MAX_STRATEGIES = 10;
const MAX_LABEL_CHARS = 120;

/**
 * Phase 15 what-if simulation and strategy comparison.
 *
 * Answers "what would happen if we ran it this way?" **without running it**.
 * Every projection is computed from the plan's declared metadata and the same
 * deterministic policy, cost, and lifecycle code the real path uses — so a
 * simulation result is a statement about the shipped logic, not a guess.
 *
 * Hard boundaries:
 * - no model is consulted and no tool, tab, or network call occurs;
 * - nothing is approved, scheduled, or persisted;
 * - a simulated approval exists only inside a throwaway in-memory state object.
 *
 * It drives `OrchestrationDashboardState` — the same lifecycle rules the real
 * approval path uses — directly, rather than importing the Phase 14 test
 * harness, so no test-only code reaches the production bundle.
 *
 * Durations are **relative units**, not wall-clock predictions. The simulator
 * has no execution telemetry, so it deliberately refuses to imply it can
 * forecast real time.
 */

export interface SimulationStrategy {
  id: string;
  label: string;
  tier?: CapabilityTier;
  /** Task IDs a human would approve, in order. */
  approvals: readonly string[];
  /** Optional per-task cost overrides for what-if pricing. */
  costOverridesUsd?: Readonly<Record<string, number>>;
}

export interface StrategyRisk {
  policyBlockedTasks: readonly string[];
  approvalRequiredTasks: readonly string[];
  highestRiskLevel: string;
}

export interface StrategyProjection {
  strategyId: string;
  label: string;
  tier: CapabilityTier;
  /** Tasks that could legitimately be dispatched under this strategy. */
  reachableTasks: readonly string[];
  /** Tasks that stay stuck, with the reason. */
  stuckTasks: readonly { taskId: string; reason: string }[];
  totalCostUsd: number;
  /** Dispatch waves under the tier's concurrency cap. */
  waveCount: number;
  /** Relative duration units, NOT wall-clock time. */
  relativeDurationUnits: number;
  completionRatio: number;
  budgetStatus: 'ok' | 'warning' | 'stop';
  withinBudget: boolean;
  risk: StrategyRisk;
  feasible: boolean;
  notes: readonly string[];
}

export interface StrategyComparison {
  planId: string;
  budgetUsd: number;
  projections: readonly StrategyProjection[];
  /** Highest completion at the lowest cost among feasible strategies. */
  recommendedStrategyId: string | null;
  rationale: string;
  /** Always false — a simulation never enacts a strategy. */
  autoApplied: false;
}

export interface SimulatorOptions {
  policy?: RiskPolicyEngine;
  costController?: AdvancedCostController;
}

export class SimulationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

export class StrategySimulator {
  private readonly policy: RiskPolicyEngine;
  private readonly costController: AdvancedCostController;

  public constructor(options: SimulatorOptions = {}) {
    this.policy = options.policy ?? new RiskPolicyEngine();
    this.costController = options.costController ?? new AdvancedCostController();
  }

  public simulate(plan: AgentPlan, strategy: SimulationStrategy, budgetUsd: number, now = 1): StrategyProjection {
    validatePlan(plan);
    validateStrategy(strategy, plan);
    const budget = positiveFinite(budgetUsd, 'budgetUsd');
    const tier = strategy.tier ?? 'phase3';
    const limits = tierLimits(tier);
    const notes: string[] = [];

    const approvals = new Set(strategy.approvals);
    const costOf = (task: PlanTask): number => strategy.costOverridesUsd?.[task.id] ?? task.estimatedCostUsd;

    // Policy pre-check: a task the policy engine would deny is unreachable no
    // matter how the human sequences approvals.
    const policyBlocked: string[] = [];
    let highestRisk = 'none';
    for (const task of plan.tasks) {
      const action: ProposedAction = {
        id: `sim:${task.id}`,
        kind: 'plan-approval',
        role: task.role,
        taskId: task.id,
        summary: `Simulated approval of ${task.id}`,
        estimatedCostUsd: costOf(task),
      };
      const decision = this.policy.evaluate(action);
      if (rankRisk(decision.riskLevel) > rankRisk(highestRisk)) highestRisk = decision.riskLevel;
      if (decision.verdict === 'deny') policyBlocked.push(task.id);
    }

    // Lifecycle simulation through the REAL dashboard rules, on a throwaway
    // state object. Nothing outside this function observes these transitions.
    const reachable = simulateLifecycle(plan, strategy.approvals, policyBlocked);

    const stuck = plan.tasks
      .filter((task) => !reachable.includes(task.id))
      .map((task) => ({
        taskId: task.id,
        reason: policyBlocked.includes(task.id)
          ? 'Policy would deny this task.'
          : task.costBlockedReason !== undefined
            ? 'Blocked by a cost reservation.'
            : approvals.has(task.id)
              ? 'Dependencies never complete under this approval order.'
              : 'Not approved by this strategy.',
      }));

    const totalCostUsd = round(reachable.reduce((total, taskId) => {
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      return total + (task ? costOf(task) : 0);
    }, 0));

    const waves = computeWaves(plan, reachable, limits.maxConcurrentAgents);
    const cost = this.costController.evaluate({
      workflowId: plan.id,
      budgetUsd: budget,
      spentUsd: 0,
      reservedUsd: totalCostUsd,
      now: positiveTimestamp(now, 'now'),
    });

    if (policyBlocked.length > 0) notes.push(`${policyBlocked.length} task(s) would be denied by policy.`);
    if (!cost.stopRecommended && cost.status === 'warning') notes.push('Projected spend crosses the budget warning threshold.');
    if (cost.stopRecommended) notes.push('Projected spend reaches or exceeds the budget.');
    if (waves > 1) notes.push(`Work needs ${waves} dispatch wave(s) at the ${tier} concurrency cap.`);
    notes.push('Relative duration units are a structural estimate, not a wall-clock prediction.');

    const completionRatio = plan.tasks.length === 0 ? 0 : round(reachable.length / plan.tasks.length);
    return {
      strategyId: strategy.id,
      label: strategy.label.slice(0, MAX_LABEL_CHARS),
      tier,
      reachableTasks: reachable.sort(),
      stuckTasks: stuck,
      totalCostUsd,
      waveCount: waves,
      relativeDurationUnits: waves,
      completionRatio,
      budgetStatus: cost.status,
      withinBudget: !cost.stopRecommended,
      risk: {
        policyBlockedTasks: policyBlocked,
        approvalRequiredTasks: plan.tasks.filter((task) => !approvals.has(task.id)).map((task) => task.id),
        highestRiskLevel: highestRisk,
      },
      feasible: reachable.length > 0 && !cost.stopRecommended && policyBlocked.length === 0,
      notes,
    };
  }

  public compare(plan: AgentPlan, strategies: readonly SimulationStrategy[], budgetUsd: number, now = 1): StrategyComparison {
    if (!Array.isArray(strategies) || strategies.length === 0) throw new SimulationError('At least one strategy is required.');
    if (strategies.length > MAX_STRATEGIES) throw new SimulationError(`At most ${MAX_STRATEGIES} strategies can be compared.`);
    const seen = new Set<string>();
    for (const strategy of strategies) {
      if (seen.has(strategy.id)) throw new SimulationError(`Duplicate strategy id "${strategy.id}".`);
      seen.add(strategy.id);
    }

    const projections = strategies.map((strategy) => this.simulate(plan, strategy, budgetUsd, now));

    // Deterministic pick: feasible first, then most complete, then cheapest,
    // then fewest waves, then id. Never a model judgement.
    const ranked = [...projections]
      .filter((projection) => projection.feasible)
      .sort((left, right) => (right.completionRatio - left.completionRatio)
        || (left.totalCostUsd - right.totalCostUsd)
        || (left.waveCount - right.waveCount)
        || left.strategyId.localeCompare(right.strategyId));

    const best = ranked[0] ?? null;
    return {
      planId: plan.id,
      budgetUsd: round(budgetUsd),
      projections,
      recommendedStrategyId: best?.strategyId ?? null,
      rationale: best
        ? `Strategy "${best.strategyId}" completes ${Math.round(best.completionRatio * 100)}% of the plan for $${best.totalCostUsd.toFixed(2)} in ${best.waveCount} wave(s). A human must still approve each task.`
        : 'No simulated strategy is feasible within policy and budget. Re-scope the plan or raise the budget.',
      autoApplied: false,
    };
  }
}

/**
 * Replays a strategy's approval order against the real lifecycle rules.
 *
 * Each approved task is approved then driven running → completed, exactly as
 * the real path advances. A rejected transition is swallowed: it simply means
 * that task does not become reachable under this strategy. Policy-denied tasks
 * are skipped entirely so a simulation can never show progress the policy
 * engine would refuse.
 */
function simulateLifecycle(plan: AgentPlan, approvals: readonly string[], policyBlocked: readonly string[]): string[] {
  const state = new OrchestrationDashboardState(plan);
  for (const taskId of approvals) {
    if (policyBlocked.includes(taskId)) continue;
    if (!plan.tasks.some((task) => task.id === taskId)) continue;
    try {
      state.approve(taskId);
      state.setStatus(taskId, 'running');
      state.setStatus(taskId, 'completed');
    } catch {
      // Not reachable under this approval order; the projection reports why.
    }
  }
  return state.cards()
    .filter((card) => card.status === 'completed' && !policyBlocked.includes(card.id))
    .map((card) => card.id);
}

/** Groups reachable tasks into dependency-respecting waves under a concurrency cap. */
function computeWaves(plan: AgentPlan, reachable: readonly string[], maxConcurrent: number): number {
  const remaining = new Set(reachable);
  const done = new Set<string>();
  let waves = 0;

  while (remaining.size > 0 && waves < 100) {
    const ready = [...remaining].filter((taskId) => {
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      return task ? task.dependsOn.every((dependencyId) => done.has(dependencyId) || !reachable.includes(dependencyId)) : false;
    });
    if (ready.length === 0) break;
    for (const taskId of ready.slice(0, maxConcurrent)) {
      remaining.delete(taskId);
      done.add(taskId);
    }
    waves += 1;
  }
  return waves;
}

function validatePlan(plan: AgentPlan): void {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.tasks)) throw new SimulationError('A plan with tasks is required.');
  if (plan.tasks.length === 0) throw new SimulationError('A plan must contain at least one task.');
}

function validateStrategy(strategy: SimulationStrategy, plan: AgentPlan): void {
  if (!strategy || typeof strategy !== 'object') throw new SimulationError('A strategy is required.');
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(strategy.id ?? '')) throw new SimulationError('Strategy id is invalid.');
  if (typeof strategy.label !== 'string' || strategy.label.trim() === '') throw new SimulationError('Strategy label is required.');
  if (!Array.isArray(strategy.approvals)) throw new SimulationError('Strategy approvals must be an array.');
  for (const taskId of strategy.approvals) {
    if (!plan.tasks.some((task) => task.id === taskId)) throw new SimulationError(`Strategy references unknown task "${String(taskId)}".`);
  }
  for (const [taskId, value] of Object.entries(strategy.costOverridesUsd ?? {})) {
    if (!plan.tasks.some((task) => task.id === taskId)) throw new SimulationError(`Cost override references unknown task "${taskId}".`);
    if (!Number.isFinite(value) || value < 0) throw new SimulationError(`Cost override for "${taskId}" must be a non-negative finite number.`);
  }
}

function rankRisk(level: string): number {
  return ['none', 'low', 'medium', 'high', 'critical'].indexOf(level);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new SimulationError(`${name} must be a positive finite number.`);
  return value;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SimulationError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

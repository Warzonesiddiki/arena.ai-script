import { SimulationError, StrategySimulator, type SimulationStrategy } from '../../../src/simulation/strategy-simulator';
import { RiskPolicyEngine } from '../../../src/safety/risk-policy-engine';
import type { AgentPlan, PlanTask } from '../../../src/orchestration/types';

function task(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'planner-1', role: 'planner', title: 'Plan', instructions: 'plan it',
    dependsOn: [], estimatedCostUsd: 0.05, status: 'pending', ...overrides,
  };
}

function plan(tasks?: PlanTask[]): AgentPlan {
  return {
    id: 'plan-1', goal: 'Ship simulation', createdAt: 1_000, maxConcurrentAgents: 3,
    tasks: tasks ?? [
      task(),
      task({ id: 'coder-1', role: 'coder', title: 'Code', dependsOn: ['planner-1'], estimatedCostUsd: 0.25 }),
      task({ id: 'critic-1', role: 'critic', title: 'Review', dependsOn: ['coder-1'], estimatedCostUsd: 0.10 }),
    ],
  };
}

function strategy(overrides: Partial<SimulationStrategy> = {}): SimulationStrategy {
  return { id: 'full', label: 'Approve everything in order', approvals: ['planner-1', 'coder-1', 'critic-1'], ...overrides };
}

const simulator = new StrategySimulator();

describe('StrategySimulator', () => {
  it('projects a fully approved plan without executing anything', () => {
    const projection = simulator.simulate(plan(), strategy(), 1);

    expect(projection.reachableTasks).toEqual(['coder-1', 'critic-1', 'planner-1']);
    expect(projection.completionRatio).toBe(1);
    expect(projection.totalCostUsd).toBe(0.4);
    expect(projection.feasible).toBe(true);
    expect(projection.withinBudget).toBe(true);
    expect(projection.stuckTasks).toEqual([]);
  });

  it('states plainly that duration is relative, not wall-clock', () => {
    const projection = simulator.simulate(plan(), strategy(), 1);

    // A serial chain needs one wave per task at any concurrency cap.
    expect(projection.waveCount).toBe(3);
    expect(projection.relativeDurationUnits).toBe(3);
    expect(projection.notes.some((note) => note.includes('not a wall-clock prediction'))).toBe(true);
  });

  it('reports tasks left stuck by a partial approval order', () => {
    const projection = simulator.simulate(plan(), strategy({ id: 'partial', approvals: ['planner-1'] }), 1);

    expect(projection.reachableTasks).toEqual(['planner-1']);
    expect(projection.completionRatio).toBeCloseTo(0.333333, 5);
    expect(projection.stuckTasks.map((entry) => entry.taskId)).toEqual(['coder-1', 'critic-1']);
    expect(projection.stuckTasks[0]?.reason).toBe('Not approved by this strategy.');
    expect(projection.totalCostUsd).toBe(0.05);
  });

  it('detects an approval order that can never satisfy dependencies', () => {
    // Approving the critic first cannot work: its dependencies never complete.
    const projection = simulator.simulate(plan(), strategy({ id: 'reversed', approvals: ['critic-1'] }), 1);

    expect(projection.reachableTasks).toEqual([]);
    expect(projection.feasible).toBe(false);
    expect(projection.stuckTasks.find((entry) => entry.taskId === 'critic-1')?.reason).toContain('never complete');
  });

  it('treats a policy denial as structurally unreachable', () => {
    const denyCoder = new RiskPolicyEngine([{
      id: 'no-coder',
      description: 'Deny coder approvals in this simulation',
      order: 1,
      matches: (action) => action.taskId === 'coder-1',
      verdict: 'deny',
      riskLevel: 'critical',
      rationale: 'Coder work is frozen.',
    }]);
    const projection = new StrategySimulator({ policy: denyCoder }).simulate(plan(), strategy(), 1);

    expect(projection.risk.policyBlockedTasks).toEqual(['coder-1']);
    expect(projection.reachableTasks).toEqual(['planner-1']);
    // The critic depends on the denied coder, so it is unreachable too.
    expect(projection.stuckTasks.map((entry) => entry.taskId)).toEqual(['coder-1', 'critic-1']);
    expect(projection.feasible).toBe(false);
    expect(projection.notes.some((note) => note.includes('denied by policy'))).toBe(true);
  });

  it('flags a strategy that would exhaust the budget', () => {
    const projection = simulator.simulate(plan(), strategy(), 0.3);

    expect(projection.budgetStatus).toBe('stop');
    expect(projection.withinBudget).toBe(false);
    expect(projection.feasible).toBe(false);
    expect(projection.notes.some((note) => note.includes('exceeds the budget'))).toBe(true);
  });

  it('supports what-if cost overrides', () => {
    const cheaper = simulator.simulate(plan(), strategy({ id: 'cheap', costOverridesUsd: { 'coder-1': 0.05 } }), 1);

    expect(cheaper.totalCostUsd).toBe(0.2);
    expect(cheaper.feasible).toBe(true);
  });

  it('reflects the concurrency cap of the simulated tier', () => {
    const parallel = plan([
      task({ id: 'planner-1' }),
      task({ id: 'coder-1', role: 'coder' }),
      task({ id: 'critic-1', role: 'critic' }),
      task({ id: 'researcher-1', role: 'researcher' }),
      task({ id: 'executor-1', role: 'executor' }),
    ]);
    const approvals = ['planner-1', 'coder-1', 'critic-1', 'researcher-1', 'executor-1'];

    const phase6 = simulator.simulate(parallel, strategy({ id: 'p6', tier: 'phase6', approvals }), 5);
    // Five independent tasks fit in one wave at the phase6 cap of 5.
    expect(phase6.waveCount).toBe(1);
    expect(phase6.tier).toBe('phase6');

    const phase3Plan = plan([task({ id: 'a-1' }), task({ id: 'b-1', role: 'coder' }), task({ id: 'c-1', role: 'critic' }), task({ id: 'd-1', role: 'coder' })]);
    const phase3 = simulator.simulate(phase3Plan, strategy({ id: 'p3', approvals: ['a-1', 'b-1', 'c-1', 'd-1'] }), 5);
    // Four independent tasks need two waves at the phase3 cap of 3.
    expect(phase3.waveCount).toBe(2);
  });

  it('compares strategies deterministically and recommends without applying', () => {
    const comparison = simulator.compare(plan(), [
      strategy({ id: 'partial', label: 'Planner only', approvals: ['planner-1'] }),
      strategy({ id: 'full', label: 'Everything' }),
    ], 1);

    expect(comparison.autoApplied).toBe(false);
    // Higher completion wins over lower cost.
    expect(comparison.recommendedStrategyId).toBe('full');
    expect(comparison.rationale).toContain('must still approve');
    expect(comparison.projections).toHaveLength(2);

    // Reordering the input does not change the recommendation.
    const reversed = simulator.compare(plan(), [
      strategy({ id: 'full', label: 'Everything' }),
      strategy({ id: 'partial', label: 'Planner only', approvals: ['planner-1'] }),
    ], 1);
    expect(reversed.recommendedStrategyId).toBe('full');
  });

  it('prefers the cheaper strategy when completion ties', () => {
    const comparison = simulator.compare(plan(), [
      strategy({ id: 'pricey', label: 'Pricey', costOverridesUsd: { 'coder-1': 0.4 } }),
      strategy({ id: 'thrifty', label: 'Thrifty', costOverridesUsd: { 'coder-1': 0.1 } }),
    ], 1);

    expect(comparison.recommendedStrategyId).toBe('thrifty');
  });

  it('recommends nothing when no strategy is feasible', () => {
    const comparison = simulator.compare(plan(), [strategy({ id: 'over', label: 'Over budget' })], 0.1);

    expect(comparison.recommendedStrategyId).toBeNull();
    expect(comparison.rationale).toContain('No simulated strategy is feasible');
  });

  it('rejects malformed plans, strategies, and budgets', () => {
    expect(() => simulator.simulate(null as never, strategy(), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate({ ...plan(), tasks: [] }, strategy(), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ id: '../bad' }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ label: '  ' }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ approvals: 'nope' as never }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ approvals: ['ghost-1'] }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ costOverridesUsd: { 'ghost-1': 1 } }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy({ costOverridesUsd: { 'coder-1': -1 } }), 1)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy(), 0)).toThrow(SimulationError);
    expect(() => simulator.simulate(plan(), strategy(), 1, 0)).toThrow(SimulationError);

    expect(() => simulator.compare(plan(), [], 1)).toThrow(SimulationError);
    expect(() => simulator.compare(plan(), [strategy(), strategy()], 1)).toThrow(SimulationError);
    expect(() => simulator.compare(plan(), Array.from({ length: 11 }, (_u, i) => strategy({ id: `s-${i}` })), 1)).toThrow(SimulationError);
  });
});

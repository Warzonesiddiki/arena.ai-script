import { AgentRoutingError, DeterministicAgentRouter, planTaskToRoutable, type RoutableTask } from '../../../src/orchestration/agent-router';
import type { PlanTask } from '../../../src/orchestration/types';

function task(overrides: Partial<RoutableTask> = {}): RoutableTask {
  return {
    id: 'planner-1',
    role: 'planner',
    status: 'pending',
    dependsOn: [],
    approved: true,
    estimatedCostUsd: 0.05,
    ...overrides,
  };
}

describe('DeterministicAgentRouter', () => {
  it('dispatches only approved, dependency-satisfied tasks', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase3' });

    const decision = router.route({
      tasks: [
        task({ id: 'planner-1', status: 'completed' }),
        task({ id: 'coder-1', role: 'coder', dependsOn: ['planner-1'] }),
        task({ id: 'critic-1', role: 'critic', dependsOn: ['coder-1'] }),
        task({ id: 'unapproved-1', role: 'coder', approved: false }),
      ],
    });

    expect(decision.autoDispatch).toBe(false);
    expect(decision.dispatch.map((entry) => entry.taskId)).toEqual(['coder-1']);
    const reasons = Object.fromEntries(decision.deferred.map((entry) => [entry.taskId, entry.reason]));
    expect(reasons).toEqual({
      'planner-1': 'terminal-status',
      'critic-1': 'dependency-incomplete',
      'unapproved-1': 'not-approved',
    });
  });

  it('produces a stable order by depth, then role priority, then cost, then id', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const tasks = [
      task({ id: 'critic-1', role: 'critic' }),
      task({ id: 'executor-1', role: 'executor' }),
      task({ id: 'coder-2', role: 'coder', estimatedCostUsd: 0.3 }),
      task({ id: 'coder-1', role: 'coder', estimatedCostUsd: 0.3 }),
      task({ id: 'researcher-1', role: 'researcher' }),
    ];

    const forward = router.route({ tasks });
    const reversed = router.route({ tasks: [...tasks].reverse() });

    expect(forward.dispatch.map((entry) => entry.taskId)).toEqual(['researcher-1', 'coder-1', 'coder-2', 'executor-1', 'critic-1']);
    // Input order must not change the schedule.
    expect(reversed.dispatch.map((entry) => entry.taskId)).toEqual(forward.dispatch.map((entry) => entry.taskId));
    expect(forward.dispatch.map((entry) => entry.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('orders by dependency depth ahead of role priority', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const decision = router.route({
      tasks: [
        // A critic at depth 0 outranks a researcher at depth 1.
        task({ id: 'critic-1', role: 'critic' }),
        task({ id: 'root-1', role: 'planner', status: 'completed' }),
        task({ id: 'researcher-1', role: 'researcher', dependsOn: ['root-1'] }),
      ],
    });

    expect(decision.dispatch.map((entry) => entry.taskId)).toEqual(['critic-1', 'researcher-1']);
    expect(decision.dispatch.map((entry) => entry.depth)).toEqual([0, 1]);
  });

  it('load balances against the tier cap and active agents', () => {
    const phase3 = new DeterministicAgentRouter({ tier: 'phase3' });
    const five = ['t1', 't2', 't3', 't4', 't5'].map((id) => task({ id, role: 'coder' }));

    const cold = phase3.route({ tasks: five });
    expect(cold.dispatch).toHaveLength(3);
    expect(cold.availableSlots).toBe(3);
    expect(cold.deferred.filter((entry) => entry.reason === 'no-agent-slot')).toHaveLength(2);

    const busy = phase3.route({ tasks: five, activeAgents: 2 });
    expect(busy.dispatch).toHaveLength(1);

    const saturated = phase3.route({ tasks: five, activeAgents: 3 });
    expect(saturated.dispatch).toHaveLength(0);

    const phase6 = new DeterministicAgentRouter({ tier: 'phase6' });
    expect(phase6.route({ tasks: five }).dispatch).toHaveLength(5);
  });

  it('lets an extra ceiling narrow but never widen the tier limit', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const five = ['t1', 't2', 't3', 't4', 't5'].map((id) => task({ id, role: 'coder' }));

    expect(router.route({ tasks: five, maxDispatch: 2 }).dispatch).toHaveLength(2);
    expect(router.route({ tasks: five, maxDispatch: 99 }).dispatch).toHaveLength(5);
    expect(router.route({ tasks: five, maxDispatch: 0 }).dispatch).toHaveLength(0);
  });

  it('defers cost-blocked tasks and tasks with failed dependencies', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const decision = router.route({
      tasks: [
        task({ id: 'failed-1', role: 'coder', status: 'failed' }),
        task({ id: 'downstream-1', role: 'critic', dependsOn: ['failed-1'] }),
        task({ id: 'expensive-1', role: 'coder', costBlocked: true }),
        task({ id: 'running-1', role: 'executor', status: 'running' }),
      ],
    });

    expect(decision.dispatch).toHaveLength(0);
    const reasons = Object.fromEntries(decision.deferred.map((entry) => [entry.taskId, entry.reason]));
    expect(reasons).toEqual({
      'failed-1': 'terminal-status',
      'downstream-1': 'dependency-failed',
      'expensive-1': 'cost-blocked',
      'running-1': 'terminal-status',
    });
  });

  it('reports the cost cause rather than the generic status for a cost-blocked task', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    // A cost-blocked task also carries status 'blocked'. The specific,
    // actionable reason must win over the generic terminal-status message.
    const decision = router.route({
      tasks: [task({ id: 'costly-1', role: 'coder', status: 'blocked', costBlocked: true })],
    });

    expect(decision.deferred[0]?.reason).toBe('cost-blocked');
    expect(decision.deferred[0]?.detail).toContain('cost reservation');
  });

  it('still reports terminal status for a completed or failed task even if cost-blocked', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const decision = router.route({
      tasks: [
        task({ id: 'done-1', role: 'coder', status: 'completed', costBlocked: true }),
        task({ id: 'failed-1', role: 'coder', status: 'failed', costBlocked: true }),
      ],
    });

    expect(decision.deferred.map((entry) => entry.reason)).toEqual(['terminal-status', 'terminal-status']);
  });

  it('rejects phase6 roles at the phase3 tier', () => {
    const phase3 = new DeterministicAgentRouter({ tier: 'phase3' });
    expect(() => phase3.route({ tasks: [task({ id: 'r-1', role: 'researcher' })] })).toThrow(AgentRoutingError);
    expect(() => new DeterministicAgentRouter({ tier: 'phase6' }).route({ tasks: [task({ id: 'r-1', role: 'researcher' })] })).not.toThrow();
  });

  it('rejects malformed task graphs including dependency cycles', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });

    expect(() => router.route({ tasks: [task({ id: '../bad' })] })).toThrow(AgentRoutingError);
    expect(() => router.route({ tasks: [task({ id: 'dup' }), task({ id: 'dup' })] })).toThrow(AgentRoutingError);
    expect(() => router.route({ tasks: [task({ estimatedCostUsd: -1 })] })).toThrow(AgentRoutingError);
    expect(() => router.route({ tasks: [task({ role: 'overlord' as never })] })).toThrow(AgentRoutingError);
    expect(() => router.route({ tasks: [task()], activeAgents: -1 })).toThrow(AgentRoutingError);
    expect(() => router.route({ tasks: [
      task({ id: 'a', dependsOn: ['b'] }),
      task({ id: 'b', dependsOn: ['a'] }),
    ] })).toThrow(/cycle/iu);
  });

  it('ignores dependencies that are not part of the routed graph', () => {
    const router = new DeterministicAgentRouter({ tier: 'phase6' });
    const decision = router.route({ tasks: [task({ id: 'orphan-1', dependsOn: ['not-in-graph'] })] });
    // An unknown dependency has no status, so it is treated as not completed.
    expect(decision.dispatch).toHaveLength(0);
    expect(decision.deferred[0]?.reason).toBe('dependency-incomplete');
  });

  it('adapts a PlanTask into a routable task', () => {
    const planTask: PlanTask = {
      id: 'coder-1',
      role: 'coder',
      title: 'Implement',
      instructions: 'do the work',
      dependsOn: ['planner-1'],
      estimatedCostUsd: 0.25,
      status: 'pending',
      costBlockedReason: 'workflow-budget-exceeded',
    };

    expect(planTaskToRoutable(planTask, true)).toEqual(expect.objectContaining({ id: 'coder-1', approved: true, costBlocked: true }));
    expect(planTaskToRoutable({ ...planTask, costBlockedReason: undefined }, false)).toEqual(expect.objectContaining({ approved: false, costBlocked: false }));
  });
});

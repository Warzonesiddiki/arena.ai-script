import { AgentBehaviorHarness, BehaviorHarnessError, type BehaviorScenario } from '../../../src/testing/agent-behavior-harness';
import type { AgentPlan, PlanTask } from '../../../src/orchestration/types';

function task(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: 'planner-1',
    role: 'planner',
    title: 'Plan',
    instructions: 'plan it',
    dependsOn: [],
    estimatedCostUsd: 0.05,
    status: 'pending',
    ...overrides,
  };
}

function plan(tasks?: PlanTask[]): AgentPlan {
  return {
    id: 'plan-1',
    goal: 'Ship the harness',
    createdAt: 1_000,
    maxConcurrentAgents: 3,
    tasks: tasks ?? [
      task(),
      task({ id: 'coder-1', role: 'coder', title: 'Code', dependsOn: ['planner-1'], estimatedCostUsd: 0.25 }),
      task({ id: 'critic-1', role: 'critic', title: 'Review', dependsOn: ['coder-1'], estimatedCostUsd: 0.1 }),
    ],
  };
}

const harness = new AgentBehaviorHarness();

describe('AgentBehaviorHarness', () => {
  it('runs a golden happy-path scenario against the real lifecycle rules', () => {
    const scenario: BehaviorScenario = {
      id: 'happy-path',
      description: 'Planner → Coder → Critic completes in dependency order',
      plan: plan(),
      actions: [
        { type: 'approve', taskId: 'planner-1' },
        { type: 'route' },
        { type: 'expect-dispatch', taskIds: ['planner-1'] },
        { type: 'transition', taskId: 'planner-1', status: 'running' },
        { type: 'transition', taskId: 'planner-1', status: 'completed' },
        { type: 'approve', taskId: 'coder-1' },
        { type: 'route' },
        { type: 'expect-dispatch', taskIds: ['coder-1'] },
        { type: 'transition', taskId: 'coder-1', status: 'running' },
        { type: 'transition', taskId: 'coder-1', status: 'completed' },
        { type: 'expect-status', taskId: 'coder-1', status: 'completed' },
      ],
    };

    const result = harness.run(scenario);

    expect(result.passed).toBe(true);
    expect(result.failureSummary).toBeNull();
    expect(result.finalStatuses).toEqual({ 'planner-1': 'completed', 'coder-1': 'completed', 'critic-1': 'pending' });
    // The digest is stable, so it can be pinned as a golden value.
    expect(harness.run(scenario).goldenDigest).toBe(result.goldenDigest);
  });

  it('proves an unapproved task can never be dispatched or run', () => {
    const result = harness.run({
      id: 'approval-required',
      description: 'Running without approval is refused',
      plan: plan(),
      actions: [
        { type: 'route' },
        { type: 'expect-dispatch', taskIds: [] },
        { type: 'transition', taskId: 'planner-1', status: 'running' },
        { type: 'expect-error', contains: 'requires human approval' },
        { type: 'expect-status', taskId: 'planner-1', status: 'pending' },
      ],
    });

    expect(result.passed).toBe(true);
  });

  it('proves dependency order is enforced', () => {
    const result = harness.run({
      id: 'dependency-order',
      description: 'Coder cannot be approved before Planner',
      plan: plan(),
      actions: [
        { type: 'approve', taskId: 'coder-1' },
        { type: 'expect-error', contains: 'planner-1' },
        { type: 'approve', taskId: 'planner-1' },
        { type: 'approve', taskId: 'coder-1' },
        { type: 'route' },
        // Planner is approved but not completed, so Coder is still deferred.
        { type: 'expect-dispatch', taskIds: ['planner-1'] },
      ],
    });

    expect(result.passed).toBe(true);
  });

  it('fails a scenario whose expectation does not hold, and reports the step', () => {
    const result = harness.run({
      id: 'wrong-expectation',
      description: 'Deliberately wrong dispatch expectation',
      plan: plan(),
      actions: [
        { type: 'approve', taskId: 'planner-1' },
        { type: 'route' },
        { type: 'expect-dispatch', taskIds: ['coder-1'] },
        { type: 'expect-status', taskId: 'planner-1', status: 'completed' },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failureSummary).toContain('Step 3');
    expect(result.failureSummary).toContain('Expected dispatch [coder-1]');
    // Execution stops at the first failure.
    expect(result.steps).toHaveLength(3);
  });

  it('fails when an expected error never occurs', () => {
    const result = harness.run({
      id: 'missing-error',
      description: 'expect-error after a successful step',
      plan: plan(),
      actions: [
        { type: 'approve', taskId: 'planner-1' },
        { type: 'expect-error' },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failureSummary).toContain('Expected the previous step to fail');
  });

  it('fails on an unconsumed trailing error rather than silently passing', () => {
    const result = harness.run({
      id: 'trailing-error',
      description: 'A rejected final action must not pass unnoticed',
      plan: plan(),
      actions: [{ type: 'transition', taskId: 'planner-1', status: 'running' }],
    });

    expect(result.passed).toBe(false);
    expect(result.failureSummary).toContain('Unhandled error after the final step');
  });

  it('fails when an expected error message does not match', () => {
    const result = harness.run({
      id: 'wrong-error',
      description: 'Mismatched error text',
      plan: plan(),
      actions: [
        { type: 'transition', taskId: 'planner-1', status: 'running' },
        { type: 'expect-error', contains: 'budget' },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failureSummary).toContain('Expected error containing "budget"');
  });

  it('simulates the phase6 tier with expanded roles', () => {
    const result = harness.run({
      id: 'phase6-roles',
      description: 'Researcher and Executor route at the phase6 tier',
      tier: 'phase6',
      plan: plan([
        task({ id: 'researcher-1', role: 'researcher', title: 'Research' }),
        task({ id: 'executor-1', role: 'executor', title: 'Verify' }),
      ]),
      actions: [
        { type: 'approve', taskId: 'researcher-1' },
        { type: 'approve', taskId: 'executor-1' },
        { type: 'route' },
        // Role priority puts researcher ahead of executor.
        { type: 'expect-dispatch', taskIds: ['researcher-1', 'executor-1'] },
      ],
    });

    expect(result.passed).toBe(true);
  });

  it('surfaces a routing rejection for a role outside the active tier', () => {
    const result = harness.run({
      id: 'tier-violation',
      description: 'Researcher is refused at the default phase3 tier',
      plan: plan([task({ id: 'researcher-1', role: 'researcher', title: 'Research' })]),
      actions: [
        { type: 'approve', taskId: 'researcher-1' },
        { type: 'route' },
        { type: 'expect-error', contains: 'not permitted at capability tier' },
      ],
    });

    expect(result.passed).toBe(true);
  });

  it('aggregates a suite and lists every failure', () => {
    const suite = harness.runSuite([
      { id: 'ok-1', description: 'passes', plan: plan(), actions: [{ type: 'expect-status', taskId: 'planner-1', status: 'pending' }] },
      { id: 'bad-1', description: 'fails', plan: plan(), actions: [{ type: 'expect-status', taskId: 'planner-1', status: 'completed' }] },
    ]);

    expect(suite).toEqual(expect.objectContaining({ passed: false, total: 2, passedCount: 1, failedCount: 1 }));
    expect(suite.failures[0]).toContain('bad-1');
  });

  it('rejects malformed scenarios and suites', () => {
    expect(() => harness.run({ id: '../bad', description: '', plan: plan(), actions: [] })).toThrow(BehaviorHarnessError);
    expect(() => harness.run({ id: 'no-tasks', description: '', plan: { ...plan(), tasks: [] }, actions: [] })).toThrow(BehaviorHarnessError);
    expect(() => harness.run({ id: 'no-actions', description: '', plan: plan(), actions: null as never })).toThrow(BehaviorHarnessError);
    expect(() => harness.run({ id: 'too-long', description: '', plan: plan(), actions: Array.from({ length: 101 }, () => ({ type: 'route' as const })) })).toThrow(BehaviorHarnessError);
    expect(() => harness.runSuite('nope' as never)).toThrow(BehaviorHarnessError);
    expect(() => harness.runSuite([
      { id: 'dup', description: '', plan: plan(), actions: [] },
      { id: 'dup', description: '', plan: plan(), actions: [] },
    ])).toThrow(BehaviorHarnessError);

    const unknown = harness.run({ id: 'unknown-action', description: '', plan: plan(), actions: [{ type: 'teleport' } as never] });
    expect(unknown.passed).toBe(false);
    expect(unknown.failureSummary).toContain('Unsupported action');
  });
});

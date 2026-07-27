import { CostGovernance } from '../../../src/governance/cost-governance';
import { DeterministicOrchestrator } from '../../../src/orchestration/deterministic-orchestrator';
import { OrchestrationSafetyGuard, SafetyViolation } from '../../../src/orchestration/safety-guard';
import type { AgentPlan } from '../../../src/orchestration/types';

/**
 * Coverage for the deterministic orchestrator's tier, routing, cost-gate, and
 * agent-lifecycle paths.
 *
 * This is product principle #1 — orchestration is code, never LLM-directed — so
 * its Phase 6 template, router integration, and safety interplay deserve direct
 * tests rather than being exercised only incidentally.
 */

function governance(workflowBudgetUsd = 5, agentBudgetUsd = 5): CostGovernance {
  let counter = 0;
  const costs = new CostGovernance({ idFactory: () => `r-${counter++}` });
  costs.configureWorkflow('wf', { workflowBudgetUsd, agentBudgetUsd });
  return costs;
}

function orchestrator(options: { tier?: 'phase3' | 'phase6'; costs?: CostGovernance; safety?: OrchestrationSafetyGuard } = {}) {
  return new DeterministicOrchestrator({
    costGovernance: options.costs ?? governance(),
    now: () => 10,
    idFactory: () => 'plan-1',
    ...(options.tier ? { tier: options.tier } : {}),
    ...(options.safety ? { safety: options.safety } : {}),
  });
}

function approvedIds(plan: AgentPlan, ...ids: string[]): ReadonlySet<string> {
  const known = new Set(plan.tasks.map((task) => task.id));
  for (const id of ids) if (!known.has(id)) throw new Error(`test referenced unknown task ${id}`);
  return new Set(ids);
}

describe('DeterministicOrchestrator capability tiers', () => {
  it('defaults to the Phase 3 three-role template', () => {
    const plan = orchestrator().createPlan('Add validation', 'wf');

    expect(plan.maxConcurrentAgents).toBe(3);
    expect(plan.tasks.map((task) => task.role)).toEqual(['planner', 'coder', 'critic']);
    expect(plan.tasks.map((task) => task.id)).toEqual(['planner-1', 'coder-1', 'critic-1']);
  });

  it('builds the Phase 6 five-role DAG in a fixed, reviewable shape', () => {
    const plan = orchestrator({ tier: 'phase6' }).createPlan('Ship the feature', 'wf');

    expect(plan.maxConcurrentAgents).toBe(5);
    expect(plan.tasks.map((task) => task.role)).toEqual(['planner', 'researcher', 'coder', 'executor', 'critic']);
    // The dependency graph is declared by template, never chosen by a model.
    expect(plan.tasks.find((task) => task.id === 'researcher-1')?.dependsOn).toEqual(['planner-1']);
    expect(plan.tasks.find((task) => task.id === 'coder-1')?.dependsOn).toEqual(['planner-1', 'researcher-1']);
    expect(plan.tasks.find((task) => task.id === 'executor-1')?.dependsOn).toEqual(['coder-1']);
    expect(plan.tasks.find((task) => task.id === 'critic-1')?.dependsOn).toEqual(['executor-1']);
  });

  it('produces byte-identical plans for the same goal', () => {
    const first = orchestrator().createPlan('Repeatable goal', 'wf');
    const second = orchestrator().createPlan('Repeatable goal', 'wf');

    // Determinism is the whole point: same input, same plan.
    const strip = (plan: AgentPlan) => plan.tasks.map(({ costReservationId: _id, ...rest }) => rest);
    expect(strip(second)).toEqual(strip(first));
  });

  it('embeds the goal in every task instruction and bounds its length', () => {
    const plan = orchestrator().createPlan('x'.repeat(5_000), 'wf');

    expect(plan.goal).toHaveLength(4_000);
    for (const task of plan.tasks) expect(task.instructions).toContain('xxx');
  });

  it('rejects an empty goal', () => {
    expect(() => orchestrator().createPlan('   ', 'wf')).toThrow(TypeError);
  });
});

describe('DeterministicOrchestrator cost gating', () => {
  it('blocks tasks that exceed the workflow budget and records why', () => {
    // A 0.1 budget cannot cover the 0.05 + 0.25 + 0.10 Phase 3 template.
    const plan = orchestrator({ costs: governance(0.1, 0.1) }).createPlan('Expensive work', 'wf');

    const coder = plan.tasks.find((task) => task.id === 'coder-1');
    expect(coder?.status).toBe('blocked');
    expect(coder?.costBlockedReason).toBe('workflow-budget-exceeded');
    expect(coder?.costReservationId).toBeNull();
    // The cheap planner still fits.
    expect(plan.tasks.find((task) => task.id === 'planner-1')?.status).toBe('pending');
  });

  it('distinguishes a per-agent budget breach from a workflow breach', () => {
    const plan = orchestrator({ costs: governance(10, 0.2) }).createPlan('Agent capped', 'wf');

    const coder = plan.tasks.find((task) => task.id === 'coder-1');
    expect(coder?.status).toBe('blocked');
    expect(coder?.costBlockedReason).toBe('agent-budget-exceeded');
  });

  it('reserves a cost id for every task that fits the budget', () => {
    const plan = orchestrator().createPlan('Affordable', 'wf');

    for (const task of plan.tasks) {
      expect(task.status).toBe('pending');
      expect(typeof task.costReservationId).toBe('string');
    }
  });
});

describe('DeterministicOrchestrator routing', () => {
  it('routes only approved, dependency-ready tasks and never auto-dispatches', () => {
    const instance = orchestrator();
    const plan = instance.createPlan('Route me', 'wf');

    const nothingApproved = instance.route(plan, approvedIds(plan));
    expect(nothingApproved.autoDispatch).toBe(false);
    expect(nothingApproved.dispatch).toEqual([]);
    expect(nothingApproved.deferred.map((entry) => entry.reason)).toContain('not-approved');

    const plannerApproved = instance.route(plan, approvedIds(plan, 'planner-1', 'coder-1'));
    // Coder is approved but its dependency has not completed.
    expect(plannerApproved.dispatch.map((entry) => entry.taskId)).toEqual(['planner-1']);
    expect(plannerApproved.deferred.find((entry) => entry.taskId === 'coder-1')?.reason).toBe('dependency-incomplete');
  });

  it('reports cost-blocked tasks as deferred rather than dispatchable', () => {
    const instance = orchestrator({ costs: governance(0.06, 0.06) });
    const plan = instance.createPlan('Mostly blocked', 'wf');

    const decision = instance.route(plan, approvedIds(plan, 'planner-1', 'coder-1', 'critic-1'));
    expect(decision.deferred.find((entry) => entry.taskId === 'coder-1')?.reason).toBe('cost-blocked');
  });

  it('shrinks available slots as agents become active', () => {
    const instance = orchestrator({ tier: 'phase6' });
    const plan = instance.createPlan('Parallel work', 'wf');
    instance.approve('planner-1');

    expect(instance.route(plan, approvedIds(plan, 'planner-1')).availableSlots).toBe(5);
    instance.createWorkerRequest(plan.tasks[0]!, [], []);
    // One agent is now running, so the router offers one fewer slot.
    expect(instance.route(plan, approvedIds(plan, 'planner-1')).availableSlots).toBe(4);
  });

  it('routes the Phase 6 template at the raised concurrency cap', () => {
    const instance = orchestrator({ tier: 'phase6' });
    const plan = instance.createPlan('Wide plan', 'wf');

    expect(instance.route(plan, approvedIds(plan, 'planner-1')).maxConcurrentAgents).toBe(5);
  });
});

describe('DeterministicOrchestrator agent lifecycle', () => {
  it('requires approval before a worker request and frees the slot on finish', () => {
    const instance = orchestrator();
    const plan = instance.createPlan('Lifecycle', 'wf');
    const planner = plan.tasks[0]!;

    expect(() => instance.createWorkerRequest(planner, [], [])).toThrow(SafetyViolation);
    expect(instance.safetySnapshot().activeAgents).toBe(0);

    instance.approve(planner.id);
    const request = instance.createWorkerRequest(planner, [], []);
    expect(request.constraints).toEqual({ maxTokens: 8_000, timeoutMs: 120_000 });
    expect(request.role).toBe('planner');
    expect(instance.safetySnapshot().activeAgents).toBe(1);

    instance.finish(planner);
    expect(instance.safetySnapshot().activeAgents).toBe(0);
  });

  it('never lets concurrent agents exceed the active tier cap', () => {
    const instance = orchestrator();
    const plan = instance.createPlan('Crowded', 'wf');
    for (const task of plan.tasks) {
      instance.approve(task.id);
      instance.createWorkerRequest(task, [], []);
    }
    expect(instance.safetySnapshot().activeAgents).toBe(3);

    // A fourth distinct agent breaches the Phase 3 cap.
    const extra = { ...plan.tasks[0]!, id: 'planner-2' };
    instance.approve(extra.id);
    expect(() => instance.createWorkerRequest(extra, [], [])).toThrow(SafetyViolation);
  });

  it('counts handoffs and rejects a self-handoff', () => {
    const instance = orchestrator();

    expect(() => instance.handoff('planner', 'planner')).toThrow(TypeError);
    // A rejected self-handoff must not consume budget.
    expect(instance.safetySnapshot().handoffs).toBe(0);

    instance.handoff('planner', 'coder');
    expect(instance.safetySnapshot().handoffs).toBe(1);
  });

  it('honours an injected safety guard with tightened limits', () => {
    const instance = orchestrator({ safety: new OrchestrationSafetyGuard({ tier: 'phase3', maxAgents: 1, maxHandoffs: 1 }) });
    const plan = instance.createPlan('Tight', 'wf');

    instance.approve('planner-1');
    instance.approve('coder-1');
    instance.createWorkerRequest(plan.tasks[0]!, [], []);
    expect(() => instance.createWorkerRequest(plan.tasks[1]!, [], [])).toThrow(SafetyViolation);

    instance.handoff('planner', 'coder');
    expect(() => instance.handoff('coder', 'critic')).toThrow(SafetyViolation);
  });

  it('scopes worker context to explicitly requested files only', () => {
    const instance = orchestrator();
    const plan = instance.createPlan('Scoped', 'wf');
    instance.approve('planner-1');

    const request = instance.createWorkerRequest(
      plan.tasks[0]!,
      [{ path: 'src/a.ts', content: 'alpha' }, { path: 'src/secret.ts', content: 'classified' }],
      ['src/a.ts'],
    );

    // A file that was not requested must never appear in scoped context.
    expect(request.context.files).toEqual([{ path: 'src/a.ts', content: 'alpha' }]);
    expect(JSON.stringify(request)).not.toContain('classified');
    expect(request.context.snapshotId).toMatch(/^scope-/u);
  });
});

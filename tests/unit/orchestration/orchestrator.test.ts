import { CostGovernance } from '../../../src/governance/cost-governance';
import { ContextScopeEngine } from '../../../src/orchestration/context-scope';
import { DeterministicOrchestrator } from '../../../src/orchestration/deterministic-orchestrator';
import { OrchestrationSafetyGuard, SafetyViolation } from '../../../src/orchestration/safety-guard';

describe('Phase 3 deterministic orchestrator', () => {
  function create() {
    const costs = new CostGovernance({ idFactory: () => `r-${Math.random()}` });
    costs.configureWorkflow('workflow:one', { workflowBudgetUsd: 0.5, agentBudgetUsd: 0.3 });
    return new DeterministicOrchestrator({ costGovernance: costs, now: () => 10, idFactory: () => 'plan-1' });
  }
  it('creates a human-readable fixed-role plan and blocks it through cost gates', () => {
    const orchestrator = create();
    const plan = orchestrator.createPlan('Add validation', 'workflow:one');
    expect(plan).toEqual(expect.objectContaining({ id: 'plan-1', maxConcurrentAgents: 3 }));
    expect(plan.tasks.map((task) => task.role)).toEqual(['planner', 'coder', 'critic']);
    expect(plan.tasks.find((task) => task.role === 'coder')?.dependsOn).toEqual(['planner']);
  });
  it('scopes files and enforces three agents/twelve handoffs', () => {
    const orchestrator = create();
    const plan = orchestrator.createPlan('Fix parser', 'workflow:one');
    expect(() => orchestrator.createWorkerRequest(plan.tasks[0]!, [], [])).toThrow(SafetyViolation);
    orchestrator.approve(plan.tasks[0]!.id);
    const request = orchestrator.createWorkerRequest(plan.tasks[0]!, [{ path: 'src/a.ts', content: 'x'.repeat(20) }], ['src/a.ts']);
    expect(request.context).toEqual(expect.objectContaining({ files: [{ path: 'src/a.ts', content: 'x'.repeat(20) }] }));
    for (let index = 0; index < 12; index += 1) orchestrator.handoff('planner', 'coder');
    expect(() => orchestrator.handoff('coder', 'critic')).toThrow(SafetyViolation);
  });
  it('truncates scoped context instead of accepting all requested files', () => {
    const scope = new ContextScopeEngine({ maxFiles: 1, maxCharsPerFile: 3 });
    expect(scope.scope('goal', ['a', 'b'], [{ path: 'a', content: 'abcd' }, { path: 'b', content: 'data' }]))
      .toEqual(expect.objectContaining({ truncated: true, files: [{ path: 'a', content: 'abc' }] }));
  });
});

import { OrchestrationDashboardState, OrchestrationTransitionError } from '../../../src/orchestration/dashboard-state';
import type { AgentPlan } from '../../../src/orchestration/types';

const plan: AgentPlan = { id: 'p', goal: 'goal', createdAt: 1, maxConcurrentAgents: 3, tasks: [
  { id: 'planner-1', role: 'planner', title: 'Plan', instructions: 'plan', dependsOn: [], estimatedCostUsd: 0.05, status: 'pending' },
  { id: 'coder-1', role: 'coder', title: 'Code', instructions: 'code', dependsOn: ['planner-1'], estimatedCostUsd: 0.25, status: 'pending' },
  { id: 'critic-1', role: 'critic', title: 'Review', instructions: 'review', dependsOn: ['coder-1'], estimatedCostUsd: 0.1, status: 'pending' },
] };

describe('OrchestrationDashboardState', () => {
  it('projects role status, approval, progress, task ids, and bounded estimated cost', () => {
    const state = new OrchestrationDashboardState(plan);
    state.approve('planner-1');
    state.setStatus('planner-1', 'running');
    state.setStatus('planner-1', 'completed');

    expect(state.cards()[0]).toEqual(expect.objectContaining({ id: 'planner-1', role: 'planner', progress: 1, approvalRequired: false }));
    expect(state.cards()[1]).toEqual(expect.objectContaining({ dependsOn: ['planner-1'], approvalRequired: true, canApprove: true }));
    expect(state.totalEstimatedCostUsd()).toBeCloseTo(0.4);
  });

  it('requires planner approval before coder approval and coder approval before critic approval', () => {
    const state = new OrchestrationDashboardState(plan);

    expect(() => state.approve('coder-1')).toThrow(OrchestrationTransitionError);
    state.approve('planner-1');
    state.approve('coder-1');
    expect(() => state.approve('critic-1')).not.toThrow();
  });

  it('requires completed dependencies before a dependent task can run', () => {
    const state = new OrchestrationDashboardState(plan);
    state.approve('planner-1');
    state.approve('coder-1');

    expect(() => state.setStatus('coder-1', 'running')).toThrow(/planner-1/u);
    state.setStatus('planner-1', 'running');
    state.setStatus('planner-1', 'completed');
    expect(() => state.setStatus('coder-1', 'running')).not.toThrow();
  });

  it('prevents invalid and terminal status transitions', () => {
    const state = new OrchestrationDashboardState(plan);

    expect(() => state.setStatus('planner-1', 'completed')).toThrow(OrchestrationTransitionError);
    expect(() => state.setStatus('planner-1', 'running')).toThrow(/approval/u);
    state.approve('planner-1');
    state.setStatus('planner-1', 'running');
    state.setStatus('planner-1', 'failed');
    expect(() => state.setStatus('planner-1', 'completed')).toThrow(/terminal/u);
    expect(() => state.approve('coder-1')).toThrow(/failed/u);
  });
});

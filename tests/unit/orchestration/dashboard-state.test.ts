import { OrchestrationDashboardState } from '../../../src/orchestration/dashboard-state';
import type { AgentPlan } from '../../../src/orchestration/types';
const plan: AgentPlan = { id: 'p', goal: 'goal', createdAt: 1, maxConcurrentAgents: 3, tasks: [
  { id: 'planner-1', role: 'planner', title: 'Plan', instructions: 'plan', dependsOn: [], estimatedCostUsd: 0.05, status: 'pending' },
  { id: 'coder-1', role: 'coder', title: 'Code', instructions: 'code', dependsOn: ['planner-1'], estimatedCostUsd: 0.25, status: 'pending' },
  { id: 'critic-1', role: 'critic', title: 'Review', instructions: 'review', dependsOn: ['coder-1'], estimatedCostUsd: 0.1, status: 'pending' },
] };
describe('OrchestrationDashboardState', () => {
  it('projects role status, approval, progress, and bounded estimated cost', () => {
    const state = new OrchestrationDashboardState(plan);
    state.approve('planner-1'); state.setStatus('planner-1', 'completed');
    expect(state.cards()[0]).toEqual(expect.objectContaining({ role: 'planner', progress: 1, approvalRequired: false }));
    expect(state.cards()[1]).toEqual(expect.objectContaining({ dependsOn: ['planner-1'], approvalRequired: true }));
    expect(state.totalEstimatedCostUsd()).toBeCloseTo(0.4);
  });
});

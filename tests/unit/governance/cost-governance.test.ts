import { EventBus } from '../../../src/core/event-bus';
import { CostGovernance, type CostEvents } from '../../../src/governance/cost-governance';

describe('CostGovernance', () => {
  it('hard-blocks estimates that cross workflow or agent budgets', () => {
    const blocked = jest.fn();
    const bus = new EventBus<CostEvents>();
    bus.on('cost:blocked', blocked);
    const governor = new CostGovernance({ eventBus: bus, idFactory: () => 'reservation-1' });
    governor.configureWorkflow('workflow:one', { workflowBudgetUsd: 0.5, agentBudgetUsd: 0.3 });

    const first = governor.reserve('workflow:one', 'coder', 0.25);
    const agentBlocked = governor.reserve('workflow:one', 'coder', 0.1);
    const workflowBlocked = governor.reserve('workflow:one', 'critic', 0.3);

    expect(first).toEqual(expect.objectContaining({ allowed: true, reservationId: 'reservation-1', projectedWorkflowTotalUsd: 0.25 }));
    expect(agentBlocked).toEqual(expect.objectContaining({ allowed: false, reason: 'agent-budget-exceeded' }));
    expect(workflowBlocked).toEqual(expect.objectContaining({ allowed: false, reason: 'workflow-budget-exceeded' }));
    expect(blocked).toHaveBeenCalledTimes(2);
  });

  it('reserves, reconciles actual usage, and exposes remaining budget deterministically', () => {
    const governor = new CostGovernance({ idFactory: () => 'reservation-2' });
    governor.configureWorkflow('workflow:two', { workflowBudgetUsd: 1 });
    const decision = governor.reserve('workflow:two', 'planner', 0.4);
    if (!decision.allowed || !decision.reservationId) throw new Error('expected reservation');

    const usage = governor.recordUsage('workflow:two', 'planner', 0.35, decision.reservationId);
    expect(usage).toEqual(expect.objectContaining({ workflowSpentUsd: 0.35, workflowOverBudget: false }));
    expect(governor.getRemainingWorkflowBudget('workflow:two')).toBe(0.65);

    const overage = governor.recordUsage('workflow:two', 'planner', 0.7);
    expect(overage.workflowOverBudget).toBe(true);
    expect(governor.getRemainingWorkflowBudget('workflow:two')).toBe(0);
  });

  it('rejects missing policies, mismatched reservations, and unsafe money input', () => {
    const governor = new CostGovernance();
    expect(() => governor.project('missing', 'coder', 0.1)).toThrow('No cost policy');
    governor.configureWorkflow('workflow:three', { workflowBudgetUsd: 1 });
    expect(() => governor.configureWorkflow('invalid key', { workflowBudgetUsd: 1 })).toThrow(TypeError);
    expect(() => governor.reserve('workflow:three', 'coder', -1)).toThrow(RangeError);
    expect(() => governor.recordUsage('workflow:three', 'coder', 0.1, 'wrong')).toThrow('Reservation does not belong');
  });
});

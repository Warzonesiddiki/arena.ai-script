import { OrchestrationService } from '../../../src/background/orchestration-service';
import { Tracer } from '../../../src/observability/tracer';
import { OrchestrationTransitionError } from '../../../src/orchestration/dashboard-state';

describe('OrchestrationService', () => {
  it('creates an approval-only Phase 3 plan with costs and observability', () => {
    const tracer = new Tracer({ now: () => 100, idFactory: () => 'trace-id' });
    const service = new OrchestrationService({ tracer, now: () => 1, planIdFactory: () => 'plan-fixed' });

    const snapshot = service.create('Add tested validation');

    expect(snapshot).toEqual(expect.objectContaining({
      active: true,
      planId: 'plan-fixed',
      goal: 'Add tested validation',
      estimatedCostUsd: 0.4,
      safety: { activeAgents: 0, handoffs: 0 },
    }));
    expect(snapshot.cards.map((card) => card.id)).toEqual(['planner-1', 'coder-1', 'critic-1']);
    expect(snapshot.cards[0]).toEqual(expect.objectContaining({ role: 'planner', approvalRequired: true, canApprove: true }));
    expect(snapshot.cards[1]).toEqual(expect.objectContaining({ role: 'coder', canApprove: false }));
    expect(tracer.getEvents().map((event) => event.name)).toContain('orchestration.plan.created');
  });

  it('enforces approval order through explicit transition rules', () => {
    const service = new OrchestrationService({ now: () => 1, planIdFactory: () => 'plan-fixed' });
    service.create('Implement dashboard tests');

    expect(() => service.approve('coder-1')).toThrow(OrchestrationTransitionError);
    let snapshot = service.approve('planner-1');
    expect(snapshot.cards[0]).toEqual(expect.objectContaining({ approvalRequired: false }));
    snapshot = service.approve('coder-1');
    expect(snapshot.cards[2]).toEqual(expect.objectContaining({ canApprove: true }));
    snapshot = service.approve('critic-1');
    expect(snapshot.cards.every((card) => !card.approvalRequired)).toBe(true);
  });

  it('prevents running dependent tasks until predecessors have completed', () => {
    const service = new OrchestrationService({ now: () => 1, planIdFactory: () => 'plan-fixed' });
    service.create('Lifecycle gate');
    service.approve('planner-1');
    service.approve('coder-1');

    expect(() => service.transition('coder-1', 'running')).toThrow(/planner-1/u);
    service.transition('planner-1', 'running');
    service.transition('planner-1', 'completed');
    expect(service.transition('coder-1', 'running').cards[1]).toEqual(expect.objectContaining({ status: 'running' }));
    expect(() => service.transition('critic-1', 'running')).toThrow(/approval/u);
    service.transition('coder-1', 'completed');
    service.approve('critic-1');
    expect(service.transition('critic-1', 'running').cards[2]).toEqual(expect.objectContaining({ status: 'running' }));
  });

  it('rejects approval without a plan and records snapshot telemetry', () => {
    const tracer = new Tracer({ now: () => 100, idFactory: () => 'trace-id' });
    const service = new OrchestrationService({ tracer });

    expect(service.snapshot()).toEqual(expect.objectContaining({ active: false, cards: [] }));
    expect(() => service.approve('planner-1')).toThrow(/No active/u);
    expect(tracer.getEvents().map((event) => event.name)).toContain('orchestration.status.snapshot');
  });
});

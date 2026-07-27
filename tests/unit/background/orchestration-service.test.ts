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
  it('releases prior cost reservations when a new plan replaces an old one', () => {
    const service = new OrchestrationService({ planIdFactory: () => 'plan-1' });

    const first = service.create('First goal');
    expect(first.estimatedCostUsd).toBeGreaterThan(0);

    // Creating a second plan must not leak the first plan's reservations, or
    // the workflow budget would be silently consumed by abandoned work.
    const second = service.create('Second goal');
    expect(second.estimatedCostUsd).toBe(first.estimatedCostUsd);
    expect(second.cards.every((card) => card.status !== 'blocked')).toBe(true);
  });

  it('reports an inactive snapshot before any plan exists', () => {
    const service = new OrchestrationService({ planIdFactory: () => 'plan-1' });

    expect(service.snapshot(false)).toEqual(expect.objectContaining({
      active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0,
    }));
  });

  it('refuses to transition a task when no plan is active', () => {
    const service = new OrchestrationService({ planIdFactory: () => 'plan-1' });

    expect(() => service.transition('planner-1', 'running')).toThrow('No active orchestration plan.');
  });

  it('drives a task through its full approved lifecycle', () => {
    const service = new OrchestrationService({ planIdFactory: () => 'plan-1' });
    service.create('Lifecycle goal');

    service.approve('planner-1');
    service.transition('planner-1', 'running');
    const completed = service.transition('planner-1', 'completed');

    expect(completed.cards.find((card) => card.id === 'planner-1')?.status).toBe('completed');
    // Completing the planner unblocks approval of the coder.
    expect(completed.cards.find((card) => card.id === 'coder-1')?.canApprove).toBe(true);
  });

  it('rejects an unknown task id for approval and transition', () => {
    const service = new OrchestrationService({ planIdFactory: () => 'plan-1' });
    service.create('Goal');

    expect(() => service.approve('ghost-1')).toThrow(OrchestrationTransitionError);
    expect(() => service.transition('ghost-1', 'running')).toThrow(OrchestrationTransitionError);
  });
});

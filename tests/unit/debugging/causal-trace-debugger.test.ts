import { CausalTraceDebugger, CausalTraceDebuggerError, type CausalCostEvent } from '../../../src/debugging/causal-trace-debugger';
import { EventBus } from '../../../src/core/event-bus';
import { CostGovernance, type CostEvents } from '../../../src/governance/cost-governance';
import { Tracer, type TraceEvent } from '../../../src/observability/tracer';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';

function orchestrationSnapshot(): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Fix approval ordering',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 0, handoffs: 1 },
    cards: [
      {
        id: 'planner-1',
        role: 'planner',
        title: 'Plan work',
        status: 'completed',
        dependsOn: [],
        estimatedCostUsd: 0.05,
        progress: 1,
        approvalRequired: false,
        canApprove: false,
        approvalBlockedReason: null,
      },
      {
        id: 'coder-1',
        role: 'coder',
        title: 'Implement work',
        status: 'blocked',
        dependsOn: ['planner-1'],
        estimatedCostUsd: 0.25,
        progress: 1,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Cost gate blocked coder.',
      },
      {
        id: 'critic-1',
        role: 'critic',
        title: 'Review work',
        status: 'pending',
        dependsOn: ['coder-1'],
        estimatedCostUsd: 0.1,
        progress: 0,
        approvalRequired: true,
        canApprove: false,
        approvalBlockedReason: 'Coder blocked.',
      },
    ],
  };
}

function traceEvents(): TraceEvent[] {
  let traceIndex = 0;
  const tracer = new Tracer({ now: () => 100 + traceIndex, idFactory: () => `trace-id-${traceIndex += 1}` });
  const span = tracer.startSpan('orchestration.plan.created', { planId: 'plan-1', prompt: 'should redact' }, 'corr-1');
  span.event('orchestration.task.approved', { taskId: 'planner-1', role: 'planner', rawContent: '<div>no</div>' });
  span.event('orchestration.task.statusChanged', { taskId: 'coder-1', role: 'coder', status: 'blocked' }, 'warn');
  span.end({ message: 'not retained' });
  return [...tracer.getEvents()];
}

function costEvents(): CausalCostEvent[] {
  const eventBus = new EventBus<CostEvents>();
  const captured: CausalCostEvent[] = [];
  eventBus.on('cost:*', (payload) => {
    const latestName = captured.length === 0 ? 'cost:projection' : 'cost:blocked';
    captured.push({ name: latestName, payload: payload as never, timestamp: 120 + captured.length });
  });
  const costs = new CostGovernance({ eventBus, idFactory: () => 'reservation-1' });
  costs.configureWorkflow('phase4b', { workflowBudgetUsd: 0.05, agentBudgetUsd: 0.05 });
  costs.reserve('phase4b', 'coder', 0.25);
  return captured.filter((event) => event.name === 'cost:blocked');
}

describe('CausalTraceDebugger', () => {
  it('builds a deterministic graph from orchestration, traces, and cost events', () => {
    const graph = new CausalTraceDebugger().build({
      orchestration: orchestrationSnapshot(),
      traceEvents: traceEvents(),
      costEvents: costEvents(),
      now: 1_900_000_000_000,
    });

    expect(graph.generatedAt).toBe(1_900_000_000_000);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workflow:plan-1', type: 'workflow' }),
      expect.objectContaining({ id: 'task:coder-1', type: 'task', severity: 'blocked' }),
      expect.objectContaining({ type: 'cost', severity: 'blocked' }),
      expect.objectContaining({ type: 'trace', label: 'orchestration.task.statusChanged', severity: 'warn' }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'workflow:plan-1', to: 'task:coder-1', reason: 'contains' }),
      expect.objectContaining({ from: 'task:planner-1', to: 'task:coder-1', reason: 'depends-on' }),
      expect.objectContaining({ from: 'task:coder-1', reason: 'task-event' }),
      expect.objectContaining({ reason: 'cost-gate', to: 'task:coder-1' }),
      expect.objectContaining({ reason: 'correlation-sequence' }),
    ]));
    expect(graph.rootCauses.map((cause) => cause.nodeId)).toEqual(expect.arrayContaining(['task:coder-1']));
    expect(graph.truncated).toBe(false);
  });

  it('redacts sensitive trace attributes from the graph', () => {
    const graph = new CausalTraceDebugger().build({ traceEvents: traceEvents(), now: 1 });
    const attributes = graph.nodes.flatMap((node) => Object.keys(node.attributes));

    expect(attributes).toContain('planId');
    expect(attributes).not.toContain('prompt');
    expect(attributes).not.toContain('rawContent');
    expect(attributes).not.toContain('message');
  });

  it('explains a blocked task through its deterministic incoming causal path', () => {
    const debuggerInstance = new CausalTraceDebugger();
    const graph = debuggerInstance.build({
      orchestration: orchestrationSnapshot(),
      traceEvents: traceEvents(),
      costEvents: costEvents(),
      now: 1,
    });

    const steps = debuggerInstance.explain(graph, 'task:coder-1');

    expect(steps.at(-1)?.node.id).toBe('task:coder-1');
    expect(steps.some((step) => step.node.type === 'cost')).toBe(true);
    expect(steps.at(-1)?.incomingReason).toBe('cost-gate');
    expect(() => debuggerInstance.explain(graph, 'missing')).toThrow(CausalTraceDebuggerError);
  });

  it('bounds large event inputs and rejects invalid limits', () => {
    const events = Array.from({ length: 510 }, (_, index): TraceEvent => ({
      id: `trace-${index}`,
      correlationId: 'corr-large',
      parentId: null,
      name: 'debug.event',
      level: 'info',
      timestamp: index,
      attributes: {},
    }));
    const debuggerInstance = new CausalTraceDebugger();

    const graph = debuggerInstance.build({ traceEvents: events, now: 1 });
    expect(graph.truncated).toBe(true);
    expect(graph.nodes.filter((node) => node.type === 'trace')).toHaveLength(500);
    expect(() => debuggerInstance.build({ traceEvents: events, maxTraceEvents: 0 })).toThrow(CausalTraceDebuggerError);
  });
});

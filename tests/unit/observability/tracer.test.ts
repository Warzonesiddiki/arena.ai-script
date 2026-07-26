import { EventBus } from '../../../src/core/event-bus';
import { Tracer, type TraceEvents } from '../../../src/observability/tracer';

describe('Tracer', () => {
  it('records correlated, bounded structured events and exports by correlation id', () => {
    const emitted: string[] = [];
    const bus = new EventBus<TraceEvents>();
    bus.on('trace:event', (event) => emitted.push(event.name));
    const ids = ['correlation', 'span', 'child', 'end'];
    const tracer = new Tracer({ eventBus: bus, now: () => 100, idFactory: () => ids.shift() ?? 'extra', maxEvents: 3 });

    const span = tracer.startSpan('agent.task', { taskId: 'task-1', nested: { hidden: true }, invalid_key: 'ignored' });
    span.event('agent.tool', { durationMs: 42 });
    span.end({ result: 'done' });

    expect(span.correlationId).toBe('correlation');
    expect(emitted).toEqual(['agent.task', 'agent.tool', 'agent.task.end']);
    expect(tracer.getEvents('correlation')).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributes: { taskId: 'task-1', nested: '[redacted]', invalid_key: 'ignored' } }),
    ]));
  });

  it('caps retained traces and marks duplicate span ends', () => {
    const tracer = new Tracer({ now: () => 1, idFactory: () => 'id', maxEvents: 2 });
    const span = tracer.startSpan('run');
    span.end();
    span.end();

    expect(tracer.getEvents()).toHaveLength(2);
    expect(tracer.getEvents()[1]).toEqual(expect.objectContaining({ name: 'span.duplicateEnd', level: 'warn' }));
    tracer.clear();
    expect(tracer.getEvents()).toEqual([]);
  });
});

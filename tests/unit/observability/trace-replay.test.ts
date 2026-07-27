import { TraceReplayBuilder, TraceReplayError } from '../../../src/observability/trace-replay';
import { Tracer, type TraceEvent } from '../../../src/observability/tracer';

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: 'e1',
    correlationId: 'corr-1',
    parentId: null,
    name: 'span',
    level: 'info',
    timestamp: 1_000,
    attributes: {},
    ...overrides,
  };
}

describe('TraceReplayBuilder', () => {
  it('reconstructs an ordered parent/child timeline from tracer output', () => {
    let clock = 1_000;
    const tracer = new Tracer({ now: () => (clock += 100) });
    const span = tracer.startSpan('workflow.run', { planId: 'plan-1' });
    span.event('task.approved', { taskId: 'planner-1' });
    span.event('task.completed', { taskId: 'planner-1' });
    span.end({ outcome: 'ok' });

    const timeline = new TraceReplayBuilder().buildTimeline(tracer.getEvents(), span.correlationId);

    expect(timeline.eventCount).toBe(4);
    expect(timeline.nodes.map((node) => node.name)).toEqual(['workflow.run', 'task.approved', 'task.completed', 'workflow.run.end']);
    expect(timeline.nodes.map((node) => node.depth)).toEqual([0, 1, 1, 1]);
    expect(timeline.roots).toEqual([span.id]);
    expect(timeline.nodes[0]?.offsetMs).toBe(0);
    expect(timeline.nodes[1]?.offsetMs).toBe(100);
    // The root span's duration runs to its matching .end event.
    expect(timeline.nodes[0]?.durationMs).toBe(300);
    expect(timeline.durationMs).toBe(300);
  });

  it('orders events chronologically regardless of input order', () => {
    const builder = new TraceReplayBuilder();
    const events = [
      event({ id: 'c', timestamp: 3_000 }),
      event({ id: 'a', timestamp: 1_000 }),
      event({ id: 'b', timestamp: 2_000 }),
    ];

    expect(builder.buildTimeline(events, 'corr-1').nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(builder.buildTimeline([...events].reverse(), 'corr-1').nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks timestamp ties deterministically by id', () => {
    const builder = new TraceReplayBuilder();
    const events = [event({ id: 'z', timestamp: 1_000 }), event({ id: 'a', timestamp: 1_000 })];
    expect(builder.buildTimeline(events, 'corr-1').nodes.map((node) => node.id)).toEqual(['a', 'z']);
  });

  it('isolates correlations and returns an empty timeline for unknown ids', () => {
    const builder = new TraceReplayBuilder();
    const events = [
      event({ id: 'a', correlationId: 'corr-1' }),
      event({ id: 'b', correlationId: 'corr-2', timestamp: 2_000 }),
    ];

    expect(builder.buildTimeline(events, 'corr-1').nodes.map((node) => node.id)).toEqual(['a']);
    const empty = builder.buildTimeline(events, 'corr-missing');
    expect(empty).toEqual(expect.objectContaining({ eventCount: 0, nodes: [], roots: [], durationMs: 0 }));
  });

  it('redacts sensitive attribute keys in the replay view', () => {
    const builder = new TraceReplayBuilder();
    const timeline = builder.buildTimeline([event({
      attributes: { apiKey: 'sk-live-123', prompt: 'secret prompt', taskId: 'coder-1', authorization: 'Bearer x', count: 3 },
    })], 'corr-1');

    const attributes = timeline.nodes[0]!.attributes;
    expect(attributes.apiKey).toBe('[redacted]');
    expect(attributes.prompt).toBe('[redacted]');
    expect(attributes.authorization).toBe('[redacted]');
    expect(attributes.taskId).toBe('coder-1');
    expect(attributes.count).toBe(3);
  });

  it('treats an orphaned parent reference as a root instead of failing', () => {
    const builder = new TraceReplayBuilder();
    const timeline = builder.buildTimeline([event({ id: 'child', parentId: 'missing-parent' })], 'corr-1');

    expect(timeline.nodes[0]?.parentId).toBeNull();
    expect(timeline.nodes[0]?.depth).toBe(0);
    expect(timeline.roots).toEqual(['child']);
  });

  it('marks truncation when the source exceeds the replay bound', () => {
    const builder = new TraceReplayBuilder(3);
    const events = [1, 2, 3, 4, 5].map((index) => event({ id: `e${index}`, timestamp: 1_000 + index }));

    const timeline = builder.buildTimeline(events, 'corr-1');
    expect(timeline.truncated).toBe(true);
    expect(timeline.nodes.map((node) => node.id)).toEqual(['e3', 'e4', 'e5']);
  });

  it('produces deterministic, indented replay steps', () => {
    const builder = new TraceReplayBuilder();
    const timeline = builder.buildTimeline([
      event({ id: 'root', timestamp: 1_000 }),
      event({ id: 'child', parentId: 'root', timestamp: 1_050, level: 'warn', name: 'retry' }),
    ], 'corr-1');

    const steps = builder.replaySteps(timeline);
    expect(steps.map((step) => step.index)).toEqual([1, 2]);
    expect(steps[0]?.description).toContain('+0ms [info] span');
    expect(steps[1]?.description).toContain('+50ms   [warn] retry');
  });

  it('summarises levels, correlations, and the slowest span', () => {
    const builder = new TraceReplayBuilder();
    const events = [
      event({ id: 'r1', correlationId: 'corr-1', timestamp: 1_000 }),
      event({ id: 'r1e', correlationId: 'corr-1', parentId: 'r1', name: 'span.end', timestamp: 1_500 }),
      event({ id: 'r2', correlationId: 'corr-2', timestamp: 2_000 }),
      event({ id: 'r2e', correlationId: 'corr-2', parentId: 'r2', name: 'span.end', timestamp: 2_100 }),
      event({ id: 'err', correlationId: 'corr-2', level: 'error', timestamp: 2_200 }),
    ];

    const summary = builder.summarize(events);
    expect(summary.correlationIds).toEqual(['corr-1', 'corr-2']);
    expect(summary.totalEvents).toBe(5);
    expect(summary.errorCount).toBe(1);
    expect(summary.levelCounts).toEqual({ debug: 0, info: 4, warn: 0, error: 1 });
    expect(summary.slowestSpan).toEqual({ id: 'r1', name: 'span', durationMs: 500 });
  });

  it('rejects malformed events and configuration', () => {
    const builder = new TraceReplayBuilder();

    expect(() => builder.buildTimeline('nope' as never, 'corr-1')).toThrow(TraceReplayError);
    expect(() => builder.buildTimeline([{ id: 1 } as never], 'corr-1')).toThrow(TraceReplayError);
    expect(() => builder.buildTimeline([event({ timestamp: Number.NaN })], 'corr-1')).toThrow(TraceReplayError);
    expect(() => builder.buildTimeline([event()], '')).toThrow(TraceReplayError);
    expect(() => new TraceReplayBuilder(0)).toThrow(TraceReplayError);
  });
});

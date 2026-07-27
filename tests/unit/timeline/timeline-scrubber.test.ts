import { TimelineScrubber, TimelineScrubberError } from '../../../src/timeline/timeline-scrubber';
import type { TraceEvent } from '../../../src/observability/tracer';

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: 'e1',
    correlationId: 'corr-1',
    parentId: null,
    name: 'step',
    level: 'info',
    timestamp: 1_000,
    attributes: {},
    ...overrides,
  };
}

function sampleEvents(): TraceEvent[] {
  return [
    event({ id: 'a', name: 'workflow.start', timestamp: 1_000 }),
    event({ id: 'b', name: 'task.approved', parentId: 'a', timestamp: 1_100 }),
    event({ id: 'c', name: 'task.retry', parentId: 'a', timestamp: 1_200, level: 'warn' }),
    event({ id: 'd', name: 'task.failed', parentId: 'a', timestamp: 1_300, level: 'error' }),
    event({ id: 'e', name: 'workflow.start.end', parentId: 'a', timestamp: 1_400 }),
  ];
}

function scrubber(events = sampleEvents()): TimelineScrubber {
  return new TimelineScrubber(events, 'corr-1', { now: () => 9_000 });
}

describe('TimelineScrubber', () => {
  it('starts at the first frame and reports position deterministically', () => {
    const state = scrubber().state();

    expect(state.frame).toEqual(expect.objectContaining({ index: 0, total: 5, offsetMs: 0, progress: 0, atStart: true, atEnd: false }));
    expect(state.frame.step?.node.name).toBe('workflow.start');
    expect(state.totalCount).toBe(5);
    expect(state.activeBranchId).toBeNull();
  });

  it('steps forward and backward and clamps at both ends', () => {
    const view = scrubber();

    expect(view.next().frame.index).toBe(1);
    expect(view.next(2).frame.index).toBe(3);
    // Dragging past the end rests at the end rather than throwing.
    expect(view.next(99).frame).toEqual(expect.objectContaining({ index: 4, atEnd: true, progress: 1 }));
    expect(view.previous(2).frame.index).toBe(2);
    expect(view.previous(99).frame).toEqual(expect.objectContaining({ index: 0, atStart: true }));

    expect(view.last().frame.index).toBe(4);
    expect(view.first().frame.index).toBe(0);
    expect(() => view.next(0)).toThrow(TimelineScrubberError);
    expect(() => view.next(1.5)).toThrow(TimelineScrubberError);
    expect(() => view.seek(Number.NaN)).toThrow(TimelineScrubberError);
  });

  it('seeks by time offset and to the next issue', () => {
    const view = scrubber();

    expect(view.seekToOffset(200).frame.step?.node.id).toBe('c');
    expect(view.seekToOffset(0).frame.index).toBe(0);
    // Past the end clamps to the final frame.
    expect(view.seekToOffset(99_999).frame.index).toBe(4);
    expect(() => view.seekToOffset(-1)).toThrow(TimelineScrubberError);

    view.first();
    expect(view.nextIssue().frame.step?.node.name).toBe('task.retry');
    expect(view.nextIssue().frame.step?.node.name).toBe('task.failed');
    // No further issues: position holds.
    expect(view.nextIssue().frame.step?.node.name).toBe('task.failed');
  });

  it('filters by level, name, and depth while clamping the cursor', () => {
    const view = scrubber();
    view.last();

    const warnings = view.setFilter({ minLevel: 'warn' });
    expect(warnings.visibleCount).toBe(2);
    expect(warnings.totalCount).toBe(5);
    // The cursor was past the new end, so it clamped.
    expect(warnings.frame.index).toBe(1);
    expect(view.visibleSteps().map((step) => step.node.id)).toEqual(['c', 'd']);

    expect(view.setFilter({ nameContains: 'TASK.' }).visibleCount).toBe(3);
    expect(view.setFilter({ maxDepth: 0 }).visibleCount).toBe(1);
    expect(view.clearFilter().visibleCount).toBe(5);
    expect(() => view.setFilter({ minLevel: 'loud' as never })).toThrow(TimelineScrubberError);
    expect(() => view.setFilter({ maxDepth: -1 })).toThrow(TimelineScrubberError);
  });

  it('reports played steps up to the cursor', () => {
    const view = scrubber();
    view.seek(2);

    expect(view.playedSteps().map((step) => step.node.id)).toEqual(['a', 'b', 'c']);
    expect(view.current()?.node.id).toBe('c');
  });

  it('records branches as bookmarks that execute nothing', () => {
    const view = scrubber();
    view.seek(2);

    const branch = view.branch('  What if we had not retried  ', 'Reviewer note');
    expect(branch).toEqual(expect.objectContaining({ label: 'What if we had not retried', fromIndex: 2, createdAt: 9_000, note: 'Reviewer note' }));
    expect(view.state().activeBranchId).toBe(branch.id);

    view.last();
    expect(view.gotoBranch(branch.id).frame.index).toBe(2);
    expect(view.listBranches()).toHaveLength(1);
    expect(() => view.gotoBranch('branch-missing')).toThrow(TimelineScrubberError);
    expect(() => view.branch('   ')).toThrow(TimelineScrubberError);
  });

  it('lands on the nearest visible step when a branch point is filtered out', () => {
    const view = scrubber();
    view.seek(1); // 'b', an info event
    const branch = view.branch('From an info step');

    view.setFilter({ minLevel: 'warn' });
    // 'b' is now hidden; the nearest visible step at or after it is 'c'.
    expect(view.gotoBranch(branch.id).frame.step?.node.id).toBe('c');
  });

  it('bounds the branch registry', () => {
    const view = scrubber();
    for (let index = 0; index < 20; index += 1) view.branch(`branch ${index}`);
    expect(() => view.branch('overflow')).toThrow(TimelineScrubberError);
    expect(view.listBranches()).toHaveLength(20);
  });

  it('handles an empty or unknown correlation without throwing', () => {
    const empty = new TimelineScrubber(sampleEvents(), 'corr-missing', { now: () => 1 });
    const state = empty.state();

    expect(state.frame).toEqual(expect.objectContaining({ index: -1, total: 0, progress: 0, atStart: true, atEnd: true }));
    expect(empty.current()).toBeNull();
    expect(empty.playedSteps()).toEqual([]);
    expect(empty.next().frame.index).toBe(-1);
    expect(() => empty.branch('nothing to branch from')).toThrow(TimelineScrubberError);
  });

  it('treats a single-frame timeline as fully played', () => {
    const single = new TimelineScrubber([event({ id: 'only' })], 'corr-1', { now: () => 1 });
    expect(single.state().frame).toEqual(expect.objectContaining({ index: 0, total: 1, progress: 1, atStart: true, atEnd: true }));
  });

  it('exposes the underlying replay timeline with redacted attributes', () => {
    const view = new TimelineScrubber([event({ attributes: { apiKey: 'sk-live', taskId: 'coder-1' } })], 'corr-1', { now: () => 1 });
    const attributes = view.timelineSummary().nodes[0]!.attributes;

    expect(attributes.apiKey).toBe('[redacted]');
    expect(attributes.taskId).toBe('coder-1');
  });
});

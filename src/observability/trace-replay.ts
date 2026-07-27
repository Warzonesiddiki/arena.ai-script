import type { TraceEvent, TraceLevel } from './tracer';

const MAX_REPLAY_EVENTS = 5_000;
const MAX_TIMELINE_ENTRIES = 500;

/**
 * Phase 6E distributed trace replay.
 *
 * Reconstructs ordered, parent/child-linked timelines from the bounded events
 * the Phase 1D `Tracer` already produced. It adds **no new collection channel**,
 * retains nothing by default, and re-sanitises attributes on the way out so a
 * replay view can never widen what telemetry exposes.
 */

export interface ReplayNode {
  id: string;
  correlationId: string;
  parentId: string | null;
  name: string;
  level: TraceLevel;
  timestamp: number;
  /** Milliseconds from the first event in the correlation. */
  offsetMs: number;
  /** Nesting depth derived from parent links. */
  depth: number;
  /** Elapsed time to this span's `.end` event, when one exists. */
  durationMs: number | null;
  attributes: Readonly<Record<string, string | number | boolean | null>>;
  childIds: readonly string[];
}

export interface ReplayTimeline {
  correlationId: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  eventCount: number;
  errorCount: number;
  warnCount: number;
  /** True when the source event list was truncated to the replay bound. */
  truncated: boolean;
  roots: readonly string[];
  nodes: readonly ReplayNode[];
}

export interface ReplayStep {
  index: number;
  node: ReplayNode;
  /** Human-readable, already-sanitised one-line description. */
  description: string;
}

export interface ReplaySummary {
  correlationIds: readonly string[];
  totalEvents: number;
  errorCount: number;
  slowestSpan: { id: string; name: string; durationMs: number } | null;
  levelCounts: Readonly<Record<TraceLevel, number>>;
}

export class TraceReplayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TraceReplayError';
  }
}

const REDACTED = '[redacted]';
const SENSITIVE_KEY = /(secret|token|apikey|api_key|password|credential|authorization|cookie|prompt|completion|conversation)/iu;

export class TraceReplayBuilder {
  private readonly maxEvents: number;

  public constructor(maxEvents = MAX_REPLAY_EVENTS) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new TraceReplayError('maxEvents must be a positive safe integer.');
    this.maxEvents = maxEvents;
  }

  /** Builds one ordered timeline for a single correlation ID. */
  public buildTimeline(events: readonly TraceEvent[], correlationId: string): ReplayTimeline {
    validateIdentifier(correlationId, 'correlationId');
    const all = validateEvents(events);
    const truncated = all.length > this.maxEvents;
    const scoped = (truncated ? all.slice(-this.maxEvents) : all)
      .filter((event) => event.correlationId === correlationId);

    if (scoped.length === 0) {
      return { correlationId, startedAt: 0, endedAt: 0, durationMs: 0, eventCount: 0, errorCount: 0, warnCount: 0, truncated, roots: [], nodes: [] };
    }

    // Stable chronological order; ties fall back to id so replay is reproducible.
    const ordered = [...scoped].sort((left, right) => (left.timestamp - right.timestamp) || left.id.localeCompare(right.id));
    const startedAt = ordered[0]!.timestamp;
    const endedAt = ordered[ordered.length - 1]!.timestamp;

    const present = new Set(ordered.map((event) => event.id));
    const childIds = new Map<string, string[]>();
    for (const event of ordered) {
      const parentId = event.parentId && present.has(event.parentId) ? event.parentId : null;
      if (parentId) {
        const siblings = childIds.get(parentId) ?? [];
        siblings.push(event.id);
        childIds.set(parentId, siblings);
      }
    }

    const parentOf = new Map<string, string | null>(
      ordered.map((event) => [event.id, event.parentId && present.has(event.parentId) ? event.parentId : null]),
    );
    const depthOf = new Map<string, number>();
    const resolveDepth = (id: string, seen: ReadonlySet<string>): number => {
      const cached = depthOf.get(id);
      if (cached !== undefined) return cached;
      if (seen.has(id)) return 0; // defensive: a malformed parent cycle collapses to root
      const parentId = parentOf.get(id) ?? null;
      const depth = parentId === null ? 0 : resolveDepth(parentId, new Set(seen).add(id)) + 1;
      depthOf.set(id, depth);
      return depth;
    };

    // A span's duration is measured to its matching `<name>.end` child event.
    const endByParent = new Map<string, number>();
    for (const event of ordered) {
      if (event.parentId && event.name.endsWith('.end')) endByParent.set(event.parentId, event.timestamp);
    }

    const nodes: ReplayNode[] = ordered.slice(0, MAX_TIMELINE_ENTRIES).map((event) => {
      const end = endByParent.get(event.id);
      return {
        id: event.id,
        correlationId: event.correlationId,
        parentId: parentOf.get(event.id) ?? null,
        name: event.name,
        level: event.level,
        timestamp: event.timestamp,
        offsetMs: event.timestamp - startedAt,
        depth: resolveDepth(event.id, new Set()),
        durationMs: end === undefined ? null : end - event.timestamp,
        attributes: redactAttributes(event.attributes),
        childIds: [...(childIds.get(event.id) ?? [])].sort(),
      };
    });

    return {
      correlationId,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      eventCount: ordered.length,
      errorCount: ordered.filter((event) => event.level === 'error').length,
      warnCount: ordered.filter((event) => event.level === 'warn').length,
      truncated: truncated || ordered.length > MAX_TIMELINE_ENTRIES,
      roots: nodes.filter((node) => node.parentId === null).map((node) => node.id),
      nodes,
    };
  }

  /** Produces a deterministic step-by-step replay for debugging. */
  public replaySteps(timeline: ReplayTimeline): readonly ReplayStep[] {
    return timeline.nodes.map((node, index) => ({
      index: index + 1,
      node,
      description: `+${node.offsetMs}ms ${'  '.repeat(Math.min(node.depth, 8))}[${node.level}] ${node.name}${node.durationMs === null ? '' : ` (${node.durationMs}ms)`}`,
    }));
  }

  public summarize(events: readonly TraceEvent[]): ReplaySummary {
    const all = validateEvents(events);
    const levelCounts: Record<TraceLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const event of all) levelCounts[event.level] += 1;

    const correlationIds = [...new Set(all.map((event) => event.correlationId))].sort();
    let slowestSpan: ReplaySummary['slowestSpan'] = null;
    for (const correlationId of correlationIds) {
      for (const node of this.buildTimeline(all, correlationId).nodes) {
        if (node.durationMs !== null && (slowestSpan === null || node.durationMs > slowestSpan.durationMs)) {
          slowestSpan = { id: node.id, name: node.name, durationMs: node.durationMs };
        }
      }
    }

    return {
      correlationIds,
      totalEvents: all.length,
      errorCount: levelCounts.error,
      slowestSpan,
      levelCounts,
    };
  }
}

function redactAttributes(attributes: Readonly<Record<string, string | number | boolean | null>>): Readonly<Record<string, string | number | boolean | null>> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : typeof value === 'string' ? value.slice(0, 256) : value;
  }
  return Object.freeze(output);
}

function validateEvents(events: readonly TraceEvent[]): readonly TraceEvent[] {
  if (!Array.isArray(events)) throw new TraceReplayError('events must be an array.');
  for (const event of events) {
    if (typeof event?.id !== 'string' || typeof event.correlationId !== 'string' || typeof event.name !== 'string') {
      throw new TraceReplayError('Every trace event requires string id, correlationId, and name fields.');
    }
    if (!Number.isFinite(event.timestamp)) throw new TraceReplayError(`Trace event "${event.id}" has an invalid timestamp.`);
  }
  return events;
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new TraceReplayError(`${name} is invalid.`);
  return value;
}

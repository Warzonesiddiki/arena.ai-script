import { EventBus, type EventMap } from '../core/event-bus';

export type TraceLevel = 'debug' | 'info' | 'warn' | 'error';
export type TraceAttributes = Readonly<Record<string, string | number | boolean | null>>;

export interface TraceEvent {
  id: string;
  correlationId: string;
  parentId: string | null;
  name: string;
  level: TraceLevel;
  timestamp: number;
  attributes: TraceAttributes;
}

export interface TraceEvents extends EventMap {
  'trace:event': TraceEvent;
}

export interface TracerOptions {
  eventBus?: EventBus<TraceEvents>;
  now?: () => number;
  idFactory?: () => string;
  maxEvents?: number;
  sink?: (event: TraceEvent) => void;
}

export interface TraceSpan {
  readonly id: string;
  readonly correlationId: string;
  event(name: string, attributes?: Record<string, unknown>, level?: TraceLevel): TraceEvent;
  end(attributes?: Record<string, unknown>): TraceEvent;
}

/**
 * Structured in-memory tracing. Trace IDs are observability identifiers, not
 * credentials; event attributes are bounded to primitives to avoid accidentally
 * retaining a full prompt, DOM subtree, or secret in telemetry.
 */
export class Tracer {
  private readonly eventBus: EventBus<TraceEvents>;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly maxEvents: number;
  private readonly sink?: (event: TraceEvent) => void;
  private readonly events: TraceEvent[] = [];

  public constructor(options: TracerOptions = {}) {
    this.eventBus = options.eventBus ?? new EventBus<TraceEvents>();
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? createTraceId;
    this.maxEvents = options.maxEvents ?? 1_000;
    this.sink = options.sink;
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents <= 0) throw new RangeError('maxEvents must be a positive safe integer.');
  }

  public startSpan(name: string, attributes: Record<string, unknown> = {}, correlationId = this.idFactory()): TraceSpan {
    const id = this.idFactory();
    this.record(name, 'info', attributes, correlationId, null, id);
    let ended = false;

    return {
      id,
      correlationId,
      event: (eventName, eventAttributes = {}, level = 'info') => this.record(eventName, level, eventAttributes, correlationId, id),
      end: (eventAttributes = {}) => {
        if (ended) return this.record('span.duplicateEnd', 'warn', { name }, correlationId, id);
        ended = true;
        return this.record(`${name}.end`, 'info', eventAttributes, correlationId, id);
      },
    };
  }

  public record(
    name: string,
    level: TraceLevel = 'info',
    attributes: Record<string, unknown> = {},
    correlationId = this.idFactory(),
    parentId: string | null = null,
    id = this.idFactory(),
  ): TraceEvent {
    const event: TraceEvent = Object.freeze({
      id,
      correlationId,
      parentId,
      name,
      level,
      timestamp: this.now(),
      attributes: Object.freeze(sanitizeAttributes(attributes)),
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.eventBus.emit('trace:event', event);
    this.sink?.(event);
    return event;
  }

  public recordError(name: string, error: unknown, correlationId?: string, attributes: Record<string, unknown> = {}): TraceEvent {
    const message = error instanceof Error ? error.message : String(error);
    return this.record(name, 'error', { ...attributes, error: message }, correlationId);
  }

  public getEvents(correlationId?: string): readonly TraceEvent[] {
    return correlationId === undefined
      ? Object.freeze([...this.events])
      : Object.freeze(this.events.filter((event) => event.correlationId === correlationId));
  }

  public clear(): void {
    this.events.length = 0;
  }
}

function sanitizeAttributes(attributes: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key)) continue;
    if (value === null || typeof value === 'boolean') sanitized[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
    else if (typeof value === 'string') sanitized[key] = value.slice(0, 1_024);
    else sanitized[key] = '[redacted]';
  }
  return sanitized;
}

let traceCounter = 0;
function createTraceId(): string {
  traceCounter = (traceCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${traceCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

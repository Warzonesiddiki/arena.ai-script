import { consoleDiagnostics, type DiagnosticReporter } from './diagnostics';

export type EventMap = object;
export type EventName<TEvents extends EventMap> = Extract<keyof TEvents, string>;
export type WildcardEvent = '*' | `${string}:*`;
export type EventHandler<TPayload = unknown> = (payload: TPayload) => unknown | Promise<unknown>;

export interface EventListenerOptions {
  once?: boolean;
  priority?: number;
}

interface Listener {
  id: number;
  handler: EventHandler;
  once: boolean;
  priority: number;
}

/**
 * EventBus v2 ported from v7.2.
 *
 * It preserves exact events, `*` and namespace (`agent:*`) wildcards, listener
 * priorities, one-shot listeners, synchronous emission, and per-event counts.
 * Listener failures remain isolated so one module cannot interrupt another.
 */
export class EventBus<TEvents extends EventMap = Record<string, unknown>> {
  private readonly listeners = new Map<string, Listener[]>();
  private readonly stats = new Map<string, number>();
  private nextListenerId = 1;

  public constructor(private readonly diagnostics: DiagnosticReporter = consoleDiagnostics) {}

  public on<TEvent extends EventName<TEvents>>(
    event: TEvent | WildcardEvent,
    handler: EventHandler<TEvent extends EventName<TEvents> ? TEvents[TEvent] : unknown>,
    options: EventListenerOptions = {},
  ): () => void {
    const listener: Listener = {
      id: this.nextListenerId++,
      handler: handler as EventHandler,
      once: options.once ?? false,
      priority: options.priority ?? 0,
    };
    const subscribers = this.listeners.get(event) ?? [];
    subscribers.push(listener);
    this.listeners.set(event, subscribers);

    return () => this.removeListener(event, listener.id);
  }

  public once<TEvent extends EventName<TEvents>>(
    event: TEvent | WildcardEvent,
    handler: EventHandler<TEvent extends EventName<TEvents> ? TEvents[TEvent] : unknown>,
  ): () => void {
    return this.on(event, handler, { once: true });
  }

  public off<TEvent extends EventName<TEvents>>(
    event: TEvent | WildcardEvent,
    handler: EventHandler<TEvent extends EventName<TEvents> ? TEvents[TEvent] : unknown>,
  ): void {
    const subscribers = this.listeners.get(event);
    if (!subscribers) return;

    const retained = subscribers.filter((listener) => listener.handler !== handler);
    if (retained.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, retained);
  }

  /** Emits without waiting for promise-returning listeners, matching v7.2 behavior. */
  public emit<TEvent extends EventName<TEvents>>(event: TEvent, payload: TEvents[TEvent]): void {
    this.recordEmission(event);
    const executedOnce: Array<{ event: string; id: number }> = [];

    for (const matched of this.getMatchingListeners(event)) {
      try {
        const result = matched.listener.handler(payload);
        if (isPromiseLike(result)) {
          void result.catch((error: unknown) => {
            this.diagnostics.warn(`EventBus async error on "${event}".`, error);
          });
        }
      } catch (error) {
        this.diagnostics.warn(`EventBus error on "${event}".`, error);
      }

      if (matched.listener.once) executedOnce.push({ event: matched.event, id: matched.listener.id });
    }

    this.removeExecutedOnce(executedOnce);
  }

  /** Emits and awaits handlers in deterministic priority/order sequence. */
  public async emitAsync<TEvent extends EventName<TEvents>>(event: TEvent, payload: TEvents[TEvent]): Promise<void> {
    this.recordEmission(event);
    const executedOnce: Array<{ event: string; id: number }> = [];

    for (const matched of this.getMatchingListeners(event)) {
      try {
        await matched.listener.handler(payload);
      } catch (error) {
        this.diagnostics.warn(`EventBus async error on "${event}".`, error);
      }

      if (matched.listener.once) executedOnce.push({ event: matched.event, id: matched.listener.id });
    }

    this.removeExecutedOnce(executedOnce);
  }

  public clear(event?: EventName<TEvents> | WildcardEvent): void {
    if (event === undefined) {
      this.listeners.clear();
      return;
    }
    this.listeners.delete(event);
  }

  public getStats(event?: EventName<TEvents>): number | Record<string, number> {
    if (event !== undefined) return this.stats.get(event) ?? 0;
    return Object.fromEntries(this.stats);
  }

  public resetStats(): void {
    this.stats.clear();
  }

  private recordEmission(event: string): void {
    this.stats.set(event, (this.stats.get(event) ?? 0) + 1);
  }

  private getMatchingListeners(event: string): Array<{ event: string; listener: Listener }> {
    const matches: Array<{ event: string; listener: Listener; registrationOrder: number }> = [];
    let registrationOrder = 0;

    for (const [pattern, subscribers] of this.listeners) {
      if (!matchesEvent(pattern, event)) continue;
      for (const listener of subscribers) {
        matches.push({ event: pattern, listener, registrationOrder: registrationOrder++ });
      }
    }

    matches.sort((left, right) => {
      const byPriority = right.listener.priority - left.listener.priority;
      return byPriority === 0 ? left.registrationOrder - right.registrationOrder : byPriority;
    });

    return matches;
  }

  private removeExecutedOnce(executedOnce: Array<{ event: string; id: number }>): void {
    for (const { event, id } of executedOnce) this.removeListener(event, id);
  }

  private removeListener(event: string, listenerId: number): void {
    const subscribers = this.listeners.get(event);
    if (!subscribers) return;

    const retained = subscribers.filter((listener) => listener.id !== listenerId);
    if (retained.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, retained);
  }
}

function matchesEvent(pattern: string, event: string): boolean {
  if (pattern === event || pattern === '*') return true;
  if (!pattern.endsWith(':*')) return false;

  const prefix = pattern.slice(0, -2);
  return event === prefix || event.startsWith(`${prefix}:`);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof (value as { then?: unknown }).then === 'function';
}

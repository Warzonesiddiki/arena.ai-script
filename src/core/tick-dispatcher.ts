import { consoleDiagnostics, type DiagnosticReporter } from './diagnostics';

export interface ClockScheduler {
  now(): number;
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof globalThis.setInterval>;
  clearInterval(handle: ReturnType<typeof globalThis.setInterval>): void;
}

export interface TickDispatcherOptions {
  cadenceMs?: number;
  scheduler?: ClockScheduler;
  diagnostics?: DiagnosticReporter;
}

interface TickEntry {
  callback: () => void;
  intervalMs: number;
  lastRun: number;
}

const browserScheduler: ClockScheduler = {
  now: () => Date.now(),
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

/**
 * Central interval multiplexer ported from v7.2. Consumers register named work;
 * the dispatcher owns the only repeating timer for that runtime surface.
 */
export class TickDispatcher {
  private readonly ticks = new Map<string, TickEntry>();
  private readonly cadenceMs: number;
  private readonly scheduler: ClockScheduler;
  private readonly diagnostics: DiagnosticReporter;
  private timer: ReturnType<typeof globalThis.setInterval> | null = null;

  public constructor(options: TickDispatcherOptions = {}) {
    this.cadenceMs = options.cadenceMs ?? 1_000;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.diagnostics = options.diagnostics ?? consoleDiagnostics;
    if (!Number.isFinite(this.cadenceMs) || this.cadenceMs <= 0) {
      throw new RangeError('TickDispatcher cadenceMs must be a positive finite number.');
    }
  }

  public register(name: string, callback: () => void, intervalMs: number): void {
    if (!name.trim()) throw new TypeError('TickDispatcher tick names must not be empty.');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('TickDispatcher intervalMs must be a positive finite number.');
    }
    this.ticks.set(name, { callback, intervalMs, lastRun: 0 });
  }

  public unregister(name: string): void {
    this.ticks.delete(name);
  }

  public start(): void {
    if (this.timer !== null) return;
    this.timer = this.scheduler.setInterval(() => this.tick(), this.cadenceMs);
  }

  public stop(): void {
    if (this.timer === null) return;
    this.scheduler.clearInterval(this.timer);
    this.timer = null;
  }

  public tick(): void {
    const now = this.scheduler.now();
    for (const [name, entry] of this.ticks) {
      if (now - entry.lastRun < entry.intervalMs) continue;
      entry.lastRun = now;
      try {
        entry.callback();
      } catch (error) {
        this.diagnostics.warn(`TickDispatcher error on "${name}".`, error);
      }
    }
  }

  public list(): string[] {
    return [...this.ticks.keys()];
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}

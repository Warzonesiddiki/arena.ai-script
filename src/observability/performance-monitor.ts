import { EventBus, type EventMap } from '../core/event-bus';

export interface HeapSample {
  timestamp: number;
  usedBytes: number | null;
  limitBytes: number | null;
}

export interface PerformanceEvents extends EventMap {
  'performance:mutationRate': { count: number; windowMs: number; overBudget: boolean };
  'performance:heapSample': HeapSample;
}

export interface PerformanceMonitorOptions {
  eventBus?: EventBus<PerformanceEvents>;
  now?: () => number;
  memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
  mutationWindowMs?: number;
  maxMutationsPerWindow?: number;
}

/** Lightweight production metric collector with deterministic regression-test hooks. */
export class PerformanceMonitor {
  private readonly eventBus: EventBus<PerformanceEvents>;
  private readonly now: () => number;
  private readonly memory?: PerformanceMonitorOptions['memory'];
  private readonly mutationWindowMs: number;
  private readonly maxMutationsPerWindow: number;
  private readonly mutationTimestamps: number[] = [];

  public constructor(options: PerformanceMonitorOptions = {}) {
    this.eventBus = options.eventBus ?? new EventBus<PerformanceEvents>();
    this.now = options.now ?? performance.now.bind(performance);
    this.memory = options.memory ?? (performance as Performance & { memory?: PerformanceMonitorOptions['memory'] }).memory;
    this.mutationWindowMs = options.mutationWindowMs ?? 60_000;
    this.maxMutationsPerWindow = options.maxMutationsPerWindow ?? 120;
  }

  public recordMutation(): { count: number; overBudget: boolean } {
    const now = this.now();
    this.mutationTimestamps.push(now);
    while (this.mutationTimestamps[0] !== undefined && this.mutationTimestamps[0] < now - this.mutationWindowMs) {
      this.mutationTimestamps.shift();
    }
    const count = this.mutationTimestamps.length;
    const overBudget = count > this.maxMutationsPerWindow;
    this.eventBus.emit('performance:mutationRate', { count, windowMs: this.mutationWindowMs, overBudget });
    return { count, overBudget };
  }

  public sampleHeap(): HeapSample {
    const sample: HeapSample = {
      timestamp: this.now(),
      usedBytes: finiteOrNull(this.memory?.usedJSHeapSize),
      limitBytes: finiteOrNull(this.memory?.jsHeapSizeLimit),
    };
    this.eventBus.emit('performance:heapSample', sample);
    return sample;
  }

  public assertHeapBudget(maxUsedBytes: number): HeapSample {
    if (!Number.isSafeInteger(maxUsedBytes) || maxUsedBytes <= 0) throw new RangeError('maxUsedBytes must be a positive safe integer.');
    const sample = this.sampleHeap();
    if (sample.usedBytes !== null && sample.usedBytes > maxUsedBytes) {
      throw new PerformanceBudgetError(`Heap usage ${sample.usedBytes} exceeds the ${maxUsedBytes} byte budget.`);
    }
    return sample;
  }
}

export class PerformanceBudgetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PerformanceBudgetError';
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

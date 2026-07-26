import { EventBus } from '../../../src/core/event-bus';
import { PerformanceBudgetError, PerformanceMonitor, type PerformanceEvents } from '../../../src/observability/performance-monitor';

describe('PerformanceMonitor', () => {
  it('reports mutation-rate budget breaches in a rolling window', () => {
    let now = 0;
    const events: number[] = [];
    const bus = new EventBus<PerformanceEvents>();
    bus.on('performance:mutationRate', ({ count }) => events.push(count));
    const monitor = new PerformanceMonitor({ eventBus: bus, now: () => now, mutationWindowMs: 1_000, maxMutationsPerWindow: 2 });

    expect(monitor.recordMutation()).toEqual({ count: 1, overBudget: false });
    now = 100;
    expect(monitor.recordMutation()).toEqual({ count: 2, overBudget: false });
    now = 200;
    expect(monitor.recordMutation()).toEqual({ count: 3, overBudget: true });
    now = 1_500;
    expect(monitor.recordMutation()).toEqual({ count: 1, overBudget: false });
    expect(events).toEqual([1, 2, 3, 1]);
  });

  it('samples optional heap metrics without assuming Chrome exposes performance.memory', () => {
    const monitor = new PerformanceMonitor({
      now: () => 50,
      memory: { usedJSHeapSize: 4_096, jsHeapSizeLimit: 16_384 },
    });
    expect(monitor.sampleHeap()).toEqual({ timestamp: 50, usedBytes: 4_096, limitBytes: 16_384 });

    const unavailable = new PerformanceMonitor({ now: () => 51, memory: {} });
    expect(unavailable.sampleHeap()).toEqual({ timestamp: 51, usedBytes: null, limitBytes: null });
  });

  it('enforces a strict heap budget when Chrome exposes heap metrics', () => {
    const monitor = new PerformanceMonitor({ now: () => 1, memory: { usedJSHeapSize: 2_048 } });
    expect(monitor.assertHeapBudget(2_048)).toEqual(expect.objectContaining({ usedBytes: 2_048 }));
    expect(() => monitor.assertHeapBudget(2_047)).toThrow(PerformanceBudgetError);
    expect(() => monitor.assertHeapBudget(0)).toThrow(RangeError);
  });
});

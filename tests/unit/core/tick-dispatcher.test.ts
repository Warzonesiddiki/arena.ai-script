import { TickDispatcher, type ClockScheduler } from '../../../src/core/tick-dispatcher';

class FakeScheduler implements ClockScheduler {
  public nowValue = 0;
  public callback: (() => void) | null = null;
  public setCalls = 0;
  public clearCalls = 0;

  public now(): number { return this.nowValue; }
  public setInterval(callback: () => void): ReturnType<typeof globalThis.setInterval> {
    this.callback = callback;
    this.setCalls += 1;
    return 1 as unknown as ReturnType<typeof globalThis.setInterval>;
  }
  public clearInterval(): void { this.clearCalls += 1; }
}

describe('TickDispatcher', () => {
  it('runs named work at registered intervals through one central cadence', () => {
    const scheduler = new FakeScheduler();
    const dispatcher = new TickDispatcher({ scheduler, cadenceMs: 100 });
    const fast = jest.fn();
    const slow = jest.fn();

    dispatcher.register('fast', fast, 500);
    dispatcher.register('slow', slow, 1_000);
    dispatcher.start();
    dispatcher.start();

    scheduler.nowValue = 1_000;
    scheduler.callback?.();
    scheduler.nowValue = 1_500;
    scheduler.callback?.();
    scheduler.nowValue = 2_000;
    scheduler.callback?.();

    expect(scheduler.setCalls).toBe(1);
    expect(fast).toHaveBeenCalledTimes(3);
    expect(slow).toHaveBeenCalledTimes(2);
    expect(dispatcher.list()).toEqual(['fast', 'slow']);
    expect(dispatcher.isRunning()).toBe(true);

    dispatcher.stop();
    expect(scheduler.clearCalls).toBe(1);
    expect(dispatcher.isRunning()).toBe(false);
  });

  it('isolates tick failures and validates registration inputs', () => {
    const scheduler = new FakeScheduler();
    const warn = jest.fn();
    const dispatcher = new TickDispatcher({ scheduler, diagnostics: { warn } });
    const healthy = jest.fn();

    expect(() => dispatcher.register('', () => undefined, 1)).toThrow(TypeError);
    expect(() => dispatcher.register('bad', () => undefined, 0)).toThrow(RangeError);

    dispatcher.register('broken', () => { throw new Error('failure'); }, 100);
    dispatcher.register('healthy', healthy, 100);
    scheduler.nowValue = 100;
    dispatcher.tick();

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('TickDispatcher error on "broken".', expect.any(Error));

    dispatcher.unregister('broken');
    expect(dispatcher.list()).toEqual(['healthy']);
  });
});

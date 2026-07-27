import { EventBus } from '../../../src/core/event-bus';

interface Events {
  'agent:start': { id: string };
  'agent:result': { id: string; ok: boolean };
  boot: { version: string };
}

const diagnostics = (): { warn: jest.Mock } => ({ warn: jest.fn() });

describe('EventBus v2', () => {
  it('honours priority and exact/namespace/global wildcard listeners', () => {
    const calls: string[] = [];
    const bus = new EventBus<Events>();

    bus.on('*', () => calls.push('global'));
    bus.on('agent:*', () => calls.push('namespace'), { priority: 3 });
    bus.on('agent:start', ({ id }) => calls.push(`exact:${id}`), { priority: 5 });

    bus.emit('agent:start', { id: 'agent-1' });

    expect(calls).toEqual(['exact:agent-1', 'namespace', 'global']);
    expect(bus.getStats('agent:start')).toBe(1);
    expect(bus.getStats()).toEqual({ 'agent:start': 1 });
  });

  it('removes only each executed one-shot listener and supports unsubscription', () => {
    const bus = new EventBus<Events>();
    const first = jest.fn();
    const second = jest.fn();
    const persistent = jest.fn();

    bus.once('boot', first);
    bus.once('boot', second);
    const unsubscribe = bus.on('boot', persistent);

    bus.emit('boot', { version: '8.0.0' });
    unsubscribe();
    bus.emit('boot', { version: '8.0.1' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(persistent).toHaveBeenCalledTimes(1);
  });

  it('isolates synchronous and rejected asynchronous handler failures', async () => {
    const reporter = diagnostics();
    const bus = new EventBus<Events>(reporter);
    const healthy = jest.fn();

    bus.on('boot', () => {
      throw new Error('sync failure');
    });
    bus.on('boot', async () => {
      throw new Error('async failure');
    });
    bus.on('boot', healthy);

    bus.emit('boot', { version: '8.0.0' });
    await Promise.resolve();
    await Promise.resolve();

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(reporter.warn).toHaveBeenCalledTimes(2);
  });

  it('awaits async listeners in priority order without breaking after an error', async () => {
    const reporter = diagnostics();
    const bus = new EventBus<Events>(reporter);
    const calls: string[] = [];

    bus.on('agent:result', async () => calls.push('low'), { priority: 1 });
    bus.on('agent:result', async () => {
      calls.push('high');
      throw new Error('review failed');
    }, { priority: 5 });

    await bus.emitAsync('agent:result', { id: 'agent-1', ok: true });

    expect(calls).toEqual(['high', 'low']);
    expect(reporter.warn).toHaveBeenCalledTimes(1);
  });

  it('clears listeners and resets counters', () => {
    const bus = new EventBus<Events>();
    const listener = jest.fn();
    bus.on('boot', listener);
    bus.emit('boot', { version: '8.0.0' });
    bus.clear('boot');
    bus.emit('boot', { version: '8.0.1' });
    bus.resetStats();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.getStats()).toEqual({});
  });
  it('off() is safe for unknown events and removes only the named handler', () => {
    const bus = new EventBus<Events>();
    const kept = jest.fn();
    const removed = jest.fn();

    // Removing from an event with no listeners must not throw.
    expect(() => bus.off('boot', removed)).not.toThrow();

    bus.on('boot', kept);
    bus.on('boot', removed);
    bus.off('boot', removed);
    bus.emit('boot', { version: '8.0.0' });

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();

    // Removing the last listener drops the event entry entirely.
    bus.off('boot', kept);
    bus.emit('boot', { version: '8.0.1' });
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('clears a single event without disturbing the others', () => {
    const bus = new EventBus<Events>();
    const bootHandler = jest.fn();
    const agentHandler = jest.fn();
    bus.on('boot', bootHandler);
    bus.on('agent:start', agentHandler);

    bus.clear('boot');
    bus.emit('boot', { version: '8.0.0' });
    bus.emit('agent:start', { id: 'agent-1' });

    expect(bootHandler).not.toHaveBeenCalled();
    expect(agentHandler).toHaveBeenCalledTimes(1);
  });

  it('reports per-event and aggregate statistics', () => {
    const bus = new EventBus<Events>();
    bus.on('boot', jest.fn());
    bus.emit('boot', { version: '8.0.0' });
    bus.emit('boot', { version: '8.0.1' });

    expect(bus.getStats('boot')).toBe(2);
    expect(bus.getStats()).toEqual(expect.objectContaining({ boot: 2 }));
    // An event that never fired reports zero rather than undefined.
    expect(bus.getStats('agent:start')).toBe(0);

    bus.resetStats();
    expect(bus.getStats('boot')).toBe(0);
  });

  it('emitting an event with no listeners is a no-op', async () => {
    const bus = new EventBus<Events>();
    expect(() => bus.emit('boot', { version: '8.0.0' })).not.toThrow();
    await expect(bus.emitAsync('boot', { version: '8.0.0' })).resolves.toBeUndefined();
    // Emissions still count even with nobody listening.
    expect(bus.getStats('boot')).toBe(2);
  });
});

import { ModuleRegistry } from '../../../src/core/module-registry';

const diagnostics = (): { warn: jest.Mock } => ({ warn: jest.fn() });

describe('ModuleRegistry', () => {
  it('boots in phase and registration order while isolating module failures', async () => {
    const reporter = diagnostics();
    const registry = new ModuleRegistry(reporter);
    const calls: string[] = [];

    registry.register('config', { phase: 0, init: () => calls.push('config') });
    registry.register('broken-ui', {
      phase: 1,
      init: () => {
        calls.push('broken-ui');
        throw new Error('unavailable');
      },
    });
    registry.register('healthy-ui', { phase: 1, init: async () => { calls.push('healthy-ui'); } });

    const report = await registry.boot();

    expect(calls).toEqual(['config', 'broken-ui', 'healthy-ui']);
    expect(report.total).toBe(3);
    expect(report.ready).toBe(2);
    expect(report.errored).toBe(1);
    expect(report.phases[1]).toEqual({ total: 2, ready: 1, errored: 1 });
    expect(registry.getStatus('broken-ui')).toBe('errored');
    expect(registry.getError('broken-ui')).toBeInstanceOf(Error);
    expect(reporter.warn).toHaveBeenCalledWith('Module "broken-ui" failed to initialize.', expect.any(Error));
  });

  it('rejects duplicate names and warns about immediate dependency hazards', () => {
    const reporter = diagnostics();
    const registry = new ModuleRegistry(reporter);

    expect(registry.register('a', { deps: ['a'] })).toBe(true);
    expect(registry.register('a', {})).toBe(false);
    expect(registry.register('b', { deps: ['a'] })).toBe(true);
    expect(registry.register('c', { deps: ['c'] })).toBe(true);

    expect(reporter.warn).toHaveBeenCalledWith('Module "a" depends on itself.');
    expect(reporter.warn).toHaveBeenCalledWith('Module "a" is already registered.');
    expect(reporter.warn).toHaveBeenCalledWith('Module "c" depends on itself.');
  });

  it('destroys every module despite teardown errors in reverse boot order', async () => {
    const reporter = diagnostics();
    const registry = new ModuleRegistry(reporter);
    const calls: string[] = [];

    registry.register('first', { phase: 0, destroy: () => calls.push('first') });
    registry.register('second', {
      phase: 2,
      destroy: () => {
        calls.push('second');
        throw new Error('teardown failure');
      },
    });
    registry.register('third', { phase: 2, destroy: () => calls.push('third') });

    await registry.destroyAll();

    expect(calls).toEqual(['third', 'second', 'first']);
    expect(registry.getStatus('first')).toBe('destroyed');
    expect(registry.getStatus('second')).toBe('destroyed');
    expect(reporter.warn).toHaveBeenCalledWith('Module "second" failed to destroy.', expect.any(Error));
  });
});

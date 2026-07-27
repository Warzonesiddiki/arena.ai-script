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
  it('refuses a module with a blank name', () => {
    const reporter = diagnostics();
    const registry = new ModuleRegistry(reporter);

    expect(registry.register('   ', { phase: 0, init: () => undefined })).toBe(false);
    expect(registry.register('', { phase: 0, init: () => undefined })).toBe(false);
    expect(reporter.warn).toHaveBeenCalledWith(expect.stringContaining('without a name'));
    expect(registry.getAll()).toHaveLength(0);
  });

  it('warns about a self-dependency and a mutual circular dependency', () => {
    const reporter = diagnostics();
    const registry = new ModuleRegistry(reporter);

    registry.register('lonely', { phase: 0, deps: ['lonely'], init: () => undefined });
    expect(reporter.warn).toHaveBeenCalledWith(expect.stringContaining('depends on itself'));

    registry.register('alpha', { phase: 0, deps: ['beta'], init: () => undefined });
    registry.register('beta', { phase: 0, deps: ['alpha'], init: () => undefined });
    expect(reporter.warn).toHaveBeenCalledWith(expect.stringContaining('Circular dependency'));
  });

  it('exposes lookup helpers that fail soft for unknown modules', () => {
    const registry = new ModuleRegistry(diagnostics());
    registry.register('known', { phase: 1, init: () => undefined });

    expect(registry.getModule('known')).toEqual(expect.objectContaining({ name: 'known' }));
    // Unknown names return null rather than throwing, so a caller cannot
    // accidentally take down boot with a typo.
    expect(registry.getModule('missing')).toBeNull();
    expect(registry.getStatus('missing')).toBeNull();
    expect(registry.getError('missing')).toBeNull();
    expect(registry.getByPhase(1).map((entry) => entry.name)).toEqual(['known']);
    expect(registry.getByPhase(4)).toEqual([]);
  });

  it('records the failure reason for a module that throws during boot', async () => {
    const registry = new ModuleRegistry(diagnostics());
    registry.register('exploder', { phase: 0, init: () => { throw new Error('init failed'); } });

    const report = await registry.boot();

    expect(registry.getStatus('exploder')).toBe('errored');
    expect(registry.getError('exploder')).toEqual(expect.objectContaining({ message: 'init failed' }));
    expect(report.errored).toBe(1);
    expect(report.ready).toBe(0);
  });

  it('boots an empty registry without error', async () => {
    const report = await new ModuleRegistry(diagnostics()).boot();
    expect(report).toEqual(expect.objectContaining({ total: 0, ready: 0, errored: 0 }));
  });
});

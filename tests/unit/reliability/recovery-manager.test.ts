import { EventBus } from '../../../src/core/event-bus';
import { ErrorRecoveryManager, type RecoveryEvents } from '../../../src/reliability/recovery-manager';
import { Tracer } from '../../../src/observability/tracer';

describe('ErrorRecoveryManager', () => {
  it('retries transient failures with exponential delays and records recovery', async () => {
    const delays: number[] = [];
    const recovered = jest.fn();
    const bus = new EventBus<RecoveryEvents>();
    bus.on('recovery:recovered', recovered);
    const manager = new ErrorRecoveryManager({ eventBus: bus, sleep: async (delay) => { delays.push(delay); } });
    const action = jest.fn()
      .mockRejectedValueOnce(new Error('temporary-1'))
      .mockRejectedValueOnce(new Error('temporary-2'))
      .mockResolvedValue('complete');

    await expect(manager.execute('bridge.send', action, { fallback: () => 'fallback', baseDelayMs: 10 })).resolves.toBe('complete');
    expect(action).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]);
    expect(recovered).toHaveBeenCalledWith(expect.objectContaining({ operation: 'bridge.send', attempt: 3 }));
  });

  it('notifies and returns a fallback after terminal/non-retryable failure', async () => {
    const notifier = { notify: jest.fn() };
    const failed = jest.fn();
    const bus = new EventBus<RecoveryEvents>();
    bus.on('recovery:failed', failed);
    const manager = new ErrorRecoveryManager({ eventBus: bus, notifier, tracer: new Tracer({ idFactory: () => 'trace' }) });

    await expect(manager.execute('storage.read', async () => { throw new Error('corrupt'); }, {
      maxAttempts: 4,
      retryable: () => false,
      fallback: () => ({ recovered: true }),
    })).resolves.toEqual({ recovered: true });

    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', correlationId: 'trace' }));
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ operation: 'storage.read', attempts: 4, error: 'corrupt' }));
  });

  it('installs removable global handlers that turn errors into traceable notifications', () => {
    const target = new EventTarget();
    const notifier = { notify: jest.fn() };
    const manager = new ErrorRecoveryManager({ notifier });
    const uninstall = manager.installGlobalHandlers(target);
    const event = Object.assign(new Event('error'), { error: new Error('global boom') });

    target.dispatchEvent(event);
    uninstall();
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ignored') }));

    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('global boom') }));
  });
});

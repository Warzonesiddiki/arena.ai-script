import { BridgeMessageType, createEnvelope } from '../../../src/bridge/protocol';
import { installChromeMock } from '../../support/chrome-mock';
import { installWebCrypto } from '../../support/webcrypto';

/**
 * Drains pending work so async message handlers can settle. The orchestration
 * path now touches IndexedDB (audit + durable state), which needs real macrotask
 * ticks, not just microtasks.
 */
async function flush(iterations = 12): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('Manifest V3 service worker', () => {
  beforeAll(installWebCrypto);
  beforeEach(() => {
    jest.resetModules();
  });

  it('registers lifecycle listeners and configures the Side Panel on install', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');

    expect(mock.installedListeners).toHaveLength(1);
    expect(mock.startupListeners).toHaveLength(1);
    expect(mock.messageListeners).toHaveLength(1);
    expect(mock.alarmListeners).toHaveLength(1);

    mock.installedListeners[0]?.();
    await Promise.resolve();

    expect(mock.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('returns a narrow health response only for the known message shape', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const respond = jest.fn();

    mock.messageListeners[0]?.(
      { type: 'aamp:health-check' },
      { id: 'aamp-test-extension' } as chrome.runtime.MessageSender,
      respond,
    );
    mock.messageListeners[0]?.({ type: 'unexpected' }, {} as chrome.runtime.MessageSender, respond);
    mock.messageListeners[0]?.(
      { type: 'aamp:health-check' },
      { id: 'another-extension' } as chrome.runtime.MessageSender,
      respond,
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({ ok: true, version: '8.0.0', platform: 'manifest-v3' });
  });

  it('returns a bounded runtime status only to extension-owned pages', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const respond = jest.fn();

    listener({ type: 'aamp:runtime-status' }, { id: 'aamp-test-extension' } as chrome.runtime.MessageSender, respond);
    listener({ type: 'aamp:runtime-status' }, { id: 'other' } as chrome.runtime.MessageSender, respond);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      status: expect.objectContaining({ version: '8.0.0', bridge: expect.objectContaining({ connected: false }) }),
    }));
  });

  it('validates orchestration create/status/approve messages from extension-owned pages', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    // The orchestration path is asynchronous: it now runs a policy check and
    // writes an audit record before responding.
    listener({ type: 'aamp:orchestration:status' }, sender, respond);
    await flush();
    listener({ type: 'aamp:orchestration:create', goal: 'Add Phase 3E tests' }, sender, respond);
    await flush();
    listener({ type: 'aamp:orchestration:approve', taskId: 'planner-1' }, sender, respond);
    await flush();

    expect(respond).toHaveBeenCalledTimes(3);
    expect(respond.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ ok: true, orchestration: expect.objectContaining({ active: false }) }));
    expect(respond.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ ok: true, orchestration: expect.objectContaining({ active: true, estimatedCostUsd: 0.4 }) }));
    expect(respond.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ ok: true, orchestration: expect.objectContaining({ active: true }) }));
  });

  it('rejects malformed orchestration messages without dispatching the service', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    listener({ type: 'aamp:orchestration:create', goal: '' }, sender, respond);
    listener({ type: 'aamp:orchestration:create', goal: 'ok', extra: true }, sender, respond);
    listener({ type: 'aamp:orchestration:approve', taskId: '../coder-1' }, sender, respond);
    listener({ type: 'aamp:orchestration:status', extra: true }, sender, respond);
    listener({ type: 'aamp:orchestration:create', goal: 'ok' }, { id: 'other' } as chrome.runtime.MessageSender, respond);
    await flush();

    expect(respond).not.toHaveBeenCalled();
  });

  it('returns a guarded orchestration error for invalid but well-formed approval order', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    listener({ type: 'aamp:orchestration:create', goal: 'Add ordering checks' }, sender, respond);
    await flush();
    listener({ type: 'aamp:orchestration:approve', taskId: 'coder-1' }, sender, respond);
    await flush();

    expect(respond).toHaveBeenCalledTimes(2);
    expect(respond.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('planner-1') }));
  });

  it('handles only a signed-bridge handshake from the extension content script', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');

    const response = await new Promise<unknown>((resolve) => {
      expect(listener(
        { type: BridgeMessageType.handshake, protocol: 1 },
        {
          id: 'aamp-test-extension',
          tab: { id: 7 },
          frameId: 0,
          url: 'https://arena.ai/agent/task',
        } as chrome.runtime.MessageSender,
        resolve,
      )).toBe(true);
    });

    expect(response).toEqual(expect.objectContaining({ ok: true, protocol: 1 }));
  });

  it('ignores unrelated alarms without creating schedule or trigger due runs', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const alarmListener = mock.alarmListeners[0];
    if (!alarmListener) throw new Error('alarm listener was not registered');

    alarmListener({ name: 'unrelated-alarm', scheduledTime: 1_000 } as chrome.alarms.Alarm);
    await Promise.resolve();

    expect(mock.createAlarm).not.toHaveBeenCalled();
  });

  it('returns a bounded read-only insight snapshot that actions nothing', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    listener({ type: 'aamp:orchestration:create', goal: 'Review insight wiring' }, sender, respond);
    await flush();
    listener({ type: 'aamp:orchestration:insights' }, sender, respond);
    await flush();

    const insightResponse = respond.mock.calls[1]?.[0] as { ok: boolean; insights?: Record<string, unknown> };
    expect(insightResponse.ok).toBe(true);
    expect(insightResponse.insights).toEqual(expect.objectContaining({
      autoActioned: false,
      focus: expect.objectContaining({ headline: expect.any(String) }),
      health: expect.objectContaining({ status: expect.any(String) }),
      recovery: expect.objectContaining({ autoExecutable: false }),
    }));
  });

  it('routes a fired schedule alarm into an approval-required trigger due run', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const alarmListener = mock.alarmListeners[0];
    if (!alarmListener) throw new Error('alarm listener was not registered');

    // An alarm for a schedule that was never created must stay inert.
    alarmListener({ name: 'aamp:schedule:never-created', scheduledTime: 1_000 } as chrome.alarms.Alarm);
    await flush();

    // Nothing executed, and no new alarm was scheduled as a side effect.
    expect(mock.createAlarm).not.toHaveBeenCalled();
  });

  it('reports a Side Panel configuration failure through recovery instead of throwing', async () => {
    const mock = installChromeMock('8.0.0');
    mock.setPanelBehavior.mockRejectedValueOnce(new Error('sidePanel unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    await import('../../../src/background/service-worker');

    // An install-time failure must not take the worker down.
    expect(() => mock.installedListeners[0]?.()).not.toThrow();
    await flush();
    warn.mockRestore();
  });

  it('restores durable control state on browser startup', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    listener({ type: 'aamp:orchestration:create', goal: 'Persist across suspension' }, sender, respond);
    await flush();

    // Startup triggers a restore path; it must settle without throwing.
    expect(() => mock.startupListeners[0]?.()).not.toThrow();
    await flush();

    listener({ type: 'aamp:orchestration:status' }, sender, respond);
    await flush();
    expect(respond.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ ok: true }));
  });

  it('returns a guarded error when an orchestration request cannot be served', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = { id: 'aamp-test-extension' } as chrome.runtime.MessageSender;
    const respond = jest.fn();

    // Approving with no active plan is well-formed but cannot succeed.
    listener({ type: 'aamp:orchestration:approve', taskId: 'planner-1' }, sender, respond);
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ ok: false, error: expect.any(String) }));
  });

  it('ignores bridge traffic that is neither a handshake nor an event', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const respond = jest.fn();

    const handled = listener(
      { type: 'aamp:bridge:not-a-real-type' },
      { id: 'aamp-test-extension', tab: { id: 3 }, frameId: 0, url: 'https://arena.ai/x' } as chrome.runtime.MessageSender,
      respond,
    );

    expect(handled).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
  });

  it('surfaces an unhandled worker error as a native recovery notification', async () => {
    const mock = installChromeMock('8.0.0');
    const errorLog = jest.spyOn(console, 'error').mockImplementation();
    await import('../../../src/background/service-worker');

    // installGlobalHandlers registers listeners on globalThis via addEventListener.
    globalThis.dispatchEvent(new ErrorEvent('error', { message: 'worker exploded' }));
    await flush();

    // The failure is reported to the user rather than swallowed.
    expect(mock.createNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: expect.any(String) }),
    );
    errorLog.mockRestore();
  });

  it('refuses a forged bridge envelope and never reports it as connected', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');
    const listener = mock.messageListeners[0];
    if (!listener) throw new Error('worker listener was not registered');
    const sender = {
      id: 'aamp-test-extension',
      tab: { id: 11 },
      frameId: 0,
      url: 'https://arena.ai/agent/task',
    } as chrome.runtime.MessageSender;

    const handshake = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: BridgeMessageType.handshake, protocol: 1 }, sender, resolve as (value?: unknown) => void);
    });
    expect(handshake).toEqual(expect.objectContaining({ ok: true }));

    // A well-shaped envelope carrying a forged signature must be rejected.
    const forged = await new Promise<unknown>((resolve) => {
      const handled = listener(
        {
          type: BridgeMessageType.event,
          envelope: {
            // A structurally valid envelope built with the real helper, then
            // given a signature that was never produced by the session secret.
            ...createEnvelope(String(handshake.sessionId ?? 'unknown'), 'content-to-worker', 'page.snapshot', {}),
            signature: 'Zm9yZ2VkU2lnbmF0dXJlRm9yVGVzdGluZ1B1cnBvc2VzT25seQ==',
          },
        },
        sender,
        resolve,
      );
      // An unhandled shape would return undefined and never resolve.
      expect(handled).toBe(true);
    });
    expect(forged).toEqual(expect.objectContaining({ ok: false }));

    const respond = jest.fn();
    listener({ type: 'aamp:runtime-status' }, { id: 'aamp-test-extension' } as chrome.runtime.MessageSender, respond);
    // A refused envelope must never be reported as a connected bridge.
    expect(respond.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      ok: true,
      status: expect.objectContaining({ bridge: expect.objectContaining({ connected: false }) }),
    }));
  });

  it('runs the startup lifecycle callback without retaining state', async () => {
    const mock = installChromeMock('8.0.0');
    const lifecycleLog = jest.spyOn(console, 'info').mockImplementation();
    await import('../../../src/background/service-worker');

    mock.startupListeners[0]?.();

    expect(lifecycleLog).toHaveBeenCalledWith(expect.stringMatching(/^\[AAMP\]\[[^\]]+\] browser startup$/u), expect.objectContaining({ version: '8.0.0' }));
  });
});

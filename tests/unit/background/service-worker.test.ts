import { BridgeMessageType } from '../../../src/bridge/protocol';
import { installChromeMock } from '../../support/chrome-mock';
import { installWebCrypto } from '../../support/webcrypto';

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

    listener({ type: 'aamp:orchestration:status' }, sender, respond);
    listener({ type: 'aamp:orchestration:create', goal: 'Add Phase 3E tests' }, sender, respond);
    listener({ type: 'aamp:orchestration:approve', taskId: 'planner-1' }, sender, respond);

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
    listener({ type: 'aamp:orchestration:approve', taskId: 'coder-1' }, sender, respond);

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

  it('runs the startup lifecycle callback without retaining state', async () => {
    const mock = installChromeMock('8.0.0');
    const lifecycleLog = jest.spyOn(console, 'info').mockImplementation();
    await import('../../../src/background/service-worker');

    mock.startupListeners[0]?.();

    expect(lifecycleLog).toHaveBeenCalledWith(expect.stringMatching(/^\[AAMP\]\[[^\]]+\] browser startup$/u), expect.objectContaining({ version: '8.0.0' }));
  });
});

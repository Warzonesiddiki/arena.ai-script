import { installChromeMock } from '../../support/chrome-mock';

describe('Manifest V3 service worker', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('registers lifecycle listeners and configures the Side Panel on install', async () => {
    const mock = installChromeMock('8.0.0');
    await import('../../../src/background/service-worker');

    expect(mock.installedListeners).toHaveLength(1);
    expect(mock.startupListeners).toHaveLength(1);
    expect(mock.messageListeners).toHaveLength(1);

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
});

type InstalledListener = () => void;
type StartupListener = () => void;
type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

export interface ChromeMock {
  readonly installedListeners: InstalledListener[];
  readonly startupListeners: StartupListener[];
  readonly messageListeners: MessageListener[];
  readonly chrome: typeof chrome;
  readonly setPanelBehavior: jest.Mock<Promise<void>, [chrome.sidePanel.PanelBehavior]>;
}

/**
 * Small, explicit Chrome API mock for unit tests. Add APIs only when a module
 * uses them so test code cannot silently depend on an unmodelled browser API.
 */
export function installChromeMock(version = '8.0.0'): ChromeMock {
  const installedListeners: InstalledListener[] = [];
  const startupListeners: StartupListener[] = [];
  const messageListeners: MessageListener[] = [];
  const setPanelBehavior = jest.fn<Promise<void>, [chrome.sidePanel.PanelBehavior]>().mockResolvedValue();

  const mock = {
    runtime: {
      id: 'aamp-test-extension',
      getManifest: jest.fn(() => ({ version })),
      onInstalled: { addListener: jest.fn((listener: InstalledListener) => installedListeners.push(listener)) },
      onStartup: { addListener: jest.fn((listener: StartupListener) => startupListeners.push(listener)) },
      onMessage: { addListener: jest.fn((listener: MessageListener) => messageListeners.push(listener)) },
      sendMessage: jest.fn(),
    },
    sidePanel: { setPanelBehavior },
  };

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    writable: true,
    value: mock,
  });

  return {
    installedListeners,
    startupListeners,
    messageListeners,
    chrome: mock as unknown as typeof chrome,
    setPanelBehavior,
  };
}

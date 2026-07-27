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
  readonly alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void>;
  readonly setPanelBehavior: jest.Mock<Promise<void>, [chrome.sidePanel.PanelBehavior]>;
  readonly sendTabMessage: jest.Mock<Promise<unknown>, [number, unknown, { frameId?: number } | undefined]>;
  readonly createAlarm: jest.Mock<void, [string, chrome.alarms.AlarmCreateInfo]>;
  readonly clearAlarm: jest.Mock<Promise<boolean>, [string]>;
  readonly openOptionsPage: jest.Mock<Promise<void>, []>;
  readonly createNotification: jest.Mock<Promise<string>, [string, chrome.notifications.NotificationOptions]>;
  /** In-memory chrome.storage.local backing store. */
  readonly storageValues: Map<string, unknown>;
}

/**
 * Small, explicit Chrome API mock for unit tests. Add APIs only when a module
 * uses them so test code cannot silently depend on an unmodelled browser API.
 */
export function installChromeMock(version = '8.0.0'): ChromeMock {
  const installedListeners: InstalledListener[] = [];
  const startupListeners: StartupListener[] = [];
  const messageListeners: MessageListener[] = [];
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  const setPanelBehavior = jest.fn<Promise<void>, [chrome.sidePanel.PanelBehavior]>().mockResolvedValue();
  const sendTabMessage = jest.fn<Promise<unknown>, [number, unknown, { frameId?: number } | undefined]>();
  const createAlarm = jest.fn<void, [string, chrome.alarms.AlarmCreateInfo]>();
  const clearAlarm = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);
  const openOptionsPage = jest.fn<Promise<void>, []>().mockResolvedValue();
  const createNotification = jest.fn<Promise<string>, [string, chrome.notifications.NotificationOptions]>().mockResolvedValue('notification-1');
  const storageValues = new Map<string, unknown>();

  const mock = {
    runtime: {
      id: 'aamp-test-extension',
      getManifest: jest.fn(() => ({ version })),
      onInstalled: { addListener: jest.fn((listener: InstalledListener) => installedListeners.push(listener)) },
      onStartup: { addListener: jest.fn((listener: StartupListener) => startupListeners.push(listener)) },
      onMessage: { addListener: jest.fn((listener: MessageListener) => messageListeners.push(listener)) },
      sendMessage: jest.fn(),
      openOptionsPage,
    },
    // The worker now persists audit and control state, so storage must be modelled.
    storage: {
      local: {
        get: jest.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
          const requested = typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : keys
                ? Object.keys(keys)
                : [...storageValues.keys()];
          return Object.fromEntries(requested.flatMap((key) => storageValues.has(key) ? [[key, storageValues.get(key)]] : []));
        }),
        set: jest.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) storageValues.set(key, value);
        }),
        remove: jest.fn(async (keys: string | string[]) => {
          for (const key of typeof keys === 'string' ? [keys] : keys) storageValues.delete(key);
        }),
      },
    },
    sidePanel: { setPanelBehavior },
    // The worker routes recovery failures through native notifications.
    notifications: { create: createNotification },
    tabs: { sendMessage: sendTabMessage },
    alarms: {
      create: createAlarm,
      clear: clearAlarm,
      onAlarm: { addListener: jest.fn((listener: (alarm: chrome.alarms.Alarm) => void) => alarmListeners.push(listener)) },
    }, 
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
    alarmListeners,
    chrome: mock as unknown as typeof chrome,
    setPanelBehavior,
    sendTabMessage,
    createAlarm,
    clearAlarm,
    openOptionsPage,
    createNotification,
    storageValues,
  };
}

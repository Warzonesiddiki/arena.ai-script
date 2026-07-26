export type NotificationSeverity = 'info' | 'warning' | 'error';
export type NotificationVerbosity = 'all' | 'important' | 'errors';

export interface NativeNotificationApi {
  create(id: string, options: chrome.notifications.NotificationCreateOptions): Promise<string>;
}

export interface NotificationInput {
  title: string;
  message: string;
  severity: NotificationSeverity;
  groupKey?: string;
}

export interface NotificationEntry extends NotificationInput {
  id: string;
  timestamp: number;
  count: number;
}

export interface NotificationCenterOptions {
  nativeApi?: NativeNotificationApi;
  verbosity?: NotificationVerbosity;
  groupWindowMs?: number;
  now?: () => number;
  idFactory?: () => string;
}

/** Groups noisy operational messages and uses native notifications only when policy permits. */
export class NotificationCenter {
  private readonly nativeApi?: NativeNotificationApi;
  private readonly groupWindowMs: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private verbosity: NotificationVerbosity;
  private readonly history: NotificationEntry[] = [];
  private readonly recentByGroup = new Map<string, NotificationEntry>();

  public constructor(options: NotificationCenterOptions = {}) {
    this.nativeApi = options.nativeApi;
    this.verbosity = options.verbosity ?? 'important';
    this.groupWindowMs = options.groupWindowMs ?? 15_000;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `notification-${Math.random().toString(36).slice(2, 10)}`);
  }

  public setVerbosity(verbosity: NotificationVerbosity): void {
    this.verbosity = verbosity;
  }

  public async notify(input: NotificationInput): Promise<NotificationEntry | null> {
    validateInput(input);
    if (!isVisibleAtVerbosity(input.severity, this.verbosity)) return null;

    const timestamp = this.now();
    const groupKey = input.groupKey ?? `${input.severity}:${input.title}`;
    const previous = this.recentByGroup.get(groupKey);
    const entry = previous && timestamp - previous.timestamp <= this.groupWindowMs
      ? { ...previous, message: input.message.slice(0, 1_024), timestamp, count: previous.count + 1 }
      : { ...input, id: this.idFactory(), message: input.message.slice(0, 1_024), timestamp, count: 1 };

    this.recentByGroup.set(groupKey, entry);
    if (previous) {
      const index = this.history.findIndex((item) => item.id === previous.id);
      if (index >= 0) this.history[index] = entry;
    } else {
      this.history.unshift(entry);
      if (this.history.length > 100) this.history.pop();
    }

    if (this.nativeApi) {
      await this.nativeApi.create(entry.id, {
        type: 'basic',
        iconUrl: 'icons/aamp-128.png',
        title: entry.title,
        message: entry.count > 1 ? `${entry.message} (${entry.count} similar events)` : entry.message,
        priority: entry.severity === 'error' ? 2 : entry.severity === 'warning' ? 1 : 0,
      });
    }
    return entry;
  }

  public getHistory(): readonly NotificationEntry[] {
    return Object.freeze([...this.history]);
  }
}

function isVisibleAtVerbosity(severity: NotificationSeverity, verbosity: NotificationVerbosity): boolean {
  return verbosity === 'all' || (verbosity === 'important' && severity !== 'info') || severity === 'error';
}

function validateInput(input: NotificationInput): void {
  if (!input.title.trim() || !input.message.trim()) throw new TypeError('Notifications require non-empty title and message.');
  if (input.severity !== 'info' && input.severity !== 'warning' && input.severity !== 'error') throw new TypeError('Invalid notification severity.');
}

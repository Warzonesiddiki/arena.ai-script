import { StorageLayer } from '../storage/storage-layer';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'scheduling:agent-schedules:v1';
const ALARM_PREFIX = 'aamp:schedule:';
const MAX_SCHEDULES = 50;
const MAX_GOAL_CHARS = 1_000;
const MAX_DUE_RUNS = 100;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 365 * 24 * 60;

export type ScheduleCadence =
  | { type: 'once'; runAt: number }
  | { type: 'interval'; startAt: number; intervalMinutes: number; maxRuns?: number }
  | { type: 'daily'; firstRunAt: number; timeOfDayMinutes: number; maxRuns?: number }
  | { type: 'weekly'; firstRunAt: number; dayOfWeek: number; timeOfDayMinutes: number; maxRuns?: number };

export interface ScheduleInput {
  id?: string;
  planId: string;
  goal: string;
  cadence: ScheduleCadence;
  approvedByHuman: true;
  enabled?: boolean;
}

export interface ScheduledAgentDefinition {
  id: string;
  planId: string;
  goal: string;
  cadence: ScheduleCadence;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastFiredAt: number | null;
  runCount: number;
  approvalRequired: true;
}

export interface ScheduledAgentDueRun {
  id: string;
  scheduleId: string;
  planId: string;
  goal: string;
  dueAt: number;
  firedAt: number;
  approvedForExecution: false;
}

export interface ScheduleBook {
  schemaVersion: typeof SCHEMA_VERSION;
  schedules: readonly ScheduledAgentDefinition[];
  dueRuns: readonly ScheduledAgentDueRun[];
}

export interface ChromeAlarmApi {
  create(name: string, alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): void | Promise<void>;
  clear(name: string): Promise<boolean> | boolean;
}

export interface ScheduleManagerOptions {
  storage?: StorageLayer;
  alarms?: ChromeAlarmApi;
  storageKey?: string;
  now?: () => number;
  idFactory?: () => string;
}

export class SchedulePolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SchedulePolicyError';
  }
}

/**
 * Phase 5B deterministic schedule registry.
 *
 * Alarms create approval-required due runs only. They never launch tabs, invoke
 * models, execute tools, approve tasks, or mutate Arena content.
 */
export class ScheduledAgentManager {
  private readonly storage: StorageLayer;
  private readonly alarms: ChromeAlarmApi;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private book: ScheduleBook | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: ScheduleManagerOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.alarms = options.alarms ?? chromeAlarmAdapter();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `schedule-${Math.random().toString(36).slice(2, 10)}`);
  }

  public async initialize(): Promise<void> {
    if (this.book) return;
    const stored = await this.storage.getLarge<ScheduleBook>(this.storageKey);
    this.book = stored ? validateBook(stored) : { schemaVersion: SCHEMA_VERSION, schedules: [], dueRuns: [] };
    await this.syncAlarms();
  }

  public async create(input: ScheduleInput): Promise<ScheduledAgentDefinition> {
    if (input.approvedByHuman !== true) throw new SchedulePolicyError('Creating a schedule requires explicit human approval.');
    return this.runMutation(async () => {
      await this.initialize();
      if (this.book!.schedules.length >= MAX_SCHEDULES) throw new SchedulePolicyError(`At most ${MAX_SCHEDULES} schedules are supported.`);
      const timestamp = this.now();
      const schedule = sanitizeScheduleInput(input, input.id ?? this.idFactory(), timestamp);
      if (this.book!.schedules.some((candidate) => candidate.id === schedule.id)) throw new SchedulePolicyError(`Schedule "${schedule.id}" already exists.`);
      this.book = { ...this.book!, schedules: [...this.book!.schedules, schedule].sort((left, right) => left.id.localeCompare(right.id)) };
      await this.persist();
      await this.syncAlarm(schedule);
      return cloneSchedule(schedule);
    });
  }

  public async setEnabled(scheduleId: string, enabled: boolean, approvedByHuman: true): Promise<ScheduledAgentDefinition> {
    if (approvedByHuman !== true) throw new SchedulePolicyError('Changing schedule state requires explicit human approval.');
    validateIdentifier(scheduleId, 'scheduleId');
    return this.runMutation(async () => {
      await this.initialize();
      const current = this.requireSchedule(scheduleId);
      const nextRunAt = enabled ? computeNextRun(current.cadence, this.now(), current.runCount) : null;
      const updated: ScheduledAgentDefinition = { ...current, enabled, nextRunAt, updatedAt: this.now() };
      this.replaceSchedule(updated);
      await this.persist();
      await this.syncAlarm(updated);
      return cloneSchedule(updated);
    });
  }

  public async remove(scheduleId: string, approvedByHuman: true): Promise<boolean> {
    if (approvedByHuman !== true) throw new SchedulePolicyError('Removing a schedule requires explicit human approval.');
    validateIdentifier(scheduleId, 'scheduleId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.schedules.length;
      this.book = {
        ...this.book!,
        schedules: this.book!.schedules.filter((schedule) => schedule.id !== scheduleId),
        dueRuns: this.book!.dueRuns.filter((run) => run.scheduleId !== scheduleId),
      };
      await this.alarms.clear(alarmName(scheduleId));
      if (before !== this.book.schedules.length) await this.persist();
      return before !== this.book.schedules.length;
    });
  }

  public async handleAlarm(name: string): Promise<ScheduledAgentDueRun | null> {
    const scheduleId = parseAlarmName(name);
    if (!scheduleId) return null;
    return this.runMutation(async () => {
      await this.initialize();
      const schedule = this.book!.schedules.find((candidate) => candidate.id === scheduleId);
      if (!schedule || !schedule.enabled || schedule.nextRunAt === null) return null;
      const firedAt = this.now();
      const dueRun: ScheduledAgentDueRun = {
        id: `due-${schedule.id}-${firedAt}`,
        scheduleId: schedule.id,
        planId: schedule.planId,
        goal: schedule.goal,
        dueAt: schedule.nextRunAt,
        firedAt,
        approvedForExecution: false,
      };
      const runCount = schedule.runCount + 1;
      const nextRunAt = computeNextRun(schedule.cadence, schedule.nextRunAt + 1, runCount);
      const updated: ScheduledAgentDefinition = {
        ...schedule,
        runCount,
        lastFiredAt: firedAt,
        nextRunAt,
        enabled: nextRunAt !== null,
        updatedAt: firedAt,
      };
      this.replaceSchedule(updated);
      this.book = { ...this.book!, dueRuns: [...this.book!.dueRuns, dueRun].slice(-MAX_DUE_RUNS) };
      await this.persist();
      await this.syncAlarm(updated);
      return { ...dueRun };
    });
  }

  public async acknowledgeDueRun(dueRunId: string, approvedByHuman: true): Promise<boolean> {
    if (approvedByHuman !== true) throw new SchedulePolicyError('Acknowledging a due run requires explicit human approval.');
    validateIdentifier(dueRunId, 'dueRunId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.dueRuns.length;
      this.book = { ...this.book!, dueRuns: this.book!.dueRuns.filter((run) => run.id !== dueRunId) };
      if (before !== this.book.dueRuns.length) await this.persist();
      return before !== this.book.dueRuns.length;
    });
  }

  public async snapshot(): Promise<ScheduleBook> {
    await this.initialize();
    return cloneBook(this.book!);
  }

  private requireSchedule(scheduleId: string): ScheduledAgentDefinition {
    const schedule = this.book!.schedules.find((candidate) => candidate.id === scheduleId);
    if (!schedule) throw new SchedulePolicyError(`Unknown schedule "${scheduleId}".`);
    return schedule;
  }

  private replaceSchedule(schedule: ScheduledAgentDefinition): void {
    this.book = { ...this.book!, schedules: this.book!.schedules.map((candidate) => candidate.id === schedule.id ? schedule : candidate) };
  }

  private async syncAlarms(): Promise<void> {
    for (const schedule of this.book!.schedules) await this.syncAlarm(schedule);
  }

  private async syncAlarm(schedule: ScheduledAgentDefinition): Promise<void> {
    const name = alarmName(schedule.id);
    await this.alarms.clear(name);
    if (schedule.enabled && schedule.nextRunAt !== null) await this.alarms.create(name, { when: Math.max(schedule.nextRunAt, this.now() + 1) });
  }

  private async persist(): Promise<void> {
    await this.storage.putLarge(this.storageKey, this.book);
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: (() => void) | undefined;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

function sanitizeScheduleInput(input: ScheduleInput, id: string, timestamp: number): ScheduledAgentDefinition {
  validateIdentifier(id, 'scheduleId');
  validateIdentifier(input.planId, 'planId');
  const cadence = validateCadence(input.cadence);
  const runCount = 0;
  const enabled = input.enabled ?? true;
  return {
    id,
    planId: input.planId,
    goal: boundedText(input.goal, 'goal', MAX_GOAL_CHARS),
    cadence,
    enabled,
    createdAt: positiveTimestamp(timestamp, 'createdAt'),
    updatedAt: positiveTimestamp(timestamp, 'updatedAt'),
    nextRunAt: enabled ? computeNextRun(cadence, timestamp, runCount) : null,
    lastFiredAt: null,
    runCount,
    approvalRequired: true,
  };
}

function validateBook(book: ScheduleBook): ScheduleBook {
  if (book.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.schedules) || !Array.isArray(book.dueRuns)) {
    throw new SchedulePolicyError('Stored schedule book has an unsupported schema.');
  }
  if (book.schedules.length > MAX_SCHEDULES) throw new SchedulePolicyError('Stored schedule book exceeds the schedule limit.');
  return cloneBook(book);
}

function validateCadence(cadence: ScheduleCadence): ScheduleCadence {
  if (cadence.type === 'once') return { type: 'once', runAt: positiveTimestamp(cadence.runAt, 'runAt') };
  if (cadence.type === 'interval') {
    return {
      type: 'interval',
      startAt: positiveTimestamp(cadence.startAt, 'startAt'),
      intervalMinutes: intervalMinutes(cadence.intervalMinutes),
      ...(cadence.maxRuns === undefined ? {} : { maxRuns: positiveInteger(cadence.maxRuns, 'maxRuns') }),
    };
  }
  if (cadence.type === 'daily') {
    return {
      type: 'daily',
      firstRunAt: positiveTimestamp(cadence.firstRunAt, 'firstRunAt'),
      timeOfDayMinutes: timeOfDayMinutes(cadence.timeOfDayMinutes),
      ...(cadence.maxRuns === undefined ? {} : { maxRuns: positiveInteger(cadence.maxRuns, 'maxRuns') }),
    };
  }
  if (cadence.type === 'weekly') {
    return {
      type: 'weekly',
      firstRunAt: positiveTimestamp(cadence.firstRunAt, 'firstRunAt'),
      dayOfWeek: dayOfWeek(cadence.dayOfWeek),
      timeOfDayMinutes: timeOfDayMinutes(cadence.timeOfDayMinutes),
      ...(cadence.maxRuns === undefined ? {} : { maxRuns: positiveInteger(cadence.maxRuns, 'maxRuns') }),
    };
  }
  throw new SchedulePolicyError('Schedule cadence type is invalid.');
}

function computeNextRun(cadence: ScheduleCadence, afterTimestamp: number, runCount: number): number | null {
  if ('maxRuns' in cadence && cadence.maxRuns !== undefined && runCount >= cadence.maxRuns) return null;
  if (cadence.type === 'once') return runCount === 0 && cadence.runAt >= afterTimestamp ? cadence.runAt : null;
  if (cadence.type === 'interval') {
    const intervalMs = cadence.intervalMinutes * 60_000;
    if (afterTimestamp <= cadence.startAt) return cadence.startAt;
    const elapsed = afterTimestamp - cadence.startAt;
    return cadence.startAt + Math.ceil(elapsed / intervalMs) * intervalMs;
  }
  if (cadence.type === 'daily') return nextDaily(cadence.firstRunAt, cadence.timeOfDayMinutes, afterTimestamp);
  return nextWeekly(cadence.firstRunAt, cadence.dayOfWeek, cadence.timeOfDayMinutes, afterTimestamp);
}

function nextDaily(firstRunAt: number, minuteOfDay: number, afterTimestamp: number): number {
  const start = Math.max(firstRunAt, afterTimestamp);
  const date = new Date(start);
  let candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (candidate < start) candidate += 24 * 60 * 60 * 1_000;
  if (candidate < firstRunAt) return nextDaily(firstRunAt, minuteOfDay, firstRunAt);
  return candidate;
}

function nextWeekly(firstRunAt: number, targetDay: number, minuteOfDay: number, afterTimestamp: number): number {
  const start = Math.max(firstRunAt, afterTimestamp);
  const date = new Date(start);
  const currentDay = date.getUTCDay();
  let daysToAdd = (targetDay - currentDay + 7) % 7;
  let candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysToAdd, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (candidate < start) candidate += 7 * 24 * 60 * 60 * 1_000;
  if (candidate < firstRunAt) return nextWeekly(firstRunAt, targetDay, minuteOfDay, firstRunAt);
  return candidate;
}

function chromeAlarmAdapter(): ChromeAlarmApi {
  return {
    create: (name, alarmInfo) => chrome.alarms.create(name, alarmInfo),
    clear: (name) => chrome.alarms.clear(name),
  };
}

export function alarmName(scheduleId: string): string {
  return `${ALARM_PREFIX}${scheduleId}`;
}

export function parseAlarmName(name: string): string | null {
  if (!name.startsWith(ALARM_PREFIX)) return null;
  const id = name.slice(ALARM_PREFIX.length);
  validateIdentifier(id, 'scheduleId');
  return id;
}

function cloneBook(book: ScheduleBook): ScheduleBook {
  return {
    schemaVersion: SCHEMA_VERSION,
    schedules: book.schedules.map(cloneSchedule),
    dueRuns: book.dueRuns.map((run) => ({ ...run })),
  };
}

function cloneSchedule(schedule: ScheduledAgentDefinition): ScheduledAgentDefinition {
  return { ...schedule, cadence: { ...schedule.cadence } as ScheduleCadence };
}

function validateIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new SchedulePolicyError(`${name} is invalid.`);
  return value;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new SchedulePolicyError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SchedulePolicyError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new SchedulePolicyError(`${name} must be a positive safe integer.`);
  return value;
}

function intervalMinutes(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_INTERVAL_MINUTES || value > MAX_INTERVAL_MINUTES) {
    throw new SchedulePolicyError(`intervalMinutes must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`);
  }
  return value;
}

function timeOfDayMinutes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 24 * 60) throw new SchedulePolicyError('timeOfDayMinutes must be in the range [0, 1440).');
  return value;
}

function dayOfWeek(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) throw new SchedulePolicyError('dayOfWeek must be in the range [0, 6].');
  return value;
}

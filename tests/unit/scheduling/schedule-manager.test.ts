import { IDBFactory } from 'fake-indexeddb';
import { alarmName, ScheduledAgentManager, SchedulePolicyError } from '../../../src/scheduling/schedule-manager';
import { StorageLayer, type ChromeStorageArea } from '../../../src/storage/storage-layer';

class MemoryChromeStorage implements ChromeStorageArea {
  public readonly values = new Map<string, unknown>();
  public async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const requested = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys ? Object.keys(keys) : [...this.values.keys()];
    return Object.fromEntries(requested.flatMap((key) => this.values.has(key) ? [[key, this.values.get(key)]] : []));
  }
  public async set(items: Record<string, unknown>): Promise<void> { for (const [key, value] of Object.entries(items)) this.values.set(key, value); }
  public async remove(keys: string | string[]): Promise<void> { for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key); }
}

function storage(indexedDbFactory = new IDBFactory(), chromeStorage = new MemoryChromeStorage(), databaseName = `aamp-schedule-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({ chromeStorage, indexedDbFactory, databaseName, now: () => 1_000, estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }) });
}

function alarms() {
  return { create: jest.fn(), clear: jest.fn().mockResolvedValue(true) };
}

describe('ScheduledAgentManager', () => {
  it('creates approved schedules, persists them, and registers Chrome alarms', async () => {
    const alarmApi = alarms();
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const manager = new ScheduledAgentManager({ storage: storage(indexedDbFactory, chromeStorage, 'schedules'), alarms: alarmApi, now: () => 1_000, idFactory: () => 'schedule-1' });

    const schedule = await manager.create({ planId: 'plan-1', goal: 'Run approved check-in', cadence: { type: 'once', runAt: 2_000 }, approvedByHuman: true });

    expect(schedule).toEqual(expect.objectContaining({ id: 'schedule-1', nextRunAt: 2_000, approvalRequired: true }));
    expect(alarmApi.create).toHaveBeenCalledWith(alarmName('schedule-1'), { when: 2_000 });

    const reloaded = new ScheduledAgentManager({ storage: storage(indexedDbFactory, chromeStorage, 'schedules'), alarms: alarms(), now: () => 1_100 });
    await expect(reloaded.snapshot()).resolves.toEqual(expect.objectContaining({ schedules: [expect.objectContaining({ id: 'schedule-1' })] }));
  });

  it('requires explicit human approval for create, enable, remove, and due-run acknowledgement', async () => {
    const manager = new ScheduledAgentManager({ storage: storage(), alarms: alarms(), now: () => 1_000, idFactory: () => 'schedule-1' });

    await expect(manager.create({ planId: 'plan-1', goal: 'No approval', cadence: { type: 'once', runAt: 2_000 }, approvedByHuman: false as never })).rejects.toBeInstanceOf(SchedulePolicyError);
    await manager.create({ planId: 'plan-1', goal: 'Approved', cadence: { type: 'once', runAt: 2_000 }, approvedByHuman: true });
    await expect(manager.setEnabled('schedule-1', false, false as never)).rejects.toBeInstanceOf(SchedulePolicyError);
    await expect(manager.remove('schedule-1', false as never)).rejects.toBeInstanceOf(SchedulePolicyError);
    await expect(manager.acknowledgeDueRun('due-schedule-1-2000', false as never)).rejects.toBeInstanceOf(SchedulePolicyError);
  });

  it('turns alarms into approval-required due runs without executing work', async () => {
    let current = 1_000;
    const alarmApi = alarms();
    const manager = new ScheduledAgentManager({ storage: storage(), alarms: alarmApi, now: () => current, idFactory: () => 'schedule-interval' });
    await manager.create({ planId: 'plan-1', goal: 'Interval', cadence: { type: 'interval', startAt: 1_500, intervalMinutes: 5, maxRuns: 2 }, approvedByHuman: true });

    current = 1_500;
    const dueRun = await manager.handleAlarm(alarmName('schedule-interval'));
    expect(dueRun).toEqual(expect.objectContaining({ scheduleId: 'schedule-interval', approvedForExecution: false, dueAt: 1_500, firedAt: 1_500 }));
    expect((await manager.snapshot()).schedules[0]).toEqual(expect.objectContaining({ runCount: 1, enabled: true, nextRunAt: 301_500 }));

    current = 301_500;
    await manager.handleAlarm(alarmName('schedule-interval'));
    const snapshot = await manager.snapshot();
    expect(snapshot.schedules[0]).toEqual(expect.objectContaining({ runCount: 2, enabled: false, nextRunAt: null }));
    expect(snapshot.dueRuns).toHaveLength(2);
    await expect(manager.acknowledgeDueRun(snapshot.dueRuns[0]!.id, true)).resolves.toBe(true);
  });

  it('supports deterministic daily and weekly next-run calculation', async () => {
    const alarmApi = alarms();
    const manager = new ScheduledAgentManager({ storage: storage(), alarms: alarmApi, now: () => Date.UTC(2026, 0, 1, 10, 0), idFactory: () => 'daily-1' });
    await manager.create({ planId: 'plan-1', goal: 'Daily', cadence: { type: 'daily', firstRunAt: Date.UTC(2026, 0, 1, 0, 0), timeOfDayMinutes: 12 * 60 }, approvedByHuman: true });
    expect((await manager.snapshot()).schedules[0]?.nextRunAt).toBe(Date.UTC(2026, 0, 1, 12, 0));

    const weekly = new ScheduledAgentManager({ storage: storage(), alarms: alarms(), now: () => Date.UTC(2026, 0, 1, 10, 0), idFactory: () => 'weekly-1' });
    await weekly.create({ planId: 'plan-1', goal: 'Weekly', cadence: { type: 'weekly', firstRunAt: Date.UTC(2026, 0, 1, 0, 0), dayOfWeek: 5, timeOfDayMinutes: 9 * 60 }, approvedByHuman: true });
    expect((await weekly.snapshot()).schedules[0]?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('validates cadence, identifiers, and schedule limits', async () => {
    const manager = new ScheduledAgentManager({ storage: storage(), alarms: alarms(), now: () => 1_000, idFactory: () => 'schedule-1' });

    await expect(manager.create({ planId: '../bad', goal: 'Bad', cadence: { type: 'once', runAt: 2_000 }, approvedByHuman: true })).rejects.toBeInstanceOf(SchedulePolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Bad interval', cadence: { type: 'interval', startAt: 1_000, intervalMinutes: 1 }, approvedByHuman: true })).rejects.toBeInstanceOf(SchedulePolicyError);
    await expect(manager.handleAlarm('unrelated')).resolves.toBeNull();
  });
});

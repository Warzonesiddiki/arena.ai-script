import { IDBFactory } from 'fake-indexeddb';
import { TriggerManager, TriggerPolicyError, type TriggerEvent } from '../../../src/triggers/trigger-manager';
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

function storage(indexedDbFactory = new IDBFactory(), chromeStorage = new MemoryChromeStorage(), databaseName = `aamp-trigger-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({ chromeStorage, indexedDbFactory, databaseName, now: () => 1_000, estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }) });
}

function healthEvent(status: 'healthy' | 'attention' | 'critical', observedAt = 2_000, previousStatus: 'healthy' | 'attention' | 'critical' | null = 'healthy'): TriggerEvent {
  return { type: 'health-status-changed', status, previousStatus, observedAt };
}

describe('TriggerManager', () => {
  it('creates approved triggers, persists them, and reloads them from storage', async () => {
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const manager = new TriggerManager({ storage: storage(indexedDbFactory, chromeStorage, 'triggers'), now: () => 1_000, idFactory: () => 'trigger-1' });

    const trigger = await manager.create({
      planId: 'plan-1',
      goal: 'Review orchestration health regressions',
      condition: { type: 'health-status-changed', toStatus: ['critical', 'attention'] },
      approvedByHuman: true,
    });

    expect(trigger).toEqual(expect.objectContaining({
      id: 'trigger-1',
      source: 'health-status-changed',
      enabled: true,
      fireCount: 0,
      lastFiredAt: null,
      maxFires: null,
      approvalRequired: true,
    }));
    expect(trigger.condition).toEqual({ type: 'health-status-changed', toStatus: ['attention', 'critical'] });

    const reloaded = new TriggerManager({ storage: storage(indexedDbFactory, chromeStorage, 'triggers'), now: () => 1_100 });
    await expect(reloaded.snapshot()).resolves.toEqual(expect.objectContaining({
      triggers: [expect.objectContaining({ id: 'trigger-1', planId: 'plan-1' })],
      dueRuns: [],
    }));
  });

  it('requires explicit human approval for create, enable, remove, manual fire, and acknowledgement', async () => {
    const manager = new TriggerManager({ storage: storage(), now: () => 1_000, idFactory: () => 'trigger-1' });

    await expect(manager.create({ planId: 'plan-1', goal: 'No approval', condition: { type: 'manual' }, approvedByHuman: false as never }))
      .rejects.toBeInstanceOf(TriggerPolicyError);
    await manager.create({ planId: 'plan-1', goal: 'Approved manual trigger', condition: { type: 'manual' }, approvedByHuman: true });

    await expect(manager.setEnabled('trigger-1', false, false as never)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.remove('trigger-1', false as never)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.fireManual('trigger-1', false as never)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.acknowledgeDueRun('due-trigger-1-1000-1', false as never)).rejects.toBeInstanceOf(TriggerPolicyError);

    expect((await manager.snapshot()).dueRuns).toHaveLength(0);
  });

  it('creates approval-required due runs only when a trigger fires', async () => {
    let current = 1_000;
    const manager = new TriggerManager({ storage: storage(), now: () => current, idFactory: () => 'trigger-health' });
    await manager.create({
      planId: 'plan-1',
      goal: 'Investigate critical health',
      condition: { type: 'health-status-changed', toStatus: ['critical'] },
      approvedByHuman: true,
    });

    current = 2_000;
    const dueRuns = await manager.dispatch(healthEvent('critical', 1_900));

    expect(dueRuns).toHaveLength(1);
    expect(dueRuns[0]).toEqual(expect.objectContaining({
      triggerId: 'trigger-health',
      planId: 'plan-1',
      source: 'health-status-changed',
      observedAt: 1_900,
      firedAt: 2_000,
      approvedForExecution: false,
    }));
    expect(dueRuns[0]?.reason).toContain('critical');

    const snapshot = await manager.snapshot();
    expect(snapshot.triggers[0]).toEqual(expect.objectContaining({ fireCount: 1, lastFiredAt: 2_000, enabled: true }));
    expect(snapshot.dueRuns).toHaveLength(1);
    await expect(manager.acknowledgeDueRun(snapshot.dueRuns[0]!.id, true)).resolves.toBe(true);
    await expect(manager.acknowledgeDueRun(snapshot.dueRuns[0]!.id, true)).resolves.toBe(false);
  });

  it('does nothing for disabled, non-matching, unchanged-status, or manual-source triggers', async () => {
    const manager = new TriggerManager({ storage: storage(), now: () => 1_000, idFactory: () => 'trigger-disabled' });
    await manager.create({ planId: 'plan-1', goal: 'Disabled', condition: { type: 'health-status-changed', toStatus: ['critical'] }, approvedByHuman: true, enabled: false });
    await manager.create({ planId: 'plan-1', goal: 'Manual only', condition: { type: 'manual' }, approvedByHuman: true, id: 'trigger-manual' });
    await manager.create({ planId: 'plan-1', goal: 'Attention only', condition: { type: 'health-status-changed', toStatus: ['attention'] }, approvedByHuman: true, id: 'trigger-attention' });

    await expect(manager.dispatch(healthEvent('critical'))).resolves.toEqual([]);
    await expect(manager.dispatch(healthEvent('attention', 2_000, 'attention'))).resolves.toEqual([]);

    await manager.setEnabled('trigger-disabled', true, true);
    const fired = await manager.dispatch(healthEvent('critical'));
    expect(fired.map((run) => run.triggerId)).toEqual(['trigger-disabled']);
  });

  it('matches schedule and memory conditions with optional scoping filters', async () => {
    const manager = new TriggerManager({ storage: storage(), now: () => 1_000, idFactory: () => 'trigger-schedule' });
    await manager.create({ planId: 'plan-1', goal: 'Any schedule', condition: { type: 'schedule-due-run-created' }, approvedByHuman: true });
    await manager.create({ planId: 'plan-1', goal: 'Specific schedule', condition: { type: 'schedule-due-run-created', scheduleId: 'schedule-2' }, approvedByHuman: true, id: 'trigger-schedule-2' });
    await manager.create({ planId: 'plan-1', goal: 'Lessons only', condition: { type: 'memory-candidate-created', workflowId: 'plan-1', kind: 'lesson' }, approvedByHuman: true, id: 'trigger-memory' });

    const scheduleFired = await manager.dispatch({ type: 'schedule-due-run-created', scheduleId: 'schedule-1', dueRunId: 'due-schedule-1-2000', observedAt: 2_000 });
    expect(scheduleFired.map((run) => run.triggerId)).toEqual(['trigger-schedule']);

    const wrongKind = await manager.dispatch({ type: 'memory-candidate-created', candidateId: 'mem-1', workflowId: 'plan-1', kind: 'artifact', observedAt: 2_100 });
    expect(wrongKind).toEqual([]);

    const wrongWorkflow = await manager.dispatch({ type: 'memory-candidate-created', candidateId: 'mem-2', workflowId: 'plan-9', kind: 'lesson', observedAt: 2_200 });
    expect(wrongWorkflow).toEqual([]);

    const memoryFired = await manager.dispatch({ type: 'memory-candidate-created', candidateId: 'mem-3', workflowId: 'plan-1', kind: 'lesson', observedAt: 2_300 });
    expect(memoryFired.map((run) => run.triggerId)).toEqual(['trigger-memory']);
    expect(memoryFired[0]?.approvedForExecution).toBe(false);
  });

  it('honours cooldowns and max-fire limits and disables exhausted triggers', async () => {
    let current = 1_000;
    const manager = new TriggerManager({ storage: storage(), now: () => current, idFactory: () => 'trigger-limited' });
    await manager.create({
      planId: 'plan-1',
      goal: 'Bounded firing',
      condition: { type: 'health-status-changed', toStatus: ['critical'] },
      approvedByHuman: true,
      cooldownMs: 60_000,
      maxFires: 2,
    });

    current = 2_000;
    expect(await manager.dispatch(healthEvent('critical', 2_000))).toHaveLength(1);

    current = 30_000;
    expect(await manager.dispatch(healthEvent('critical', 30_000))).toHaveLength(0);

    current = 70_000;
    expect(await manager.dispatch(healthEvent('critical', 70_000))).toHaveLength(1);

    const snapshot = await manager.snapshot();
    expect(snapshot.triggers[0]).toEqual(expect.objectContaining({ fireCount: 2, enabled: false }));

    current = 200_000;
    expect(await manager.dispatch(healthEvent('critical', 200_000))).toHaveLength(0);
  });

  it('fires manual triggers only through explicit approval and only for manual sources', async () => {
    let current = 1_000;
    const manager = new TriggerManager({ storage: storage(), now: () => current, idFactory: () => 'trigger-manual' });
    await manager.create({ planId: 'plan-1', goal: 'Manual review sweep', condition: { type: 'manual' }, approvedByHuman: true, cooldownMs: 5_000 });
    await manager.create({ planId: 'plan-1', goal: 'Health', condition: { type: 'health-status-changed', toStatus: ['critical'] }, approvedByHuman: true, id: 'trigger-health' });

    current = 2_000;
    const dueRun = await manager.fireManual('trigger-manual', true, 'Human requested a review sweep.');
    expect(dueRun).toEqual(expect.objectContaining({ triggerId: 'trigger-manual', source: 'manual', approvedForExecution: false, reason: 'Human requested a review sweep.' }));

    current = 3_000;
    await expect(manager.fireManual('trigger-manual', true)).resolves.toBeNull();

    await expect(manager.fireManual('trigger-health', true)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.fireManual('trigger-missing', true)).rejects.toBeInstanceOf(TriggerPolicyError);
  });

  it('rejects invalid triggers, events, and duplicate identifiers, and bounds the registry', async () => {
    const manager = new TriggerManager({ storage: storage(), now: () => 1_000, idFactory: () => 'trigger-1' });

    await expect(manager.create({ planId: '../bad', goal: 'Bad plan', condition: { type: 'manual' }, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: '   ', condition: { type: 'manual' }, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Webhook', condition: { type: 'webhook', url: 'https://example.com' } as never, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Empty statuses', condition: { type: 'health-status-changed', toStatus: [] }, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Bad status', condition: { type: 'health-status-changed', toStatus: ['exploded' as never] }, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Bad cooldown', condition: { type: 'manual' }, approvedByHuman: true, cooldownMs: -1 })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.create({ planId: 'plan-1', goal: 'Bad maxFires', condition: { type: 'manual' }, approvedByHuman: true, maxFires: 0 })).rejects.toBeInstanceOf(TriggerPolicyError);

    await manager.create({ planId: 'plan-1', goal: 'Valid', condition: { type: 'manual' }, approvedByHuman: true });
    await expect(manager.create({ planId: 'plan-1', goal: 'Duplicate', condition: { type: 'manual' }, approvedByHuman: true, id: 'trigger-1' })).rejects.toBeInstanceOf(TriggerPolicyError);

    await expect(manager.dispatch({ type: 'webhook', observedAt: 2_000 } as never)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.dispatch({ type: 'health-status-changed', status: 'critical', observedAt: -1 } as never)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.dispatch({ type: 'schedule-due-run-created', scheduleId: '../x', dueRunId: 'due-1', observedAt: 2_000 })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.dispatch({ type: 'memory-candidate-created', candidateId: 'mem-1', workflowId: 'plan-1', kind: 'bogus' as never, observedAt: 2_000 })).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.setEnabled('trigger-missing', true, true)).rejects.toBeInstanceOf(TriggerPolicyError);
    await expect(manager.remove('trigger-missing', true)).resolves.toBe(false);
  });

  it('enforces the bounded trigger registry limit', async () => {
    let index = 0;
    const manager = new TriggerManager({ storage: storage(), now: () => 1_000, idFactory: () => `trigger-${index++}` });
    for (let created = 0; created < 25; created += 1) {
      await manager.create({ planId: 'plan-1', goal: `Trigger ${created}`, condition: { type: 'manual' }, approvedByHuman: true });
    }
    await expect(manager.create({ planId: 'plan-1', goal: 'Overflow', condition: { type: 'manual' }, approvedByHuman: true })).rejects.toBeInstanceOf(TriggerPolicyError);
    expect((await manager.snapshot()).triggers).toHaveLength(25);
  });

  it('removes triggers and their pending due runs, and rejects tampered stored books', async () => {
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const manager = new TriggerManager({ storage: storage(indexedDbFactory, chromeStorage, 'trigger-removal'), now: () => 1_000, idFactory: () => 'trigger-1' });
    await manager.create({ planId: 'plan-1', goal: 'Removable', condition: { type: 'manual' }, approvedByHuman: true });
    await manager.fireManual('trigger-1', true);
    expect((await manager.snapshot()).dueRuns).toHaveLength(1);

    await expect(manager.remove('trigger-1', true)).resolves.toBe(true);
    const snapshot = await manager.snapshot();
    expect(snapshot.triggers).toHaveLength(0);
    expect(snapshot.dueRuns).toHaveLength(0);

    const tamperedStorage = storage(new IDBFactory(), new MemoryChromeStorage(), 'trigger-tampered');
    await tamperedStorage.putLarge('triggers:agent-triggers:v1', {
      schemaVersion: 1,
      triggers: [],
      dueRuns: [{ id: 'due-x', triggerId: 'trigger-x', planId: 'plan-1', goal: 'g', source: 'manual', reason: 'r', observedAt: 1, firedAt: 1, approvedForExecution: true }],
    });
    const tampered = new TriggerManager({ storage: tamperedStorage, now: () => 1_000 });
    await expect(tampered.snapshot()).rejects.toBeInstanceOf(TriggerPolicyError);
  });
});

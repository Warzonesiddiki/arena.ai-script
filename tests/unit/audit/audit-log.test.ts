import { IDBFactory } from 'fake-indexeddb';
import { AuditLog, AuditLogError, type AuditEntry } from '../../../src/audit/audit-log';
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

function storage(indexedDbFactory = new IDBFactory(), chromeStorage = new MemoryChromeStorage(), databaseName = `aamp-audit-${Math.random().toString(36).slice(2)}`): StorageLayer {
  return new StorageLayer({ chromeStorage, indexedDbFactory, databaseName, now: () => 1_000, estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }) });
}

function log(overrides: { storage?: StorageLayer; now?: () => number; maxEntries?: number } = {}): AuditLog {
  let clock = 1_000;
  return new AuditLog({ storage: overrides.storage ?? storage(), now: overrides.now ?? (() => (clock += 10)), maxEntries: overrides.maxEntries });
}

describe('AuditLog', () => {
  it('appends a verifiable hash chain', async () => {
    const audit = log();

    const first = await audit.append({ category: 'approval', action: 'approve task', outcome: 'granted', actor: 'human', subjectId: 'coder-1' });
    const second = await audit.append({ category: 'policy', action: 'evaluate egress', outcome: 'refused', actor: 'system' });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(first.previousDigest).toBe('audit-genesis');
    // Each entry chains to the previous digest.
    expect(second.previousDigest).toBe(first.digest);
    await expect(audit.verify()).resolves.toEqual(expect.objectContaining({ valid: true, checkedCount: 2 }));
  });

  it('exposes no update or delete for an individual entry', () => {
    const audit = log();
    // Append-only by construction, not by convention.
    expect((audit as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((audit as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((audit as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it('detects a modified entry', async () => {
    const chromeStorage = new MemoryChromeStorage();
    const indexedDbFactory = new IDBFactory();
    const audit = log({ storage: storage(indexedDbFactory, chromeStorage, 'audit-tamper') });
    await audit.append({ category: 'approval', action: 'approve task', outcome: 'granted', actor: 'human' });
    await audit.append({ category: 'budget', action: 'authorize spend', outcome: 'granted', actor: 'human' });

    const book = await audit.snapshot();
    const tampered = book.entries.map((entry, index) => index === 0 ? { ...entry, outcome: 'refused' as const } : entry);
    const tamperedStorage = storage(new IDBFactory(), new MemoryChromeStorage(), 'audit-tampered');
    await tamperedStorage.putLarge('audit:log:v1', { schemaVersion: 1, entries: tampered, rotatedBefore: 1 });

    const verification = await new AuditLog({ storage: tamperedStorage }).verify();
    expect(verification.valid).toBe(false);
    expect(verification.firstInvalidSequence).toBe(1);
    expect(verification.reason).toContain('has been modified');
  });

  it('detects a removed entry by a broken chain link', async () => {
    const audit = log();
    await audit.append({ category: 'approval', action: 'a', outcome: 'granted', actor: 'human' });
    await audit.append({ category: 'approval', action: 'b', outcome: 'granted', actor: 'human' });
    await audit.append({ category: 'approval', action: 'c', outcome: 'granted', actor: 'human' });

    const book = await audit.snapshot();
    // Excise the middle entry: the surrounding entries are individually intact.
    const gapped: AuditEntry[] = [book.entries[0]!, book.entries[2]!];
    const gappedStorage = storage(new IDBFactory(), new MemoryChromeStorage(), 'audit-gapped');
    await gappedStorage.putLarge('audit:log:v1', { schemaVersion: 1, entries: gapped, rotatedBefore: 1 });

    const verification = await new AuditLog({ storage: gappedStorage }).verify();
    expect(verification.valid).toBe(false);
    expect(verification.firstInvalidSequence).toBe(3);
    expect(verification.reason).toContain('may have been removed');
  });

  it('redacts sensitive detail keys so the audit trail never accumulates secrets', async () => {
    const audit = log();
    const entry = await audit.append({
      category: 'security',
      action: 'connector registered',
      outcome: 'recorded',
      actor: 'human',
      detail: { apiKey: 'sk-live-123', prompt: 'do the thing', host: 'api.github.com', count: 3, ok: true, nested: { a: 1 } as never },
    });

    expect(entry.detail.apiKey).toBe('[redacted]');
    expect(entry.detail.prompt).toBe('[redacted]');
    expect(entry.detail.nested).toBe('[redacted]');
    expect(entry.detail.host).toBe('api.github.com');
    expect(entry.detail.count).toBe(3);
    expect(entry.detail.ok).toBe(true);
  });

  it('rotates the oldest entries while recording that rotation happened', async () => {
    const audit = log({ maxEntries: 3 });
    for (let index = 0; index < 5; index += 1) {
      await audit.append({ category: 'lifecycle', action: `event ${index}`, outcome: 'recorded', actor: 'system' });
    }

    const book = await audit.snapshot();
    expect(book.entries.map((entry) => entry.sequence)).toEqual([3, 4, 5]);
    // Rotation is visible, so a verifier knows the chain legitimately starts at 3.
    expect(book.rotatedBefore).toBe(3);
    await expect(audit.verify()).resolves.toEqual(expect.objectContaining({ valid: true }));

    // Sequence numbers keep increasing after rotation.
    const next = await audit.append({ category: 'lifecycle', action: 'after rotation', outcome: 'recorded', actor: 'system' });
    expect(next.sequence).toBe(6);
  });

  it('queries by category, outcome, subject, time, and limit', async () => {
    const audit = log();
    await audit.append({ category: 'approval', action: 'a', outcome: 'granted', actor: 'human', subjectId: 'coder-1' });
    await audit.append({ category: 'denial', action: 'b', outcome: 'refused', actor: 'system', subjectId: 'coder-1' });
    await audit.append({ category: 'approval', action: 'c', outcome: 'granted', actor: 'human', subjectId: 'critic-1' });

    expect((await audit.query({ category: 'approval' })).map((entry) => entry.action)).toEqual(['a', 'c']);
    expect((await audit.query({ outcome: 'refused' })).map((entry) => entry.action)).toEqual(['b']);
    expect((await audit.query({ subjectId: 'coder-1' })).map((entry) => entry.action)).toEqual(['a', 'b']);
    expect((await audit.query({ limit: 1 })).map((entry) => entry.action)).toEqual(['c']);
    expect(await audit.query({ since: 9_999_999 })).toEqual([]);
    await expect(audit.query({ limit: 0 })).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.query({ since: -1 })).rejects.toBeInstanceOf(AuditLogError);
  });

  it('persists across instances and summarises the log', async () => {
    const indexedDbFactory = new IDBFactory();
    const chromeStorage = new MemoryChromeStorage();
    const audit = log({ storage: storage(indexedDbFactory, chromeStorage, 'audit-reload') });
    await audit.append({ category: 'approval', action: 'a', outcome: 'granted', actor: 'human' });
    await audit.append({ category: 'budget', action: 'b', outcome: 'refused', actor: 'system' });

    const reloaded = new AuditLog({ storage: storage(indexedDbFactory, chromeStorage, 'audit-reload'), now: () => 5_000 });
    const summary = await reloaded.summary();

    expect(summary).toEqual(expect.objectContaining({ total: 2, rotatedBefore: 1, verified: true }));
    expect(summary.byCategory).toEqual({ approval: 1, budget: 1 });
    expect(summary.byOutcome).toEqual({ granted: 1, refused: 1 });

    // A new entry continues the existing chain.
    const continued = await reloaded.append({ category: 'lifecycle', action: 'c', outcome: 'recorded', actor: 'system' });
    expect(continued.sequence).toBe(3);
    await expect(reloaded.verify()).resolves.toEqual(expect.objectContaining({ valid: true, checkedCount: 3 }));
  });

  it('verifies an empty log and rejects malformed entries', async () => {
    const audit = log();
    await expect(audit.verify()).resolves.toEqual(expect.objectContaining({ valid: true, checkedCount: 0 }));

    await expect(audit.append(null as never)).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.append({ category: 'gossip' as never, action: 'a', outcome: 'granted', actor: 'human' })).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.append({ category: 'approval', action: '  ', outcome: 'granted', actor: 'human' })).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.append({ category: 'approval', action: 'a', outcome: 'maybe' as never, actor: 'human' })).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.append({ category: 'approval', action: 'a', outcome: 'granted', actor: 'robot' as never })).rejects.toBeInstanceOf(AuditLogError);
    await expect(audit.append({ category: 'approval', action: 'a', outcome: 'granted', actor: 'human', subjectId: '../bad' })).rejects.toBeInstanceOf(AuditLogError);
    expect(() => new AuditLog({ maxEntries: 0 })).toThrow(AuditLogError);
  });
});

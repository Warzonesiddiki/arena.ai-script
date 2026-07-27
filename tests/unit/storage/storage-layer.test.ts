import { IDBFactory } from 'fake-indexeddb';
import {
  StorageCorruptionError,
  StorageLayer,
  StorageQuotaError,
  type ChromeStorageArea,
} from '../../../src/storage/storage-layer';

class MemoryChromeStorage implements ChromeStorageArea {
  public readonly values = new Map<string, unknown>();

  public async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const requested = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : keys ? Object.keys(keys) : [...this.values.keys()];
    return Object.fromEntries(requested.flatMap((key) => this.values.has(key) ? [[key, this.values.get(key)]] : []));
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value);
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key);
  }
}

function makeStorage(options: Partial<ConstructorParameters<typeof StorageLayer>[0]> = {}): { layer: StorageLayer; chromeStorage: MemoryChromeStorage } {
  const chromeStorage = new MemoryChromeStorage();
  return {
    chromeStorage,
    layer: new StorageLayer({
      chromeStorage,
      indexedDbFactory: new IDBFactory(),
      databaseName: `aamp-test-${Math.random().toString(36).slice(2)}`,
      now: () => 1_700_000_000_000,
      estimate: async () => ({ usage: 0, quota: 200 * 1024 * 1024 }),
      ...options,
    }),
  };
}

describe('StorageLayer', () => {
  it('persists small Chrome settings and compressed large JSON records', async () => {
    const { layer } = makeStorage();
    const value = { title: 'Arena task', content: 'AAMP '.repeat(30_000), flags: ['safe', 'observed'] };

    await layer.setLocal('ui.theme', 'dracula');
    await expect(layer.getLocal<string>('ui.theme')).resolves.toBe('dracula');
    await layer.removeLocal('ui.theme');
    await expect(layer.getLocal('ui.theme')).resolves.toBeNull();

    const metadata = await layer.putLarge('session:one', value);
    expect(metadata.originalBytes).toBeGreaterThan(metadata.compressedBytes);
    expect(metadata.schemaVersion).toBe(1);
    await expect(layer.getLarge<typeof value>('session:one')).resolves.toEqual(value);
    await expect(layer.listLarge()).resolves.toEqual([metadata]);

    await layer.removeLarge('session:one');
    await expect(layer.getLarge('session:one')).resolves.toBeNull();
    await layer.close();
  });

  it('serializes index mutations and repairs an interrupted chrome.storage index', async () => {
    const { layer, chromeStorage } = makeStorage();
    await Promise.all([
      layer.putLarge('record:a', { text: 'a'.repeat(5_000) }),
      layer.putLarge('record:b', { text: 'b'.repeat(5_000) }),
    ]);

    chromeStorage.values.delete('aamp:large-record-index:v1');
    const repaired = await layer.repairIndex();
    expect(repaired.map((record) => record.key).sort()).toEqual(['record:a', 'record:b']);
    expect(chromeStorage.values.get('aamp:large-record-index:v1')).toEqual(expect.objectContaining({
      'record:a': expect.any(Object),
      'record:b': expect.any(Object),
    }));
  });

  it('fails before writing when quota estimates or JSON/key constraints are invalid', async () => {
    const { layer } = makeStorage({ estimate: async () => ({ usage: 99, quota: 100 }) });

    await expect(layer.putLarge('too-big-for-quota', { text: 'x'.repeat(1_000) })).rejects.toBeInstanceOf(StorageQuotaError);
    await expect(layer.putLarge('invalid key', { ok: true })).rejects.toBeInstanceOf(TypeError);
    await expect(layer.putLarge('not-json', { circular: undefined, bigint: BigInt(1) })).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects records exceeding the configured raw size cap', async () => {
    const { layer } = makeStorage({ maxRecordBytes: 32 });
    await expect(layer.putLarge('limited', { text: 'x'.repeat(100) })).rejects.toBeInstanceOf(StorageQuotaError);
  });

  it('reports stored payload corruption instead of returning unverified data', async () => {
    const { layer } = makeStorage();
    await layer.putLarge('corruptible', { text: 'safe value' });

    const database = (layer as unknown as { database: IDBDatabase }).database;
    if (!database) throw new Error('database was not initialized');
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get('corruptible');
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    record.checksum = 0;
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await expect(layer.getLarge('corruptible')).rejects.toBeInstanceOf(StorageCorruptionError);
  });
  it('rejects an unsupported stored format without attempting to decode it', async () => {
    const { layer } = makeStorage();
    await layer.putLarge('legacy', { text: 'value' });

    const database = (layer as unknown as { database: IDBDatabase }).database;
    if (!database) throw new Error('database was not initialized');
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get('legacy');
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    // A record written by a future or foreign codec must never be decompressed.
    record.algorithm = 'zstd-v2';
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await expect(layer.getLarge('legacy')).rejects.toBeInstanceOf(StorageCorruptionError);
  });

  it('reports undecodable payload bytes as corruption rather than throwing raw', async () => {
    const { layer } = makeStorage();
    await layer.putLarge('garbled', { text: 'value' });

    const database = (layer as unknown as { database: IDBDatabase }).database;
    if (!database) throw new Error('database was not initialized');
    const transaction = database.transaction('records', 'readwrite');
    const store = transaction.objectStore('records');
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get('garbled');
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    // Replace the compressed block with bytes LZ4 cannot decode.
    record.data = new Uint8Array([0xff, 0xff, 0xff, 0xff]).buffer;
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });

    await expect(layer.getLarge('garbled')).rejects.toBeInstanceOf(StorageCorruptionError);
  });

  it('returns null for a key that was never written', async () => {
    const { layer } = makeStorage();
    await expect(layer.getLarge('absent')).resolves.toBeNull();
    await expect(layer.getLocal('absent')).resolves.toBeNull();
  });

  it('removes a large record and drops it from the index', async () => {
    const { layer } = makeStorage();
    await layer.putLarge('doomed', { text: 'value' });
    expect((await layer.listLarge()).map((entry) => entry.key)).toContain('doomed');

    await layer.removeLarge('doomed');

    await expect(layer.getLarge('doomed')).resolves.toBeNull();
    expect((await layer.listLarge()).map((entry) => entry.key)).not.toContain('doomed');
    // Removing again is a no-op rather than an error.
    await expect(layer.removeLarge('doomed')).resolves.toBeUndefined();
  });

  it('round-trips values that stress the JSON and compression paths', async () => {
    const { layer } = makeStorage();
    const tricky = {
      unicode: 'café ✅ 日本語 🎯',
      nested: { deep: { deeper: [1, 2, { three: true }] } },
      empty: {},
      emptyList: [],
      nullish: null,
      // Highly repetitive text exercises the LZ4 match path.
      repetitive: 'abcabcabc'.repeat(500),
      negative: -12.5,
    };

    await layer.putLarge('tricky', tricky);
    await expect(layer.getLarge('tricky')).resolves.toEqual(tricky);
  });

  it('reports compression metadata for a stored record', async () => {
    const { layer } = makeStorage();
    const metadata = await layer.putLarge('measured', { text: 'x'.repeat(5_000) });

    expect(metadata).toEqual(expect.objectContaining({ key: 'measured', schemaVersion: 1 }));
    // Highly repetitive input must actually compress.
    expect(metadata.compressedBytes).toBeLessThan(metadata.originalBytes);
    expect(metadata.checksum).toEqual(expect.any(Number));
  });

  it('overwrites an existing record in place rather than duplicating it', async () => {
    const { layer } = makeStorage();
    await layer.putLarge('mutable', { version: 1 });
    await layer.putLarge('mutable', { version: 2 });

    await expect(layer.getLarge('mutable')).resolves.toEqual({ version: 2 });
    expect((await layer.listLarge()).filter((entry) => entry.key === 'mutable')).toHaveLength(1);
  });

  it('refuses a non-positive maxRecordBytes at construction', () => {
    expect(() => makeStorage({ maxRecordBytes: 0 })).toThrow(RangeError);
    expect(() => makeStorage({ maxRecordBytes: -1 })).toThrow(RangeError);
    expect(() => makeStorage({ maxRecordBytes: 1.5 })).toThrow(RangeError);
  });

  it('tolerates an estimate provider that reports nothing', async () => {
    const { layer } = makeStorage({ estimate: async () => ({}) });
    // No quota information must not block a legitimate write.
    await expect(layer.putLarge('unmetered', { text: 'value' })).resolves.toEqual(
      expect.objectContaining({ key: 'unmetered' }),
    );
  });
});

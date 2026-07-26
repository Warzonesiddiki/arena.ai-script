import { crc32 } from './checksum';
import { compressLz4Block, decompressLz4Block } from './lz4';

const DATABASE_VERSION = 1;
const RECORD_STORE = 'records';
const METADATA_STORE = 'metadata';
const INDEX_KEY = 'aamp:large-record-index:v1';
const MAX_KEY_LENGTH = 128;
const DEFAULT_MAX_RECORD_BYTES = 64 * 1024 * 1024;

export interface ChromeStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageEstimate {
  usage?: number;
  quota?: number;
}

export interface StorageLayerOptions {
  chromeStorage?: ChromeStorageArea;
  indexedDbFactory?: IDBFactory;
  databaseName?: string;
  maxRecordBytes?: number;
  estimate?: () => Promise<StorageEstimate>;
  now?: () => number;
}

export interface LargeRecordMetadata {
  key: string;
  schemaVersion: 1;
  originalBytes: number;
  compressedBytes: number;
  checksum: number;
  createdAt: number;
  updatedAt: number;
}

interface LargeRecord extends LargeRecordMetadata {
  algorithm: 'lz4-block-v1';
  data: ArrayBuffer;
}

export class StorageQuotaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class StorageCorruptionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StorageCorruptionError';
  }
}

/**
 * Hybrid persistence layer:
 * - chrome.storage.local stores small settings and a lightweight record index.
 * - IndexedDB stores LZ4-compressed payloads and a mirrored metadata store.
 *
 * It does not persist live service-worker/bridge secrets. All mutations update
 * IndexedDB first and then its recoverable chrome.storage index; `repairIndex`
 * reconciles an interrupted second step.
 */
export class StorageLayer {
  private readonly chromeStorage: ChromeStorageArea;
  private readonly indexedDbFactory: IDBFactory;
  private readonly databaseName: string;
  private readonly maxRecordBytes: number;
  private readonly estimate: () => Promise<StorageEstimate>;
  private readonly now: () => number;
  private database: IDBDatabase | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: StorageLayerOptions = {}) {
    this.chromeStorage = options.chromeStorage ?? chromeStorageAdapter();
    this.indexedDbFactory = options.indexedDbFactory ?? indexedDB;
    this.databaseName = options.databaseName ?? 'aamp-storage-v1';
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    this.estimate = options.estimate ?? browserEstimate;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxRecordBytes) || this.maxRecordBytes <= 0) {
      throw new RangeError('maxRecordBytes must be a positive safe integer.');
    }
  }

  public async initialize(): Promise<void> {
    if (!this.database) this.database = await openDatabase(this.indexedDbFactory, this.databaseName);
  }

  public async setLocal<T>(key: string, value: T): Promise<void> {
    validateKey(key);
    await this.chromeStorage.set({ [localKey(key)]: value });
  }

  public async getLocal<T>(key: string): Promise<T | null> {
    validateKey(key);
    const value = await this.chromeStorage.get(localKey(key));
    return (value[localKey(key)] as T | undefined) ?? null;
  }

  public async removeLocal(key: string): Promise<void> {
    validateKey(key);
    await this.chromeStorage.remove(localKey(key));
  }

  public async putLarge<T>(key: string, value: T): Promise<LargeRecordMetadata> {
    validateKey(key);
    return this.runMutation(async () => {
      await this.initialize();
      const raw = encodeJson(value);
      if (raw.byteLength > this.maxRecordBytes) {
        throw new StorageQuotaError(`Record "${key}" is ${raw.byteLength} bytes; the configured maximum is ${this.maxRecordBytes}.`);
      }

      const compressed = compressLz4Block(raw);
      await this.ensureEstimatedCapacity(compressed.byteLength);
      const previous = await this.getMetadataFromDatabase(key);
      const timestamp = this.now();
      const metadata: LargeRecordMetadata = {
        key,
        schemaVersion: 1,
        originalBytes: raw.byteLength,
        compressedBytes: compressed.byteLength,
        checksum: crc32(raw),
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const record: LargeRecord = {
        ...metadata,
        algorithm: 'lz4-block-v1',
        data: copyToArrayBuffer(compressed),
      };

      await this.writeRecord(record);
      await this.updateChromeIndex(key, metadata);
      return metadata;
    });
  }

  public async getLarge<T>(key: string): Promise<T | null> {
    validateKey(key);
    await this.initialize();
    const record = await this.getRecordFromDatabase(key);
    if (!record) return null;
    if (record.schemaVersion !== 1 || record.algorithm !== 'lz4-block-v1') {
      throw new StorageCorruptionError(`Record "${key}" has an unsupported storage format.`);
    }

    try {
      const raw = decompressLz4Block(new Uint8Array(record.data), record.originalBytes);
      if (crc32(raw) !== record.checksum) throw new StorageCorruptionError(`Record "${key}" failed its checksum.`);
      return decodeJson<T>(raw);
    } catch (error) {
      if (error instanceof StorageCorruptionError) throw error;
      throw new StorageCorruptionError(`Record "${key}" could not be decoded: ${toErrorMessage(error)}`);
    }
  }

  public async removeLarge(key: string): Promise<void> {
    validateKey(key);
    await this.runMutation(async () => {
      await this.initialize();
      await this.deleteRecord(key);
      await this.updateChromeIndex(key, null);
    });
  }

  public async listLarge(): Promise<LargeRecordMetadata[]> {
    await this.initialize();
    const records = await this.getAllMetadataFromDatabase();
    return records.sort((left, right) => left.key.localeCompare(right.key));
  }

  /** Rebuilds the chrome.storage index from IndexedDB metadata after interrupted writes. */
  public async repairIndex(): Promise<LargeRecordMetadata[]> {
    return this.runMutation(async () => {
      await this.initialize();
      const records = await this.getAllMetadataFromDatabase();
      const index = Object.fromEntries(records.map((record) => [record.key, record]));
      await this.chromeStorage.set({ [INDEX_KEY]: index });
      return records;
    });
  }

  public async close(): Promise<void> {
    this.database?.close();
    this.database = null;
  }

  private async ensureEstimatedCapacity(requiredBytes: number): Promise<void> {
    const estimate = await this.estimate();
    if (typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return;
    if (requiredBytes > estimate.quota - estimate.usage) {
      throw new StorageQuotaError(`Not enough estimated browser storage for ${requiredBytes} compressed bytes.`);
    }
  }

  private async writeRecord(record: LargeRecord): Promise<void> {
    const database = this.requireDatabase();
    const transaction = database.transaction([RECORD_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(RECORD_STORE).put(record);
    transaction.objectStore(METADATA_STORE).put(toMetadata(record));
    await transactionDone(transaction);
  }

  private async deleteRecord(key: string): Promise<void> {
    const database = this.requireDatabase();
    const transaction = database.transaction([RECORD_STORE, METADATA_STORE], 'readwrite');
    transaction.objectStore(RECORD_STORE).delete(key);
    transaction.objectStore(METADATA_STORE).delete(key);
    await transactionDone(transaction);
  }

  private async getRecordFromDatabase(key: string): Promise<LargeRecord | null> {
    const transaction = this.requireDatabase().transaction(RECORD_STORE, 'readonly');
    const value = await requestResult<LargeRecord | undefined>(transaction.objectStore(RECORD_STORE).get(key));
    await transactionDone(transaction);
    return value ?? null;
  }

  private async getMetadataFromDatabase(key: string): Promise<LargeRecordMetadata | null> {
    const transaction = this.requireDatabase().transaction(METADATA_STORE, 'readonly');
    const value = await requestResult<LargeRecordMetadata | undefined>(transaction.objectStore(METADATA_STORE).get(key));
    await transactionDone(transaction);
    return value ?? null;
  }

  private async getAllMetadataFromDatabase(): Promise<LargeRecordMetadata[]> {
    const transaction = this.requireDatabase().transaction(METADATA_STORE, 'readonly');
    const values = await requestResult<LargeRecordMetadata[]>(transaction.objectStore(METADATA_STORE).getAll());
    await transactionDone(transaction);
    return values;
  }

  private async updateChromeIndex(key: string, metadata: LargeRecordMetadata | null): Promise<void> {
    const result = await this.chromeStorage.get(INDEX_KEY);
    const current = isRecord(result[INDEX_KEY]) ? { ...(result[INDEX_KEY] as Record<string, LargeRecordMetadata>) } : {};
    if (metadata) current[key] = metadata;
    else delete current[key];
    await this.chromeStorage.set({ [INDEX_KEY]: current });
  }

  private requireDatabase(): IDBDatabase {
    if (!this.database) throw new Error('StorageLayer.initialize() did not open IndexedDB.');
    return this.database;
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

function chromeStorageAdapter(): ChromeStorageArea {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(keys),
  };
}

async function browserEstimate(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) return {};
  return navigator.storage.estimate();
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) database.createObjectStore(RECORD_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function encodeJson(value: unknown): Uint8Array {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`Storage values must be JSON serializable: ${toErrorMessage(error)}`);
  }
  if (json === undefined) throw new TypeError('Storage values must be JSON serializable.');
  return new TextEncoder().encode(json);
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function toMetadata(record: LargeRecord): LargeRecordMetadata {
  const { algorithm: _algorithm, data: _data, ...metadata } = record;
  return metadata;
}

function localKey(key: string): string {
  return `aamp:local:${key}`;
}

function validateKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(key)) {
    throw new TypeError(`Storage key must be 1-${MAX_KEY_LENGTH} characters of [A-Za-z0-9._:-].`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

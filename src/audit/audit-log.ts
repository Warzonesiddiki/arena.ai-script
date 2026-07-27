import { StorageLayer } from '../storage/storage-layer';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'audit:log:v1';
const MAX_ENTRIES = 1_000;
const MAX_TEXT_CHARS = 300;
const MAX_DETAIL_KEYS = 12;

/**
 * Phase 10 tamper-evident audit log.
 *
 * Records governance-relevant decisions — approvals, denials, policy verdicts,
 * budget stops — as an append-only hash chain. Each entry's digest covers the
 * previous entry's digest, so removing or editing any entry breaks verification
 * for every entry after it.
 *
 * This is **tamper-evident, not tamper-proof**: a local attacker who can rewrite
 * storage could recompute the whole chain. It defends against silent corruption
 * and accidental mutation, which is what an in-browser audit trail can honestly
 * promise. Real non-repudiation would need a signing key held off-device.
 *
 * The log is append-only by construction: there is no update or delete for an
 * individual entry, only bounded rotation of the oldest entries.
 */

export type AuditCategory = 'approval' | 'denial' | 'policy' | 'budget' | 'lifecycle' | 'security';

export type AuditOutcome = 'granted' | 'refused' | 'recorded';

export interface AuditEntryInput {
  category: AuditCategory;
  action: string;
  outcome: AuditOutcome;
  actor: 'human' | 'system';
  subjectId?: string | null;
  detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditEntry {
  sequence: number;
  timestamp: number;
  category: AuditCategory;
  action: string;
  outcome: AuditOutcome;
  actor: 'human' | 'system';
  subjectId: string | null;
  detail: Readonly<Record<string, string | number | boolean | null>>;
  previousDigest: string;
  digest: string;
}

export interface AuditBook {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: readonly AuditEntry[];
  /** Sequence of the oldest entry ever written, so rotation stays visible. */
  rotatedBefore: number;
}

export interface AuditVerification {
  valid: boolean;
  checkedCount: number;
  /** Sequence of the first entry whose digest does not verify. */
  firstInvalidSequence: number | null;
  reason: string;
}

export interface AuditQuery {
  category?: AuditCategory;
  outcome?: AuditOutcome;
  subjectId?: string;
  since?: number;
  limit?: number;
}

export interface AuditLogOptions {
  storage?: StorageLayer;
  storageKey?: string;
  now?: () => number;
  maxEntries?: number;
}

export class AuditLogError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AuditLogError';
  }
}

const GENESIS_DIGEST = 'audit-genesis';

export class AuditLog {
  private readonly storage: StorageLayer;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private book: AuditBook | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: AuditLogOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.maxEntries = positiveInteger(options.maxEntries ?? MAX_ENTRIES, 'maxEntries');
  }

  public async initialize(): Promise<void> {
    if (this.book) return;
    const stored = await this.storage.getLarge<AuditBook>(this.storageKey);
    this.book = stored ? validateBook(stored) : { schemaVersion: SCHEMA_VERSION, entries: [], rotatedBefore: 1 };
  }

  /** Appends an entry. There is deliberately no update or delete counterpart. */
  public async append(input: AuditEntryInput): Promise<AuditEntry> {
    const sanitized = sanitizeInput(input);
    return this.runMutation(async () => {
      await this.initialize();
      const entries = this.book!.entries;
      const previous = entries[entries.length - 1];
      const sequence = (previous?.sequence ?? this.book!.rotatedBefore - 1) + 1;
      const base: Omit<AuditEntry, 'digest'> = {
        sequence,
        timestamp: positiveTimestamp(this.now(), 'timestamp'),
        ...sanitized,
        previousDigest: previous?.digest ?? GENESIS_DIGEST,
      };
      const entry: AuditEntry = { ...base, digest: computeDigest(base) };

      const next = [...entries, entry];
      const overflow = Math.max(0, next.length - this.maxEntries);
      this.book = {
        ...this.book!,
        entries: next.slice(overflow),
        // Rotation is recorded rather than hidden, so a verifier knows the chain
        // legitimately starts mid-sequence.
        rotatedBefore: overflow > 0 ? next[overflow]!.sequence : this.book!.rotatedBefore,
      };
      await this.persist();
      return { ...entry, detail: { ...entry.detail } };
    });
  }

  /** Verifies the hash chain end to end. */
  public async verify(): Promise<AuditVerification> {
    await this.initialize();
    const entries = this.book!.entries;
    if (entries.length === 0) {
      return { valid: true, checkedCount: 0, firstInvalidSequence: null, reason: 'The audit log is empty.' };
    }

    let previousDigest: string | null = null;
    for (const entry of entries) {
      const { digest, ...base } = entry;
      if (computeDigest(base) !== digest) {
        return { valid: false, checkedCount: entries.length, firstInvalidSequence: entry.sequence, reason: `Entry ${entry.sequence} has been modified.` };
      }
      if (previousDigest !== null && entry.previousDigest !== previousDigest) {
        return { valid: false, checkedCount: entries.length, firstInvalidSequence: entry.sequence, reason: `Entry ${entry.sequence} does not chain to its predecessor; an entry may have been removed.` };
      }
      previousDigest = digest;
    }
    return { valid: true, checkedCount: entries.length, firstInvalidSequence: null, reason: `Verified ${entries.length} chained entries.` };
  }

  public async query(filter: AuditQuery = {}): Promise<readonly AuditEntry[]> {
    await this.initialize();
    if (filter.limit !== undefined) positiveInteger(filter.limit, 'limit');
    if (filter.since !== undefined) positiveTimestamp(filter.since, 'since');

    const matched = this.book!.entries.filter((entry) => {
      if (filter.category !== undefined && entry.category !== filter.category) return false;
      if (filter.outcome !== undefined && entry.outcome !== filter.outcome) return false;
      if (filter.subjectId !== undefined && entry.subjectId !== filter.subjectId) return false;
      if (filter.since !== undefined && entry.timestamp < filter.since) return false;
      return true;
    }).map((entry) => ({ ...entry, detail: { ...entry.detail } }));

    return filter.limit === undefined ? matched : matched.slice(-filter.limit);
  }

  public async snapshot(): Promise<AuditBook> {
    await this.initialize();
    return cloneBook(this.book!);
  }

  /** Bounded compliance summary. */
  public async summary(): Promise<{ total: number; rotatedBefore: number; byCategory: Record<string, number>; byOutcome: Record<string, number>; verified: boolean }> {
    await this.initialize();
    const byCategory: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    for (const entry of this.book!.entries) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      byOutcome[entry.outcome] = (byOutcome[entry.outcome] ?? 0) + 1;
    }
    return {
      total: this.book!.entries.length,
      rotatedBefore: this.book!.rotatedBefore,
      byCategory,
      byOutcome,
      verified: (await this.verify()).valid,
    };
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

const SENSITIVE_KEY = /(secret|token|apikey|api_key|password|credential|authorization|cookie|prompt|completion|conversation)/iu;

function sanitizeInput(input: AuditEntryInput): Omit<AuditEntry, 'sequence' | 'timestamp' | 'previousDigest' | 'digest'> {
  if (!input || typeof input !== 'object') throw new AuditLogError('An audit entry is required.');
  if (!['approval', 'denial', 'policy', 'budget', 'lifecycle', 'security'].includes(input.category)) {
    throw new AuditLogError(`Unsupported audit category "${String(input.category)}".`);
  }
  if (!['granted', 'refused', 'recorded'].includes(input.outcome)) throw new AuditLogError(`Unsupported audit outcome "${String(input.outcome)}".`);
  if (input.actor !== 'human' && input.actor !== 'system') throw new AuditLogError('Audit actor must be "human" or "system".');
  if (typeof input.action !== 'string' || input.action.trim() === '') throw new AuditLogError('Audit action is required.');
  if (input.subjectId !== undefined && input.subjectId !== null && !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.subjectId)) {
    throw new AuditLogError('Audit subjectId is invalid.');
  }

  const detail: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.detail ?? {})) {
    if (Object.keys(detail).length >= MAX_DETAIL_KEYS) break;
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(key)) continue;
    // An audit trail must never become a place secrets accumulate.
    if (SENSITIVE_KEY.test(key)) { detail[key] = '[redacted]'; continue; }
    if (value === null || typeof value === 'boolean') detail[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) detail[key] = value;
    else if (typeof value === 'string') detail[key] = value.slice(0, MAX_TEXT_CHARS);
    else detail[key] = '[redacted]';
  }

  return {
    category: input.category,
    action: input.action.trim().slice(0, MAX_TEXT_CHARS),
    outcome: input.outcome,
    actor: input.actor,
    subjectId: input.subjectId ?? null,
    detail,
  };
}

function computeDigest(entry: Omit<AuditEntry, 'digest'>): string {
  const canonical = [
    entry.sequence,
    entry.timestamp,
    entry.category,
    entry.action,
    entry.outcome,
    entry.actor,
    entry.subjectId ?? '',
    Object.entries(entry.detail).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${String(value)}`).join(','),
    entry.previousDigest,
  ].join('\u0001');
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  }
  // A second pass over the reversed input reduces trivial collisions.
  let secondary = 5381;
  for (let index = canonical.length - 1; index >= 0; index -= 1) {
    secondary = Math.imul(secondary, 33) ^ canonical.charCodeAt(index);
  }
  return `audit-${(hash >>> 0).toString(36)}-${(secondary >>> 0).toString(36)}`;
}

function validateBook(book: AuditBook): AuditBook {
  if (book.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.entries)) {
    throw new AuditLogError('Stored audit book has an unsupported schema.');
  }
  return cloneBook(book);
}

function cloneBook(book: AuditBook): AuditBook {
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: book.entries.map((entry) => ({ ...entry, detail: { ...entry.detail } })),
    rotatedBefore: book.rotatedBefore,
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AuditLogError(`${name} must be a positive safe integer.`);
  return value;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AuditLogError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

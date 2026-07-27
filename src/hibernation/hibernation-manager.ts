import { StorageLayer } from '../storage/storage-layer';
import type { BackgroundAgentControlState, BackgroundAgentRoleState } from '../background/background-agent-state';
import type { AgentRole, TaskStatus } from '../orchestration/types';
import { isRoleAllowed, tierLimits, type CapabilityTier } from '../orchestration/capability-tier';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'hibernation:workflows:v1';
const MAX_HIBERNATED_WORKFLOWS = 20;
const MAX_TIER: CapabilityTier = 'phase6';
const DEFAULT_MAX_ROLES = tierLimits(MAX_TIER).maxConcurrentAgents;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_GOAL_CHARS = 1_000;
const MAX_TITLE_CHARS = 120;

export type HibernationReason = 'idle-timeout' | 'suspended' | 'no-runnable-work';

export interface HibernationCandidate {
  planId: string;
  idleMs: number;
  reasons: readonly HibernationReason[];
  recommended: boolean;
  summary: string;
}

/**
 * Compressed role projection.
 *
 * Derived presentation fields (`progress`, `canApprove`, `approvalBlockedReason`)
 * are intentionally **not** stored: they are recomputed on resume from status and
 * dependency state, so hibernated records stay small and cannot drift.
 */
export interface HibernatedRoleState {
  taskId: string;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  dependsOn: readonly string[];
  approvalRequired: boolean;
  estimatedCostUsd: number;
}

export interface HibernatedWorkflowRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  planId: string;
  goal: string;
  hibernatedAt: number;
  lastActivityAt: number;
  estimatedCostUsd: number;
  safety: { activeAgents: number; handoffs: number };
  roles: readonly HibernatedRoleState[];
  digest: string;
  resumeApprovalRequired: true;
}

export interface HibernationBook {
  schemaVersion: typeof SCHEMA_VERSION;
  records: readonly HibernatedWorkflowRecord[];
}

export interface HibernationManagerOptions {
  storage?: StorageLayer;
  storageKey?: string;
  now?: () => number;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
  maxRoles?: number;
}

export class HibernationPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HibernationPolicyError';
  }
}

/**
 * Phase 5D deterministic hibernation.
 *
 * Long-idle control-plane state is compressed to a minimal, integrity-checked
 * projection and restored on demand. Hibernating is a pure, reversible local
 * storage optimisation that starts and stops nothing, so it needs no approval.
 * **Resuming does require explicit human approval**, because it returns an
 * actionable control plane whose prior approvals become live again.
 *
 * Nothing here launches tabs, invokes models, executes tools, approves tasks, or
 * mutates Arena content, and no prompts, conversations, file contents, tool
 * output, or secrets are ever stored.
 */
export class HibernationManager {
  private readonly storage: StorageLayer;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private readonly maxAgeMs: number;
  private readonly maxRoles: number;
  private book: HibernationBook | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: HibernationManagerOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.idleTimeoutMs = positiveInteger(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, 'idleTimeoutMs');
    this.maxAgeMs = positiveInteger(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS, 'maxAgeMs');
    this.maxRoles = positiveInteger(options.maxRoles ?? DEFAULT_MAX_ROLES, 'maxRoles');
  }

  public async initialize(): Promise<void> {
    if (this.book) return;
    const stored = await this.storage.getLarge<HibernationBook>(this.storageKey);
    this.book = stored ? validateBook(stored, this.maxRoles) : { schemaVersion: SCHEMA_VERSION, records: [] };
  }

  /** Deterministically reports which live control states are hibernation candidates. */
  public evaluate(states: readonly BackgroundAgentControlState[], now = this.now()): readonly HibernationCandidate[] {
    positiveTimestamp(now, 'now');
    return states.map((state) => {
      const idleMs = Math.max(0, now - positiveTimestamp(state.savedAt, 'savedAt'));
      const reasons: HibernationReason[] = [];
      if (idleMs >= this.idleTimeoutMs) reasons.push('idle-timeout');
      if (state.suspended) reasons.push('suspended');
      if (!hasRunnableWork(state)) reasons.push('no-runnable-work');
      return {
        planId: state.planId,
        idleMs,
        reasons,
        recommended: reasons.length > 0 && !hasRunningTask(state),
        summary: reasons.length === 0
          ? `Workflow ${state.planId} is active; hibernation is not recommended.`
          : `Workflow ${state.planId} idle for ${idleMs}ms (${reasons.join(', ')}).`,
      };
    });
  }

  /** Compresses a control state into a hibernated record. Executes nothing. */
  public async hibernate(state: BackgroundAgentControlState): Promise<HibernatedWorkflowRecord> {
    const record = compressState(state, this.now(), this.maxRoles);
    return this.runMutation(async () => {
      await this.initialize();
      const withoutExisting = this.book!.records.filter((candidate) => candidate.planId !== record.planId);
      if (withoutExisting.length >= MAX_HIBERNATED_WORKFLOWS) {
        throw new HibernationPolicyError(`At most ${MAX_HIBERNATED_WORKFLOWS} hibernated workflows are retained.`);
      }
      this.book = {
        ...this.book!,
        records: [...withoutExisting, record].sort((left, right) => left.planId.localeCompare(right.planId)),
      };
      await this.persist();
      return cloneRecord(record);
    });
  }

  /** Restores a hibernated workflow. Requires explicit human approval. */
  public async resume(planId: string, approvedByHuman: true): Promise<BackgroundAgentControlState> {
    if (approvedByHuman !== true) throw new HibernationPolicyError('Resuming a hibernated workflow requires explicit human approval.');
    validateIdentifier(planId, 'planId');
    return this.runMutation(async () => {
      await this.initialize();
      const record = this.book!.records.find((candidate) => candidate.planId === planId);
      if (!record) throw new HibernationPolicyError(`No hibernated workflow "${planId}".`);
      if (record.digest !== computeDigest(record)) throw new HibernationPolicyError(`Hibernated workflow "${planId}" failed its integrity check.`);
      this.book = { ...this.book!, records: this.book!.records.filter((candidate) => candidate.planId !== planId) };
      await this.persist();
      return expandRecord(record, this.now());
    });
  }

  /** Read-only inspection that neither restores nor mutates the record. */
  public async peek(planId: string): Promise<HibernatedWorkflowRecord | null> {
    validateIdentifier(planId, 'planId');
    await this.initialize();
    const record = this.book!.records.find((candidate) => candidate.planId === planId);
    return record ? cloneRecord(record) : null;
  }

  public async list(): Promise<readonly HibernatedWorkflowRecord[]> {
    await this.initialize();
    return this.book!.records.map(cloneRecord);
  }

  public async discard(planId: string, approvedByHuman: true): Promise<boolean> {
    if (approvedByHuman !== true) throw new HibernationPolicyError('Discarding a hibernated workflow requires explicit human approval.');
    validateIdentifier(planId, 'planId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.records.length;
      this.book = { ...this.book!, records: this.book!.records.filter((candidate) => candidate.planId !== planId) };
      if (before !== this.book.records.length) await this.persist();
      return before !== this.book.records.length;
    });
  }

  /** Drops records past the retention window. Expiry is deletion only, never execution. */
  public async prune(now = this.now()): Promise<readonly string[]> {
    positiveTimestamp(now, 'now');
    return this.runMutation(async () => {
      await this.initialize();
      const expired = this.book!.records.filter((record) => now - record.hibernatedAt > this.maxAgeMs);
      if (expired.length === 0) return [];
      const expiredIds = expired.map((record) => record.planId);
      this.book = { ...this.book!, records: this.book!.records.filter((record) => !expiredIds.includes(record.planId)) };
      await this.persist();
      return expiredIds;
    });
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

function compressState(state: BackgroundAgentControlState, hibernatedAt: number, maxRoles: number): HibernatedWorkflowRecord {
  validateIdentifier(state.planId, 'planId');
  positiveTimestamp(hibernatedAt, 'hibernatedAt');
  if (!Array.isArray(state.roles)) throw new HibernationPolicyError('Control state roles must be an array.');
  const sourceRoles: readonly BackgroundAgentRoleState[] = state.roles;
  if (sourceRoles.length > maxRoles) throw new HibernationPolicyError(`At most ${maxRoles} role states can be hibernated.`);
  const record: HibernatedWorkflowRecord = {
    schemaVersion: SCHEMA_VERSION,
    planId: state.planId,
    goal: boundedText(state.goal, 'goal', MAX_GOAL_CHARS),
    hibernatedAt,
    lastActivityAt: positiveTimestamp(state.savedAt, 'savedAt'),
    estimatedCostUsd: nonNegativeFinite(state.estimatedCostUsd, 'estimatedCostUsd'),
    safety: {
      activeAgents: nonNegativeInteger(state.safety.activeAgents, 'activeAgents'),
      handoffs: nonNegativeInteger(state.safety.handoffs, 'handoffs'),
    },
    roles: sourceRoles.map((role) => ({
      taskId: validateIdentifier(role.taskId, 'taskId'),
      role: validateRole(role.role),
      title: boundedText(role.title, 'title', MAX_TITLE_CHARS),
      status: validateStatus(role.status),
      dependsOn: role.dependsOn.map((dependencyId) => validateIdentifier(dependencyId, 'dependencyId')),
      approvalRequired: Boolean(role.approvalRequired),
      estimatedCostUsd: nonNegativeFinite(role.estimatedCostUsd, 'roleEstimatedCostUsd'),
    })),
    digest: '',
    resumeApprovalRequired: true,
  };
  return { ...record, digest: computeDigest(record) };
}

function expandRecord(record: HibernatedWorkflowRecord, savedAt: number): BackgroundAgentControlState {
  const statuses = new Map(record.roles.map((role) => [role.taskId, role.status]));
  const approved = new Set(record.roles.filter((role) => !role.approvalRequired).map((role) => role.taskId));
  const roles: BackgroundAgentRoleState[] = record.roles.map((role) => {
    const blockedReason = approvalBlockedReason(role, statuses, approved);
    const terminal = role.status === 'completed' || role.status === 'failed' || role.status === 'blocked';
    return {
      taskId: role.taskId,
      role: role.role,
      title: role.title,
      status: role.status,
      dependsOn: [...role.dependsOn],
      progress: statusProgress(role.status),
      approvalRequired: role.approvalRequired,
      canApprove: role.approvalRequired && blockedReason === null && !terminal,
      approvalBlockedReason: blockedReason,
      estimatedCostUsd: role.estimatedCostUsd,
    };
  });
  return {
    schemaVersion: 1,
    savedAt: positiveTimestamp(savedAt, 'savedAt'),
    suspended: false,
    planId: record.planId,
    goal: record.goal,
    estimatedCostUsd: record.estimatedCostUsd,
    safety: { ...record.safety },
    roles,
  };
}

function approvalBlockedReason(
  role: HibernatedRoleState,
  statuses: ReadonlyMap<string, TaskStatus>,
  approved: ReadonlySet<string>,
): string | null {
  for (const dependencyId of role.dependsOn) {
    const dependencyStatus = statuses.get(dependencyId);
    if (dependencyStatus === undefined) continue;
    if (dependencyStatus === 'failed' || dependencyStatus === 'blocked') {
      return `Task "${role.taskId}" cannot be approved because dependency "${dependencyId}" is ${dependencyStatus}.`;
    }
    if (!approved.has(dependencyId) && dependencyStatus !== 'completed') {
      return `Task "${role.taskId}" requires dependency "${dependencyId}" to be approved before approval.`;
    }
  }
  return null;
}

function hasRunnableWork(state: BackgroundAgentControlState): boolean {
  return state.roles.some((role) => role.status === 'pending' || role.status === 'running');
}

function hasRunningTask(state: BackgroundAgentControlState): boolean {
  return state.roles.some((role) => role.status === 'running');
}

function statusProgress(status: TaskStatus): number {
  return status === 'completed' ? 1 : status === 'running' ? 0.5 : status === 'failed' || status === 'blocked' ? 1 : 0;
}

/** Deterministic FNV-1a digest over the canonical record content. */
function computeDigest(record: HibernatedWorkflowRecord): string {
  const canonical = [
    record.schemaVersion,
    record.planId,
    record.goal,
    record.hibernatedAt,
    record.lastActivityAt,
    record.estimatedCostUsd,
    record.safety.activeAgents,
    record.safety.handoffs,
    ...record.roles.map((role) => [
      role.taskId,
      role.role,
      role.title,
      role.status,
      role.dependsOn.join(','),
      role.approvalRequired,
      role.estimatedCostUsd,
    ].join('\u0001')),
  ].join('\u0002');
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  }
  return `hib-${(hash >>> 0).toString(36)}`;
}

function validateBook(book: HibernationBook, maxRoles: number): HibernationBook {
  if (book.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.records)) {
    throw new HibernationPolicyError('Stored hibernation book has an unsupported schema.');
  }
  if (book.records.length > MAX_HIBERNATED_WORKFLOWS) throw new HibernationPolicyError('Stored hibernation book exceeds the retention limit.');
  for (const record of book.records) {
    validateIdentifier(record.planId, 'planId');
    if (record.resumeApprovalRequired !== true) throw new HibernationPolicyError('Hibernated records must remain resume-approval-required.');
    if (record.roles.length > maxRoles) throw new HibernationPolicyError(`Hibernated record "${record.planId}" exceeds the role limit.`);
    if (record.digest !== computeDigest(record)) throw new HibernationPolicyError(`Hibernated record "${record.planId}" failed its integrity check.`);
  }
  return { schemaVersion: SCHEMA_VERSION, records: book.records.map(cloneRecord) };
}

function cloneRecord(record: HibernatedWorkflowRecord): HibernatedWorkflowRecord {
  return {
    ...record,
    safety: { ...record.safety },
    roles: record.roles.map((role) => ({ ...role, dependsOn: [...role.dependsOn] })),
  };
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new HibernationPolicyError(`${name} is invalid.`);
  return value;
}

function validateRole(role: string): AgentRole {
  if (!isRoleAllowed(role, MAX_TIER)) throw new HibernationPolicyError(`Role "${role}" is not permitted at capability tier "${MAX_TIER}".`);
  return role;
}

function validateStatus(status: string): TaskStatus {
  if (!['pending', 'running', 'completed', 'failed', 'blocked'].includes(status)) throw new HibernationPolicyError('Task status is invalid.');
  return status as TaskStatus;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new HibernationPolicyError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new HibernationPolicyError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new HibernationPolicyError(`${name} must be a positive safe integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new HibernationPolicyError(`${name} must be a non-negative safe integer.`);
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new HibernationPolicyError(`${name} must be a non-negative finite number.`);
  return value;
}

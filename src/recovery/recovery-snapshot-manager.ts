import { StorageLayer } from '../storage/storage-layer';
import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';
import type { HealthSnapshot } from '../health/orchestration-health-monitor';
import type { AgentRole, TaskStatus } from '../orchestration/types';
import { isRoleAllowed, tierLimits, type CapabilityTier } from '../orchestration/capability-tier';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'recovery:snapshots:v1';
const MAX_SNAPSHOTS_PER_PLAN = 10;
const MAX_PLANS = 10;
const MAX_GOAL_CHARS = 1_000;
const MAX_TITLE_CHARS = 120;
const MAX_REASON_CHARS = 300;
const MAX_TIER: CapabilityTier = 'phase6';
const MAX_ROLES = tierLimits(MAX_TIER).maxConcurrentAgents;

export type SnapshotTrigger = 'manual' | 'pre-approval' | 'post-transition' | 'health-degraded' | 'periodic';

export type RecoveryActionKind =
  | 'resume-from-snapshot'
  | 'reapprove-task'
  | 'reset-failed-task'
  | 'investigate-blocker'
  | 'no-action-required';

export interface RecoveryRoleState {
  taskId: string;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  dependsOn: readonly string[];
  approved: boolean;
  estimatedCostUsd: number;
}

export interface RecoverySnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  planId: string;
  goal: string;
  capturedAt: number;
  trigger: SnapshotTrigger;
  healthStatus: HealthSnapshot['status'] | null;
  estimatedCostUsd: number;
  safety: { activeAgents: number; handoffs: number };
  roles: readonly RecoveryRoleState[];
  digest: string;
  restoreApprovalRequired: true;
}

export interface RecoveryPlanStep {
  order: number;
  kind: RecoveryActionKind;
  taskId: string | null;
  summary: string;
  requiresApproval: boolean;
}

export interface RecoveryPlanProposal {
  planId: string;
  snapshotId: string | null;
  capturedAt: number | null;
  /** How many tasks would regress if this snapshot were restored. */
  progressLossCount: number;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  steps: readonly RecoveryPlanStep[];
  /** Always false: Phase 5E proposes, a human disposes. */
  autoExecutable: false;
}

export interface RecoveryBook {
  schemaVersion: typeof SCHEMA_VERSION;
  snapshots: readonly RecoverySnapshot[];
}

export interface RecoverySnapshotManagerOptions {
  storage?: StorageLayer;
  storageKey?: string;
  now?: () => number;
  idFactory?: () => string;
  maxSnapshotsPerPlan?: number;
}

export class RecoveryPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RecoveryPolicyError';
  }
}

/**
 * Phase 5E deterministic snapshot and recovery-proposal system.
 *
 * It captures bounded, integrity-checked control-plane snapshots and derives a
 * deterministic, human-approved recovery plan. It never restores automatically,
 * never invokes a model, never executes a tool, never launches a tab, and never
 * mutates Arena content. Snapshots hold no prompts, conversations, file
 * contents, tool output, or secrets.
 */
export class RecoverySnapshotManager {
  private readonly storage: StorageLayer;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly maxSnapshotsPerPlan: number;
  private book: RecoveryBook | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: RecoverySnapshotManagerOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `snap-${Math.random().toString(36).slice(2, 10)}`);
    this.maxSnapshotsPerPlan = positiveInteger(options.maxSnapshotsPerPlan ?? MAX_SNAPSHOTS_PER_PLAN, 'maxSnapshotsPerPlan');
  }

  public async initialize(): Promise<void> {
    if (this.book) return;
    const stored = await this.storage.getLarge<RecoveryBook>(this.storageKey);
    this.book = stored ? validateBook(stored) : { schemaVersion: SCHEMA_VERSION, snapshots: [] };
  }

  /**
   * Captures a snapshot. Capturing is a read-only observation of existing state,
   * so it needs no approval; restoring from one does.
   */
  public async capture(
    orchestration: OrchestrationServiceSnapshot,
    trigger: SnapshotTrigger = 'manual',
    health: HealthSnapshot | null = null,
  ): Promise<RecoverySnapshot> {
    const snapshot = buildSnapshot(orchestration, validateTrigger(trigger), health, this.now(), this.idFactory());
    return this.runMutation(async () => {
      await this.initialize();
      const planIds = new Set(this.book!.snapshots.map((entry) => entry.planId));
      if (!planIds.has(snapshot.planId) && planIds.size >= MAX_PLANS) {
        throw new RecoveryPolicyError(`At most ${MAX_PLANS} plans can retain recovery snapshots.`);
      }
      const forPlan = this.book!.snapshots.filter((entry) => entry.planId === snapshot.planId);
      const others = this.book!.snapshots.filter((entry) => entry.planId !== snapshot.planId);
      // Ring buffer: the oldest snapshot for this plan is dropped, never an unrelated plan's.
      const retained = [...forPlan, snapshot].slice(-this.maxSnapshotsPerPlan);
      this.book = { ...this.book!, snapshots: [...others, ...retained] };
      await this.persist();
      return cloneSnapshot(snapshot);
    });
  }

  public async list(planId?: string): Promise<readonly RecoverySnapshot[]> {
    if (planId !== undefined) validateIdentifier(planId, 'planId');
    await this.initialize();
    return this.book!.snapshots
      .filter((entry) => planId === undefined || entry.planId === planId)
      .map(cloneSnapshot)
      .sort((left, right) => left.capturedAt - right.capturedAt || left.id.localeCompare(right.id));
  }

  public async get(snapshotId: string): Promise<RecoverySnapshot | null> {
    validateIdentifier(snapshotId, 'snapshotId');
    await this.initialize();
    const snapshot = this.book!.snapshots.find((entry) => entry.id === snapshotId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  /**
   * Builds a deterministic recovery proposal from the newest healthy snapshot.
   *
   * "Healthy" means the snapshot predates the current failure and has no failed
   * task of its own, so restoring it is a genuine step backwards to safety.
   */
  public async proposeRecovery(current: OrchestrationServiceSnapshot, health: HealthSnapshot | null = null): Promise<RecoveryPlanProposal> {
    if (!current.active || !current.planId) {
      return {
        planId: '',
        snapshotId: null,
        capturedAt: null,
        progressLossCount: 0,
        confidence: 'low',
        rationale: 'No active workflow is present, so there is nothing to recover.',
        steps: [{ order: 1, kind: 'no-action-required', taskId: null, summary: 'Start or restore a workflow before requesting recovery.', requiresApproval: false }],
        autoExecutable: false,
      };
    }

    await this.initialize();
    const planId = current.planId;
    const candidates = this.book!.snapshots
      .filter((entry) => entry.planId === planId && !entry.roles.some((role) => role.status === 'failed'))
      .sort((left, right) => right.capturedAt - left.capturedAt || right.id.localeCompare(left.id));
    const chosen = candidates[0] ?? null;

    const failedTasks = current.cards.filter((card) => card.status === 'failed');
    const blockedTasks = current.cards.filter((card) => card.status === 'blocked');
    const steps: RecoveryPlanStep[] = [];
    let order = 1;

    if (chosen) {
      steps.push({
        order: order++,
        kind: 'resume-from-snapshot',
        taskId: null,
        summary: `Restore plan ${planId} from snapshot ${chosen.id} captured at ${chosen.capturedAt}.`,
        requiresApproval: true,
      });
    }
    for (const task of failedTasks) {
      steps.push({
        order: order++,
        kind: 'reset-failed-task',
        taskId: task.id,
        summary: `Reset failed ${task.role} task "${task.id}" and re-approve it before any retry.`,
        requiresApproval: true,
      });
    }
    for (const task of blockedTasks) {
      steps.push({
        order: order++,
        kind: 'investigate-blocker',
        taskId: task.id,
        summary: `Investigate blocker on ${task.role} task "${task.id}"${task.approvalBlockedReason ? `: ${task.approvalBlockedReason}` : '.'}`,
        requiresApproval: true,
      });
    }
    if (chosen) {
      for (const role of chosen.roles.filter((entry) => entry.approved)) {
        const card = current.cards.find((entry) => entry.id === role.taskId);
        if (card && card.approvalRequired) {
          steps.push({
            order: order++,
            kind: 'reapprove-task',
            taskId: role.taskId,
            summary: `Re-approve ${role.role} task "${role.taskId}"; snapshot approval is not carried forward automatically.`,
            requiresApproval: true,
          });
        }
      }
    }
    if (steps.length === 0) {
      steps.push({
        order: 1,
        kind: 'no-action-required',
        taskId: null,
        summary: chosen === null
          ? `No recovery snapshot exists for plan ${planId}; capture one before relying on recovery.`
          : `Plan ${planId} shows no failed or blocked task; no recovery action is required.`,
        requiresApproval: false,
      });
    }

    const progressLossCount = chosen ? countProgressLoss(chosen, current) : 0;
    return {
      planId,
      snapshotId: chosen?.id ?? null,
      capturedAt: chosen?.capturedAt ?? null,
      progressLossCount,
      confidence: confidenceFor(chosen, failedTasks.length, progressLossCount, health),
      rationale: buildRationale(planId, chosen, failedTasks.length, blockedTasks.length, progressLossCount, health),
      steps,
      autoExecutable: false,
    };
  }

  /** Restores a snapshot into a control-plane projection. Requires explicit human approval. */
  public async restore(snapshotId: string, approvedByHuman: true): Promise<RecoverySnapshot> {
    if (approvedByHuman !== true) throw new RecoveryPolicyError('Restoring a recovery snapshot requires explicit human approval.');
    validateIdentifier(snapshotId, 'snapshotId');
    await this.initialize();
    const snapshot = this.book!.snapshots.find((entry) => entry.id === snapshotId);
    if (!snapshot) throw new RecoveryPolicyError(`No recovery snapshot "${snapshotId}".`);
    if (snapshot.digest !== computeDigest(snapshot)) throw new RecoveryPolicyError(`Recovery snapshot "${snapshotId}" failed its integrity check.`);
    return cloneSnapshot(snapshot);
  }

  public async discardPlan(planId: string, approvedByHuman: true): Promise<number> {
    if (approvedByHuman !== true) throw new RecoveryPolicyError('Discarding recovery snapshots requires explicit human approval.');
    validateIdentifier(planId, 'planId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.snapshots.length;
      this.book = { ...this.book!, snapshots: this.book!.snapshots.filter((entry) => entry.planId !== planId) };
      const removed = before - this.book.snapshots.length;
      if (removed > 0) await this.persist();
      return removed;
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

function buildSnapshot(
  orchestration: OrchestrationServiceSnapshot,
  trigger: SnapshotTrigger,
  health: HealthSnapshot | null,
  capturedAt: number,
  id: string,
): RecoverySnapshot {
  if (!orchestration.active || !orchestration.planId) throw new RecoveryPolicyError('Only an active workflow can be snapshotted.');
  validateIdentifier(orchestration.planId, 'planId');
  validateIdentifier(id, 'snapshotId');
  if (orchestration.cards.length > MAX_ROLES) throw new RecoveryPolicyError(`Recovery snapshots support at most ${MAX_ROLES} role states.`);
  const snapshot: RecoverySnapshot = {
    schemaVersion: SCHEMA_VERSION,
    id,
    planId: orchestration.planId,
    goal: boundedText(orchestration.goal ?? '', 'goal', MAX_GOAL_CHARS),
    capturedAt: positiveTimestamp(capturedAt, 'capturedAt'),
    trigger,
    healthStatus: health ? validateHealthStatus(health.status) : null,
    estimatedCostUsd: nonNegativeFinite(orchestration.estimatedCostUsd, 'estimatedCostUsd'),
    safety: {
      activeAgents: nonNegativeInteger(orchestration.safety.activeAgents, 'activeAgents'),
      handoffs: nonNegativeInteger(orchestration.safety.handoffs, 'handoffs'),
    },
    roles: orchestration.cards.map((card) => ({
      taskId: validateIdentifier(card.id, 'taskId'),
      role: validateRole(card.role),
      title: boundedText(card.title, 'title', MAX_TITLE_CHARS),
      status: validateStatus(card.status),
      dependsOn: card.dependsOn.map((dependencyId) => validateIdentifier(dependencyId, 'dependencyId')),
      approved: !card.approvalRequired,
      estimatedCostUsd: nonNegativeFinite(card.estimatedCostUsd, 'roleEstimatedCostUsd'),
    })),
    digest: '',
    restoreApprovalRequired: true,
  };
  return { ...snapshot, digest: computeDigest(snapshot) };
}

/**
 * Forward-progress rank.
 *
 * `blocked` and `failed` are *not* progress — rolling back out of them is a gain,
 * not a loss — so they rank alongside `pending`. Only `running` and `completed`
 * represent work that a rollback would genuinely discard.
 */
const PROGRESS_RANK: Readonly<Record<TaskStatus, number>> = { pending: 0, blocked: 0, failed: 0, running: 1, completed: 2 };

function countProgressLoss(snapshot: RecoverySnapshot, current: OrchestrationServiceSnapshot): number {
  let loss = 0;
  for (const card of current.cards) {
    const role = snapshot.roles.find((entry) => entry.taskId === card.id);
    if (!role) continue;
    if (card.status === 'failed') continue;
    if (PROGRESS_RANK[card.status] > PROGRESS_RANK[role.status]) loss += 1;
  }
  return loss;
}

function confidenceFor(
  snapshot: RecoverySnapshot | null,
  failedCount: number,
  progressLossCount: number,
  health: HealthSnapshot | null,
): 'high' | 'medium' | 'low' {
  if (!snapshot) return 'low';
  if (health?.status === 'critical' && failedCount > 1) return 'low';
  if (progressLossCount === 0 && failedCount <= 1) return 'high';
  if (progressLossCount <= 1) return 'medium';
  return 'low';
}

function buildRationale(
  planId: string,
  snapshot: RecoverySnapshot | null,
  failedCount: number,
  blockedCount: number,
  progressLossCount: number,
  health: HealthSnapshot | null,
): string {
  if (!snapshot) return `Plan ${planId} has no clean recovery snapshot; capture snapshots before failures to enable recovery.`;
  return [
    `Plan ${planId} can roll back to snapshot ${snapshot.id} (${snapshot.trigger}).`,
    `${failedCount} failed and ${blockedCount} blocked task(s) observed.`,
    `Restoring would regress ${progressLossCount} task(s).`,
    health ? `Current health is ${health.status}.` : 'No health snapshot was supplied.',
    'Every step requires explicit human approval.',
  ].join(' ').slice(0, MAX_REASON_CHARS * 2);
}

function computeDigest(snapshot: RecoverySnapshot): string {
  const canonical = [
    snapshot.schemaVersion,
    snapshot.id,
    snapshot.planId,
    snapshot.goal,
    snapshot.capturedAt,
    snapshot.trigger,
    snapshot.healthStatus ?? 'none',
    snapshot.estimatedCostUsd,
    snapshot.safety.activeAgents,
    snapshot.safety.handoffs,
    ...snapshot.roles.map((role) => [
      role.taskId,
      role.role,
      role.title,
      role.status,
      role.dependsOn.join(','),
      role.approved,
      role.estimatedCostUsd,
    ].join('\u0001')),
  ].join('\u0002');
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  }
  return `rec-${(hash >>> 0).toString(36)}`;
}

function validateBook(book: RecoveryBook): RecoveryBook {
  if (book.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.snapshots)) {
    throw new RecoveryPolicyError('Stored recovery book has an unsupported schema.');
  }
  const snapshots: readonly RecoverySnapshot[] = book.snapshots;
  if (snapshots.length > MAX_PLANS * MAX_SNAPSHOTS_PER_PLAN) throw new RecoveryPolicyError('Stored recovery book exceeds the snapshot limit.');
  for (const snapshot of snapshots) {
    validateIdentifier(snapshot.id, 'snapshotId');
    validateIdentifier(snapshot.planId, 'planId');
    if (snapshot.restoreApprovalRequired !== true) throw new RecoveryPolicyError('Recovery snapshots must remain restore-approval-required.');
    if (snapshot.digest !== computeDigest(snapshot)) throw new RecoveryPolicyError(`Recovery snapshot "${snapshot.id}" failed its integrity check.`);
  }
  return { schemaVersion: SCHEMA_VERSION, snapshots: snapshots.map(cloneSnapshot) };
}

function cloneSnapshot(snapshot: RecoverySnapshot): RecoverySnapshot {
  return {
    ...snapshot,
    safety: { ...snapshot.safety },
    roles: snapshot.roles.map((role) => ({ ...role, dependsOn: [...role.dependsOn] })),
  };
}

function validateTrigger(trigger: SnapshotTrigger): SnapshotTrigger {
  if (!['manual', 'pre-approval', 'post-transition', 'health-degraded', 'periodic'].includes(trigger)) {
    throw new RecoveryPolicyError('Snapshot trigger is invalid.');
  }
  return trigger;
}

function validateHealthStatus(status: HealthSnapshot['status']): HealthSnapshot['status'] {
  if (status !== 'healthy' && status !== 'attention' && status !== 'critical') throw new RecoveryPolicyError('Health status is invalid.');
  return status;
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new RecoveryPolicyError(`${name} is invalid.`);
  return value;
}

function validateRole(role: string): AgentRole {
  if (!isRoleAllowed(role, MAX_TIER)) throw new RecoveryPolicyError(`Role "${role}" is not permitted at capability tier "${MAX_TIER}".`);
  return role;
}

function validateStatus(status: string): TaskStatus {
  if (!['pending', 'running', 'completed', 'failed', 'blocked'].includes(status)) throw new RecoveryPolicyError('Task status is invalid.');
  return status as TaskStatus;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new RecoveryPolicyError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RecoveryPolicyError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RecoveryPolicyError(`${name} must be a positive safe integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RecoveryPolicyError(`${name} must be a non-negative safe integer.`);
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RecoveryPolicyError(`${name} must be a non-negative finite number.`);
  return value;
}

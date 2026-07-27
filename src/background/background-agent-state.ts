import type { OrchestrationServiceSnapshot } from './orchestration-service';
import type { AgentRole, TaskStatus } from '../orchestration/types';
import { isRoleAllowed, tierLimits, type CapabilityTier } from '../orchestration/capability-tier';
import { StorageLayer } from '../storage/storage-layer';

const SCHEMA_VERSION = 1;
const DEFAULT_STORAGE_KEY = 'background:agent-control-state:v1';
/** Persistence accepts up to the highest supported tier; the orchestrator still enforces the active tier. */
const MAX_TIER: CapabilityTier = 'phase6';
const MAX_AGENTS = tierLimits(MAX_TIER).maxConcurrentAgents;
const MAX_GOAL_CHARS = 4_000;
const MAX_TITLE_CHARS = 200;
const MAX_BLOCKER_CHARS = 300;

export interface BackgroundAgentRoleState {
  taskId: string;
  role: AgentRole;
  title: string;
  status: TaskStatus;
  dependsOn: readonly string[];
  progress: number;
  approvalRequired: boolean;
  canApprove: boolean;
  approvalBlockedReason: string | null;
  estimatedCostUsd: number;
}

export interface BackgroundAgentControlState {
  schemaVersion: typeof SCHEMA_VERSION;
  savedAt: number;
  suspended: boolean;
  planId: string;
  goal: string;
  estimatedCostUsd: number;
  safety: {
    activeAgents: number;
    handoffs: number;
  };
  roles: readonly BackgroundAgentRoleState[];
}

export interface BackgroundAgentStateStoreOptions {
  storage?: StorageLayer;
  storageKey?: string;
  now?: () => number;
}

export class BackgroundAgentStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BackgroundAgentStateError';
  }
}

/**
 * Phase 5A durable control-plane state.
 *
 * This persists only bounded orchestration dashboard state so the MV3 service
 * worker/Side Panel can restore visibility after suspension or tab close. It is
 * not an execution queue and cannot launch tabs, models, tools, or page actions.
 */
export class BackgroundAgentStateStore {
  private readonly storage: StorageLayer;
  private readonly storageKey: string;
  private readonly now: () => number;

  public constructor(options: BackgroundAgentStateStoreOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.now = options.now ?? Date.now;
  }

  public async saveSnapshot(snapshot: OrchestrationServiceSnapshot): Promise<BackgroundAgentControlState | null> {
    if (!snapshot.active || !snapshot.planId || !snapshot.goal) {
      await this.clear();
      return null;
    }
    const state = stateFromSnapshot(snapshot, this.now());
    await this.storage.putLarge(this.storageKey, state);
    return cloneState(state);
  }

  public async restore(): Promise<BackgroundAgentControlState | null> {
    const stored = await this.storage.getLarge<BackgroundAgentControlState>(this.storageKey);
    if (!stored) return null;
    return cloneState(validateStoredState(stored));
  }

  public async markSuspended(planId: string): Promise<BackgroundAgentControlState> {
    return this.updateSuspended(planId, true);
  }

  public async markResumed(planId: string): Promise<BackgroundAgentControlState> {
    return this.updateSuspended(planId, false);
  }

  public async clear(): Promise<void> {
    await this.storage.removeLarge(this.storageKey);
  }

  private async updateSuspended(planId: string, suspended: boolean): Promise<BackgroundAgentControlState> {
    validateIdentifier(planId, 'planId');
    const current = await this.restore();
    if (!current) throw new BackgroundAgentStateError('No background agent control state is available to update.');
    if (current.planId !== planId) throw new BackgroundAgentStateError('Stored background state does not match the requested plan.');
    const updated: BackgroundAgentControlState = { ...current, suspended, savedAt: this.now() };
    await this.storage.putLarge(this.storageKey, updated);
    return cloneState(updated);
  }
}

function stateFromSnapshot(snapshot: OrchestrationServiceSnapshot, savedAt: number): BackgroundAgentControlState {
  if (!Number.isSafeInteger(savedAt) || savedAt <= 0) throw new BackgroundAgentStateError('savedAt must be a positive safe-integer timestamp.');
  if (!snapshot.planId) throw new BackgroundAgentStateError('Active orchestration snapshots require a planId.');
  validateIdentifier(snapshot.planId, 'planId');
  if (snapshot.cards.length > MAX_AGENTS) throw new BackgroundAgentStateError(`Restore supports at most ${MAX_AGENTS} role states.`);
  if (snapshot.safety.activeAgents > MAX_AGENTS) throw new BackgroundAgentStateError(`At most ${MAX_AGENTS} active agents are supported.`);
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt,
    suspended: false,
    planId: snapshot.planId,
    goal: boundedText(snapshot.goal ?? '', 'goal', MAX_GOAL_CHARS),
    estimatedCostUsd: nonNegativeFinite(snapshot.estimatedCostUsd, 'estimatedCostUsd'),
    safety: {
      activeAgents: nonNegativeInteger(snapshot.safety.activeAgents, 'activeAgents'),
      handoffs: nonNegativeInteger(snapshot.safety.handoffs, 'handoffs'),
    },
    roles: snapshot.cards.map((card) => ({
      taskId: validateIdentifier(card.id, 'taskId'),
      role: validateRole(card.role),
      title: boundedText(card.title, 'title', MAX_TITLE_CHARS),
      status: validateStatus(card.status),
      dependsOn: card.dependsOn.map((dependencyId) => validateIdentifier(dependencyId, 'dependencyId')),
      progress: boundedProgress(card.progress),
      approvalRequired: card.approvalRequired,
      canApprove: card.canApprove,
      approvalBlockedReason: card.approvalBlockedReason ? card.approvalBlockedReason.slice(0, MAX_BLOCKER_CHARS) : null,
      estimatedCostUsd: nonNegativeFinite(card.estimatedCostUsd, 'roleEstimatedCostUsd'),
    })),
  };
}

function validateStoredState(state: BackgroundAgentControlState): BackgroundAgentControlState {
  if (state.schemaVersion !== SCHEMA_VERSION) throw new BackgroundAgentStateError('Unsupported background agent state schema.');
  if (!Array.isArray(state.roles)) throw new BackgroundAgentStateError('Background agent state roles must be an array.');
  return stateFromSnapshot({
    active: true,
    planId: state.planId,
    goal: state.goal,
    estimatedCostUsd: state.estimatedCostUsd,
    safety: state.safety,
    cards: state.roles.map((role) => ({
      id: role.taskId,
      role: role.role,
      title: role.title,
      status: role.status,
      dependsOn: role.dependsOn,
      estimatedCostUsd: role.estimatedCostUsd,
      progress: role.progress,
      approvalRequired: role.approvalRequired,
      canApprove: role.canApprove,
      approvalBlockedReason: role.approvalBlockedReason,
    })),
  }, state.savedAt);
}

function cloneState(state: BackgroundAgentControlState): BackgroundAgentControlState {
  return {
    ...state,
    safety: { ...state.safety },
    roles: state.roles.map((role) => ({ ...role, dependsOn: [...role.dependsOn] })),
  };
}

function validateIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new BackgroundAgentStateError(`${name} is invalid.`);
  return value;
}

function validateRole(role: string): AgentRole {
  if (!isRoleAllowed(role, MAX_TIER)) throw new BackgroundAgentStateError(`Role "${role}" is not permitted at capability tier "${MAX_TIER}".`);
  return role;
}

function validateStatus(status: string): TaskStatus {
  if (!['pending', 'running', 'completed', 'failed', 'blocked'].includes(status)) throw new BackgroundAgentStateError('Task status is invalid.');
  return status as TaskStatus;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new BackgroundAgentStateError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new BackgroundAgentStateError(`${name} must be a non-negative safe integer.`);
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new BackgroundAgentStateError(`${name} must be a non-negative finite number.`);
  return value;
}

function boundedProgress(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new BackgroundAgentStateError('progress must be in the range [0, 1].');
  return value;
}

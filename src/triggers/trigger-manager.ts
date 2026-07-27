import { StorageLayer } from '../storage/storage-layer';
import type { AgentMemoryKind } from '../memory/agent-memory-graph';
import type { HealthSnapshot } from '../health/orchestration-health-monitor';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'triggers:agent-triggers:v1';
const MAX_TRIGGERS = 25;
const MAX_DUE_RUNS = 100;
const MAX_GOAL_CHARS = 1_000;
const MAX_REASON_CHARS = 300;
const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;

export type HealthStatus = HealthSnapshot['status'];

export type TriggerSource =
  | 'health-status-changed'
  | 'schedule-due-run-created'
  | 'memory-candidate-created'
  | 'manual';

/**
 * Internal-only trigger conditions.
 *
 * Phase 5C intentionally supports no webhook, no external network source, no
 * file-system watcher, and no page-driven source. Every condition is evaluated
 * against events that this extension already produces internally.
 */
export type TriggerCondition =
  | { type: 'health-status-changed'; toStatus: readonly HealthStatus[] }
  | { type: 'schedule-due-run-created'; scheduleId?: string }
  | { type: 'memory-candidate-created'; workflowId?: string; kind?: AgentMemoryKind }
  | { type: 'manual' };

export type TriggerEvent =
  | { type: 'health-status-changed'; status: HealthStatus; previousStatus?: HealthStatus | null; observedAt: number }
  | { type: 'schedule-due-run-created'; scheduleId: string; dueRunId: string; observedAt: number }
  | { type: 'memory-candidate-created'; candidateId: string; workflowId: string; kind: AgentMemoryKind; observedAt: number };

export interface TriggerInput {
  id?: string;
  planId: string;
  goal: string;
  condition: TriggerCondition;
  approvedByHuman: true;
  enabled?: boolean;
  cooldownMs?: number;
  maxFires?: number;
}

export interface TriggerDefinition {
  id: string;
  planId: string;
  goal: string;
  source: TriggerSource;
  condition: TriggerCondition;
  enabled: boolean;
  cooldownMs: number;
  maxFires: number | null;
  createdAt: number;
  updatedAt: number;
  lastFiredAt: number | null;
  fireCount: number;
  approvalRequired: true;
}

export interface TriggeredAgentDueRun {
  id: string;
  triggerId: string;
  planId: string;
  goal: string;
  source: TriggerSource;
  reason: string;
  observedAt: number;
  firedAt: number;
  approvedForExecution: false;
}

export interface TriggerBook {
  schemaVersion: typeof SCHEMA_VERSION;
  triggers: readonly TriggerDefinition[];
  dueRuns: readonly TriggeredAgentDueRun[];
}

export interface TriggerManagerOptions {
  storage?: StorageLayer;
  storageKey?: string;
  now?: () => number;
  idFactory?: () => string;
}

export class TriggerPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TriggerPolicyError';
  }
}

/**
 * Phase 5C deterministic trigger registry.
 *
 * A fired trigger records `TriggeredAgentDueRun { approvedForExecution: false }`
 * only. It never launches tabs, invokes models, executes tools, approves tasks,
 * navigates pages, or mutates Arena content. Creating, enabling, disabling,
 * removing, manually firing, and acknowledging all require explicit human
 * approval.
 */
export class TriggerManager {
  private readonly storage: StorageLayer;
  private readonly storageKey: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private book: TriggerBook | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: TriggerManagerOptions = {}) {
    this.storage = options.storage ?? new StorageLayer();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `trigger-${Math.random().toString(36).slice(2, 10)}`);
  }

  public async initialize(): Promise<void> {
    if (this.book) return;
    const stored = await this.storage.getLarge<TriggerBook>(this.storageKey);
    this.book = stored ? validateBook(stored) : { schemaVersion: SCHEMA_VERSION, triggers: [], dueRuns: [] };
  }

  public async create(input: TriggerInput): Promise<TriggerDefinition> {
    if (input.approvedByHuman !== true) throw new TriggerPolicyError('Creating a trigger requires explicit human approval.');
    return this.runMutation(async () => {
      await this.initialize();
      if (this.book!.triggers.length >= MAX_TRIGGERS) throw new TriggerPolicyError(`At most ${MAX_TRIGGERS} triggers are supported.`);
      const trigger = sanitizeTriggerInput(input, input.id ?? this.idFactory(), this.now());
      if (this.book!.triggers.some((candidate) => candidate.id === trigger.id)) throw new TriggerPolicyError(`Trigger "${trigger.id}" already exists.`);
      this.book = {
        ...this.book!,
        triggers: [...this.book!.triggers, trigger].sort((left, right) => left.id.localeCompare(right.id)),
      };
      await this.persist();
      return cloneTrigger(trigger);
    });
  }

  public async setEnabled(triggerId: string, enabled: boolean, approvedByHuman: true): Promise<TriggerDefinition> {
    if (approvedByHuman !== true) throw new TriggerPolicyError('Changing trigger state requires explicit human approval.');
    validateIdentifier(triggerId, 'triggerId');
    return this.runMutation(async () => {
      await this.initialize();
      const current = this.requireTrigger(triggerId);
      const updated: TriggerDefinition = { ...current, enabled, updatedAt: this.now() };
      this.replaceTrigger(updated);
      await this.persist();
      return cloneTrigger(updated);
    });
  }

  public async remove(triggerId: string, approvedByHuman: true): Promise<boolean> {
    if (approvedByHuman !== true) throw new TriggerPolicyError('Removing a trigger requires explicit human approval.');
    validateIdentifier(triggerId, 'triggerId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.triggers.length;
      this.book = {
        ...this.book!,
        triggers: this.book!.triggers.filter((trigger) => trigger.id !== triggerId),
        dueRuns: this.book!.dueRuns.filter((run) => run.triggerId !== triggerId),
      };
      if (before !== this.book.triggers.length) await this.persist();
      return before !== this.book.triggers.length;
    });
  }

  /**
   * Evaluates an internal event against enabled triggers and records
   * approval-required due runs for every match. Manual triggers are never
   * dispatched here; they require {@link fireManual}.
   */
  public async dispatch(event: TriggerEvent): Promise<readonly TriggeredAgentDueRun[]> {
    const validated = validateEvent(event);
    return this.runMutation(async () => {
      await this.initialize();
      const firedAt = this.now();
      const created: TriggeredAgentDueRun[] = [];
      for (const trigger of this.book!.triggers) {
        if (trigger.source === 'manual') continue;
        if (!this.isFireable(trigger, firedAt)) continue;
        if (!matchesCondition(trigger.condition, validated)) continue;
        created.push(this.recordFire(trigger, validated.observedAt, firedAt, describeEvent(validated)));
      }
      if (created.length > 0) await this.persist();
      return created.map((run) => ({ ...run }));
    });
  }

  public async fireManual(triggerId: string, approvedByHuman: true, reason = 'Manually fired by an approving human.'): Promise<TriggeredAgentDueRun | null> {
    if (approvedByHuman !== true) throw new TriggerPolicyError('Firing a manual trigger requires explicit human approval.');
    validateIdentifier(triggerId, 'triggerId');
    return this.runMutation(async () => {
      await this.initialize();
      const trigger = this.requireTrigger(triggerId);
      if (trigger.source !== 'manual') throw new TriggerPolicyError(`Trigger "${triggerId}" is not a manual trigger.`);
      const firedAt = this.now();
      if (!this.isFireable(trigger, firedAt)) return null;
      const dueRun = this.recordFire(trigger, firedAt, firedAt, boundedText(reason, 'reason', MAX_REASON_CHARS));
      await this.persist();
      return { ...dueRun };
    });
  }

  public async acknowledgeDueRun(dueRunId: string, approvedByHuman: true): Promise<boolean> {
    if (approvedByHuman !== true) throw new TriggerPolicyError('Acknowledging a due run requires explicit human approval.');
    validateIdentifier(dueRunId, 'dueRunId');
    return this.runMutation(async () => {
      await this.initialize();
      const before = this.book!.dueRuns.length;
      this.book = { ...this.book!, dueRuns: this.book!.dueRuns.filter((run) => run.id !== dueRunId) };
      if (before !== this.book.dueRuns.length) await this.persist();
      return before !== this.book.dueRuns.length;
    });
  }

  public async snapshot(): Promise<TriggerBook> {
    await this.initialize();
    return cloneBook(this.book!);
  }

  private isFireable(trigger: TriggerDefinition, firedAt: number): boolean {
    if (!trigger.enabled) return false;
    if (trigger.maxFires !== null && trigger.fireCount >= trigger.maxFires) return false;
    if (trigger.lastFiredAt !== null && firedAt - trigger.lastFiredAt < trigger.cooldownMs) return false;
    return true;
  }

  private recordFire(trigger: TriggerDefinition, observedAt: number, firedAt: number, reason: string): TriggeredAgentDueRun {
    const dueRun: TriggeredAgentDueRun = {
      id: `due-${trigger.id}-${firedAt}-${trigger.fireCount + 1}`,
      triggerId: trigger.id,
      planId: trigger.planId,
      goal: trigger.goal,
      source: trigger.source,
      reason: reason.slice(0, MAX_REASON_CHARS),
      observedAt,
      firedAt,
      approvedForExecution: false,
    };
    const fireCount = trigger.fireCount + 1;
    const exhausted = trigger.maxFires !== null && fireCount >= trigger.maxFires;
    this.replaceTrigger({
      ...trigger,
      fireCount,
      lastFiredAt: firedAt,
      enabled: !exhausted,
      updatedAt: firedAt,
    });
    this.book = { ...this.book!, dueRuns: [...this.book!.dueRuns, dueRun].slice(-MAX_DUE_RUNS) };
    return dueRun;
  }

  private requireTrigger(triggerId: string): TriggerDefinition {
    const trigger = this.book!.triggers.find((candidate) => candidate.id === triggerId);
    if (!trigger) throw new TriggerPolicyError(`Unknown trigger "${triggerId}".`);
    return trigger;
  }

  private replaceTrigger(trigger: TriggerDefinition): void {
    this.book = {
      ...this.book!,
      triggers: this.book!.triggers.map((candidate) => candidate.id === trigger.id ? trigger : candidate),
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

function sanitizeTriggerInput(input: TriggerInput, id: string, timestamp: number): TriggerDefinition {
  validateIdentifier(id, 'triggerId');
  validateIdentifier(input.planId, 'planId');
  const condition = validateCondition(input.condition);
  return {
    id,
    planId: input.planId,
    goal: boundedText(input.goal, 'goal', MAX_GOAL_CHARS),
    source: condition.type,
    condition,
    enabled: input.enabled ?? true,
    cooldownMs: cooldownMs(input.cooldownMs ?? 0),
    maxFires: input.maxFires === undefined ? null : positiveInteger(input.maxFires, 'maxFires'),
    createdAt: positiveTimestamp(timestamp, 'createdAt'),
    updatedAt: positiveTimestamp(timestamp, 'updatedAt'),
    lastFiredAt: null,
    fireCount: 0,
    approvalRequired: true,
  };
}

function validateCondition(condition: TriggerCondition): TriggerCondition {
  if (!condition || typeof condition !== 'object') throw new TriggerPolicyError('Trigger condition is required.');
  if (condition.type === 'health-status-changed') {
    if (!Array.isArray(condition.toStatus) || condition.toStatus.length === 0 || condition.toStatus.length > 3) {
      throw new TriggerPolicyError('health-status-changed requires between 1 and 3 target statuses.');
    }
    const statuses = condition.toStatus.map(healthStatus);
    return { type: 'health-status-changed', toStatus: [...new Set(statuses)].sort() };
  }
  if (condition.type === 'schedule-due-run-created') {
    return condition.scheduleId === undefined
      ? { type: 'schedule-due-run-created' }
      : { type: 'schedule-due-run-created', scheduleId: validateIdentifier(condition.scheduleId, 'scheduleId') };
  }
  if (condition.type === 'memory-candidate-created') {
    return {
      type: 'memory-candidate-created',
      ...(condition.workflowId === undefined ? {} : { workflowId: validateIdentifier(condition.workflowId, 'workflowId') }),
      ...(condition.kind === undefined ? {} : { kind: memoryKind(condition.kind) }),
    };
  }
  if (condition.type === 'manual') return { type: 'manual' };
  throw new TriggerPolicyError('Trigger condition type is not supported. Phase 5C supports internal sources only.');
}

function validateEvent(event: TriggerEvent): TriggerEvent {
  if (!event || typeof event !== 'object') throw new TriggerPolicyError('Trigger event is required.');
  const observedAt = positiveTimestamp(event.observedAt, 'observedAt');
  if (event.type === 'health-status-changed') {
    return {
      type: 'health-status-changed',
      status: healthStatus(event.status),
      previousStatus: event.previousStatus === undefined || event.previousStatus === null ? null : healthStatus(event.previousStatus),
      observedAt,
    };
  }
  if (event.type === 'schedule-due-run-created') {
    return {
      type: 'schedule-due-run-created',
      scheduleId: validateIdentifier(event.scheduleId, 'scheduleId'),
      dueRunId: validateIdentifier(event.dueRunId, 'dueRunId'),
      observedAt,
    };
  }
  if (event.type === 'memory-candidate-created') {
    return {
      type: 'memory-candidate-created',
      candidateId: validateIdentifier(event.candidateId, 'candidateId'),
      workflowId: validateIdentifier(event.workflowId, 'workflowId'),
      kind: memoryKind(event.kind),
      observedAt,
    };
  }
  throw new TriggerPolicyError('Trigger event type is not supported. Phase 5C dispatches internal events only.');
}

function matchesCondition(condition: TriggerCondition, event: TriggerEvent): boolean {
  if (condition.type !== event.type) return false;
  if (condition.type === 'health-status-changed' && event.type === 'health-status-changed') {
    if (event.previousStatus === event.status) return false;
    return condition.toStatus.includes(event.status);
  }
  if (condition.type === 'schedule-due-run-created' && event.type === 'schedule-due-run-created') {
    return condition.scheduleId === undefined || condition.scheduleId === event.scheduleId;
  }
  if (condition.type === 'memory-candidate-created' && event.type === 'memory-candidate-created') {
    if (condition.workflowId !== undefined && condition.workflowId !== event.workflowId) return false;
    return condition.kind === undefined || condition.kind === event.kind;
  }
  return false;
}

function describeEvent(event: TriggerEvent): string {
  if (event.type === 'health-status-changed') {
    return `Health status changed from ${event.previousStatus ?? 'unknown'} to ${event.status}.`.slice(0, MAX_REASON_CHARS);
  }
  if (event.type === 'schedule-due-run-created') {
    return `Schedule ${event.scheduleId} created approval-required due run ${event.dueRunId}.`.slice(0, MAX_REASON_CHARS);
  }
  return `Memory candidate ${event.candidateId} (${event.kind}) was created for workflow ${event.workflowId}.`.slice(0, MAX_REASON_CHARS);
}

function validateBook(book: TriggerBook): TriggerBook {
  if (book.schemaVersion !== SCHEMA_VERSION || !Array.isArray(book.triggers) || !Array.isArray(book.dueRuns)) {
    throw new TriggerPolicyError('Stored trigger book has an unsupported schema.');
  }
  if (book.triggers.length > MAX_TRIGGERS) throw new TriggerPolicyError('Stored trigger book exceeds the trigger limit.');
  for (const trigger of book.triggers) {
    validateIdentifier(trigger.id, 'triggerId');
    validateIdentifier(trigger.planId, 'planId');
    validateCondition(trigger.condition);
    if (trigger.approvalRequired !== true) throw new TriggerPolicyError('Stored triggers must remain approval-required.');
  }
  for (const run of book.dueRuns) {
    if (run.approvedForExecution !== false) throw new TriggerPolicyError('Stored due runs must remain unapproved for execution.');
  }
  return cloneBook(book);
}

function cloneBook(book: TriggerBook): TriggerBook {
  return {
    schemaVersion: SCHEMA_VERSION,
    triggers: book.triggers.map(cloneTrigger),
    dueRuns: book.dueRuns.map((run) => ({ ...run })),
  };
}

function cloneTrigger(trigger: TriggerDefinition): TriggerDefinition {
  const condition: TriggerCondition = trigger.condition.type === 'health-status-changed'
    ? { type: 'health-status-changed', toStatus: [...trigger.condition.toStatus] }
    : { ...trigger.condition };
  return { ...trigger, condition };
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new TriggerPolicyError(`${name} is invalid.`);
  return value;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new TriggerPolicyError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TriggerPolicyError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TriggerPolicyError(`${name} must be a positive safe integer.`);
  return value;
}

function cooldownMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COOLDOWN_MS) {
    throw new TriggerPolicyError(`cooldownMs must be a safe integer in the range [0, ${MAX_COOLDOWN_MS}].`);
  }
  return value;
}

function healthStatus(value: HealthStatus): HealthStatus {
  if (value !== 'healthy' && value !== 'attention' && value !== 'critical') throw new TriggerPolicyError('Health status is invalid.');
  return value;
}

function memoryKind(value: AgentMemoryKind): AgentMemoryKind {
  if (!['decision', 'artifact', 'lesson', 'constraint'].includes(value)) throw new TriggerPolicyError('Memory kind is invalid.');
  return value;
}

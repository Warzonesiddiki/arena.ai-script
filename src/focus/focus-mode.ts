import type { OrchestrationServiceSnapshot } from '../background/orchestration-service';
import type { AgentDashboardCard } from '../orchestration/dashboard-state';
import type { HealthSnapshot } from '../health/orchestration-health-monitor';

const MAX_ITEMS = 20;
const MAX_TEXT_CHARS = 160;

/**
 * Phase 8E Focus Mode 3.0.
 *
 * A deterministic view-state reducer that answers one question: *what is the
 * single most important thing to look at right now?* It returns a bounded,
 * pre-sanitised projection so a UI can render an ultra-minimal view without
 * embedding any prioritisation logic.
 *
 * It reads state and returns a projection. It approves nothing, starts nothing,
 * and mutates nothing — every actionable item it surfaces is a *suggestion* that
 * still routes through the existing approval gates.
 */

export type FocusLevel = 'minimal' | 'balanced' | 'detailed';

export type FocusItemKind =
  | 'failed-task'
  | 'blocked-task'
  | 'awaiting-approval'
  | 'running-task'
  | 'budget-risk'
  | 'health-issue'
  | 'idle';

/** Lower sorts first. Failures outrank everything; idle is the fallback. */
const KIND_PRIORITY: Readonly<Record<FocusItemKind, number>> = Object.freeze({
  'failed-task': 0,
  'health-issue': 1,
  'blocked-task': 2,
  'budget-risk': 3,
  'awaiting-approval': 4,
  'running-task': 5,
  idle: 6,
});

/** How many items each level shows. */
const LEVEL_LIMIT: Readonly<Record<FocusLevel, number>> = Object.freeze({
  minimal: 1,
  balanced: 3,
  detailed: MAX_ITEMS,
});

export interface FocusItem {
  id: string;
  kind: FocusItemKind;
  priority: number;
  title: string;
  detail: string;
  taskId: string | null;
  /** True when a human could act on this now (e.g. an approvable task). */
  actionable: boolean;
  /** The suggested next step. Never performed automatically. */
  suggestedAction: string | null;
}

export interface FocusView {
  level: FocusLevel;
  generatedAt: number;
  headline: string;
  items: readonly FocusItem[];
  hiddenCount: number;
  counts: {
    failed: number;
    blocked: number;
    awaitingApproval: number;
    running: number;
    completed: number;
  };
  /** True when there is genuinely nothing needing attention. */
  quiet: boolean;
}

export interface FocusInput {
  orchestration: OrchestrationServiceSnapshot;
  health?: HealthSnapshot | null;
  budgetUsageRatio?: number | null;
  now: number;
}

export interface FocusModeOptions {
  level?: FocusLevel;
  budgetWarnRatio?: number;
}

export class FocusModeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FocusModeError';
  }
}

export class FocusModeEngine {
  private level: FocusLevel;
  private readonly budgetWarnRatio: number;

  public constructor(options: FocusModeOptions = {}) {
    this.level = validateLevel(options.level ?? 'balanced');
    const ratio = options.budgetWarnRatio ?? 0.8;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new FocusModeError('budgetWarnRatio must be in the range (0, 1].');
    this.budgetWarnRatio = ratio;
  }

  public setLevel(level: FocusLevel): FocusLevel {
    this.level = validateLevel(level);
    return this.level;
  }

  /** Cycles minimal → balanced → detailed → minimal. */
  public cycleLevel(): FocusLevel {
    const order: readonly FocusLevel[] = ['minimal', 'balanced', 'detailed'];
    const next = order[(order.indexOf(this.level) + 1) % order.length]!;
    this.level = next;
    return next;
  }

  public build(input: FocusInput): FocusView {
    const now = positiveTimestamp(input.now, 'now');
    const orchestration = input.orchestration;
    if (!orchestration || typeof orchestration !== 'object') throw new FocusModeError('An orchestration snapshot is required.');

    const cards: readonly AgentDashboardCard[] = orchestration.active ? orchestration.cards : [];
    const items: FocusItem[] = [];

    for (const card of cards) {
      if (card.status === 'failed') {
        items.push(item('failed-task', card, `${roleLabel(card.role)} task failed`, card.title, false,
          'Review the failure trace and capture a recovery proposal before retrying.'));
      } else if (card.status === 'blocked') {
        items.push(item('blocked-task', card, `${roleLabel(card.role)} task is blocked`, card.approvalBlockedReason ?? card.title, false,
          'Resolve the blocker before approving downstream work.'));
      } else if (card.status === 'running') {
        items.push(item('running-task', card, `${roleLabel(card.role)} task is running`, card.title, false, null));
      } else if (card.approvalRequired && card.canApprove) {
        items.push(item('awaiting-approval', card, `${roleLabel(card.role)} task is ready for approval`, card.title, true,
          'Review the scoped plan, then approve explicitly if it is correct.'));
      }
    }

    if (input.health && input.health.status !== 'healthy') {
      const worst = [...input.health.issues].sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
      if (worst) {
        items.push({
          id: `focus:health:${worst.id}`,
          kind: 'health-issue',
          priority: KIND_PRIORITY['health-issue'],
          title: `Health is ${input.health.status}`,
          detail: truncate(worst.summary),
          taskId: worst.taskId,
          actionable: false,
          suggestedAction: truncate(worst.recommendedAction),
        });
      }
    }

    const budgetUsageRatio = input.budgetUsageRatio ?? null;
    if (budgetUsageRatio !== null) {
      if (!Number.isFinite(budgetUsageRatio) || budgetUsageRatio < 0) throw new FocusModeError('budgetUsageRatio must be a non-negative finite number.');
      if (budgetUsageRatio >= this.budgetWarnRatio) {
        items.push({
          id: 'focus:budget',
          kind: 'budget-risk',
          priority: KIND_PRIORITY['budget-risk'],
          title: budgetUsageRatio >= 1 ? 'Budget is exhausted' : 'Budget is nearly exhausted',
          detail: `${Math.round(budgetUsageRatio * 100)}% of the workflow budget is committed.`,
          taskId: null,
          actionable: false,
          suggestedAction: 'Confirm remaining work is worth the spend before approving more tasks.',
        });
      }
    }

    // Deterministic order: kind priority, then task id, then item id.
    items.sort((left, right) => (left.priority - right.priority)
      || (left.taskId ?? '').localeCompare(right.taskId ?? '')
      || left.id.localeCompare(right.id));

    const counts = {
      failed: cards.filter((card) => card.status === 'failed').length,
      blocked: cards.filter((card) => card.status === 'blocked').length,
      awaitingApproval: cards.filter((card) => card.approvalRequired && card.canApprove).length,
      running: cards.filter((card) => card.status === 'running').length,
      completed: cards.filter((card) => card.status === 'completed').length,
    };

    if (items.length === 0) {
      items.push({
        id: 'focus:idle',
        kind: 'idle',
        priority: KIND_PRIORITY.idle,
        title: orchestration.active ? 'Nothing needs attention' : 'No active workflow',
        detail: orchestration.active
          ? `${counts.completed} task(s) completed; no failures, blockers, or pending approvals.`
          : 'Create a plan to begin. Nothing runs without explicit approval.',
        taskId: null,
        actionable: false,
        suggestedAction: null,
      });
    }

    const limit = LEVEL_LIMIT[this.level];
    const visible = items.slice(0, Math.min(limit, MAX_ITEMS));
    return {
      level: this.level,
      generatedAt: now,
      headline: truncate(visible[0]!.title),
      items: visible,
      hiddenCount: Math.max(0, items.length - visible.length),
      counts,
      quiet: items.length === 1 && items[0]!.kind === 'idle',
    };
  }
}

function item(kind: FocusItemKind, card: AgentDashboardCard, title: string, detail: string, actionable: boolean, suggestedAction: string | null): FocusItem {
  return {
    id: `focus:${kind}:${card.id}`,
    kind,
    priority: KIND_PRIORITY[kind],
    title: truncate(title),
    detail: truncate(detail),
    taskId: card.id,
    actionable,
    suggestedAction: suggestedAction === null ? null : truncate(suggestedAction),
  };
}

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function severityRank(severity: string): number {
  return severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0;
}

function truncate(value: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS) : '';
}

function validateLevel(level: FocusLevel): FocusLevel {
  if (level !== 'minimal' && level !== 'balanced' && level !== 'detailed') throw new FocusModeError(`Unknown focus level "${String(level)}".`);
  return level;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new FocusModeError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

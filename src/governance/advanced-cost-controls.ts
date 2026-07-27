import type { CostGovernance } from './cost-governance';
import type { AgentRole } from '../orchestration/types';

const MAX_ALERTS = 50;
const DEFAULT_WARN_RATIO = 0.8;
const DEFAULT_STOP_RATIO = 1.0;

/**
 * Phase 6D advanced cost controls.
 *
 * This layers projection, alerting, and an **auto-stop recommendation** on top of
 * the Phase 2E hard reservation governor. "Auto-stop" means the controller
 * refuses to authorise further spend and recommends halting; it never kills a
 * running process, cancels work, or acts on its own. Enforcement remains the
 * hard reservation gate, which already fails closed.
 */

export type CostAlertLevel = 'info' | 'warning' | 'critical';
export type CostAlertKind = 'budget-warning' | 'budget-exhausted' | 'burn-rate' | 'projection-overrun' | 'role-concentration';

export interface CostAlert {
  id: string;
  kind: CostAlertKind;
  level: CostAlertLevel;
  workflowId: string;
  summary: string;
  observedAt: number;
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  recommendedAction: string;
}

export interface RoleSpend {
  role: AgentRole;
  spentUsd: number;
  taskCount: number;
}

export interface CostControlInput {
  workflowId: string;
  budgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  /** Remaining planned work not yet reserved. */
  plannedUsd?: number;
  roleSpend?: readonly RoleSpend[];
  elapsedMs?: number;
  now: number;
}

export interface CostControlDecision {
  workflowId: string;
  generatedAt: number;
  budgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  committedUsd: number;
  projectedTotalUsd: number;
  remainingUsd: number;
  usageRatio: number;
  projectedRatio: number;
  /** Burn rate in USD per hour, or null when elapsed time is unknown. */
  burnRateUsdPerHour: number | null;
  /** Projected seconds until the budget is exhausted at the current burn rate. */
  secondsToExhaustion: number | null;
  status: 'ok' | 'warning' | 'stop';
  /** True when the controller recommends halting further authorisation. */
  stopRecommended: boolean;
  alerts: readonly CostAlert[];
  /** Always false: this layer recommends, the reservation gate enforces. */
  autoStopped: false;
}

export interface AdvancedCostControlOptions {
  warnRatio?: number;
  stopRatio?: number;
  /** Warn when one role exceeds this share of total spend. */
  roleConcentrationRatio?: number;
  governance?: CostGovernance;
}

export class AdvancedCostControlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AdvancedCostControlError';
  }
}

export class AdvancedCostController {
  private readonly warnRatio: number;
  private readonly stopRatio: number;
  private readonly roleConcentrationRatio: number;

  public constructor(options: AdvancedCostControlOptions = {}) {
    this.warnRatio = ratio(options.warnRatio ?? DEFAULT_WARN_RATIO, 'warnRatio');
    this.stopRatio = ratio(options.stopRatio ?? DEFAULT_STOP_RATIO, 'stopRatio');
    this.roleConcentrationRatio = ratio(options.roleConcentrationRatio ?? 0.7, 'roleConcentrationRatio');
    if (this.warnRatio > this.stopRatio) throw new AdvancedCostControlError('warnRatio cannot exceed stopRatio.');
  }

  public evaluate(input: CostControlInput): CostControlDecision {
    const now = positiveTimestamp(input.now, 'now');
    const workflowId = validateIdentifier(input.workflowId, 'workflowId');
    const budgetUsd = positiveFinite(input.budgetUsd, 'budgetUsd');
    const spentUsd = nonNegativeFinite(input.spentUsd, 'spentUsd');
    const reservedUsd = nonNegativeFinite(input.reservedUsd, 'reservedUsd');
    const plannedUsd = nonNegativeFinite(input.plannedUsd ?? 0, 'plannedUsd');

    const committedUsd = round(spentUsd + reservedUsd);
    const projectedTotalUsd = round(committedUsd + plannedUsd);
    const remainingUsd = round(Math.max(0, budgetUsd - committedUsd));
    const usageRatio = round(committedUsd / budgetUsd);
    const projectedRatio = round(projectedTotalUsd / budgetUsd);

    let burnRateUsdPerHour: number | null = null;
    let secondsToExhaustion: number | null = null;
    if (input.elapsedMs !== undefined) {
      const elapsedMs = nonNegativeFinite(input.elapsedMs, 'elapsedMs');
      if (elapsedMs > 0 && spentUsd > 0) {
        burnRateUsdPerHour = round((spentUsd / elapsedMs) * 3_600_000);
        secondsToExhaustion = burnRateUsdPerHour > 0
          ? Math.max(0, Math.round((remainingUsd / burnRateUsdPerHour) * 3_600))
          : null;
      }
    }

    const alerts: CostAlert[] = [];
    const push = (kind: CostAlertKind, level: CostAlertLevel, summary: string, evidence: CostAlert['evidence'], recommendedAction: string): void => {
      alerts.push({ id: `cost:${kind}:${workflowId}:${now}:${alerts.length}`, kind, level, workflowId, summary, observedAt: now, evidence, recommendedAction });
    };

    if (usageRatio >= this.stopRatio) {
      push('budget-exhausted', 'critical',
        `Workflow ${workflowId} has committed ${committedUsd} of its ${budgetUsd} budget.`,
        { committedUsd, budgetUsd, usageRatio },
        'Stop authorising new agent work. Raise the budget explicitly or close the workflow.');
    } else if (usageRatio >= this.warnRatio) {
      push('budget-warning', 'warning',
        `Workflow ${workflowId} has committed ${round(usageRatio * 100)}% of its budget.`,
        { committedUsd, budgetUsd, usageRatio },
        'Review remaining planned work before approving further tasks.');
    }

    if (projectedRatio > 1 && usageRatio < this.stopRatio) {
      push('projection-overrun', 'warning',
        `Planned work projects ${projectedTotalUsd} against a ${budgetUsd} budget.`,
        { projectedTotalUsd, budgetUsd, projectedRatio, plannedUsd },
        'Re-scope or drop planned tasks, or raise the budget before approving them.');
    }

    if (secondsToExhaustion !== null && secondsToExhaustion <= 300 && remainingUsd > 0) {
      push('burn-rate', 'warning',
        `At ${burnRateUsdPerHour} USD/hour the remaining ${remainingUsd} lasts about ${secondsToExhaustion}s.`,
        { burnRateUsdPerHour, remainingUsd, secondsToExhaustion },
        'Expect budget exhaustion shortly; confirm the workflow should continue.');
    }

    const roleSpend = input.roleSpend ?? [];
    if (roleSpend.length > 1 && spentUsd > 0) {
      for (const entry of roleSpend) {
        const share = round(nonNegativeFinite(entry.spentUsd, 'roleSpentUsd') / spentUsd);
        if (share >= this.roleConcentrationRatio) {
          push('role-concentration', 'info',
            `Role "${entry.role}" accounts for ${round(share * 100)}% of workflow spend.`,
            { role: entry.role, share, roleSpentUsd: entry.spentUsd, taskCount: entry.taskCount },
            'Confirm this concentration is intended before approving more work for that role.');
        }
      }
    }

    const bounded = alerts.slice(0, MAX_ALERTS);
    const stopRecommended = usageRatio >= this.stopRatio;
    return {
      workflowId,
      generatedAt: now,
      budgetUsd,
      spentUsd,
      reservedUsd,
      committedUsd,
      projectedTotalUsd,
      remainingUsd,
      usageRatio,
      projectedRatio,
      burnRateUsdPerHour,
      secondsToExhaustion,
      status: stopRecommended ? 'stop' : bounded.some((alert) => alert.level === 'warning') ? 'warning' : 'ok',
      stopRecommended,
      alerts: bounded,
      autoStopped: false,
    };
  }

  /**
   * Whether a further reservation should even be attempted.
   *
   * This is an advisory pre-check. The hard Phase 2E reservation gate remains
   * the enforcement point and is never bypassed by a positive answer here.
   */
  public canAuthorize(decision: CostControlDecision, nextEstimatedCostUsd: number): { allowed: boolean; reason: string } {
    const estimate = nonNegativeFinite(nextEstimatedCostUsd, 'nextEstimatedCostUsd');
    if (decision.stopRecommended) {
      return { allowed: false, reason: `Workflow ${decision.workflowId} has reached its budget; further authorisation is stopped.` };
    }
    if (round(decision.committedUsd + estimate) > decision.budgetUsd) {
      return { allowed: false, reason: `Authorising ${estimate} would exceed the remaining ${decision.remainingUsd}.` };
    }
    return { allowed: true, reason: 'Within budget; the hard reservation gate still applies.' };
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function ratio(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2) throw new AdvancedCostControlError(`${name} must be in the range (0, 2].`);
  return value;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new AdvancedCostControlError(`${name} must be a positive finite number.`);
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new AdvancedCostControlError(`${name} must be a non-negative finite number.`);
  return value;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AdvancedCostControlError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new AdvancedCostControlError(`${name} is invalid.`);
  return value;
}

import type { AgentRole } from '../orchestration/types';

const MAX_WORKFLOWS = 100;
const MAX_ROLES = 5;
const MAX_TEXT_CHARS = 300;

/**
 * Phase 17 cost attribution and cross-workflow trends.
 *
 * Phase 4E reports analytics for *one* workflow. This attributes spend down to
 * role and task across *many*, so a user can answer "where is the money going,
 * and is it getting better or worse?"
 *
 * It is a pure aggregation over records the caller already holds. It collects
 * no new telemetry, opens no channel, persists nothing, and never contacts a
 * model or the network. Attribution is arithmetic, not inference.
 */

export interface WorkflowCostRecord {
  workflowId: string;
  /** Wall-clock completion time, used only for ordering and trend windows. */
  completedAt: number;
  budgetUsd: number;
  entries: readonly {
    taskId: string;
    role: AgentRole;
    costUsd: number;
    status: 'completed' | 'failed' | 'blocked';
  }[];
}

export interface RoleAttribution {
  role: AgentRole;
  totalUsd: number;
  /** Share of all attributed spend, 0..1. */
  share: number;
  taskCount: number;
  averageUsd: number;
  /** Spend on tasks that failed or were blocked — money with nothing to show. */
  wastedUsd: number;
  wasteRatio: number;
}

export interface WorkflowAttribution {
  workflowId: string;
  completedAt: number;
  totalUsd: number;
  budgetUsd: number;
  budgetUsedRatio: number;
  overBudget: boolean;
  wastedUsd: number;
  topRole: AgentRole | null;
}

export interface CostTrend {
  /** Comparison of the newer half against the older half of the window. */
  direction: 'improving' | 'stable' | 'worsening' | 'insufficient-data';
  earlierAverageUsd: number | null;
  laterAverageUsd: number | null;
  changeRatio: number | null;
  explanation: string;
}

export interface CostAttributionReport {
  generatedAt: number;
  workflowCount: number;
  totalSpendUsd: number;
  totalWastedUsd: number;
  wasteRatio: number;
  averageWorkflowUsd: number;
  overBudgetCount: number;
  roles: readonly RoleAttribution[];
  workflows: readonly WorkflowAttribution[];
  /** Most expensive tasks across every supplied workflow. */
  costliestTasks: readonly { workflowId: string; taskId: string; role: AgentRole; costUsd: number }[];
  trend: CostTrend;
  recommendations: readonly string[];
  truncated: boolean;
}

export class CostAttributionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CostAttributionError';
  }
}

export interface CostAttributionOptions {
  /** Relative change below this is reported as "stable" rather than a trend. */
  trendThreshold?: number;
  maxCostliestTasks?: number;
  /** Waste above this share triggers a recommendation. */
  wasteWarnRatio?: number;
}

export class CostAttributionEngine {
  private readonly trendThreshold: number;
  private readonly maxCostliestTasks: number;
  private readonly wasteWarnRatio: number;

  public constructor(options: CostAttributionOptions = {}) {
    this.trendThreshold = ratio(options.trendThreshold ?? 0.1, 'trendThreshold');
    this.maxCostliestTasks = positiveInteger(options.maxCostliestTasks ?? 5, 'maxCostliestTasks');
    this.wasteWarnRatio = ratio(options.wasteWarnRatio ?? 0.2, 'wasteWarnRatio');
  }

  public build(records: readonly WorkflowCostRecord[], generatedAt: number): CostAttributionReport {
    positiveTimestamp(generatedAt, 'generatedAt');
    if (!Array.isArray(records)) throw new CostAttributionError('records must be an array.');
    const truncated = records.length > MAX_WORKFLOWS;
    const scoped = (truncated ? records.slice(-MAX_WORKFLOWS) : records).map(validateRecord);

    if (scoped.length === 0) {
      return {
        generatedAt, workflowCount: 0, totalSpendUsd: 0, totalWastedUsd: 0, wasteRatio: 0,
        averageWorkflowUsd: 0, overBudgetCount: 0, roles: [], workflows: [], costliestTasks: [],
        trend: { direction: 'insufficient-data', earlierAverageUsd: null, laterAverageUsd: null, changeRatio: null, explanation: 'No workflow cost records were supplied.' },
        recommendations: ['Record completed workflow costs to enable attribution.'],
        truncated,
      };
    }

    // Chronological order makes the trend window deterministic.
    const ordered = [...scoped].sort((left, right) => (left.completedAt - right.completedAt) || left.workflowId.localeCompare(right.workflowId));

    const roleTotals = new Map<AgentRole, { totalUsd: number; taskCount: number; wastedUsd: number }>();
    const workflows: WorkflowAttribution[] = [];
    const allTasks: CostAttributionReport['costliestTasks'][number][] = [];
    let totalSpendUsd = 0;
    let totalWastedUsd = 0;

    for (const record of ordered) {
      let workflowTotal = 0;
      let workflowWaste = 0;
      const perRole = new Map<AgentRole, number>();

      for (const entry of record.entries) {
        const wasted = entry.status !== 'completed' ? entry.costUsd : 0;
        workflowTotal += entry.costUsd;
        workflowWaste += wasted;
        perRole.set(entry.role, (perRole.get(entry.role) ?? 0) + entry.costUsd);

        const bucket = roleTotals.get(entry.role) ?? { totalUsd: 0, taskCount: 0, wastedUsd: 0 };
        bucket.totalUsd += entry.costUsd;
        bucket.taskCount += 1;
        bucket.wastedUsd += wasted;
        roleTotals.set(entry.role, bucket);

        allTasks.push({ workflowId: record.workflowId, taskId: entry.taskId, role: entry.role, costUsd: entry.costUsd });
      }

      totalSpendUsd += workflowTotal;
      totalWastedUsd += workflowWaste;

      const topRole = [...perRole.entries()]
        .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

      workflows.push({
        workflowId: record.workflowId,
        completedAt: record.completedAt,
        totalUsd: round(workflowTotal),
        budgetUsd: record.budgetUsd,
        budgetUsedRatio: round(workflowTotal / record.budgetUsd),
        overBudget: workflowTotal > record.budgetUsd,
        wastedUsd: round(workflowWaste),
        topRole,
      });
    }

    const roles: RoleAttribution[] = [...roleTotals.entries()]
      .map(([role, bucket]) => ({
        role,
        totalUsd: round(bucket.totalUsd),
        share: totalSpendUsd === 0 ? 0 : round(bucket.totalUsd / totalSpendUsd),
        taskCount: bucket.taskCount,
        averageUsd: round(bucket.totalUsd / bucket.taskCount),
        wastedUsd: round(bucket.wastedUsd),
        wasteRatio: bucket.totalUsd === 0 ? 0 : round(bucket.wastedUsd / bucket.totalUsd),
      }))
      // Most expensive role first, then a stable name tiebreak.
      .sort((left, right) => (right.totalUsd - left.totalUsd) || left.role.localeCompare(right.role));

    const costliestTasks = allTasks
      .sort((left, right) => (right.costUsd - left.costUsd)
        || left.workflowId.localeCompare(right.workflowId)
        || left.taskId.localeCompare(right.taskId))
      .slice(0, this.maxCostliestTasks)
      .map((task) => ({ ...task, costUsd: round(task.costUsd) }));

    const trend = this.computeTrend(workflows);
    const overBudgetCount = workflows.filter((workflow) => workflow.overBudget).length;
    const wasteRatio = totalSpendUsd === 0 ? 0 : round(totalWastedUsd / totalSpendUsd);

    return {
      generatedAt,
      workflowCount: workflows.length,
      totalSpendUsd: round(totalSpendUsd),
      totalWastedUsd: round(totalWastedUsd),
      wasteRatio,
      averageWorkflowUsd: round(totalSpendUsd / workflows.length),
      overBudgetCount,
      roles,
      workflows,
      costliestTasks,
      trend,
      recommendations: this.buildRecommendations(roles, wasteRatio, overBudgetCount, workflows.length, trend),
      truncated,
    };
  }

  /**
   * Splits the window in half and compares averages.
   *
   * With fewer than four workflows the halves are too small to mean anything,
   * so the trend reports `insufficient-data` rather than inventing a signal.
   */
  private computeTrend(workflows: readonly WorkflowAttribution[]): CostTrend {
    if (workflows.length < 4) {
      return {
        direction: 'insufficient-data',
        earlierAverageUsd: null,
        laterAverageUsd: null,
        changeRatio: null,
        explanation: `Only ${workflows.length} workflow(s) recorded; at least 4 are needed for a meaningful trend.`,
      };
    }

    const midpoint = Math.floor(workflows.length / 2);
    const earlier = workflows.slice(0, midpoint);
    const later = workflows.slice(midpoint);
    const average = (group: readonly WorkflowAttribution[]): number => group.reduce((total, item) => total + item.totalUsd, 0) / group.length;
    const earlierAverageUsd = round(average(earlier));
    const laterAverageUsd = round(average(later));

    if (earlierAverageUsd === 0) {
      return {
        direction: laterAverageUsd > 0 ? 'worsening' : 'stable',
        earlierAverageUsd,
        laterAverageUsd,
        changeRatio: null,
        explanation: 'Earlier workflows recorded no spend, so a ratio is undefined.',
      };
    }

    const changeRatio = round((laterAverageUsd - earlierAverageUsd) / earlierAverageUsd);
    const direction = Math.abs(changeRatio) < this.trendThreshold
      ? 'stable'
      : changeRatio < 0 ? 'improving' : 'worsening';

    return {
      direction,
      earlierAverageUsd,
      laterAverageUsd,
      changeRatio,
      explanation: `Average workflow spend moved from $${earlierAverageUsd.toFixed(4)} to $${laterAverageUsd.toFixed(4)} (${(changeRatio * 100).toFixed(1)}%).`,
    };
  }

  private buildRecommendations(
    roles: readonly RoleAttribution[],
    wasteRatio: number,
    overBudgetCount: number,
    workflowCount: number,
    trend: CostTrend,
  ): readonly string[] {
    const recommendations: string[] = [];

    if (wasteRatio >= this.wasteWarnRatio) {
      recommendations.push(`${Math.round(wasteRatio * 100)}% of spend went to failed or blocked tasks. Investigate the failure modes before approving more work.`);
    }
    if (overBudgetCount > 0) {
      recommendations.push(`${overBudgetCount} of ${workflowCount} workflow(s) exceeded budget. Re-scope plans or raise budgets explicitly.`);
    }
    const dominant = roles[0];
    if (dominant && dominant.share >= 0.6) {
      recommendations.push(`Role "${dominant.role}" accounts for ${Math.round(dominant.share * 100)}% of spend. Confirm that concentration is intended.`);
    }
    const wasteful = roles.find((role) => role.wasteRatio >= 0.5 && role.taskCount > 1);
    if (wasteful) {
      recommendations.push(`Role "${wasteful.role}" wastes ${Math.round(wasteful.wasteRatio * 100)}% of its spend on non-completed tasks.`);
    }
    if (trend.direction === 'worsening') {
      recommendations.push('Average workflow cost is rising. Review recent plan scope changes.');
    }
    if (recommendations.length === 0) {
      recommendations.push('Cost attribution shows no outliers. No action required.');
    }
    return recommendations.map((text) => text.slice(0, MAX_TEXT_CHARS));
  }
}

function validateRecord(record: WorkflowCostRecord): WorkflowCostRecord {
  if (!record || typeof record !== 'object') throw new CostAttributionError('A workflow cost record is required.');
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(record.workflowId ?? '')) throw new CostAttributionError('workflowId is invalid.');
  positiveTimestamp(record.completedAt, 'completedAt');
  if (!Number.isFinite(record.budgetUsd) || record.budgetUsd <= 0) throw new CostAttributionError(`Workflow "${record.workflowId}" requires a positive budget.`);
  if (!Array.isArray(record.entries)) throw new CostAttributionError(`Workflow "${record.workflowId}" requires an entries array.`);
  if (record.entries.length > MAX_ROLES * 20) throw new CostAttributionError(`Workflow "${record.workflowId}" has too many entries.`);

  for (const entry of record.entries) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(entry?.taskId ?? '')) throw new CostAttributionError('taskId is invalid.');
    if (!['planner', 'researcher', 'coder', 'executor', 'critic'].includes(entry.role)) {
      throw new CostAttributionError(`Role "${String(entry.role)}" is not a supported agent role.`);
    }
    if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) throw new CostAttributionError(`Task "${entry.taskId}" has an invalid cost.`);
    if (!['completed', 'failed', 'blocked'].includes(entry.status)) throw new CostAttributionError(`Task "${entry.taskId}" has an invalid status.`);
  }
  return record;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function ratio(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new CostAttributionError(`${name} must be in the range (0, 1].`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new CostAttributionError(`${name} must be a positive safe integer.`);
  return value;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new CostAttributionError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

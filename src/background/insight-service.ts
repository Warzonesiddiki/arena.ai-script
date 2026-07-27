import { PerformanceAnalyticsEngine } from '../analytics/performance-analytics';
import { AdvancedCostController } from '../governance/advanced-cost-controls';
import { FocusModeEngine, type FocusLevel, type FocusView } from '../focus/focus-mode';
import { HibernationManager, type HibernationCandidate } from '../hibernation/hibernation-manager';
import { OrchestrationHealthMonitor, type HealthSnapshot } from '../health/orchestration-health-monitor';
import { RecoverySnapshotManager, type RecoveryPlanProposal } from '../recovery/recovery-snapshot-manager';
import { TimelineScrubber } from '../timeline/timeline-scrubber';
import type { OrchestrationServiceSnapshot } from './orchestration-service';
import type { Tracer } from '../observability/tracer';

/**
 * Worker-owned read-only insight surface.
 *
 * Aggregates the deterministic analysis modules — health, focus, analytics,
 * cost, recovery, hibernation, replay — into one bounded projection the Side
 * Panel can render. Without this they are tested but unreachable code.
 *
 * Everything here is derived from state that already exists. It approves
 * nothing, executes nothing, and persists nothing except the recovery snapshot
 * a caller explicitly asks to capture.
 */

export interface InsightSnapshot {
  generatedAt: number;
  focus: FocusView;
  health: HealthSnapshot;
  recovery: RecoveryPlanProposal;
  hibernation: readonly HibernationCandidate[];
  cost: {
    status: 'ok' | 'warning' | 'stop';
    stopRecommended: boolean;
    usageRatio: number;
    remainingUsd: number;
    alertCount: number;
  } | null;
  replay: {
    correlationIds: readonly string[];
    totalEvents: number;
    errorCount: number;
  };
  /** Always false — insights never authorise anything. */
  autoActioned: false;
}

export interface InsightServiceOptions {
  tracer: Tracer;
  focus?: FocusModeEngine;
  health?: OrchestrationHealthMonitor;
  analytics?: PerformanceAnalyticsEngine;
  costController?: AdvancedCostController;
  recovery?: RecoverySnapshotManager;
  hibernation?: HibernationManager;
  workflowBudgetUsd?: number;
  now?: () => number;
}

export class InsightService {
  private readonly tracer: Tracer;
  private readonly focus: FocusModeEngine;
  private readonly health: OrchestrationHealthMonitor;
  private readonly analytics: PerformanceAnalyticsEngine;
  private readonly costController: AdvancedCostController;
  private readonly recovery: RecoverySnapshotManager;
  private readonly hibernation: HibernationManager;
  private readonly workflowBudgetUsd: number;
  private readonly now: () => number;

  public constructor(options: InsightServiceOptions) {
    this.tracer = options.tracer;
    this.focus = options.focus ?? new FocusModeEngine();
    this.health = options.health ?? new OrchestrationHealthMonitor();
    this.analytics = options.analytics ?? new PerformanceAnalyticsEngine();
    this.costController = options.costController ?? new AdvancedCostController();
    this.recovery = options.recovery ?? new RecoverySnapshotManager();
    this.hibernation = options.hibernation ?? new HibernationManager();
    this.workflowBudgetUsd = options.workflowBudgetUsd ?? 0.5;
    this.now = options.now ?? Date.now;
  }

  public async build(orchestration: OrchestrationServiceSnapshot): Promise<InsightSnapshot> {
    const now = this.now();
    const traceEvents = this.tracer.getEvents();
    const health = this.health.evaluate({ orchestration, traceEvents, now });

    const committedUsd = orchestration.estimatedCostUsd;
    const cost = orchestration.active
      ? summarizeCost(this.costController.evaluate({
        workflowId: orchestration.planId ?? 'workflow',
        budgetUsd: this.workflowBudgetUsd,
        spentUsd: 0,
        reservedUsd: committedUsd,
        now,
      }))
      : null;

    const focus = this.focus.build({
      orchestration,
      health,
      budgetUsageRatio: cost?.usageRatio ?? null,
      now,
    });

    const recovery = await this.recovery.proposeRecovery(orchestration, health);
    const replaySummary = new TimelineScrubber(traceEvents, traceEvents[0]?.correlationId ?? 'none').timelineSummary();

    return {
      generatedAt: now,
      focus,
      health,
      recovery,
      hibernation: [],
      cost,
      replay: {
        correlationIds: [...new Set(traceEvents.map((event) => event.correlationId))].slice(0, 20),
        totalEvents: traceEvents.length,
        errorCount: replaySummary.errorCount,
      },
      autoActioned: false,
    };
  }

  /** Captures a recovery snapshot. Capturing observes state; restoring needs approval. */
  public async captureRecoveryPoint(orchestration: OrchestrationServiceSnapshot, health: HealthSnapshot | null = null): Promise<string | null> {
    if (!orchestration.active) return null;
    const snapshot = await this.recovery.capture(orchestration, 'manual', health);
    return snapshot.id;
  }

  /** Evaluates hibernation candidacy for durable control states. */
  public hibernationCandidates(states: Parameters<HibernationManager['evaluate']>[0]): readonly HibernationCandidate[] {
    return this.hibernation.evaluate(states, this.now());
  }

  public analyticsReport(orchestration: OrchestrationServiceSnapshot): ReturnType<PerformanceAnalyticsEngine['build']> {
    return this.analytics.build({
      orchestration,
      traceEvents: this.tracer.getEvents(),
      generatedAt: this.now(),
    });
  }
}

function summarizeCost(decision: ReturnType<AdvancedCostController['evaluate']>): InsightSnapshot['cost'] {
  return {
    status: decision.status,
    stopRecommended: decision.stopRecommended,
    usageRatio: decision.usageRatio,
    remainingUsd: decision.remainingUsd,
    alertCount: decision.alerts.length,
  };
}

import type { CostAttributionReport } from '../analytics/cost-attribution';
import type { HealthSnapshot } from '../health/orchestration-health-monitor';
import type { CapabilityTier } from '../orchestration/capability-tier';

const MAX_PROPOSALS = 20;
const MAX_TEXT_CHARS = 300;

/**
 * Phase 16 self-modification — proposal only.
 *
 * The system observes its own operating data and **proposes** changes to its own
 * configuration. It is the sharpest test of the project's core principle, so the
 * boundary is drawn deliberately hard:
 *
 * - proposals are derived by deterministic rules from data the system already
 *   has; no model decides what to change;
 * - a proposal is inert data — applying one requires an explicit human approval
 *   *and* returns a new config object rather than mutating anything in place;
 * - a proposal can only move a setting **within** its declared safe bounds, and
 *   `apply` re-validates independently, so a forged proposal cannot widen a
 *   limit;
 * - settings that constitute the safety model itself are immutable and cannot
 *   be proposed at all.
 */

export type ConfigKey =
  | 'capabilityTier'
  | 'workflowBudgetUsd'
  | 'agentBudgetUsd'
  | 'stallTimeoutMs'
  | 'budgetWarnRatio'
  | 'maxTraceEvents'
  | 'notificationVerbosity';

export interface ExtensionConfig {
  capabilityTier: CapabilityTier;
  workflowBudgetUsd: number;
  agentBudgetUsd: number;
  stallTimeoutMs: number;
  budgetWarnRatio: number;
  maxTraceEvents: number;
  notificationVerbosity: 'quiet' | 'normal' | 'verbose';
}

export type ConfigValue = ExtensionConfig[ConfigKey];

export interface ConfigProposal {
  id: string;
  key: ConfigKey;
  currentValue: ConfigValue;
  proposedValue: ConfigValue;
  reason: string;
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  /** Higher means more strongly indicated. */
  confidence: 'low' | 'medium' | 'high';
  /** Always true — nothing self-applies. */
  requiresApproval: true;
  /** True when the change reduces capability or spend. */
  restrictive: boolean;
}

export interface ProposalInput {
  config: ExtensionConfig;
  health?: HealthSnapshot | null;
  attribution?: CostAttributionReport | null;
  now: number;
}

export class ConfigProposalError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigProposalError';
  }
}

/**
 * Settings the system may never propose changing about itself.
 *
 * These *are* the safety model. Allowing self-modification here would let the
 * system argue its way out of its own guardrails.
 */
export const IMMUTABLE_SETTINGS: readonly string[] = Object.freeze([
  'requireHumanApproval',
  'allowAutomaticExecution',
  'allowArbitraryDom',
  'allowNetworkEgress',
  'auditLogEnabled',
]);

/** Hard bounds. A proposal outside these is rejected by construction. */
const BOUNDS: Readonly<Record<ConfigKey, { min?: number; max?: number; allowed?: readonly ConfigValue[] }>> = Object.freeze({
  capabilityTier: { allowed: ['phase3', 'phase6'] },
  workflowBudgetUsd: { min: 0.01, max: 10 },
  agentBudgetUsd: { min: 0.01, max: 5 },
  stallTimeoutMs: { min: 30_000, max: 600_000 },
  budgetWarnRatio: { min: 0.5, max: 0.95 },
  maxTraceEvents: { min: 100, max: 5_000 },
  notificationVerbosity: { allowed: ['quiet', 'normal', 'verbose'] },
});

export class ConfigProposalEngine {
  /** Derives proposals deterministically. Produces data only. */
  public propose(input: ProposalInput): readonly ConfigProposal[] {
    const config = validateConfig(input.config);
    positiveTimestamp(input.now, 'now');
    const proposals: ConfigProposal[] = [];

    const add = (
      key: ConfigKey,
      proposedValue: ConfigValue,
      reason: string,
      evidence: ConfigProposal['evidence'],
      confidence: ConfigProposal['confidence'],
    ): void => {
      if (proposedValue === config[key]) return;
      if (!withinBounds(key, proposedValue)) return;
      proposals.push({
        id: `config:${key}:${input.now}:${proposals.length}`,
        key,
        currentValue: config[key],
        proposedValue,
        reason: reason.slice(0, MAX_TEXT_CHARS),
        evidence,
        confidence,
        requiresApproval: true,
        restrictive: isRestrictive(key, config[key], proposedValue),
      });
    };

    const health = input.health ?? null;
    const attribution = input.attribution ?? null;

    if (health) {
      const stalled = health.issues.filter((issue) => issue.kind === 'stalled-task');
      if (stalled.length >= 2) {
        add('stallTimeoutMs', Math.min(config.stallTimeoutMs * 2, 600_000),
          `${stalled.length} stalled-task detections suggest the stall threshold is too tight.`,
          { stalledCount: stalled.length, currentMs: config.stallTimeoutMs }, 'medium');
      }
      // Repeated capacity pressure is the only evidence that justifies *more*
      // capability, and even then it is a proposal a human must accept.
      const capacity = health.issues.filter((issue) => issue.kind === 'agent-capacity');
      if (capacity.length >= 2 && config.capabilityTier === 'phase3') {
        add('capabilityTier', 'phase6',
          'Repeated agent-capacity pressure at the Phase 3 cap. Raising the tier is possible but increases concurrency and cost.',
          { capacityIssues: capacity.length }, 'low');
      }
    }

    if (attribution) {
      if (attribution.overBudgetCount > 0 && attribution.workflowCount > 0) {
        const overRatio = attribution.overBudgetCount / attribution.workflowCount;
        if (overRatio >= 0.5) {
          const suggested = round(Math.min(attribution.averageWorkflowUsd * 1.5, 10));
          add('workflowBudgetUsd', suggested,
            `${attribution.overBudgetCount} of ${attribution.workflowCount} workflows exceeded budget; average spend is $${attribution.averageWorkflowUsd.toFixed(4)}.`,
            { overBudgetCount: attribution.overBudgetCount, averageUsd: attribution.averageWorkflowUsd }, 'high');
        }
      }
      if (attribution.wasteRatio >= 0.3) {
        add('budgetWarnRatio', 0.5,
          `${Math.round(attribution.wasteRatio * 100)}% of spend was wasted on failed or blocked tasks; warn earlier.`,
          { wasteRatio: attribution.wasteRatio }, 'medium');
      }
      const dominant = attribution.roles[0];
      if (dominant && dominant.share >= 0.7 && dominant.averageUsd > config.agentBudgetUsd) {
        add('agentBudgetUsd', round(Math.min(dominant.averageUsd * 1.2, 5)),
          `Role "${dominant.role}" averages $${dominant.averageUsd.toFixed(4)} per task, above the per-agent budget.`,
          { role: dominant.role, averageUsd: dominant.averageUsd }, 'medium');
        }
    }

    // Restrictive changes first: if a human only reads one, it should be the
    // one that reduces risk.
    proposals.sort((left, right) => Number(right.restrictive) - Number(left.restrictive)
      || rankConfidence(right.confidence) - rankConfidence(left.confidence)
      || left.key.localeCompare(right.key));

    return proposals.slice(0, MAX_PROPOSALS);
  }

  /**
   * Applies an approved proposal, returning a **new** config.
   *
   * The proposal is re-validated from scratch here. A forged or tampered
   * proposal cannot move a setting outside its bounds, name an immutable
   * setting, or introduce an unknown key.
   */
  public apply(config: ExtensionConfig, proposal: ConfigProposal, approvedByHuman: true): ExtensionConfig {
    if (approvedByHuman !== true) throw new ConfigProposalError('Applying a configuration change requires explicit human approval.');
    const current = validateConfig(config);

    if (!proposal || typeof proposal !== 'object') throw new ConfigProposalError('A proposal is required.');
    if (proposal.requiresApproval !== true) throw new ConfigProposalError('Proposals must remain approval-required.');
    if (IMMUTABLE_SETTINGS.includes(proposal.key as string)) {
      throw new ConfigProposalError(`Setting "${proposal.key}" is part of the safety model and cannot be self-modified.`);
    }
    if (!(proposal.key in BOUNDS)) throw new ConfigProposalError(`Unknown configuration key "${String(proposal.key)}".`);
    if (!withinBounds(proposal.key, proposal.proposedValue)) {
      throw new ConfigProposalError(`Proposed value for "${proposal.key}" is outside its safe bounds.`);
    }
    // Guard against applying a proposal computed against different state.
    if (proposal.currentValue !== current[proposal.key]) {
      throw new ConfigProposalError(`Configuration for "${proposal.key}" changed since this proposal was generated.`);
    }

    return validateConfig({ ...current, [proposal.key]: proposal.proposedValue });
  }

  /** Rejects a proposal. Recorded for the audit trail; changes nothing. */
  public reject(proposal: ConfigProposal, reason: string): { proposalId: string; rejected: true; reason: string } {
    if (!proposal?.id) throw new ConfigProposalError('A proposal is required.');
    return { proposalId: proposal.id, rejected: true, reason: (reason || 'No reason given.').slice(0, MAX_TEXT_CHARS) };
  }
}

function withinBounds(key: ConfigKey, value: ConfigValue): boolean {
  const bound = BOUNDS[key];
  if (bound.allowed) return bound.allowed.includes(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (bound.min !== undefined && value < bound.min) return false;
  if (bound.max !== undefined && value > bound.max) return false;
  return true;
}

function isRestrictive(key: ConfigKey, current: ConfigValue, proposed: ConfigValue): boolean {
  if (key === 'capabilityTier') return proposed === 'phase3' && current === 'phase6';
  if (key === 'budgetWarnRatio') return typeof proposed === 'number' && typeof current === 'number' && proposed < current;
  if (typeof proposed === 'number' && typeof current === 'number') return proposed < current;
  return false;
}

function validateConfig(config: ExtensionConfig): ExtensionConfig {
  if (!config || typeof config !== 'object') throw new ConfigProposalError('A configuration object is required.');
  for (const key of Object.keys(BOUNDS) as ConfigKey[]) {
    if (!withinBounds(key, config[key])) throw new ConfigProposalError(`Configuration value for "${key}" is invalid or out of bounds.`);
  }
  for (const immutable of IMMUTABLE_SETTINGS) {
    if (Object.prototype.hasOwnProperty.call(config, immutable)) {
      throw new ConfigProposalError(`Configuration must not carry the immutable safety setting "${immutable}".`);
    }
  }
  return {
    capabilityTier: config.capabilityTier,
    workflowBudgetUsd: config.workflowBudgetUsd,
    agentBudgetUsd: config.agentBudgetUsd,
    stallTimeoutMs: config.stallTimeoutMs,
    budgetWarnRatio: config.budgetWarnRatio,
    maxTraceEvents: config.maxTraceEvents,
    notificationVerbosity: config.notificationVerbosity,
  };
}

function rankConfidence(confidence: ConfigProposal['confidence']): number {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function positiveTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigProposalError(`${name} must be a positive safe-integer timestamp.`);
  return value;
}

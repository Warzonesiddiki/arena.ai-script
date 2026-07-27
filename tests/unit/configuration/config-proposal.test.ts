import {
  ConfigProposalEngine,
  ConfigProposalError,
  IMMUTABLE_SETTINGS,
  type ConfigProposal,
  type ExtensionConfig,
} from '../../../src/configuration/config-proposal';
import type { HealthSnapshot } from '../../../src/health/orchestration-health-monitor';
import type { CostAttributionReport } from '../../../src/analytics/cost-attribution';

function config(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    capabilityTier: 'phase3',
    workflowBudgetUsd: 0.5,
    agentBudgetUsd: 0.3,
    stallTimeoutMs: 120_000,
    budgetWarnRatio: 0.8,
    maxTraceEvents: 1_000,
    notificationVerbosity: 'normal',
    ...overrides,
  };
}

function issue(kind: string, id: string): HealthSnapshot['issues'][number] {
  return {
    id, kind: kind as never, severity: 'warning', summary: `${kind} detected`,
    taskId: null, observedAt: 1_000, evidence: {}, recommendedAction: 'Review.',
  };
}

function health(issues: HealthSnapshot['issues']): HealthSnapshot {
  return {
    generatedAt: 1_000, status: 'attention', issues,
    metrics: {
      activeAgents: 3, handoffs: 4, maxHandoffs: 12, handoffUsageRatio: 0.33,
      pendingApprovals: 1, runningTasks: 3, blockedTasks: 0, failedTasks: 0, budgetUsageRatio: 0.5,
    },
  };
}

function attribution(overrides: Partial<CostAttributionReport> = {}): CostAttributionReport {
  return {
    generatedAt: 1_000, workflowCount: 4, totalSpendUsd: 4, totalWastedUsd: 0, wasteRatio: 0,
    averageWorkflowUsd: 1, overBudgetCount: 0, roles: [], workflows: [], costliestTasks: [],
    trend: { direction: 'stable', earlierAverageUsd: 1, laterAverageUsd: 1, changeRatio: 0, explanation: '' },
    recommendations: [], truncated: false,
    ...overrides,
  };
}

const engine = new ConfigProposalEngine();

describe('ConfigProposalEngine', () => {
  it('produces inert proposals that always require approval', () => {
    const proposals = engine.propose({
      config: config(),
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual(expect.objectContaining({
      key: 'stallTimeoutMs', currentValue: 120_000, proposedValue: 240_000, requiresApproval: true,
    }));
  });

  it('proposes nothing without evidence', () => {
    expect(engine.propose({ config: config(), now: 5_000 })).toEqual([]);
    expect(engine.propose({ config: config(), health: health([]), attribution: attribution(), now: 5_000 })).toEqual([]);
  });

  it('raises the budget only when workflows repeatedly exceed it', () => {
    const proposals = engine.propose({
      config: config(),
      attribution: attribution({ overBudgetCount: 3, workflowCount: 4, averageWorkflowUsd: 1.2 }),
      now: 5_000,
    });

    const budget = proposals.find((proposal) => proposal.key === 'workflowBudgetUsd');
    expect(budget).toEqual(expect.objectContaining({ proposedValue: 1.8, confidence: 'high', restrictive: false }));

    // A single overrun out of four is not enough evidence.
    expect(engine.propose({
      config: config(),
      attribution: attribution({ overBudgetCount: 1, workflowCount: 4 }),
      now: 5_000,
    }).some((proposal) => proposal.key === 'workflowBudgetUsd')).toBe(false);
  });

  it('proposes tightening the warn ratio when spend is being wasted', () => {
    const proposals = engine.propose({
      config: config(),
      attribution: attribution({ wasteRatio: 0.4 }),
      now: 5_000,
    });

    const warn = proposals.find((proposal) => proposal.key === 'budgetWarnRatio');
    expect(warn).toEqual(expect.objectContaining({ proposedValue: 0.5, restrictive: true }));
  });

  it('treats raising capability as low confidence and needing repeated evidence', () => {
    const proposals = engine.propose({
      config: config(),
      health: health([issue('agent-capacity', 'a'), issue('agent-capacity', 'b')]),
      now: 5_000,
    });

    const tier = proposals.find((proposal) => proposal.key === 'capabilityTier');
    // Expanding capability is possible but never confidently recommended.
    expect(tier).toEqual(expect.objectContaining({ proposedValue: 'phase6', confidence: 'low', restrictive: false }));
    expect(tier?.reason).toContain('increases concurrency and cost');

    // One capacity issue is not enough.
    expect(engine.propose({ config: config(), health: health([issue('agent-capacity', 'a')]), now: 5_000 })).toEqual([]);
  });

  it('sorts restrictive proposals first', () => {
    const proposals = engine.propose({
      config: config(),
      health: health([issue('agent-capacity', 'a'), issue('agent-capacity', 'b')]),
      attribution: attribution({ wasteRatio: 0.5 }),
      now: 5_000,
    });

    // The risk-reducing change is what a human should read first.
    expect(proposals[0]?.restrictive).toBe(true);
    expect(proposals[0]?.key).toBe('budgetWarnRatio');
  });

  it('never proposes a value outside its safe bounds', () => {
    // A huge stall timeout is clamped to the 600s ceiling, not doubled past it.
    const proposals = engine.propose({
      config: config({ stallTimeoutMs: 400_000 }),
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });
    expect(proposals[0]?.proposedValue).toBe(600_000);

    // Already at the ceiling, so there is nothing to propose.
    expect(engine.propose({
      config: config({ stallTimeoutMs: 600_000 }),
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    })).toEqual([]);
  });

  it('applies an approved proposal to a new object without mutating the original', () => {
    const original = config();
    const [proposal] = engine.propose({
      config: original,
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });

    const updated = engine.apply(original, proposal!, true);
    expect(updated.stallTimeoutMs).toBe(240_000);
    // The original config object is untouched.
    expect(original.stallTimeoutMs).toBe(120_000);
    expect(updated).not.toBe(original);
  });

  it('refuses to apply without explicit human approval', () => {
    const original = config();
    const [proposal] = engine.propose({
      config: original,
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });

    expect(() => engine.apply(original, proposal!, false as never)).toThrow(ConfigProposalError);
    expect(() => engine.apply(original, proposal!, undefined as never)).toThrow(ConfigProposalError);
  });

  it('rejects a forged proposal that tries to widen a limit', () => {
    const forged: ConfigProposal = {
      id: 'forged', key: 'workflowBudgetUsd', currentValue: 0.5, proposedValue: 1_000,
      reason: 'trust me', evidence: {}, confidence: 'high', requiresApproval: true, restrictive: false,
    };

    // apply() re-validates from scratch, so a hand-built proposal gains nothing.
    expect(() => engine.apply(config(), forged, true)).toThrow(/outside its safe bounds/u);
  });

  it('refuses to self-modify any part of the safety model', () => {
    for (const immutable of IMMUTABLE_SETTINGS) {
      const forged = {
        id: 'forged', key: immutable, currentValue: true, proposedValue: false,
        reason: 'disable the guardrail', evidence: {}, confidence: 'high', requiresApproval: true, restrictive: false,
      } as unknown as ConfigProposal;

      expect(() => engine.apply(config(), forged, true)).toThrow(/safety model/u);
    }

    // A config that even carries such a setting is rejected outright.
    expect(() => engine.apply({ ...config(), allowAutomaticExecution: true } as never, {
      id: 'x', key: 'maxTraceEvents', currentValue: 1_000, proposedValue: 500,
      reason: 'r', evidence: {}, confidence: 'low', requiresApproval: true, restrictive: true,
    }, true)).toThrow(/immutable safety setting/u);
  });

  it('rejects a proposal that no longer matches current configuration', () => {
    const [proposal] = engine.propose({
      config: config(),
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });

    // Someone changed the setting between proposal and approval.
    expect(() => engine.apply(config({ stallTimeoutMs: 90_000 }), proposal!, true)).toThrow(/changed since this proposal/u);
  });

  it('rejects proposals that drop the approval requirement or name unknown keys', () => {
    const base: ConfigProposal = {
      id: 'p', key: 'maxTraceEvents', currentValue: 1_000, proposedValue: 500,
      reason: 'r', evidence: {}, confidence: 'low', requiresApproval: true, restrictive: true,
    };

    expect(() => engine.apply(config(), { ...base, requiresApproval: false as never }, true)).toThrow(/approval-required/u);
    expect(() => engine.apply(config(), { ...base, key: 'somethingElse' as never }, true)).toThrow(/Unknown configuration key/u);
    expect(() => engine.apply(config(), null as never, true)).toThrow(ConfigProposalError);
  });

  it('records a rejection without changing anything', () => {
    const [proposal] = engine.propose({
      config: config(),
      health: health([issue('stalled-task', 'a'), issue('stalled-task', 'b')]),
      now: 5_000,
    });

    expect(engine.reject(proposal!, 'Prefer to fix the underlying stall.')).toEqual({
      proposalId: proposal!.id, rejected: true, reason: 'Prefer to fix the underlying stall.',
    });
    expect(engine.reject(proposal!, '').reason).toBe('No reason given.');
    expect(() => engine.reject(null as never, 'x')).toThrow(ConfigProposalError);
  });

  it('validates the incoming configuration and timestamp', () => {
    expect(() => engine.propose({ config: null as never, now: 5_000 })).toThrow(ConfigProposalError);
    expect(() => engine.propose({ config: config(), now: 0 })).toThrow(ConfigProposalError);
    expect(() => engine.propose({ config: config({ workflowBudgetUsd: 0 }), now: 5_000 })).toThrow(ConfigProposalError);
    expect(() => engine.propose({ config: config({ capabilityTier: 'phase9' as never }), now: 5_000 })).toThrow(ConfigProposalError);
    expect(() => engine.propose({ config: config({ budgetWarnRatio: 2 }), now: 5_000 })).toThrow(ConfigProposalError);
    expect(() => engine.propose({ config: config({ notificationVerbosity: 'loud' as never }), now: 5_000 })).toThrow(ConfigProposalError);
  });
});

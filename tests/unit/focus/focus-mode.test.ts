import { FocusModeEngine, FocusModeError } from '../../../src/focus/focus-mode';
import type { OrchestrationServiceSnapshot } from '../../../src/background/orchestration-service';
import type { AgentDashboardCard } from '../../../src/orchestration/dashboard-state';
import type { HealthSnapshot } from '../../../src/health/orchestration-health-monitor';

function card(overrides: Partial<AgentDashboardCard> = {}): AgentDashboardCard {
  return {
    id: 'planner-1',
    role: 'planner',
    title: 'Create implementation plan',
    status: 'completed',
    dependsOn: [],
    estimatedCostUsd: 0.05,
    progress: 1,
    approvalRequired: false,
    canApprove: false,
    approvalBlockedReason: null,
    ...overrides,
  };
}

function orchestration(overrides: Partial<OrchestrationServiceSnapshot> = {}): OrchestrationServiceSnapshot {
  return {
    active: true,
    planId: 'plan-1',
    goal: 'Ship focus mode',
    estimatedCostUsd: 0.4,
    safety: { activeAgents: 1, handoffs: 2 },
    cards: [card()],
    ...overrides,
  };
}

function health(status: HealthSnapshot['status'], issues: HealthSnapshot['issues'] = []): HealthSnapshot {
  return {
    generatedAt: 5_000,
    status,
    issues,
    metrics: {
      activeAgents: 1, handoffs: 2, maxHandoffs: 12, handoffUsageRatio: 0.16,
      pendingApprovals: 0, runningTasks: 1, blockedTasks: 0, failedTasks: 0, budgetUsageRatio: 0.4,
    },
  };
}

describe('FocusModeEngine', () => {
  it('surfaces the single most important item at minimal level', () => {
    const engine = new FocusModeEngine({ level: 'minimal' });
    const view = engine.build({
      orchestration: orchestration({
        cards: [
          card({ id: 'coder-1', role: 'coder', status: 'failed' }),
          card({ id: 'critic-1', role: 'critic', status: 'pending', approvalRequired: true, canApprove: true }),
        ],
      }),
      now: 9_000,
    });

    expect(view.items).toHaveLength(1);
    // A failure outranks a pending approval.
    expect(view.items[0]).toEqual(expect.objectContaining({ kind: 'failed-task', taskId: 'coder-1' }));
    expect(view.headline).toContain('failed');
    expect(view.hiddenCount).toBe(1);
    expect(view.quiet).toBe(false);
  });

  it('orders items by kind priority deterministically', () => {
    const engine = new FocusModeEngine({ level: 'detailed' });
    const view = engine.build({
      orchestration: orchestration({
        cards: [
          card({ id: 'a-1', role: 'critic', status: 'pending', approvalRequired: true, canApprove: true }),
          card({ id: 'b-1', role: 'coder', status: 'running' }),
          card({ id: 'c-1', role: 'planner', status: 'blocked', approvalBlockedReason: 'dependency failed' }),
          card({ id: 'd-1', role: 'coder', status: 'failed' }),
        ],
      }),
      health: health('critical', [{
        id: 'issue-1', kind: 'failed-task', severity: 'critical', summary: 'A task failed', taskId: 'd-1',
        observedAt: 5_000, evidence: {}, recommendedAction: 'Investigate the trace.',
      }]),
      budgetUsageRatio: 0.95,
      now: 9_000,
    });

    expect(view.items.map((entry) => entry.kind)).toEqual([
      'failed-task', 'health-issue', 'blocked-task', 'budget-risk', 'awaiting-approval', 'running-task',
    ]);
  });

  it('limits visible items per level and reports the hidden count', () => {
    const engine = new FocusModeEngine();
    const input = {
      orchestration: orchestration({
        cards: ['a', 'b', 'c', 'd'].map((id) => card({ id: `${id}-1`, role: 'coder', status: 'failed' as const })),
      }),
      now: 9_000,
    };

    expect(engine.build(input).items).toHaveLength(3); // balanced
    expect(engine.build(input).hiddenCount).toBe(1);
    engine.setLevel('minimal');
    expect(engine.build(input).items).toHaveLength(1);
    engine.setLevel('detailed');
    expect(engine.build(input).items).toHaveLength(4);
    expect(engine.build(input).hiddenCount).toBe(0);
  });

  it('cycles focus levels', () => {
    const engine = new FocusModeEngine({ level: 'minimal' });
    expect(engine.cycleLevel()).toBe('balanced');
    expect(engine.cycleLevel()).toBe('detailed');
    expect(engine.cycleLevel()).toBe('minimal');
    expect(() => engine.setLevel('zen' as never)).toThrow(FocusModeError);
  });

  it('marks only approvable work actionable and never approves it', () => {
    const engine = new FocusModeEngine({ level: 'detailed' });
    const view = engine.build({
      orchestration: orchestration({
        cards: [
          card({ id: 'ready-1', role: 'coder', status: 'pending', approvalRequired: true, canApprove: true }),
          card({ id: 'waiting-1', role: 'critic', status: 'pending', approvalRequired: true, canApprove: false }),
        ],
      }),
      now: 9_000,
    });

    const actionable = view.items.filter((entry) => entry.actionable);
    expect(actionable.map((entry) => entry.taskId)).toEqual(['ready-1']);
    expect(actionable[0]?.suggestedAction).toContain('approve explicitly');
    // A task that cannot yet be approved is not surfaced as actionable work.
    expect(view.items.some((entry) => entry.taskId === 'waiting-1')).toBe(false);
  });

  it('reports a quiet view when nothing needs attention', () => {
    const engine = new FocusModeEngine();
    const view = engine.build({ orchestration: orchestration(), health: health('healthy'), budgetUsageRatio: 0.1, now: 9_000 });

    expect(view.quiet).toBe(true);
    expect(view.items[0]?.kind).toBe('idle');
    expect(view.headline).toBe('Nothing needs attention');
    expect(view.counts.completed).toBe(1);
  });

  it('handles an inactive workflow', () => {
    const engine = new FocusModeEngine();
    const view = engine.build({
      orchestration: { active: false, planId: null, goal: null, cards: [], estimatedCostUsd: 0, safety: { activeAgents: 0, handoffs: 0 } },
      now: 9_000,
    });

    expect(view.items[0]).toEqual(expect.objectContaining({ kind: 'idle', title: 'No active workflow' }));
    expect(view.items[0]?.detail).toContain('without explicit approval');
    expect(view.counts).toEqual({ failed: 0, blocked: 0, awaitingApproval: 0, running: 0, completed: 0 });
  });

  it('raises budget risk only at or above the warn ratio', () => {
    const engine = new FocusModeEngine({ level: 'detailed', budgetWarnRatio: 0.9 });

    expect(engine.build({ orchestration: orchestration(), budgetUsageRatio: 0.89, now: 1 }).items.some((entry) => entry.kind === 'budget-risk')).toBe(false);
    const risky = engine.build({ orchestration: orchestration(), budgetUsageRatio: 0.9, now: 1 });
    expect(risky.items.some((entry) => entry.kind === 'budget-risk')).toBe(true);
    const exhausted = engine.build({ orchestration: orchestration(), budgetUsageRatio: 1.2, now: 1 });
    expect(exhausted.items.find((entry) => entry.kind === 'budget-risk')?.title).toBe('Budget is exhausted');
  });

  it('surfaces the most severe health issue only', () => {
    const engine = new FocusModeEngine({ level: 'detailed' });
    const view = engine.build({
      orchestration: orchestration(),
      health: health('attention', [
        { id: 'i1', kind: 'approval-wait', severity: 'info', summary: 'Minor', taskId: null, observedAt: 1, evidence: {}, recommendedAction: 'Nothing.' },
        { id: 'i2', kind: 'stalled-task', severity: 'critical', summary: 'Stalled task', taskId: 'coder-1', observedAt: 1, evidence: {}, recommendedAction: 'Inspect it.' },
      ]),
      now: 9_000,
    });

    const healthItems = view.items.filter((entry) => entry.kind === 'health-issue');
    expect(healthItems).toHaveLength(1);
    expect(healthItems[0]?.detail).toBe('Stalled task');
  });

  it('validates inputs and truncates long text', () => {
    const engine = new FocusModeEngine();

    expect(() => engine.build({ orchestration: orchestration(), now: 0 })).toThrow(FocusModeError);
    expect(() => engine.build({ orchestration: null as never, now: 1 })).toThrow(FocusModeError);
    expect(() => engine.build({ orchestration: orchestration(), budgetUsageRatio: -1, now: 1 })).toThrow(FocusModeError);
    expect(() => new FocusModeEngine({ budgetWarnRatio: 0 })).toThrow(FocusModeError);

    const view = engine.build({
      orchestration: orchestration({ cards: [card({ id: 'x-1', status: 'failed', title: 'T'.repeat(400) })] }),
      now: 1,
    });
    expect(view.items[0]!.detail.length).toBe(160);
  });
});

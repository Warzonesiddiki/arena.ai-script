import { AdvancedCostControlError, AdvancedCostController, type CostControlInput } from '../../../src/governance/advanced-cost-controls';

function input(overrides: Partial<CostControlInput> = {}): CostControlInput {
  return {
    workflowId: 'wf-1',
    budgetUsd: 1,
    spentUsd: 0.1,
    reservedUsd: 0.1,
    now: 10_000,
    ...overrides,
  };
}

describe('AdvancedCostController', () => {
  it('reports a healthy workflow with no alerts', () => {
    const controller = new AdvancedCostController();
    const decision = controller.evaluate(input());

    expect(decision).toEqual(expect.objectContaining({
      status: 'ok', stopRecommended: false, autoStopped: false, committedUsd: 0.2, remainingUsd: 0.8, usageRatio: 0.2,
    }));
    expect(decision.alerts).toEqual([]);
  });

  it('warns at the warn ratio and recommends stopping at the budget', () => {
    const controller = new AdvancedCostController();

    const warning = controller.evaluate(input({ spentUsd: 0.8, reservedUsd: 0.05 }));
    expect(warning.status).toBe('warning');
    expect(warning.stopRecommended).toBe(false);
    expect(warning.alerts.map((alert) => alert.kind)).toContain('budget-warning');

    const stopped = controller.evaluate(input({ spentUsd: 0.9, reservedUsd: 0.1 }));
    expect(stopped.status).toBe('stop');
    expect(stopped.stopRecommended).toBe(true);
    // "Auto-stop" is a recommendation; nothing is actually terminated.
    expect(stopped.autoStopped).toBe(false);
    expect(stopped.alerts.map((alert) => alert.kind)).toContain('budget-exhausted');
    expect(stopped.alerts[0]?.recommendedAction).toContain('Stop authorising');
  });

  it('flags a projection overrun before the budget is actually spent', () => {
    const controller = new AdvancedCostController();
    const decision = controller.evaluate(input({ spentUsd: 0.2, reservedUsd: 0.1, plannedUsd: 0.9 }));

    expect(decision.projectedTotalUsd).toBe(1.2);
    expect(decision.projectedRatio).toBe(1.2);
    expect(decision.stopRecommended).toBe(false);
    expect(decision.alerts.map((alert) => alert.kind)).toContain('projection-overrun');
  });

  it('computes burn rate and time to exhaustion', () => {
    const controller = new AdvancedCostController();
    // 0.5 USD in 30 minutes = 1 USD/hour.
    const decision = controller.evaluate(input({ spentUsd: 0.5, reservedUsd: 0, elapsedMs: 1_800_000 }));

    expect(decision.burnRateUsdPerHour).toBe(1);
    expect(decision.secondsToExhaustion).toBe(1_800);
    expect(decision.alerts.map((alert) => alert.kind)).not.toContain('burn-rate');

    const urgent = controller.evaluate(input({ budgetUsd: 1, spentUsd: 0.99, reservedUsd: 0, elapsedMs: 3_600_000 }));
    expect(urgent.alerts.map((alert) => alert.kind)).toContain('burn-rate');
  });

  it('omits burn rate when elapsed time or spend is unknown', () => {
    const controller = new AdvancedCostController();
    expect(controller.evaluate(input()).burnRateUsdPerHour).toBeNull();
    expect(controller.evaluate(input({ elapsedMs: 0 })).burnRateUsdPerHour).toBeNull();
    expect(controller.evaluate(input({ spentUsd: 0, elapsedMs: 1_000 })).burnRateUsdPerHour).toBeNull();
  });

  it('surfaces role spend concentration as informational only', () => {
    const controller = new AdvancedCostController();
    const decision = controller.evaluate(input({
      spentUsd: 0.5,
      roleSpend: [
        { role: 'coder', spentUsd: 0.45, taskCount: 3 },
        { role: 'critic', spentUsd: 0.05, taskCount: 1 },
      ],
    }));

    const alert = decision.alerts.find((entry) => entry.kind === 'role-concentration');
    expect(alert).toEqual(expect.objectContaining({ level: 'info' }));
    expect(alert?.summary).toContain('coder');
    // Informational alerts must not escalate overall status.
    expect(decision.status).toBe('ok');
  });

  it('advises against authorising work that would exceed the budget', () => {
    const controller = new AdvancedCostController();
    const healthy = controller.evaluate(input({ spentUsd: 0.2, reservedUsd: 0.1 }));

    expect(controller.canAuthorize(healthy, 0.2)).toEqual({ allowed: true, reason: expect.stringContaining('hard reservation gate') });
    expect(controller.canAuthorize(healthy, 0.9)).toEqual({ allowed: false, reason: expect.stringContaining('exceed the remaining') });

    const stopped = controller.evaluate(input({ spentUsd: 1, reservedUsd: 0 }));
    expect(controller.canAuthorize(stopped, 0.001)).toEqual({ allowed: false, reason: expect.stringContaining('stopped') });
  });

  it('validates inputs and controller configuration', () => {
    const controller = new AdvancedCostController();

    expect(() => controller.evaluate(input({ workflowId: '../bad' }))).toThrow(AdvancedCostControlError);
    expect(() => controller.evaluate(input({ budgetUsd: 0 }))).toThrow(AdvancedCostControlError);
    expect(() => controller.evaluate(input({ spentUsd: -1 }))).toThrow(AdvancedCostControlError);
    expect(() => controller.evaluate(input({ now: -1 }))).toThrow(AdvancedCostControlError);
    expect(() => controller.evaluate(input({ elapsedMs: -5 }))).toThrow(AdvancedCostControlError);
    expect(() => new AdvancedCostController({ warnRatio: 0 })).toThrow(AdvancedCostControlError);
    expect(() => new AdvancedCostController({ warnRatio: 1, stopRatio: 0.5 })).toThrow(AdvancedCostControlError);
  });
});

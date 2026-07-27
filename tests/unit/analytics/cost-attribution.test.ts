import { CostAttributionEngine, CostAttributionError, type WorkflowCostRecord } from '../../../src/analytics/cost-attribution';

function record(overrides: Partial<WorkflowCostRecord> = {}): WorkflowCostRecord {
  return {
    workflowId: 'wf-1',
    completedAt: 1_000,
    budgetUsd: 1,
    entries: [
      { taskId: 'planner-1', role: 'planner', costUsd: 0.05, status: 'completed' },
      { taskId: 'coder-1', role: 'coder', costUsd: 0.25, status: 'completed' },
    ],
    ...overrides,
  };
}

const engine = new CostAttributionEngine();

describe('CostAttributionEngine', () => {
  it('attributes spend to roles with shares that sum to one', () => {
    const report = engine.build([record()], 5_000);

    expect(report.totalSpendUsd).toBe(0.3);
    expect(report.workflowCount).toBe(1);
    expect(report.roles.map((role) => role.role)).toEqual(['coder', 'planner']);
    expect(report.roles[0]).toEqual(expect.objectContaining({ totalUsd: 0.25, taskCount: 1, averageUsd: 0.25 }));
    expect(report.roles.reduce((total, role) => total + role.share, 0)).toBeCloseTo(1, 6);
  });

  it('counts spend on failed and blocked tasks as waste', () => {
    const report = engine.build([record({
      entries: [
        { taskId: 'planner-1', role: 'planner', costUsd: 0.1, status: 'completed' },
        { taskId: 'coder-1', role: 'coder', costUsd: 0.3, status: 'failed' },
        { taskId: 'critic-1', role: 'critic', costUsd: 0.1, status: 'blocked' },
      ],
    })], 5_000);

    // Money spent with nothing to show for it.
    expect(report.totalWastedUsd).toBe(0.4);
    expect(report.wasteRatio).toBeCloseTo(0.8, 6);
    expect(report.roles.find((role) => role.role === 'coder')?.wasteRatio).toBe(1);
    expect(report.roles.find((role) => role.role === 'planner')?.wasteRatio).toBe(0);
    expect(report.recommendations.some((text) => text.includes('failed or blocked'))).toBe(true);
  });

  it('flags over-budget workflows and identifies the dominant role', () => {
    const report = engine.build([record({
      budgetUsd: 0.2,
      entries: [{ taskId: 'coder-1', role: 'coder', costUsd: 0.5, status: 'completed' }],
    })], 5_000);

    expect(report.overBudgetCount).toBe(1);
    expect(report.workflows[0]).toEqual(expect.objectContaining({ overBudget: true, topRole: 'coder', budgetUsedRatio: 2.5 }));
    expect(report.recommendations.some((text) => text.includes('exceeded budget'))).toBe(true);
    expect(report.recommendations.some((text) => text.includes('accounts for 100%'))).toBe(true);
  });

  it('ranks the costliest tasks across every workflow', () => {
    const report = engine.build([
      record({ workflowId: 'wf-1', entries: [{ taskId: 'a-1', role: 'coder', costUsd: 0.1, status: 'completed' }] }),
      record({ workflowId: 'wf-2', completedAt: 2_000, entries: [{ taskId: 'b-1', role: 'coder', costUsd: 0.9, status: 'completed' }] }),
    ], 5_000);

    expect(report.costliestTasks[0]).toEqual(expect.objectContaining({ workflowId: 'wf-2', taskId: 'b-1', costUsd: 0.9 }));
    expect(report.costliestTasks).toHaveLength(2);
  });

  it('refuses to infer a trend from too few workflows', () => {
    const report = engine.build([record(), record({ workflowId: 'wf-2', completedAt: 2_000 })], 5_000);

    // Two workflows cannot support a half-versus-half comparison.
    expect(report.trend.direction).toBe('insufficient-data');
    expect(report.trend.changeRatio).toBeNull();
    expect(report.trend.explanation).toContain('at least 4');
  });

  it('detects improving and worsening cost trends', () => {
    const expensive = (id: string, at: number, cost: number): WorkflowCostRecord => record({
      workflowId: id, completedAt: at, budgetUsd: 5,
      entries: [{ taskId: 'coder-1', role: 'coder', costUsd: cost, status: 'completed' }],
    });

    const improving = engine.build([
      expensive('wf-1', 1_000, 1), expensive('wf-2', 2_000, 1),
      expensive('wf-3', 3_000, 0.2), expensive('wf-4', 4_000, 0.2),
    ], 5_000);
    expect(improving.trend.direction).toBe('improving');
    expect(improving.trend.changeRatio).toBeCloseTo(-0.8, 6);

    const worsening = engine.build([
      expensive('wf-1', 1_000, 0.2), expensive('wf-2', 2_000, 0.2),
      expensive('wf-3', 3_000, 1), expensive('wf-4', 4_000, 1),
    ], 5_000);
    expect(worsening.trend.direction).toBe('worsening');
    expect(worsening.recommendations.some((text) => text.includes('rising'))).toBe(true);

    const stable = engine.build([
      expensive('wf-1', 1_000, 0.5), expensive('wf-2', 2_000, 0.5),
      expensive('wf-3', 3_000, 0.52), expensive('wf-4', 4_000, 0.5),
    ], 5_000);
    expect(stable.trend.direction).toBe('stable');
  });

  it('orders workflows chronologically regardless of input order', () => {
    const build = (records: WorkflowCostRecord[]): readonly string[] =>
      engine.build(records, 5_000).workflows.map((workflow) => workflow.workflowId);

    const chronological = [
      record({ workflowId: 'wf-1', completedAt: 1_000 }),
      record({ workflowId: 'wf-2', completedAt: 2_000 }),
      record({ workflowId: 'wf-3', completedAt: 3_000 }),
    ];
    expect(build(chronological)).toEqual(['wf-1', 'wf-2', 'wf-3']);
    expect(build([...chronological].reverse())).toEqual(['wf-1', 'wf-2', 'wf-3']);
  });

  it('handles an empty record set without inventing data', () => {
    const report = engine.build([], 5_000);

    expect(report).toEqual(expect.objectContaining({
      workflowCount: 0, totalSpendUsd: 0, wasteRatio: 0, overBudgetCount: 0, roles: [], workflows: [],
    }));
    expect(report.trend.direction).toBe('insufficient-data');
    expect(report.recommendations[0]).toContain('Record completed workflow costs');
  });

  it('reports no action when nothing is an outlier', () => {
    const balanced = engine.build([record({
      budgetUsd: 10,
      entries: [
        { taskId: 'planner-1', role: 'planner', costUsd: 0.1, status: 'completed' },
        { taskId: 'coder-1', role: 'coder', costUsd: 0.1, status: 'completed' },
        { taskId: 'critic-1', role: 'critic', costUsd: 0.1, status: 'completed' },
      ],
    })], 5_000);

    expect(balanced.recommendations).toEqual(['Cost attribution shows no outliers. No action required.']);
  });

  it('bounds the number of retained workflows', () => {
    const many = Array.from({ length: 105 }, (_unused, index) => record({ workflowId: `wf-${index}`, completedAt: 1_000 + index }));
    const report = engine.build(many, 5_000);

    expect(report.truncated).toBe(true);
    expect(report.workflowCount).toBe(100);
    // The most recent workflows are the ones kept.
    expect(report.workflows[report.workflows.length - 1]?.workflowId).toBe('wf-104');
  });

  it('handles a zero-spend earlier window without dividing by zero', () => {
    const free = (id: string, at: number, cost: number): WorkflowCostRecord => record({
      workflowId: id, completedAt: at, budgetUsd: 1,
      entries: [{ taskId: 'coder-1', role: 'coder', costUsd: cost, status: 'completed' }],
    });
    const report = engine.build([free('a', 1_000, 0), free('b', 2_000, 0), free('c', 3_000, 0.5), free('d', 4_000, 0.5)], 5_000);

    expect(report.trend.direction).toBe('worsening');
    expect(report.trend.changeRatio).toBeNull();
    expect(report.trend.explanation).toContain('ratio is undefined');
  });

  it('rejects malformed records and options', () => {
    expect(() => engine.build('nope' as never, 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record()], 0)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ workflowId: '../bad' })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ completedAt: -1 })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ budgetUsd: 0 })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ entries: 'nope' as never })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ entries: [{ taskId: '../x', role: 'coder', costUsd: 1, status: 'completed' }] })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ entries: [{ taskId: 'a', role: 'overlord' as never, costUsd: 1, status: 'completed' }] })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ entries: [{ taskId: 'a', role: 'coder', costUsd: -1, status: 'completed' }] })], 5_000)).toThrow(CostAttributionError);
    expect(() => engine.build([record({ entries: [{ taskId: 'a', role: 'coder', costUsd: 1, status: 'pending' as never }] })], 5_000)).toThrow(CostAttributionError);

    expect(() => new CostAttributionEngine({ trendThreshold: 0 })).toThrow(CostAttributionError);
    expect(() => new CostAttributionEngine({ maxCostliestTasks: 0 })).toThrow(CostAttributionError);
    expect(() => new CostAttributionEngine({ wasteWarnRatio: 2 })).toThrow(CostAttributionError);
  });
});

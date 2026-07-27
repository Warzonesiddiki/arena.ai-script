import { ResultComparator, ResultComparisonError, type CandidateResult } from '../../../src/comparison/result-comparison';

function candidate(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    id: 'cand-a',
    label: 'Candidate A',
    role: 'coder',
    taskId: 'coder-1',
    scores: { correctness: 0.9, safety: 0.9, cost: 0.2, latency: 1_000, testCoverage: 0.8 },
    ...overrides,
  };
}

describe('ResultComparator', () => {
  it('ranks candidates deterministically and never auto-selects', () => {
    const comparator = new ResultComparator({ now: () => 5_000 });

    const report = comparator.compare('coder-1', [
      candidate({ id: 'cand-b', label: 'B', scores: { correctness: 0.6, safety: 0.6, cost: 0.5, latency: 2_000, testCoverage: 0.5 } }),
      candidate({ id: 'cand-a', label: 'A' }),
    ]);

    expect(report.autoSelected).toBe(false);
    expect(report.candidates.map((entry) => entry.id)).toEqual(['cand-a', 'cand-b']);
    expect(report.candidates.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(report.recommendedId).toBe('cand-a');
    expect(report.rationale).toContain('human must confirm');
    expect(report.generatedAt).toBe(5_000);
  });

  it('produces identical output regardless of input order', () => {
    const comparator = new ResultComparator({ now: () => 1 });
    const a = candidate({ id: 'cand-a' });
    const b = candidate({ id: 'cand-b', scores: { correctness: 0.7, safety: 0.8, cost: 0.1, latency: 500, testCoverage: 0.9 } });
    const c = candidate({ id: 'cand-c', scores: { correctness: 0.5, safety: 0.5, cost: 0.9, latency: 4_000, testCoverage: 0.2 } });

    const forward = comparator.compare('coder-1', [a, b, c]);
    const reverse = comparator.compare('coder-1', [c, b, a]);

    expect(reverse.candidates.map((entry) => entry.id)).toEqual(forward.candidates.map((entry) => entry.id));
    expect(reverse.candidates.map((entry) => entry.totalScore)).toEqual(forward.candidates.map((entry) => entry.totalScore));
  });

  it('inverts lower-is-better criteria so cheaper and faster score higher', () => {
    const comparator = new ResultComparator({ now: () => 1 });
    const report = comparator.compare('coder-1', [
      candidate({ id: 'cheap', scores: { correctness: 0.5, safety: 0.5, cost: 0.1, latency: 100, testCoverage: 0.5 } }),
      candidate({ id: 'pricey', scores: { correctness: 0.5, safety: 0.5, cost: 0.9, latency: 9_000, testCoverage: 0.5 } }),
    ]);

    expect(report.recommendedId).toBe('cheap');
    const cheapCost = report.candidates.find((entry) => entry.id === 'cheap')!.criteria.find((entry) => entry.criterion === 'cost')!;
    const priceyCost = report.candidates.find((entry) => entry.id === 'pricey')!.criteria.find((entry) => entry.criterion === 'cost')!;
    expect(cheapCost.normalized).toBe(1);
    expect(priceyCost.normalized).toBe(0);
  });

  it('scores missing criteria as zero rather than guessing them', () => {
    const comparator = new ResultComparator({ now: () => 1 });
    const report = comparator.compare('coder-1', [candidate({ id: 'partial', scores: { correctness: 1 } })]);

    const scored = report.candidates[0]!;
    expect(scored.missingCriteria).toEqual(['safety', 'cost', 'latency', 'testCoverage']);
    // Only the 0.35 correctness weight contributes.
    expect(scored.totalScore).toBeCloseTo(0.35, 6);
  });

  it('flags near-ties for human resolution', () => {
    const comparator = new ResultComparator({ now: () => 1, tieThreshold: 0.05 });
    const report = comparator.compare('coder-1', [
      candidate({ id: 'cand-a', scores: { correctness: 0.8, safety: 0.8, cost: 0.5, latency: 1_000, testCoverage: 0.8 } }),
      candidate({ id: 'cand-b', scores: { correctness: 0.79, safety: 0.8, cost: 0.5, latency: 1_000, testCoverage: 0.8 } }),
    ]);

    expect(report.tie).toBe(true);
    expect(report.rationale).toContain('human review is required');
  });

  it('records only explicitly approved human selections', () => {
    const comparator = new ResultComparator({ now: () => 7_000 });
    const report = comparator.compare('coder-1', [candidate({ id: 'cand-a' }), candidate({ id: 'cand-b' })]);

    expect(() => comparator.select(report, 'cand-a', false as never)).toThrow(ResultComparisonError);
    expect(() => comparator.select(report, 'cand-z', true)).toThrow(ResultComparisonError);

    const followed = comparator.select(report, report.recommendedId!, true, 'Matches the review notes.');
    expect(followed).toEqual(expect.objectContaining({ approvedByHuman: true, followedRecommendation: true, selectedAt: 7_000, note: 'Matches the review notes.' }));

    const overridden = comparator.select(report, 'cand-b', true);
    expect(overridden).toEqual(expect.objectContaining({ selectedId: 'cand-b', followedRecommendation: false, note: null }));
  });

  it('supports renormalised custom weights', () => {
    const safetyOnly = new ResultComparator({ now: () => 1, weights: { correctness: 0, safety: 1, cost: 0, latency: 0, testCoverage: 0 } });
    const report = safetyOnly.compare('coder-1', [
      candidate({ id: 'safe', scores: { correctness: 0.1, safety: 1 } }),
      candidate({ id: 'correct', scores: { correctness: 1, safety: 0.1 } }),
    ]);

    expect(report.recommendedId).toBe('safe');
    expect(report.candidates[0]?.totalScore).toBe(1);
  });

  it('rejects malformed comparisons', () => {
    const comparator = new ResultComparator({ now: () => 1 });

    expect(() => comparator.compare('coder-1', [])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('../bad', [candidate()])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate(), candidate()])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate({ taskId: 'other-1' })])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate({ scores: { correctness: 5 } })])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate({ scores: { cost: -1 } })])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate({ scores: { bogus: 1 } as never })])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', [candidate({ label: '  ' })])).toThrow(ResultComparisonError);
    expect(() => comparator.compare('coder-1', ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate({ id })))).toThrow(ResultComparisonError);
    expect(() => new ResultComparator({ weights: { safety: -1 } })).toThrow(ResultComparisonError);
    expect(() => new ResultComparator({ tieThreshold: 2 })).toThrow(ResultComparisonError);
  });
});

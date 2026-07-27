import type { AgentRole } from '../orchestration/types';

const MAX_CANDIDATES = 5;
const MAX_LABEL_CHARS = 120;
const MAX_SUMMARY_CHARS = 1_000;
const MAX_NOTE_CHARS = 300;

/**
 * Phase 6C deterministic result comparison.
 *
 * Scoring is a fixed weighted rubric over **human- or tool-supplied** signals.
 * No model judges the candidates, nothing is auto-selected, and the "winner" is
 * only ever a recommendation that a human must explicitly confirm.
 */

export type ComparisonCriterion = 'correctness' | 'safety' | 'cost' | 'latency' | 'testCoverage';

export const CRITERIA: readonly ComparisonCriterion[] = ['correctness', 'safety', 'cost', 'latency', 'testCoverage'];

/** Weights sum to 1. Safety and correctness dominate deliberately. */
const DEFAULT_WEIGHTS: Readonly<Record<ComparisonCriterion, number>> = Object.freeze({
  correctness: 0.35,
  safety: 0.30,
  cost: 0.15,
  latency: 0.05,
  testCoverage: 0.15,
});

/** Criteria where a lower raw value is better. */
const LOWER_IS_BETTER: ReadonlySet<ComparisonCriterion> = new Set(['cost', 'latency']);

export interface CandidateResult {
  id: string;
  label: string;
  role: AgentRole;
  taskId: string;
  /** Normalised 0..1 quality signals. `cost`/`latency` are raw positive magnitudes. */
  scores: Partial<Record<ComparisonCriterion, number>>;
  summary?: string;
}

export interface ScoredCriterion {
  criterion: ComparisonCriterion;
  raw: number | null;
  normalized: number;
  weight: number;
  weighted: number;
}

export interface ScoredCandidate {
  id: string;
  label: string;
  role: AgentRole;
  rank: number;
  totalScore: number;
  criteria: readonly ScoredCriterion[];
  summary: string | null;
  /** Criteria the caller did not supply; scored as 0 rather than guessed. */
  missingCriteria: readonly ComparisonCriterion[];
}

export interface ComparisonReport {
  taskId: string;
  generatedAt: number;
  candidates: readonly ScoredCandidate[];
  recommendedId: string | null;
  /** True when the top two candidates are within the tie threshold. */
  tie: boolean;
  rationale: string;
  /** Always false: a human selects the winner. */
  autoSelected: false;
}

export interface ComparisonSelection {
  taskId: string;
  selectedId: string;
  selectedAt: number;
  approvedByHuman: true;
  note: string | null;
  followedRecommendation: boolean;
}

export interface ComparisonOptions {
  weights?: Partial<Record<ComparisonCriterion, number>>;
  tieThreshold?: number;
  now?: () => number;
}

export class ResultComparisonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResultComparisonError';
  }
}

export class ResultComparator {
  private readonly weights: Readonly<Record<ComparisonCriterion, number>>;
  private readonly tieThreshold: number;
  private readonly now: () => number;

  public constructor(options: ComparisonOptions = {}) {
    this.weights = normalizeWeights(options.weights);
    this.tieThreshold = boundedRatio(options.tieThreshold ?? 0.02, 'tieThreshold');
    this.now = options.now ?? Date.now;
  }

  public compare(taskId: string, candidates: readonly CandidateResult[]): ComparisonReport {
    validateIdentifier(taskId, 'taskId');
    if (!Array.isArray(candidates) || candidates.length === 0) throw new ResultComparisonError('At least one candidate is required.');
    if (candidates.length > MAX_CANDIDATES) throw new ResultComparisonError(`At most ${MAX_CANDIDATES} candidates can be compared.`);

    const seen = new Set<string>();
    for (const candidate of candidates) {
      validateIdentifier(candidate.id, 'candidateId');
      if (seen.has(candidate.id)) throw new ResultComparisonError(`Duplicate candidate id "${candidate.id}".`);
      seen.add(candidate.id);
      if (candidate.taskId !== taskId) throw new ResultComparisonError(`Candidate "${candidate.id}" belongs to a different task.`);
      for (const [criterion, rawValue] of Object.entries(candidate.scores)) {
        if (!CRITERIA.includes(criterion as ComparisonCriterion)) throw new ResultComparisonError(`Unknown criterion "${criterion}".`);
        if (rawValue === undefined) continue;
        const value = rawValue as number;
        if (!Number.isFinite(value) || value < 0) {
          throw new ResultComparisonError(`Criterion "${criterion}" on candidate "${candidate.id}" must be a non-negative finite number.`);
        }
        if (!LOWER_IS_BETTER.has(criterion as ComparisonCriterion) && value > 1) {
          throw new ResultComparisonError(`Quality criterion "${criterion}" must be normalised to the range [0, 1].`);
        }
      }
    }

    const ranges = computeRanges(candidates);
    const scored = candidates.map((candidate) => {
      const criteria = CRITERIA.map((criterion) => {
        const raw = candidate.scores[criterion];
        const weight = this.weights[criterion];
        const normalized = raw === undefined ? 0 : normalize(criterion, raw, ranges[criterion]);
        return { criterion, raw: raw ?? null, normalized, weight, weighted: round(normalized * weight) };
      });
      return {
        id: candidate.id,
        label: boundedText(candidate.label, 'label', MAX_LABEL_CHARS),
        role: candidate.role,
        rank: 0,
        totalScore: round(criteria.reduce((total, entry) => total + entry.weighted, 0)),
        criteria,
        summary: candidate.summary ? candidate.summary.slice(0, MAX_SUMMARY_CHARS) : null,
        missingCriteria: CRITERIA.filter((criterion) => candidate.scores[criterion] === undefined),
      } satisfies ScoredCandidate;
    });

    // Deterministic ordering: score descending, then candidate id for a stable tiebreak.
    scored.sort((left, right) => (right.totalScore - left.totalScore) || left.id.localeCompare(right.id));
    scored.forEach((candidate, index) => { candidate.rank = index + 1; });

    const best = scored[0]!;
    const runnerUp = scored[1];
    const tie = runnerUp !== undefined && Math.abs(best.totalScore - runnerUp.totalScore) <= this.tieThreshold;

    return {
      taskId,
      generatedAt: this.now(),
      candidates: scored,
      recommendedId: best.id,
      tie,
      rationale: tie
        ? `Candidates "${best.id}" and "${runnerUp!.id}" scored within ${this.tieThreshold} of each other; human review is required to break the tie.`
        : `Candidate "${best.id}" scored highest (${best.totalScore}). A human must confirm the selection.`,
      autoSelected: false,
    };
  }

  /** Records an explicit human selection. There is no automatic path to a selection. */
  public select(report: ComparisonReport, selectedId: string, approvedByHuman: true, note?: string): ComparisonSelection {
    if (approvedByHuman !== true) throw new ResultComparisonError('Selecting a result requires explicit human approval.');
    validateIdentifier(selectedId, 'selectedId');
    if (!report.candidates.some((candidate) => candidate.id === selectedId)) {
      throw new ResultComparisonError(`Candidate "${selectedId}" is not part of this comparison.`);
    }
    return {
      taskId: report.taskId,
      selectedId,
      selectedAt: this.now(),
      approvedByHuman: true,
      note: note ? note.slice(0, MAX_NOTE_CHARS) : null,
      followedRecommendation: report.recommendedId === selectedId,
    };
  }
}

function computeRanges(candidates: readonly CandidateResult[]): Record<ComparisonCriterion, { min: number; max: number }> {
  const ranges = {} as Record<ComparisonCriterion, { min: number; max: number }>;
  for (const criterion of CRITERIA) {
    const values = candidates
      .map((candidate) => candidate.scores[criterion])
      .filter((value): value is number => value !== undefined);
    ranges[criterion] = values.length === 0
      ? { min: 0, max: 0 }
      : { min: Math.min(...values), max: Math.max(...values) };
  }
  return ranges;
}

function normalize(criterion: ComparisonCriterion, raw: number, range: { min: number; max: number }): number {
  if (!LOWER_IS_BETTER.has(criterion)) return round(Math.min(1, raw));
  // Lower-is-better: min-max invert. A single candidate, or all-equal values,
  // scores full marks because there is nothing to be worse than.
  if (range.max === range.min) return 1;
  return round((range.max - raw) / (range.max - range.min));
}

function normalizeWeights(overrides?: Partial<Record<ComparisonCriterion, number>>): Readonly<Record<ComparisonCriterion, number>> {
  if (!overrides) return DEFAULT_WEIGHTS;
  const merged = { ...DEFAULT_WEIGHTS, ...overrides };
  for (const criterion of CRITERIA) {
    const weight = merged[criterion];
    if (!Number.isFinite(weight) || weight < 0) throw new ResultComparisonError(`Weight for "${criterion}" must be a non-negative finite number.`);
  }
  const total = CRITERIA.reduce((sum, criterion) => sum + merged[criterion], 0);
  if (total <= 0) throw new ResultComparisonError('Comparison weights must sum to a positive value.');
  return Object.freeze(Object.fromEntries(
    CRITERIA.map((criterion) => [criterion, round(merged[criterion] / total)]),
  ) as Record<ComparisonCriterion, number>);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function boundedRatio(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new ResultComparisonError(`${name} must be in the range [0, 1].`);
  return value;
}

function boundedText(value: string, name: string, maxChars: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ResultComparisonError(`${name} is required.`);
  return value.trim().slice(0, maxChars);
}

function validateIdentifier(value: string, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new ResultComparisonError(`${name} is invalid.`);
  return value;
}

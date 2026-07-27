import { TraceReplayBuilder, type ReplayStep, type ReplayTimeline } from '../observability/trace-replay';
import type { TraceEvent, TraceLevel } from '../observability/tracer';

const MAX_BRANCHES = 20;
const MAX_LABEL_CHARS = 120;

/**
 * Phase 8C deterministic timeline scrubber.
 *
 * A pure, framework-free state machine over the Phase 6E replay timeline. It
 * models cursor position, filtering, and branching history so any UI can render
 * a session replay without owning the logic — and so the logic is unit-testable
 * without a DOM.
 *
 * It is **read-only over history**. Scrubbing re-reads already-captured trace
 * events; it never re-executes a step, invokes a model, calls a tool, or mutates
 * a workflow. "Replay" here means *reviewing* what happened, not repeating it.
 */

export interface ScrubberFilter {
  /** Minimum level to include. `debug` includes everything. */
  minLevel?: TraceLevel;
  /** Case-insensitive substring match against the event name. */
  nameContains?: string;
  /** Only include events at or below this depth. */
  maxDepth?: number;
}

export interface ScrubberFrame {
  index: number;
  total: number;
  step: ReplayStep | null;
  offsetMs: number;
  /** Fraction through the visible timeline, 0..1. */
  progress: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface TimelineBranch {
  id: string;
  label: string;
  /** Index in the *unfiltered* timeline the branch was taken from. */
  fromIndex: number;
  createdAt: number;
  note: string | null;
}

export interface ScrubberState {
  correlationId: string;
  frame: ScrubberFrame;
  filter: Required<Pick<ScrubberFilter, 'minLevel'>> & ScrubberFilter;
  visibleCount: number;
  totalCount: number;
  branches: readonly TimelineBranch[];
  activeBranchId: string | null;
}

export class TimelineScrubberError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TimelineScrubberError';
  }
}

const LEVEL_RANK: Readonly<Record<TraceLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export class TimelineScrubber {
  private readonly timeline: ReplayTimeline;
  private readonly allSteps: readonly ReplayStep[];
  private visible: readonly ReplayStep[];
  private filter: ScrubberFilter & { minLevel: TraceLevel } = { minLevel: 'debug' };
  private cursor = 0;
  private readonly branches: TimelineBranch[] = [];
  private activeBranchId: string | null = null;
  private readonly now: () => number;

  public constructor(events: readonly TraceEvent[], correlationId: string, options: { now?: () => number; builder?: TraceReplayBuilder } = {}) {
    const builder = options.builder ?? new TraceReplayBuilder();
    this.timeline = builder.buildTimeline(events, correlationId);
    this.allSteps = builder.replaySteps(this.timeline);
    this.visible = this.allSteps;
    this.now = options.now ?? Date.now;
  }

  /** Replaces the active filter and clamps the cursor into the new range. */
  public setFilter(filter: ScrubberFilter): ScrubberState {
    const minLevel = filter.minLevel ?? 'debug';
    if (!(minLevel in LEVEL_RANK)) throw new TimelineScrubberError(`Unknown trace level "${String(minLevel)}".`);
    if (filter.maxDepth !== undefined && (!Number.isSafeInteger(filter.maxDepth) || filter.maxDepth < 0)) {
      throw new TimelineScrubberError('maxDepth must be a non-negative safe integer.');
    }
    const needle = filter.nameContains?.toLowerCase();

    this.filter = { ...filter, minLevel };
    this.visible = this.allSteps.filter((step) => {
      if (LEVEL_RANK[step.node.level] < LEVEL_RANK[minLevel]) return false;
      if (filter.maxDepth !== undefined && step.node.depth > filter.maxDepth) return false;
      if (needle !== undefined && needle !== '' && !step.node.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.visible.length - 1));
    return this.state();
  }

  public clearFilter(): ScrubberState {
    return this.setFilter({});
  }

  public next(count = 1): ScrubberState { return this.seek(this.cursor + positiveStep(count)); }
  public previous(count = 1): ScrubberState { return this.seek(this.cursor - positiveStep(count)); }
  public first(): ScrubberState { return this.seek(0); }
  public last(): ScrubberState { return this.seek(this.visible.length - 1); }

  public seek(index: number): ScrubberState {
    if (!Number.isSafeInteger(index)) throw new TimelineScrubberError('Seek index must be a safe integer.');
    // Seeking past either end clamps rather than throwing: a scrubber dragged to
    // the edge should rest there, not fail.
    this.cursor = clamp(index, 0, Math.max(0, this.visible.length - 1));
    return this.state();
  }

  /** Seeks to the first visible step at or after `offsetMs`. */
  public seekToOffset(offsetMs: number): ScrubberState {
    if (!Number.isFinite(offsetMs) || offsetMs < 0) throw new TimelineScrubberError('offsetMs must be a non-negative finite number.');
    const index = this.visible.findIndex((step) => step.node.offsetMs >= offsetMs);
    return this.seek(index === -1 ? this.visible.length - 1 : index);
  }

  /** Jumps to the next visible step at `warn` or `error`, if one exists. */
  public nextIssue(): ScrubberState {
    const index = this.visible.findIndex((step, position) => position > this.cursor && LEVEL_RANK[step.node.level] >= LEVEL_RANK.warn);
    return index === -1 ? this.state() : this.seek(index);
  }

  public current(): ReplayStep | null {
    return this.visible[this.cursor] ?? null;
  }

  /** Visible steps up to and including the cursor — what a replay view has "played". */
  public playedSteps(): readonly ReplayStep[] {
    return this.visible.slice(0, this.cursor + 1);
  }

  public visibleSteps(): readonly ReplayStep[] {
    return [...this.visible];
  }

  /**
   * Records a branch point for what-if review.
   *
   * A branch is a **bookmark**, not an execution fork. It records where a
   * reviewer would have diverged; it starts no alternative run.
   */
  public branch(label: string, note?: string): TimelineBranch {
    if (this.branches.length >= MAX_BRANCHES) throw new TimelineScrubberError(`At most ${MAX_BRANCHES} branches are supported.`);
    const step = this.current();
    if (!step) throw new TimelineScrubberError('Cannot branch from an empty timeline.');
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (trimmed === '') throw new TimelineScrubberError('A branch label is required.');

    const fromIndex = this.allSteps.findIndex((candidate) => candidate.node.id === step.node.id);
    const branch: TimelineBranch = {
      id: `branch-${this.branches.length + 1}-${step.node.id}`,
      label: trimmed.slice(0, MAX_LABEL_CHARS),
      fromIndex,
      createdAt: this.now(),
      note: note ? note.trim().slice(0, MAX_LABEL_CHARS * 2) : null,
    };
    this.branches.push(branch);
    this.activeBranchId = branch.id;
    return { ...branch };
  }

  /** Returns to a recorded branch point, honouring the current filter. */
  public gotoBranch(branchId: string): ScrubberState {
    const branch = this.branches.find((candidate) => candidate.id === branchId);
    if (!branch) throw new TimelineScrubberError(`Unknown branch "${branchId}".`);
    const target = this.allSteps[branch.fromIndex];
    this.activeBranchId = branch.id;
    if (!target) return this.state();
    const visibleIndex = this.visible.findIndex((step) => step.node.id === target.node.id);
    // If the branch point is filtered out, land on the nearest visible step.
    if (visibleIndex !== -1) return this.seek(visibleIndex);
    const fallback = this.visible.findIndex((step) => step.node.offsetMs >= target.node.offsetMs);
    return this.seek(fallback === -1 ? this.visible.length - 1 : fallback);
  }

  public listBranches(): readonly TimelineBranch[] {
    return this.branches.map((branch) => ({ ...branch }));
  }

  public timelineSummary(): ReplayTimeline {
    return this.timeline;
  }

  public state(): ScrubberState {
    const total = this.visible.length;
    const step = this.current();
    return {
      correlationId: this.timeline.correlationId,
      frame: {
        index: total === 0 ? -1 : this.cursor,
        total,
        step,
        offsetMs: step?.node.offsetMs ?? 0,
        progress: total <= 1 ? (total === 0 ? 0 : 1) : round(this.cursor / (total - 1)),
        atStart: total === 0 || this.cursor === 0,
        atEnd: total === 0 || this.cursor === total - 1,
      },
      filter: { ...this.filter },
      visibleCount: total,
      totalCount: this.allSteps.length,
      branches: this.listBranches(),
      activeBranchId: this.activeBranchId,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function positiveStep(count: number): number {
  if (!Number.isSafeInteger(count) || count <= 0) throw new TimelineScrubberError('Step count must be a positive safe integer.');
  return count;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

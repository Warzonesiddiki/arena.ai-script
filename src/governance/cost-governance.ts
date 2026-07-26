import { EventBus, type EventMap } from '../core/event-bus';

const MICROS_PER_USD = 1_000_000;

export interface CostEvents extends EventMap {
  'cost:projection': CostProjection;
  'cost:reserved': CostDecision;
  'cost:recorded': CostUsage;
  'cost:blocked': CostDecision;
}

export interface CostPolicy {
  workflowBudgetUsd: number;
  agentBudgetUsd?: number;
  warnAtPercent?: number;
}

export interface CostProjection {
  workflowId: string;
  agentId: string;
  estimatedCostUsd: number;
  workflowSpentUsd: number;
  workflowReservedUsd: number;
  projectedWorkflowTotalUsd: number;
  workflowBudgetUsd: number;
  agentSpentUsd: number;
  projectedAgentTotalUsd: number;
  agentBudgetUsd: number | null;
}

export interface CostDecision extends CostProjection {
  allowed: boolean;
  reason: 'within-budget' | 'workflow-budget-exceeded' | 'agent-budget-exceeded';
  reservationId: string | null;
}

export interface CostUsage {
  workflowId: string;
  agentId: string;
  reservationId: string | null;
  actualCostUsd: number;
  workflowSpentUsd: number;
  agentSpentUsd: number;
  workflowOverBudget: boolean;
  agentOverBudget: boolean;
}

interface Reservation {
  id: string;
  workflowId: string;
  agentId: string;
  costMicros: number;
}

export interface CostGovernanceOptions {
  eventBus?: EventBus<CostEvents>;
  idFactory?: () => string;
}

/**
 * Deterministic, hard budget governor. It neither estimates with an LLM nor
 * permits a reservation that would cross its per-workflow/per-agent cap.
 */
export class CostGovernance {
  private readonly eventBus: EventBus<CostEvents>;
  private readonly idFactory: () => string;
  private readonly policies = new Map<string, { workflowBudgetMicros: number; agentBudgetMicros: number | null; warnAtPercent: number }>();
  private readonly workflowSpent = new Map<string, number>();
  private readonly agentSpent = new Map<string, number>();
  private readonly reservations = new Map<string, Reservation>();

  public constructor(options: CostGovernanceOptions = {}) {
    this.eventBus = options.eventBus ?? new EventBus<CostEvents>();
    this.idFactory = options.idFactory ?? (() => `cost-${Math.random().toString(36).slice(2, 10)}`);
  }

  public configureWorkflow(workflowId: string, policy: CostPolicy): void {
    validateIdentifier(workflowId, 'workflowId');
    const workflowBudgetMicros = toMicros(policy.workflowBudgetUsd, 'workflowBudgetUsd');
    const agentBudgetMicros = policy.agentBudgetUsd === undefined ? null : toMicros(policy.agentBudgetUsd, 'agentBudgetUsd');
    const warnAtPercent = policy.warnAtPercent ?? 80;
    if (!Number.isFinite(warnAtPercent) || warnAtPercent <= 0 || warnAtPercent > 100) {
      throw new RangeError('warnAtPercent must be in the range (0, 100].');
    }
    this.policies.set(workflowId, { workflowBudgetMicros, agentBudgetMicros, warnAtPercent });
  }

  public project(workflowId: string, agentId: string, estimatedCostUsd: number): CostProjection {
    const policy = this.requirePolicy(workflowId);
    validateIdentifier(agentId, 'agentId');
    const estimatedMicros = toMicros(estimatedCostUsd, 'estimatedCostUsd');
    const workflowSpent = this.workflowSpent.get(workflowId) ?? 0;
    const workflowReserved = this.sumReserved(workflowId);
    const agentSpent = this.agentSpent.get(agentKey(workflowId, agentId)) ?? 0;
    const agentReserved = this.sumReserved(workflowId, agentId);
    const projection: CostProjection = {
      workflowId,
      agentId,
      estimatedCostUsd: fromMicros(estimatedMicros),
      workflowSpentUsd: fromMicros(workflowSpent),
      workflowReservedUsd: fromMicros(workflowReserved),
      projectedWorkflowTotalUsd: fromMicros(workflowSpent + workflowReserved + estimatedMicros),
      workflowBudgetUsd: fromMicros(policy.workflowBudgetMicros),
      agentSpentUsd: fromMicros(agentSpent),
      projectedAgentTotalUsd: fromMicros(agentSpent + agentReserved + estimatedMicros),
      agentBudgetUsd: policy.agentBudgetMicros === null ? null : fromMicros(policy.agentBudgetMicros),
    };
    this.eventBus.emit('cost:projection', projection);
    return projection;
  }

  public reserve(workflowId: string, agentId: string, estimatedCostUsd: number): CostDecision {
    const projection = this.project(workflowId, agentId, estimatedCostUsd);
    const policy = this.requirePolicy(workflowId);
    const workflowOver = toMicros(projection.projectedWorkflowTotalUsd, 'projectedWorkflowTotalUsd') > policy.workflowBudgetMicros;
    const agentOver = policy.agentBudgetMicros !== null
      && toMicros(projection.projectedAgentTotalUsd, 'projectedAgentTotalUsd') > policy.agentBudgetMicros;
    const reason = workflowOver ? 'workflow-budget-exceeded' : agentOver ? 'agent-budget-exceeded' : 'within-budget';

    if (reason !== 'within-budget') {
      const blocked: CostDecision = { ...projection, allowed: false, reason, reservationId: null };
      this.eventBus.emit('cost:blocked', blocked);
      return blocked;
    }

    const reservationId = this.idFactory();
    this.reservations.set(reservationId, {
      id: reservationId,
      workflowId,
      agentId,
      costMicros: toMicros(estimatedCostUsd, 'estimatedCostUsd'),
    });
    const decision: CostDecision = { ...projection, allowed: true, reason, reservationId };
    this.eventBus.emit('cost:reserved', decision);
    return decision;
  }

  /** Records actual known spend and releases its reservation. An overage is visible immediately. */
  public recordUsage(workflowId: string, agentId: string, actualCostUsd: number, reservationId: string | null = null): CostUsage {
    const policy = this.requirePolicy(workflowId);
    validateIdentifier(agentId, 'agentId');
    const actualMicros = toMicros(actualCostUsd, 'actualCostUsd');
    if (reservationId !== null) this.releaseReservation(reservationId, workflowId, agentId);

    const workflowTotal = (this.workflowSpent.get(workflowId) ?? 0) + actualMicros;
    const currentAgentKey = agentKey(workflowId, agentId);
    const agentTotal = (this.agentSpent.get(currentAgentKey) ?? 0) + actualMicros;
    this.workflowSpent.set(workflowId, workflowTotal);
    this.agentSpent.set(currentAgentKey, agentTotal);

    const usage: CostUsage = {
      workflowId,
      agentId,
      reservationId,
      actualCostUsd: fromMicros(actualMicros),
      workflowSpentUsd: fromMicros(workflowTotal),
      agentSpentUsd: fromMicros(agentTotal),
      workflowOverBudget: workflowTotal > policy.workflowBudgetMicros,
      agentOverBudget: policy.agentBudgetMicros !== null && agentTotal > policy.agentBudgetMicros,
    };
    this.eventBus.emit('cost:recorded', usage);
    return usage;
  }

  public release(reservationId: string): boolean {
    return this.reservations.delete(reservationId);
  }

  public getRemainingWorkflowBudget(workflowId: string): number {
    const policy = this.requirePolicy(workflowId);
    return fromMicros(Math.max(0, policy.workflowBudgetMicros - (this.workflowSpent.get(workflowId) ?? 0) - this.sumReserved(workflowId)));
  }

  private requirePolicy(workflowId: string): { workflowBudgetMicros: number; agentBudgetMicros: number | null; warnAtPercent: number } {
    validateIdentifier(workflowId, 'workflowId');
    const policy = this.policies.get(workflowId);
    if (!policy) throw new Error(`No cost policy configured for workflow "${workflowId}".`);
    return policy;
  }

  private sumReserved(workflowId: string, agentId?: string): number {
    let total = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.workflowId === workflowId && (agentId === undefined || reservation.agentId === agentId)) total += reservation.costMicros;
    }
    return total;
  }

  private releaseReservation(reservationId: string, workflowId: string, agentId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.workflowId !== workflowId || reservation.agentId !== agentId) {
      throw new Error('Reservation does not belong to this workflow and agent.');
    }
    this.reservations.delete(reservationId);
  }
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
}

function toMicros(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number.`);
  const micros = Math.round(value * MICROS_PER_USD);
  if (!Number.isSafeInteger(micros)) throw new RangeError(`${name} is outside the supported range.`);
  return micros;
}

function fromMicros(value: number): number {
  return value / MICROS_PER_USD;
}

function agentKey(workflowId: string, agentId: string): string {
  return `${workflowId}\u0000${agentId}`;
}

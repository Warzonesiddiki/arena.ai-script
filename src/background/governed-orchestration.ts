import { AuditLog } from '../audit/audit-log';
import { BackgroundAgentStateStore } from './background-agent-state';
import { RiskPolicyEngine, type ProposedAction } from '../safety/risk-policy-engine';
import type { OrchestrationService, OrchestrationServiceSnapshot } from './orchestration-service';
import type { AgentRole } from '../orchestration/types';

/**
 * Wires the safety policy engine, the audit log, and durable control state into
 * the live approval path.
 *
 * Without this, those modules are well-tested but unreachable code. Every
 * approval that reaches the worker now passes a deterministic policy check
 * first and leaves an audit record either way — including refusals.
 *
 * It adds governance around an existing approval; it never creates one. A
 * refused approval leaves orchestration state untouched.
 */

export interface GovernedResult {
  ok: boolean;
  orchestration?: OrchestrationServiceSnapshot;
  error?: string;
}

export interface GovernedOrchestrationOptions {
  orchestration: OrchestrationService;
  policy?: RiskPolicyEngine;
  audit?: AuditLog;
  stateStore?: BackgroundAgentStateStore;
  now?: () => number;
  /** Surfaces a persistence failure without letting it break the request. */
  onPersistError?: (scope: string, error: unknown) => void;
}

export class GovernedOrchestration {
  private readonly orchestration: OrchestrationService;
  private readonly policy: RiskPolicyEngine;
  private readonly audit: AuditLog;
  private readonly stateStore: BackgroundAgentStateStore;
  private readonly onPersistError: (scope: string, error: unknown) => void;

  public constructor(options: GovernedOrchestrationOptions) {
    this.orchestration = options.orchestration;
    this.policy = options.policy ?? new RiskPolicyEngine();
    this.audit = options.audit ?? new AuditLog();
    this.stateStore = options.stateStore ?? new BackgroundAgentStateStore();
    this.onPersistError = options.onPersistError ?? (() => undefined);
  }

  public async create(goal: string): Promise<GovernedResult> {
    try {
      const snapshot = this.orchestration.create(goal);
      await this.record({
        category: 'lifecycle',
        action: 'orchestration plan created',
        outcome: 'recorded',
        actor: 'human',
        subjectId: snapshot.planId,
        detail: { taskCount: snapshot.cards.length, estimatedCostUsd: snapshot.estimatedCostUsd },
      });
      await this.persist(snapshot);
      return { ok: true, orchestration: snapshot };
    } catch (error) {
      const reason = message(error);
      await this.record({ category: 'denial', action: 'orchestration plan creation failed', outcome: 'refused', actor: 'system', detail: { reason } });
      return { ok: false, error: reason };
    }
  }

  /**
   * Approves a task after a policy check.
   *
   * The human has already approved by sending this message; the policy engine
   * can still refuse, and a `deny` is final.
   */
  public async approve(taskId: string): Promise<GovernedResult> {
    const before = this.orchestration.snapshot(false);
    const card = before.cards.find((candidate) => candidate.id === taskId);
    if (!card) {
      await this.record({ category: 'denial', action: 'approve unknown task', outcome: 'refused', actor: 'system', subjectId: taskId, detail: { reason: 'unknown-task' } });
      return { ok: false, error: `Unknown task "${taskId}".` };
    }

    const action: ProposedAction = {
      id: `approve:${taskId}`,
      kind: 'plan-approval',
      role: card.role as AgentRole,
      taskId,
      summary: `Approve ${card.role} task ${taskId}`,
      estimatedCostUsd: card.estimatedCostUsd,
    };
    const gate = this.policy.gate(action, { approvedByHuman: true });

    if (!gate.permitted) {
      await this.record({
        category: 'policy',
        action: 'approval refused by policy',
        outcome: 'refused',
        actor: 'system',
        subjectId: taskId,
        detail: { verdict: gate.decision.verdict, riskLevel: gate.decision.riskLevel, rule: gate.decision.decidingRuleId, reason: gate.reason },
      });
      return { ok: false, error: gate.reason };
    }

    try {
      const snapshot = this.orchestration.approve(taskId);
      await this.record({
        category: 'approval',
        action: 'task approved',
        outcome: 'granted',
        actor: 'human',
        subjectId: taskId,
        detail: { role: card.role, riskLevel: gate.decision.riskLevel, estimatedCostUsd: card.estimatedCostUsd },
      });
      await this.persist(snapshot);
      return { ok: true, orchestration: snapshot };
    } catch (error) {
      const reason = message(error);
      await this.record({ category: 'denial', action: 'task approval rejected by lifecycle rules', outcome: 'refused', actor: 'system', subjectId: taskId, detail: { reason } });
      return { ok: false, error: reason };
    }
  }

  public status(): GovernedResult {
    return { ok: true, orchestration: this.orchestration.snapshot() };
  }

  /** Restores durable control state after an MV3 worker suspension. */
  public async restore(): Promise<GovernedResult> {
    try {
      const restored = await this.stateStore.restore();
      if (!restored) return this.status();
      await this.record({
        category: 'lifecycle',
        action: 'control state restored',
        outcome: 'recorded',
        actor: 'system',
        subjectId: restored.planId,
        detail: { roleCount: restored.roles.length, suspended: restored.suspended },
      });
      return this.status();
    } catch (error) {
      this.onPersistError('governed.restore', error);
      return this.status();
    }
  }

  public async auditSummary(): ReturnType<AuditLog['summary']> {
    return this.audit.summary();
  }

  private async persist(snapshot: OrchestrationServiceSnapshot): Promise<void> {
    try {
      await this.stateStore.saveSnapshot(snapshot);
    } catch (error) {
      // Persistence is durability, not correctness: never fail a request over it.
      this.onPersistError('governed.persist', error);
    }
  }

  private async record(entry: Parameters<AuditLog['append']>[0]): Promise<void> {
    try {
      await this.audit.append(entry);
    } catch (error) {
      this.onPersistError('governed.audit', error);
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Orchestration request failed.';
}

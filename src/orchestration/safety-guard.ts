import { DEFAULT_CAPABILITY_TIER, tierLimits, type CapabilityTier } from './capability-tier';

export class SafetyViolation extends Error { public constructor(message: string) { super(message); this.name = 'SafetyViolation'; } }

export interface SafetyGuardOptions {
  tier?: CapabilityTier;
  maxHandoffs?: number;
  maxAgents?: number;
}

/**
 * Hard concurrency/handoff limits.
 *
 * Defaults come from the capability tier (`phase3` = 3 agents / 12 handoffs,
 * `phase6` = 5 / 20). Explicit overrides may only make limits **stricter**; an
 * attempt to widen them beyond the tier fails closed.
 */
export class OrchestrationSafetyGuard {
  private handoffs = 0;
  private readonly activeAgents = new Set<string>();
  private readonly approvedTasks = new Set<string>();
  private readonly maxHandoffs: number;
  private readonly maxAgents: number;
  public readonly tier: CapabilityTier;

  public constructor(options: SafetyGuardOptions | number = {}, legacyMaxAgents?: number) {
    // Backwards-compatible positional form: (maxHandoffs, maxAgents).
    const normalized: SafetyGuardOptions = typeof options === 'number'
      ? { maxHandoffs: options, ...(legacyMaxAgents === undefined ? {} : { maxAgents: legacyMaxAgents }) }
      : options;
    this.tier = normalized.tier ?? DEFAULT_CAPABILITY_TIER;
    const limits = tierLimits(this.tier);
    this.maxHandoffs = clampToTier(normalized.maxHandoffs, limits.maxHandoffs, 'maxHandoffs', this.tier);
    this.maxAgents = clampToTier(normalized.maxAgents, limits.maxConcurrentAgents, 'maxAgents', this.tier);
  }

  public approve(taskId: string): void { this.approvedTasks.add(taskId); }
  public requireApproval(taskId: string): void {
    if (!this.approvedTasks.has(taskId)) throw new SafetyViolation(`Task "${taskId}" requires human approval.`);
  }

  public startAgent(agentId: string): void {
    if (this.activeAgents.has(agentId)) return;
    if (this.activeAgents.size >= this.maxAgents) throw new SafetyViolation(`Capability tier "${this.tier}" permits at most ${this.maxAgents} concurrent agents.`);
    this.activeAgents.add(agentId);
  }
  public stopAgent(agentId: string): void { this.activeAgents.delete(agentId); }
  public handoff(): void {
    if (this.handoffs >= this.maxHandoffs) throw new SafetyViolation(`Capability tier "${this.tier}" permits at most ${this.maxHandoffs} handoffs.`);
    this.handoffs += 1;
  }

  public availableAgentSlots(): number { return Math.max(0, this.maxAgents - this.activeAgents.size); }
  public limits(): { maxAgents: number; maxHandoffs: number } { return { maxAgents: this.maxAgents, maxHandoffs: this.maxHandoffs }; }
  public snapshot(): { activeAgents: number; handoffs: number } { return { activeAgents: this.activeAgents.size, handoffs: this.handoffs }; }
}

function clampToTier(requested: number | undefined, tierMax: number, name: string, tier: CapabilityTier): number {
  if (requested === undefined) return tierMax;
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new SafetyViolation(`${name} must be a positive safe integer.`);
  if (requested > tierMax) {
    throw new SafetyViolation(`${name} of ${requested} exceeds the "${tier}" tier maximum of ${tierMax}.`);
  }
  return requested;
}

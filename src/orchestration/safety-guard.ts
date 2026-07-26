export class SafetyViolation extends Error { public constructor(message: string) { super(message); this.name = 'SafetyViolation'; } }

/** Hard phase-3 limits: three roles and twelve handoffs. */
export class OrchestrationSafetyGuard {
  private handoffs = 0;
  private readonly activeAgents = new Set<string>();
  private readonly approvedTasks = new Set<string>();
  public constructor(private readonly maxHandoffs = 12, private readonly maxAgents = 3) {}

  public approve(taskId: string): void { this.approvedTasks.add(taskId); }
  public requireApproval(taskId: string): void {
    if (!this.approvedTasks.has(taskId)) throw new SafetyViolation(`Task "${taskId}" requires human approval.`);
  }

  public startAgent(agentId: string): void {
    if (this.activeAgents.has(agentId)) return;
    if (this.activeAgents.size >= this.maxAgents) throw new SafetyViolation(`Phase 3 permits at most ${this.maxAgents} concurrent agents.`);
    this.activeAgents.add(agentId);
  }
  public stopAgent(agentId: string): void { this.activeAgents.delete(agentId); }
  public handoff(): void {
    if (this.handoffs >= this.maxHandoffs) throw new SafetyViolation(`Phase 3 permits at most ${this.maxHandoffs} handoffs.`);
    this.handoffs += 1;
  }
  public snapshot(): { activeAgents: number; handoffs: number } { return { activeAgents: this.activeAgents.size, handoffs: this.handoffs }; }
}

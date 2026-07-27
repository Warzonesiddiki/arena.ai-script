export const PHASE3_ROLES = ['planner', 'coder', 'critic'] as const;

/** Phase 6B adds Researcher and Executor on top of the Phase 3 roles. */
export const PHASE6_ROLES = ['planner', 'researcher', 'coder', 'executor', 'critic'] as const;

export type Phase3Role = typeof PHASE3_ROLES[number];
export type AgentRole = typeof PHASE6_ROLES[number];
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

export interface PlanTask {
  id: string;
  role: AgentRole;
  title: string;
  instructions: string;
  dependsOn: readonly string[];
  estimatedCostUsd: number;
  status: TaskStatus;
  costReservationId?: string | null;
  costBlockedReason?: 'workflow-budget-exceeded' | 'agent-budget-exceeded';
}

export interface AgentPlan {
  id: string;
  goal: string;
  createdAt: number;
  /** 3 at the `phase3` capability tier, 5 at `phase6`. */
  maxConcurrentAgents: number;
  tasks: readonly PlanTask[];
}

export interface ScopedFile {
  path: string;
  content: string;
}

export interface ScopedContext {
  goal: string;
  files: readonly ScopedFile[];
  snapshotId: string;
  truncated: boolean;
}

export interface WorkerRequest {
  role: AgentRole;
  taskId: string;
  task: string;
  context: ScopedContext;
  constraints: { maxTokens: number; timeoutMs: number };
}

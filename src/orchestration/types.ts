export const PHASE3_ROLES = ['planner', 'coder', 'critic'] as const;
export type AgentRole = typeof PHASE3_ROLES[number];
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

export interface PlanTask {
  id: string;
  role: AgentRole;
  title: string;
  instructions: string;
  dependsOn: readonly string[];
  estimatedCostUsd: number;
  status: TaskStatus;
}

export interface AgentPlan {
  id: string;
  goal: string;
  createdAt: number;
  maxConcurrentAgents: 3;
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

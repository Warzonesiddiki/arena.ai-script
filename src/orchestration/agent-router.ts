import { tierLimits, type CapabilityTier } from './capability-tier';
import type { AgentRole, PlanTask, TaskStatus } from './types';

/**
 * Phase 6A deterministic routing and load balancing.
 *
 * "Dynamic routing" here means *deterministic dispatch ordering under live load*
 * — never LLM-directed choice. Given identical inputs this always produces an
 * identical schedule, which keeps the orchestrator reviewable and testable.
 *
 * The router only ever *proposes* a dispatch order. It starts nothing, approves
 * nothing, and invokes nothing.
 */

/** Fixed role dispatch priority. Lower runs earlier when everything else ties. */
const ROLE_PRIORITY: Readonly<Record<AgentRole, number>> = Object.freeze({
  planner: 0,
  researcher: 1,
  coder: 2,
  executor: 3,
  critic: 4,
});

export type RouteBlockedReason =
  | 'not-approved'
  | 'dependency-incomplete'
  | 'dependency-failed'
  | 'terminal-status'
  | 'cost-blocked'
  | 'no-agent-slot';

export interface RoutableTask {
  id: string;
  role: AgentRole;
  status: TaskStatus;
  dependsOn: readonly string[];
  approved: boolean;
  estimatedCostUsd: number;
  costBlocked?: boolean;
}

export interface RoutedTask {
  taskId: string;
  role: AgentRole;
  order: number;
  /** Depth in the dependency DAG; deeper work is dispatched later. */
  depth: number;
  estimatedCostUsd: number;
}

export interface DeferredTask {
  taskId: string;
  role: AgentRole;
  reason: RouteBlockedReason;
  detail: string;
}

export interface RoutingDecision {
  tier: CapabilityTier;
  maxConcurrentAgents: number;
  availableSlots: number;
  dispatch: readonly RoutedTask[];
  deferred: readonly DeferredTask[];
  /** Always false: routing proposes an order, a human approves execution. */
  autoDispatch: false;
}

export interface RouterOptions {
  tier?: CapabilityTier;
}

export interface RouteInput {
  tasks: readonly RoutableTask[];
  activeAgents?: number;
  /** Extra ceiling, e.g. remaining budget. May only narrow the tier limit. */
  maxDispatch?: number;
}

export class AgentRoutingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AgentRoutingError';
  }
}

export class DeterministicAgentRouter {
  public readonly tier: CapabilityTier;
  private readonly maxConcurrentAgents: number;

  public constructor(options: RouterOptions = {}) {
    this.tier = options.tier ?? 'phase3';
    this.maxConcurrentAgents = tierLimits(this.tier).maxConcurrentAgents;
  }

  public route(input: RouteInput): RoutingDecision {
    const tasks = validateTasks(input.tasks, this.tier);
    const activeAgents = nonNegativeInteger(input.activeAgents ?? 0, 'activeAgents');
    const statuses = new Map(tasks.map((task) => [task.id, task.status]));
    const depths = computeDepths(tasks);

    let availableSlots = Math.max(0, this.maxConcurrentAgents - activeAgents);
    if (input.maxDispatch !== undefined) {
      availableSlots = Math.min(availableSlots, nonNegativeInteger(input.maxDispatch, 'maxDispatch'));
    }

    const ready: RoutableTask[] = [];
    const deferred: DeferredTask[] = [];

    for (const task of tasks) {
      const blocked = blockedReason(task, statuses);
      if (blocked) deferred.push({ taskId: task.id, role: task.role, ...blocked });
      else ready.push(task);
    }

    // Deterministic total order: shallower depth, then role priority, then
    // cheaper work, then task ID. Every key is a stable value, so the schedule
    // is reproducible across runs and machines.
    ready.sort((left, right) => (depths.get(left.id)! - depths.get(right.id)!)
      || (ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role])
      || (left.estimatedCostUsd - right.estimatedCostUsd)
      || left.id.localeCompare(right.id));

    const dispatch: RoutedTask[] = [];
    for (const task of ready) {
      if (dispatch.length >= availableSlots) {
        deferred.push({
          taskId: task.id,
          role: task.role,
          reason: 'no-agent-slot',
          detail: `No agent slot available; tier "${this.tier}" permits ${this.maxConcurrentAgents} concurrent agents.`,
        });
        continue;
      }
      dispatch.push({
        taskId: task.id,
        role: task.role,
        order: dispatch.length + 1,
        depth: depths.get(task.id)!,
        estimatedCostUsd: task.estimatedCostUsd,
      });
    }

    deferred.sort((left, right) => left.taskId.localeCompare(right.taskId));

    return {
      tier: this.tier,
      maxConcurrentAgents: this.maxConcurrentAgents,
      availableSlots,
      dispatch,
      deferred,
      autoDispatch: false,
    };
  }
}

function blockedReason(task: RoutableTask, statuses: ReadonlyMap<string, TaskStatus>): { reason: RouteBlockedReason; detail: string } | null {
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'blocked') {
    return { reason: 'terminal-status', detail: `Task "${task.id}" is ${task.status}.` };
  }
  if (task.status === 'running') {
    return { reason: 'terminal-status', detail: `Task "${task.id}" is already running.` };
  }
  if (task.costBlocked === true) {
    return { reason: 'cost-blocked', detail: `Task "${task.id}" is blocked by a cost reservation.` };
  }
  if (!task.approved) {
    return { reason: 'not-approved', detail: `Task "${task.id}" requires explicit human approval before dispatch.` };
  }
  for (const dependencyId of task.dependsOn) {
    const dependencyStatus = statuses.get(dependencyId);
    if (dependencyStatus === 'failed' || dependencyStatus === 'blocked') {
      return { reason: 'dependency-failed', detail: `Dependency "${dependencyId}" is ${dependencyStatus}.` };
    }
    if (dependencyStatus !== 'completed') {
      return { reason: 'dependency-incomplete', detail: `Dependency "${dependencyId}" is not completed.` };
    }
  }
  return null;
}

/** Longest-path depth in the dependency DAG. Cycles are rejected upstream. */
function computeDepths(tasks: readonly RoutableTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depths = new Map<string, number>();

  const resolve = (id: string, seen: ReadonlySet<string>): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const task = byId.get(id);
    if (!task) return 0;
    if (seen.has(id)) throw new AgentRoutingError(`Dependency cycle detected at task "${id}".`);
    const nextSeen = new Set(seen).add(id);
    let depth = 0;
    for (const dependencyId of task.dependsOn) {
      if (!byId.has(dependencyId)) continue;
      depth = Math.max(depth, resolve(dependencyId, nextSeen) + 1);
    }
    depths.set(id, depth);
    return depth;
  };

  for (const task of tasks) resolve(task.id, new Set());
  return depths;
}

function validateTasks(tasks: readonly RoutableTask[], tier: CapabilityTier): readonly RoutableTask[] {
  if (!Array.isArray(tasks)) throw new AgentRoutingError('tasks must be an array.');
  const allowedRoles = tierLimits(tier).roles as readonly string[];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(task.id)) throw new AgentRoutingError(`Task id "${String(task.id)}" is invalid.`);
    if (seen.has(task.id)) throw new AgentRoutingError(`Duplicate task id "${task.id}".`);
    seen.add(task.id);
    if (!allowedRoles.includes(task.role)) {
      throw new AgentRoutingError(`Role "${String(task.role)}" is not permitted at capability tier "${tier}".`);
    }
    if (!Number.isFinite(task.estimatedCostUsd) || task.estimatedCostUsd < 0) {
      throw new AgentRoutingError(`Task "${task.id}" has an invalid estimatedCostUsd.`);
    }
  }
  return tasks;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AgentRoutingError(`${name} must be a non-negative safe integer.`);
  return value;
}

export function planTaskToRoutable(task: PlanTask, approved: boolean): RoutableTask {
  return {
    id: task.id,
    role: task.role,
    status: task.status,
    dependsOn: task.dependsOn,
    approved,
    estimatedCostUsd: task.estimatedCostUsd,
    costBlocked: task.costBlockedReason !== undefined,
  };
}

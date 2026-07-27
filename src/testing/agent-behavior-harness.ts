import { DeterministicAgentRouter, type RoutableTask } from '../orchestration/agent-router';
import { OrchestrationDashboardState } from '../orchestration/dashboard-state';
import type { AgentPlan, TaskStatus } from '../orchestration/types';
import type { CapabilityTier } from '../orchestration/capability-tier';

const MAX_STEPS = 100;
const MAX_SCENARIOS = 200;

/**
 * Phase 14 agent-behavior test harness and simulation mode.
 *
 * Runs scenarios against the **real** deterministic lifecycle rules
 * (`OrchestrationDashboardState`, `DeterministicAgentRouter`) with no model, no
 * tool, no network, and no clock dependency. It is a simulator over the actual
 * policy code, so a passing golden test is evidence about the shipped logic
 * rather than about a mock.
 *
 * Every simulated "run" is an in-memory state transition. Nothing is executed.
 */

export type ScenarioAction =
  | { type: 'approve'; taskId: string }
  | { type: 'transition'; taskId: string; status: TaskStatus }
  | { type: 'route' }
  | { type: 'expect-dispatch'; taskIds: readonly string[] }
  | { type: 'expect-status'; taskId: string; status: TaskStatus }
  | { type: 'expect-error'; contains?: string };

export interface BehaviorScenario {
  id: string;
  description: string;
  plan: AgentPlan;
  tier?: CapabilityTier;
  actions: readonly ScenarioAction[];
}

export interface StepResult {
  index: number;
  action: ScenarioAction;
  ok: boolean;
  error: string | null;
  detail: string;
}

export interface ScenarioResult {
  scenarioId: string;
  passed: boolean;
  steps: readonly StepResult[];
  failureSummary: string | null;
  finalStatuses: Readonly<Record<string, TaskStatus>>;
  /** Stable hash of the outcome, for golden-test comparison. */
  goldenDigest: string;
}

export interface SuiteResult {
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  results: readonly ScenarioResult[];
  failures: readonly string[];
}

export class BehaviorHarnessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'BehaviorHarnessError';
  }
}

export class AgentBehaviorHarness {
  public run(scenario: BehaviorScenario): ScenarioResult {
    validateScenario(scenario);
    const dashboard = new OrchestrationDashboardState(scenario.plan);
    const router = new DeterministicAgentRouter({ tier: scenario.tier ?? 'phase3' });
    const approved = new Set<string>();
    const steps: StepResult[] = [];
    let lastError: string | null = null;
    let lastDispatch: readonly string[] = [];
    let pendingErrorExpected = false;

    for (const [index, action] of scenario.actions.entries()) {
      const step = this.execute(action, { dashboard, router, approved, lastError, lastDispatch, scenario });
      steps.push({ index: index + 1, action, ok: step.ok, error: step.error, detail: step.detail });

      if (step.dispatch !== undefined) lastDispatch = step.dispatch;
      // An error is only "consumed" by a following expect-error step.
      lastError = step.error;
      pendingErrorExpected = action.type === 'expect-error';

      if (!step.ok) break;
    }

    // An unconsumed error from the final step is a failure, not a pass.
    const trailingError = lastError !== null && !pendingErrorExpected;
    const failing = steps.find((step) => !step.ok);
    const finalStatuses = Object.fromEntries(
      scenario.plan.tasks.map((task) => [task.id, dashboard.cards().find((card) => card.id === task.id)!.status]),
    );

    const passed = failing === undefined && !trailingError;
    return {
      scenarioId: scenario.id,
      passed,
      steps,
      failureSummary: passed
        ? null
        : failing
          ? `Step ${failing.index} (${failing.action.type}) failed: ${failing.error ?? failing.detail}`
          : `Unhandled error after the final step: ${lastError}`,
      finalStatuses,
      goldenDigest: digest([scenario.id, String(passed), ...Object.entries(finalStatuses).sort().map(([id, status]) => `${id}=${status}`)].join('|')),
    };
  }

  public runSuite(scenarios: readonly BehaviorScenario[]): SuiteResult {
    if (!Array.isArray(scenarios)) throw new BehaviorHarnessError('scenarios must be an array.');
    if (scenarios.length > MAX_SCENARIOS) throw new BehaviorHarnessError(`At most ${MAX_SCENARIOS} scenarios can run in one suite.`);
    const seen = new Set<string>();
    for (const scenario of scenarios) {
      if (seen.has(scenario.id)) throw new BehaviorHarnessError(`Duplicate scenario id "${scenario.id}".`);
      seen.add(scenario.id);
    }

    const results = scenarios.map((scenario) => this.run(scenario));
    const failures = results.filter((result) => !result.passed);
    return {
      passed: failures.length === 0,
      total: results.length,
      passedCount: results.length - failures.length,
      failedCount: failures.length,
      results,
      failures: failures.map((result) => `${result.scenarioId}: ${result.failureSummary}`),
    };
  }

  private execute(
    action: ScenarioAction,
    context: {
      dashboard: OrchestrationDashboardState;
      router: DeterministicAgentRouter;
      approved: Set<string>;
      lastError: string | null;
      lastDispatch: readonly string[];
      scenario: BehaviorScenario;
    },
  ): { ok: boolean; error: string | null; detail: string; dispatch?: readonly string[] } {
    const { dashboard, router, approved, scenario } = context;

    switch (action.type) {
      case 'approve':
        try {
          dashboard.approve(action.taskId);
          approved.add(action.taskId);
          return { ok: true, error: null, detail: `Approved "${action.taskId}".` };
        } catch (error) {
          return { ok: true, error: message(error), detail: `Approval of "${action.taskId}" was rejected.` };
        }

      case 'transition':
        try {
          dashboard.setStatus(action.taskId, action.status);
          return { ok: true, error: null, detail: `"${action.taskId}" → ${action.status}.` };
        } catch (error) {
          return { ok: true, error: message(error), detail: `Transition of "${action.taskId}" was rejected.` };
        }

      case 'route': {
        try {
          const cards = dashboard.cards();
          const tasks: RoutableTask[] = scenario.plan.tasks.map((task) => {
            const card = cards.find((entry) => entry.id === task.id)!;
            return {
              id: task.id,
              role: task.role,
              status: card.status,
              dependsOn: task.dependsOn,
              approved: approved.has(task.id),
              estimatedCostUsd: task.estimatedCostUsd,
              costBlocked: task.costBlockedReason !== undefined,
            };
          });
          const decision = router.route({ tasks });
          const dispatch = decision.dispatch.map((entry) => entry.taskId);
          return { ok: true, error: null, detail: `Routed: [${dispatch.join(', ')}].`, dispatch };
        } catch (error) {
          return { ok: true, error: message(error), detail: 'Routing was rejected.' };
        }
      }

      case 'expect-dispatch': {
        const actual = [...context.lastDispatch];
        const expected = [...action.taskIds];
        const ok = actual.length === expected.length && actual.every((id, index) => id === expected[index]);
        return {
          ok,
          error: ok ? null : `Expected dispatch [${expected.join(', ')}] but got [${actual.join(', ')}].`,
          detail: `Dispatch check: [${actual.join(', ')}].`,
        };
      }

      case 'expect-status': {
        const card = dashboard.cards().find((entry) => entry.id === action.taskId);
        if (!card) return { ok: false, error: `Unknown task "${action.taskId}".`, detail: 'Status check failed.' };
        const ok = card.status === action.status;
        return {
          ok,
          error: ok ? null : `Expected "${action.taskId}" to be ${action.status} but it is ${card.status}.`,
          detail: `Status check: "${action.taskId}" is ${card.status}.`,
        };
      }

      case 'expect-error': {
        if (context.lastError === null) {
          return { ok: false, error: 'Expected the previous step to fail, but it succeeded.', detail: 'Error check failed.' };
        }
        if (action.contains !== undefined && !context.lastError.includes(action.contains)) {
          return { ok: false, error: `Expected error containing "${action.contains}" but got "${context.lastError}".`, detail: 'Error check failed.' };
        }
        return { ok: true, error: null, detail: `Observed expected error: ${context.lastError}` };
      }

      default:
        return { ok: false, error: `Unsupported action "${String((action as { type: string }).type)}".`, detail: 'Unknown action.' };
    }
  }
}

function validateScenario(scenario: BehaviorScenario): void {
  if (!scenario || typeof scenario !== 'object') throw new BehaviorHarnessError('A scenario object is required.');
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(scenario.id)) throw new BehaviorHarnessError('Scenario id is invalid.');
  if (!scenario.plan || !Array.isArray(scenario.plan.tasks) || scenario.plan.tasks.length === 0) {
    throw new BehaviorHarnessError(`Scenario "${scenario.id}" requires a plan with at least one task.`);
  }
  if (!Array.isArray(scenario.actions)) throw new BehaviorHarnessError(`Scenario "${scenario.id}" requires an actions array.`);
  if (scenario.actions.length > MAX_STEPS) throw new BehaviorHarnessError(`Scenario "${scenario.id}" exceeds ${MAX_STEPS} steps.`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `gold-${(hash >>> 0).toString(36)}`;
}

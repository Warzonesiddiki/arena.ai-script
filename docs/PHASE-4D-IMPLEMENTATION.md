# Phase 4D Implementation — Health Monitoring

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 4D](20-PHASE-BLUEPRINT.md#phase-4-intelligence-layer)

## Scope delivered

Phase 4D adds deterministic health monitoring for controlled orchestration state. It detects risk from existing bounded inputs and recommends human-reviewed actions. It does **not** perform automatic recovery, launch agents, invoke models, execute tools, or mutate Arena content.

The monitor consumes:

- Phase 3E orchestration dashboard snapshots,
- existing `Tracer` task status events, and
- Phase 2E cost-governance events.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/health/orchestration-health-monitor.ts` | Deterministic health evaluation, issue generation, metrics, and bounded recommendations |
| `tests/unit/health/orchestration-health-monitor.test.ts` | Stalled-task, terminal-state, handoff, agent-capacity, approval, budget, failed-task, healthy-state, and validation tests |
| `jest.config.cjs` | Adds `src/health/**/*.ts` to enforced coverage scope |

## Health checks

`OrchestrationHealthMonitor` evaluates:

- **Stalled tasks** — a `running` task exceeds the configured timeout based on `orchestration.task.statusChanged` trace timing.
- **Blocked tasks** — current task status is `blocked`.
- **Failed tasks** — current task status is `failed`.
- **Approval waits** — a task requires approval but cannot yet be approved due to dependencies.
- **Handoff risk** — Phase 3 handoff count approaches or reaches the hard limit.
- **Agent capacity** — active agents reach the Phase 3 cap of 3.
- **Budget risk** — projected/spent workflow budget reaches warning or critical thresholds, including blocked cost gates.

The output is a `HealthSnapshot` with status `healthy`, `attention`, or `critical`, bounded issues, and metrics.

## Safety boundaries

Health monitoring is read-only. Recommendations are deliberately phrased as human-reviewed actions. The monitor does not:

- retry tasks,
- terminate tasks,
- approve tasks,
- launch tabs,
- invoke models,
- execute tools,
- store telemetry, or
- access DOM/page content.

## Bounds and validation

Defaults:

- Stall threshold: 120,000 ms.
- Handoff warning: 75% of the configured max handoffs.
- Budget warning: 80% of workflow budget.
- Phase 3 max handoffs: 12.
- Phase 3 max active agents: 3.
- Max issues returned: 50.

Invalid thresholds and timestamps fail closed with `OrchestrationHealthMonitorError`.

## Validation

Tests cover:

- stalled running task detection from trace timing,
- no false stall after terminal status clears running state,
- handoff-risk detection,
- active-agent capacity warning,
- pending-approval detection,
- budget warning and critical budget exhaustion,
- failed-task critical status,
- healthy state when no deterministic risk is present, and
- invalid configuration/timestamp rejection.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 4E — Analytics**, using existing trace, budget, recovery, orchestration, memory, reflection, and health events without adding unbounded telemetry retention.

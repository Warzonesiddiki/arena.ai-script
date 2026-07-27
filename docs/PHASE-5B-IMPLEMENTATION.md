# Phase 5B Implementation — Approval-Gated Scheduled Agents

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 5B](20-PHASE-BLUEPRINT.md#phase-5-persistence--scheduling)

## Scope delivered

Phase 5B adds deterministic schedule metadata and Chrome alarm registration. It does **not** add autonomous execution. A fired alarm creates an approval-required due-run record only; it does not launch tabs, invoke models, execute tools, approve tasks, navigate pages, or mutate Arena content.

The `alarms` permission was added to the manifest with this implementation and its manifest-validation update.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/scheduling/schedule-manager.ts` | Approval-gated schedule registry, recurrence calculation, Chrome alarm sync, due-run creation, and schedule persistence |
| `tests/unit/scheduling/schedule-manager.test.ts` | Create/persist/reload, explicit-approval gates, alarm handling, recurrence, due-run acknowledgement, and validation tests |
| `src/background/service-worker.ts` | Registers a Chrome alarm listener that routes schedule alarms to the manager and records failures through recovery |
| `tests/support/chrome-mock.ts` | Adds mocked `chrome.alarms` APIs for worker tests |
| `extension/public/manifest.json` and `tests/extension-scaffold.test.js` | Add and validate the `alarms` permission |

## Supported cadence types

`ScheduledAgentManager` supports deterministic UTC schedule metadata:

- `once` — one due run at a specific timestamp,
- `interval` — repeated due runs with a bounded minimum interval of 5 minutes,
- `daily` — next UTC day/time calculation,
- `weekly` — next UTC day-of-week/time calculation.

Each schedule stores:

- schedule ID,
- plan ID,
- bounded goal text,
- cadence,
- enabled state,
- next run time,
- last fired time,
- run count,
- approval-required marker.

## Approval gates

The following operations require explicit `approvedByHuman: true` / `true` approval arguments:

- schedule creation,
- enabling/disabling,
- removal,
- due-run acknowledgement.

Alarm firing itself does not approve execution. It produces:

```text
ScheduledAgentDueRun { approvedForExecution: false }
```

A later phase must add explicit user approval and cost/safety checks before any run can execute.

## Persistence

Schedules and due runs are persisted through the existing Phase 0D `StorageLayer` under:

```text
scheduling:agent-schedules:v1
```

This inherits IndexedDB persistence, LZ4 compression, CRC-32 integrity checks, quota checks, serialized mutations, and repairable metadata indexing.

## Safety boundaries

Phase 5B does **not**:

- launch browser tabs,
- invoke models,
- execute tools,
- approve tasks,
- retry tasks,
- read or write Arena DOM,
- store prompts/conversations/file contents/secrets/tool output, or
- create a page-facing command channel.

## Validation

Tests cover:

- approved schedule creation,
- persistence and reload,
- Chrome alarm registration,
- explicit approval requirements,
- alarm-to-due-run conversion without execution,
- interval recurrence and max-runs disabling,
- daily/weekly UTC recurrence calculation,
- invalid cadence/identifier rejection, and
- unrelated alarm ignore behavior.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 5C — Triggered Agents**. It should begin with deterministic trigger metadata and approval-gated due-run creation only; no webhooks, external integrations, or file access should be added without matching permissions, tests, and security design.

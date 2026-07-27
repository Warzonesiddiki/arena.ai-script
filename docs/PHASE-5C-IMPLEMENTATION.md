# Phase 5C Implementation — Approval-Gated Triggered Agents

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 5C](20-PHASE-BLUEPRINT.md#phase-5-persistence--scheduling)

## Scope delivered

Phase 5C adds deterministic **internal-only** trigger metadata and approval-gated due-run creation. A fired trigger records an approval-required due run and nothing else. It does not launch tabs, invoke models, execute tools, approve tasks, navigate pages, or mutate Arena content.

**No new browser permission was added.** Phase 5C reuses the existing `alarms` and `storage` capabilities that Phase 5B already justified, so `tests/extension-scaffold.test.js` and `extension/public/manifest.json` are unchanged.

## Explicitly out of scope

The blueprint row for 5C mentions "webhook + file change support". Those sources are **deliberately not implemented** in this phase because each would require new host permissions, a network/file threat model, rate limiting, authentication, and adversarial tests that do not yet exist. Phase 5C therefore ships only sources the extension already produces internally:

- ❌ no webhooks or inbound HTTP endpoint,
- ❌ no outbound network calls,
- ❌ no file-system or `downloads` access,
- ❌ no page-driven or content-script trigger source,
- ❌ no new host permissions.

Any external trigger source must arrive in a later phase with a matching security design, permission request, manifest-validation update, and tests.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/triggers/trigger-manager.ts` | Approval-gated trigger registry, deterministic condition matching, cooldown/max-fire bounds, due-run creation, and persistence |
| `tests/unit/triggers/trigger-manager.test.ts` | Approval gates, firing behaviour, disabled/non-matching cases, bounds, persistence reload, and invalid-input rejection |
| `src/background/service-worker.ts` | Routes a fired schedule due run into `TriggerManager.dispatch` so an internal event can only create further approval-required due runs |
| `tests/unit/background/service-worker.test.ts` | Confirms unrelated alarms create no schedule or trigger due runs |
| `jest.config.cjs` | Adds `src/triggers/**/*.ts` to the coverage floor |

## Supported internal trigger conditions

```ts
type TriggerCondition =
  | { type: 'health-status-changed'; toStatus: readonly HealthStatus[] }
  | { type: 'schedule-due-run-created'; scheduleId?: string }
  | { type: 'memory-candidate-created'; workflowId?: string; kind?: AgentMemoryKind }
  | { type: 'manual' };
```

| Source | Origin | Matching rules |
|---|---|---|
| `health-status-changed` | Phase 4D `OrchestrationHealthMonitor` snapshots | Fires only when the status actually changed and the new status is in a 1–3 entry allow list |
| `schedule-due-run-created` | Phase 5B `ScheduledAgentManager` due runs | Fires for any schedule, or one explicitly named schedule ID |
| `memory-candidate-created` | Phase 4A/4C memory candidates | Optional workflow ID and memory-kind filters |
| `manual` | Explicit human action only | Never dispatched by `dispatch()`; requires `fireManual(id, true)` |

Each stored trigger records: trigger ID, plan ID, bounded goal text, source, condition, enabled state, cooldown, max-fire limit, created/updated timestamps, last fired time, fire count, and an `approvalRequired: true` marker.

## Approval gates

These operations all require an explicit `true` approval argument and throw `TriggerPolicyError` otherwise:

- creating a trigger (`approvedByHuman: true`),
- enabling/disabling a trigger,
- removing a trigger,
- firing a manual trigger,
- acknowledging a due run.

Trigger firing itself never approves execution. Every fire produces:

```text
TriggeredAgentDueRun { approvedForExecution: false }
```

A later phase must add an explicit approval-and-execution lifecycle, with cost and safety checks, before any due run can actually run.

## Bounds

| Bound | Value |
|---|---|
| Maximum triggers | 25 |
| Maximum retained due runs | 100 (oldest dropped) |
| Maximum goal characters | 1,000 |
| Maximum reason characters | 300 |
| Maximum health-status targets per trigger | 3 |
| Maximum cooldown | 7 days |

A trigger that reaches its `maxFires` limit is disabled automatically; re-enabling still requires explicit human approval, and the exhausted fire count continues to block further firing.

## Persistence

Trigger definitions and due runs persist through the Phase 0D `StorageLayer` under:

```text
triggers:agent-triggers:v1
```

This inherits IndexedDB persistence, LZ4 compression, CRC-32 integrity checks, quota checks, serialized mutations, and repairable metadata indexing. Stored books are re-validated on load: an unsupported schema, an over-limit registry, an invalid condition, a non-approval-required trigger, or a due run tampered to `approvedForExecution: true` is rejected rather than trusted.

## Safety boundaries

Phase 5C does **not**:

- launch browser tabs,
- invoke models,
- execute tools,
- approve tasks,
- retry tasks,
- read or write Arena DOM,
- open a page-facing command channel,
- add permissions or host access,
- perform network or file access, or
- store prompts, conversations, file contents, secrets, or tool output.

## Validation

Tests cover:

- approved trigger creation, persistence, and reload,
- explicit-approval gates for create/enable/remove/manual-fire/acknowledge,
- firing producing approval-required due runs only,
- no action for disabled triggers,
- no action for non-matching conditions or unchanged health status,
- manual triggers being excluded from event dispatch,
- schedule/memory scoping filters,
- cooldown and max-fire bounds with automatic disabling,
- bounded trigger registry limit,
- removal clearing dependent due runs,
- rejection of unsupported (for example webhook) conditions and events, and
- rejection of tampered stored books.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 5D — Hibernation**. It should compress and restore bounded long-running control-plane state on demand without adding automatic execution, new permissions, or unbounded retention.

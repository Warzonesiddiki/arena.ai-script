# Phase 5A Implementation — Background Control-State Restoration

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 5A](20-PHASE-BLUEPRINT.md#phase-5-persistence--scheduling)

## Scope delivered

Phase 5A establishes durable background state for the orchestration control plane. This is intentionally **not** an autonomous background agent runner. It restores user visibility and approved lifecycle/control state after Manifest V3 service-worker suspension or tab closure without adding execution autonomy.

The implementation persists bounded Phase 3 role/dashboard state only:

- plan ID,
- goal summary,
- role/task cards,
- approval/lifecycle status,
- cost estimates,
- safety counters,
- suspended/resumed marker.

It stores no prompts, model outputs, full conversations, scoped file contents, DOM snapshots, secrets, or tool outputs.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/background/background-agent-state.ts` | Durable background control-plane state store using the existing compressed IndexedDB storage layer |
| `tests/unit/background/background-agent-state.test.ts` | Persistence, restoration, suspension/resume markers, inactive clear, policy rejection, and clone-safety tests |

## Storage model

`BackgroundAgentStateStore` writes a single large record through `StorageLayer.putLarge()` using the key:

```text
background:agent-control-state:v1
```

It inherits Phase 0D behavior:

- IndexedDB large-record persistence,
- LZ4 compression,
- CRC-32 integrity checks,
- quota checks,
- serialized mutations,
- repairable metadata index.

## Safety and policy checks

The store enforces Phase 3 boundaries during save/restore:

- at most 3 role states,
- at most 3 active agents,
- only Planner/Coder/Critic roles,
- valid bounded task IDs and plan IDs,
- valid task statuses,
- bounded goal/title/blocker text,
- finite non-negative costs and counters.

Invalid or out-of-policy state fails closed with `BackgroundAgentStateError`.

## Explicit non-capabilities

Phase 5A does **not**:

- launch browser tabs,
- invoke models,
- execute tools,
- retry tasks,
- approve tasks,
- navigate pages,
- read or write Arena DOM,
- schedule background work, or
- persist sensitive execution context.

Those capabilities require later phases and must remain human-approval gated.

## Validation

Tests cover:

- saving and restoring bounded control-plane state,
- preserving Phase 3 Planner/Coder/Critic role state,
- truncating oversized goals,
- marking restored state suspended/resumed without launching work,
- clearing state for inactive snapshots,
- rejecting >3 active agents,
- rejecting >3 role states,
- rejecting invalid plan IDs, and
- returning cloned state so callers cannot mutate persisted arrays.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 5B — Scheduled Agents**. Scheduling must begin with deterministic schedule metadata and user approval; no automatic execution should be introduced without explicit approval and lifecycle tests.

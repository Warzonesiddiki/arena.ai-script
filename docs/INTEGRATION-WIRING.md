# Integration Wiring — Making Completed Modules Actually Run

**Status:** Complete

**Date:** 2026-07-27

---

## The problem this fixes

An import-graph walk from the five webpack entry points found that **15 of 56 `src/` modules were unreachable**. They had tests, coverage, and documentation — and were dead code in the shipped bundle.

That is a serious kind of dishonesty in a project like this. A phase marked "complete" with a green test suite implied a capability the extension did not actually have. The affected modules included the safety-critical ones: the policy engine, the audit log, durable control state, health monitoring, recovery snapshots, and hibernation.

## What was wired

| Module | Now reachable via | Effect |
|---|---|---|
| `safety/risk-policy-engine` | `background/governed-orchestration` | Every approval passes a deterministic policy check first |
| `audit/audit-log` | `background/governed-orchestration` | Every approval **and refusal** leaves an audit record |
| `background/background-agent-state` | `background/governed-orchestration` | Control state persists and restores on `onStartup` |
| `health/orchestration-health-monitor` | `background/insight-service` | Live health in the Side Panel |
| `focus/focus-mode` | `background/insight-service` | "What matters now" surface |
| `recovery/recovery-snapshot-manager` | `background/insight-service` | Recovery proposals |
| `hibernation/hibernation-manager` | `background/insight-service` | Idle-workflow candidacy |
| `governance/advanced-cost-controls` | `background/insight-service` | Budget status and stop recommendation |
| `analytics/performance-analytics` | `background/insight-service` | Deterministic analytics |
| `observability/trace-replay`, `timeline/timeline-scrubber` | `background/insight-service` | Trace summary |
| `reflection/post-task-reflection` | analytics import chain | Reachable |

Result: **55 of 59 modules reachable.**

### The four that remain unbundled, with reasons

| Module | Reason |
|---|---|
| `testing/agent-behavior-harness` | Test-time simulation harness; deliberately never shipped to users |
| `integrations/egress-policy` | Phase 7 prerequisite gate with no integration behind it yet |
| `comparison/result-comparison` | Phase 6C scoring awaiting a comparison UI surface |
| `core/module-registry` | Ported v7 utility retained for parity; no v8 consumer yet |

## New runtime components

### `src/background/governed-orchestration.ts`

Wraps the approval path with policy + audit + persistence. Design points:

- **It adds governance around an approval; it never creates one.** A refused approval leaves orchestration state untouched — asserted by test.
- **Refusals are audited too.** A denial is exactly the event a reviewer needs, so `policy` and `denial` entries are written alongside `approval` ones.
- **Persistence failure never fails a request.** Durability is not a correctness dependency: a storage error is reported through the recovery manager and the request still succeeds.

### `src/background/insight-service.ts`

Aggregates the read-only analysis modules into one bounded projection. Everything is derived from existing state; it approves nothing and persists nothing except a recovery snapshot a caller explicitly asks to capture. Always reports `autoActioned: false`.

### `src/sidepanel/insight-panel.ts`

Validates the worker payload before rendering and builds every node with `createElement`/`textContent`. A test feeds `<img src=x onerror=...>` and `<script>` through it and asserts no element is created.

## Consequences for existing code

- The orchestration message handler is now **asynchronous** (it awaits policy and audit I/O), so it returns `true` from the listener and its tests drain real macrotasks.
- `tests/support/chrome-mock.ts` gained a modelled `chrome.storage.local` and `chrome.runtime.openOptionsPage`, because the worker genuinely uses them now.
- A new `aamp:orchestration:insights` message and an Insights card in the Side Panel.

## The regression guard

`tests/unit/regression/module-reachability.test.ts` walks the real import graph and fails when any `src/` module is unreachable without an explicit, reasoned exemption. It also:

- **rejects stale exemptions** — listing a module that *is* reachable fails the test, so the list cannot rot,
- requires each exemption reason to be a real sentence,
- pins the eleven safety-critical modules as must-be-reachable.

This makes the dead-code class of bug impossible to reintroduce silently.

## Validation

```bash
npm run ci
```

- 50 suites / 286 tests passing
- 0 runtime vulnerabilities
- 93.47% statements / 87.47% branches
- `insight-service` 100%, `governed-orchestration` 90.74% statements

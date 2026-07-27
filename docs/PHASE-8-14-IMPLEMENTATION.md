# Phase 8C/8E and Phase 14 Implementation — Interfaces and Behavior Testing

**Status:** 8C, 8E, and 14 complete. 8A, 8B, 8D deliberately not implemented.

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 8](20-PHASE-BLUEPRINT.md#phase-8-advanced-interfaces) and [Phase 14](20-PHASE-BLUEPRINT.md#phase-920-condensed-structure)

---

## Why these three, and not the rest of Phase 8

The blueprint orders Phase 8 as 8A → 8E with 8A (Infinite Canvas) depending on 7E (File System Access). Since Phase 7 is deliberately blocked, a strict reading would stall all of Phase 8.

But dependencies are per-item, not per-phase. **8C (Timeline Scrubber) depends on 6E, which is complete**, and 8E (Focus Mode) is a pure view projection over state that already exists. Both were built. The rest were not, for honest reasons:

| Subphase | Status | Reason |
|---|---|---|
| **8A** Infinite Canvas | ⛔ Not implemented | Depends on 7E file access, which is blocked |
| **8B** Voice Control | ⛔ Not implemented | Requires microphone permission and a speech backend — a new permission and a new egress path |
| **8C** Timeline Scrubber | ✅ Complete | Depends only on the completed 6E; no permission needed |
| **8D** Gesture Navigation | ⛔ Not implemented | Depends on 8B, and is a thin input-binding layer with no logic worth simulating |
| **8E** Focus Mode 3.0 | ✅ Complete | Pure deterministic projection over existing state |

## 8C — Timeline Scrubber

`src/timeline/timeline-scrubber.ts` is a framework-free state machine over the Phase 6E replay timeline, so any UI can render session replay without owning the logic — and so the logic is testable without a DOM.

**Read-only over history.** Scrubbing re-reads already-captured trace events. It never re-executes a step, invokes a model, calls a tool, or mutates a workflow. "Replay" means *reviewing* what happened, not repeating it.

Capabilities:

- cursor movement (`next`, `previous`, `first`, `last`, `seek`) that **clamps at both ends** rather than throwing — a scrubber dragged to the edge should rest there,
- `seekToOffset()` for time-based scrubbing and `nextIssue()` to jump to the next `warn`/`error`,
- filtering by minimum level, name substring, and max depth, with the cursor re-clamped into the new range,
- `playedSteps()` for "what has played so far",
- **branching history** — a branch is a *bookmark*, not an execution fork. It records where a reviewer would have diverged; it starts no alternative run. If a branch point is later filtered out, `gotoBranch()` lands on the nearest visible step instead of failing.

Bounds: 20 branches, 120-char labels. Attributes remain redacted by the 6E replay layer.

## 8E — Focus Mode 3.0

`src/focus/focus-mode.ts` answers one question deterministically: *what is the single most important thing to look at right now?*

Fixed priority order (failures first, idle last):

```text
failed-task → health-issue → blocked-task → budget-risk → awaiting-approval → running-task → idle
```

Ties break by task ID, then item ID, so the view never flickers between renders. Three levels control how much is shown: `minimal` (1 item), `balanced` (3), `detailed` (up to 20), with a `hiddenCount` for the remainder and `cycleLevel()` for a UI toggle.

**It approves nothing.** Items carry a `suggestedAction` string and an `actionable` flag; acting still routes through the existing approval gates. A task that *cannot yet* be approved is deliberately not surfaced as actionable work. All text is truncated to 160 characters.

## Phase 14 — Agent Behavior Testing Framework

`src/testing/agent-behavior-harness.ts` runs scenarios against the **real** deterministic lifecycle code — `OrchestrationDashboardState` and `DeterministicAgentRouter` — with no model, no tool, no network, and no clock dependency.

That distinction matters: because the harness drives the shipped policy objects rather than mocks, **a passing golden test is evidence about the real logic**. The suite added with it proves, executably, that:

- an unapproved task can never be dispatched or transitioned to `running`,
- Coder cannot be approved before Planner,
- a Phase 6 role is refused at the default Phase 3 tier,
- role priority orders Researcher ahead of Executor at `phase6`.

Scenario actions: `approve`, `transition`, `route`, `expect-dispatch`, `expect-status`, `expect-error`.

Two harness-design details worth noting:

- **An unconsumed trailing error fails the scenario.** If the final action is rejected and no `expect-error` follows it, the run is a failure — otherwise a broken scenario could silently "pass" by ending on a swallowed error.
- **Golden digests** are stable FNV-1a hashes of the scenario outcome, so a behavioral regression shows up as a changed digest.

Bounds: 100 steps per scenario, 200 scenarios per suite, duplicate scenario IDs rejected.

---

## Safety boundaries

None of this work:

- launches tabs, invokes models, executes tools, or approves tasks,
- adds any permission, host access, network, or file access,
- re-executes any historical step,
- opens a page-facing channel, or
- stores prompts, conversations, file contents, secrets, or tool output.

## Validation

```bash
npm run ci
```

- 44 suites / 238 tests passing
- 0 runtime vulnerabilities
- 93.04% statements / 86.34% branches
- focus 100%, timeline 98.93%, testing 97.11% statements

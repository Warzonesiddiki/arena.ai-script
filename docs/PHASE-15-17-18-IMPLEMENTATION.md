# Phase 15, 17, and 18 Implementation — Simulation, Cost Attribution, and Knowledge Packs

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 9–20](20-PHASE-BLUEPRINT.md#phase-920-condensed-structure)

All three build on completed phases, add **no browser permission**, and perform no network or file access.

---

## Phase 15 — What-If Simulation and Strategy Comparison

`src/simulation/strategy-simulator.ts` answers *"what would happen if we ran it this way?"* **without running it**.

### Why the results are trustworthy

The simulator does not approximate the system — it drives the **real** deterministic components:

- `OrchestrationDashboardState` for lifecycle and dependency rules,
- `RiskPolicyEngine` for the Phase 11 policy pre-check,
- `AdvancedCostController` for the Phase 6D budget projection,
- `tierLimits` for Phase 6 concurrency caps.

So a simulation result is a statement about the shipped logic, not a guess about it.

### An honest limitation, stated in the output

> **Durations are relative units, not wall-clock predictions.** The simulator has no execution telemetry, so it deliberately refuses to imply it can forecast real time. `relativeDurationUnits` counts dependency-respecting dispatch waves under the tier's concurrency cap, and every projection carries a note saying so.

### What a projection reports

| Field | Meaning |
|---|---|
| `reachableTasks` | Tasks that could legitimately complete under this approval order |
| `stuckTasks` | Everything else, each with a specific reason |
| `totalCostUsd` | Cost of reachable work, honouring what-if overrides |
| `waveCount` | Dispatch waves at the tier's concurrency cap |
| `budgetStatus` / `withinBudget` | From the real cost controller |
| `risk` | Policy-blocked tasks, still-unapproved tasks, highest risk level |
| `feasible` | Reachable work exists, within budget, nothing policy-denied |

`stuckTasks` distinguishes *not approved by this strategy* from *dependencies never complete under this order* — the second is the interesting failure, and a test covers approving the Critic first.

A **policy denial makes a task structurally unreachable**, and its dependents unreachable too. A simulation can never show progress the policy engine would refuse.

`compare()` ranks deterministically — feasible first, then completion, cost, wave count, ID — and always reports `autoApplied: false`. A test asserts reordering the input does not change the recommendation.

---

## Phase 17 — Cost Attribution and Cross-Workflow Trends

`src/analytics/cost-attribution.ts` extends Phase 4E, which reports analytics for *one* workflow, by attributing spend to role and task across *many*. It answers: **where is the money going, and is it getting better or worse?**

### What it reports

| Output | Meaning |
|---|---|
| `roles` | Per-role total, share, task count, average, and **wasted** spend |
| `workflows` | Per-workflow total, budget ratio, over-budget flag, dominant role |
| `costliestTasks` | Most expensive tasks across every supplied workflow |
| `trend` | Newer half vs older half of the window |
| `recommendations` | Deterministic, threshold-driven guidance |

**"Waste" has a precise meaning here:** spend on tasks that ended `failed` or `blocked` — money with nothing to show for it. That is usually the most actionable number in the report.

### It refuses to invent a signal

With fewer than four workflows, a half-versus-half comparison is meaningless, so the trend reports `insufficient-data` with an explanation rather than producing a confident-looking number from two data points. A zero-spend earlier window returns a `null` ratio instead of dividing by zero.

Attribution is arithmetic, not inference: no model is consulted, and shares are asserted by test to sum to 1.

### Boundaries

Pure aggregation over records the caller already holds. It **adds no new telemetry channel**, persists nothing, and never touches the network. Bounded to the 100 most recent workflows with an explicit `truncated` flag.

---

## Phase 18 — Knowledge Distillation and Reusable Packs

`src/knowledge/knowledge-pack.ts` distills approved memory into a portable pack and imports packs back as candidates.

### The approval chain is never laundered

This is the module's central security property, enforced at three points:

1. **Distillation refuses unapproved memory.** A node without `approvedByHuman: true` throws rather than being silently dropped, so a caller cannot quietly widen what gets packaged.
2. **A pack cannot vouch for itself.** Imported candidates are rewritten to `source: { type: 'manual' }` — the original `approved-reflection` provenance is *not* carried across a trust boundary.
3. **Importing requires fresh approval.** `previewImport()` commits nothing; `approveCandidate()` demands a literal `true`.

A pack forged with `importApprovalRequired: false` or `provenance: 'trusted-vendor'` is rejected at parse time. Entries carrying `prompt`, `completion`, `conversation`, `apiKey`, `secret`, or `token` are rejected outright — a pack is not a smuggling channel.

### Distillation behaviour

Memories are deduplicated on normalised `kind:summary`, so whitespace and case variants of the same lesson collapse into one entry that records `mergedCount` and its `sourceIds`. Identical text under *different* kinds does not merge. Entries sort most-reinforced first. Bounds: 100 entries, 12 tags, 1 MB pack JSON.

Serialisation is plain in-process JSON. There is no file or network access anywhere in the module.

---

## A dead-code guard that earned its keep

The simulator originally imported the Phase 14 `AgentBehaviorHarness` to replay approval orders. That worked, and every test passed — but wiring the simulator into the worker would have pulled **test-only code into the production bundle**.

`module-reachability.test.ts` caught it immediately via its *stale exemption* check: the harness was listed as intentionally unbundled, and suddenly it was reachable. The fix was to drive `OrchestrationDashboardState` directly, which is both leaner and more honest about what the simulator actually depends on.

That is exactly the class of mistake the guard was written for.

---

## Safety boundaries

None of these modules:

- executes, approves, schedules, or persists anything,
- invokes a model or touches the network or file system,
- adds a permission or host access, or
- stores prompts, conversations, file contents, secrets, or tool output.

Both are wired into `InsightService` so they are reachable runtime code, not shelfware.

## Validation

```bash
npm run ci
```

- 53 suites / 322 tests passing
- 0 runtime vulnerabilities
- 93.69% statements / 87.77% branches
- simulation 96.89%, knowledge 96.29%, cost-attribution 97.47% statements

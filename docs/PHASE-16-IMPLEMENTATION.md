# Phase 16 Implementation — Self-Modification (Proposal Only)

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 16](20-PHASE-BLUEPRINT.md#phase-920-condensed-structure)

---

## Why this phase needed the hardest boundary in the project

"Agent proposes changes to its own configuration" is the sharpest possible test of *human approval by default*. A system that can adjust its own limits can, in principle, adjust its way out of them.

So `src/configuration/config-proposal.ts` draws the line in four places at once, and each is independently tested:

1. **Proposals are inert data.** `propose()` returns objects. Nothing is applied, written, or scheduled.
2. **Applying requires explicit approval and returns a new object.** `apply(config, proposal, true)` never mutates in place — a test asserts the original config is untouched.
3. **`apply()` re-validates from scratch.** It does not trust the proposal it is handed. A hand-forged proposal asking for a `$1,000` workflow budget is rejected against the declared bounds, so fabricating a proposal object gains an attacker nothing.
4. **The safety model is immutable and unproposable.** `requireHumanApproval`, `allowAutomaticExecution`, `allowArbitraryDom`, `allowNetworkEgress`, and `auditLogEnabled` can never be targeted. A config object that merely *carries* one of these keys is rejected outright.

No model is involved. Proposals are derived by fixed rules from health and cost-attribution data the system already has, so every suggestion is reproducible and auditable.

## What can be proposed, and within what bounds

| Setting | Bounds |
|---|---|
| `capabilityTier` | `phase3` or `phase6` only |
| `workflowBudgetUsd` | 0.01 – 10 |
| `agentBudgetUsd` | 0.01 – 5 |
| `stallTimeoutMs` | 30,000 – 600,000 |
| `budgetWarnRatio` | 0.5 – 0.95 |
| `maxTraceEvents` | 100 – 5,000 |
| `notificationVerbosity` | quiet / normal / verbose |

A proposal outside these bounds is never generated, and would be rejected on apply even if it were.

## Evidence rules

| Trigger | Proposal | Confidence |
|---|---|---|
| ≥ 2 stalled-task detections | Double the stall timeout (clamped) | medium |
| ≥ 50% of workflows over budget | Raise workflow budget to 1.5× average spend | high |
| ≥ 30% of spend wasted | Tighten the budget warn ratio | medium |
| Dominant role averaging above its budget | Raise per-agent budget to 1.2× that average | medium |
| ≥ 2 agent-capacity issues at Phase 3 | Raise the capability tier | **low** |

### Two deliberate asymmetries

**Expanding capability is treated with suspicion.** Raising the tier is the only proposal that *increases* what the system may do, so it needs repeated evidence, is always `low` confidence, and its reason text states plainly that it increases concurrency and cost.

**Restrictive proposals sort first.** If a human reads only one item, it should be the one that reduces risk, not the one that expands it.

## Staleness protection

A proposal records the `currentValue` it was computed against. If the setting changed in between, `apply()` refuses rather than silently overwriting a newer decision.

## Safety boundaries

This module does **not**:

- apply any change automatically,
- consult a model,
- add a permission, network, or file access,
- mutate any object in place, or
- expose any path to the immutable safety settings.

`reject()` exists so a declined proposal can be recorded for the audit trail without changing anything.

## Validation

```bash
npm run ci
```

- 55 suites / 343 tests passing
- 0 runtime vulnerabilities
- 93.67% statements overall; `config-proposal.ts` at 94.56%

Wired into `InsightService` so it is reachable runtime code, verified by the reachability guard.

# Phase 2E Implementation — Cost Governance Module

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint reference:** [Phase 2E](20-PHASE-BLUEPRINT.md#phase-2-ux-foundation--cost-governance)

## Deterministic budget engine

`src/governance/cost-governance.ts` is a deterministic, integer-microdollar accounting engine. It does not infer budgets or use an LLM to decide whether spending is allowed.

For every configured workflow it tracks:

- Actual workflow spend.
- Actual spend per agent within that workflow.
- Active estimated-cost reservations.
- Projected workflow/agent totals before an action starts.
- Remaining workflow budget.

`reserve()` is the hard gate: it refuses any estimate that would exceed either the workflow budget or its optional per-agent budget. `recordUsage()` reconciles actual known spend and releases its matching reservation. If an external provider reports an unexpected actual overage, the engine marks it immediately rather than hiding it; subsequent reservations remain blocked.

## Precision and safety

- USD values are converted to integer microdollars (`$1 = 1,000,000` units) before comparison, avoiding floating-point budget bypasses.
- Workflow/agent IDs, policy inputs, and reservation ownership are validated.
- Reservation IDs must match the workflow and agent during reconciliation.
- Every projection, reservation, block, and usage record emits an EventBus event for tracing/UI integration.
- No model invocation currently exists, so the engine makes no spend on its own. Phase 3 workers must obtain an allowed reservation before they run.

## Validation

Tests cover workflow and per-agent hard blocking, reservation reconciliation, unexpected overage visibility, deterministic remaining budget, missing policy/mismatched reservation failures, and invalid monetary input. Governance is included in the enforced coverage scope.

## Next Phase 2 work

The budget engine is ready for agent/workflow integration, but the remaining Phase 2 UX subphases remain intentionally separate:

- **2B:** Command Palette discovery/search.
- **2C:** grouped native notification routing.
- **2D:** full UI modal migration.

No multi-agent execution is enabled until all prerequisite safety, UI, and cost controls are integrated in Phase 3.

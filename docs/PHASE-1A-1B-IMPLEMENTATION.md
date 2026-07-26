# Phase 1A & 1B Implementation — Scoped DOM Observation and Timer Consolidation

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint references:** [Phase 1A and 1B](20-PHASE-BLUEPRINT.md#phase-1-stability--observability--rock-solid-base)

## Phase 1A — DOMObserver v2

`src/observability/dom-observer.ts` replaces the userscript-era broad observation pattern with a single `DomObserverV2` that:

- Requires a caller-provided, scoped root and explicitly rejects `document.body`.
- Observes only `childList`, `subtree`, and `characterData` changes below that root.
- Emits the documented `{ node, mutations, timestamp }` event via the ported EventBus.
- Ignores extension-owned nodes, scripts/styles/links, and caller-provided transient selectors.
- Provides pause/resume and explicit stop lifecycle control.
- Uses `findArenaRoot()` to locate `main`, `[role="main"]`, or `#main-content`; it returns `null` rather than falling back to a global scan.

The content bootstrap starts it only after the signed bridge is ready and only when a scoped Arena root exists. It does not create a second observer to wait for a missing root.

## Phase 1B — TickDispatcher consolidation

The ported `TickDispatcher` remains the sole repeating-timer owner for extension source. A regression test recursively scans `src/` and fails if:

- `setInterval()` is introduced outside `src/core/tick-dispatcher.ts`, or
- `new MutationObserver()` is introduced outside `src/observability/dom-observer.ts`.

This is a source-level guard for the v8 extension. The retained legacy v7.2 userscript is deliberately outside that migration boundary until its modules are ported.

## Validation

DOMObserver unit tests cover scoped emission, ownership/selector ignores, pause/resume, teardown, body rejection, and root discovery. The primitive-consolidation regression tests enforce the single timer/observer ownership boundaries. Both are included in the global coverage/test run.

## Next Phase 1 work

- **1C — Error Recovery:** central retry, fallback, and user-notification routing.
- **1D — Observability Core:** structured logs, trace correlation IDs, and trace exports; this will subscribe to DOMObserver events.
- **1E — Performance Tests:** strict mutation-rate and heap-sampling regression guards.

# Phase 0B & 0E Implementation — Core Runtime and Test Foundation

**Status:** Complete

**Implemented:** 2026-07-26

**Blueprint references:** [0B and 0E in the 20-Phase Blueprint](20-PHASE-BLUEPRINT.md#phase-0-genesis--extension-foundation)

## Scope delivered

Phase 0B ports the four v7.2 architectural primitives into independently importable TypeScript modules. Phase 0E then supplies the test runner, Chrome API mock, coverage guard, and continuous-integration command required to make those ports safe to evolve.

| Blueprint item | Delivered artifact | Behavior preserved / strengthened |
|---|---|---|
| `ModuleRegistry` | `src/core/module-registry.ts` | Phase-based registration, deterministic boot order, error isolation, module status/error lookup, dependency diagnostics, and reverse-order teardown |
| `EventBus v2` | `src/core/event-bus.ts` | Exact events, `*` and `namespace:*` wildcards, priorities, one-shot subscriptions, sync and async emission, listener error isolation, and event counters |
| `TickDispatcher` | `src/core/tick-dispatcher.ts` | Named ticks dispatched from one central repeating timer, interval scheduling, fault isolation, and lifecycle control |
| `buildModal()` | `src/core/modal.ts` | Replacement by ID, v7.2 class names/layout, optional footer/width/style, backdrop and close-button behavior; title now uses `textContent` |
| Jest + coverage | `jest.config.cjs`, `tsconfig.test.json`, `tests/unit/` | Jest 30 + ts-jest, jsdom DOM tests, a coverage floor of 80% for the ported foundation modules |
| Chrome test utility | `tests/support/chrome-mock.ts` | Small explicit mock of only the Chrome APIs currently used, plus a service-worker lifecycle/message test |
| CI command | `npm run ci` | Runs runtime dependency audit and the full test suite; a hosted workflow is deferred until workflow-write credentials are available |

## Porting decisions

### EventBus v2

The EventBus keeps v7.2's non-blocking `emit()` behavior: promise-returning handlers are not awaited and rejected promises are reported without stopping other listeners. `emitAsync()` is available when a caller deliberately needs sequential, priority-ordered work.

One legacy edge case was corrected: a one-shot emission now removes only the executed listener rather than every one-shot listener sharing the event pattern. This is a bug fix with no intended user-visible incompatibility.

### ModuleRegistry and MV3 lifecycle

`boot()` is asynchronous because a Manifest V3 service worker and future storage initialization can be asynchronous. It still initializes modules in phase order and does not allow a module failure to prevent the rest of the extension from starting. The registry does not retain product state in the service worker; Phase 0D remains responsible for persistence.

### TickDispatcher ownership

The dispatcher is the only infrastructure component that owns a repeating timer. It accepts an injectable scheduler so timing behavior is tested deterministically without browser-clock sleeps. Phase 1B will migrate all future extension timers through this dispatcher and add runtime enforcement/telemetry.

### Modal trust boundary

The legacy helper accepts HTML template strings. The port intentionally limits those strings to extension-owned templates and documents that page-derived text must be inserted through DOM APIs and `textContent`. The modal title itself is now rendered with `textContent`, avoiding a legacy title-injection path. Phase 2D will migrate extension UI to this helper and consolidate styling.

## Test and CI policy

```bash
npm run typecheck
npm run test:unit
npm run build
npm test
```

- `test:unit` executes the Jest suite with coverage. The current enforced baseline is **80%** across statements, branches, functions, and lines for the ported core and service-worker code.
- `test:extension` runs the production build and validates the generated MV3 manifest/artifacts.
- `test:legacy` retains syntax, smoke, tool-loop, and pause/resume regression tests for the v7.2 userscript during the migration.
- `npm run ci` runs `npm audit --omit=dev` and `npm test`; it is ready for a Node 20/22 hosted runner once workflow-write credentials are available.

The audit intentionally targets runtime dependencies. Test-tool dependency advisories do not affect the shipped extension bundle; they are monitored as part of regular dependency maintenance and must not be copied into runtime dependencies.

## Acceptance evidence

- Strict TypeScript check passes.
- Jest unit suite passes with at least 80% coverage on the ported foundation code.
- Production extension build and manifest-artifact validation pass.
- Legacy userscript regression suite passes.

## Subsequent Phase 0 work

The independently delivered follow-on implementation records are:

| Subphase | Status | Record |
|---|---|---|
| **0C — Content Bridge** | Complete | [`PHASE-0C-IMPLEMENTATION.md`](PHASE-0C-IMPLEMENTATION.md) |
| **0D — Storage Layer v1** | Complete | [`PHASE-0D-IMPLEMENTATION.md`](PHASE-0D-IMPLEMENTATION.md) |

Phase 0 still deliberately exposes no full Arena conversation data, arbitrary page command channel, or agent state. The Content Bridge allows only its documented bounded operations.

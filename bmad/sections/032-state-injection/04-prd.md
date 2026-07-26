# Section 032: State Injection (Debug Tool) — Step 4: PRD

## Requirements
1. `StateInjection` must initialize without throwing during `ModuleRegistry.boot()`.
2. Its public API (below) must behave as documented.
3. Any config keys it reads must have sane defaults in `CONFIG_SCHEMA`.

## Public API (acceptance surface)
- `inject(key, value) — sets S[key] if it exists, emits state:injected`
- `injectBatch(obj)`
- `reset(key) — restores a key to its original default via State.getInitial(key)`
- `listInjected() — lists all current non-function state keys`

## Acceptance Criteria
- [x] `node --check arena-agent-mode-pro.user.js` passes
- [x] `npm test` (jsdom boot harness) shows this module in the "ready" set, not "errored"
- [x] Manual DOM-activity simulation (see `tests/smoke.js` / `tests/regression-toolcall-loop.js`)
      does not surface exceptions attributable to this module

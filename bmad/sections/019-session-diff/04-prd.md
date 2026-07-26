# Section 019: Session Diff & Comparison — Step 4: PRD

## Requirements
1. `SessionDiff` must initialize without throwing during `ModuleRegistry.boot()`.
2. Its public API (below) must behave as documented.
3. Any config keys it reads must have sane defaults in `CONFIG_SCHEMA`.

## Public API (acceptance surface)
- `open()/close()/toggle() — panel visibility`
- `openWithSession(id) — pre-select a session to diff against the live one`
- `computeDiff(a, b) — returns {a, b, msgDiff, regressions}`

## Acceptance Criteria
- [x] `node --check arena-agent-mode-pro.user.js` passes
- [x] `npm test` (jsdom boot harness) shows this module in the "ready" set, not "errored"
- [x] Manual DOM-activity simulation (see `tests/smoke.js` / `tests/regression-toolcall-loop.js`)
      does not surface exceptions attributable to this module

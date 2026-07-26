# Section 007: DOM Observer & Agent Detector — Step 4: PRD

## Requirements
1. `DOMObserver` must initialize without throwing during `ModuleRegistry.boot()`.
2. Its public API (below) must behave as documented.
3. Any config keys it reads must have sane defaults in `CONFIG_SCHEMA`.

## Public API (acceptance surface)
- `init() — starts observeMain()/observeRoute(), runs detectAgentMode(), starts the 10s polling interval`
- `destroy() — disconnects both observers and flushes any pending tool timing`
- `detectAgentMode() — URL/DOM heuristic Agent Mode detection, starts a session on first detection`
- `startSession() — resets session counters and generates a new session id`

## Acceptance Criteria
- [x] `node --check arena-agent-mode-pro.user.js` passes
- [x] `npm test` (jsdom boot harness) shows this module in the "ready" set, not "errored"
- [x] Manual DOM-activity simulation (see `tests/smoke.js` / `tests/regression-toolcall-loop.js`)
      does not surface exceptions attributable to this module

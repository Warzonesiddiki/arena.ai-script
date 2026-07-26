# Section 019: Session Diff & Comparison — Step 10: Dev Story

## Implementation Summary
Side-by-side comparison of two saved (or live) sessions: turns/tool calls/errors/duration/token deltas, message-set diffing, and simple regression detection (more errors in B than A).

## Public API
- `open()/close()/toggle() — panel visibility`
- `openWithSession(id) — pre-select a session to diff against the live one`
- `computeDiff(a, b) — returns {a, b, msgDiff, regressions}`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 REWRITE:** previously a static panel that always displayed the hardcoded string 'No previous session to compare' regardless of how many sessions existed — it never actually diffed anything. Rewrote to load real sessions via `StorageEngine.getAllSessions()`, let the user pick two sessions from dropdowns (including the live/current session), and render a real metric table + message-set diff + regression flag. Added a Command Palette entry.

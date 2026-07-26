# Section 008: HUD Widget — Step 10: Dev Story

## Implementation Summary
Fixed-position heads-up display showing live session stats: elapsed time, turn count, tool calls, token estimate, error count, and working/idle status.

## Public API
- `build() — creates and mounts the HUD element`
- `update() — refreshes displayed values from the state store`
- `setVisible(bool) — show/hide the HUD`
- `setPosition(pos) — bottom-right/top-right/bottom-left/top-left`
- `formatDuration(seconds) / formatTokens(n) — display formatting helpers`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- No functional defects found in this section.

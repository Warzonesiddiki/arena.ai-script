# Section 008: HUD

## Status: ✅ COMPLETE (No changes needed)
HUD is solid — session timer, turn count, tool calls, token estimates, error count, working status.

## API
- `build()` — creates HUD element
- `update()` — refreshes display from S (state store)
- `setVisible(bool)` — show/hide
- `setPosition(pos)` — bottom-right, top-right, bottom-left
- Formatting: `formatDuration()`, `formatTokens()`

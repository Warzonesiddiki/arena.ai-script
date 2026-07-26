# Section 004: Event Bus — Implementation

## Changes Applied

### New Functions
- `_match(pattern, event)` — wildcard matching engine
- `emitAsync(event, data)` — async dispatch with await
- `getStats(event?)` — single or all-event emit counts
- `resetStats()` — clear all counters

### Modified Functions
- `on()` — added `priority` to handler registration (default 0)
- `off()` — auto-deletes event key when handler array empties
- `emit()` — collects handlers from all matching keys (not just exact), sorts by priority, handles once cleanup across matched keys

### Backward Compatibility
- All existing calls work unchanged
- `priority` defaults to 0 (same behavior as before)
- `once` still auto-removes after first emission

### File Impact
- **File:** arena-agent-mode-pro.user.js
- **Lines affected:** ~583-630
- **Syntax:** PASS

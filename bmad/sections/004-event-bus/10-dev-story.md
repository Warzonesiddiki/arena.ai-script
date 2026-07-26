# Section 004: Event Bus — Step 10: Dev Story

## Implementation Summary
Upgraded EventBus with wildcard pattern matching, priority-sorted dispatch, async support, and emit statistics.

## Changes
| Feature | Before | After |
|---------|--------|-------|
| Event matching | Exact only | Exact + `*` + `prefix:*` |
| Handler ordering | Insertion order | Priority-sorted (desc) |
| Async handlers | Unsupported | Detected via Promise + `.catch()` |
| `emitAsync()` | No | Yes — sequential await |
| Per-event stats | No | Counter per event + getStats/resetStats |
| Empty key cleanup | No | Auto-delete in `off()` |

# Section 004: Event Bus — Epics

## Epic 1: Wildcard Event Matching
- Implement `_match(pattern, event)` engine
- Support `*`, `prefix:*`, and exact match
- `emit()` iterates all listener keys, collects all matching handlers

## Epic 2: Priority Ordering
- Add `priority` to handler registration
- Sort handlers descending before dispatch
- Backward compatible — default priority 0 for existing subscriptions

## Epic 3: Async & Stats
- `emitAsync()` for awaitable dispatch
- `getStats()` / `resetStats()` for monitoring
- Auto-cleanup empty event keys in `off()`

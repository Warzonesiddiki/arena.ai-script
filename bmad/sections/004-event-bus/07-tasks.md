# Section 004: Event Bus — Tasks

## Implementation Tasks

1. Add `_match(pattern, event)` helper function
2. Add `priority` field to handler objects in `on()`
3. In `emit()`, iterate all listener keys instead of just the exact event
4. Collect all matching handlers, sort by priority desc
5. Track `once` removals by key, deduplicate with Set
6. Add `emitAsync()` — await handlers sequentially with error catch
7. Add `stats` counter incremented on each emit
8. Add `getStats(event?)` and `resetStats()` public methods
9. Auto-delete event key in `off()` when array becomes empty
10. Update ModuleRegistry registration message

# Section 003: Reactive State Store — Epics

## Epic 1: Computed State
- Implement `compute()` with dependency tracking
- Auto-recalculate on dep change via watcher
- Expose as read-only property on store

## Epic 2: History & Diagnostics
- Snapshot state on every mutation
- Expose `getHistory()` and `exportState()`/`importState()`
- Enable `state:reset` event on reset

## Epic 3: Batch Operations
- `batch()` for atomic multi-key update
- Single history entry per batch
- Single `state:batch` event emission

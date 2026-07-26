# Section 003: Reactive State Store — Brainstorming

## Problem
Current `State` module is a basic Proxy-based store with watchers — no computed values, no history tracking, no batch updates, no state reset/export/import capabilities.

## Ideas
- **Computed values** — Derived state that auto-recalculates when dependencies change (e.g., `sessionActive = isAgentMode && !!currentSessionId`)
- **History snapshots** — Track every change with timestamp for undo/debug
- **Batch updates** — Multiple key changes in one transaction with a single event
- **State reset** — Restore all keys to initial values (for session cleanup)
- **Export/Import** — JSON serialization for session save/restore
- **Change log** — Expose recent state changes for diagnostics

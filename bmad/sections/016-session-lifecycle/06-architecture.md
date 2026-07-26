# Section 016: Session Lifecycle — Step 6: Architecture

## Module
`DOMObserver.startSession / SessionRecovery` — IIFE, boot phase 0/3, ModuleRegistry deps: `storageEngine`

## Data Flow
- `session:start`

## v7.1 Bugfix Pass Note
**v7.1 FIX:** session elapsed-time tracking and DOM-based counters now correctly pause while `SessionFreeze.isFrozen()` is true (previously SessionFreeze didn't actually affect lifecycle tracking at all).

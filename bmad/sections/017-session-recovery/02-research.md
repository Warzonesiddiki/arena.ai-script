# Section 017: Session Recovery — Step 2: Research

## Current Implementation
- **Module:** `SessionRecovery`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `storageEngine`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Persists the last active session to GM storage and offers to restore it on page reload if under 24h old.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `localHistory (boolean, gates StorageEngine)`

# Section 016: Session Lifecycle — Step 2: Research

## Current Implementation
- **Module:** `DOMObserver.startSession / SessionRecovery`
- **Boot phase:** 0/3
- **Dependencies declared to ModuleRegistry:** `storageEngine`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Start/detect/persist lifecycle for an agent session: begins on Agent Mode detection, autosaves periodically and on unload, restores on reload within 24h.

## Events
- `session:start`

## Configuration surface
- `autoSaveSession (boolean)`
- `localHistory (boolean)`

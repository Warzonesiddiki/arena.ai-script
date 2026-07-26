# Section 027: Auto-Save Prompts & History — Step 2: Research

## Current Implementation
- **Module:** `boot init() beforeunload/pagehide handlers`
- **Boot phase:** n/a
- **Dependencies declared to ModuleRegistry:** `storageEngine`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Saves the current session snapshot (turns, tool calls, tokens, errors, messages, agent steps) to GM storage whenever the tab is about to unload, so SessionRecovery can offer to restore it next visit.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `autoSaveSession (boolean)`
- `maxHistoryItems (number, 10-1000)`

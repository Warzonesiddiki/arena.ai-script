# Section 030: Session Freeze — Step 2: Research

## Current Implementation
- **Module:** `SessionFreeze`
- **Boot phase:** 4
- **Dependencies declared to ModuleRegistry:** `state`, `commandPalette`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Pauses AAMP's own tracking (turn/tool/error/token counters and the session timer) so a session can be inspected mid-run without its stats moving; does not pause the underlying page itself.

## Events
- `state:frozen`
- `state:resumed`

## Configuration surface
- (no dedicated config keys)

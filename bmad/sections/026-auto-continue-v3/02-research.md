# Section 026: Auto-Continue Engine — Step 2: Research

## Current Implementation
- **Module:** `MonitorModule.setupAutoContinue`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `config`, `eventBus`, `state`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Detects a 'Continue' button in the DOM and auto-clicks it after a configurable delay, to keep long agent runs going without manual intervention.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `autoContinue (boolean)`
- `autoContinueDelay (number, 500-10000ms)`

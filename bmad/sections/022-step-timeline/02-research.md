# Section 022: Agent Step Timeline — Step 2: Research

## Current Implementation
- **Module:** `ToolTimeline`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Rolling timeline of the last 50 tool calls/responses with timestamps.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `toolTimeline (boolean)`

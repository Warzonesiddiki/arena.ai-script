# Section 019: Session Diff & Comparison — Step 2: Research

## Current Implementation
- **Module:** `SessionDiff`
- **Boot phase:** 4
- **Dependencies declared to ModuleRegistry:** `state`, `storageEngine`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Side-by-side comparison of two saved (or live) sessions: turns/tool calls/errors/duration/token deltas, message-set diffing, and simple regression detection (more errors in B than A).

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- (no dedicated config keys)

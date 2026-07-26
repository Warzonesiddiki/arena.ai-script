# Section 018: Session Scoring — Step 2: Research

## Current Implementation
- **Module:** `PerformanceAnalytics.computeAnalytics`
- **Boot phase:** 4
- **Dependencies declared to ModuleRegistry:** `state`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Computes a simple efficiency score and metric bundle (turns, tool calls, errors, duration, tokens) for the current session.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `performanceScore (boolean)`

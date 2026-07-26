# Section 008: HUD Widget — Step 2: Research

## Current Implementation
- **Module:** `HUD`
- **Boot phase:** 1
- **Dependencies declared to ModuleRegistry:** `config`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Fixed-position heads-up display showing live session stats: elapsed time, turn count, tool calls, token estimate, error count, and working/idle status.

## Events
- `Reacts to state:* changes via State.watch() to trigger re-renders`

## Configuration surface
- `hudEnabled (boolean)`
- `hudPosition (enum)`
- `sessionTimer (boolean)`
- `showTurnCount (boolean)`

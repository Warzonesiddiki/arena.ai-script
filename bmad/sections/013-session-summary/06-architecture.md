# Section 013: Session Summary Modal — Step 6: Architecture

## Module
`AgentToolbar.generateSessionSummary` — IIFE, boot phase 4, ModuleRegistry deps: `state`, `exportEngine`

## Data Flow
- `Reads from AgentToolTracker.getStats() (now populated correctly since v7.1's agent:toolTracked fix)`

## v7.1 Bugfix Pass Note
**v7.1 FIX (indirect):** the tool-type breakdown in this summary reads `AgentToolTracker.getStats()`, which was always empty before v7.1 because the `agent:toolTracked` event it listens for was never emitted. It now reflects real per-type tool counts.

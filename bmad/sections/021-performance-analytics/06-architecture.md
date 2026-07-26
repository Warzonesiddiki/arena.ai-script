# Section 021: Performance Analytics Dashboard — Step 6: Architecture

## Module
`PerformanceAnalytics` — IIFE, boot phase 4, ModuleRegistry deps: `state`

## Data Flow
- (none — this section doesn't emit its own events)

## v7.1 Bugfix Pass Note
**v7.1 FIX:** this panel (like Dashboard/Diff/History/Playback) had no CSS rule tying `.open` to visibility, so once opened it could never be closed via the ✕ button or backdrop click. Fixed with a shared CSS rule.

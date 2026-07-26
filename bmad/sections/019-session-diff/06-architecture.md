# Section 019: Session Diff & Comparison — Step 6: Architecture

## Module
`SessionDiff` — IIFE, boot phase 4, ModuleRegistry deps: `state`, `storageEngine`

## Data Flow
- (none — this section doesn't emit its own events)

## v7.1 Bugfix Pass Note
**v7.1 REWRITE:** previously a static panel that always displayed the hardcoded string 'No previous session to compare' regardless of how many sessions existed — it never actually diffed anything. Rewrote to load real sessions via `StorageEngine.getAllSessions()`, let the user pick two sessions from dropdowns (including the live/current session), and render a real metric table + message-set diff + regression flag. Added a Command Palette entry.

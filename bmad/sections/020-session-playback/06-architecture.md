# Section 020: Session Playback / Replay — Step 6: Architecture

## Module
`SessionPlayback` — IIFE, boot phase 4, ModuleRegistry deps: `storageEngine`, `commandPalette`

## Data Flow
- `playback:start`
- `playback:pause`
- `playback:resume`
- `playback:end`

## v7.1 Bugfix Pass Note
**v7.1 REWRITE:** previously a pure stub — `play()` just set a flag and logged to console with no actual replay, no UI, and it was never registered with ModuleRegistry (so even that no-op init() never ran). Rewrote with a real modal, message-by-message rendering, pause/resume, a speed selector, and registered it as a module with a Command Palette entry.

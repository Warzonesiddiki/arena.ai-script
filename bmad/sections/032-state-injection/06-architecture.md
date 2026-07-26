# Section 032: State Injection (Debug Tool) — Step 6: Architecture

## Module
`StateInjection` — IIFE, boot phase 4, ModuleRegistry deps: `state`, `commandPalette`

## Data Flow
- `state:injected`

## v7.1 Bugfix Pass Note
**v7.1 FIX:** `reset(key)` previously called `S._initial?.[key]`, but `_initial` is a private closure variable inside the `State` module — it was never exposed on the `store` proxy (`S`), so `S._initial` was always `undefined` and `reset()` always injected `undefined` regardless of key. Added `State.getInitial(key)` as a proper public API and fixed `reset()` to use it. Also registered the module (it was never wired to ModuleRegistry before) and added a Command Palette entry with prompt-based key/value input for manual testing.

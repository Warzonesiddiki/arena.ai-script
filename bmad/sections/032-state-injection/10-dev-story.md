# Section 032: State Injection (Debug Tool) — Step 10: Dev Story

## Implementation Summary
Developer/debug utility for manually overriding a state-store value at runtime, useful for testing UI states without needing to reproduce them via real agent activity.

## Public API
- `inject(key, value) — sets S[key] if it exists, emits state:injected`
- `injectBatch(obj)`
- `reset(key) — restores a key to its original default via State.getInitial(key)`
- `listInjected() — lists all current non-function state keys`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 FIX:** `reset(key)` previously called `S._initial?.[key]`, but `_initial` is a private closure variable inside the `State` module — it was never exposed on the `store` proxy (`S`), so `S._initial` was always `undefined` and `reset()` always injected `undefined` regardless of key. Added `State.getInitial(key)` as a proper public API and fixed `reset()` to use it. Also registered the module (it was never wired to ModuleRegistry before) and added a Command Palette entry with prompt-based key/value input for manual testing.

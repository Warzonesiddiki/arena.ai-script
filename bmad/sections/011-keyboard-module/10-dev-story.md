# Section 011: Keyboard Module — Step 10: Dev Story

## Implementation Summary
Context-aware global keyboard shortcut system: registers combos, ignores shortcuts while typing in inputs (except Ctrl-combos), supports a help listing.

## Public API
- `init() — registers default shortcuts (Ctrl+K, Ctrl+E, Ctrl+B, Ctrl+/, Esc, j/k) and the keydown listener`
- `register(combo, description, handler) — add a custom shortcut`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 FIX:** `KeyboardModule.init()` was previously called twice per page load — once directly in the boot `init()` and again via `ModuleRegistry.register('keyboardModule', ...)` — which registered every shortcut's `document.addEventListener('keydown', ...)` twice, causing every shortcut action (e.g. Ctrl+B focus mode) to fire twice per keypress. Fixed by removing the duplicate direct call.

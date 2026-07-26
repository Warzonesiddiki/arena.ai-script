# Section 011: Keyboard Module — DONE

## Status: ✅ COMPLETE (fixed in v7.1 bugfix pass)

### Summary
Context-aware global keyboard shortcut system: registers combos, ignores shortcuts while typing in inputs (except Ctrl-combos), supports a help listing.

### Prior documentation status (before this backfill)
> IMPLEMENTED (full) — later found to double-register its keydown listener

### v7.1 fix applied
**v7.1 FIX:** `KeyboardModule.init()` was previously called twice per page load — once directly in the boot `init()` and again via `ModuleRegistry.register('keyboardModule', ...)` — which registered every shortcut's `document.addEventListener('keydown', ...)` twice, causing every shortcut action (e.g. Ctrl+B focus mode) to fire twice per keypress. Fixed by removing the duplicate direct call.

### Verification
- **Syntax:** PASS (`node --check`)
- **Runtime:** PASS (`tests/smoke.js` jsdom boot harness, module reaches 'ready' state)

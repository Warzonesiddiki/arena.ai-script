# Section 032: State Injection (Debug Tool) — DONE

## Status: ✅ COMPLETE (fixed in v7.1 bugfix pass)

### Summary
Developer/debug utility for manually overriding a state-store value at runtime, useful for testing UI states without needing to reproduce them via real agent activity.

### Prior documentation status (before this backfill)
> STUB — needs implementation (partially accurate — API existed but reset() was silently broken)

### v7.1 fix applied
**v7.1 FIX:** `reset(key)` previously called `S._initial?.[key]`, but `_initial` is a private closure variable inside the `State` module — it was never exposed on the `store` proxy (`S`), so `S._initial` was always `undefined` and `reset()` always injected `undefined` regardless of key. Added `State.getInitial(key)` as a proper public API and fixed `reset()` to use it. Also registered the module (it was never wired to ModuleRegistry before) and added a Command Palette entry with prompt-based key/value input for manual testing.

### Verification
- **Syntax:** PASS (`node --check`)
- **Runtime:** PASS (`tests/smoke.js` jsdom boot harness, module reaches 'ready' state)

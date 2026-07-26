# Section 027: Auto-Save Prompts & History — DONE

## Status: ✅ COMPLETE

### Summary
Saves the current session snapshot (turns, tool calls, tokens, errors, messages, agent steps) to GM storage whenever the tab is about to unload, so SessionRecovery can offer to restore it next visit.

### Prior documentation status (before this backfill)
> IMPLEMENTED (via boot sequence)

### Verification
- **Syntax:** PASS (`node --check`)
- **Runtime:** PASS (`tests/smoke.js` jsdom boot harness, module reaches 'ready' state)

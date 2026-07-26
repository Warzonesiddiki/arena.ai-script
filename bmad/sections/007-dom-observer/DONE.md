# Section 007: DOM Observer & Agent Detector — DONE

## Status: ✅ COMPLETE (fixed in v7.1 bugfix pass)

### Summary
Core sensing layer: watches the page via MutationObserver, detects Agent Mode, classifies new DOM nodes (tool calls, code blocks, thinking indicators, responses, errors), and drives session lifecycle + tool timing.

### Prior documentation status (before this backfill)
> COMPLETE (No changes needed) — later found to contain a critical infinite-loop bug, see v7.1 note

### v7.1 fix applied
**v7.1 CRITICAL FIX:** `analyzeAddedNode()` previously mis-detected AAMP's own tool-call wrapper elements as new tool calls, causing an infinite MutationObserver loop that froze the tab. Fixed by excluding AAMP's own injected UI and already-wrapped nodes from analysis. Also added real `agent:toolTracked` emission (with elapsed time + classification) via a `_pendingTool` tracker, since the event was listened to in 3 places but never emitted before.

### Verification
- **Syntax:** PASS (`node --check`)
- **Runtime:** PASS (`tests/smoke.js` jsdom boot harness, module reaches 'ready' state)

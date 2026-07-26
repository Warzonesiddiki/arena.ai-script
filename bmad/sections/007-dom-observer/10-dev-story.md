# Section 007: DOM Observer & Agent Detector — Step 10: Dev Story

## Implementation Summary
Core sensing layer: watches the page via MutationObserver, detects Agent Mode, classifies new DOM nodes (tool calls, code blocks, thinking indicators, responses, errors), and drives session lifecycle + tool timing.

## Public API
- `init() — starts observeMain()/observeRoute(), runs detectAgentMode(), starts the 10s polling interval`
- `destroy() — disconnects both observers and flushes any pending tool timing`
- `detectAgentMode() — URL/DOM heuristic Agent Mode detection, starts a session on first detection`
- `startSession() — resets session counters and generates a new session id`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 CRITICAL FIX:** `analyzeAddedNode()` previously mis-detected AAMP's own tool-call wrapper elements as new tool calls, causing an infinite MutationObserver loop that froze the tab. Fixed by excluding AAMP's own injected UI and already-wrapped nodes from analysis. Also added real `agent:toolTracked` emission (with elapsed time + classification) via a `_pendingTool` tracker, since the event was listened to in 3 places but never emitted before.

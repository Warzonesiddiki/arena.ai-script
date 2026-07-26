# Section 007: DOM Observer & Agent Detector — Step 6: Architecture

## Module
`DOMObserver` — IIFE, boot phase 0, ModuleRegistry deps: `state`, `eventBus`

## Data Flow
- `route:change`
- `dom:mutation`
- `agent:toolCall`
- `agent:thinking`
- `agent:response`
- `agent:error`
- `agent:toolTracked (added in v7.1 — was previously never emitted)`
- `messages:updated`

## v7.1 Bugfix Pass Note
**v7.1 CRITICAL FIX:** `analyzeAddedNode()` previously mis-detected AAMP's own tool-call wrapper elements as new tool calls, causing an infinite MutationObserver loop that froze the tab. Fixed by excluding AAMP's own injected UI and already-wrapped nodes from analysis. Also added real `agent:toolTracked` emission (with elapsed time + classification) via a `_pendingTool` tracker, since the event was listened to in 3 places but never emitted before.

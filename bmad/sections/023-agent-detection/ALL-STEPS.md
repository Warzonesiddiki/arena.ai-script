# Section 023: Agent Detection — BMAD

## Step 1-11 Summary
- **Status:** ✅ IMPLEMENTED (via DOMObserver)
- **Module:** `DOMObserver` at line ~778
- **Features:** MutationObserver on chat container, detects agent mode via URL + DOM patterns
- **Events:** `route:change`, `dom:mutation`, `agent:toolCall`, `agent:thinking`, `agent:response`, `agent:error`, `messages:updated`
- **API:** `init()`, `detectAgentMode()`, `findSC()`, `processAllCodeBlocks()`, `processAllToolCalls()`
- **BMAD:** All 11 steps complete
# Section 024: Tool Tracker — BMAD

## Step 1-11 Summary
- **Status:** ✅ IMPLEMENTED (via AgentToolTracker)
- **Module:** `AgentToolTracker` at line ~2491
- **Features:** Tracks tool calls by type, counts, timing; emits `agent:toolTracked` event
- **API:** `track(tool)`, `getStats()`, `reset()`, `getAvgMs()`
- **Events:** Emits `agent:toolCall`, `agent:toolTracked`
- **BMAD:** All 11 steps complete
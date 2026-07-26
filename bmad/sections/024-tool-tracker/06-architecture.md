# Section 024: Agent Tool Tracker — Step 6: Architecture

## Module
`AgentToolTracker` — IIFE, boot phase 4, ModuleRegistry deps: `eventBus`

## Data Flow
- `Consumes agent:toolTracked`

## v7.1 Bugfix Pass Note
**v7.1 CRITICAL FIX:** `agent:toolTracked` was never emitted anywhere in the codebase prior to v7.1 — this module's `getStats()` always returned `{}` despite being marked '✅ IMPLEMENTED'. `DOMObserver` now tracks pending tool calls and emits `agent:toolTracked` with real elapsed time and a classified tool type (`classifyToolNode()`) when each tool call completes.

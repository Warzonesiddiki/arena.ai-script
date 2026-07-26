# Section 004: Event Bus — Brainstorming

## Problem
Current `EventBus` is basic — no priority ordering, no wildcard matching, no async support, no stats.

## Ideas
- **Priorities** — Higher priority handlers fire first for critical listeners
- **Wildcards** — `state:*` matches `state:isAgentMode`, `state:sessionStart`, etc.
- **Async emit** — Promise-aware emission for async handlers
- **Stats** — Track emit counts per event for debugging
- **Cleanup on no handlers** — Auto-delete event key when last handler removed

# Section 027: Auto-Save Prompts & History — Step 10: Dev Story

## Implementation Summary
Saves the current session snapshot (turns, tool calls, tokens, errors, messages, agent steps) to GM storage whenever the tab is about to unload, so SessionRecovery can offer to restore it next visit.

## Public API
- (inline in boot init(), not a standalone module)

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- No functional defects found in this section.

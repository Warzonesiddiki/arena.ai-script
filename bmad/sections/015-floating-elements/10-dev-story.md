# Section 015: Floating Elements (TOC + HUD) — Step 10: Dev Story

## Implementation Summary
Shared floating-panel behavior for draggable/persistent overlay widgets: the table-of-contents sidebar and the HUD.

## Public API
- `FloatingTOC.init()/update()/toggle()`
- `HUD.build()/setPosition()`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- No functional defects found in this section.

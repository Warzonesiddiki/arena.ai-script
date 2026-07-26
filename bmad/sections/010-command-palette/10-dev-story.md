# Section 010: Command Palette — Step 10: Dev Story

## Implementation Summary
Ctrl+K fuzzy-searchable command launcher used as the central integration point for nearly every other module's actions (workspace, artifacts, export, diagnostics, etc).

## Public API
- `addCommand({icon,label,tags,action}) — registers a new palette entry`
- `open()/close()/toggle()/isOpen() — visibility controls`
- `init() — logs boot (added in v7.1; palette itself was already functional, but it was never registered with ModuleRegistry before v7.1, so this init() never actually ran)`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 FIX:** `CommandPalette` had no `init()` function at all, so `ModuleRegistry.register('commandPalette', {init(){CommandPalette.init()}})` threw `TypeError: CommandPalette.init is not a function` on every boot, meaning the module was marked 'errored' by ModuleRegistry (though the palette still worked because it was also wired directly via the keyboard shortcut). Added a proper `init()`.

# Section 011: Keyboard Module — Step 2: Research

## Current Implementation
- **Module:** `KeyboardModule`
- **Boot phase:** 2
- **Dependencies declared to ModuleRegistry:** `config`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Context-aware global keyboard shortcut system: registers combos, ignores shortcuts while typing in inputs (except Ctrl-combos), supports a help listing.

## Events
- `None emitted; drives other modules by calling their toggle/action methods directly`

## Configuration surface
- `shortcutsEnabled (boolean)`
- `cmdPaletteKey/exportKey/focusModeKey/helpKey (string, rebind targets — not yet wired into buildCombo(), tracked as a future enhancement)`

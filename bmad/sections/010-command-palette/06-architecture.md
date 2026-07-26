# Section 010: Command Palette — Step 6: Architecture

## Module
`CommandPalette` — IIFE, boot phase 2, ModuleRegistry deps: `config`

## Data Flow
- `None emitted directly; executes registered command actions on selection`

## v7.1 Bugfix Pass Note
**v7.1 FIX:** `CommandPalette` had no `init()` function at all, so `ModuleRegistry.register('commandPalette', {init(){CommandPalette.init()}})` threw `TypeError: CommandPalette.init is not a function` on every boot, meaning the module was marked 'errored' by ModuleRegistry (though the palette still worked because it was also wired directly via the keyboard shortcut). Added a proper `init()`.

# Section 011: Keyboard Module — Step 6: Architecture

## Module
`KeyboardModule` — IIFE, boot phase 2, ModuleRegistry deps: `config`

## Data Flow
- `None emitted; drives other modules by calling their toggle/action methods directly`

## v7.1 Bugfix Pass Note
**v7.1 FIX:** `KeyboardModule.init()` was previously called twice per page load — once directly in the boot `init()` and again via `ModuleRegistry.register('keyboardModule', ...)` — which registered every shortcut's `document.addEventListener('keydown', ...)` twice, causing every shortcut action (e.g. Ctrl+B focus mode) to fire twice per keypress. Fixed by removing the duplicate direct call.

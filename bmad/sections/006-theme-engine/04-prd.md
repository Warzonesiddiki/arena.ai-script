# Section 006: Theme Engine — Step 4: PRD

## Requirements
1. `ThemeEngine` must initialize without throwing during `ModuleRegistry.boot()`.
2. Its public API (below) must behave as documented.
3. Any config keys it reads must have sane defaults in `CONFIG_SCHEMA`.

## Public API (acceptance surface)
- `applyTheme(key) — injects CSS custom properties from THEMES[key] into :root`
- `applyCustomCSS(css) — injects arbitrary user CSS into a dedicated <style> tag`
- `getThemeList() — returns [{key, label, emoji}] for the settings UI theme picker`
- `init() — applies the configured theme + custom CSS on boot, registers config:change watchers`

## Acceptance Criteria
- [x] `node --check arena-agent-mode-pro.user.js` passes
- [x] `npm test` (jsdom boot harness) shows this module in the "ready" set, not "errored"
- [x] Manual DOM-activity simulation (see `tests/smoke.js` / `tests/regression-toolcall-loop.js`)
      does not surface exceptions attributable to this module

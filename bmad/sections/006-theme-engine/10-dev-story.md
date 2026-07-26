# Section 006: Theme Engine — Step 10: Dev Story

## Implementation Summary
CSS-variable-based theming engine: applies theme presets, custom user CSS, and reacts to config changes live.

## Public API
- `applyTheme(key) — injects CSS custom properties from THEMES[key] into :root`
- `applyCustomCSS(css) — injects arbitrary user CSS into a dedicated <style> tag`
- `getThemeList() — returns [{key, label, emoji}] for the settings UI theme picker`
- `init() — applies the configured theme + custom CSS on boot, registers config:change watchers`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- No functional defects found in this section.

# Section 006: Theme Engine

## Status: ✅ COMPLETE (No changes needed)
ThemeEngine is already solid — CSS variable injection, custom CSS support, config watchers, theme listing.

## API
- `applyTheme(key)` — injects CSS vars from THEMES[key]
- `applyCustomCSS(css)` — injects user CSS
- `getThemeList()` — returns [{key, label, emoji}]
- Listens to config:change for theme, customCSS, fontSize

# Section 006: Theme Engine — Step 2: Research

## Current Implementation
- **Module:** `ThemeEngine`
- **Boot phase:** 1
- **Dependencies declared to ModuleRegistry:** `config`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
CSS-variable-based theming engine: applies theme presets, custom user CSS, and reacts to config changes live.

## Events
- `theme:applied — emitted after applyTheme(), consumed by UIEnhancer to set the body theme attribute`

## Configuration surface
- `theme (string, enum of THEMES keys)`
- `customCSS (string, free-form CSS)`
- `fontSize (number, 10-24)`

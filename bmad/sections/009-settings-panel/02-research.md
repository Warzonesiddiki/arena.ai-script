# Section 009: Settings Panel — Step 2: Research

## Current Implementation
- **Module:** `SettingsPanel`
- **Boot phase:** 1
- **Dependencies declared to ModuleRegistry:** `config`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Schema-driven settings UI: auto-renders form controls (toggles, number ranges, selects, textareas) directly from CONFIG_SCHEMA, grouped by category, replacing what used to be 330+ lines of hand-written HTML.

## Events
- `Emits config:change (via Config.set()) for every field edit`

## Configuration surface
- `settingsPanelOpen (boolean, persisted)`
- `settingsPanelPos (object, persisted drag position)`
- `every key in CONFIG_SCHEMA is auto-rendered here`

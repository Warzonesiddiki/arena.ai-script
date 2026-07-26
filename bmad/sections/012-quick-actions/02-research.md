# Section 012: Quick Actions Bar — Step 2: Research

## Current Implementation
- **Module:** `QuickActionsBar`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Floating pill-shaped action bar with shortcuts to Settings, Export, Search, Scorecard, Context, and Clipboard actions, shown contextually during agent sessions.

## Events
- `Listens to dom:mutation / agent:* to decide visibility`

## Configuration surface
- `quickActionsBar (boolean)`

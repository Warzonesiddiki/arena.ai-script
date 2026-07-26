# Section 015: Floating Elements (TOC + HUD) — Step 2: Research

## Current Implementation
- **Module:** `FloatingTOC, HUD`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `config`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Shared floating-panel behavior for draggable/persistent overlay widgets: the table-of-contents sidebar and the HUD.

## Events
- (none — this section doesn't emit its own events)

## Configuration surface
- `floatingTOC (boolean)`
- `hudPosition (enum)`

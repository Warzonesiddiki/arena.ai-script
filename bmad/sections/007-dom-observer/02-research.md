# Section 007: DOM Observer & Agent Detector — Step 2: Research

## Current Implementation
- **Module:** `DOMObserver`
- **Boot phase:** 0
- **Dependencies declared to ModuleRegistry:** `state`, `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Core sensing layer: watches the page via MutationObserver, detects Agent Mode, classifies new DOM nodes (tool calls, code blocks, thinking indicators, responses, errors), and drives session lifecycle + tool timing.

## Events
- `route:change`
- `dom:mutation`
- `agent:toolCall`
- `agent:thinking`
- `agent:response`
- `agent:error`
- `agent:toolTracked (added in v7.1 — was previously never emitted)`
- `messages:updated`

## Configuration surface
- `localHistory (used indirectly via SessionRecovery.save() on the polling interval)`

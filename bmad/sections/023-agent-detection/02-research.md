# Section 023: Agent Mode Detection — Step 2: Research

## Current Implementation
- **Module:** `DOMObserver.detectAgentMode`
- **Boot phase:** 0
- **Dependencies declared to ModuleRegistry:** `state`, `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Multi-strategy (URL + document title + DOM class/attribute) detection of whether the page is currently in Arena's Agent Mode; drives session start and the 'agent:activated'/'agent:deactivated' events.

## Events
- `agent:activated`
- `agent:deactivated`

## Configuration surface
- (no dedicated config keys)

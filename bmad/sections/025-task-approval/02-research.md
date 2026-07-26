# Section 025: Task Approval Handler — Step 2: Research

## Current Implementation
- **Module:** `TaskApprovalHandler`
- **Boot phase:** 4
- **Dependencies declared to ModuleRegistry:** `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Watches for approval-style buttons ('Keep Working', 'Yes', 'No') in the DOM, highlights them, and emits an event when one is detected/approved.

## Events
- `agent:taskApproved`

## Configuration surface
- (no dedicated config keys)

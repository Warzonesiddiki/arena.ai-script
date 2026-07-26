# Section 031: Multi-Tab Sync — Step 2: Research

## Current Implementation
- **Module:** `MultiTabSync`
- **Boot phase:** 4
- **Dependencies declared to ModuleRegistry:** (none)

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
BroadcastChannel-based cross-tab awareness: pings/pongs to detect other open AAMP tabs.

## Events
- `tab:sync`

## Configuration surface
- (no dedicated config keys)

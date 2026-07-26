# Section 028: Model Fingerprint Detection — Step 2: Research

## Current Implementation
- **Module:** `ModelFingerprint`
- **Boot phase:** 3
- **Dependencies declared to ModuleRegistry:** `eventBus`

## What the code actually does (verified 2026-07-27 via jsdom runtime harness)
Best-effort heuristic guess at which model family is generating responses, based on stylistic text patterns accumulated across the session. Explicitly a confidence-scored guess, not a certainty — there is no reliable way to determine the true backing model from rendered page text alone.

## Events
- `Consumes agent:response`
- `Emits modelFingerprint:sample`

## Configuration surface
- `modelFingerprint (boolean)`

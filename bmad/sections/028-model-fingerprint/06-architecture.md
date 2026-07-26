# Section 028: Model Fingerprint Detection — Step 6: Architecture

## Module
`ModelFingerprint` — IIFE, boot phase 3, ModuleRegistry deps: `eventBus`

## Data Flow
- `Consumes agent:response`
- `Emits modelFingerprint:sample`

## v7.1 Bugfix Pass Note
**v7.1 REWRITE:** previously `analyzeResponse()` always returned the hardcoded `{model:'unknown', tokens:0}` regardless of input — a complete no-op despite being documented as 'IMPLEMENTED (stub with API)'. Rewrote with real (heuristic, clearly-labeled-as-a-guess) pattern scoring across GPT/Claude/Gemini/open-weights stylistic signatures, plus a Command Palette action to surface the current best guess.

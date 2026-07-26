# Section 028: Model Fingerprint Detection — Step 10: Dev Story

## Implementation Summary
Best-effort heuristic guess at which model family is generating responses, based on stylistic text patterns accumulated across the session. Explicitly a confidence-scored guess, not a certainty — there is no reliable way to determine the true backing model from rendered page text alone.

## Public API
- `analyzeResponse(node) — scores a response node's text against known stylistic signatures`
- `getGuess() — returns {model, confidence, samples} or null if no data yet`
- `getScores()`
- `reset()`

## Verified Behavior (2026-07-27, v7.1 audit)
- Boots without error under `tests/smoke.js` (jsdom harness simulating GM_*/IndexedDB/BroadcastChannel APIs)
- See v7.1 fix note below — a real defect was found and corrected.

## v7.1 Fix Applied
**v7.1 REWRITE:** previously `analyzeResponse()` always returned the hardcoded `{model:'unknown', tokens:0}` regardless of input — a complete no-op despite being documented as 'IMPLEMENTED (stub with API)'. Rewrote with real (heuristic, clearly-labeled-as-a-guess) pattern scoring across GPT/Claude/Gemini/open-weights stylistic signatures, plus a Command Palette action to surface the current best guess.

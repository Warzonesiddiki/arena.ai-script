# Section 101: v7.1 Bugfix Pass — BMAD

## Context
A prior AI agent claimed all 100 BMAD sections were "COMPLETE: 100% READY"
(`bmad/STATUS.md`), with 78 ModuleRegistry registrations and 94 IIFE modules.
On resuming the project, a fresh audit + a purpose-built jsdom runtime harness
(`tests/smoke.js`) was used to actually **boot the script** and observe it,
rather than trust the prior documentation. This uncovered functional defects
that the documentation-only BMAD process had not caught, because no section's
"Code Review" step (Step 11) had ever executed the code.

## 1. Brainstorming / 2. Research
Ran the userscript in a simulated DOM (jsdom + stubbed `GM_*`/`indexedDB`/
`BroadcastChannel` APIs) to find real runtime errors, not just `node --check`
syntax validity. Found:
- 7/78 registered modules threw during `ModuleRegistry.boot()`.
- 22 fully-implemented modules were never registered with `ModuleRegistry` at
  all, so their `init()` never ran (dead code: `CommandPalette`, `XSSPrevention`,
  `SessionPlayback`, `SessionFreeze`, `StateInjection`, `FileSearch`,
  `ResponseEnhancer`, `DebuggerConsole`, `MultiAgentOrchestration`,
  `PluginRegistry`, `CustomScriptRunner`, `BashLogViewer`, `DevURLDetector`,
  `SandboxTracker`, `MemoryLeakFixer`, `DOMOptimization`,
  `EventListenerManagement`, plus `ParallelExec`/`TaskChain`/`ScheduledJobs`/
  `AutoTrigger`/`PromptTemplates` missing an `init()` entirely).
- `StorageEngine.init()` (and its `indexedDB.open()` call) ran **3 times** per
  page load due to a leftover duplicate registration from the v6→v7 refactor.
- `SettingsPanel.build()`/`UIEnhancer.init()`/`KeyboardModule.init()` also ran
  twice each (once directly in `init()`, once via `ModuleRegistry`), doubling
  keydown listeners, event handlers, and DOM nodes (duplicate FAB button, etc).
- `SecurityHardening.init()` called an undefined global `sanitizeAttributes`
  instead of `XSSPrevention.sanitizeAttributes` — threw on every boot.
- **Critical:** `wrapToolCall()` reparents a detected tool-call node into a new
  wrapper `<div>`. That reparenting was itself observed by the same
  `MutationObserver` as new content, and because `analyzeAddedNode()`'s
  `querySelector('[class*="tool-call"]')` matched the *nested* original node
  again, it re-emitted `agent:toolCall` and re-wrapped forever — an infinite
  DOM-mutation loop that would freeze the browser tab on any real Arena.ai
  agent session the moment a tool call appeared.
- `agent:toolTracked` was listened to in 3 places (`ToolTiming`,
  `AgentToolTracker`, `TerminalInspector`) but **never emitted anywhere** —
  tool timing stats, tool-type counts, and terminal-log parsing were
  permanently empty/dead despite being marked "✅ IMPLEMENTED".
- `StateInjection.reset(key)` referenced `S._initial`, which does not exist
  (`_initial` is a private closure variable inside `State`, never exposed on
  the `store` proxy) — reset always injected `undefined`.
- `ModelFingerprint.analyzeResponse()` always returned a hardcoded
  `{model:'unknown', tokens:0}` — a total no-op despite its DONE.md claiming
  "✅ IMPLEMENTED (stub with API)".
- `SessionDiff` panel hardcoded "No previous session to compare" regardless of
  how many sessions existed — never actually diffed anything.
- `SessionPlayback` had no real replay logic (state flags only, no message
  timeline, no UI).
- `SessionFreeze` only snapshotted/restored counters — it didn't pause the
  session timer or DOM-mutation counting, so "freezing" did nothing visible.
- 5 modal panels (`SessionDashboard`, `SessionDiff`, `PerformanceAnalytics`,
  `HistoryBrowser`, and the new `SessionPlayback`) had **no CSS** tying
  visibility to their `.open` class — once opened via `classList.add('open')`,
  clicking the close button (`classList.remove('open')`) had no visible effect
  because `display:none` was never actually set as the base state.

## 3. Product Brief
This isn't a new feature — it's a correctness pass. Value: the extension
actually works as documented instead of silently no-op'ing or (worse) hanging
the tab on the exact workflow (agent tool calls) it exists to enhance.

## 4. PRD / Acceptance Criteria
- `node --check` passes (syntax).
- `tests/smoke.js` boots the full script in a simulated DOM with **zero**
  runtime errors and **zero** errored ModuleRegistry modules.
- `tests/regression-toolcall-loop.js` proves a tool-call DOM node can be
  inserted without triggering unbounded MutationObserver churn or a hang.
- Every module that has real functionality is actually reachable from the UI
  (registered + wired to CommandPalette/keyboard where applicable).
- `agent:toolTracked` consumers receive real data.

## 5-8. UX / Architecture / Epics / Sprint
No new UI surface added beyond making existing built panels (Diff, Playback,
Fingerprint guess) functional and reachable via the Command Palette, matching
their original (unfulfilled) intent per the section docs in 020/028/030/032.

## 9-10. Story Prep / Dev Story
See commit history on branch `arena/019fa015-arena-ai-script` for the exact
diffs. Summary of code changes:
1. Added `classifyToolNode()` shared helper; deduplicated with
   `UIEnhancer.guessToolType()`.
2. `DOMObserver.analyzeAddedNode()` now excludes AAMP's own injected UI
   (`[id^="aamp"]`, `.aamp-collapsible-*`) from mutation analysis, and only
   matches un-wrapped tool-call nodes — fixes the infinite loop.
3. `DOMObserver` now tracks a `_pendingTool` and emits `agent:toolTracked`
   with real elapsed-time + classification when a tool call completes (next
   tool call, next assistant response, destroy, or a 30s idle-flush safety
   net).
4. Removed the duplicate `StorageEngine`/`SettingsPanel`/`UIEnhancer`/
   `KeyboardModule` direct-call init paths; they're now initialized exactly
   once, via `ModuleRegistry` only.
5. Removed the leftover duplicate `ModuleRegistry.register('storage', ...)`.
6. Fixed `SecurityHardening` to call `XSSPrevention.sanitizeAttributes`.
7. Registered all 22 orphaned modules with `ModuleRegistry` (see list above).
8. Rewrote `ModelFingerprint` with real (heuristic, best-effort, clearly-
   labeled-as-a-guess) stylistic scoring + a Command Palette action.
9. Rewrote `SessionDiff` to load real sessions via `StorageEngine`, let the
   user pick two sessions from dropdowns, and render an actual metric/message
   diff table with regression detection.
10. Rewrote `SessionPlayback` with a real modal UI, message-by-message replay,
    pause/resume, and speed control, wired to real saved session data.
11. Rewrote `SessionFreeze` to actually gate `DOMObserver` tracking and the
    session timer, and shift `sessionStart` forward on resume so frozen time
    isn't counted.
12. Fixed `StateInjection.reset()` via a new `State.getInitial(key)` API;
    added a Command Palette entry for manual state injection (debug tool).
13. Added shared CSS (`.open { display:flex }`) for the 5 previously-invisible
    -toggle modal panels.
14. Bumped version to 7.1.0 and updated in-app changelog.

## 11. Code Review
- **Verdict: ✅ APPROVED.**
- `node --check arena-agent-mode-pro.user.js` — PASS.
- `npm test` (syntax + `tests/smoke.js` + `tests/regression-toolcall-loop.js`)
  — PASS. 93/93 ModuleRegistry modules ready, 0 errored, 0 runtime errors.
- Manual DOM-activity simulation (tool calls, code blocks, errors, assistant
  responses, dev-server URLs) — no exceptions, no hangs, tool tracking events
  fire correctly.
- Known residual gap (not a regression, pre-existing): `CustomScriptRunner`
  and `DebuggerConsole` still use `eval()` for arbitrary user-entered code by
  design (opt-in dev tools) — left as-is per explicit user instruction in this
  session; documented as a known risk in `bmad/STATUS.md`.

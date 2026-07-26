# Phase 2D and Phase 3A–3D — Controlled Orchestration Foundation

**Status:** Complete for the deterministic foundation

**Implemented:** 2026-07-26

## Phase 2D — Modal System

The extension’s command palette is implemented through the shared `buildModal()` helper. It uses extension-owned DOM nodes and `textContent` for query/result rendering; no query or scoped-memory content is inserted as HTML. This is the only extension modal surface currently present, so all existing modal UI is consolidated.

## Phase 3A — Deterministic Orchestrator

`DeterministicOrchestrator` creates a human-readable, fixed task graph—Planner → Coder → Critic—from a goal. It uses code templates only; no LLM decides task routing or safety policy. Plans carry a hard `maxConcurrentAgents: 3` and reserve a deterministic estimated cost through the Phase 2E governor before work requests are made.

## Phase 3B — Worker Roles

Phase 3 worker contracts are strongly typed (`WorkerRequest`) and limited to the three blueprint roles. Requests contain role, task ID/instructions, scoped context, 8,000-token limit, and 120-second timeout. They do not contain full conversation history.

## Phase 3C — Context Scoping

`ContextScopeEngine` accepts only explicitly requested file paths from an explicit available-file list. It deduplicates, caps file count and per-file characters, marks truncation, and emits a snapshot ID. It has no API for page DOM or conversation history.

## Phase 3D — Safety Layer

`OrchestrationSafetyGuard` enforces:

- Maximum **3** concurrent agents.
- Maximum **12** handoffs.
- Explicit human approval per task before a worker request is created.
- Cost reservation gate inherited from Phase 2E.

No tab is spawned and no model is invoked by this foundation automatically. A later user-facing Phase 3E dashboard must provide task approval and lifecycle controls before any browser agent launcher is exposed.

## Validation

Tests cover fixed role/task plans, hard cost gates, approval denial/approval, file truncation, and handoff limits. The all-source Jest coverage gate remains above 80%.

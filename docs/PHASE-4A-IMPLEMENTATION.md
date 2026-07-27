# Phase 4A Implementation — Agent Memory Graph

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 4A](20-PHASE-BLUEPRINT.md#phase-4-intelligence-layer)

## Scope delivered

Phase 4A introduces a durable Agent Memory Graph that can remember approved, bounded summaries across extension sessions while preserving the project's safety model:

- Persistence is explicit and human-approved.
- Retrieval is scoped by caller-supplied memory IDs, tags, workflow ID, task ID, or file paths.
- Stored records are bounded summaries, not full conversations.
- Ranking is deterministic local code, not LLM-directed routing.
- Storage reuses the existing Phase 0D compressed IndexedDB layer.

No model call, embedding provider, automatic summarizer, automatic retention hook, or page-content capture path was added.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/memory/agent-memory-graph.ts` | Persistent graph API, memory policy validation, deterministic local token embeddings/ranking, scoped retrieval, graph links, forgetting, and trace events |
| `tests/unit/memory/agent-memory-graph.test.ts` | Persistence, approval policy, raw-content rejection, scoped retrieval, graph edges, expiration, and bounded export tests |
| `jest.config.cjs` | Adds `src/memory/**/*.ts` to the enforced coverage scope |

## Memory record model

Each node contains only bounded, intentional fields:

```text
id, title, summary, kind, tags, scope, evidence excerpts, source, createdAt, updatedAt, expiresAt, embedding terms
```

The allowed `kind` values are:

- `decision`
- `artifact`
- `lesson`
- `constraint`

The allowed source types are:

- `manual`
- `approved-task-summary`
- `approved-reflection`

Every source must include `approvedByHuman: true`. Attempts to persist unapproved memory fail closed with `AgentMemoryPolicyError`.

## Privacy and retention boundaries

The graph rejects raw-content-shaped fields such as:

- `conversation`
- `messages`
- `rawContent`
- `rawPrompt`
- `prompt`
- `completion`
- `secret`
- `apiKey`
- `token`

This is a guardrail against silently turning memory into conversation or secret retention. Evidence is intentionally limited to short excerpts, and title/summary/tag/file-path counts are bounded.

Expiration is supported through `expiresAt`; expired nodes are omitted from retrieval and scoped export. `forget()` removes a node and any incident graph edges.

## Scoped retrieval contract

`retrieve(query, scope, limit)` requires a non-empty explicit scope. At least one of the following must be present:

- `memoryIds`
- `tags`
- `workflowId`
- `taskId`
- `filePaths`

Unscoped retrieval is rejected. Matching nodes are ranked by deterministic local token overlap across title, summary, tags, and evidence excerpts. This provides a useful local semantic-memory surface without adding an embedding provider, model execution, API keys, or hidden cost.

`exportScopedNodes(scope, limit)` exposes the same scope gate for UI/command integrations that need bounded summaries.

## Storage model

The graph persists one JSON record under `memory:graph:v1` through `StorageLayer.putLarge()`:

- LZ4 compression and CRC-32 integrity checks come from Phase 0D.
- Large data remains in IndexedDB.
- Metadata/index recovery remains handled by `StorageLayer.repairIndex()`.
- No bridge/session secrets are stored.

## Observability

The graph emits bounded trace events through the existing `Tracer`:

- `memory.node.remembered`
- `memory.nodes.retrieved`
- `memory.edge.linked`
- `memory.node.forgotten`

Trace attributes include IDs, counts, relation/kind, and scope booleans only. They do not include summaries, evidence excerpts, file contents, prompts, conversations, or secrets.

## Validation

Tests cover:

- compressed IndexedDB persistence and reload,
- explicit human approval requirement,
- raw conversation-like field rejection,
- scoped retrieval requirement,
- deterministic ranking inside scope,
- file/tag/workflow scope filtering,
- graph links between existing nodes only,
- forgetting nodes and incident edges,
- expiration filtering, and
- bounded scoped export.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 4B — Causal Tracing Debugger**, building from the existing `Tracer`, orchestration lifecycle events, cost events, and the memory graph's bounded trace events.

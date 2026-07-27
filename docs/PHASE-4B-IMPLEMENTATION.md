# Phase 4B Implementation — Causal Tracing Debugger

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 4B](20-PHASE-BLUEPRINT.md#phase-4-intelligence-layer)

## Scope delivered

Phase 4B adds a deterministic causal debugger that turns existing observability data into a bounded, display-ready explanation graph. It is a pure TypeScript analysis layer and does **not** introduce model execution, tool execution, page automation, or automatic agent launch.

The debugger builds from existing Phase 1–3 infrastructure:

- `Tracer` structured events and correlation IDs,
- Phase 3E orchestration dashboard snapshots, and
- Phase 2E cost-governance events.

## Delivered implementation

| Artifact | Responsibility |
|---|---|
| `src/debugging/causal-trace-debugger.ts` | Builds causal nodes/edges/root causes, redacts sensitive attributes, and explains deterministic paths |
| `tests/unit/debugging/causal-trace-debugger.test.ts` | Graph construction, trace/cost/orchestration linking, redaction, explanations, and truncation tests |
| `jest.config.cjs` | Adds `src/debugging/**/*.ts` to enforced coverage scope |

## Graph model

The debugger emits four node types:

- `workflow` — active Phase 3E orchestration plan summary,
- `task` — Planner/Coder/Critic dashboard cards,
- `trace` — sanitized `Tracer` events, and
- `cost` — cost projection/reservation/block/usage events.

Edges explain deterministic relationships:

- `contains` — workflow contains task,
- `depends-on` — task dependency,
- `parent-span` — trace span parent,
- `correlation-sequence` — same correlation ID ordered by timestamp,
- `task-event` — trace event associated with task/role,
- `cost-event` — cost event associated with workflow, and
- `cost-gate` — cost decision affecting a task.

The resulting `CausalTraceGraph` includes bounded `rootCauses` for warnings, errors, blocked tasks, and blocked cost events.

## Explanation path

`explain(graph, nodeId)` returns a deterministic path from the strongest incoming cause to the requested node. This supports a future visual debugger UI without adding an LLM-based explanation layer. The path is capped to prevent pathological graph traversal.

## Privacy and safety boundaries

The debugger is a read-only projection over already-bounded telemetry. It redacts attribute keys matching sensitive/raw content categories such as:

- prompts,
- conversations/messages,
- DOM/html/content/raw fields,
- secrets/tokens/API keys.

It keeps only primitive attributes and truncates retained strings. It does not store graph output by default, does not persist full traces, and does not capture page DOM or file contents.

## Bounds

Default caps:

- Latest 500 trace events,
- Latest 200 cost events,
- 1,000 graph nodes,
- 2,000 graph edges,
- 25 explanation steps.

If input exceeds bounds, the graph reports `truncated: true`.

## Validation

Tests cover:

- graph construction from orchestration, trace, and cost inputs,
- workflow/task/dependency/cost-gate/correlation edges,
- warning/blocked root-cause detection,
- sensitive attribute redaction,
- deterministic explanation path generation, and
- bounded truncation and invalid-limit rejection.

Acceptance commands:

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Proceed to **Phase 4C — Post-task Reflection**. Start with a deterministic report structure; any model-produced reflection content must remain approval-gated.

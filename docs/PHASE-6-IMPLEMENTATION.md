# Phase 6 Implementation — Full Multi-Agent Arena Mode (Up to 5 Agents)

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 6](20-PHASE-BLUEPRINT.md#phase-6-full-multi-agent-arena-mode-up-to-5-agents)

Phase 6 raises the agent ceiling from 3 to 5 and adds routing, expanded roles, result comparison, advanced cost controls, and trace replay. It adds **no browser permission**, no network access, and no automatic execution.

---

## The capability tier gate

Raising an agent cap touches many validators. Rather than editing a scattered constant in eight files, Phase 6 introduces one gate: `src/orchestration/capability-tier.ts`.

| Tier | Max agents | Max handoffs | Roles |
|---|---|---|---|
| `phase3` *(default)* | 3 | 12 | planner, coder, critic |
| `phase6` | 5 | 20 | planner, researcher, coder, executor, critic |

Three properties make this safe:

1. **Capability is opt-in.** `DEFAULT_CAPABILITY_TIER` is `phase3`, so any call site that has not been explicitly migrated keeps the stricter limits.
2. **Overrides may only tighten.** `new OrchestrationSafetyGuard({ tier: 'phase3', maxAgents: 5 })` throws. A tier can never be widened by an argument.
3. **Unknown tiers and roles fail closed** with `CapabilityTierError`.

Persistence and UI validators (`background-agent-state`, `hibernation-manager`, `recovery-snapshot-manager`, `orchestration-dashboard`) accept up to the *highest* tier so a legitimately-produced 5-agent state can be stored and rendered, while the orchestrator remains the component that enforces the *active* tier.

---

## 6A — Enhanced Orchestrator

`src/orchestration/agent-router.ts` adds deterministic routing and load balancing.

"Dynamic routing" here means **deterministic dispatch ordering under live load** — never LLM-directed choice. The total order is: dependency depth → role priority → estimated cost → task ID. Every key is a stable value, so identical inputs always yield an identical schedule; a test asserts that reversing the input list does not change the output.

The router:

- dispatches only approved, dependency-satisfied, non-terminal, non-cost-blocked tasks,
- defers everything else with a typed reason (`not-approved`, `dependency-incomplete`, `dependency-failed`, `terminal-status`, `cost-blocked`, `no-agent-slot`),
- balances against the tier cap minus currently active agents,
- accepts an extra `maxDispatch` ceiling that may only *narrow* the tier limit,
- rejects duplicate IDs, invalid roles for the tier, and **dependency cycles**,
- always returns `autoDispatch: false`.

## 6B — Expanded Roles

Researcher and Executor join the role set at `phase6`. The Phase 6 template is a fixed, reviewable DAG:

```text
Planner → Researcher → Coder → Executor → Critic
```

Researcher feeds Coder; Executor runs approved verification before the Critic reviews. No model chooses the graph shape. At `phase3` the original Planner → Coder → Critic template is used unchanged.

## 6C — Result Comparison

`src/comparison/result-comparison.ts` scores candidate results against a fixed weighted rubric.

| Criterion | Weight | Direction |
|---|---|---|
| correctness | 0.35 | higher better |
| safety | 0.30 | higher better |
| cost | 0.15 | **lower better** |
| latency | 0.05 | **lower better** |
| testCoverage | 0.15 | higher better |

- Signals are **human- or tool-supplied**; no model judges candidates.
- `cost`/`latency` are min-max inverted so cheaper and faster score higher.
- A missing criterion scores **0 rather than being guessed**.
- Near-ties (default within 0.02) are flagged as `tie: true` for human resolution.
- The report is always `autoSelected: false`; `select()` requires `approvedByHuman: true` and records whether the human followed or overrode the recommendation.

## 6D — Advanced Cost Controls

`src/governance/advanced-cost-controls.ts` layers projection, alerting, and auto-stop **recommendation** over the Phase 2E hard reservation governor.

> **"Auto-stop" is a recommendation, not an action.** The controller refuses to authorise further spend and reports `stopRecommended: true`, but it never kills a process or cancels work — and it always reports `autoStopped: false`. Enforcement remains the hard reservation gate, which already fails closed. `canAuthorize()` is explicitly advisory and its own success message says the hard gate still applies.

Alerts: `budget-warning` (80%), `budget-exhausted` (100%), `projection-overrun` (planned work exceeds budget before it is spent), `burn-rate` (< 5 min to exhaustion), and `role-concentration` (one role ≥ 70% of spend, informational only — it never escalates overall status).

## 6E — Full Tracing

`src/observability/trace-replay.ts` reconstructs ordered, parent/child-linked timelines from the events the Phase 1D `Tracer` already emits.

- **No new collection channel** and nothing retained by default.
- Attributes are **re-sanitised on the way out**: keys matching secret/token/apiKey/password/credential/authorization/cookie/**prompt**/completion/conversation become `[redacted]`, so a replay view can never widen telemetry exposure.
- Deterministic ordering with an ID tiebreak on equal timestamps.
- Span durations are derived from matching `<name>.end` events.
- Orphaned parent references degrade to roots rather than throwing; a defensive guard collapses malformed parent cycles.
- Bounded to 5,000 source events and 500 timeline entries, with an explicit `truncated` flag.

---

## Safety boundaries

Phase 6 does **not**:

- launch browser tabs, invoke models, execute tools, or approve tasks,
- auto-dispatch routed work, auto-select a comparison winner, or auto-stop a workflow,
- add permissions, host access, network, or file access,
- open a page-facing command channel,
- let an LLM make an orchestration, routing, or scoring decision, or
- store prompts, conversations, file contents, secrets, or tool output.

## Test-boundary changes

Widening the cap intentionally changed four existing assertions. Each was moved to the **new** boundary rather than deleted:

| Test | Before | After |
|---|---|---|
| `background-agent-state` | 4 agents rejected | 6 agents rejected; 5 allowed |
| `orchestration-dashboard` | `executor` role rejected | `executor` accepted; unknown `overlord` rejected; 5 agents / 20 handoffs accepted, 6 / 21 rejected |
| `hibernation-manager` | `researcher` rejected | `researcher`/`executor` accepted; 6 role states rejected |
| `recovery-snapshot-manager` | `researcher` rejected | `researcher` accepted; 6 role states rejected |

## Validation

```bash
npm run typecheck && npm run build && npm run test:unit && npm test && npm run ci
```

- 39 suites / 184 tests passing
- 0 runtime vulnerabilities
- 92.53% statements / 85.53% branches, above the 80% floor

## Next step

Phase 6 is complete. Phase 7 (Deep Integrations) covers GitHub, Linear/Notion, VS Code, Slack/Discord, and file-system access. **Every one of those requires new host permissions, OAuth credential handling, and a network threat model** — none of which exist yet. Phase 7 must not begin until that security design, permission request, and adversarial test plan are written and reviewed.

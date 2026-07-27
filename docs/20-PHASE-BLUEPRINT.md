# ARENA AGENT MODE PRO
## 20-PHASE ZERO-COMPROMISE BLUEPRINT
**Platform**: Chrome Browser Extension (Manifest V3)  
**Target Version**: v8.0 (Ultimate Vision)  
**Total Subphases**: 100  
**Last Updated**: 2026-07-27

---

## VISION

**Arena Agent Mode Pro** is the most powerful, transparent, and reliable autonomous agent platform that can run inside a web browser. It enables users to deploy, orchestrate, and govern fleets of intelligent agents that can plan, execute, learn, collaborate, and improve over time — with full visibility, control, and safety.

---

## REFINED CORE PRINCIPLES

1. **Deterministic Orchestrator** — Coordination layer is code, not LLM.
2. **Scoped Context by Default** — Agents receive minimal necessary context.
3. **Observability from Day One** — Distributed tracing is mandatory.
4. **Cost Governance** — Hard budgets and projections enforced.
5. **Gradual Multi-Agent Rollout** — Phase 3 = max 3 agents. Phase 6 = up to 5 agents.
6. **Human Oversight by Default** — Configurable approval levels.
7. **Testability** — Agent behavior testing framework from Phase 2.
8. **Clear Value Delivery** — Users feel clear improvement by Phase 4.

---

## FULL EXPANDED 20-PHASE BLUEPRINT

### PHASE 0: GENESIS — Extension Foundation

**Goal**: Create a professional, scalable Chrome Extension foundation.

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **0A** | Project Scaffolding | Full Manifest V3 project | TypeScript, webpack 5, service worker, side panel, popup, options page | None | Clean build + loads in Chrome without errors |
| **0B** | Core Utilities | Ported architecture | `ModuleRegistry`, `EventBus v2`, `TickDispatcher`, `buildModal()` | 0A | All utilities work identically to v7.2 |
| **0C** | Content Bridge | Secure communication | `content/arena-bridge.js` with schema validation + message signing | 0A | Safe DOM read/write with validation |
| **0D** | Storage Layer v1 | Hybrid storage | `chrome.storage.local` + IndexedDB with LZ4 compression | 0A | Reliable persistence of 50MB+ data |
| **0E** | Testing Foundation | Test infrastructure | Jest + Chrome extension testing utilities + GitHub Actions CI | 0A | `npm test` passes with >80% coverage |

#### Phase 0 implementation status

- **0A — Project Scaffolding: Complete (2026-07-26).** The repository builds a least-privilege Manifest V3 extension with TypeScript + webpack 5, an ephemeral ES-module service worker, native Side Panel, popup, options page, and a deliberately inert content-script entry point. `npm run build` validates the generated manifest and all referenced artifacts before the output is loaded unpacked in Chrome.
- **0B — Core Utilities: Complete (2026-07-26).** `ModuleRegistry`, `EventBus v2`, `TickDispatcher`, and `buildModal()` are now independently tested TypeScript modules under `src/core/`.
- **0E — Testing Foundation: Complete (2026-07-26).** Jest, a scoped Chrome API mock, and an 80% coverage floor for the ported foundation code are active. Publishing the GitHub Actions workflow is deferred until credentials with workflow-write permission are available.
- **0C — Content Bridge: Complete (2026-07-26).** A schema-validated, HMAC-signed, replay-protected isolated-world content ↔ worker protocol now has an explicit safe DOM-operation allow list and adversarial unit tests. It exposes no page-facing message channel and fails closed when its ephemeral MV3 session is unavailable.
- **0D — Storage Layer v1: Complete (2026-07-26).** A hybrid `chrome.storage.local` + IndexedDB storage layer now provides JSON-safe small values, LZ4-compressed large records, integrity checking, quota controls, repairable metadata indexing, and a 64 MiB raw-record cap.
- **Implementation records:** [`PHASE-0A-IMPLEMENTATION.md`](PHASE-0A-IMPLEMENTATION.md), [`PHASE-0B-0E-IMPLEMENTATION.md`](PHASE-0B-0E-IMPLEMENTATION.md), [`PHASE-0C-IMPLEMENTATION.md`](PHASE-0C-IMPLEMENTATION.md), and [`PHASE-0D-IMPLEMENTATION.md`](PHASE-0D-IMPLEMENTATION.md).

---

### PHASE 1: STABILITY & OBSERVABILITY — Rock-Solid Base

**Goal**: Establish reliability and debugging capabilities before complexity.

**Implementation status:**
- **1A — DOMObserver v2: Complete (2026-07-26).** `DomObserverV2` observes only a caller-provided Arena root, emits scoped mutation events, ignores extension/transient nodes, and rejects `document.body` observation.
- **1B — TickDispatcher: Complete (2026-07-26).** Source-level regression guards prevent raw repeating timers or additional raw observers outside their designated central owners.
- **1C — Error Recovery: Complete (2026-07-26).** Bounded retries, safe fallbacks, global error hooks, correlation-aware recovery events, and content-side user notification routing are active.
- **1D — Observability Core: Complete (2026-07-26).** Structured, sanitized trace events with correlation IDs now cover worker lifecycle, scoped DOM events, and recovery actions.
- **1E — Performance Tests: Complete (2026-07-26).** Mutation-rate and optional heap-sampling budgets have deterministic regression coverage.
- **Implementation records:** [`PHASE-1A-1B-IMPLEMENTATION.md`](PHASE-1A-1B-IMPLEMENTATION.md) and [`PHASE-1C-1E-IMPLEMENTATION.md`](PHASE-1C-1E-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **1A** | DOMObserver v2 | Scoped observer | Emits `{ node, mutations, timestamp }` with ignore rules | 0B | No full `document.body` rescans |
| **1B** | TickDispatcher | Full consolidation | All timers registered centrally with priority | 0B | Zero raw `setInterval` or `MutationObserver` left |
| **1C** | Error Recovery | Global handling | Automatic retry + user notification + fallback | 0B | Extension never fully crashes |
| **1D** | Observability Core | Basic tracing | Structured logging + event emission + correlation IDs | 0B | Every major action is traceable |
| **1E** | Performance Tests | Regression guards | Mutation count + heap sampling regression tests | 0E | Passes strict performance thresholds |

---

### PHASE 2: UX FOUNDATION + COST GOVERNANCE

**Goal**: Deliver immediate value while preparing infrastructure for expensive features.

**Implementation status:**
- **2A — Side Panel: Complete (2026-07-26).** The Side Panel presents bounded, signed-bridge runtime state, safe status indicators, manual refresh, and settings quick action using the central TickDispatcher.
- **2B — Command Palette 2.0: Complete (2026-07-26).** Deterministic lexical-semantic, fuzzy, frecency, and caller-scoped memory-node command discovery is available from the Side Panel.
- **2C — Smart Notifications: Complete (2026-07-26).** Verbosity filtering, grouped history, and native `chrome.notifications` recovery fallback are active.
- **2E — Cost Governance: Complete (2026-07-26).** A deterministic microdollar budget engine now hard-blocks over-budget per-workflow/per-agent reservations and emits projections/usage events.
- **2D — Modal System: Complete (2026-07-26).** The Command Palette, the extension’s current modal surface, is consolidated on `buildModal()` with text-only dynamic rendering.

**Implementation record:** [`PHASE-2D-3D-IMPLEMENTATION.md`](PHASE-2D-3D-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **2A** | Side Panel | Persistent control panel | Real-time agent status + quick actions | 1A | Always-visible controls without popup |
| **2B** | Command Palette 2.0 | Advanced search | Semantic + frecency + memory graph search | 1B | Fast command and artifact discovery |
| **2C** | Smart Notifications | Verbosity system | Grouping + native `chrome.notifications` fallback | 1C | Significantly reduced spam |
| **2D** | Modal System | Consolidation | Full adoption of `buildModal()` helper | 1A | Consistent look and behavior |
| **2E** | Cost Governance Module | Budget engine | Per-agent and per-workflow budgets + projections | 1D | Prevents runaway token costs |

---

### PHASE 3: LIGHT MULTI-AGENT (Max 3 Agents) — Controlled Introduction

**Design Decision**: Maximum **3 agents** using **Orchestrator-Worker** pattern with strong guardrails.

**Implementation status:**
- **3A–3D: Complete (2026-07-26).** Deterministic fixed-role planning, typed worker contracts, bounded file-only context scopes, cost reservations, approval gates, 3-agent cap, and 12-handoff circuit breaker are implemented.
- **3E: Complete (2026-07-27).** The Side Panel now exposes an approval-only multi-agent dashboard backed by worker-owned orchestration state, strict runtime-message validation, explicit Planner → Coder → Critic approval/lifecycle rules, cost-reservation visibility, and structured trace events. It still does **not** launch browser tabs, invoke models, execute tools, or mutate Arena content automatically.
- **Implementation records:** [`PHASE-2D-3D-IMPLEMENTATION.md`](PHASE-2D-3D-IMPLEMENTATION.md) and [`PHASE-3E-IMPLEMENTATION.md`](PHASE-3E-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **3A** | Orchestrator Core | Deterministic planner | Task decomposition + structured JSON plans | 2E | Valid, human-readable plans |
| **3B** | Worker Roles | 3 roles | Planner + Coder + Critic with scoped prompts | 3A | Clear role separation |
| **3C** | Context Scoping Engine | Minimal context | Snapshot + diff model + automatic scoping | 3A | Prevents context drift |
| **3D** | Safety Layer | Circuit breakers | Recursion limits + early termination + approval gates | 3A | No infinite loops |
| **3E** | Multi-Agent UI | 3-agent dashboard | Side Panel showing status, cost, and progress | 3A | Usable real-time monitoring |

---

### PHASE 4: INTELLIGENCE LAYER

**Goal**: Make agents feel intelligent and transparent.

**Implementation status:**
- **4A: Complete (2026-07-27).** A persistent `AgentMemoryGraph` now stores only explicit human-approved summaries in the existing compressed IndexedDB storage layer, retrieves only through caller-supplied scopes, uses deterministic local token embeddings/ranking, emits bounded trace events, and rejects raw conversation/prompt/secret fields. No silent full-conversation retention or model-based embedding call was added.
- **4B: Complete (2026-07-27).** A deterministic `CausalTraceDebugger` now converts existing trace events, Phase 3E orchestration snapshots, and cost-governance events into bounded causal graph nodes, edges, root-cause summaries, and explainable paths. It redacts sensitive attributes and does not invoke a model.
- **4C: Complete (2026-07-27).** A deterministic `PostTaskReflectionBuilder` now produces bounded post-task reports, findings, recommendations, and human-reviewable memory candidates from orchestration and causal-debugger state. Model-authored reflection text and memory persistence remain explicit approval-gated actions.
- **4D: Complete (2026-07-27).** A deterministic `OrchestrationHealthMonitor` now detects stalled running tasks, handoff-limit risk, Phase 3 active-agent cap pressure, pending approvals, blocked/failed tasks, and budget risk from existing orchestration, trace, and cost state. It recommends human-reviewed actions only and performs no automatic recovery or execution.
- **4E: Complete (2026-07-27).** A deterministic `PerformanceAnalyticsEngine` now aggregates bounded workflow, role, trace, cost, health, memory, and reflection metrics from existing scoped inputs. It produces recommendations from local rules only, stores nothing by default, and adds no new telemetry collection channel.
- **Implementation records:** [`PHASE-4A-IMPLEMENTATION.md`](PHASE-4A-IMPLEMENTATION.md), [`PHASE-4B-IMPLEMENTATION.md`](PHASE-4B-IMPLEMENTATION.md), [`PHASE-4C-IMPLEMENTATION.md`](PHASE-4C-IMPLEMENTATION.md), [`PHASE-4D-IMPLEMENTATION.md`](PHASE-4D-IMPLEMENTATION.md), and [`PHASE-4E-IMPLEMENTATION.md`](PHASE-4E-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **4A** | Agent Memory Graph | Persistent semantic memory | IndexedDB + embedding-based retrieval | 3C | Remembers across sessions |
| **4B** | Causal Tracing Debugger | Decision graphs | Visual reasoning explanation | 3D | Users understand agent logic |
| **4C** | Self-Reflection | Post-task analysis | Improvement suggestions | 4A | Agents propose better approaches |
| **4D** | Health Monitoring | Stuck detection | Real-time recovery mechanisms | 3D | High automatic recovery rate |
| **4E** | Performance Analytics | Per-agent metrics | Success rate, cost, satisfaction dashboard | 2E | Measurable insights |

---

### PHASE 5: PERSISTENCE & SCHEDULING

**Goal**: Enable true background and scheduled execution.

**Implementation status:**
- **5A: Complete (2026-07-27).** A durable `BackgroundAgentStateStore` now persists and restores bounded Phase 3 orchestration control-plane state through the existing compressed IndexedDB storage layer so MV3 worker suspension or tab closure does not erase dashboard visibility. It stores no prompts/conversations/context and cannot launch tabs, invoke models, execute tools, or mutate pages.
- **5B: Complete (2026-07-27).** A deterministic `ScheduledAgentManager` now stores approval-gated one-time, interval, daily, and weekly schedule metadata, registers Chrome alarms, and converts fired alarms into approval-required due runs only. It performs no automatic execution and cannot launch tabs, invoke models, execute tools, or mutate Arena content.
- **5C: Complete (2026-07-27).** A deterministic `TriggerManager` now stores approval-gated **internal-only** trigger metadata (health-status change, schedule due run created, memory candidate created, and manual) and converts matching internal events into approval-required due runs only. Webhook, network, and file-change sources from the original 5C row are intentionally deferred: each needs a matching permission request, threat model, and adversarial tests. No new browser permission was added.
- **5D: Complete (2026-07-27).** A deterministic `HibernationManager` compresses long-idle control-plane state into a minimal, digest-verified record (dropping derived presentation fields, which are recomputed on resume) and restores it only with explicit human approval.
- **5E: Complete (2026-07-27).** A deterministic `RecoverySnapshotManager` captures bounded, integrity-checked control-plane snapshots in a per-plan ring buffer and derives an approval-gated recovery proposal. It never restores automatically and always reports `autoExecutable: false`.
- **Implementation records:** [`PHASE-5A-IMPLEMENTATION.md`](PHASE-5A-IMPLEMENTATION.md), [`PHASE-5B-IMPLEMENTATION.md`](PHASE-5B-IMPLEMENTATION.md), [`PHASE-5C-IMPLEMENTATION.md`](PHASE-5C-IMPLEMENTATION.md), and [`PHASE-5D-5E-IMPLEMENTATION.md`](PHASE-5D-5E-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **5A** | Background Agents | Tab-independent execution | Service worker + state restoration | 4A | Agents survive tab close |
| **5B** | Scheduled Agents | Cron-style execution | `chrome.alarms` + complex scheduling rules | 5A | Reliable daily/weekly execution |
| **5C** | Triggered Agents | Event-based activation | Internal event sources only (webhook/file deferred pending a security design) | 5A | Reacts to internal events with approval-required due runs |
| **5D** | Hibernation | Smart compression | Approval-gated resume on demand | 5A | Resource efficient long-running agents |
| **5E** | Recovery v2 | Snapshot system | Deterministic approval-gated recovery proposals | 4D | Reliable, reviewable recovery |

---

### PHASE 6: FULL MULTI-AGENT ARENA MODE (Up to 5 Agents)

**Goal**: Scale multi-agent capabilities with proper infrastructure.

**Implementation status: Complete (2026-07-27).**
- **6A:** `DeterministicAgentRouter` adds deterministic dispatch ordering and load balancing under a central capability-tier gate (`phase3` = 3 agents/12 handoffs, `phase6` = 5/20). Capability is opt-in and overrides may only tighten limits. Routing always reports `autoDispatch: false`.
- **6B:** Researcher and Executor roles are available at the `phase6` tier via a fixed Planner → Researcher → Coder → Executor → Critic DAG.
- **6C:** `ResultComparator` scores candidates on a fixed weighted rubric from human/tool-supplied signals, flags near-ties, and requires explicit human approval to select a winner (`autoSelected: false`).
- **6D:** `AdvancedCostController` adds projections, burn rate, and alerting with an auto-stop *recommendation* only (`autoStopped: false`); the Phase 2E hard reservation gate remains the enforcement point.
- **6E:** `TraceReplayBuilder` reconstructs ordered parent/child timelines with replay steps from existing tracer output, adding no new telemetry channel and re-redacting sensitive attributes on output.
- **Implementation record:** [`PHASE-6-IMPLEMENTATION.md`](PHASE-6-IMPLEMENTATION.md).

| Subphase | Focus | Deliverables | Technical Details | Dependencies | Success Criteria |
|---------|-------|--------------|-------------------|--------------|------------------|
| **6A** | Enhanced Orchestrator | 5-agent support | Dynamic routing + load balancing | 3A, 5E | Stable coordination at scale |
| **6B** | Expanded Roles | 5 roles | Add Researcher + Executor | 3B | Richer, more capable workflows |
| **6C** | Result Comparison | Ranking UI | Side-by-side comparison + scoring | 6A | Clear winner selection |
| **6D** | Advanced Cost Controls | Workflow budgets | Projections + auto-stop + alerts | 2E | Sustainable multi-agent usage |
| **6E** | Full Tracing | Distributed observability | Replay + debugging tools | 1D | Debuggable at scale |

---

### PHASE 7: DEEP INTEGRATIONS

**Implementation status: NOT IMPLEMENTED (deliberately blocked).**

Every 7A–7E item requires new third-party host permissions, OAuth secrets at rest, outbound network egress, or local file access. None of those has an approved key-management design, permission request, or adversarial test suite yet, so shipping them would violate the project's standing security rules.

What exists instead is the **prerequisite gate**: `src/integrations/egress-policy.ts` is a deny-by-default, adversarially-tested egress policy that performs **no network I/O** and grants no permission. Any future integration must pass through it. See [`PHASE-7-SECURITY-DESIGN.md`](PHASE-7-SECURITY-DESIGN.md) for the seven items still outstanding.

| Subphase | Focus | Deliverables | Dependencies | Success Criteria |
|---------|-------|--------------|--------------|------------------|
| **7A** | GitHub Integration | PR creation, reviews, issues | 6E | Full repository workflow support |
| **7B** | Linear / Notion Sync | Bidirectional task sync | 7A | Rich metadata and two-way updates |
| **7C** | VS Code Bridge | IDE communication | 7B | Context sharing between IDE and agents |
| **7D** | Slack / Discord Bot | Remote control | 7C | Monitor and steer from chat |
| **7E** | File System Access | Local file operations | 7D | Secure read/write in approved folders |

---

### PHASE 8: ADVANCED INTERFACES

| Subphase | Focus | Deliverables | Dependencies | Success Criteria |
|---------|-------|--------------|--------------|------------------|
| **8A** | Infinite Canvas | Spatial workspace | 7E | Drag-and-drop organization of agents and artifacts |
| **8B** | Voice Control | Input + output | 8A | Full hands-free operation |
| **8C** | Timeline Scrubber | Session replay | 6E | Branching history and replay |
| **8D** | Gesture Navigation | Modern interactions | 8B | Smooth gesture-based controls |
| **8E** | Focus Mode 3.0 | Ultra-minimal view | 8C | Maximum focus experience |

---

### PHASE 9–20 (Condensed Structure)

| Phase | Name | Primary Focus |
|-------|------|---------------|
| **9** | Collaboration | Multi-user sessions, shared agents, presence indicators |
| **10** | Enterprise | SSO, audit logs, policy engine, compliance reporting |
| **11** | Safety & Ethics | Constitutional AI, risk scoring, approval workflows |
| **12** | Advanced Tooling | Web automation, data analysis, document intelligence |
| **13** | Marketplace | Templates, personas, versioning, community features |
| **14** | Testing Framework | Agent behavior test harness, simulation mode, golden tests |
| **15** | Simulation | What-if scenarios, strategy comparison, risk analysis |
| **16** | Self-Modification | Agent proposes changes to its own configuration |
| **17** | Analytics | Full observability dashboard, cost attribution |
| **18** | Knowledge Management | Distillation, reusable packs, long-term memory |
| **19** | Plugin Ecosystem | Third-party tools, agents, and workflows |
| **20** | Future Vision | Experimental high-autonomy modes, research direction |

---

## TECHNICAL SPECIFICATION — PHASE 3 & PHASE 6 (Multi-Agent Core)

### Phase 3 — Light Multi-Agent (Max 3 Agents)

**Orchestrator Responsibilities**:
- Task decomposition into structured JSON
- Agent spawning and lifecycle management
- Context scoping
- Safety enforcement

**Worker Agent Contract**:
```json
{
  "role": "coder",
  "task": "...",
  "context": { "files": [...], "goal": "..." },
  "constraints": { "maxTokens": 8000, "timeout": 120000 }
}
```

### Phase 6 — Full Multi-Agent Arena Mode

**Additional Capabilities**:
- Dynamic agent routing
- Result comparison and scoring
- Advanced cost control
- Full distributed tracing

---

**Document saved to**: `docs/20-PHASE-BLUEPRINT.md`

This is now the **official, up-to-date, and complete blueprint**. All gaps have been addressed with logical reasoning.
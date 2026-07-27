# ⚡ Arena Agent Mode Pro

> **v8.0.0 — Chrome Extension**
>
> A Manifest V3 Chrome extension for transparent, safety-first assistance in [Arena.ai](https://arena.ai) Agent Mode.

Arena Agent Mode Pro is moving from a Tampermonkey userscript to a Chrome extension so it can offer durable background infrastructure, native browser surfaces, stronger safety boundaries, and—only after the foundation is complete—carefully governed multi-agent workflows.

## Current implementation status

**Phases 0 through 6 are complete**, along with Phase 8C, 8E, 10 (local half), 11, and 14. Phase 7 integrations are deliberately **not** implemented — see [Security posture](#security-posture) below.

Work is sequenced by real dependency rather than by phase number, and anything that would need an unjustified permission is left explicitly blocked rather than stubbed.

| Phase | Scope | Status |
|---|---|---|
| **0A–0E** | MV3 scaffold, core utilities, signed Content Bridge, hybrid storage, test foundation | ✅ Complete |
| **1A–1E** | Scoped DOM observer, centralised runtime, recovery, tracing, performance budgets | ✅ Complete |
| **2A–2E** | Side Panel, command palette, notifications, modal system, cost governance | ✅ Complete |
| **3A–3E** | Deterministic 3-agent orchestration, typed contracts, context scoping, approval-only dashboard | ✅ Complete |
| **4A–4E** | Memory graph, causal debugger, reflection, health monitoring, analytics | ✅ Complete |
| **5A–5E** | Background state, schedules, internal triggers, hibernation, recovery snapshots | ✅ Complete |
| **6A–6E** | Capability tiers (up to 5 agents), routing, expanded roles, comparison, advanced cost controls, trace replay | ✅ Complete |
| **7A–7E** | GitHub / Linear / VS Code / Slack / file system | ⛔ **Blocked by design** — egress gate and threat model delivered, integrations withheld |
| **8C, 8E** | Timeline scrubber (session replay) and Focus Mode 3.0 | ✅ Complete |
| **8A, 8B, 8D** | Infinite canvas, voice control, gestures | ⛔ Blocked — need 7E file access or microphone permission |
| **14** | Agent behavior testing framework, simulation mode, golden tests | ✅ Complete |
| **10 (partial)** | Tamper-evident audit log and policy engine (SSO/reporting blocked) | ✅ Complete |
| **11** | Safety & ethics — constitutional rules, risk scoring, approval workflows | ✅ Complete |
| **9, 12, 13, 15–20** | Collaboration, advanced tooling, marketplace, simulation, and beyond | ⬜ Not started |

### Invariants that hold across every completed phase

These are enforced in code and asserted in tests, not merely documented:

- **No automatic execution.** No model invocation, tool execution, tab launch, schedule run, or trigger run happens without explicit human approval. Approval-gated APIs take a literal `approvedByHuman: true` and throw otherwise.
- **Deterministic orchestration.** Planning, routing, scoring, and recovery are code. No LLM makes a coordination decision.
- **Least privilege.** The manifest grants `alarms`, `notifications`, `sidePanel`, `storage`, and Arena hosts only — nothing else, verified by a manifest test.
- **Bounded, redacted telemetry.** Traces hold primitives only; replay re-redacts sensitive keys on output.
- **No page-facing command channel.** The Content Bridge is HMAC-signed, replay-protected, and accepts no `window.postMessage`.
- **No dead code.** A reachability test walks the real import graph from every entry point and fails if a module ships untested-in-practice, so a "complete" phase is actually running.

## Development

### Prerequisites

- Node.js **20.19+** (the current dependency set is tested with Node 22)
- Google Chrome **114+** for the Side Panel API

### Install and build

```bash
git clone https://github.com/Warzonesiddiki/arena.ai-script.git
cd arena.ai-script
npm install
npm run build
```

`npm run build` type-checks TypeScript, bundles every extension entry point, copies extension assets, and verifies that every manifest reference exists in `dist/`.

### Load the development extension

1. Run `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository’s `dist/` directory.
5. Open an `https://arena.ai/` page and use the extension toolbar action / Side Panel.

For development rebuilds:

```bash
npm run watch
```

Reload the unpacked extension in `chrome://extensions` after webpack emits a new build.

## Testing

```bash
npm test
```

The current suite runs:

1. The extension type-check, production build, and Manifest V3 artifact validation.
2. Jest unit tests—with an 80% coverage threshold—for the ported core runtime and service worker.
3. The retained v7.2 userscript syntax, smoke, and regression checks.

Run `npm run ci` locally (or in an external CI provider) to perform the runtime dependency audit and full suite. The repository workflow file is intentionally deferred because this branch token cannot publish GitHub Actions workflow changes.

## Repository layout

```text
extension/public/       Static extension assets copied unchanged to dist/
  manifest.json         Manifest V3 declaration and least-privilege permissions
  popup/                Popup HTML
  sidepanel/            Native Side Panel HTML
  options/              Options-page HTML
src/
  analytics/            Deterministic performance analytics
  audit/                Tamper-evident append-only audit hash chain
  safety/               Constitutional risk and policy engine
  background/           Service worker, orchestration service, durable control state
  bridge/               Signed Content Bridge protocol, session manager, safe DOM ops
  commands/             Command palette index and modal
  comparison/           Phase 6C result comparison and scoring
  core/                 ModuleRegistry, EventBus v2, TickDispatcher, buildModal
  debugging/            Causal trace debugger
  governance/           Cost reservations and Phase 6D advanced controls
  health/               Orchestration health monitoring
  hibernation/          Phase 5D compressed workflow hibernation
  integrations/         Deny-by-default egress policy (no network I/O)
  memory/               Scoped agent memory graph
  notifications/        Grouped notification center
  observability/        DOM observer, tracer, trace replay, performance monitor
  orchestration/        Capability tiers, deterministic planner, router, safety guard
  recovery/             Phase 5E recovery snapshots and proposals
  reflection/           Post-task reflection reports
  reliability/          Error recovery manager
  scheduling/           Approval-gated schedules
  testing/              Agent behavior harness and simulation mode
  timeline/             Session replay scrubber with bookmark branching
  focus/                Focus Mode 3.0 priority projection
  triggers/             Approval-gated internal triggers
  sidepanel/ popup/ options/ content/ shared/   Extension surfaces
scripts/                Build cleanup and asset-copy steps
tests/                  Extension artifact validation + legacy regression tests
docs/                   Blueprint and implementation records
arena-agent-mode-pro.user.js  Legacy v7.2 userscript, retained during migration
```

`dist/` is generated and intentionally ignored by Git; it is the only directory that should be loaded as an unpacked extension.

## Security posture

The extension requests **no** blanket `<all_urls>` access, no network egress beyond Arena, and no file-system access.

- **Content Bridge** — HMAC-signed and replay-protected, bound to the extension ID, Arena HTTPS origin, tab, and frame. It exposes no page-facing message channel and accepts no arbitrary selectors, HTML, scripts, or URLs.
- **Approval by default** — schedules and triggers create `approvedForExecution: false` due runs only. Hibernation resume, snapshot restore, and result selection all require explicit approval.
- **Capability tiers** — the 5-agent Phase 6 ceiling is opt-in. The default tier remains Phase 3's stricter 3-agent limit, and an override may only tighten a limit, never widen it.
- **Cost governance** — hard microdollar reservation gates fail closed. Phase 6D's "auto-stop" is a *recommendation*; it never terminates work.
- **Integrity checks** — hibernated records and recovery snapshots carry digests; tampered or approval-forged records are rejected on load.
- **Egress policy** — `src/integrations/egress-policy.ts` is a deny-by-default gate for future integrations. It performs no network I/O, and a test asserts this against the source text. See [`docs/PHASE-7-SECURITY-DESIGN.md`](docs/PHASE-7-SECURITY-DESIGN.md).

## Legacy userscript

The v7.2.0 userscript is still available for compatibility while migration proceeds. It is not the v8 runtime and should not receive new v8 capabilities. Its existing regression suite remains in CI coverage until the corresponding extension modules are ported and validated.

## License

MIT © Arena Agent Mode Pro contributors

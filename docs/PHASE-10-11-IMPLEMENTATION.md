# Phase 10 and 11 Implementation — Audit Log and Safety Policy Engine

**Status:** Audit log (Phase 10) and risk/policy engine (Phase 11) complete. SSO and compliance reporting deliberately not implemented.

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 9–20](20-PHASE-BLUEPRINT.md#phase-920-condensed-structure)

Both modules reinforce the project's existing product principles and add **no browser permission**, no network access, and no automatic execution.

---

## Scope taken and scope declined

| Item | Status | Reason |
|---|---|---|
| **10** Audit logs | ✅ Complete | Pure local logic over the existing storage layer |
| **10** Policy engine | ✅ Complete | Delivered as the Phase 11 risk engine |
| **10** SSO | ⛔ Not implemented | Requires an identity provider, OAuth, and secrets at rest — same blockers as Phase 7 |
| **10** Compliance reporting | ⛔ Not implemented | Reporting *out* means egress; the audit summary covers local reporting |
| **11** Constitutional AI / risk scoring / approval workflows | ✅ Complete | Deterministic rules; no model in the loop |

---

## Phase 11 — Risk and Policy Engine

`src/safety/risk-policy-engine.ts` is a deterministic, rule-based classifier for *proposed* actions. It runs **before** anything reaches an approval gate and can only ever make the system more restrictive.

Three properties make it trustworthy:

1. **It never approves anything.** The most permissive verdict is `allow`, which explicitly means "may proceed to the normal human approval gate" — not "is approved". Every decision carries `autoApproved: false`.
2. **The most restrictive verdict wins.** Rules are evaluated in a fixed order and verdicts are ranked (`allow` < `require-justification` < `require-approval` < `deny`), so adding a rule can never accidentally loosen policy. A `deny` cannot be overridden even by human approval.
3. **Risk never falls below an inherent floor.** Each action kind has a baseline (`file-write` and `network-egress` are `critical`; `tool-execution` and `page-mutation` are `high`). A rule may raise risk, never lower it.

A rule predicate that **throws fails closed** — it produces a `deny` finding rather than being silently skipped.

### Built-in constitutional rules

These encode standing product principles as code rather than convention:

| Rule | Verdict |
|---|---|
| `no-unreviewed-egress` | require-approval |
| `no-unreviewed-file-write` | require-approval |
| `deny-out-of-scope` | **deny** |
| `irreversible-requires-justification` | require-justification |
| `tool-execution-approval` | require-approval |
| `page-mutation-approval` | require-approval |
| `expensive-action-approval` (> $1.00) | require-approval |
| `costly-action-justification` (> $0.25) | require-justification |

`gate()` combines the verdict with what the human actually supplied, and its success message still says the standard approval gate applies.

---

## Phase 10 — Tamper-Evident Audit Log

`src/audit/audit-log.ts` records governance-relevant decisions as an **append-only hash chain**. Each entry's digest covers the previous entry's digest, so editing or removing any entry breaks verification for everything after it.

### An honest security claim

> This is **tamper-evident, not tamper-proof.** A local attacker who can rewrite storage could recompute the entire chain. It defends against silent corruption and accidental mutation, which is what an in-browser audit trail can honestly promise. Real non-repudiation would require a signing key held off-device.

That limitation is stated in the module's own doc comment rather than buried here.

### Design details

- **Append-only by construction**, not by convention: there is no `update` or `delete` for an individual entry, and a test asserts those methods do not exist.
- **Two distinct tamper detections** are tested separately: a *modified* entry fails its own digest, while a *removed* entry is caught by a broken chain link even though every surviving entry is individually intact.
- **Rotation is recorded, not hidden.** When the log exceeds its bound the oldest entries are dropped and `rotatedBefore` records where the chain legitimately now starts, so a verifier does not mistake rotation for tampering. Sequence numbers keep increasing across rotation.
- **Secrets never accumulate.** Detail keys matching secret/token/apiKey/password/credential/authorization/cookie/prompt/completion/conversation are redacted on write, non-primitive values become `[redacted]`, and both keys and values are bounded.
- Queryable by category, outcome, subject, time, and limit, with a bounded local `summary()` that includes live chain verification.

---

## Safety boundaries

Neither module:

- approves, executes, launches, or cancels anything,
- adds any permission, host access, network, or file access,
- puts a model in the decision loop,
- opens a page-facing channel, or
- stores prompts, conversations, file contents, secrets, or tool output.

## Validation

```bash
npm run ci
```

- 46 suites / 257 tests passing
- 0 runtime vulnerabilities
- 93.35% statements / 86.77% branches
- safety 100%, audit 97.76% statements

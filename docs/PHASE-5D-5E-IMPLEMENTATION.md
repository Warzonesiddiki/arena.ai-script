# Phase 5D–5E Implementation — Hibernation and Recovery v2

**Status:** Complete

**Implemented:** 2026-07-27

**Blueprint reference:** [Phase 5D and 5E](20-PHASE-BLUEPRINT.md#phase-5-persistence--scheduling)

Phase 5D and 5E complete Phase 5. Neither adds a browser permission, a network call, automatic execution, or a page-facing channel.

---

## Phase 5D — Hibernation

### Scope delivered

`src/hibernation/hibernation-manager.ts` compresses long-idle Phase 3 control-plane state into a minimal, integrity-checked record and restores it on demand.

| Artifact | Responsibility |
|---|---|
| `src/hibernation/hibernation-manager.ts` | Idle evaluation, compression, digest integrity, approval-gated resume, retention pruning |
| `tests/unit/hibernation/hibernation-manager.test.ts` | Compression, round-trip, approval gates, recommendation rules, retention, tamper rejection |

### Compression strategy

A `BackgroundAgentControlState` is reduced to a `HibernatedWorkflowRecord`. The three **derived presentation fields** are deliberately dropped rather than stored:

| Field | Why it is not stored |
|---|---|
| `progress` | Pure function of `status` |
| `canApprove` | Pure function of status, approval, and dependency state |
| `approvalBlockedReason` | Pure function of dependency status/approval |

They are recomputed during `resume()`, so a hibernated record is smaller and — more importantly — **cannot drift out of sync** with the status it describes.

### Approval model

| Operation | Approval | Reasoning |
|---|---|---|
| `evaluate()` | None | Pure read-only recommendation |
| `hibernate()` | None | A reversible local storage optimisation that starts and stops nothing |
| `peek()` / `list()` | None | Read-only inspection |
| `resume()` | **Required** | Returns an actionable control plane whose prior approvals become live again |
| `discard()` | **Required** | Destructive |
| `prune()` | None | Deletion of expired records only, never execution |

### Recommendation rules

`evaluate()` reports `idle-timeout` (default 30 min), `suspended`, and `no-runnable-work`. A workflow with a **running** task is never recommended for hibernation even when long idle.

### Bounds and integrity

- ≤ 20 hibernated workflows, ≤ 3 roles each, ≤ 1,000 goal chars, ≤ 120 title chars.
- 30-day default retention via `prune()`.
- Re-hibernating a plan replaces its record rather than duplicating it.
- Each record carries a deterministic FNV-1a `digest` over canonical content. A tampered record, or one forged to `resumeApprovalRequired: false`, is rejected on load **and** on resume.

---

## Phase 5E — Recovery v2

### Scope delivered

`src/recovery/recovery-snapshot-manager.ts` captures bounded control-plane snapshots and derives a deterministic, fully approval-gated recovery proposal.

| Artifact | Responsibility |
|---|---|
| `src/recovery/recovery-snapshot-manager.ts` | Snapshot capture, per-plan ring buffer, integrity digests, recovery proposal, approval-gated restore |
| `tests/unit/recovery/recovery-snapshot-manager.test.ts` | Capture, ring buffer, proposal ordering, progress-loss accounting, approval gates, tamper rejection |

### Snapshot capture

Triggers: `manual`, `pre-approval`, `post-transition`, `health-degraded`, `periodic`. Capturing is a read-only observation of state that already exists, so it needs no approval; **restoring does**.

Snapshots store task ID, role, title, status, dependencies, approval flag, and estimated cost. They store no prompts, conversations, file contents, tool output, or secrets — asserted directly in tests.

### Per-plan ring buffer

Retention is **per plan** (default 10, ≤ 10 plans). A busy workflow can therefore never evict another workflow's recovery history — a subtle correctness property covered by a dedicated test.

### Recovery proposal

`proposeRecovery()` selects the newest snapshot for the plan that **does not itself contain a failed task**, so a rollback is a genuine step back to safety rather than a return to the same broken state. Steps are emitted in fixed order:

1. `resume-from-snapshot`
2. `reset-failed-task` (per failed task)
3. `investigate-blocker` (per blocked task)
4. `reapprove-task` (per task whose snapshot approval no longer holds)

If nothing is wrong, a single `no-action-required` step is returned. The proposal is always `autoExecutable: false`, and every actionable step carries `requiresApproval: true`. **Snapshot approvals are never carried forward silently** — restoring a snapshot in which a task was approved still emits an explicit `reapprove-task` step.

### Progress-loss accounting

`progressLossCount` counts tasks that would regress. `blocked` and `failed` rank as *zero* forward progress, so rolling out of them is correctly scored as a gain rather than a loss; only `running` and `completed` represent work a rollback would discard. Confidence (`high`/`medium`/`low`) is derived deterministically from snapshot availability, failure count, progress loss, and health.

> A unit test caught the original implementation ranking `blocked` above `pending`, which wrongly inflated progress loss when recovering from a blocked task. The ranking is now documented in code.

---

## Safety boundaries

Phase 5D and 5E do **not**:

- launch browser tabs, invoke models, execute tools, or approve tasks,
- restore or hibernate automatically,
- read or write Arena DOM,
- add permissions, host access, network, or file access,
- open a page-facing command channel, or
- store prompts, conversations, file contents, secrets, or tool output.

## Validation

```bash
npm run typecheck
npm run build
npm run test:unit
npm test
npm run ci
```

## Next step

Phase 5 is complete. Proceed to **Phase 6A — Enhanced Orchestrator**, which may raise the agent cap from 3 to 5 under an explicit, tested capability gate.

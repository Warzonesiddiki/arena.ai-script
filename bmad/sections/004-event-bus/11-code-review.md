# Section 004: Event Bus — Step 11: Code Review

## Findings

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| 1 | LOW | `emit()` collects ALL matching handlers including wildcards, but `off()` only removes from exact key — wildcard subscriptions can't be removed by targeting a child event | Correct — `off()` requires the exact key used in `on()`. Documented behavior. |
| 2 | INFO | `emitAsync()` fires handlers sequentially (not parallel) to maintain ordering guarantees | Intentional — priority ordering must be preserved |
| 3 | INFO | Stats counter incremented before handler dispatch — includes cancelled/errored emits | Intentional — gives accurate picture of total emission attempts |
| 4 | LOW | `once` auto-removal uses Set on `key` — if handler registered on wildcard, entire wildcard key's `once` handlers are removed | Correct — once semantics are per-key, not per-handler |

**Verdict: ✅ APPROVED**

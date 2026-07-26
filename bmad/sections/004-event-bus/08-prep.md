# Section 004: Event Bus — Prep

## Pre-implementation Checklist

- [x] Codebase reviewed — EventBus IIFE at line ~583
- [x] All 58 existing call sites analyzed — all use compatible API
- [x] No breaking changes — `on` signature extended with `priority` only
- [x] Dependencies — none (EventBus is dependency-free, other modules depend on it)
- [ ] No test suite — syntax check with `node --check`
- [x] Backward compatibility verified — `off()` still accepts handler, empty cleanup is additive

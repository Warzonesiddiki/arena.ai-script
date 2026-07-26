# Section 001: Architecture & Boot Sequence — Step 8: Sprint Plan

## Sprint Backlog

| ID | Story | Tasks | Est. (hrs) | Owner | Status |
|----|-------|-------|------------|-------|--------|
| S1.1 | Core ModuleRegistry | register, getModule, getStatus, getError, getAll, getByPhase, boot, destroyAll, routeChange, configChange | 2 | Dev | ⏳ Pending |
| S1.2 | Module Interface Conversion | Convert 40+ modules to registered format | 3 | Dev | ⏳ Pending |
| S2.1 | Phase-Based Boot | Replace monolithic init, progress logging, boot:complete event, beforeunload/pagehide handlers | 1.5 | Dev | ⏳ Pending |
| S2.2 | Lifecycle Hooks | route:change → routeChange, config:change → configChange, agent activation hooks | 1 | Dev | ⏳ Pending |
| S3.1 | Dead Code Removal | Remove 4 unused functions, replace var with const/let (3 files) | 0.5 | Dev | ⏳ Pending |
| S3.2 | CSS Pipeline Unification | Merge injectBaseStyles + injectPhaseCSS into ThemeEngine | 0.5 | Dev | ⏳ Pending |
| S4.1 | AgentToolTracker Fix | Define or guard AgentToolTracker references | 0.5 | Dev | ⏳ Pending |
| S5.1 | Modal Factory | createModal factory, refactor 4 modals | 1 | Dev | ⏳ Pending |

## Total Estimated Sprint Time: 10 hours

## Sprint Priorities
1. **Must Have** (Foundation): S1.1, S1.2, S2.1 — Core architecture, without this nothing works
2. **Should Have** (Quality): S3.1, S3.2, S4.1 — Dead code and crash fixes
3. **Nice to Have** (Polish): S2.2, S5.1 — Lifecycle hooks and modal factory

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Module conversion breaks existing functionality | Medium | High | Test each converted module individually |
| Registry boot doesn't match old init ordering | Low | High | Compare boot logs between old and new |
| `destroyAll()` causes issues with modules that don't expect it | Medium | Medium | Wrap each destroy in try/catch |
| GM_* API calls fail in some environments | Low | Medium | Keep try/catch guards on GM_* calls |

## Definition of Done
- [ ] `node --check` passes
- [ ] All tests pass (manual: boot sequence runs without errors)
- [ ] No console errors on arena.ai/agent
- [ ] All module statuses are 'ready' after boot
- [ ] Dead code removed (verified by grep)
- [ ] All `var` replaced with `const`/`let`
- [ ] AgentToolTracker doesn't throw ReferenceError
- [ ] Modals use factory (no inline onclick)

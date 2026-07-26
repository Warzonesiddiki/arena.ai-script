# Section 001: Architecture & Boot Sequence — Step 7: Epics & Stories

## Epic 1: ModuleRegistry Implementation
**Story Points:** 8

### Story 1.1: Core ModuleRegistry (4 pts)
- **Tasks:**
  - [ ] Implement `ModuleRegistry` IIFE with `register()`, `getModule()`, `getStatus()`, `getError()`
  - [ ] Implement `getAll()`, `getByPhase()` methods
  - [ ] Implement `boot()` with phase iteration and try/catch per module
  - [ ] Implement `destroyAll()` with try/catch per module
  - [ ] Implement `routeChange()`, `configChange()` lifecycle dispatchers
  - [ ] Add JSDoc-style comments to all public methods
- **Acceptance Criteria:**
  - Registering a module stores it and returns it via `getModule()`
  - `boot()` initializes modules in phase order
  - A throwing module doesn't block others
  - `destroyAll()` calls destroy on all modules
  - `getStatus()` returns the correct lifecycle state

### Story 1.2: Module Interface Conversion (4 pts)
- **Tasks:**
  - [ ] Convert Config to `ModuleRegistry.register('config', {phase:0, init, ...})`
  - [ ] Convert EventBus to `ModuleRegistry.register('eventBus', {phase:0, init, ...})`
  - [ ] Convert State to `ModuleRegistry.register('state', {phase:0, deps:['config','eventBus'], init})`
  - [ ] Convert DOMObserver to `ModuleRegistry.register('domObserver', {phase:0, init, destroy})`
  - [ ] Convert ThemeEngine to `ModuleRegistry.register('themeEngine', {phase:1, init, ...})`
  - [ ] Convert HUD to `ModuleRegistry.register('hud', {phase:1, init, destroy})`
  - [ ] Convert KeyboardModule to `ModuleRegistry.register('keyboard', {phase:2, init})`
  - [ ] Convert CommandPalette to `ModuleRegistry.register('commandPalette', {phase:2, init})`
  - [ ] Convert all remaining modules (phase 3-5)
- **Acceptance Criteria:**
  - Every module previously initialized in `init()` is now registered with ModuleRegistry
  - No module is initialized outside the boot sequence
  - `boot()` replaces the old manual init calls
  - Module count includes only registered modules

## Epic 2: Boot Sequence Refactor
**Story Points:** 5

### Story 2.1: Phase-Based Boot Implementation (3 pts)
- **Tasks:**
  - [ ] Replace monolithic `init()` try/catch with phase-based iteration
  - [ ] Add boot progress logging per phase
  - [ ] Emit `'boot:complete'` event after all phases
  - [ ] Add 3+ failure toast threshold
  - [ ] Register `beforeunload` → `destroyAll()`
  - [ ] Register `pagehide` → `destroyAll()`
- **Acceptance Criteria:**
  - Boot sequence iterates phases 0-6
  - Console shows per-phase status
  - `boot:complete` event fires after all phases
  - Page unload triggers `destroyAll()`

### Story 2.2: Lifecycle Hook Integration (2 pts)
- **Tasks:**
  - [ ] On `EventBus 'route:change'`, call `ModuleRegistry.routeChange()`
  - [ ] On `EventBus 'config:change'`, call `ModuleRegistry.configChange()`
  - [ ] Add `onActivate`/`onDeactivate` hooks for agent mode toggle
- **Acceptance Criteria:**
  - Route changes dispatch to all modules with `onRouteChange`
  - Config changes dispatch to all modules with `onConfigChange`
  - Agent mode activation/deactivation dispatches to all modules with `onActivate`/`onDeactivate`

## Epic 3: Code Cleanup
**Story Points:** 3

### Story 3.1: Dead Code Removal (2 pts)
- **Tasks:**
  - [ ] Remove `sleep()` function
  - [ ] Remove `escapeRegex()` function
  - [ ] Remove `throttle()` function
  - [ ] Remove `formatTimeAgo()` function
  - [ ] Replace `var` with `const`/`let` in ArtifactStudio
  - [ ] Replace `var` with `const`/`let` in LeaderboardIntel
  - [ ] Replace `var` with `const`/`let` in WorkflowMacros
- **Acceptance Criteria:**
  - `grep` for `function sleep`, `function escapeRegex`, `function throttle`, `function formatTimeAgo` returns nothing
  - No `var` declarations remain in the file

### Story 3.2: CSS Pipeline Unification (1 pt)
- **Tasks:**
  - [ ] Move `injectBaseStyles()` call inside ThemeEngine
  - [ ] Move `injectPhaseCSS()` call inside ThemeEngine
  - [ ] Ensure all CSS is injected via `GM_addStyle`
- **Acceptance Criteria:**
  - Only ThemeEngine calls `GM_addStyle`
  - `injectBaseStyles()` is no longer called from init()

## Epic 4: AgentToolTracker Fix
**Story Points:** 1

### Story 4.1: Define Missing Module (1 pt)
- **Tasks:**
  - [ ] Find all references to `AgentToolTracker` and confirm if it should be a real module or a reference to an external object
  - [ ] If arena.ai doesn't provide it, create a minimal `AgentToolTracker` IIFE
- **Acceptance Criteria:**
  - `AgentToolTracker` doesn't cause `ReferenceError` at runtime
  - Either defined as a proper module or guarded with `typeof`

## Epic 5: AgentToolTracker Fix
**Story Points:** 1

### Story 5.1: Modular Modal Factory (1 pt)
- **Tasks:**
  - [ ] Implement `createModal({id, icon, title, bodyHTML})` factory function
  - [ ] Refactor SessionDashboard, SessionDiff, PerformanceAnalytics, HistoryBrowser to use factory
- **Acceptance Criteria:**
  - All 4 modals use the shared factory
  - No inline `onclick` handlers remain
  - All event binding uses `addEventListener`

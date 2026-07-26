# Section 001: Architecture & Boot Sequence — Step 4: PRD

## Requirements

### R1. ModuleRegistry Service
- **R1.1** Must expose `register(name, module)` where module conforms to the standard interface
- **R1.2** Must expose `getModule(name)` returning the module instance (or null)
- **R1.3** Must expose `getStatus(name)` returning `'registered' | 'initializing' | 'ready' | 'errored' | 'destroyed'`
- **R1.4** Must expose `getAll()` returning all registered modules
- **R1.5** Must expose `getByPhase(phase)` returning modules in a given phase
- **R1.6** Must expose `destroyAll()` calling destroy on every registered module
- **R1.7** Must resolve dependencies before init — if module A depends on module B, B must init first
- **R1.8** Must detect circular dependencies and log a warning
- **R1.9** Must be initialized before any other module

### R2. Standardized Module Interface
- **R2.1** Every module must have a `name` property (string, unique)
- **R2.2** Every module must have a `deps` property (array of dependency names, may be empty)
- **R2.3** Every module must have a `phase` property (number 0-6)
- **R2.4** Every module must have an `init()` function that returns void
- **R2.5** Every module may have a `destroy()` function (optional)
- **R2.6** Every module may have `onRouteChange(url)`, `onConfigChange(key,val)`, `onStateChange(key,val,old)` hooks (optional)

### R3. Phase-Based Boot Sequence
- **R3.1** Boot must proceed in ordered phases: 0, 1, 2, 3, 4, 5, 6
- **R3.2** Within a phase, modules may init in any order (dependencies already satisfied by phase ordering)
- **R3.3** Each module's init must be wrapped in a try/catch
- **R3.4** If a module init throws, its status is set to 'errored', dependencies of other modules still init
- **R3.5** After all phases complete, a `'boot:complete'` event must be emitted
- **R3.6** Boot progress must be logged to console

### R4. Error Isolation
- **R4.1** No single module failure may prevent other modules from initializing
- **R4.2** Errored modules must be caught and logged with `warn()`
- **R4.3** A toast notification must be shown if 3+ modules fail
- **R4.4** The module registry must retain the error for later inspection

### R5. Lifecycle Hooks
- **R5.1** When `EventBus` emits `'route:change'`, all modules with `onRouteChange` must be called
- **R5.2** When `Config` changes (via `config:change` event), all modules with `onConfigChange` must be called
- **R5.3** When `EventBus` emits `'beforeunload'`, `ModuleRegistry.destroyAll()` must be called
- **R5.4** When `EventBus` emits `'pagehide'`, `ModuleRegistry.destroyAll()` must be called

### R6. CSS Pipeline
- **R6.1** Base CSS (global variables, resets, shared classes) must be injected before Phase 1
- **R6.2** Phase CSS may be injected during the module's init
- **R6.3** Theme CSS must be managed by ThemeEngine, not inline styles
- **R6.4** All CSS must be injected via `GM_addStyle` or equivalent

### R7. Cleanup
- **R7.1** `destroy()` must be called on every registered module on pagehide/beforeunload
- **R7.2** Each module's destroy must be wrapped in try/catch
- **R7.3** After destroy, module status must be set to 'destroyed'

### R8. Dead Code Elimination
- **R8.1** Remove `sleep()` function — unused
- **R8.2** Remove `escapeRegex()` function — unused
- **R8.3** Remove `throttle()` function — unused
- **R8.4** Remove `formatTimeAgo()` function — unused
- **R8.5** Replace `var` with `const`/`let` in ArtifactStudio, LeaderboardIntel, WorkflowMacros

### R9. Documentation
- **R9.1** ModuleRegistry interface must be documented in a comment header
- **R9.2** Standard module interface must be documented
- **R9.3** Phase ordering must be documented

# Section 001: Architecture & Boot Sequence — Step 1: Brainstorming

## First Principles Analysis

**What is the fundamental purpose of the architecture?**
- Load and initialize 59+ independent modules in the correct order
- Provide shared services (Config, State, Events, Storage) that all modules depend on
- Handle errors gracefully without breaking the entire script
- Clean up resources when the page unloads or route changes
- Be extensible — adding new modules shouldn't require modifying the boot sequence

**What are the atomic primitives?**
1. Module — isolated unit of functionality with init/destroy
2. Service — singleton providing cross-module capability (Config, State, EventBus, Storage)
3. Phase — ordered group of modules that initialize together
4. Boot Sequence — the orchestration that initializes phases in order

**What can we eliminate?**
- Free-standing `toast()` function → move into proper module
- `injectBaseStyles()` and `injectPhaseCSS()` → merge into ThemeEngine
- Unused utility functions (`sleep`, `escapeRegex`, `throttle`, `formatTimeAgo`)
- Empty stub objects (ThemeEditor, NotificationCenter, etc.) → either implement or remove
- Duplicate `formatDuration` in HUD and ExportEngine
- Inline `onclick` handlers in modal HTML → programmatic event binding

**What should be inverted?**
- Boot sequence: instead of a hardcoded list of 40+ `ModuleName.init()` calls, use a Module Registry that auto-discovers and orders initialization
- Module dependencies: instead of modules checking `typeof OtherModule !== 'undefined'`, use a Dependency Injection pattern where modules declare dependencies and get them injected

## SCAMPER Analysis

**Substitute:**
- `typeof X !== 'undefined'` guards → proper module registry with `getModule(name)` API
- Manual init ordering → declarative dependency declarations
- Free-standing utilities → ModuleRegistry utility module

**Combine:**
- `injectBaseStyles()` + `injectPhaseCSS()` → single CSS injection pipeline
- All modal HTML builders → single `createModal()` factory
- HUD + ToolTiming → could merge timing into HUD widget

**Adapt:**
- Boot sequence pattern from Angular/module loaders (NgModule-like registration)
- Plugin architecture from VS Code (contribution points)
- Error boundaries from React (per-module try/catch with isolation)

**Modify:**
- Module interface from `{init, open, close, toggle}` to `{name, deps, init, destroy, onRouteChange, onConfigChange}`
- State from flat Proxy → nested namespace proxy with computed properties
- EventBus from simple emit/on → prioritized middleware chain

**Put to another use:**
- The boot sequence could double as a health check / status reporter
- Module registry could power a "Module Manager" UI panel

**Eliminate:**
- All `var` → `const`/`let` consistently
- All unused utility functions
- All empty stubs that don't serve a purpose
- Inline styles → CSS classes

**Rearrange:**
- Module definitions: currently mixed across the file. Group: services → utilities → UI modules → agent modules → exploit modules
- Initialization: move from single monolithic `init()` → phase-based init with progress reporting

## Ideation Map

```
                    ┌─────────────────────────┐
                    │     ModuleRegistry       │
                    │  register(name, module)  │
                    │  getModule(name)         │
                    │  getStatus()             │
                    └────────┬────────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        │                        │
    ▼                        ▼                        ▼
┌─────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Services   │    │   Boot Loader    │    │   Module API     │
│  (Config,    │    │  Phase-based     │    │  Standardized    │
│   State,     │    │  ordered init    │    │  Interface       │
│   Events,    │    │  with error      │    │  + Lifecycle     │
│   Storage)   │    │  isolation       │    │  Hooks           │
└─────────────┘    └──────────────────┘    └──────────────────┘
```

## Key Brainstorming Outcomes

### 1. Module Interface Standard
```js
// Every module must conform to:
{
  name: 'moduleName',        // unique identifier
  deps: ['config', 'state'], // dependency names
  phase: 1,                  // init phase (1-5)
  init(opts) {},             // called during boot
  destroy() {},              // called on cleanup
  onRouteChange(url) {},     // optional route handler
  onConfigChange(key,val) {},// optional config watcher
  state: {}                  // optional initial state
}
```

### 2. Boot Architecture
```
PHASE 0: Core Services (Config, State, EventBus, Storage)
PHASE 1: Infrastructure (Theme, CSS, HUD, Toast)
PHASE 2: UI Components (Settings, Palette, Keyboard, Toolbar)
PHASE 3: Agent Features (Detection, Tracking, Auto-Continue)
PHASE 4: Grey Area Suite (Session, Extraction, Speed, UI, Automation)
PHASE 5: Workspace & Content (Workspace, Artifacts, Export, History)
PHASE 6: Dev Tools & Polish (Debugger, Plugins, Docs)
```

### 3. Error Isolation
- Each module init wrapped in try/catch
- Failed module doesn't block subsequent modules
- Error reported to user via toast
- Module registry tracks success/failure status

### 4. CSS Pipeline
- Base styles injected immediately (synchronous)
- Phase CSS injected per-phase
- Theme CSS injected on theme change
- All CSS managed by ThemeEngine

### 5. Cleanup Architecture
- `window.addEventListener('beforeunload', ...)` calls all module destroy()
- Each module responsible for disconnecting observers and removing DOM elements
- ModuleRegistry.destroyAll() iterates and calls each module's destroy()

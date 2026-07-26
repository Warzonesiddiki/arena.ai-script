# Section 001: Architecture & Boot Sequence — Step 5: UX Design

## Developer Experience (DX) Design

Since this section is architectural (no user-facing features), the "UX" is the **Developer Experience** of using the module system.

### 1. Module Registration API

```js
// Minimal registration — auto-selects next phase
ModuleRegistry.register('myModule', {
  init() { /* ... */ },
  destroy() { /* ... */ }
});

// Full registration with deps and explicit phase
ModuleRegistry.register('myModule', {
  deps: ['config', 'state'],
  phase: 3,
  init() { /* ... */ },
  destroy() { /* ... */ },
  onRouteChange(url) { /* ... */ }
});

// After registration, modules are auto-initialized in boot order
```

### 2. Error Handling Flow

```
ModuleRegistry.register('x', { init: () => { throw Error('fail'); } })
    ↓
Boot sequence reaches phase containing 'x'
    ↓
ModuleRegistry calls x.init() inside try/catch
    ↓
Error caught → status set to 'errored'
    ↓
warn() logs the error with module name
    ↓
Next module continues initialization
    ↓
After boot: status available via ModuleRegistry.getStatus('x') // 'errored'
```

### 3. Boot Progress Visualization

```
Console output during boot:
  [Arena Agent Mode Pro] 🚀 Booting v7.0.0...
  [Arena Agent Mode Pro] Phase 0: Config ✅, State ✅, EventBus ✅, Storage ✅
  [Arena Agent Mode Pro] Phase 1: ThemeEngine ✅, Toast ✅, ModuleRegistry ✅
  [Arena Agent Mode Pro] Phase 2: HUD ✅, SettingsPanel ✅, CommandPalette ✅, KeyboardModule ✅
  [Arena Agent Mode Pro] Phase 3: DOMObserver ✅, MonitorModule ✅, ArtifactDetector ❌ (see above)
  [Arena Agent Mode Pro] Phase 4: 12/12 modules ✅
  [Arena Agent Mode Pro] Phase 5: 8/8 modules ✅
  [Arena Agent Mode Pro] Phase 6: 5/5 modules ✅
  [Arena Agent Mode Pro] ✅ Boot complete — 59 modules, 1 errored, 0 destroyed
```

### 4. Module Dependency Resolution

```js
// Module declares dependencies:
ModuleRegistry.register('artifactStudio', {
  deps: ['config', 'state', 'artifactDetector'],
  phase: 4,
  init() {
    // 'config', 'state', and 'artifactDetector' are guaranteed initialized
    const detector = ModuleRegistry.getModule('artifactDetector');
    detector.on('artifact:detected', this.handleArtifact.bind(this));
  }
});
```

### 5. Module Interface Template

```js
// Template for creating a new module:
const MyModule = (() => {
  // Register immediately (registry already exists when phase reaches this point)
  ModuleRegistry.register('myModule', {
    name: 'myModule',
    deps: [],
    phase: 3,
    init() {
      log('📦 My Module');
      // Setup DOM, event listeners, etc.
    },
    destroy() {
      // Cleanup: disconnect observers, remove DOM elements, remove listeners
    },
    onRouteChange(url) {
      // React to SPA route changes
    },
    onConfigChange(key, value) {
      // React to config changes
    }
  });

  // Module code continues here...
  return { /* public API */ };
})();
```

### 6. Phase Timeline

```
DOMContentLoaded
      │
      ▼
┌────────────────────────────────────────────────────────────┐
│ Phase 0: Services          (instant — sync)               │
│ Phase 1: Infrastructure    (<100ms — sync)                │
│ Phase 2: UI Components     (<200ms — DOM queries)         │
│ Phase 3: Agent Features    (<100ms — observer setup)       │
│ Phase 4: Grey Area Suite   (<100ms — feature registration) │
│ Phase 5: Content & Export  (<100ms — lazy init)           │
│ Phase 6: Dev Tools         (<50ms — stubs & registry)     │
│                                                           │
│ Total: < 650ms                                            │
└────────────────────────────────────────────────────────────┘
      │
      ▼
  'boot:complete' emitted
      │
      ▼
  Agent Mode active? → Further agent-specific init
```

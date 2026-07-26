# Section 001: Architecture & Boot Sequence — Step 2: Research

## Current Architecture Audit

| Aspect | Current State | Issue |
|--------|--------------|-------|
| Boot sequence | Monolithic `init()` with 40+ hardcoded `.init()` calls | Brittle, requires manual ordering |
| Error isolation | One try/catch wrapping entire init | One module failure kills all |
| Module interface | Inconsistent — some return `{init,open,close,toggle}`, others `{init,destroy}`, some are pure stubs | No contract enforcement |
| Dependencies | `typeof X !== 'undefined'` checks scattered | No explicit dependency graph |
| Cleanup | Only `DOMObserver.destroy()` and `HUD.destroy()` called on pagehide | Most modules have no destroy path |
| CSS injection | Two separate functions: `injectBaseStyles()` + `injectPhaseCSS()` | Duplicated pattern, no coherence |
| Unused code | `sleep()`, `escapeRegex()`, `throttle()`, `formatTimeAgo()` defined but never called | Dead weight |
| Empty stubs | ThemeEditor, NotificationCenter, ConversationSearch, etc. — 18 stub objects | ~50 lines of nothing |
| Module count | `MODULE_COUNT = 59` but 18 are empty stubs | Inflation, misleading |

## Greasemonkey/Tampermonkey Best Practices

1. **@grant minimalism** — Only grant what you use (current script declares 5 grants, all used)
2. **@run-at document-idle** — Current setting is correct for DOM-dependent scripts
3. **@match patterns** — Current `https://arena.ai/*` and `https://*.arena.ai/*` are good
4. **IIFE encapsulation** — `(function(){ 'use strict'; ... })();` is the standard pattern
5. **No external dependencies** — All code should be self-contained (current script has none)

## Module Pattern Best Practices

| Pattern | Pros | Cons |
|---------|------|------|
| IIFE returning object (current) | Simple, encapsulated, no global pollution | No DI, hard to test |
| Module Registry | Centralized, dependency-aware, observable | Extra abstraction layer |
| AMD/require style | Async, clear deps | Overkill for userscripts |
| ES modules (via bundler) | Modern, tree-shakeable | Requires build step |

**Recommended:** Enhanced IIFE pattern + ModuleRegistry for dependency management, keeping the self-contained nature of userscripts.

## Key Architectural Decisions for v7.0

### Decision 1: ModuleRegistry Service
- Central registry that modules register into
- Tracks module status (registered, initializing, ready, errored, destroyed)
- Provides dependency resolution and ordered initialization
- Enables runtime module status inspection

### Decision 2: Standardized Module Interface
```js
{
  name: String,           // unique module name
  deps: String[],         // dependency names
  phase: Number,          // boot phase (1-6)
  init: Function,         // initialization
  destroy: Function,      // cleanup
  onRouteChange: Function // optional
}
```

### Decision 3: Phase-Based Boot Sequence
```
Phase 0: Core Services     (Config, State, EventBus, Storage)
Phase 1: Infrastructure    (Theme, CSS, Toast, ModuleRegistry)
Phase 2: UI Components      (HUD, Settings, Palette, Keyboard)
Phase 3: Agent Features     (Detection, Tracking, Auto-Continue, Approval)
Phase 4: Grey Area Suite    (Session Manipulation, Extraction, Speed, UI, Automation)
Phase 5: Content & Export   (Workspace, Artifacts, Export, History)
Phase 6: Dev Tools & Final   (Debugger, Plugins, Insights, Polish)
```

### Decision 4: Error Boundary per Module
- Each module init in try/catch
- Failed module logged but doesn't block others
- Toast notification for user visibility
- Registry tracks error state

### Decision 5: Unified CSS Pipeline
- All CSS managed by ThemeEngine
- Base styles → Phase styles → Theme styles → Dynamic styles
- CSS injected via single `GM_addStyle` call per phase

### Decision 6: Full Lifecycle Hooks
- `onRouteChange(url)` — called when SPA route changes
- `onConfigChange(key, val)` — called when config changes
- `onStateChange(key, val, old)` — called when state changes
- `onActivate()` / `onDeactivate()` — called when agent mode toggles

## Competitor Analysis (Similar Userscipts)

| Script | Lines | Modules | Approach |
|--------|-------|---------|----------|
| Arena Agent Mode Pro (current) | 3,044 | 59 (18 stubs) | Flat IIFE |
| OpenAI ChatGPT Enhancement | ~2,500 | ~30 modules | Flat IIFE + init calls |
| Better ChatGPT | ~4,000 | ~50 modules | Class-based services |
| Perplexity AI Enhancer | ~1,500 | ~20 modules | Single file, no modules |

Our current script is already one of the largest. Moving to a registry pattern will make it more maintainable as it grows.

## Research Conclusions
1. Keep the IIFE-wrapped pattern (no build step needed)
2. Add a light ModuleRegistry service
3. Standardize all module interfaces
4. Implement phase-based boot with error isolation
5. Clean up unused functions and empty stubs
6. Unify CSS injection pipeline
7. Add lifecycle hooks for route/config changes

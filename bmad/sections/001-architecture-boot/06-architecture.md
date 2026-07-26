# Section 001: Architecture & Boot Sequence — Step 6: Architecture

## ModuleRegistry Design

```js
const ModuleRegistry = (() => {
  const _modules = new Map();
  const _status = new Map();
  const _errors = new Map();

  function register(name, module) {
    if (_modules.has(name)) { warn(`Module "${name}" already registered`); return; }
    const m = {
      name,
      deps: module.deps || [],
      phase: module.phase ?? 5,
      init: module.init || (() => {}),
      destroy: module.destroy || (() => {}),
      onRouteChange: module.onRouteChange || null,
      onConfigChange: module.onConfigChange || null,
      onStateChange: module.onStateChange || null,
    };
    _modules.set(name, m);
    _status.set(name, 'registered');
  }

  function getModule(name) { return _modules.get(name) || null; }
  function getStatus(name) { return _status.get(name) || null; }
  function getError(name) { return _errors.get(name) || null; }

  function getAll() { return Array.from(_modules.values()); }

  function getByPhase(phase) {
    return Array.from(_modules.values()).filter(m => m.phase === phase);
  }

  function boot() {
    log(`🚀 Booting ${SCRIPT_NAME} v${SCRIPT_VERSION}...`);
    const phases = [0,1,2,3,4,5,6];
    let total = 0, errored = 0;
    for (const phase of phases) {
      const phaseMods = getByPhase(phase);
      if (phaseMods.length === 0) continue;
      for (const mod of phaseMods) {
        total++;
        try {
          mod.init();
          _status.set(mod.name, 'ready');
        } catch (e) {
          _status.set(mod.name, 'errored');
          _errors.set(mod.name, e);
          errored++;
          warn(`Module "${mod.name}" failed to init:`, e);
        }
      }
      const ok = phaseMods.length - phaseMods.filter(m => _status.get(m.name) === 'errored').length;
      log(`Phase ${phase}: ${ok}/${phaseMods.length} modules ready`);
    }
    if (errored >= 3) toast(`${errored} modules failed to initialize`, 'warning', 5000);
    const ready = total - errored;
    log(`✅ Boot complete — ${total} modules, ${ready} ready, ${errored} errored`);
    EventBus.emit('boot:complete', { total, ready, errored });
  }

  function destroyAll() {
    for (const [name, mod] of _modules) {
      if (_status.get(name) === 'destroyed') continue;
      try {
        mod.destroy();
        _status.set(name, 'destroyed');
      } catch (e) {
        warn(`Module "${name}" destroy error:`, e);
      }
    }
  }

  function routeChange(url) {
    for (const [name, mod] of _modules) {
      if (_status.get(name) !== 'ready') continue;
      try { mod.onRouteChange?.(url); } catch (e) { warn(`Module "${name}" onRouteChange error:`, e); }
    }
  }

  function configChange(key, val) {
    for (const [name, mod] of _modules) {
      if (_status.get(name) !== 'ready') continue;
      try { mod.onConfigChange?.(key, val); } catch (e) { warn(`Module "${name}" onConfigChange error:`, e); }
    }
  }

  return { register, getModule, getStatus, getError, getAll, getByPhase, boot, destroyAll, routeChange, configChange };
})();
```

## Phase Assignment (All Current Modules)

| Phase | Modules | Count |
|-------|---------|-------|
| 0 | Config, EventBus, State, DOMObserver, ModuleRegistry | 5 |
| 1 | ThemeEngine, Toast, HUD, ExportEngine, StorageEngine, UIEnhancer | 6 |
| 2 | KeyboardModule, CommandPalette, PromptTemplates, SettingsPanel | 4 |
| 3 | MonitorModule, SessionRecovery, ToolTiming, ToolTimeline, FloatingTOC, SyntaxHighlighter, PromptHistory, BookmarkModule, SessionNotes, ModelFingerprint, ResizablePanes, QuickActionsBar | 12 |
| 4 | PromptEnhancer, SessionDashboard, SessionDiff, PerformanceAnalytics, ZipExport, HistoryBrowser, TerminalInspector, ArtifactDetector, ArtifactStudio, TaskApprovalHandler, AgentToolTracker, AgentToolbar, FileDropZone, AccessibilityEngine, WorkspaceManager, LeaderboardIntel, WorkflowMacros, ThemeEditor, NotificationCenter, ConversationSearch, PrintExport, MultiTabSync, ShortcutEditor, AutoBackup, AgentDebugger, PromptLibrary, ContextVisualizer, CommandQueue, ScreenshotTool, ClipboardManager, PluginAPI, InsightsDashboard | 32 |
| 5 | injectPhaseCSS, CSS enhancements | 1 |

## Dependency Graph (Core)

```
Config ──► EventBus ──► State ──► DOMObserver ──► Everything
  │                        │
  └────────► StorageEngine ◄─────────┘
                │
                └────────► SessionRecovery
                └────────► ExportEngine
                └────────► HistoryBrowser
```

## Boot Sequence Flow

```
init()
  │
  ├── Config.load()
  ├── injectBaseStyles()              (via ThemeEngine)
  ├── ModuleRegistry.boot()
  │     ├── Phase 0: Core services
  │     ├── Phase 1: Infrastructure
  │     ├── Phase 2: UI Components
  │     ├── Phase 3: Agent Features
  │     ├── Phase 4: All modules
  │     └── Phase 5: CSS injection
  ├── EventBus.emit('boot:complete')
  ├── Keyboard shortcuts registration
  ├── beforeunload → ModuleRegistry.destroyAll()
  ├── pagehide → ModuleRegistry.destroyAll()
  └── Console welcome message
```

## File Organization (Section 001 Target)

```
// ==UserScript== ... ==/UserScript==
(function() {
  'use strict';

  // Constants & Globals
  const SCRIPT_ID = 'aamp';
  const SCRIPT_VERSION = '7.0.0';
  // ...

  // Utility Functions (cleaned — no dead code)
  // findElement, warn, waitForElement, generateId, debounce,
  // downloadFile, escapeHTML, makeDraggable, log

  // Core Services (Phase 0)
  // Config, EventBus, State, DOMObserver, ModuleRegistry

  // Infrastructure (Phase 1)
  // THEMES, DEFAULT_CONFIG, ThemeEngine, injectBaseStyles, toast,
  // HUD, ExportEngine, StorageEngine, UIEnhancer

  // UI Components (Phase 2)
  // KeyboardModule, CommandPalette, PromptTemplates, SettingsPanel

  // Phase 3-5 modules follow...
  // ...
})();
```

## CSS Pipeline Architecture

```
injectBaseStyles() ───► <style id="aamp-base">
  (global vars, reset, animations)

ThemeEngine.applyTheme() ──► <style id="aamp-theme-vars">
  (CSS custom properties per theme)

Module.init() ──► Each module may call GM_addStyle for its own CSS
  (scoped to module, prefixed with SCRIPT_ID)

All CSS injected via GM_addStyle (inserted into <head>)
```

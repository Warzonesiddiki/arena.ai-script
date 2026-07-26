# Section 083: DevURLDetector — Step 6: Architecture

## Architecture: DevURLDetector

### Module Structure
```
DevURLDetector (IIFE)
├── init()           // Phase 5 boot entry
├── destroy()        // Cleanup
├── [public methods] // API surface
└── [private state]  // Internal state
```

### Integration Points
- **ModuleRegistry:** Registered in Phase 5 boot sequence
- **Config:** Reads from CONFIG_SCHEMA, writes via Config.set()
- **EventBus:** Emits lifecycle events, subscribes to cross-module events
- **StorageEngine:** Persists data if needed
- **CommandPalette:** Adds user-facing commands

### Data Flow
```
Boot → ModuleRegistry.register('DevURLDetector', { phase: 5, init() { ... } })
     → Phase 5 triggers init()
     → Module sets up functionality
     → Module emits events via EventBus
```

### Error Isolation
- All module code wrapped in try/catch
- Errors logged via `warn()` and `log()`
- ModuleRegistry catches init errors and continues boot

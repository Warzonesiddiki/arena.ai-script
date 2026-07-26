# Section 034: ContextExtractor — Step 6: Architecture

## Architecture: ContextExtractor

### Module Structure
```
ContextExtractor (IIFE)
├── init()           // Phase 4 boot entry
├── destroy()        // Cleanup
├── [public methods] // API surface
└── [private state]  // Internal state
```

### Integration Points
- **ModuleRegistry:** Registered in Phase 4 boot sequence
- **Config:** Reads from CONFIG_SCHEMA, writes via Config.set()
- **EventBus:** Emits lifecycle events, subscribes to cross-module events
- **StorageEngine:** Persists data if needed
- **CommandPalette:** Adds user-facing commands

### Data Flow
```
Boot → ModuleRegistry.register('ContextExtractor', { phase: 4, init() { ... } })
     → Phase 4 triggers init()
     → Module sets up functionality
     → Module emits events via EventBus
```

### Error Isolation
- All module code wrapped in try/catch
- Errors logged via `warn()` and `log()`
- ModuleRegistry catches init errors and continues boot

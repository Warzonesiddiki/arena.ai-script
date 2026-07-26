# Section 003: Reactive State Store — Planning

## Architecture
```
State IIFE
├── _handlers = {}         // watchers per key
├── _computed = {}         // computed definitions
├── _history = []          // change log (capped)
├── _initial = {...}       // baseline for reset
├── _raw = {...}           // live data backing the Proxy
├── store (Proxy)          // main public interface
├── watch(key, fn)
├── unwatch(key, fn)
├── compute(name, deps, fn) // define derived state
├── reset()                 // restore to _initial
├── batch(obj)              // atomic multi-set
├── snapshot()              // plain object copy
├── getHistory(limit)       // recent changes
├── exportState()           // JSON string
└── importState(str)        // parse + batch
```

## Dependencies
- `eventBus` (Phase 0) — emit `state:*` and `state:batch` events
- `config` (Phase 0) — no direct dep but state is used by config watchers

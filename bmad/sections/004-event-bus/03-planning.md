# Section 004: Event Bus — Planning

## Architecture
```
EventBus IIFE
├── listeners = {}         // event key -> [{ handler, once, priority }]
├── stats = {}             // event key -> emit count
├── _match(pattern, event) // wildcard matching engine
├── on(event, handler, opts)  // register with optional priority
├── once(event, handler)      // auto-removed after first emit
├── off(event, handler)       // remove specific handler
├── emit(event, data)         // sync dispatch with priority sort
├── emitAsync(event, data)    // async dispatch, await all handlers
├── clear(event?)             // clear specific or all events
├── getStats(event?)          // get per-event or all stats
└── resetStats()              // reset all counters
```

## Wildcard Rules
- `*` matches any event
- `prefix:*` matches `prefix` and `prefix:anything`
- Exact match takes priority in ordering but all matching handlers fire

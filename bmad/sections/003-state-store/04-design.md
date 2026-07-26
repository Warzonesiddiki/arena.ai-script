# Section 003: Reactive State Store — Design

## API Surface

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `store[key]` | string | any | Direct access via Proxy |
| `store[key] = v` | string, any | boolean | Set via Proxy, fires watchers |
| `watch(key, fn)` | string, Function | void | Subscribe to changes |
| `unwatch(key, fn)` | string, Function | void | Unsubscribe |
| `compute(name, deps, fn)` | string, string[], Function | void | Define computed property |
| `reset()` | none | void | Reset all keys to initial |
| `batch(obj)` | object | void | Atomic multi-key set |
| `snapshot()` | none | object | Plain copy of all keys |
| `getHistory(n)` | number | array | Last N history entries |
| `exportState()` | none | string | JSON dump |
| `importState(s)` | string | boolean | Parse and apply JSON |

## Computed Values
- Registered via `compute(name, deps, fn)`
- `fn` runs immediately and whenever any dep changes
- Exposed as read-only property on `store` via `Object.defineProperty`
- Not enumerable in `_raw` — only accessible through store

## History
- Captured on every `set()` and `batch()` call
- Entry: `{ timestamp: Date.now(), state: snapshot() }`
- Capped at `MAX_HISTORY = 50`

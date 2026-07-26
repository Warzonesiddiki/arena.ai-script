# Section 003: Reactive State Store — Research

## Patterns
- **Proxy-based reactivity** — Current approach; extend with computed properties via `Object.defineProperty`
- **Immutable snapshots** — Deep clone state before mutation for history trail
- **Event sourcing pattern** — Every state change emits a structured event for audit/debug
- **MobX-style computed** — Track dependency graph, invalidate cache when deps change

## Codebase Context
- `State` is defined at line ~608, used via `const { store: S } = State`
- 30+ modules import `S` and read/write state keys
- Current watchers fire synchronously on Proxy `set` trap
- `EventBus` is registered first (Phase 0), `State` depends on `eventBus` to emit events

## Decision
- Keep Proxy for main store access
- Add `compute()` using `Object.defineProperty` on the store proxy
- History as capped array of timestamped snapshots
- `batch()` to group multiple writes with single history entry

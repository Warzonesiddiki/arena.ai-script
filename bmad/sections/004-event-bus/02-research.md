# Section 004: Event Bus — Research

## Patterns
- **Wildcard matching** — Check if listener's key pattern matches the emitted event (`*`, `prefix:*`, exact match)
- **Priority sorting** — Sort handlers by `priority` descending before firing
- **Once removal** — Track which event keys have `once` handlers to remove after emit
- **Stats tracking** — Increment counter per event name on every `emit()` call

## Codebase Context
- `EventBus` at line ~583, depends on `config`
- 58 references across the codebase
- Used by: Config, State, DOMObserver, ThemeEngine, AutoContinue, HUD, ArtifactStudio, LeaderboardIntel, and 20+ other modules
- Events range from `state:*` to `agent:*`, `dom:*`, `config:*`, `route:*`, `theme:*`
- Wildcards would dramatically simplify `state:*` subscriptions (instead of subscribing per key)

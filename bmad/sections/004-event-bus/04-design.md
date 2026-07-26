# Section 004: Event Bus — Design

## Wildcard Matching
```
_match('state:isAgentMode', 'state:isAgentMode')  → true  (exact)
_match('state:*', 'state:isAgentMode')             → true  (prefix)
_match('state:*', 'state:sessionStart')            → true  (prefix)
_match('state:*', 'agent:thinking')                → false (different prefix)
_match('*', 'anything')                            → true  (global)
```

## Priority System
- Default: `0`
- Higher number = fires first
- Handlers sorted before each emit: `allHandlers.sort((a, b) => b.priority - a.priority)`

## Async Support
- `emit()` detects returned Promise and attaches `.catch()` for error reporting
- `emitAsync()` awaits each handler sequentially
- Both skip to next handler if one throws

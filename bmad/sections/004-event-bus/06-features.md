# Section 004: Event Bus — Features

## Feature Checklist

| Feature | Priority | Status |
|---------|----------|--------|
| Wildcard match `*` | P0 | ✅ Done |
| Wildcard match `prefix:*` | P0 | ✅ Done |
| Priority sorting on emit | P0 | ✅ Done |
| Backward compat (priority defaults 0) | P0 | ✅ Done |
| Async emit (`emitAsync`) | P1 | ✅ Done |
| Emit stats tracking | P1 | ✅ Done |
| Auto-cleanup empty event keys | P2 | ✅ Done |
| `once` cleanup after wildcard matches | P1 | ✅ Done |

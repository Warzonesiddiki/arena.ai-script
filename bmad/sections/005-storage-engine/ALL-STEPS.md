# Section 005: Storage Engine — BMAD

## Step 1: Brainstorming
Upgrade IndexedDB session store with compression, search, batch operations, migration, and quota enforcement.

## Step 2: Research
- Original uses DB_VERSION 2 with single store + timestamp index
- `S.currentSessionId || generateId()` relies on global generateId
- GM_* fallback for when IndexedDB unavailable

## Step 3: Planning
- DB_VERSION 3 → add url index
- Migration path from v2→v3
- Session compression (trim messages/steps when >512KB)
- searchSessions(), deleteSessions(), exportAllSessions(), importSessions()
- getStorageInfo() for quota diagnostics

## Step 4: Design
- `compress(obj)` — trims messages to 50, steps to 100 if oversized
- `searchSessions(query)` — filters by url, id, message content
- `deleteSessions(ids)` — batch version of deleteSession
- `exportAllSessions()` / `importSessions(str)` — JSON dump/restore

## Step 5-8: Epics thru Prep
Epics: (1) Migration v3 (2) Compression (3) Search/Batch/Export
All DONE — implementation is complete.

## Step 9: Implementation
- Lines ~1593-1689 — full StorageEngine v3 rewrite
- DB_VERSION 2→3, url index, compress(), search, batch delete, export/import, getStorageInfo
- ModuleRegistry phase 2, deps: config, export

## Step 10: Dev Story
| Feature | Before | After |
|---------|--------|-------|
| DB Version | 2 | 3 (+ url index) |
| Compression | None | Auto-trim oversized sessions |
| Search | None | By url, id, message text |
| Batch delete | Single only | deleteSessions(ids) |
| Export/Import | None | JSON dump/restore |
| Storage info | None | getStorageInfo() |
| Session ID | Global generateId | Local generateId |

## Step 11: Code Review
- `compress()` is called on every save — light overhead, acceptable
- `searchSessions()` loads all sessions into memory — OK for typical <1000 sessions
- Migration path v2→v3 is handled by indexedDB.onupgradeneeded + oldVer check
- **Verdict: ✅ APPROVED — Syntax PASS**

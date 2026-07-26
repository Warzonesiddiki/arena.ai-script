# Section 002: Config Engine — Steps 7-9

## Step 7: Epics & Stories
**Story 2.1:** ConfigSchema + Validation (3 pts)
- Add ConfigSchema with type/default/min/max/enum/description/group
- Modify set() to validate against schema
- Add setDefault(key), batchSet(obj), getNamespace(prefix)

**Story 2.2:** Granular Watchers + Migration (2 pts)
- Add watch/unwatch system
- Add version tracking and migration pipeline
- Export Migration API for future sections

**Story 2.3:** Config UI Integration (1 pt)
- Update Settings Panel to use schema for rendering
- Add "Reset to Default" per-key button

## Step 8: Sprint Plan
| Story | Tasks | Est. |
|-------|-------|------|
| 2.1 | Create CONFIG_SCHEMA map, refactor set() with validation, add setDefault/batchSet/getNamespace | 2h |
| 2.2 | Add _watchers map, implement watch/unwatch, add version+migrate | 1h |
| 2.3 | Update settings render loop to use schema metadata | 0.5h |
| **Total** | | **3.5h** |

## Step 9: Story Prep
**Current file:** `/workspaces/arena.ai-script/arena-agent-mode-pro.user.js`  
**Config location:** Lines ~402-462  
**Key insertions:**
- CONFIG_SCHEMA: Before Config IIFE (line ~400)
- Config.watch/unwatch: After set() (line ~421)
- Config.setDefault/batchSet: After set() (line ~421)
- Config migration: In load() (line ~406)
- Version tracking: In _config (add _version key)

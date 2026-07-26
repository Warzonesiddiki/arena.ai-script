# Section 002: Configuration Engine — Step 1: Brainstorming

## First Principles
**Purpose:** Store and manage all user-configurable settings for the entire script.
**Current state:** Flat key-value store, no validation, no schema, no migration.
**Gap:** As the script grows to 100+ features, config needs type safety, validation, and migration.

## SCAMPER
- **Substitute:** Flat config → Nested config with namespacing per module
- **Combine:** Config + watchers + schema validation
- **Adapt:** JSON Schema-inspired type definitions per key
- **Modify:** Direct set/get → Validate-before-set with error reporting
- **Eliminate:** Manual DEFAULT_CONFIG management → Auto-generated from schema
- **Rearrange:** Config storage version → Migration pipeline for smooth updates

## Key Features for v7.0
1. **ConfigSchema** — Per-key metadata: type, default, min, max, enum, description, group
2. **Validation** — Type checking, range checking, enum checking on set()
3. **Migration** — Config version tracking, migration functions per version
4. **Granular Watchers** — Watch specific keys, not just whole config
5. **setDefault(key)** — Reset single key to default
6. **batchSet(obj)** — Set multiple keys with single save event
7. **getNamespace(ns)** — Get all keys under a namespace (e.g., 'export*')
8. **Backup/Restore** — Named config snapshots

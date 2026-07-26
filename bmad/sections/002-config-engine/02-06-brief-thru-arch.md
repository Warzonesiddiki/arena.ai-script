# Section 002: Config Engine — Steps 2-6

## Step 2: Research
- **Pattern:** JSON Schema for validation (subset for our needs)
- **Storage:** GM_setValue (already implemented) — max ~2MB, sync
- **Performance:** Config is read on every boot and on most interactions — must be <1ms get/set
- **Security:** All config values are user-controlled — no injection risk via config

## Step 3: Product Brief
**Vision:** A self-validating, self-migrating configuration engine that makes it impossible to save invalid config and ensures smooth upgrades across script versions. **Users:** Developers adding new features benefit from auto-validation; users benefit from never having corrupt config.

## Step 4: PRD
- R1: ConfigSchema defines type, default, min/max, enum for each key
- R2: set() validates value against schema before saving
- R3: Config version tracked; migration functions run on version mismatch
- R4: watch(key, handler) for granular key observation
- R5: unwatch(key, handler) to remove watchers
- R6: setDefault(key) resets single key to schema default
- R7: batchSet(obj) sets multiple keys with one save+event
- R8: getNamespace(prefix) returns filtered config object

## Step 5: UX Design
```js
// Add a new config key (future):
ConfigSchema.add('myModule_enabled', { type: 'boolean', default: true, group: 'myModule' });

// Validation:
Config.set('theme', 'invalid'); // → false, warn() called
Config.set('fontSize', 100); // → false (exceeds max)

// Watching:
Config.watch('theme', (val, old) => ThemeEngine.applyTheme(val));

// Migration:
// Config automatically checks version, runs migration 6→7
```

## Step 6: Architecture
```
ConfigSchema Map<key, {type, default, min, max, enum, description, group}>
Config { _config, _watchers, version }
  ├── load() — reads GM storage, merges with defaults
  ├── save() — writes to GM storage
  ├── get(key) / set(key, val) — with validation
  ├── watch(key, fn) / unwatch(key, fn)
  ├── setDefault(key) / batchSet(obj)
  ├── getNamespace(prefix)
  ├── exportJSON() / importJSON()
  └── migrate(oldVersion) — runs migration functions
```

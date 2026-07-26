# Section 102: v7.1.1 Deep Audit — BMAD

## Context
Following the v7.1 critical bugfix pass, a second, broader static + dynamic
audit was run across the entire codebase (not just the modules already
flagged) using two automated cross-checks:
1. Every `EventBus.emit('x', ...)` vs `EventBus.on('x', ...)` pairing, to find
   events listened for but never emitted (dead code) or typo'd event names.
2. Every `Config.get('x')`/`Config.set('x')` usage vs `CONFIG_SCHEMA` keys, to
   find config keys read/written that don't exist in the schema (always
   `undefined`).

## Findings

1. **AutoBackup never actually starts/stops via its config toggle.**
   `AutoBackup.init()` listened for `EventBus.on('config:changed', ...)` —
   note the extra "d" — but the entire rest of the codebase emits
   `config:change` (no "d"). A pure typo meant flipping the Auto-Backup
   toggle in Settings had zero effect; only the boot-time
   `if (Config.get('autoBackup')) start()` check could ever start it, and
   even that always evaluated falsy because...

2. **`autoBackup` and `backupInterval` were never added to `CONFIG_SCHEMA`.**
   `Config.get('autoBackup')` always returned `undefined` (falsy), and there
   was no way to set a default, expose it in the Settings UI, or persist it.
   AutoBackup was permanently disabled no matter what.

3. **The Settings panel's "⏸ Pause" button did nothing.** It read/wrote a
   `Config` key called `enabled` that literally no other code in the ~4,600
   line script ever checked. Clicking it showed a "AAMP Paused ⏸" toast and
   changed the button label, with zero actual behavioral effect — a textbook
   "fake button."

4. **`toast()` never emitted `toast:shown`.** `NotificationCenter` subscribes
   to this event to build its notification history panel, but the shared
   global `toast()` helper — called from hundreds of places throughout the
   script — never emitted it. Only `NotificationCenter.push()` (rarely
   called directly) ever added an entry, so the notification history was
   permanently near-empty in practice.

5. **Theme Editor's custom accent/background color pickers had no effect.**
   The "Apply Theme" button saved `accentColor`/`bgColor` to `Config` (also
   missing from `CONFIG_SCHEMA` — see #2's pattern) but `ThemeEngine.applyTheme()`
   never read them, so picking a custom color and clicking Apply changed
   nothing visible. It also called `ThemeEngine.applyTheme()` with no
   argument, which fell through to `THEMES.default` — briefly overriding
   the user's actual selected theme.

## Fixes Applied
- `AutoBackup`: fixed `config:changed` → `config:change`.
- `CONFIG_SCHEMA`: added `autoBackup`, `backupInterval`, `enabled`,
  `a11yEnabled`, `accentColor`, `bgColor` with sane defaults.
- `DOMObserver.analyzeAddedNode()`: now checks `Config.get('enabled')` first
  and skips all tracking when disabled, making the Pause button real. The
  Settings panel button label now reflects actual persisted state on open.
- `toast()`: now emits `EventBus.emit('toast:shown', {message, type, duration})`.
  `NotificationCenter.push()` simplified to just call `toast()` (avoids
  double-counting now that `toast()` itself emits the event).
- `ThemeEngine.applyTheme()`: now layers `accentColor`/`bgColor` overrides on
  top of the selected theme's CSS variables, and reacts to their
  `config:change` events to re-apply live. Theme Editor's Apply button now
  passes the actual current theme key instead of `undefined`.

## Verification
- `node --check` — PASS
- `npm test` (4 stages: syntax, jsdom boot smoke test, infinite-loop
  regression, new pause-toggle regression) — PASS
- New `tests/regression-pause-toggle.js` added and wired into `npm test`,
  verifying the Pause button now actually suppresses DOM-mutation tracking
  and Resume restores it.

## Verdict
✅ **APPROVED** — all findings fixed, verified via automated tests, no
regressions in existing test suite. Bumped to v7.1.1.

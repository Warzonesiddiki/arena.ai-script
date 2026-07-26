# ⚡ Arena Agent Mode Pro

> **v7.2.0** — Performance, UI/UX Overhaul & Polish  
> Tampermonkey / Greasemonkey userscript enhancing [arena.ai](https://arena.ai) Agent Mode with 90+ powerful modules.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Userscript](https://img.shields.io/badge/Tampermonkey-Compatible-blue)](https://www.tampermonkey.net/)
[![Version](https://img.shields.io/badge/version-7.2.0-brightgreen)](https://github.com/Warzonesiddiki/arena.ai-script)

---

## 🚀 Features

### Core Enhancements
- **ModuleRegistry** — 93+ modules with phase-based boot, dependency resolution, and error isolation
- **Reactive State + EventBus v2** — Full pub/sub with wildcards, priorities, computed values
- **Config v2** — Schema-driven settings with live watchers and migrations
- **Agent Mode Detection** — Auto-activates on `/agent` routes with real-time tracking

### Productivity
- **Command Palette** (Ctrl+K) — Fuzzy search, frecency ranking, category headers, match highlighting
- **HUD** — Live session timer, turn/tool counts, drag-to-reposition + compact toggle
- **Collapsible Tool Calls** + **Syntax Highlighter** + **Line Numbers**
- **Prompt Templates** & **Workflow Macros**
- **Floating TOC**, **Resizable Panes**, **Quick Actions Bar**

### Agent Intelligence
- **Tool Timeline** & **Agent Tool Tracker**
- **Session Playback** (replay any past session at variable speed)
- **Session Freeze** (pause tracking without stopping the agent)
- **Artifact Studio**, **Workspace Manager**, **Leaderboard Intelligence**
- **Auto-Continue**, **Parallel Exec**, **Task Chains**, **Scheduled Jobs**

### Developer Tools
- **Debugger Console** (eval sandbox)
- **Terminal & Sandbox Inspector**
- **Context Visualizer**, **Insights Dashboard**
- **Plugin API** (`window.AAMP`)
- **Multi-Tab Sync**, **Auto Backup**

### Polish & Safety
- **XSS Prevention** + **Security Hardening**
- **Accessibility Engine** (WCAG audits + fixes)
- **Memory Leak Fixer** + **DOM Optimization**
- **Benchmarks** with heap/DOM growth sampling
- **Toast verbosity control** + **NotificationCenter history**

---

## 📦 Installation

### Tampermonkey / Violentmonkey / Greasemonkey
1. Install the userscript manager for your browser
2. Click **Raw** on `arena-agent-mode-pro.user.js`
3. Confirm installation

Or install directly:
```
https://raw.githubusercontent.com/Warzonesiddiki/arena.ai-script/main/arena-agent-mode-pro.user.js
```

### Development
```bash
git clone https://github.com/Warzonesiddiki/arena.ai-script.git
cd arena.ai-script
npm install
npm test
```

---

## ⚙️ Configuration

Open settings with the **⚡** floating action button (bottom-right).

Key toggles:
- `enabled` — Master pause/resume
- `a11yEnabled` — Accessibility audits on every mutation
- `autoBackup` + `backupInterval`
- Theme overrides via **Theme Editor**

All settings are persisted via `GM_setValue` and migrate automatically.

---

## ⌨️ Keyboard Shortcuts

| Shortcut       | Action                     |
|----------------|----------------------------|
| `Ctrl + K`     | Command Palette            |
| `Ctrl + E`     | Export Conversation        |
| `Ctrl + B`     | Toggle Focus Mode          |
| `Ctrl + W`     | Toggle Workspace           |
| `Ctrl + A`     | Show Artifacts             |
| `Ctrl + S`     | Session Summary            |
| `Ctrl + /`     | Show Shortcuts (console)   |
| `Esc`          | Close any open panel       |

---

## 🧪 Testing

The project ships with a 4-stage test suite (`npm test`):

```bash
npm test
```

- Syntax check (`node --check`)
- Smoke test (full boot in jsdom)
- Tool-call loop regression
- Pause/Resume regression

New behavior must be covered by regression tests following the existing patterns.

---

## 🛠️ Architecture Highlights

- **BMAD Method** — 102 documented sections under `bmad/`
- **Phase-based boot** (0 → 5)
- **Single shared DOMObserver** (consolidated from 6 observers)
- **Debounced hot paths** (`dom:mutation`)
- **Shared tick dispatcher** for timers
- **buildModal()** helper + real CSS classes (replacing inline styles)

---

## 📝 Changelog (v7.2.0)

See full history in the script header or `Release.changelog()`.

**v7.2.0** (current)
- Performance: Debounced `XSSPrevention` & `AccessibilityEngine`, consolidated 6 MutationObservers
- Performance: Shared tick dispatcher for 8 timers, heap/DOM growth sampling in Benchmarks
- UI/UX: `buildModal()` helper, Command Palette frecency + categories + highlighting
- UI/UX: Collapsible settings groups, search/filter, HUD compact toggle + drag
- UI/UX: Toast verbosity setting, AccessibilityEngine now audits AAMP UI
- Moved 50+ inline styles to real CSS classes
- Created GitHub README
- Bumped version + updated changelog

---

## 🤝 Contributing

Pull requests welcome! Please:
1. Keep `npm test` green
2. Add regression tests for new behavior
3. Update `bmad/sections/` when following BMAD format
4. Increment `SCRIPT_VERSION` and `Release.changelog()`

---

## 📜 License

MIT © Arena Agent Mode Pro contributors

---

**Made with ❤️ for the Arena.ai community**  
*93 modules • 5 phases • Zero compromises*
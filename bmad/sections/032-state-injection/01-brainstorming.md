# Section 032: State Injection (Debug Tool) — Step 1: Brainstorming

## First Principles Analysis

**What is the fundamental purpose of State Injection (Debug Tool)?**
Developer/debug utility for manually overriding a state-store value at runtime, useful for testing UI states without needing to reproduce them via real agent activity.

**What are the atomic primitives?**
1. Module — `StateInjection`, an isolated IIFE unit with init/destroy where applicable
2. Config keys — none for this section
3. Events — the EventBus messages this section emits/consumes
4. Public API — the functions other modules call on this one

**What can we eliminate?**
- Redundant DOM queries — cache references where the module already does
- Duplicate initialization — this project's actual v7.1 audit found and fixed several modules
  (StorageEngine, SettingsPanel, UIEnhancer, KeyboardModule) that had exactly this problem
- Hardcoded values — prefer CONFIG_SCHEMA-driven behavior

**What should be inverted?**
- Instead of assuming "documented" means "verified", every claim in this section's docs was
  re-checked against actual boot behavior in `tests/smoke.js` as part of the v7.1 pass.

## Constraints
- Must follow the IIFE module pattern used throughout `arena-agent-mode-pro.user.js`
- Must register with `ModuleRegistry` if it has an `init()` (several modules in this codebase
  were found during the v7.1 audit to have a working `init()` that was simply never registered —
  see the v7.1 note in this section's `06-architecture.md` if applicable)
- Must not throw during boot — verified for this module by `tests/smoke.js`

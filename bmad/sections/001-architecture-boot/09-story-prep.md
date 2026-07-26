# Section 001: Architecture & Boot Sequence — Step 9: Story Prep

## Current File State
**File:** `/workspaces/arena.ai-script/arena-agent-mode-pro.user.js`  
**Lines:** 3,044  
**Modules:** 40 IIFEs + 18 stubs + free functions  
**Version:** 6.0.0  

## Key Locations for Modification

| What | Location | Action |
|------|----------|--------|
| `sleep()` function | Lines 54-56 | DELETE |
| `escapeRegex()` function | Lines 59-61 | DELETE |
| `throttle()` function | Lines 85-91 | DELETE |
| `formatTimeAgo()` function | Lines 158-164 | DELETE |
| `var` in ArtifactStudio | Lines ~2265-2285 | Replace with const/let |
| `var` in LeaderboardIntel | Lines ~2550-2566 | Replace with const/let |
| `var` in WorkflowMacros | Lines ~2585-2614 | Replace with const/let |
| ModuleRegistry insertion point | Before Config (before line ~354) | ADD new service |
| `init()` boot sequence | Lines ~2886-3044 | REPLACE with phase-based boot |
| `injectBaseStyles()` | Lines ~626-740 | Keep but move call to ThemeEngine |
| `injectPhaseCSS()` | Lines ~2707-2866 | Keep but move call to ThemeEngine |
| `AgentToolTracker` references | Lines 1099, 2475, 2944 | Add guard or define module |
| Modal builders | Lines ~2066, 2086, 2106, 2171 | Refactor to factory |
| `onclick=` in modal HTML | Lines ~2066-2171 | Replace with addEventListener |

## Pre-Implementation Checklist
- [ ] Current syntax passes: `node --check`
- [ ] Known current module count: 59
- [ ] File backed up before modifications

## Implementation Order
1. Remove dead code (sleep, escapeRegex, throttle, formatTimeAgo)
2. Replace var with const/let
3. Create ModuleRegistry IIFE (before Config)
4. Fix AgentToolTracker references
5. Create createModal factory + refactor modals
6. Convert modules to registered format (alter init calls)
7. Replace boot sequence with phase-based boot
8. Move CSS into ThemeEngine
9. Syntax check
10. Verify module count

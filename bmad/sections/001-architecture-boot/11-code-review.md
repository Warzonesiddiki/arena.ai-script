# Section 001: Architecture & Boot Sequence — Step 11: Code Review

## Adversarial Senior Developer Review

### Issue 1: CRITICAL — `DOMObserver.destroy()` not called from `destroyAll()`
**File:** `arena-agent-mode-pro.user.js`  
**Location:** ModuleRegistry registration of `domObserver`  
**Problem:** `DOMObserver.init()` is called during boot, but `ModuleRegistry.destroyAll()` calls the registered `destroy()` which is `DOMObserver.destroy()`. However, looking at the code, `DOMObserver.init()` is NOT called via ModuleRegistry registration — it was called directly in the old boot sequence. In the new boot, `DOMObserver.init()` is called at registry time via `ModuleRegistry.register('domObserver', { phase:0, init(){DOMObserver.init();}, ... })`. This is correct. ✅

**Verdict:** WONTFIX — correct as implemented.

### Issue 2: CRITICAL — `StorageEngine.init()` is async but ModuleRegistry doesn't handle async
**File:** `arena-agent-mode-pro.user.js`  
**Location:** Boot sequence, `StorageEngine.init()`  
**Problem:** `StorageEngine.init()` is async (was previously awaited: `await StorageEngine.init()`). The new boot sequence calls it synchronously inside ModuleRegistry registration. Phase 1 modules depending on StorageEngine may start before it finishes initializing.

**Fix Required:** Wrap async init in a promise or make it sync-safe. Since StorageEngine's init just loads session history from GM storage (not critical for boot order), the fix is to remove the `async` from `StorageEngine.init()` or ensure it runs synchronously.

### Issue 3: HIGH — `MODULE_COUNT` constant removed but referenced in other code
**File:** `arena-agent-mode-pro.user.js`  
**Location:** Boot sequence  
**Problem:** The old `const MODULE_COUNT = 59;` was removed from the boot sequence. But the console.log badge no longer references MODULE_COUNT — it dynamically uses `ModuleRegistry.getAll().length`. However, if any other code references `MODULE_COUNT`, it will be undefined. Let me check...

**Verdict:** Checked — `MODULE_COUNT` was only used in the boot sequence. Using `ModuleRegistry.getAll().length` is actually better. ✅

### Issue 4: HIGH — `AgentToolbar.generateSessionSummary()` references AgentToolTracker without guard
**File:** `arena-agent-mode-pro.user.js` line 2524  
**Problem:** Line 2524 calls `AgentToolTracker.getStats()` but WITHOUT a `typeof` guard. Since AgentToolTracker is now defined in the file (line 2491), this should be safe. But if AgentToolTracker were removed or failed to init, it would throw ReferenceError.

**Verdict:** Since AgentToolTracker is now defined at line 2491 (before AgentToolbar), and it doesn't depend on anything that can fail, this is safe. However, adding a guard would be defensive.

**Fix (Optional):** Add `typeof AgentToolTracker !== 'undefined' &&` guard at line 2524.

### Issue 5: MEDIUM — ThemeEngine.init() called twice
**File:** `arena-agent-mode-pro.user.js`  
**Location:** Boot sequence — line `ThemeEngine.init();` is called directly, then again via `ModuleRegistry.register('themeEngine', { phase:1, init(){ThemeEngine.init();} })`.  
**Problem:** Double initialization.

**Fix:** Remove the direct `ThemeEngine.init();` call, since it's now registered in Phase 1.

### Issue 6: MEDIUM — `HUD.build()` called conditionally, then registration always calls it
**File:** `arena-agent-mode-pro.user.js`  
**Location:** Boot sequence — `if (Config.get('hudEnabled') && Config.get('sessionTimer')) HUD.build();` runs outside registry, then `ModuleRegistry.register('hud', { phase:1, init(){HUD.build();} })` also calls HUD.build().  
**Problem:** HUD is potentially built twice, or built when disabled.

**Fix:** Remove the direct conditional call and make the Phase 1 HUD registration respect the config check.

### Issue 7: LOW — ModuleRegistry doesn't check for circular dependencies
**File:** `arena-agent-mode-pro.user.js` — ModuleRegistry definition  
**Problem:** If two modules declare each other as dependencies, boot will still work (since deps are not enforced), but it would be better to detect and warn.

**Fix:** Add a simple circular dependency check in `register()` or warn about it.

### Issue 8: LOW — `var` replacement missed one case
**File:** `arena-agent-mode-pro.user.js`  
**Location:** Global scope  
**Problem:** Check for any remaining `var` in non-module-code.

**Verdict:** `grep -n "^\s*var "` returns no results. ✅

### Issue 9: INFO — `StorageEngine.init()` is async, may fail silently
**File:** `arena-agent-mode-pro.user.js` ~line 1315+  
**Problem:** `async function init()` inside StorageEngine. It's called without await now. The function will return a Promise that's discarded. If it throws, the error is silently swallowed (no try/catch inside init).

**Fix:** Add try/catch inside `StorageEngine.init()` or make it synchronous.

### Issue 10: INFO — `injectPhaseCSS()` is always called but could be lazy
**File:** `arena-agent-mode-pro.user.js`  
**Problem:** CSS is injected even if the user never uses certain features. For a 3100-line script, this is negligible.

**Verdict:** WONTFIX — acceptable for a userscript.

## Required Fixes Before Approval

| # | Severity | Fix |
|---|----------|-----|
| 2 | CRITICAL | Make StorageEngine.init() sync-safe or remove async (add try/catch inside) |
| 5 | MEDIUM | Remove direct `ThemeEngine.init();` call — let Phase 1 handle it |
| 6 | MEDIUM | Remove direct `HUD.build()` call — make Phase 1 registration respect config |
| 7 | LOW | Add circular dependency detection to ModuleRegistry |
| 9 | LOW | Add try/catch inside StorageEngine.init() |

## Approval Status
**🔄 CHANGES REQUIRED** — 5 issues must be fixed before this section can be approved

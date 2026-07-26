# Section 027: Auto Save Prompt — BMAD

## Step 1-11 Summary
- **Status:** ✅ IMPLEMENTED (via boot sequence)
- **Features:** Auto-saves session on beforeunload/pagehide, stores to GM storage and IndexedDB
- **Config key:** `autoSaveSession`
- **Integration:** `window.addEventListener('beforeunload', ...)` and `pagehide` in boot sequence
- **BMAD:** All 11 steps complete
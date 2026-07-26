# Section 012: Quick Actions Bar — BMAD

## Step 1-11 Summary
- **Status:** ✅ IMPLEMENTED (full)
- **Module:** `QuickActionsBar` at line ~2172
- **Features:** Floating action bar with Settings, Export, Search, Scorecard, Context, Clipboard buttons
- **API:** `init()`, `show()`, `hide()`, `toggle()`, `isVisible()`, `addAction(icon, label, handler)`
- **Events:** Listens to `agent:activated`, `agent:deactivated`, `agent:response`
- **BMAD:** All 11 steps complete — full implementation with dynamic action registration
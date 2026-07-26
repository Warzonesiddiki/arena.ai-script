# Section 015: Floating Elements (TOC + HUD) — Step 7: Epics & Stories

## Epic: Floating Elements (TOC + HUD)
- **Story 1:** As the boot sequence, I need `FloatingTOC, HUD` to initialize cleanly so the rest of the
  script isn't blocked or errored by it.
- **Story 2:** As a user, I need this section's behavior to actually run (not silently no-op),
  which the v7.1 audit specifically verified via a real jsdom boot rather than just reading code.

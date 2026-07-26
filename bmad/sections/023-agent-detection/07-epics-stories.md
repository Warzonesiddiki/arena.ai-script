# Section 023: Agent Mode Detection — Step 7: Epics & Stories

## Epic: Agent Mode Detection
- **Story 1:** As the boot sequence, I need `DOMObserver.detectAgentMode` to initialize cleanly so the rest of the
  script isn't blocked or errored by it.
- **Story 2:** As a user, I need this section's behavior to actually run (not silently no-op),
  which the v7.1 audit specifically verified via a real jsdom boot rather than just reading code.

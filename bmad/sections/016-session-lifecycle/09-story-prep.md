# Section 016: Session Lifecycle — Step 9: Story Prep

## Context for implementation
- File: `arena-agent-mode-pro.user.js`
- Module: `DOMObserver.startSession / SessionRecovery`
- Related modules/deps: `storageEngine`

## Constraints
- Must not introduce new runtime errors (verified via `npm test`)
- Must not reintroduce the v7.1-fixed issues in modules that had them

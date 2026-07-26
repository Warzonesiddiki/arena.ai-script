---
name: release-bugfix-feature-pass
description: Workflow command scaffold for release-bugfix-feature-pass in arena.ai-script.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /release-bugfix-feature-pass

Use this workflow when working on **release-bugfix-feature-pass** in `arena.ai-script`.

## Goal

Performs a critical bugfix and feature implementation pass, including code fixes, wiring up modules, adding real implementations, updating tests, and bumping version numbers.

## Common Files

- `arena-agent-mode-pro.user.js`
- `tests/*.js`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `archive/*`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Fix bugs in main implementation file(s).
- Wire up or register previously orphaned modules in the registry.
- Replace stubs with real implementations for modules/features.
- Add or update test files (e.g., regression, smoke tests).
- Update package.json and package-lock.json as needed.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
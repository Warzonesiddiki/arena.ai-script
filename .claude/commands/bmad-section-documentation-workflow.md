---
name: bmad-section-documentation-workflow
description: Workflow command scaffold for bmad-section-documentation-workflow in arena.ai-script.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /bmad-section-documentation-workflow

Use this workflow when working on **bmad-section-documentation-workflow** in `arena.ai-script`.

## Goal

Creates or backfills full documentation for a BMAD section, including the 11-step workflow and DONE.md, for each module/feature.

## Common Files

- `bmad/sections/*/01-brainstorming.md`
- `bmad/sections/*/02-research.md`
- `bmad/sections/*/03-product-brief.md`
- `bmad/sections/*/04-prd.md`
- `bmad/sections/*/05-ux-design.md`
- `bmad/sections/*/06-architecture.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update 01-brainstorming.md through 11-code-review.md in the relevant bmad/sections/<section-name>/ directory.
- Update or create ALL-STEPS.md and DONE.md in the same directory.
- Update bmad/STATUS.md to reflect documentation status.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
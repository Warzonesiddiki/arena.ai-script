# BMAD 11-Step Workflow Checklist

## Per-Section Steps
- [ ] **Step 1: Brainstorming** — First principles, SCAMPER, ideation maps, divergent/convergent
- [ ] **Step 2: Research** — Web fetch, docs, competitor analysis, best practices
- [ ] **Step 3: Product Brief** — Vision, target users, value proposition, success metrics
- [ ] **Step 4: PRD** — Requirements, acceptance criteria, constraints, dependencies
- [ ] **Step 5: UX Design** — Interface mockups, flow diagrams, interaction spec
- [ ] **Step 6: Architecture** — Module structure, data flow, API design, integration points
- [ ] **Step 7: Epics & Stories** — Breakdown, estimation, story points
- [ ] **Step 8: Sprint Planning** — Task tracking, sprint backlog, status board
- [ ] **Step 9: Story Prep** — Context gathering, file reading, development prep
- [ ] **Step 10: Dev Story** — Implementation, tests, validation, commit
- [ ] **Step 11: Code Review** — Adversarial review, issues found, fixes applied

## Quality Gates
- [ ] No orphaned code (unused variables/functions)
- [ ] No XSS vectors (all user data escaped via escapeHTML)
- [ ] All GM_* calls guarded or try-caught
- [ ] Event listeners properly cleaned up
- [ ] Observers disconnected in destroy()
- [ ] Syntax check passes (node --check)
- [ ] No console.log/warn/error leaks (only our tagged ones)
- [ ] Module count verified
- [ ] All 11 steps completed

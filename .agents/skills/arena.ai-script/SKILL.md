```markdown
# arena.ai-script Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and workflow automation used in the `arena.ai-script` JavaScript codebase. The repository is organized for modular, testable, and well-documented code, with a focus on structured documentation and robust release processes. No major frameworks are used, and workflows are managed through clear, repeatable steps and suggested commands.

## Coding Conventions

- **File Naming:**  
  Use kebab-case for all file names.  
  _Example:_  
  ```
  arena-agent-mode-pro.user.js
  my-module-helper.js
  ```

- **Import Style:**  
  Use relative imports for modules.  
  _Example:_  
  ```js
  import { myFunction } from './utils/helper.js';
  ```

- **Export Style:**  
  Use named exports for all modules.  
  _Example:_  
  ```js
  // utils/helper.js
  export function myFunction() { ... }
  export const MY_CONST = 42;
  ```

- **Commit Patterns:**  
  - Mixed commit types, with prefixes like `bmad` and `chore`.
  - Commit messages average ~59 characters.

## Workflows

### bmad-section-documentation-workflow
**Trigger:** When documenting a new or existing module/feature in the BMAD system  
**Command:** `/new-bmad-section-docs`

1. Create or update `01-brainstorming.md` through `11-code-review.md` in the relevant `bmad/sections/<section-name>/` directory.
2. Update or create `ALL-STEPS.md` and `DONE.md` in the same directory.
3. Update `bmad/STATUS.md` to reflect documentation status.

_Example directory structure:_
```
bmad/
  sections/
    my-feature/
      01-brainstorming.md
      02-research.md
      ...
      11-code-review.md
      ALL-STEPS.md
      DONE.md
  STATUS.md
```

### release-bugfix-feature-pass
**Trigger:** When releasing a new version with critical bugfixes and/or major feature completions  
**Command:** `/release-bugfix-pass`

1. Fix bugs in main implementation file(s) (e.g., `arena-agent-mode-pro.user.js`).
2. Wire up or register previously orphaned modules in the registry.
3. Replace stubs with real implementations for modules/features.
4. Add or update test files (e.g., regression, smoke tests).
5. Update `package.json` and `package-lock.json` as needed.
6. Update `.gitignore` if new files/folders are added.
7. Archive legacy or superseded files to `archive/`.
8. Bump version number in code and documentation.
9. Update in-app changelog and status documentation.

_Example:_
```js
// After bugfix:
export function fixedFeature() {
  // ...fixed implementation...
}
```
_Update version in `package.json`:_
```json
{
  "version": "1.2.3"
}
```

## Testing Patterns

- **Framework:** Unknown (no framework detected)
- **File Pattern:** Test files follow the `*.test.*` naming convention.
- **Location:** Typically placed in a `tests/` directory.
- **Example:**
  ```
  tests/
    my-module.test.js
  ```
- **Style:** Use named exports and relative imports in test files as well.

## Commands

| Command                | Purpose                                                        |
|------------------------|----------------------------------------------------------------|
| /new-bmad-section-docs | Start or update BMAD section documentation for a module/feature|
| /release-bugfix-pass   | Run the release, bugfix, and feature implementation workflow   |
```

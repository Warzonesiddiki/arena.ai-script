# Section 059: FloatingTOC — Step 3: Product Brief

## Product Brief

### Module: FloatingTOC
**Purpose:** Fixed left sidebar with heading navigation
**Phase:** 5
**Icon:** 📑

### User Stories
1. As a user, I want fixed left sidebar with heading navigation so that I can...
2. As a developer, I want to configure FloatingTOC via CONFIG_SCHEMA so that...
3. As a system, I want FloatingTOC to initialize during Phase 5 boot so that...

### Acceptance Criteria
- [ ] Module registers with ModuleRegistry in Phase 5
- [ ] Module initializes without errors
- [ ] Module emits appropriate lifecycle events
- [ ] Module can be destroyed cleanly
- [ ] Module respects Config settings

### API Surface
```javascript
// FloatingTOC public API
FloatingTOC.init()  // Initialize the module
FloatingTOC.destroy()  // Cleanup (if applicable)
```

### Dependencies
- ModuleRegistry (Phase 5)
- Config (schema validation)
- EventBus (lifecycle events)

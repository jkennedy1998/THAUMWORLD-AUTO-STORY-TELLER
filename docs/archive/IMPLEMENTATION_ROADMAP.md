# Implementation Roadmap: Tag-Based Equipment System

**Date:** 2026-02-27  
**Status:** Planning Complete  
**Approach:** Direct implementation (no migration scripts)

---

## Overview

This document coordinates the implementation of the tag-based equipment system across multiple plans. We're migrating from `valid_body_slots` arrays to **ARMOR/GARB/TOOL tags** with full git version control.

**Key Principle:** No migration scripts - we use git to track changes and manually update test data incrementally.

---

## Plan Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION ORDER                      │
└─────────────────────────────────────────────────────────────┘

Phase 1: Character Module Rework (Foundation)
├─ 2026_02_22_character_module_rework.md
├─ Add ARMOR/GARB/TOOL tags
├─ Update BodySlot types
├─ Create validation helpers
└─ Status: Ready to implement

Phase 2: Pickup/Drop Integration
├─ 2026_02_26_pickup_and_drop.md
├─ Update pickup routing
├─ Update drop handling
├─ "I" key inventory
└─ Status: Waiting for Phase 1

Phase 3: Action Pipeline (Future)
├─ Use equipped TOOL items
├─ Integrate with tag system
└─ Status: After Phase 1 & 2 stable
```

---

## What Changed from Previous Approach

### ❌ Removed
- **Separate migration scripts** - Not creating standalone migration files
- **Automated batch migration** - Doing manual incremental updates instead
- **Multiple format support** - Only supporting current format during transition

### ✅ New Approach
- **Git version control** - Track all changes in git
- **Manual data updates** - Update 1-2 test actors/items at a time
- **Dual validation** - Support both old and new formats during transition
- **Incremental testing** - Test each change before proceeding
- **Rollback via git** - `git checkout` if issues arise

---

## Implementation Timeline

### Week 1: Foundation (Character Module)
**Days 1-2:** Tag Definitions & Types
- Add ARMOR/GARB to `tag_definitions.jsonc`
- Update `BodySlot` interface
- Create `src/equipment/tag_validation.ts`

**Days 3-5:** Validation System
- Implement `check_tag_compatibility()`
- Update `is_item_compatible_with_slot()`
- Dual validation (tags + legacy)

**Days 6-7:** Manual Data Setup
- Add tags to 1-2 test items
- Update 1 test actor's body_slots
- Test new format loads correctly

### Week 2: UI & Integration
**Days 8-10:** CharacterModule Updates
- Render 3 positions per hand (blue/green/red)
- Update drag-and-drop for slot types
- Fix hand slot mirroring bug

**Days 11-14:** Pickup/Drop Integration
- Update pickup routing (main container → hand)
- Update drop handling (armor/garb/tool sources)
- Update "I" key inventory
- Test full integration

### Week 3: Completion
**Days 15-17:** Data Migration
- Add tags to all items
- Update all actors to new format
- Test everything works

**Days 18-21:** Cleanup & Testing
- Remove dual-validation code
- Final integration tests
- Documentation updates

---

## Files to Modify (Cross-Plan)

### Data Files (All Plans)
```
local_data/data_slot_default/tag_definitions.jsonc    # Add ARMOR, GARB
local_data/data_slot_1/items/*.jsonc                  # Add equipment tags
local_data/data_slot_1/actors/*.jsonc                 # Update body_slots
```

### Code Files (Character Module Plan)
```
src/types/body_slots.ts                               # New slot structure
src/equipment/tag_validation.ts                       # NEW validation helpers
src/container_storage/store.ts                        # Dual validation
src/mono_ui/modules/character_module.ts               # 3-position rendering
```

### Code Files (Pickup/Drop Plan)
```
src/interface_program/main.ts                         # Pickup routing
src/canvas_app/app_state.ts                           # Drop handling
src/canvas_app/app_state.ts                           # "I" key inventory
```

---

## Testing Strategy

### Phase 1 Testing (Character Module)
- [ ] Tags load without errors
- [ ] TypeScript compiles
- [ ] Dual validation works
- [ ] Test actor loads new format

### Phase 2 Testing (Pickup/Drop)
- [ ] Pickup routes to container
- [ ] Pickup routes to hand (no containers)
- [ ] Drop from armor slot works
- [ ] Drop from garb slot works
- [ ] Drop from tool slot works
- [ ] "I" key opens correct container

### Integration Testing
- [ ] Equip armor to armor slot
- [ ] Equip multiple garb items
- [ ] Equip tool to tool slot
- [ ] Full pickup→equip→drop cycle
- [ ] No regressions in existing features

---

## Rollback Procedure

If issues arise during implementation:

```bash
# Check git status to see what's changed
git status

# View recent commits
git log --oneline -10

# Rollback to before implementation
git checkout <commit-hash-before-phase-1>

# Or revert specific files
git checkout HEAD -- src/types/body_slots.ts
git checkout HEAD -- local_data/data_slot_1/actors/henry_actor.jsonc
```

**Always commit working state before major changes!**

---

## Success Criteria

### Phase 1 Complete When:
- [ ] ARMOR and GARB tags defined
- [ ] Validation supports both formats
- [ ] Test data updated and working
- [ ] CharacterModule renders correctly

### Phase 2 Complete When:
- [ ] Pickup routes correctly for all cases
- [ ] Drop works from all slot types
- [ ] "I" key inventory functional
- [ ] No regressions

### Full System Complete When:
- [ ] All items have equipment tags
- [ ] All actors use new format
- [ ] Dual-validation code removed
- [ ] Documentation updated
- [ ] Ready for Action Pipeline integration

---

## Key Decisions

1. **No Migration Scripts** ✅
   - Rationale: We have minimal data, git handles versioning
   - Benefit: No leftover scripts to maintain

2. **Manual Incremental Updates** ✅
   - Rationale: Test as we go, catch issues early
   - Benefit: Higher confidence, easier debugging

3. **Dual Validation During Transition** ✅
   - Rationale: Keep system working while migrating
   - Benefit: Can rollback anytime, no downtime

4. **Phase 1 Before Phase 2** ✅
   - Rationale: Character Module provides foundation
   - Benefit: Pickup/Drop has stable API to integrate with

---

## Next Steps

1. **Review all plans** - Ensure alignment
2. **Create git branch** - `feature/tag-based-equipment`
3. **Begin Phase 1** - Character Module foundation
4. **Daily commits** - Track progress in git
5. **Phase 2 after Phase 1 stable** - Pickup/Drop integration

**Ready to begin implementation!**

---

## Reference Documents

- [Item System Overview](./ITEM_SYSTEM_OVERVIEW.md) - Architecture overview
- [Character Module Rework - Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) - Detailed Phase 1
- [Pickup and Drop](./2026_02_26_pickup_and_drop.md) - Phase 2 integration

---

*This roadmap ensures coordinated implementation across all plans with clear dependencies and no migration script maintenance burden.*

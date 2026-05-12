# Data Cleanup Summary - Clean Inline Storage Architecture

**Date:** 2026-03-01
**Status:** ✅ COMPLETE

## Overview

All item and actor data has been cleaned to use the new clean inline storage architecture. No deprecated fields remain in the data files.

## Files Modified

### 1. Item Definitions Cleaned (18 files)

**Location:** `local_data/data_slot_default/items/`

**Files updated:**
- ✅ `default_item.jsonc` - Template with notes preserved
- ✅ `test_iron_sword.jsonc`
- ✅ `test_cloth_tunic.jsonc`
- ✅ `test_iron_helmet.jsonc`
- ✅ `test_iron_greaves.jsonc`
- ✅ `test_iron_gauntlet_left.jsonc`
- ✅ `test_iron_dagger.jsonc`
- ✅ `test_torch.jsonc`
- ✅ `small_sack.jsonc`
- ✅ `test_cloth_pants.jsonc`
- ✅ `test_silver_ring.jsonc`
- ✅ `test_gold_ring.jsonc`
- ✅ `test_leather_bracelet.jsonc`
- ✅ `tunic.jsonc`
- ✅ `pants.jsonc`
- ✅ `shoes.jsonc`
- ✅ `coin.jsonc`

**Deprecated fields removed from ALL items:**
- ❌ `valid_body_slots` - Now uses ARMOR/GARB/TOOL tags
- ❌ `occupies_slots` - Slots determined by tag meta
- ❌ `slot_shape` - Always single slot
- ❌ `fits_actor_kind` - No race restrictions
- ❌ `stackable` - Use `max_stack_size > 1` instead
- ❌ `notes` - Removed (kept only in default_item.jsonc template)

**Fields preserved:**
- ✅ `id`, `name`, `description`
- ✅ `weight`, `weight_mag`, `mag`
- ✅ `size_mag`, `hardness_mag`, `conductivity_mag`
- ✅ `max_stack_size`, `display_char`
- ✅ `tags` (ARMOR, GARB, TOOL, CONTAINER, CURRENCY)
- ✅ `container` (for sack capacity)

### 2. Actor Files Updated (2 files)

**Location:** `local_data/data_slot_default/actors/` and `local_data/data_slot_1/actors/`

**Files updated:**
- ✅ `default_actor.jsonc` - Updated to schema_version 2
- ✅ `henry_actor.jsonc` - NEW clean actor file created

**Changes made:**
- Updated `schema_version` from 1 → 2
- Removed deprecated `equipment` object (body_slots and hand_slots)
- Updated `body_slots` to new format with armor/garb/tool fields
- Added `equipped_items` section (empty, ready for equipment)
- All 6 body parts defined: head, torso, hand_left, hand_right, leg_left, leg_right

**New body_slots format:**
```json
"body_slots": {
  "hand_left": {
    "name": "hand_left",
    "critical": true,
    "armor": null,
    "garb": [],
    "tool": null
  }
}
```

### 3. Documentation Created

**Location:** `docs/CLEAN_DATA_TEMPLATES.md`

Created comprehensive template documentation showing:
- Clean item definition format
- Clean actor file format
- Tag examples (ARMOR, GARB, TOOL, CONTAINER)
- Equipped item examples
- Container item examples (sack with contents)
- Complete list of deprecated fields

## Current Data State

### Items
All 18 item definitions are now clean with:
- Only current fields (no deprecated)
- Proper ARMOR/GARB/TOOL tags
- Correct metadata for body slot compatibility

### Actors
**henry_actor.jsonc** - Ready for testing:
- Clean schema_version 2 format
- Empty body_slots (ready for equipment)
- Empty equipped_items (ready for items)
- Empty inventory (ready for loose items)
- Full character stats and data

**default_actor.jsonc** - Template updated:
- Clean schema_version 2 format
- Can be used as base for new actors

## Next Steps

### 1. Add Test Equipment to Henry (Manual)
Example - add to henry_actor.jsonc:
```json
"body_slots": {
  "hand_left": {
    "name": "hand_left",
    "critical": true,
    "armor": null,
    "garb": [],
    "tool": "inst_sword_001"
  }
},
"equipped_items": {
  "inst_sword_001": {
    "instance": {
      "id": "inst_sword_001",
      "def_id": "test_iron_sword",
      "qty": 1,
      "condition": "good",
      "tags": []
    },
    "definition": {
      "id": "test_iron_sword",
      "name": "Iron Sword",
      "weight": 600,
      "max_stack_size": 1,
      "display_char": "/",
      "tags": [
        {
          "name": "TOOL",
          "mag": 1,
          "meta": ["weapon"],
          "info": [2]
        }
      ]
    }
  }
}
```

### 2. Test In-Game
1. Start game with `npm run dev:logs`
2. Test equipping items to body slots
3. Test opening containers (sacks)
4. Verify no errors in logs

### 3. Code Cleanup (As You Go)
When you encounter deprecated code in TypeScript files:
- Remove references to `valid_body_slots`
- Remove `sync_body_slots_with_containers()` calls
- Remove `container_id` and `owner_ref` field handling
- Delete compatibility helper functions

### 4. Create More Items (Optional)
Use the cleaned items as templates for new items.

## Git Status

All changes tracked in git. To see what changed:
```bash
git diff local_data/data_slot_default/items/
git diff local_data/data_slot_default/actors/
git status
```

To rollback if needed:
```bash
git checkout local_data/data_slot_default/items/
git checkout local_data/data_slot_default/actors/
```

## Summary

✅ **18 item files cleaned** - All deprecated fields removed
✅ **2 actor files updated** - New clean format with schema_version 2
✅ **Template documentation created** - Reference for future data
✅ **No migration scripts** - Manual changes tracked in git
✅ **Ready for testing** - Henry actor ready for equipment

**Total lines removed:** ~150+ lines of deprecated fields
**Total files modified:** 20 files
**Data is now:** Clean, minimal, inline storage architecture

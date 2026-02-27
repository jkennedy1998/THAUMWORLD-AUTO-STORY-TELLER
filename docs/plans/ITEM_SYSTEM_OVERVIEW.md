# Item System Architecture Overview

**Last Updated:** 2026-02-27  
**Status:** Active Development

---

## Quick Navigation

| Plan | Status | Purpose |
|------|--------|---------|
| [2026_02_22_character_module_rework.md](./2026_02_22_character_module_rework.md) | Phase 7-8 Complete, Phase 9 Design | Character UI, body slots, equipment system |
| [2026_02_26_pickup_and_drop.md](./2026_02_26_pickup_and_drop.md) | Implementation | World interaction, ground containers |
| [2026_02_19_inventory_movement_plan.md](./2026_02_19_inventory_movement_plan.md) | Active | Drag-drop, container transfers |
| [2026_02_14_item_system_unification.md](./2026_02_14_item_system_unification.md) | Complete | Item/container consolidation |
| [container_format_standardization.md](./container_format_standardization.md) | Complete | Wrapped format `{instance, definition}` |

---

## System Architecture

### Core Philosophy
**No Magic Inventory.** Characters have no "pockets." Items must be:
1. **Stored** in equipped containers (sacks, bags with container_data)
2. **Equipped** to body slots (head, torso, hands, legs)

### Current System (Working Now)

**Equipment Compatibility:** `valid_body_slots` array on ItemDefinition
```typescript
// ItemDefinition.valid_body_slots: string[]
// Examples:
sword: valid_body_slots: ["hand_left", "hand_right"]
helmet: valid_body_slots: ["head"]
pants: valid_body_slots: ["leg_left", "leg_right"]
```

**Body Slot Structure:**
```typescript
body_slots: {
  head: { item_instance_id: "inst_helmet_001" },      // Max 1 item
  torso: { item_instance_id: "inst_tunic_001" },      // Max 1 item
  hand_left: { item_instance_id: "inst_sword_001" },  // Max 1 item
  hand_right: { item_instance_id: "inst_torch_001" }, // Max 1 item
  leg_left: { item_instance_id: "inst_pants_001" },   // Max 1 item
  leg_right: { item_instance_id: "inst_sack_001" }    // Max 1 item (container)
}
```

**Key Points:**
- **ONE item per body slot** (simple structure)
- Compatibility checked via `valid_body_slots.includes(slot_name)`
- Container items have `container_data` with nested storage
- Visual distinction: Container items show in sidebar, others in body slots

### Future System (Planned - Phase 9)

**⚠️ NOT YET IMPLEMENTED** - See [Character Module Rework Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new)

**Planned:** Tag-based equipment with ARMOR/GARB/TOOL tags
```
Each Body Part → 3 Slot Types:
├─ ARMOR slot (blue)   Max 1  ← ARMOR tag + body_slot match
├─ GARB slots (green)  Max ∞  ← GARB tag + body_slot match  
└─ TOOL slot (red)     Max 1  ← TOOL tag (no body_slot match)
```

**Benefits of Future System:**
- Multiple rings/jewelry per hand (garb slots)
- Clear separation of worn vs held items
- Better categorization for action system

**Migration Required:**
- Add ARMOR/GARB/TOOL tags to tag_definitions.jsonc
- Change body_slots structure (armor/garb/tool per slot)
- Update all item definitions
- Migrate existing equipped items

---

## Data Flow (Current System)

### Pickup Item (from ground)
```
1. Actor picks up item from scattered container
2. API finds actor's main container:
   - Check equipped items for container_data
   - If found: route to that container (e.g., sack)
   - If not found: check dominant hand (hand_right)
       - If empty: equip to hand
       - If full: reject pickup
3. Transfer item via `/api/transfer`
4. Update scattered container (delete if empty)
5. Update place.items_on_ground
```

### Drop Item (to ground)
```
1. Drag item from equipped slot
2. Drop on place module tile
3. API validates: within 1.5 tiles of actor?
4. Get/create scattered container at tile position
5. Transfer item from source to scattered container
6. Update place.items_on_ground
```

### Equip Item (to body slot)
```
1. Check item's valid_body_slots array
2. Does array include target slot name?
   YES: Can equip
   NO: Reject (item doesn't fit there)
3. Check if slot already occupied:
   Empty: Place item
   Occupied: Check swap compatibility
       Both items fit in each other's slots? → Swap
       Otherwise → Reject
```

---

## Container Types

| Type | Storage ID | Location | Example |
|------|-----------|----------|---------|
| **Body Slot** | `container.{actor_id}.{slot}` | Actor file | `container.henry_actor.hand_left` |
| **Nested** | `item.{instance_id}` | Item's container_data | `item.inst_henry_sack_001` |
| **Scattered** | `container.place.{place_id}.scattered_{x}_{y}` | Place.containers | `container.place.tavern.scattered_5_3` |

**All containers use wrapped format:**
```typescript
{
  instance: ItemInstance,      // Item data
  definition: ItemDefinition   // Item type info
}
```

---

## Implementation Status

### ✅ Complete (Working Now)
- [x] Container system (inline storage in entity files)
- [x] Drag-and-drop between containers
- [x] Item stacking (same def_id, stackable=true)
- [x] Body slot equip/unequip (using valid_body_slots)
- [x] Pickup/Drop APIs (ground interaction)
- [x] Scattered containers (loot piles)
- [x] Right-click container opening
- [x] Multi-instance ContainerModule
- [x] Visual drag ghost during drag
- [x] Slot highlighting for compatible drops
- [x] Grid-based sparse inventory (Minecraft-style)

### 🔧 Working But Needs Refinement
- [x] Hand slot visual bug (shows 2 positions, both map to same slot)
  - **Current:** Visual only - both red(tool) and blue(equip) show same item
  - **Planned:** Separate armor/garb/tool slots per hand (Phase 9)

### 📋 Planned (Phase 9+)
- [ ] Tag-based slot system (ARMOR/GARB/TOOL tags)
- [ ] Separate slot types per body part (armor/garb/tool)
- [ ] Unlimited garb capacity (multiple rings per hand)
- [ ] "Main container" selection (rearrangeable sidebar)
- [ ] Legality system with tag validation
- [ ] Ground drop drag-and-drop (visual)
- [ ] Range checking for NPC drops
- [ ] Equipment layering system
- [ ] Action pipeline integration

---

## Current vs Planned Architecture

| Feature | Current (Working) | Planned (Phase 9) |
|---------|-------------------|-------------------|
| **Compatibility** | `valid_body_slots` array | ARMOR/GARB/TOOL tags |
| **Items per Hand** | 1 item | 3 slots (armor/garb/tool) |
| **Jewelry** | 1 ring per hand | Unlimited rings (garb slots) |
| **Validation** | Array includes check | Tag + body_slot match |
| **Hand Slots** | Simple (bug: mirrors) | Separate armor/garb/tool |

**Current System Status:** ~70% of functionality working with simpler architecture

---

## Key Files

**Core Logic:**
- `src/container_storage/store.ts` - Container CRUD, transfers, stacking
- `src/interface_program/main.ts` - API endpoints (/api/transfer, /api/place/pickup, /api/place/drop)
- `src/canvas_app/app_state.ts` - Frontend state, drag-drop, equip logic
- `src/transfer/validation.ts` - Transfer validation (stacking, swapping)

**UI Modules:**
- `src/mono_ui/modules/character_module.ts` - Body slots display
- `src/mono_ui/modules/container_module.ts` - Inventory grid
- `src/mono_ui/modules/place_module.ts` - World view, ground items

**Type Definitions:**
- `src/types/container.ts` - Container interfaces
- `src/types/body_slots.ts` - Body slot types
- `src/item_instances/store.ts` - ItemInstance interface
- `src/item_storage/store.ts` - ItemDefinition interface (valid_body_slots)

**Data:**
- `local_data/data_slot_default/tag_definitions.jsonc` - System tags (NO ARMOR/GARB/TOOL yet)
- `local_data/data_slot_1/items/*.jsonc` - Item definitions (use valid_body_slots)

---

## Related Systems

- **Action Pipeline** - Will use equipped items (currently uses body_slots)
- **Legality System** - NOT IMPLEMENTED (planned for Phase 9)
- **Tag System** - Exists but missing ARMOR/GARB/TOOL equipment tags
- **Inspection System** - Views equipped items via body_slots

---

## Design Principles

1. **Physical Inventory:** No magic storage, everything must be equipped or contained
2. **Current:** Equipment compatibility via `valid_body_slots` array
3. **Future:** Equipment compatibility via ARMOR/GARB/TOOL tags (Phase 9)
4. **Clear Visuals:** Orange(containers), other colors for equipment (future)
5. **Realistic Constraints:** Hands matter - currently 1 item per hand

---

## Implementation Path

**Current System Works Now** - `valid_body_slots` approach is functional

### Tag-Based Migration Plan (Phase 9)

**Approach: Direct Implementation with Git Tracking**
(No separate migration scripts - we use git for version control)

**Phase 1: Foundation (Days 1-2)**
- Add ARMOR/GARB tags to `tag_definitions.jsonc`
- Update `BodySlot` interface (armor/garb/tool structure)
- Create validation helpers in `src/equipment/`
- Test: Tags load, TypeScript compiles

**Phase 2: Dual Validation (Days 3-5)**
- Implement tag-based validation
- Keep `valid_body_slots` for backward compatibility
- Support both systems during transition
- Test: Both old and new formats work

**Phase 3: Manual Data Updates (Days 6-8)**
- Manually update 1-2 test items with tags
- Manually update 1 test actor's body_slots
- Test incrementally with limited data
- Iterate quickly, no migration scripts

**Phase 4: UI Updates (Days 9-11)**
- CharacterModule renders 3 slot positions per hand
- Blue (armor), Green (garb), Red (tool)
- Update drag-and-drop for slot types
- Fix hand slot mirroring bug

**Phase 5: Pickup/Drop Integration (Days 12-13)**
- Update pickup routing to check slot types
- Update drop handling for all slot types
- Update "I" key for main container selection
- Test: Full integration works

**Phase 6: Complete Migration (Days 14-15)**
- Add tags to all items
- Update all actors to new format
- Remove dual-support code
- Final testing

**Benefits of This Approach:**
- No leftover migration scripts
- Changes tracked in git
- Can rollback via git checkout
- Incremental testing with real data
- No supporting multiple dated formats

**Decision:** Proceed with tag-based migration for long-term scalability

---

**See Also:**
- [Character Module Rework - Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) - Detailed implementation
- [Pickup and Drop](./2026_02_26_pickup_and_drop.md) - Integration details

---

**Questions?** See individual plan documents for detailed implementation notes.

# Pickup and Drop System Implementation Plan

**Date:** 2026-02-25  
**Updated:** 2026-02-27  
**Status:** Implementation Phase  
**Priority:** High  
**Related Plans:** 
- 2026_02_14_item_system_unification.md (Item system foundation)
- 2026_02_25_item_system_bug_fixes.md (Bug fixes)
- 2026_02_22_character_module_rework.md (Phase 9: Tag-based equipment - **CRITICAL DEPENDENCY**)

---

## Quick Status

**🟢 WORKING:** Pickup and Drop APIs functional with inline scattered containers  
**🟡 BUGS:** Sack detection needs fixing (assumes all actors have sacks)  
**🔵 PLANNED:** Tag-based equipment system (Phase 9 - future enhancement)

**Current System:** Uses `valid_body_slots` array - simple but functional  
**Future System:** ARMOR/GARB/TOOL tags - more flexible but requires major refactoring

**Decision:** Fix current system bugs first, defer tag-based migration until core gameplay stable.

---

---

## 1. Executive Summary

This plan connects the existing item/container system with the world interaction layer, allowing players to pick up items from the world and drop items into the world. It integrates the scattered loot containers (already implemented) with the character inventory system.

### Current State

**✅ WORKING NOW:**
- Scattered loot containers exist (drop/pickup APIs) - **NOW INLINE in place.containers**
- Container modules open with right-click
- Drag and drop works between containers
- Pickup/Drop APIs functional (with bugs noted below)
- Distance checks enforced (1 tile for pickup, 1.5 tiles for drop)

**🔧 WORKING WITH ISSUES:**
- **Sack Detection:** Currently searches for any equipped container item
  - Works if actor has sack equipped
  - Fails if actor has no containers (needs fallback to hand slots)
- **"I" Key:** Opens inventory but hardcoded to find first sack
  - Should use "main container" selection (Phase 9 feature)

**❌ PLANNED (Phase 9):**
- Tag-based equipment slots (ARMOR/GARB/TOOL)
- "Main container" selection (rearrangeable sidebar)
- Drop from any equipped slot (armor, garb, tool, container)
- Hand slot separation (fix mirroring bug)

**ARCHITECTURE NOTE:**
Current system uses `valid_body_slots` array on ItemDefinition.
Future system (Phase 9) will use ARMOR/GARB/TOOL tags.
See [Character Module Rework Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) for details.

### Implementation Update (2026-02-26)
**Migrated scattered containers to inline storage:**
- Scattered containers now stored in `place.containers["scattered_<x>_<y>"]` instead of separate files
- Modified `container_storage/store.ts`:
  - `find_scattered_container()` - reads from place.containers inline
  - `get_or_create_scattered_container()` - creates containers inline in place.containers
  - `list_scattered_containers()` - reads from place.containers instead of directory
  - `delete_scattered_container_if_empty()` - deletes from place.containers inline
- Benefits: Single source of truth, faster access, easier cleanup, no orphaned container files

**Added drag and drop to place_module.ts:**
- Added `OnDragEnd` handler to detect drops onto place tiles
- Added config options: `on_drop`, `is_dragging`, `get_drag_source`
- Validates drop is within 1.5 tiles of actor position
- **Fixed coordinate calculation** - uses `screen_to_tile()` like OnClick for consistency
- **Added extensive debug logging** to trace every step of the drag-drop flow

**Bug Fix (Coordinate Issue):**
- Original code used manual inner rect calculation with wrong padding (x0+2, y0+3)
- Fixed to use `screen_to_tile()` function (same as OnClick, OnRightClick)
- This ensures consistent coordinate calculation across all place module interactions

**Bug Fix (API Parameters):**
- Request body was sending `actor_ref`, `tile_x`, `tile_y` 
- API expects `actor_id` (without "actor." prefix) and `tile_position: {x, y}`
- Fixed parameter names to match API expectations

**Bug Fix (Actor Sack Detection):**
- Both pickup and drop APIs were looking for a container with "sack" in the ID
- Sack is actually an equipped item in body slots (leg_left/leg_right) with `container_data`
- Created `find_actor_sack()` helper function to:
  - Check all body slots for equipped items
  - Find items that have `container_data` (are containers)
  - Return the container ID as `item.${instance_id}`
  - Find empty position in the sack for transfers
- Updated both `/api/place/pickup` and `/api/place/drop` to use the new helper

**Architecture Note: No Default Inventory**
- Actors may not have any equipped containers (no sack, no bag)
- Fallback: Use dominant hand (hand_right) TOOL slot as implicit "container" for 1 item
- Better: Player sets "main container" in CharacterModule sidebar
  - Rearrange containers vertically, top one = main
  - Opens with "I" key
  - Receives items from pickup operations
  - See Character Module Rework Phase 9 for details
- If no containers and hands full, pickup is rejected

**Created migration script:**
- `src/tools/migrate_scattered_to_inline.ts` - migrates existing scattered containers
- Usage: `npx tsx src/tools/migrate_scattered_to_inline.ts 1 [--dry-run]`
- Moves container files to inline storage and deletes old files

**Added debugging to app_state.ts:**
- Configured `is_dragging` callback - returns drag_state.is_dragging
- Configured `get_drag_source` callback - returns item and container IDs
- Configured `on_drop` callback - calls `/api/place/drop` with full logging
- Logs every step: drag start, drop detection, tile calculation, API call, response

### Goal
Enable seamless interaction between:
1. **World containers** (scattered loot on ground) ↔ **Character inventory** (sacks)
2. **NPC containers** (NPC equipment) ↔ **Character inventory** (trading/stealing)
3. **Distance-based access** with auto-close
4. **Visual feedback** for accessible containers

---

## 2. Requirements

### 2.1 Core Interactions

#### Pickup Items from World
- **Source:** Scattered loot containers (`container.place.<place_id>.scattered_<x>_<y>`)
- **Destination:** Character's main inventory (equipped sack)
- **Trigger:** Drag item from world container to inventory OR click "Pick Up" button
- **Range:** 1 tile (touch range)

#### Drop Items to World
- **Source:** Any open inventory slot
- **Destination:** Scattered loot container at character's position
- **Trigger:** Drag item from inventory to place module (ground)
- **Auto-create:** New scattered container if none exists at position
- **Auto-delete:** Container removed when last item taken

#### Open External Containers
- **Trigger:** Double-click on:
  - Scattered loot pile (ground items)
  - NPC character module (view their equipment)
  - Future: Chests, shelves, furniture
- **Distance limit:** 1 tile to open, auto-close at 5 tiles
- **Visual indicator:** Highlight accessible containers

### 2.2 Container Access Rules

```typescript
interface ContainerAccessRules {
    // Personal containers (always accessible)
    personal: {
        range: Infinity;
        auto_close_distance: Infinity;
        examples: ["actor's equipped sacks", "actor's body slots"]
    };
    
    // Adjacent containers (touch range)
    adjacent: {
        range: 1; // tile
        auto_close_distance: 5; // tiles
        examples: ["scattered loot", "NPC equipment", "ground containers"]
    };
    
    // Directional containers (future)
    directional: {
        range: 1;
        facing_required: true;
        facing_vector: { dx: number; dy: number };
        examples: ["chests", "shelves", "furniture"]
    };
}
```

---

## 3. Hook Up "I" Key Inventory

### Current State
- "I" key opens inventory UI via `ui_state.container.is_visible`
- Currently shows placeholder or empty state
- Not connected to any actual container
- **Issue:** Assumes actor always has a sack (not always true)

### Implementation (Updated for Tag-Based System)

**Step 1:** Define "Main Container" Selection
```typescript
// CharacterModule sidebar shows equipped containers
// Player can rearrange containers vertically
// Top container = "main inventory"
// If only 1 container equipped, that one is main
// If 0 containers equipped, use dominant hand TOOL slot

interface MainInventoryResult {
    type: 'container' | 'hand_tool' | 'none';
    container_id?: string;      // For type='container'
    hand_slot?: string;         // For type='hand_tool'
}

function get_main_inventory(actor_data: Actor): MainInventoryResult {
    // Check if player has set a preferred main container
    const preferred = actor_data.preferences?.main_container_id;
    if (preferred && container_exists(preferred)) {
        return { type: 'container', container_id: preferred };
    }
    
    // Find first equipped container (sack, bag, etc.)
    for (const [slot_name, slot_data] of Object.entries(actor_data.body_slots)) {
        // Check if slot has a container item (has container_data)
        const equipped = get_equipped_item(slot_name);
        if (equipped?.instance.container_data) {
            const container_id = `item.${equipped.instance.id}`;
            return { type: 'container', container_id };
        }
    }
    
    // No containers - check dominant hand
    const dominant_hand = actor_data.body_slots.hand_right;
    if (dominant_hand && !dominant_hand.tool) {
        return { type: 'hand_tool', hand_slot: 'hand_right' };
    }
    
    return { type: 'none' };
}
```

**Step 2:** Connect "I" key to main inventory
```typescript
// When 'i' is pressed:
const main = get_main_inventory(current_actor);

if (main.type === 'container') {
    open_container_module(main.container_id!);
} else if (main.type === 'hand_tool') {
    // Open "hand" view or show tool slot
    flash_status(['Using hand - no container equipped'], 1500);
} else {
    flash_status(['No inventory - equip a container or use your hands'], 2000);
}
```

**Step 3:** Pickup Routing with Tag-Based Slots
```typescript
// When picking up items:
const main = get_main_inventory(actor_data);

if (main.type === 'container') {
    // Try to put in container
    transfer_to_container(item, main.container_id!);
} else if (main.type === 'hand_tool') {
    // Put in dominant hand TOOL slot
    equip_to_slot(item, 'hand_right', 'tool');
} else {
    // No space - reject
    flash_status(['No space - hands full, no containers'], 2000);
    return false;
}
```

**Integration with Tag-Based System:**
- **Armor items:** Can only pickup if armor slot empty (max 1)
- **Garb items:** Can always pickup (unlimited per slot)
- **Tool items:** Can pickup if hand TOOL slot empty (max 1 per hand)
- **Container items:** Pickup puts them in main container (or hand if no container)

See [Character Module Rework Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) for full slot system details.

---

## 4. Drop Items with Tag-Based System

### Drop from Any Equipped Slot

With the tag-based slot system, players can drop items from:
- **Armor slots:** Drop equipped armor (helmet, chest plate, etc.)
- **Garb slots:** Drop clothing/jewelry (rings, tunics, bracelets)
- **Tool slots:** Drop held items (sword, torch, tools)
- **Container slots:** Drop items from equipped containers (sacks, bags)

### Source Container ID Format

When dragging an item for drop, `drag_state.source_container_id` uses format:
```typescript
// Format: container.{actor_id}.{body_slot}.{slot_type}
// Examples:
"container.henry_actor.hand_left.tool"      // Sword in left hand
"container.henry_actor.hand_left.garb"      // Rings on left hand
"container.henry_actor.hand_left.armor"     // Gauntlet on left hand
"container.henry_actor.torso.armor"         // Chest plate
"item.inst_henry_sack_001"                  // Nested container (sack)
```

### Drop Validation

1. **Check drag source:** Get source container ID from `drag_state`
2. **Verify ownership:** Ensure actor owns the source container
3. **Get item:** Locate item in source container/slot
4. **Create destination:** Get/create scattered container at drop tile
5. **Transfer:** Move item from source to scattered container
6. **Cleanup:** 
   - Remove from source slot (armor/tool) or container
   - Delete scattered container if empty

### Slot Type Handling

```typescript
// Armor/Garb/Tool slots (body_slots)
if (source_id.includes('.armor') || source_id.includes('.garb') || source_id.includes('.tool')) {
    // Unequip from body slot
    unequip_from_body_slot(actor_id, slot_name, slot_type);
}
// Nested containers (items with container_data)
else if (source_id.startsWith('item.')) {
    // Transfer from nested container
    transfer_from_nested_container(source_id, item_id);
}
```

**Visual Feedback:**
- Drag ghost shows item being carried
- Drop on valid ground tile → item drops
- Drop too far from actor → red flash, returns to source
- Drop on occupied slot → swap or reject

---

## 5. Pickup Items from World

### 5.1 World Container Access

**Double-Click Detection:**
```typescript
// In place_module.ts, add to on_click handler
double_click: (world_x: number, world_y: number, target: ClickTarget) => {
    if (target.type === 'scattered_container') {
        const container_id = target.container_id;
        const distance = calculate_distance(
            actor_position, 
            { x: world_x, y: world_y }
        );
        
        if (distance <= 1) {
            open_container_module(container_id);
            track_container_distance(container_id, 5); // Auto-close at 5 tiles
        } else {
            flash_status(['Too far away'], 1500);
        }
    }
}
```

**Distance Tracking:**
```typescript
// Track open external containers
const tracked_containers = new Map<string, {
    container_id: string;
    open_position: { x: number; y: number };
    max_distance: number;
}>();

function track_container_distance(container_id: string, max_distance: number) {
    tracked_containers.set(container_id, {
        container_id,
        open_position: get_actor_position(),
        max_distance
    });
}

// Check distance on each movement
function check_container_distances() {
    const current_pos = get_actor_position();
    
    for (const [id, tracked] of tracked_containers) {
        const distance = calculate_distance(current_pos, tracked.open_position);
        if (distance > tracked.max_distance) {
            close_container_module(id);
            tracked_containers.delete(id);
            flash_status(['Moved too far from container'], 1500);
        }
    }
}
```

### 4.2 Pickup Flow

**Method A: Drag from World Container to Inventory**
```typescript
// In container_module on_drop (when source is world container)
if (drag_state.source_module === 'container' && is_world_container(source_container_id)) {
    // Validate distance still <= 1
    const container_pos = get_container_position(source_container_id);
    if (distance > 1) {
        flash_status(['Moved too far from container'], 1500);
        drag_state.reject_drag();
        return false;
    }
    
    // Transfer to main inventory
    const main_inventory = get_main_inventory_container();
    await transfer_item(item_id, source_container_id, main_inventory.id);
}
```

**Method B: "Take All" Button**
```typescript
// Add to world container module
buttons: [
    {
        label: 'Take All',
        on_click: () => {
            const main_inventory = get_main_inventory_container();
            if (!main_inventory) {
                flash_status(['No inventory equipped'], 1500);
                return;
            }
            
            // Transfer all items
            for (const item of container_contents) {
                await transfer_item(item.instance.id, container_id, main_inventory.id);
            }
            
            // Close and delete if empty
            close_container_module(container_id);
            delete_scattered_container_if_empty(container_id);
        }
    }
]
```

---

## 6. Drop Items to World

### 5.1 Drop Flow

**Drag to Place Module:**
```typescript
// In app_state.ts, add global drop handler
on_world_drop: async (item_instance_id: string, from_container_id: string) => {
    const actor_pos = get_actor_position();
    const place_id = get_current_place_id();
    
    // Get or create scattered container at actor position
    const container_id = get_or_create_scattered_container(place_id, actor_pos);
    
    // Transfer item
    const result = await transfer_item(item_instance_id, from_container_id, container_id);
    
    if (result.ok) {
        flash_status(['Item dropped'], 1000);
        // Refresh place to show new item on ground
        await update_current_place();
    } else {
        flash_status([`Cannot drop: ${result.error}`], 1500);
    }
}
```

**Visual Feedback:**
- Show item appearing on ground immediately (optimistic update)
- Animate item falling from inventory to ground position
- Update ground item display (`·` → `*` → `#` based on count)

### 5.2 Container Lifecycle

**Auto-Create:**
```typescript
function get_or_create_scattered_container(place_id: string, position: Position): string {
    const existing = find_scattered_container_at(place_id, position);
    if (existing) return existing;
    
    // Create new container
    const container_id = `container.place.${place_id}.scattered_${position.x}_${position.y}`;
    const container: Container = {
        id: container_id,
        kind: 'place',
        place_id,
        position,
        capacity: { max_slots: 10, max_weight: 50000 },
        contents: [],
        subtype: 'scattered'
    };
    
    save_container(container);
    return container_id;
}
```

**Auto-Delete:**
```typescript
function delete_scattered_container_if_empty(container_id: string) {
    const container = load_container(container_id);
    if (container && container.contents.length === 0) {
        // Delete container file
        delete_container_file(container_id);
        
        // Remove from place data if referenced
        remove_scattered_container_from_place(container_id);
        
        // Close module if open
        close_container_module(container_id);
        
        debug_log(`Deleted empty scattered container: ${container_id}`);
    }
}

// Call this after any item removal from scattered container
on_item_removed: (container_id: string) => {
    if (is_scattered_container(container_id)) {
        delete_scattered_container_if_empty(container_id);
    }
}
```

---

## 7. UI Changes

## 8. Files to Modify

## 9. Implementation Phases

## 10. Success Criteria

## 11. Dependencies

### Already Implemented
- ✅ Scattered loot container system
- ✅ Container module UI
- ✅ Drag and drop system
- ✅ Transfer API
- ✅ Distance calculation utilities

### Required Before Start
- None - can begin immediately

---

## 12. Implementation Sequence

**Integrated with Character Module Rework Phase 9**

The pickup/drop system implementation is coordinated with the tag-based equipment system migration. See [Character Module Rework - Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) for full details.

**Phase 1: Foundation (Character Module Rework)**
- Add ARMOR/GARB/TOOL tag definitions
- Update BodySlot type structure
- Create validation helpers
- Test: Tags load, types compile

**Phase 2: Pickup/Drop Integration (This Plan)**
- Update pickup routing to use slot types
  - Check for main container first
  - Route to dominant hand tool slot if no containers
  - Handle armor/garb/tool appropriately
- Update drop handling
  - Parse source container ID for slot type
  - Unequip from specific slot (armor/garb/tool)
- Update "I" key inventory
  - Open main container or show hand status

**Phase 3: Testing**
- Test pickup with containers (routes to container)
- Test pickup without containers (routes to hand)
- Test drop from each slot type
- Test "I" key with various configurations

**Implementation Notes:**
- No separate migration scripts (use git for version control)
- Manual data updates for test actors
- Dual validation during transition (tags + valid_body_slots)
- Coordinate with Character Module UI changes

**Dependencies:**
- Character Module Phase 9 must be complete before Phase 2
- Body slot structure must support armor/garb/tool
- Validation system must check tags
- ⚠️ Migration of all item data
- ⚠️ Weeks of work
- **Action:** Plan as Phase 9, implement after core features stable

**Recommended Path:**
1. Fix current system bugs (Phase A)
2. Integrate with Action Pipeline (using current `valid_body_slots`)
3. Defer tag-based migration until core gameplay loop is solid
4. Document tag-based as "Future Enhancement" not "Required"

**See Also:**
- [Character Module Rework - Phase 9](./2026_02_22_character_module_rework.md#phase-9-tag-based-equipment-slot-system-new) - Tag-based slot system (planned)
- [Item System Overview](./ITEM_SYSTEM_OVERVIEW.md) - Architecture comparison

---

**Next Step:** Fix pickup/drop bugs using current `valid_body_slots` system

---

*This plan documents both the working pickup/drop system and the planned future tag-based equipment system.*

# Pickup and Drop System Implementation Plan

**Date:** 2026-02-25  
**Status:** Planning Phase  
**Priority:** High  
**Related Plans:** 2026_02_14_item_system_unification.md, 2026_02_25_item_system_bug_fixes.md

---

## 1. Executive Summary

This plan connects the existing item/container system with the world interaction layer, allowing players to pick up items from the world and drop items into the world. It integrates the scattered loot containers (already implemented) with the character inventory system.

### Current State
- ✅ Scattered loot containers exist (drop/pickup APIs)
- ✅ Container modules open with right-click
- ✅ Character has sacks equipped on legs
- ✅ Drag and drop works between containers
- ✅ "I" key opens inventory UI (currently not hooked up to actual container)
- ❌ No way to pick up items from world into inventory
- ❌ No way to drop items from inventory to world
- ❌ Distance checks not enforced for external containers

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

### Implementation

**Step 1:** Identify main inventory container
```typescript
// In app_state.ts, when creating app state
function get_main_inventory_container(actor_data: Actor): Container | null {
    // Priority: First equipped sack found
    const body_slots = ['leg_left', 'leg_right', 'torso', 'head'];
    for (const slot_name of body_slots) {
        const slot = actor_data.body_slots[slot_name];
        if (slot?.item_instance_id) {
            // Check if item is a container
            const item = get_item_instance(slot.item_instance_id);
            if (item?.container_data) {
                return item.container_data;
            }
        }
    }
    return null;
}
```

**Step 2:** Connect "I" key to equipped sack
```typescript
// When 'i' is pressed:
const main_inventory = get_main_inventory_container(current_actor);
if (main_inventory) {
    open_container_module(`item.${main_inventory.instance.id}`);
} else {
    flash_status(['No equipped container found'], 1500);
}
```

**Step 3:** Set as default for pickup operations
- When picking up items, default destination = main inventory container
- If main inventory full, show error: "Inventory full"

---

## 4. Pickup Items from World

### 4.1 World Container Access

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

## 5. Drop Items to World

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

## 6. UI Changes

### 6.1 Replace Debug Button with Double-Click

**Remove from place_module.ts:**
- Remove "CNTRS", "GRND", "PICKUP", "DROP" debug buttons
- Keep essential debug buttons (TEST, etc.) if needed

**Add double-click handler:**
```typescript
// In place_module.ts click handling
let last_click_time = 0;
let last_click_target: string | null = null;

on_click: (x, y, target) => {
    const now = Date.now();
    const target_id = target.id || `${x},${y}`;
    
    // Check for double-click (within 300ms, same target)
    if (now - last_click_time < 300 && last_click_target === target_id) {
        handle_double_click(target);
    }
    
    last_click_time = now;
    last_click_target = target_id;
}

function handle_double_click(target: ClickTarget) {
    if (target.type === 'npc') {
        // Open NPC character module
        open_npc_character_module(target.npc_id);
    } else if (target.type === 'scattered_container' || target.type === 'ground_items') {
        // Open world container
        const distance = get_distance_to(target.position);
        if (distance <= 1) {
            open_container_module(target.container_id);
            track_container_distance(target.container_id, 5);
        } else {
            flash_status(['Too far away'], 1500);
        }
    }
}
```

### 6.2 Highlight Accessible Containers

```typescript
// In place_module.ts render function
render: (c: CanvasRenderingContext2D) => {
    // Draw accessible container indicators
    for (const container of get_nearby_containers()) {
        const distance = get_distance_to(container.position);
        
        if (distance <= 1) {
            // Highlight in green (accessible)
            c.fillStyle = 'rgba(0, 255, 0, 0.3)';
            c.fillRect(container.x, container.y, 1, 1);
        } else if (distance <= 5) {
            // Highlight in yellow (within range but not adjacent)
            c.fillStyle = 'rgba(255, 255, 0, 0.2)';
            c.fillRect(container.x, container.y, 1, 1);
        }
    }
}
```

---

## 7. Files to Modify

### Core Files
- `src/canvas_app/app_state.ts` - Main inventory hookup, world drop handler
- `src/mono_ui/modules/place_module.ts` - Double-click, distance tracking
- `src/mono_ui/modules/container_module.ts` - Distance checks for external containers
- `src/container_storage/store.ts` - Auto-delete empty scattered containers
- `src/interface_program/main.ts` - Pickup API endpoint (may already exist)

### Supporting Files
- `src/types/container.ts` - Add distance tracking types if needed
- `AGENTS.md` - Document pickup/drop mechanics

---

## 8. Implementation Phases

### Phase 1: Hook Up "I" Key (1 hour)
- [ ] Identify main inventory (first equipped sack)
- [ ] Connect "I" key to open equipped sack
- [ ] Test opening/closing with "I" key

### Phase 2: Double-Click to Open (2 hours)
- [ ] Implement double-click detection in place_module
- [ ] Add double-click handler for scattered containers
- [ ] Add double-click handler for NPCs (open character module)
- [ ] Remove debug buttons (CNTRS, GRND, PICKUP, DROP)

### Phase 3: Distance Tracking (2 hours)
- [ ] Track open external containers
- [ ] Check distance on movement
- [ ] Auto-close at 5 tiles
- [ ] Visual indicator for accessible containers

### Phase 4: Pickup from World (2 hours)
- [ ] Drag from world container to inventory
- [ ] "Take All" button for world containers
- [ ] Validate distance on pickup
- [ ] Transfer items to main inventory

### Phase 5: Drop to World (2 hours)
- [ ] Drag from inventory to place module
- [ ] Create scattered container if needed
- [ ] Auto-delete empty containers
- [ ] Visual feedback (item appears on ground)

### Phase 6: Testing & Polish (2 hours)
- [ ] Test full pickup → inventory → drop cycle
- [ ] Test distance limits
- [ ] Test auto-close
- [ ] Verify empty containers delete

---

## 9. Success Criteria

- [ ] Pressing "I" opens equipped sack
- [ ] Double-clicking ground items opens container
- [ ] Can drag items from world container to inventory
- [ ] Can drag items from inventory to ground
- [ ] Moving 5+ tiles away auto-closes external containers
- [ ] Empty scattered containers auto-delete
- [ ] NPCs can be double-clicked to view equipment
- [ ] Debug buttons replaced with double-click

---

## 10. Dependencies

### Already Implemented
- ✅ Scattered loot container system
- ✅ Container module UI
- ✅ Drag and drop system
- ✅ Transfer API
- ✅ Distance calculation utilities

### Required Before Start
- None - can begin immediately

---

**Next Step:** Begin Phase 1 - Hook up "I" key to equipped sack

---

*This plan was created following user requirements for pickup/drop integration with the existing container system.*

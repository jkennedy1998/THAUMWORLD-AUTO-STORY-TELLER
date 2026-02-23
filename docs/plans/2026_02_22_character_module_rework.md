# Character Module Rework

**Status:** Planning  
**Priority:** High  
**Created:** 2026-02-22  
**Related Plans:** 
- 2026_02_19_inventory_movement_plan.md (Phases 7.5, 8, 9)
- 2026_02_14_item_system_unification.md

---

## Overview

Refactor the CharacterModule to provide a comprehensive character inspection interface with three distinct areas: a container sidebar, a pannable body slot view, and a scrollable status bar section. This rework unifies character data display and provides access to all stored items through equipped containers.

**Critical Design Principle:** Characters and NPCs do NOT have a "main inventory." All items must be stored in equipped containers (bags, sacks, pouches) that are worn on body slots. The sidebar displays these equipped containers only.

---

## Current State

### What's Working
- ✅ Basic CharacterModule structure exists
- ✅ Body slots render with slot names and equipped items
- ✅ Weight bar visualization at bottom
- ✅ Gizmos (X/#) implemented for close/move
- ✅ Drag-and-drop equip/unequip functional
- ✅ Module positioning and registry system

### What's Missing
- ❌ Container sidebar showing EQUIPPED containers only (not all body slots)
- ❌ Logic to filter equipped items by container type
- ❌ Health bar display
- ❌ Pan support for body slot area (for large creatures)
- ❌ Scrollable status section for extensibility
- ❌ Consistent border styling across modules
- ❌ Name truncation for long character names

---

## Target Layout

```
╔═════╤══════════════════╗
║ X # │ Name goes here!  ║  <- Header: Gizmos + Character Name
╟─────┼──────────────────╢
║     │                  ║
║ ┌─┐ │                  ║
║ │C│ │    body slot     ║  <- Left: Container boxes
║ └─┘ │      current     ║      Center: Pannable body slots
║     │    rendering     ║
║ ┌─┐ │      here        ║
║ │C│ │     and          ║
║ └─┘ │    pannable      ║
║     │                  ║
╟─────┴──────────────────╢
║ ===============------- ║  <- Status Section: Scrollable
║         weight         ║      - Weight bar
║ ======---------------- ║      - Health bar
║         health         ║      - (Extensible for future stats)
╚════════════════════════╝
```

### Layout Zones

1. **Header Row (1 line)**
   - Left: Gizmo controls (X, #)
   - Right: Character name (truncated if > available space)

2. **Main Content Area (variable height)**
   - **Left Sidebar (~15% width):** Equipped container boxes
     - Shows ONLY equipped items that ARE containers (bags, sacks, pouches)
     - 3x3 box per equipped container
     - Shows item's display_char from definition
     - Empty body slots or non-container items = no box
     - Clickable to open container in ContainerModule
     - Vertically scrollable when >2-3 containers
   - **Center Pane (~85% width):** Body slots
     - Current body slot rendering
     - Pannable for large creatures (drag to pan)
     - Shows slot name and equipped item (any type)

3. **Status Bar Section (3+ lines, scrollable)**
   - Weight bar (existing)
   - Health bar (new)
   - Future: Thaum, Stamina, etc.
   - Vertically scrollable for extensibility

---

## Implementation Phases

### Phase 1: Border System Update

**Goal:** Create consistent double-line border rendering for all modules.

**Tasks:**
- [ ] Create/refactor `draw_double_border()` utility function
  - Uses ╔═╤╗╟─┼╢╚╝ box-drawing characters
  - Accepts rect, colors, title parameters
- [ ] Apply to CharacterModule
- [ ] Document as standard for future modules

**Acceptance:**
- [ ] CharacterModule renders with double-line borders matching mockup
- [ ] Border function is reusable for other modules

---

### Phase 2: Header Section

**Goal:** Implement header with gizmos and name display.

**Tasks:**
- [ ] Reserve top row for header
- [ ] Render X/# gizmos at (x0+1, y1-1) and (x0+3, y1-1)
- [ ] Add `get_actor_name()` callback (already exists)
- [ ] Implement name truncation:
  - Available width = rect.x1 - rect.x0 - 6 (space for gizmos + padding)
  - Truncate with "..." if name exceeds width
- [ ] Draw horizontal divider below header

**Acceptance:**
- [ ] Header displays correctly with gizmos
- [ ] Long names truncate gracefully
- [ ] Visual separator between header and content

---

### Phase 3: Container Sidebar - Equipped Containers Only

**Goal:** Display containers that are actively equipped in body slots. Characters/NPCs have NO "main inventory" - all storage comes from equipped container items.

**Logic:**
1. Get equipped items from all body slots (via `get_equipped_items()`)
2. Check if equipped item IS a container (via item definition tags: "CONTAINER", "BAG", "SACK", etc.)
3. Only show sidebar boxes for equipped containers
4. Empty body slots or non-container items = NO box displayed

**Example:**
- Henry has nothing equipped → 0 boxes
- Gunther has sack equipped on torso → 1 box (the sack)
- NPC with bag on back + pouch on belt → 2 boxes

**Data Structure:**
```typescript
// Equipped container in a body slot
type EquippedContainer = {
  slot_name: string;        // e.g., "torso", "hand_left"
  item_instance: ItemInstance;
  item_definition: ItemDefinition;  // Must have container tag
  container_id: string;     // The container instance ID for this equipped item
};

// Callback to get equipped containers only
get_equipped_containers: () => EquippedContainer[];
```

**Tasks:**
- [ ] Create helper function: `is_container_item(def: ItemDefinition): boolean`
  - Check for tags: "CONTAINER", "BAG", "SACK", "POUCH", "BACKPACK", etc.
- [ ] Add callback: `get_equipped_containers(): EquippedContainer[]`
  - Filter equipped items to only container types
  - Generate container_id for each (format: `container.{actor_id}.{slot_name}`)
- [ ] Create container box rendering:
  - 3x3 box per equipped container ONLY
  - Center char from item definition display_char
  - Spacing between boxes (1 char gap)
- [ ] Add vertical scroll offset state for sidebar
- [ ] Implement scroll handling (mouse wheel) when >2-3 containers
- [ ] Click handler to open container in ContainerModule
  - Pass container_id to open specific container

**Acceptance:**
- [ ] Only equipped containers show in sidebar (not empty slots)
- [ ] Non-container equipped items don't create boxes
- [ ] Shows correct character from equipped item definition
- [ ] Clicking opens ContainerModule with that specific container
- [ ] Scrollable when many containers equipped
- [ ] Empty inventory = empty sidebar (no boxes)

---

### Phase 4: Pannable Body Slot Area

**Goal:** Make body slot section pannable for large creatures.

**Tasks:**
- [ ] Define body slot pane rect (right side, below header, above status)
- [ ] Add pan offset state: `{ x: number, y: number }`
- [ ] Implement pan drag handling:
  - Drag in body slot area pans the view
  - Constrain pan to content bounds
- [ ] Render body slots with pan offset applied
- [ ] Optional: Add mini-map or scroll indicators

**Acceptance:**
- [ ] Body slots render in pannable area
- [ ] Dragging pans the view
- [ ] Pan constrained to content bounds
- [ ] Works with existing drag-and-drop equip/unequip

---

### Phase 5: Scrollable Status Section

**Goal:** Create extensible status bar area.

**Tasks:**
- [ ] Reserve bottom 3+ lines for status section
- [ ] Add vertical scroll offset state
- [ ] Render weight bar (existing functionality)
- [ ] Add health bar:
  - Callback: `get_health_data(): { current: number; max: number }`
  - Visual bar similar to weight
- [ ] Implement scroll handling for status area
- [ ] Prepare for future stat additions (thaum, stamina, etc.)

**Acceptance:**
- [ ] Weight bar displays correctly
- [ ] Health bar displays correctly
- [ ] Section scrolls when content exceeds height
- [ ] Scroll position persists during interaction

---

### Phase 6: Integration & Testing

**Goal:** Integrate all components and ensure data flows correctly.

**Tasks:**
- [ ] Update CharacterModuleConfig interface with new callbacks
- [ ] Implement all new callbacks in app_state.ts
- [ ] Connect health data from actor/npc stats
- [ ] Connect container data from body slots
- [ ] Test with different character sizes:
  - Standard 6-slot actors
  - NPCs with fewer slots
  - Future: Large creatures with many slots
- [ ] Verify drag-and-drop still works
- [ ] Verify gizmos still work

**Acceptance:**
- [ ] Complete character module renders as per mockup
- [ ] All interactions work (pan, scroll, click, drag)
- [ ] Data displays correctly for player and NPCs
- [ ] No regressions in existing functionality

---

## Technical Implementation Details

### New Callbacks Required

```typescript
export type CharacterModuleConfig = {
  // ... existing callbacks ...
  
  // NEW: Get equipped containers for sidebar (filtered to container-type items only)
  get_equipped_containers: () => Array<{
    slot_name: string;
    item_instance: ItemInstance;
    item_definition: ItemDefinition;
    container_id: string;  // Format: container.{actor_id}.{slot_name}
  }>;
  
  // NEW: Helper to check if item is a container type
  is_container_item: (definition: ItemDefinition) => boolean;
  
  // NEW: Health data for status bar
  get_health_data: () => { current: number; max: number };
  
  // NEW: Container click handler
  on_container_click?: (container_id: string) => void;
};
```

### Data Flow

1. **Container Sidebar (Equipped Containers Only):**
   - Get equipped items from `get_equipped_items()`
   - For each equipped item, check if it's a container type via `is_container_item()`:
     - Check item definition tags for: "CONTAINER", "BAG", "SACK", "POUCH", etc.
   - Filter to only container-type items
   - Generate container_id: `container.{actor_id}.{slot_name}`
   - Get display_char from item definition
   - Render 3x3 box for each equipped container
   - **Important:** Only shows equipped containers, not all body slots

2. **Body Slot Area:**
   - Use existing body slot rendering
   - Shows ALL equipped items (containers and non-containers)
   - Apply pan offset to all positions
   - Maintain existing drag-and-drop equip/unequip

3. **Status Section:**
   - Weight: Sum weight of all equipped items (existing)
   - Health: From actor/npc resources.health
   - Render bars with proportional fill

### Inventory System Design

**No "Main Inventory":** Characters and NPCs do not have a default inventory. All item storage must come from equipped containers.

**Storage Rules:**
- To store items, character must equip a container (bag, sack, etc.) in a body slot
- Items go INTO the equipped container
- Unequipping a container with items = items stay in container (container goes with item)
- Maximum storage = sum of all equipped container capacities

**Example Flow:**
1. Henry equips "sack" item on his torso
2. Sidebar shows 1 box (the sack)
3. Henry picks up sword → sword goes INTO the sack
4. ContainerModule can open the sack to see/manage contents
5. Henry unequips sack → sack (with sword inside) is now in hand/inventory as item

### Border Rendering

```typescript
// Utility function to draw double-line border
draw_module_border(c: Canvas, rect: Rect, config: {
  header?: string;
  header_rgb?: Rgb;
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
}): void;
```

Uses box-drawing characters:
- Corners: ╔ ╗ ╚ ╝
- Horizontal: ═ ─
- Vertical: ║ │
- Junctions: ╤ ╟ ┼ ╢

---

## Files to Modify

1. **New:** `src/mono_ui/module_borders.ts` - Border rendering utility
2. **Update:** `src/mono_ui/modules/character_module.ts` - Major refactor
3. **Update:** `src/canvas_app/app_state.ts` - New callbacks
4. **Update:** `src/types/character.ts` - Type definitions (if needed)

---

## Dependencies

- Container system (already implemented)
- Body slot system (already implemented)
- Module gizmos (Phase 8 - completed)
- Module registry (Phase 7.5 - completed)

---

## Future Enhancements

- **Nested Containers:** Open containers-within-containers via ContainerModule
- **Additional Stats:** Thaum, stamina, action points in status section
- **Equipment Comparison:** Show stat changes when hovering equipped items
- **Quick Actions:** Right-click menu on body slots (examine, unequip, etc.)

---

## Notes

### Critical Design Principles

**1. No "Main Inventory":**
Characters and NPCs do NOT have a default inventory or "pocket" storage. All items must be stored in equipped containers. This replaces traditional RPG inventory systems.

**2. Equipped Containers Only:**
The sidebar only shows containers that are actively equipped as items in body slots. Empty slots or non-container items do not appear in the sidebar.

**3. First-Layer Only:**
The sidebar shows only containers equipped directly on body slots. Nested containers (containers within equipped containers) are accessed via the ContainerModule, not the sidebar.

**4. Container Identification:**
An item is considered a "container" if its definition has specific tags:
- "CONTAINER" (generic)
- "BAG" 
- "SACK"
- "POUCH"
- "BACKPACK"
- "WALLET"
- Any other container-type tag

**5. State Management:**
- Pan and scroll offsets should reset when module opens
- Consider minimum module dimensions to ensure usability
- Sidebar scrolls independently of body slot panning

---

---

## Phase 7: Right-Click Container Opening System

**Goal:** Enable users to right-click on equipped container items to open them in ContainerModule instances. This is a core tabletop RPG interaction pattern for equipment and trade.

### Architecture Overview

**Design Principle:** This is a **reusable Item Slot pattern** that any module can implement. It provides consistent item interaction across the entire UI:
- Right-click = Open/Interact with item
- Left-click = Select/Use item  
- Visual feedback = Container type identification

**Multi-Instance Container Support:**
- Multiple ContainerModules can be open simultaneously
- Each has unique ID: `container_module_{instance_id}`
- Positioned center-screen initially, user moves via widgets
- Frontend tracks open containers for visual state management

### 7.1 Item Slot Component Pattern

**Reusable across modules:**
- CharacterModule body slots
- CharacterModule sidebar containers  
- Future: Ground items, NPC inventories, shop displays

**Standard Interactions:**
```typescript
// Left-click (button 0)
- Select slot/item
- Initiate drag for transfer
- Context-aware action

// Right-click (button 2)  
- If container item: Open container in new ContainerModule
- If equipment: Show equipment details/actions
- If consumable: Quick-use or examine
```

### 7.2 Container Visual State System

**Color Coding for Tabletop Clarity:**

| State | Color | Visual Target | Meaning |
|-------|-------|---------------|---------|
| **Default Container** | Orange | Item display character | "This is a container" |
| **Open/Displayed** | Purple | Item display character | "This container is currently open" |
| **Hovered** | Bright White/Yellow | Item display character | "Mouse over this item" |
| **Selected** | Cyan highlight | Slot border/background | "Selected for action" |

**Implementation:**
- Character maintains `open_containers: Set<string>` in frontend state
- Key = container_id (e.g., "container.henry_actor.leg_left")
- Updated when: ContainerModule opens, closes, or switches
- CharacterModule subscribes to ContainerModule registry changes

### 7.3 Right-Click Handler Implementation

**CharacterModule Changes:**

```typescript
// Add to CharacterModuleConfig
on_open_container?: (container_id: string, slot_name: string) => Promise<void>;
get_open_containers?: () => Set<string>; // Returns set of open container IDs

// In OnPointerDown
OnPointerDown(e: PointerEvent): void {
  // ... existing gizmo check ...
  
  const slot_name = get_slot_at_position(e.x, e.y);
  if (!slot_name) return;
  
  const equipped = opts.get_equipped_items().get(slot_name);
  
  // RIGHT-CLICK: Open container or context menu
  if (e.button === 2) {
    if (equipped && is_container_item(equipped.definition)) {
      const container_id = `container.${opts.get_actor_id()}.${slot_name}`;
      void opts.on_open_container?.(container_id, slot_name);
    } else if (equipped) {
      // Future: Show equipment context menu
      opts.on_slot_context_menu?.(slot_name, equipped);
    }
    return;
  }
  
  // ... existing left-click handling ...
}

// In Draw() - Update item color based on state
function get_item_color(def: ItemDefinition, slot_name: string): Rgb {
  const open_containers = opts.get_open_containers?.() || new Set();
  const container_id = `container.${opts.get_actor_id()}.${slot_name}`;
  
  // Priority: Open > Container > Normal
  if (open_containers.has(container_id)) {
    return { r: 180, g: 100, b: 220 }; // Purple - container is open
  }
  if (is_container_item(def)) {
    return { r: 255, g: 165, b: 0 }; // Orange - is a container
  }
  return { r: 200, g: 200, b: 200 }; // Normal gray
}
```

### 7.4 Sidebar Container Interaction

**Sidebar boxes also support right-click:**
- Clicking "C" box (equipped container) opens that container
- Visual feedback: Box border turns purple when container is open
- Consistent with body slot interaction pattern

### 7.5 ContainerModule Multi-Instance Manager

**Frontend State Extension:**

```typescript
// In ui_state
const ui_state = {
  // ... existing ...
  
  container: {
    open_modules: new Map<string, ContainerModuleInstance>(),
    // Key: container_id, Value: module instance reference
  }
};

type ContainerModuleInstance = {
  module_id: string;        // "container_module_3"
  container_id: string;     // "container.henry_actor.leg_left"
  rect: Rect;
  is_visible: boolean;
};
```

**Dynamic Creation:**

```typescript
async function open_container_module(container_id: string, parent_module_id?: string): Promise<void> {
  // Check if already open
  if (ui_state.container.open_modules.has(container_id)) {
    flash_status(["Container already open"], 800);
    return;
  }
  
  // Fetch container data
  const res = await fetch(`http://localhost:8787/api/container?id=${container_id}`);
  const data = await res.json();
  
  if (!data.ok) {
    flash_status(["Failed to load container"], 1500);
    return;
  }
  
  // Generate unique module ID
  const instance_id = `container_module_${Date.now()}`;
  
  // Create positioned rect (center screen)
  const rect = calculate_container_position();
  
  // Create and register module
  const container_module = make_container_module({
    id: instance_id,
    rect,
    get_container: () => data.container,
    // ... other callbacks ...
    on_close: () => {
      close_container_module(container_id);
    }
  });
  
  module_registry.register(container_module);
  ui_state.container.open_modules.set(container_id, {
    module_id: instance_id,
    container_id,
    rect,
    is_visible: true
  });
  
  // Notify parent module (CharacterModule) to update visuals
  notify_container_opened(container_id);
}

function close_container_module(container_id: string): void {
  const instance = ui_state.container.open_modules.get(container_id);
  if (instance) {
    module_registry.unregister(instance.module_id);
    ui_state.container.open_modules.delete(container_id);
    notify_container_closed(container_id);
  }
}
```

### 7.6 Positioning Strategy

**Initial Position (Center Screen):**
```typescript
function calculate_container_position(): Rect {
  const grid_w = APP_CONFIG.grid_width;
  const grid_h = APP_CONFIG.grid_height;
  const module_w = 39;  // Standard container width
  const module_h = 18;  // Standard container height
  
  // Center with slight offset for multiple containers
  const open_count = ui_state.container.open_modules.size;
  const offset = open_count * 3;
  
  return {
    x0: Math.floor((grid_w - module_w) / 2) + offset,
    y0: Math.floor((grid_h - module_h) / 2) + offset,
    x1: Math.floor((grid_w + module_w) / 2) + offset,
    y1: Math.floor((grid_h + module_h) / 2) + offset
  };
}
```

**User Positioning:**
- User can drag ContainerModule using # widget
- Position persisted during session (not saved to disk for now)
- Future: Save positions to user preferences

### 7.7 Trade and Equipment Architecture

**System-Wide Item Flow:**

```
[Character A - Body Slot: torso] 
    ↓ Right-click to open
[ContainerModule: sack] ← Purple = Open
    ↓ Drag item
[Character B - Body Slot: leg_left]
    ↓ Right-click to open  
[ContainerModule: pouch] ← Purple = Open
```

**Trade Scenarios:**
1. **Direct Transfer:** Drag from open container A to open container B
2. **Equip Transfer:** Drag from open container to character body slot
3. **Ground Transfer:** Drag from open container to place ground
4. **Multi-step:** Open multiple containers, drag between them

**Tabletop Equivalence:**
- Open container = "I open my backpack"
- Drag item = "I hand you the sword"
- Visual purple state = "The bag is open on the table"
- Multiple containers = "We have several bags open for trading"

### Tasks:

- [x] Add right-click detection (button === 2) in CharacterModule
- [x] Implement `on_open_container` callback in app_state.ts
- [x] Create `open_container_module()` dynamic module creator
- [x] Add frontend state tracking for open containers (`open_containers` Set)
- [x] Add loading lock to prevent double-opens (`opening_containers` Set)
- [x] Implement color system (orange/purple) for container items
- [x] Update sidebar boxes to support right-click and left-click
- [x] Add ContainerModule close handler to update visual state
- [x] Test multi-instance positioning
- [x] Test trade scenarios (A→B transfers)

### Acceptance Criteria:
- [x] Right-click equipped sack opens new ContainerModule
- [x] ContainerModule positioned center-screen initially
- [x] Item character turns purple when container is open
- [x] Multiple ContainerModules can be open simultaneously
- [x] Closing ContainerModule removes purple state
- [x] Works for both player and NPC characters
- [x] Sidebar "C" boxes also support right-click open
- [x] Double-click protection prevents opening same container twice

### Bug Fixes:
- [x] **Double-Click Protection:** Added `opening_containers` Set to lock container during async opening
  - Prevents rapid clicks from opening multiple instances
  - Lock released in `finally` block to ensure cleanup
  - Returns early with "Container already open" or "Currently opening" message

---

## Phase 8: Universal Drag-and-Drop Routing System

**Goal:** Implement comprehensive drag-and-drop that routes drops to the target under the cursor, not the source. Enable dropping items to ground, NPCs, containers, and other characters with smart validation.

### 8.1 Core Architecture Change

**Problem:** Current system routes `OnDragEnd` to the source module (where drag started), not the target module (where cursor is).

**Solution:** Modify CanvasRuntime to route drops to the module under the cursor.

**Files to Modify:**
- `src/mono_ui/runtime/canvas_runtime.ts` - Route OnDragEnd to target module
- `src/mono_ui/module_registry.ts` - Add `find_module_at_position()` helper
- All module `OnDragEnd` handlers - Update to handle external drops

### 8.2 Drop Routing Logic

```typescript
// In CanvasRuntime
onDragEnd(e: DragEvent) {
  // Find module under cursor
  const target_module = module_registry.find_module_at_position(e.x, e.y);
  
  if (target_module) {
    // Route to target module
    target_module.OnDragEnd(e);
  } else {
    // Drop on ground/background
    handle_ground_drop(e);
  }
}
```

### 8.3 Drop Target Types

**1. ContainerModule (Open Container)**
- Drop on specific slot → Place in that slot
- Drop on module but no slot → Auto-find first free slot
- Drop on item → Attempt swap if compatible
- Drop on container item → Act as dropping into that container

**2. CharacterModule (Body Slot)**
- Drop on slot → Equip item (if compatible)
- Drop on equipped container → Act as dropping into container

**3. PlaceModule (Ground)**
- Drop on empty tile → Create new ground pile
- Drop on existing pile → Add to pile
- Drop on NPC → Put in NPC's main container (if in range)

**4. Background (No Module)**
- Drop at actor position → Drop on ground
- Check range (cardinal tiles around actor)

### 8.4 Smart Validation System

**Pre-Move Validation:**
```typescript
interface DropValidation {
  can_drop: boolean;
  target_slot?: number;      // Specific slot or auto-found
  operation: 'place' | 'swap' | 'stack' | 'reject';
  reason?: string;           // Why rejected
}

function validate_drop(
  item: ItemInstance,
  item_def: ItemDefinition,
  target_module: Module,
  target_x: number,
  target_y: number
): DropValidation
```

**Validation Rules:**

**A. ContainerModule Drop:**
1. **Hit specific slot:**
   - Slot empty? → Place item
   - Slot has item?
     - Item is container? → Route to container (nested)
     - Items compatible? → Offer swap
     - Stackable? → Stack quantities
     - Incompatible? → Reject

2. **Hit module, no specific slot:**
   - Find first free slot
   - No free slots? → Reject ("Container full")

3. **Hit container item:**
   - Open container module (if not open)
   - Route drop into that container
   - Apply container drop rules recursively

**B. CharacterModule Drop:**
1. **Hit body slot:**
   - Check slot compatibility (via `valid_body_slots`)
   - Compatible? → Equip
   - Slot occupied?
     - Both items fit each other's slots? → Swap
     - Otherwise → Reject

2. **Hit equipped container:**
   - Open container
   - Route drop inside

**C. PlaceModule Drop:**
1. **Hit NPC:**
   - Check range (within cardinal tiles of actor)
   - In range? → Put in NPC's main container
   - Out of range? → Reject ("Too far")

2. **Hit ground pile:**
   - Pile is container? → Put inside
   - Pile is loose items? → Add to pile
   - Stackable with existing? → Stack

3. **Hit empty tile:**
   - Create new ground pile
   - Place item at tile position

### 8.5 Stacking Logic

**Stack Compatibility Check:**
```typescript
function can_stack(
  item_a: ItemInstance, 
  def_a: ItemDefinition,
  item_b: ItemInstance,
  def_b: ItemDefinition
): boolean {
  // Must be same def_id
  if (def_a.id !== def_b.id) return false;
  
  // Must have stackable tag
  if (!def_a.stackable || !def_b.stackable) return false;
  
  // Check max stack size
  const max_stack = def_a.max_stack_size || 1;
  if (item_a.qty + item_b.qty > max_stack) return false;
  
  // Check tags match
  const tags_match = compare_item_tags(item_a, item_b);
  
  return tags_match;
}
```

**Stacking Behavior:**
- If can_stack: Add quantities, keep one instance
- If cannot_stack: Treat as separate items, need different slots

### 8.6 Range Checking for Ground Drops

**Cardinal Tile Check:**
```typescript
function is_in_drop_range(
  actor_pos: {x: number, y: number},
  drop_pos: {x: number, y: number}
): boolean {
  // Check cardinal directions (N, S, E, W) and current tile
  const dx = Math.abs(drop_pos.x - actor_pos.x);
  const dy = Math.abs(drop_pos.y - actor_pos.y);
  
  // Must be adjacent (1 tile) or same tile
  return (dx <= 1 && dy <= 1) && (dx + dy <= 1);
}
```

### 8.7 Swap Detection

**Item Swap Validation:**
```typescript
function can_swap_items(
  item_a: ItemInstance,
  def_a: ItemDefinition,
  slot_a: string,
  item_b: ItemInstance,
  def_b: ItemDefinition,
  slot_b: string
): boolean {
  // Check if item_a fits in slot_b
  const a_fits_b = def_a.valid_body_slots?.includes(slot_b);
  
  // Check if item_b fits in slot_a
  const b_fits_a = def_b.valid_body_slots?.includes(slot_a);
  
  return a_fits_b && b_fits_a;
}
```

### Tasks:

- [x] Update CanvasRuntime to route OnDragEnd to target module
- [x] Add `find_module_at_position()` to module_registry
- [x] Update ContainerModule OnDragEnd for external drops (already supported via drag_state)
- [x] Update CharacterModule OnDragEnd for external drops (already supported via drag_state)
- [x] Implement capacity validation in transfer API (add_item_to_container)
- [x] Add debug logging for overfull containers
- [ ] Implement ground drop handling
- [ ] Implement range checking for ground/NPC drops
- [ ] Add smart validation (place/swap/stack/reject)
- [ ] Implement stacking logic
- [ ] Implement swap detection
- [ ] Test drag: Character torso → Open container on leg
- [ ] Test drag: Container → Character body slot
- [ ] Test drag: Container → Ground pile
- [ ] Test drag: Character → NPC (in range)

### Acceptance Criteria:
- [x] CanvasRuntime routes OnDragEnd to module under cursor (not source)
- [x] Transfer API validates container capacity before adding items
- [x] Debug logging for overfull container attempts
- [x] Rejects drops when container full (API returns error)
- [ ] Drag from CharacterModule to ContainerModule works
- [ ] Drag from ContainerModule to CharacterModule works
- [ ] Drag to ground creates pile at drop location
- [ ] Drag to NPC puts item in NPC's main container (in range)
- [ ] Auto-finds first free slot when dropping on module
- [ ] Swaps items when both fit in each other's slots
- [ ] Stacks compatible items
- [ ] Shows appropriate error messages for rejected drops
- [ ] Range check prevents dropping too far from actor

### Deprecated Systems:

The following systems are **replaced** by this implementation and should be removed/refactored:

- **Old `on_cross_module_drop` callback** - Replaced by routing to target module
- **Source-module-based drop handling** - Now handled by target module
- **Simple within_rect checks** - Replaced by comprehensive validation

---

**Status:** Phase 7 Complete ✓ | Phase 8 Core Complete ✓ | Phase 8 Extended Pending

**Completed:**
- ✅ Phase 7: Right-click container opening with multi-instance support
- ✅ Phase 7: Orange/purple color coding for container states  
- ✅ Phase 8: CanvasRuntime routing fix (routes drops to target module)
- ✅ Phase 8: Transfer API capacity validation with debug logging

**Next Steps:**
1. Test transfer with full container rejection
2. Test drag scenarios between CharacterModule and ContainerModule
3. Implement ground drop handling (drag to background)
4. Implement range checking for ground/NPC drops
5. Add smart validation (place/swap/stack/reject)
6. Add Health Bar to Status Section (Phase 5)

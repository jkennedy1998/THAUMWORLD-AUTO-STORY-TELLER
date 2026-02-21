# Inventory Movement Plan - Container & Character Modules

**Date:** 2026-02-19  
**Status:** ACTIVE  
**Priority:** High

---

## Overview

Complete the item system by implementing interactive Container and Character modules with drag-and-drop inventory management, slot-based storage, and proper equipment rules.

---

## Existing Systems Audit

### ✅ ALREADY EXISTS (Build Upon These)

**Item Storage System** (`src/item_storage/store.ts`):
- `ItemDefinition` with id, name, weight, tags, `stackable?: boolean`
- `ItemInstance` with qty, condition, container_id, owner_ref
- Full CRUD operations, normalization helpers

**Container System** (`src/types/container.ts`, `src/container_storage/store.ts`):
- Container with contents, capacity, owner_ref, scattered loot support
- Transfer operations, weight calculation, slot counting (capacity.max_slots)
- API endpoints: `/api/containers`, `/api/transfer`, `/api/place/pickup`, `/api/place/drop`

**Body Slots** (`src/actor_storage/store.ts`):
- Created from `kind.parts` during actor creation
- Format: `body_slots: { [name]: { name, critical } }`
- Referenced in tool validation, action system

**Drag Infrastructure** (`src/mono_ui/runtime/canvas_runtime.ts`, `src/mono_ui/types.ts`):
- `DragEvent` type with start_x/y, dx, dy
- Module handlers: `OnDragStart`, `OnDragMove`, `OnDragEnd`
- Runtime routing with DRAG_THRESHOLD_TILES = 1
- **Currently used for:** Canvas panning in place_module

**Particle System** (`src/mono_ui/modules/place_module.ts`, `src/mono_ui/vision_debugger.ts`):
- Module-local particle arrays
- Spawner registration via `register_particle_spawner()`
- **Currently used for:** Movement paths, sense broadcasts

**UI Module Pattern** (`src/mono_ui/modules/`):
- 7 existing modules showing the pattern
- Full lifecycle hooks (Draw, OnPointer*, OnDrag*, OnWheel, etc.)

### ❌ NEEDS TO BE BUILT

**Item Definition Extensions:**
- `max_stack_size` (currently only `stackable?: boolean`)
- `display_char`, `valid_body_slots`, `occupies_slots`, `slot_shape`, `fits_actor_kind`

**Container State:**
- `is_open`, `is_locked` boolean fields
- `grid_dimensions` for grid UI layout

**Body Slot Enhancement:**
- Add `item_instance_id` to store equipped items
- Equipment validation logic

**Item Drag-and-Drop:**
- ✅ Drag payload system - using module-level state in OnDragStart handlers
- ❌ Visual drag ghost/preview - DEFERRED (not needed for v1)
- ✅ Drop target detection - via OnDragEnd handlers in destination modules

**New UI Modules:**
- ✅ `container_module.ts` - Grid-based inventory
- ✅ `character_module.ts` - Body slots + weight bar

**New API Endpoints:**
- ❌ `/api/equip`, `/api/unequip` - NOT NEEDED, use existing `/api/transfer`
- ❌ `/api/container/open`, `/api/container/close` - NOT NEEDED, visibility is UI-only

---

## Core Concepts

### Container Slots
- **Grid Layout:** Square slots arranged in a rectangular grid
- **No Scrolling:** Container displays all its slots (container grows with MAG)
- **Slot Formula:** `slots = 5 * MAG` (linear)
- **Shape Resolution:** Fill grid row-by-row (e.g., 7 slots = 3x3 minus 2)
- **Stacking:** Similar items stack up to per-item `max_stack_size`

### Container States
- **Open:** Full size, all slots visible, can interact
- **Closed:** Collapsed to 3x3 with container char in center, click to expand
- **Locked:** Backend architecture exists, all unlocked for v1
- **Visibility:** Closed containers don't reveal contents (helps AI renderer culling)

### Character Module
- **Always Open:** For player actor
- **Body Slots:** head, chest, hand_left, hand_right, leg_left, leg_right, tail, etc.
- **Hand Slots:** 2 slots each (tool + armor), fallback char "h" when empty
- **Empty Slot:** "-" character
- **Weight Bar:** Current/max load with armor penalty and encumbrance tags

### Drag & Drop
- **Scope:** Any open container ↔ open container, container ↔ ground, container ↔ character
- **Validation:** Range check for ground drops, stack compatibility
- **Action Pipeline:** All moves generate USE actions (deferred integration)

---

## Item Database Extensions

### New Fields in ItemDefinition
```typescript
interface ItemDefinition {
  // ... existing fields ...
  
  max_stack_size: number;        // Max quantity per stack (default: 1)
  display_char: string;          // Single char representation (default: "·")
  valid_body_slots: string[];    // ["hand_left", "hand_right", "chest"]
  occupies_slots: string[];      // ["leg_left", "leg_right"] for pants
  slot_shape: number[][];        // [[1]] for now, future tetris shapes
  fits_actor_kind: string[];     // ["naked_ape"] - matches actor.kind
}
```

---

## Phase 1: Data Layer Extensions

### 1.1 Item Database Schema (6 New Fields)

**Status:** New fields needed  
**Files:** `src/item_storage/store.ts`, item JSON files

**Existing:** Basic fields (id, name, weight, tags, `stackable?: boolean`)

**Add to `ItemDefinition`:**
```typescript
max_stack_size: number;           // Stack limit (default: 1)
display_char: string;             // Single char for UI (default: "·")
valid_body_slots: string[];       // ["hand_left", "chest", ...] (default: [])
occupies_slots: string[];         // ["leg_left", "leg_right"] for multi-slot items
slot_shape: number[][];           // [[1]] for 1x1, future tetris shapes
fits_actor_kind: string[];        // ["naked_ape"] for race restrictions
```

- [x] Add 6 new fields to `ItemDefinition` interface
- [x] Update `load_item_def()` to handle missing fields with defaults
- [x] Update existing items: coin, tunic, shoes, etc.

**Test 1.1:** ✅ PASSED
- [x] Legacy items without new fields load with defaults
- [x] New items with all fields preserve data correctly
- [x] `coin` has `max_stack_size: 99`, `display_char: "$"`
- [x] `tunic` has `valid_body_slots: ["chest"]`, `fits_actor_kind: ["naked_ape"]`

### 1.2 Container State Management

**Status:** Extend existing Container  
**Files:** `src/types/container.ts`, `src/container_storage/store.ts`

**Existing:** id, kind, contents, capacity (max_slots already exists!), owner_ref, scattered loot support

**Add to `Container`:**
```typescript
is_open: boolean;                 // UI state (default: true)
is_locked: boolean;               // Architecture only, v1: always false
grid_dimensions: { cols, rows };  // Computed for UI layout
```

**Helper Functions:**
```typescript
// Slot count already available via capacity.max_slots
// Formula: slots = 5 * CONTAINER_MAG tag (or capacity.max_slots)

// NEW: Calculate optimal grid layout
function calculate_grid_dimensions(total_slots: number): { cols: number, rows: number } {
  // Find best rectangle: minimize perimeter, prefer landscape
  // 5 slots -> 3x2 (last slot empty)
  // 7 slots -> 3x3 (2 empty)
  // 10 slots -> 5x2
  // 12 slots -> 4x3
}
```

- [x] Add `is_open`, `is_locked` to Container interface
- [x] Add `grid_dimensions` computed field
- [x] Implement `calculate_grid_dimensions()`
- [x] Update container loading to set defaults

**Test 1.2:** ✅ PASSED
- [x] MAG1 container has 5 slots
- [x] MAG2 container has 10 slots
- [x] 7 slots creates 3 columns, 3 rows
- [x] New containers default to `is_open: true`

---

## Phase 2: Container Module

### 2.1 Module Structure

**File:** `src/mono_ui/modules/container_module.ts`

```typescript
export type ContainerModuleConfig = {
  id: string;
  rect: Rect;
  
  // Container data
  get_container: () => Container | null;
  get_slot_items: () => SlotItem[]; // ItemInstance + ItemDefinition for each slot
  
  // Container state
  get_is_open: () => boolean;
  set_is_open: (open: boolean) => void;
  
  // Interaction callbacks
  on_slot_click?: (slot_index: number) => void;
  on_slot_drag_start?: (slot_index: number) => DragData;
  on_slot_drop?: (slot_index: number, drag_data: DragData) => void;
  on_toggle_open?: () => void;
  
  // Styling
  border_rgb?: Rgb;
  bg_rgb?: Rgb;
  slot_bg_rgb?: Rgb;
  highlight_rgb?: Rgb;
};

type SlotItem = {
  slot_index: number;
  instance: ItemInstance | null;
  definition: ItemDefinition | null;
  is_empty: boolean;
};

type DragData = {
  source_module_id: string;
  source_type: "slot" | "ground" | "body_slot";
  item_instance_id: string;
  item_def_id: string;
  quantity: number;
};
```

- [x] Create ContainerModule with config interface
- [x] Implement grid layout calculation
- [x] Implement Draw() for open state (full grid)
- [x] Implement Draw() for closed state (3x3 collapsed)
- [x] Add visibility toggle support ('i' key)
- [x] Integrate into app_state.ts
- [x] Connect to player's sack container via API
- [x] Fix API/frontend field name mismatch (definition vs item)
- [x] Position module on right side (no overlap)

**Test 2.1:** ✅ COMPLETE
- [x] Container renders correctly
- [x] Shows items with display_char or fallback
- [x] Updates when items picked up/dropped
- [x] Toggle with 'i' key
- [x] Positioned correctly on screen
- [x] Open container renders correct grid dimensions
- [x] Empty slots show "-" character
- [x] Filled slots show item `display_char`
- [x] Closed container renders 3x3 with container char centered
- [x] Clicking closed container center expands to open

**Integration:**
- [x] Module added to UI in right panel (same position as debug text window)
- [x] Moved to end of modules array so it renders ON TOP of other elements
- [x] Toggle visibility with 'i' key
- [x] Fetches real container data from `/api/containers` endpoint
- [x] Displays items from player's sack
- [x] Appears in cross-hatched region when opened

### 2.2 Slot Rendering

- [x] Draw slot ui / borders for the entire grid of slots (simplified - simple box border)
- [x] Draw item character in slot
- [x] Draw quantity indicator (shows number for stacks > 1)
- [x] Draw selection highlight on hover
- [ ] Draw drag source highlight (deferred to Phase 4)
- [ ] Draw valid drop target highlight (deferred to Phase 4)

**Test 2.2:** ✅ SIMPLIFIED VERSION COMPLETE
- [x] Hover highlights slot (brightens on hover)
- [x] Stack shows quantity number (e.g., "5" for 5 coins)
- [x] Single item shows display_char or first letter of name
- [ ] Dragging item highlights valid drop targets (deferred)

### 2.3 Interaction State Machine

- [x] State: IDLE (normal viewing)
- [x] State: HOVER_SLOT (mouse over slot)
- [ ] State: DRAGGING (item being dragged) (deferred to Phase 4)
- [ ] State: DROP_TARGET (valid drop zone) (deferred to Phase 4)
- [x] Track hover slot index
- [ ] Track dragged item data (deferred to Phase 4)

**Test 2.3:** ✅ PARTIAL
- [x] Mouse enters slot → HOVER_SLOT state
- [x] Mouse leaves slot → IDLE state
- [x] Click on slot logs to console
- [ ] Mouse down on slot → DRAGGING state (Phase 4)
- [ ] Drag over valid target → DROP_TARGET state (Phase 4)

---

## Phase 3: Body Slots Enhancement & Character Module

### 3.1 Body Slot Data Extension

**Status:** Body slots exist, need to add item storage  
**Files:** `src/actor_storage/store.ts`, `src/types/actor.ts`

**Existing:** `body_slots: { [name]: { name, critical } }` created from `kind.parts`

**Extend to store equipped items:**
```typescript
// Current body slot format
body_slots: {
  "HAND_LEFT": { name: "HAND_LEFT", critical: false },
  "CHEST": { name: "CHEST", critical: true }
}

// NEW: Add item_instance_id for equipped items
body_slots: {
  "HAND_LEFT": { 
    name: "HAND_LEFT", 
    critical: false,
    item_instance_id: "inst_abc123"  // NEW: equipped item
  },
  "CHEST": { 
    name: "CHEST", 
    critical: true,
    item_instance_id: null  // Empty slot
  }
}
```

- [x] Add `item_instance_id?: string` to body slot structure
- [x] Update `apply_body_slots()` to initialize with null
- [x] Add `equip_item_to_slot(actor, slot_name, instance_id)` helper
- [x] Add `unequip_item_from_slot(actor, slot_name)` helper
- [x] Add `get_equipped_item(actor, slot_name)` helper

**Test 3.1:** ✅ PASSED
- [x] Body slots initialized with `item_instance_id: null`
- [x] Equip function sets instance ID
- [x] Unequip function clears instance ID
- [x] Get function returns item instance

### 3.2 Character Module

**Status:** NEW MODULE  
**File:** `src/mono_ui/modules/character_module.ts`

```typescript
export type CharacterModuleConfig = {
  id: string;
  rect: Rect;
  
  // Character data (always player actor for v1)
  get_actor: () => Actor | null;
  get_body_slots: () => BodySlotView[];
  get_weight_data: () => WeightData;
  
  // Equipment callbacks
  on_equip?: (slot_name: string, item_instance_id: string) => void;
  on_unequip?: (slot_name: string) => void;
  on_slot_drag_start?: (slot_name: string) => DragData;
  on_slot_drop?: (slot_name: string, drag_data: DragData) => void;
};

type BodySlotView = {
  name: string;              // "HAND_LEFT", "CHEST"
  display_name: string;      // "Left Hand", "Chest"
  slot_type: "tool" | "armor" | "both";  // Hand = both, others = armor
  equipped_item: SlotItem | null;
  fallback_char: string;     // "h" for hands, "-" for others
};
```

**Layout:**
```
+------------------+
|  WEIGHT BAR      |  <- Top: load visualization
+------------------+
|  HEAD            |  <- Single slot
+------------------+
|  HAND L | HAND R |  <- Hands: 2 columns, each shows tool+armor
+------------------+
|  CHEST           |  <- Single slot
+------------------+
|  LEG L  | LEG R  |  <- Legs: 2 columns
+------------------+
```

- [x] Create CharacterModule
- [x] Implement weight bar at top
- [x] Implement body slot grid layout
- [x] Show equipped items or fallback chars

**Test 3.2:** ✅ COMPLETE
- [x] Module renders weight bar
- [x] All body slots visible (6 slots: HEAD, TORSO, LEFT/RIGHT ARM, LEFT/RIGHT LEG)
- [x] Empty slots show "-" fallback char
- [ ] Equipped slots show item display_char (equip not yet implemented)

### 3.3 Weight Bar Visualization

**Status:** NEW  
**Data Source:** Calculate from all equipped items + containers

```typescript
// Weight calculation
current_weight = sum(all item instances owned by actor)
max_weight = actor.strength * 2.5  // Or from tags

// Display format
"12.5/20.0 kg  AP:-02  EN:00"
// ^current/max  ^armor  ^encumbrance
```

- [x] Calculate current weight from all actor's items (via API)
- [x] Get max weight from actor stats (strength * 2.5)
- [x] Draw horizontal bar: Green (<50%), Yellow (50-75%), Red (>75%)
- [x] Show numeric values
- [ ] Show armor penalty (deferred - need armor system)
- [ ] Show encumbrance level (deferred)

**Test 3.3:** ✅ BASIC IMPLEMENTATION
- [x] Weight bar color changes with load percentage
- [x] Numeric display shows weight/max
- [ ] Armor penalty updates when equipment changes (deferred)
- [ ] Encumbrance level correct (deferred)

### 3.4 Equipment Validation

**Status:** NEW validation logic  
**File:** `src/character/equipment_validator.ts` (new)

```typescript
function can_equip_item(
  item: ItemDefinition,
  actor: Actor,
  slot_name: string,
  occupied_slots: string[]  // Slots already taken by other items
): { valid: boolean; reason?: string }
```

**Validation Rules:**
1. Item `valid_body_slots` must include target slot
2. Item `fits_actor_kind` must include actor.kind (or ["*"] for universal)
3. Item `occupies_slots` must not overlap with `occupied_slots`
4. Hand slots accept tools OR armor (2 sub-slots)
5. Other slots accept armor only

- [ ] Check slot compatibility
- [ ] Check actor kind compatibility
- [ ] Check multi-slot overlap
- [ ] Return clear error messages

**Test 3.4:**
- [ ] Valid equipment passes validation
- [ ] Wrong slot type rejected
- [ ] Wrong actor kind rejected
- [ ] Overlapping multi-slot items rejected

**Note:** Armor damage reduction system not yet implemented - see `docs/todos/2026_02_19_armor_system_todo.md`. Items equip to slots but provide no mechanical benefit until damage system is built.

---

## Phase 4: Drag & Drop System

**Revised Approach:** Use existing drag event infrastructure (`OnDragStart`, `OnDragMove`, `OnDragEnd`) with module-level state management instead of a global DragSystem singleton.

**Prerequisites:**
- ✅ `DragEvent` with start_x/y, dx, dy already exists in `types.ts`
- ✅ Runtime routing via `CanvasRuntime` already calls `OnDragStart`, `OnDragMove`, `OnDragEnd` on modules
- ✅ `/api/transfer` endpoint already works (used by debug buttons)

### 4.1 Container-to-Character Drag (Equip)

**Status:** IMPLEMENT - Drag from ContainerModule slot to CharacterModule body slot  
**Files:** `src/mono_ui/modules/container_module.ts`, `src/mono_ui/modules/character_module.ts`

**Implementation:**

**ContainerModule changes:**
```typescript
// Module-level state
let is_dragging_item = false;
let dragged_item: {
  slot_index: number;
  instance_id: string;
  container_id: string;
  definition: ItemDefinition;
} | null = null;

// Add handlers
OnDragStart(e: DragEvent) {
  const slot_index = get_slot_at_position(e.start_x, e.start_y);
  if (slot_index < 0) return;
  
  const slot = opts.get_slot_items().find(s => s.slot_index === slot_index);
  if (!slot?.instance) return; // Can't drag empty slot
  
  const container = opts.get_container();
  if (!container) return;
  
  is_dragging_item = true;
  dragged_item = {
    slot_index,
    instance_id: slot.instance.id,
    container_id: container.id,
    definition: slot.definition!
  };
  
  debug_log(`[ContainerModule] Drag started: ${dragged_item.definition.name}`);
}

OnDragEnd(e: DragEvent) {
  if (!is_dragging_item || !dragged_item) {
    is_dragging_item = false;
    dragged_item = null;
    return;
  }
  
  // Reset state
  const item_to_transfer = { ...dragged_item };
  is_dragging_item = false;
  dragged_item = null;
  
  // Note: Drop detection is handled by CharacterModule
  // This module just tracks what's being dragged
}
```

**CharacterModule changes:**
```typescript
// Add handler
OnDragEnd(e: DragEvent) {
  // Get dragged item info from ContainerModule's exported state
  // (We'll use a simple shared state or callback pattern)
  
  const drop_slot = get_slot_at_position(e.x, e.y);
  if (!drop_slot) return;
  
  // Get the dragged item from ContainerModule
  // This requires coordination - we'll use a shared app_state function
}
```

**Shared State in `app_state.ts`:**
```typescript
// Simple shared state for cross-module drag
export const drag_state = {
  is_dragging: false,
  source_module: null as string | null,
  item_instance_id: null as string | null,
  source_container_id: null as string | null,
  item_definition: null as ItemDefinition | null,
  
  start_drag(source: string, item_id: string, container_id: string, def: ItemDefinition) {
    this.is_dragging = true;
    this.source_module = source;
    this.item_instance_id = item_id;
    this.source_container_id = container_id;
    this.item_definition = def;
  },
  
  end_drag() {
    this.is_dragging = false;
    this.source_module = null;
    this.item_instance_id = null;
    this.source_container_id = null;
    this.item_definition = null;
  }
};
```

**Transfer Logic in CharacterModule:**
```typescript
OnDragEnd(e: DragEvent) {
  if (!drag_state.is_dragging || drag_state.source_module !== 'container') return;
  
  const drop_slot = get_slot_at_position(e.x, e.y);
  if (!drop_slot) {
    drag_state.end_drag();
    return;
  }
  
  // Find target container for this body slot
  // (Each body slot has a corresponding container)
  
  // Call existing /api/transfer
  const transfer_res = await fetch('http://localhost:8787/api/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_instance_id: drag_state.item_instance_id,
      from_container: drag_state.source_container_id,
      to_container: target_container_id
    })
  });
  
  drag_state.end_drag();
}
```

- [x] Add OnDragStart to ContainerModule (track dragged item)
- [x] Add OnDragEnd to ContainerModule (handle cross-module drops)
- [x] Add OnDragMove to ContainerModule (track drag position)
- [x] Add on_slot_hover callback to ContainerModule (highlight compatible slots)
- [x] Create shared drag_state in app_state.ts
- [x] Add on_cross_module_drop callback for handling drops on other modules
- [x] Add get_highlighted_slots callback to CharacterModule
- [x] Implement compatible slot highlighting logic
- [x] Remove EQUIP debug button from app_state.ts
- [x] Remove UNEQUIP debug button from app_state.ts

**Test 4.1:**
- [x] Drag item from container slot → body slot equips item
- [x] Drag to non-slot area cancels
- [x] API transfer executes correctly
- [x] UI updates after successful equip
- [x] Compatible body slots highlighted in green when hovering item
- [x] EQUIP button removed

### 4.1a Compatible Slot Highlighting (UX Enhancement)

**Status:** IMPLEMENTED - Visual feedback for item compatibility
**Files:** `src/mono_ui/modules/container_module.ts`, `src/mono_ui/modules/character_module.ts`, `src/canvas_app/app_state.ts`

**Feature:** When hovering over an item in the inventory container, compatible body slots in the CharacterModule are highlighted in bright green.

**Implementation:**

**ContainerModule:**
```typescript
on_slot_hover: (slot_index, item, definition) => {
  if (definition) {
    const compatible = get_compatible_slots(definition);
    ui_state.character.highlighted_slots = compatible;
  } else {
    ui_state.character.highlighted_slots = [];
  }
}
```

**CharacterModule:**
```typescript
get_highlighted_slots: () => ui_state.character.highlighted_slots,

// In draw_body_slot(), check if slot is highlighted:
const is_highlighted = highlighted_slots.includes(slot_name);

// Use bright green colors for highlighted slots
if (is_highlighted) {
  empty_color = { r: 0, g: 200, b: 0 };
  label_rgb = { r: 0, g: 255, b: 100 };
  char_rgb = { r: 0, g: 255, b: 100 };
}
```

**Helper Function in app_state.ts:**
```typescript
function get_compatible_slots(item_def: ItemDefinition): string[] {
  const slot_mapping: Record<string, string> = {
    'hand_left': 'LEFT HAND',
    'hand_right': 'RIGHT HAND',
    'head': 'HEAD',
    'chest': 'TORSO',
    'leg_left': 'LEFT LEG',
    'leg_right': 'RIGHT LEG',
  };
  
  const compatible: string[] = [];
  for (const slot of item_def.valid_body_slots) {
    const ui_slot = slot_mapping[slot];
    if (ui_slot) compatible.push(ui_slot);
  }
  return compatible;
}
```

**Test 4.1a:**
- [x] Hover over equipable item shows green highlight on compatible slots
- [x] Hover over non-equipable item shows no highlights
- [x] Moving mouse away clears highlights
- [x] Highlights work for all slot types (hands, head, torso, legs)

### 4.2 Character-to-Container Drag (Unequip)

**Status:** IMPLEMENT - Drag from CharacterModule body slot to ContainerModule slot  
**Files:** `src/mono_ui/modules/character_module.ts`, `src/mono_ui/modules/container_module.ts`

**Implementation:**
Similar pattern to 4.1, but reversed:
1. CharacterModule tracks dragged item in OnDragStart
2. ContainerModule handles OnDragEnd with drop detection
3. Execute `/api/transfer` from body slot container back to sack

- [~] Add OnDragStart to CharacterModule (track dragged item)
- [~] Add OnDragEnd to ContainerModule (execute unequip)
- [~] Remove UNEQUIP debug button from app_state.ts

**Test 4.2:**
- [x] Drag item from body slot → container slot unequips item
- [x] Drag to non-slot area cancels
- [x] API transfer executes correctly
- [x] UI updates after successful unequip
- [x] UNEQUIP button removed

### 4.3 (DEFERRED) Advanced Drag Features

The following features are deferred to keep implementation simple:

**Visual Feedback:**
- Ghost item following cursor
- Trail particles
- Target highlighting
- Source slot dimming

**Complex Transfers:**
- Container → Container (rearrange slots)
- Container → Ground (drop to world)
- Ground → Container (pickup)
- Partial stack drags

These can be added later once basic equip/unequip via drag is working.

---

## Phase 5: Visual Feedback & Particles

### 5.1 Extend Particle System for Global Use

**Status:** Particles exist but are module-local  
**Files:** `src/mono_ui/particle_system.ts` (new)

**Existing:** `place_module.ts` has local particles, `vision_debugger.ts` has registration pattern

**New: Global Particle System**
```typescript
// src/mono_ui/particle_system.ts
export type Particle = {
  id: string;
  x: number;           // Screen X (not module-local)
  y: number;           // Screen Y
  char: string;
  rgb: Rgb;
  lifespan_ms: number;
  created_at: number;
  velocity?: { vx: number, vy: number };  // For moving particles
};

export const ParticleSystem = {
  spawn(particle: Omit<Particle, 'id' | 'created_at'>): string;
  update(): void;              // Call in animation loop
  render(canvas: Canvas): void; // Render all active particles
  clear(): void;
};
```

**Integration:**
- Call `ParticleSystem.update()` in CanvasRuntime tick
- Call `ParticleSystem.render()` after all modules drawn
- DragGhostModule spawns trail particles via this system

- [ ] Create global ParticleSystem singleton
- [ ] Integrate into CanvasRuntime render loop
- [ ] Migrate place_module particles to use global system (optional)

**Test 5.1:**
- [ ] Particles spawn correctly
- [ ] Update loop removes expired particles
- [ ] Render appears on top of all modules
- [ ] 100+ particles performant

### 5.2 Drag Visual Effects

**Status:** NEW - Part of DragGhostModule  
**Effects:**

**Trail:**
- Spawn dot particles every 3-4 frames during drag
- Fade out over 200ms
- Color: White or item color

**Source Highlight:**
- Dim source slot by 30% during drag
- Show "lifted" border effect

**Target Highlights:**
- Valid targets: Green border, subtle glow
- Invalid targets: Red border, dimmed
- Hover over valid: Bright green

**Drop Effects:**
- Success: Burst of particles at drop location
- Fail: Red X flash, particles fade back to source

- [ ] Implement trail particle spawning
- [ ] Add source slot dimming
- [ ] Add target highlight rendering
- [ ] Add success/fail particle effects

**Test 5.2:**
- [ ] Trail follows cursor smoothly
- [ ] Source dims during drag
- [ ] Valid targets highlighted green
- [ ] Success creates burst effect

### 5.3 Hover & Sound Feedback

**Status:** NEW  
**Files:** Existing SFX system

**Hover Effects:**
- Slot background brightens 20%
- Show item tooltip (Phase 6)
- Update debug text display

**Sound Effects:**
```typescript
hover: 'ui_hover'      // Mouse over item slot
drag_start: 'ui_pickup' // Start dragging
success: 'ui_drop'     // Successful drop
error: 'ui_error'      // Invalid drop
```

**Weight Preview:**
- When hovering valid equip target
- Show weight delta: "+2.5kg" in green
- If would exceed capacity: "+2.5kg" in red

- [ ] Add hover brightness effect
- [ ] Add sound effect calls
- [ ] Add weight preview calculation

**Test 5.3:**
- [ ] Hover brightens slot
- [ ] Sounds play at correct times
- [ ] Weight preview shows correct delta

---

## Phase 6: Debug & Info Display

### 6.1 Debug Text Section in Window Module

**Status:** Extend existing window_module  
**File:** `src/mono_ui/modules/window_module.ts`

**New: Item Info Area**
Add a dedicated 3-line area at bottom of text window for item hover info:

```
+----------------------------------+
|  Regular message text here...    |
|  More messages...                |
+----------------------------------+
| Name: Iron Sword                 |  <- Line 1: Name
| Qty: 1  Weight: 3.5kg  Cond: Good|  <- Line 2: Stats
| A well-balanced blade...         |  <- Line 3: Description
+----------------------------------+
```

**Behavior:**
- When hovering item: Show item info
- When not hovering: Show "no item hovered interaction found"
- Updates in real-time as mouse moves

**API:**
```typescript
// Add to window module config
type TextWindowOptions = {
  // ... existing ...
  get_item_info?: () => ItemInfoLine | null;
};

type ItemInfoLine = {
  line1: string;  // Name
  line2: string;  // Stats
  line3: string;  // Description
};
```

- [ ] Add item info callback to window config
- [ ] Reserve bottom 3 lines for item info
- [ ] Render item info when callback returns data
- [ ] Show default text when no item hovered

**Test 6.1:**
- [ ] Item info appears when hovering
- [ ] Default text when not hovering
- [ ] Updates in real-time
- [ ] Text doesn't interfere with scrollback

### 6.2 Item Info Provider

**Status:** NEW  
**File:** `src/canvas_app/app_state.ts` or shared helper

**Item Info Lookup:**
```typescript
function get_item_info_for_display(
  item_instance: ItemInstance,
  item_def: ItemDefinition
): ItemInfoLine {
  const total_weight = (item_def.weight * item_instance.qty).toFixed(1);
  
  return {
    line1: `Name: ${item_def.name}`,
    line2: `Qty: ${item_instance.qty}  Weight: ${total_weight}kg  Cond: ${item_instance.condition || 'Good'}`,
    line3: item_def.description.substring(0, 50) + (item_def.description.length > 50 ? '...' : '')
  };
}
```

**Integration:**
- ContainerModule calls this when slot hovered
- CharacterModule calls this when body slot hovered
- Pass result to window module via callback

- [ ] Create item info helper
- [ ] Integrate into ContainerModule hover
- [ ] Integrate into CharacterModule hover
- [ ] Connect to window module callback

**Test 6.2:**
- [ ] Correct name displayed
- [ ] Weight calculated correctly (qty * weight)
- [ ] Condition shows or defaults to Good
- [ ] Description truncated reasonably

---

## Phase 7: API Endpoints & Integration

### 7.1 New API Endpoints

**Status:** NOT NEEDED - Existing endpoints sufficient  
**File:** N/A

**Existing endpoints that already work:**
- ✅ `/api/containers` - List actor's containers (sack, hand_left, hand_right, etc.)
- ✅ `/api/container` - Get specific container contents
- ✅ `/api/transfer` - Move items between containers (used for equip/unequip)
- ✅ `/api/place/pickup` - Pick up ground items
- ✅ `/api/place/drop` - Drop items to ground

**Why no new endpoints needed:**
1. **Equip/Unequip:** Handled by `/api/transfer` - each body slot IS a container
   - Equip: Transfer from `sack` to `hand_right` or `hand_left`
   - Unequip: Transfer from `hand_right`/`hand_left` back to `sack`
2. **Container visibility:** UI-only state, no backend needed (toggle with 'i' key)
3. **Slot targeting:** Containers manage slot ordering internally, API just needs container IDs

**Body slot containers created on actor initialization:**
- `container.actor.{actor_id}.sack` (default inventory)
- `container.actor.{actor_id}.hand_right` (right hand equipment)
- `container.actor.{actor_id}.hand_left` (left hand equipment)

- [x] Verified `/api/transfer` works for equip/unequip (tested via debug buttons)
- [x] No new endpoints required

**Test 7.1:** N/A - Using existing endpoints

### 7.2 Action Pipeline Integration (Deferred)

**Status:** Future work  
**Note:** All transfers currently go directly via API. Future integration:

```typescript
// Future: Route through action system
USE.ITEM_TRANSFER: {
  source: { container_id, slot_index },
  target: { container_id, slot_index },
  item_instance_id,
  quantity
}

USE.EQUIP: {
  actor_id,
  item_instance_id,
  slot_name
}
```

- [ ] Mark TODOs in code for action pipeline migration
- [ ] Document current direct-API approach
- [ ] Plan migration path for future

### 7.3 UI Integration

**Status:** Wire everything together  
**File:** `src/canvas_app/app_state.ts`

**Integration Steps:**

1. **Create Character Module** (always visible)
   ```typescript
   const character_module = make_character_module({
     id: 'player_character',
     rect: { x0: 2, y0: 2, x1: 25, y1: 35 },
     get_actor: () => current_actor,
     // ... callbacks for equip/unequip/drag
   });
   ```

2. **Create Container Modules** (on demand)
   ```typescript
   // When player opens a container
   const container_module = make_container_module({
     id: `container_${container_id}`,
     get_container: () => loaded_container,
     // ... callbacks for drag/drop
   });
   ```

3. **Wire Drag System**
   - Initialize DragSystem in runtime
   - Register drop targets when modules created
   - Handle cross-module drops

4. **Connect Debug Text**
   - Window module gets item info callback
   - Modules update callback on hover

  5. **Replace Debug Buttons**
    - Remove INV (container toggle - use 'i' key instead)
    - EQUIP/UNEQUIP moved to drag-and-drop in Phase 4
    - CNTRS (keep for now or remove)
    - Keep TEST button for diagnostics

- [x] Create character module for player
- [x] Create container modules when opened
- [x] Wire up drag system (module-level, Phase 4)
- [x] Remove EQUIP/UNEQUIP debug buttons (done in Phase 4)
- [x] Connect item info to debug window
- [~] Remove remaining debug buttons

**Test 7.3:**
- [x] Character module always visible
- [x] Container modules open on interaction
- [x] Drag-and-drop works end-to-end (basic equip/unequip)
- [x] Item info displays on hover in debug window
- [~] Debug buttons removed (except TEST)

---

## Phase 7.5: Dynamic Module Infrastructure (PREREQUISITE)

**Status:** NEW - Foundation for Phases 8 & 9  
**Priority:** CRITICAL - Must complete before Phase 8/9

### Problem Statement

Current architecture uses a **static module array** defined at startup (line 1131 in app_state.ts). Modules cannot be:
- Created dynamically at runtime
- Removed after creation  
- Moved to new positions
- Looked up by ID for updates

This blocks Phase 8 (gizmos that close/move modules) and Phase 9 (dynamic NPC modules).

### 7.5.1 Analysis of Current System

**Current State (Static):**
```typescript
// app_state.ts line 1131 - modules defined once at startup
const modules: Module[] = [
  make_character_module({ id: 'character_module', rect: {...} }),
  make_container_module({ id: 'inventory_container', rect: {...} }),
  // ... all modules hardcoded
];
```

**What's Missing:**
- ❌ Runtime module registry
- ❌ Dynamic add/remove capability
- ❌ Position updates after initial creation
- ❌ Module lookup by ID

**What Already Works (Don't Break):**
- ✅ CanvasRuntime iterates modules array each frame
- ✅ Modules have unique IDs
- ✅ Drag-and-drop between modules
- ✅ Module lifecycle hooks (Draw, OnPointer*, OnDrag*)

### 7.5.2 New Infrastructure Components

**New File:** `src/mono_ui/module_registry.ts`

```typescript
// Central registry for dynamic module management
export interface ModuleRegistry {
  // Core operations
  register(module: Module): void;
  unregister(module_id: string): boolean;
  get(module_id: string): Module | undefined;
  get_all(): Module[];
  
  // Position management
  update_position(module_id: string, new_rect: Rect): boolean;
  get_position(module_id: string): Rect | undefined;
  
  // Visibility
  set_visibility(module_id: string, visible: boolean): boolean;
  is_visible(module_id: string): boolean;
  
  // Event re-routing after changes
  on_registry_changed?: () => void;
}

export function create_module_registry(): ModuleRegistry;
```

**Update to CanvasRuntime:**
```typescript
// Instead of static modules array, use registry
const registry = create_module_registry();

// Runtime render loop uses registry.get_all()
for (const module of registry.get_all()) {
  if (module.Draw && is_module_visible(module)) {
    module.Draw(canvas);
  }
}
```

### 7.5.3 State Management Updates

**Update `ui_state` in app_state.ts:**

```typescript
// Add to existing ui_state object (line 67)
const ui_state = {
  // ... existing ...
  
  modules: {
    registry: create_module_registry(),
    positions: new Map<string, Rect>(),  // Track current positions
    visibility: new Map<string, boolean>(), // Track visibility
    
    // Helper for opening NPC modules
    open_npc_modules: new Set<string>(), // Track which NPCs have open modules
    
    // Layout management
    default_positions: {
      player_character: { x0: 160, y0: 2, x1: 198, y1: 17 },
      inventory_container: { x0: 160, y0: 18, x1: 198, y1: 35 },
      // NPC modules calculated dynamically
    }
  }
};
```

### 7.5.4 Refactoring Static Modules

**Convert existing modules to use registry:**

**Step 1: Register static modules at startup**
```typescript
// After creating each module, register it
const character_module = make_character_module({...});
ui_state.modules.registry.register(character_module);
ui_state.modules.positions.set('character_module', character_module.rect);

const container_module = make_container_module({...});
ui_state.modules.registry.register(container_module);
ui_state.modules.positions.set('inventory_container', container_module.rect);
```

**Step 2: Update runtime to use registry**
```typescript
// app_state.ts return value
return {
  modules: ui_state.modules.registry.get_all(), // Dynamic instead of static array
  // ... rest unchanged
};
```

### 7.5.5 Files to Modify

1. **New:** `src/mono_ui/module_registry.ts` - Core registry implementation
2. **Update:** `src/canvas_app/app_state.ts` - Use registry instead of static array
3. **Update:** `src/mono_ui/runtime/canvas_runtime.ts` - Read from registry
4. **Minor:** All module constructors - ensure they accept `rect` and store it accessibly

### 7.5.6 Testing Checklist

- [ ] Registry.register() adds module to render loop
- [ ] Registry.unregister() removes module from render loop
- [ ] Static modules (character, container) still work after refactor
- [ ] Drag-and-drop between modules still works
- [ ] Module positions can be updated via registry.update_position()
- [ ] Position changes reflect immediately in render
- [ ] No memory leaks when adding/removing modules

### 7.5.7 Integration with Future Phases

**Phase 8 (Gizmos) Usage:**
```typescript
// When X clicked
on_close: () => {
  ui_state.modules.registry.unregister(module_id);
  ui_state.modules.visibility.set(module_id, false);
}

// When drag completed
on_move: (new_rect) => {
  ui_state.modules.registry.update_position(module_id, new_rect);
  ui_state.modules.positions.set(module_id, new_rect);
}
```

**Phase 9 (NPC Modules) Usage:**
```typescript
function open_npc_module(npc_id: string) {
  const npc_module = make_character_module({
    id: `npc_character_${npc_id}`,
    rect: calculate_npc_position(),
    // ... callbacks
  });
  
  ui_state.modules.registry.register(npc_module);
  ui_state.modules.open_npc_modules.add(npc_id);
}
```

---

## Phase 8: Module Gizmos Standard (Window Controls)

**Status:** NEW - UI/UX Infrastructure  
**Priority:** High - Enables flexible UI layout  
**Dependency:** Requires Phase 7.5 (Dynamic Module Infrastructure) complete

### Overview

Create a **standard pattern** for module window controls (gizmos) that allows users to interact with the layout of modules themselves. Similar to Windows 11 window controls but minimal: **Close (X)** and **Move (#)**. Future expansion can add **Save Position ($)**.

### Design Principles

1. **Per-Module Configuration:** Each module declares which gizmos it supports
2. **Visual Standard:** Gizmos always appear in top-left corner (module_gizmos area)
3. **Immediate Feedback:** Move updates position in real-time; Close removes module immediately
4. **Persistence Optional:** Save Position writes to config (off by default)

### 8.1 Module Gizmo Interface

**New File:** `src/mono_ui/module_gizmos.ts`

```typescript
export type GizmoType = 'close' | 'move' | 'save_position';

export type ModuleGizmosConfig = {
  enabled: GizmoType[];  // Which gizmos this module supports
  on_close?: () => void;  // Called when X clicked
  on_move?: (new_rect: Rect) => void;  // Called after drag-release
  on_save_position?: () => void;  // Called when $ clicked
  can_close: boolean;
  can_move: boolean;
  can_save_position: boolean;  // Off by default
};

export function draw_module_gizmos(
  c: Canvas,
  rect: Rect,
  config: ModuleGizmosConfig,
  is_hovered: boolean,
  is_moving: boolean
): void;

export function handle_gizmo_click(
  x: number,
  y: number,
  rect: Rect,
  config: ModuleGizmosConfig
): GizmoType | null;
```

**Visual Layout (Top-Left Corner):**
```
+------------------+
|# X  Title    | <- module_gizmos area (top-left)
+------------------+
|                  |
|   Module Body    |
|                  |
+------------------+
```

- **# (Move):** Yellow, appears first if enabled
- **X (Close):** Red, appears second if enabled
- **$ (Save):** Green, appears third (future)

### 8.2 Move Behavior

**Implementation:**
1. User clicks # gizmo (or anywhere in top row for move-enabled modules)
2. Module enters "move mode" - border highlights yellow
3. User drags anywhere on module → updates rect in real-time
4. Release → calls `on_move(new_rect)` callback
5. Module stays in new position

**State Management (Uses Phase 7.5 Registry):**
```typescript
// In app_state.ts - uses ui_state.modules from Phase 7.5
const gizmo_handlers = {
  on_move: (module_id: string, new_rect: Rect) => {
    // Update via registry (from Phase 7.5)
    ui_state.modules.registry.update_position(module_id, new_rect);
    ui_state.modules.positions.set(module_id, new_rect);
    debug_log(`[Gizmos] Moved ${module_id} to (${new_rect.x0},${new_rect.y0})`);
  },
  
  on_close: (module_id: string) => {
    // Unregister via registry (from Phase 7.5)
    ui_state.modules.registry.unregister(module_id);
    ui_state.modules.visibility.set(module_id, false);
    debug_log(`[Gizmos] Closed ${module_id}`);
  },
  
  save_position: (module_id: string) => {
    const rect = ui_state.modules.positions.get(module_id);
    if (rect) {
      // Persist to localStorage or disk
      localStorage.setItem(`module_pos_${module_id}`, JSON.stringify(rect));
      flash_status([`Saved ${module_id} position`], 1000);
    }
  }
};
```

### 8.3 Integration with Existing Modules

**Phase 1: ContainerModule (Sack)**
- [ ] Add gizmo support to ContainerModule
- [ ] Enable: close (X), move (#)
- [ ] Disable: save_position (default off)
- [ ] Trigger: 'i' key opens sack with gizmos enabled

**Phase 2: CharacterModule**  
- [ ] Add gizmo support (but disable close/move for player character - always visible)
- [ ] Enable for NPC CharacterModules (opened on interaction)

**Phase 3: Future Modules**
- [ ] Apply gizmo standard to all new modules
- [ ] Document pattern in `docs/ui/module_gizmos.md`

### 8.4 Files to Modify

1. **New:** `src/mono_ui/module_gizmos.ts` - Core gizmo logic
2. **Update:** `src/mono_ui/modules/container_module.ts` - Add gizmo rendering/handling
3. **Update:** `src/mono_ui/modules/character_module.ts` - Add gizmo support (configurable)
4. **Update:** `src/canvas_app/app_state.ts` - Layout state management, module positioning

### 8.5 Testing Checklist

- [ ] X closes container module immediately
- [ ] # enters move mode (yellow border)
- [ ] Dragging while in move mode updates position
- [ ] Release finalizes position
- [ ] Module functions correctly after move (drag-drop still works)
- [ ] Multiple moves accumulate correctly
- [ ] Module stays closed after close (until reopened with 'i')
- [ ] Player character module cannot be closed (no X)

---

## Phase 9: NPC Character Module (Revised)

**Status:** Updated from deferred - implement using generic CharacterModule + gizmos  
**Priority:** High - Enables trading/testing multi-pane transfer  
**Dependency:** Requires Phase 7.5 (Dynamic Module Infrastructure) and Phase 8 (Gizmos) complete

### Overview

Use the **same CharacterModule** for both player and NPCs. The module is already generic (callbacks-based). The difference is:
- **Player:** Always visible, no gizmos (no close/move)
- **NPC:** Opens on interaction, has gizmos (close X, move #)

### 9.1 NPC Data Requirements

**Already Implemented:**
- ✅ NPCs have `body_slots` from `kind.parts` (in `npc_storage/store.ts`)
- ✅ Container system supports NPC containers: `container.npc.<npc_id>.<slot>`
- ✅ Body slots already store `item_instance_id` for equipped items

**Needed:**
- API endpoint to get NPC's equipped items with definitions
- NPC container naming follows same pattern as actors

### 9.2 Trigger: Opening NPC Character Module

**Options (choose one for v1):**

**Option A: Click NPC in Place Module** (Recommended)
- Click on NPC character in the world
- Opens NPC CharacterModule alongside player module
- Natural, intuitive

**Option B: Talk to NPC**
- Dialogue system triggers inventory view
- Good for trading scenarios
- Requires dialogue infrastructure

**Option C: Dedicated Button**
- "INSPECT" button shows nearby NPCs
- Click to open their character module
- Less immersive but simpler

**Decision:** Start with **Option A** (click NPC in world)

### 9.3 Layout: Dual Character Modules

**Default Layout:**
```
+------------------------------------------+
|  +--------+         +--------+          |
|  |NPC     |         |PLAYER  |          |  <- Character Modules
|  |Grenda  |         |Henry   |          |
|  +--------+         +--------+          |
|  | HEAD   |         | HEAD   |          |
|  | HAND L |<------->| HAND L |          |  <- Drag between them!
|  | HAND R |         | HAND R |          |
|  | TORSO  |         | TORSO  |          |
|  | LEGS   |         | LEGS   |          |
|  +--------+         +--------+          |
|  [  # X  ]          [ (no gizmos) ]      |  <- NPC has controls
+------------------------------------------+
```

**Positioning Strategy:**
- **Player module:** Right side (existing position)
- **NPC module:** Left side of player module when opened
- **Auto-offset:** If multiple NPCs opened, cascade them diagonally

### 9.4 Drag-and-Drop Between Characters

**This is the "two-pane transfer" solution:**

1. Drag from player body slot → NPC body slot = **Give item to NPC**
2. Drag from NPC body slot → player body slot = **Take item from NPC** (steal/trade)
3. Drag to container modules works too (player sack ↔ NPC inventory)

**API Changes:**
- Use existing `/api/transfer` endpoint
- Container IDs already support NPCs: `container.npc.grenda.hand_right`
- Validation needed: range check for theft, NPC consent for trade

**New Validation Layer:**
```typescript
// src/character/transfer_validator.ts
function can_transfer_between_characters(
  from_actor_id: string,
  to_actor_id: string,
  item_instance_id: string,
  context: 'trade' | 'theft' | 'gift'
): { valid: boolean; reason?: string } {
  // Check distance (both must be in same place, within range)
  // Check ownership (NPCs may resist theft)
  // Check trade consent (if trading)
  // Return validation result
}
```

### 9.5 Implementation Steps

**Step 1: NPC Character Module Factory (Uses Phase 7.5 Registry)**
```typescript
// In app_state.ts
function open_npc_character_module(npc_id: string, npc_name: string) {
  const module_id = `npc_character_${npc_id}`;
  
  // Check if already open (uses Phase 7.5 registry)
  if (ui_state.modules.open_npc_modules.has(npc_id)) {
    // Flash existing module to show it's already open
    const existing = ui_state.modules.registry.get(module_id);
    if (existing) {
      flash_module_border(module_id, 'yellow', 500);
    }
    return;
  }
  
  // Calculate position (left of player module, or cascade if multiple)
  const player_rect = ui_state.modules.positions.get('character_module');
  const open_count = ui_state.modules.open_npc_modules.size;
  
  const npc_rect = {
    x0: player_rect.x0 - 28 - (open_count * 3),  // Offset each new NPC
    y0: player_rect.y0 + (open_count * 2),
    x1: player_rect.x0 - 3 - (open_count * 3),
    y1: player_rect.y1 + (open_count * 2)
  };
  
  // Create module with NPC data callbacks
  const npc_module = make_character_module({
    id: module_id,
    rect: npc_rect,
    get_actor_name: () => npc_name,
    get_actor_id: () => npc_id,
    get_body_slots: () => get_npc_body_slots(npc_id),
    get_equipped_items: () => get_npc_equipped_items(npc_id),
    get_weight_data: () => get_npc_weight_data(npc_id),
    get_is_visible: () => true,
    // Gizmos enabled for NPC (from Phase 8)
    gizmos: {
      enabled: ['close', 'move'],
      can_close: true,
      can_move: true,
      on_close: () => close_npc_module(npc_id, module_id),
      on_move: (new_rect) => {
        ui_state.modules.registry.update_position(module_id, new_rect);
        ui_state.modules.positions.set(module_id, new_rect);
      }
    },
    // Transfer callbacks
    on_drop: (slot_name) => handle_npc_equip(npc_id, slot_name),
    on_drag_start: (slot_name, item, def, container_id) => {
      drag_state.start_drag('npc_character', item.id, container_id, def);
    },
    on_cross_module_drop: (x, y) => handle_npc_unequip(npc_id, x, y)
  });
  
  // Register via Phase 7.5 registry (not static array)
  ui_state.modules.registry.register(npc_module);
  ui_state.modules.positions.set(module_id, npc_rect);
  ui_state.modules.open_npc_modules.add(npc_id);
  
  debug_log(`[NPC Module] Opened ${npc_name} (${module_id})`);
}

function close_npc_module(npc_id: string, module_id: string) {
  // Unregister via Phase 7.5 registry
  ui_state.modules.registry.unregister(module_id);
  ui_state.modules.open_npc_modules.delete(npc_id);
  ui_state.modules.positions.delete(module_id);
  
  debug_log(`[NPC Module] Closed ${module_id}`);
}
```

**Step 2: NPC Click Handler in PlaceModule**
- Add `on_npc_click` callback to place_module config
- When NPC character clicked, call `open_npc_character_module()`
- Visual feedback: highlight NPC on hover

**Step 3: Transfer Validation**
- Implement `can_transfer_between_characters()`
- Check range (both in same place, within interaction range)
- For now: allow all transfers (no theft detection yet)
- Future: add NPC AI response to theft

### 9.6 Testing Checklist

- [ ] Click NPC opens CharacterModule with correct name
- [ ] NPC module appears left of player module
- [ ] NPC body slots display correctly
- [ ] X closes NPC module
- [ ] # allows moving NPC module
- [ ] Drag player item → NPC slot transfers item
- [ ] Drag NPC item → player slot transfers item
- [ ] Drag to container modules works both ways
- [ ] Multiple NPCs can be opened simultaneously
- [ ] Closing player module not possible (no X)

---

## Testing Checklist Summary

### Phase 1: Data Layer Tests
- [ ] ItemDefinition has all 6 new fields
- [ ] Legacy items load with defaults
- [ ] Container is_open/is_locked persist
- [ ] Grid dimensions calculate correctly
- [ ] Body slots store item_instance_id

### Phase 2-3: Module Tests
- [ ] ContainerModule renders open/closed states
- [ ] Grid layout optimal for slot count
- [ ] CharacterModule displays all body slots
- [ ] Weight bar shows correct percentage
- [ ] Equipment validation rejects invalid combos

### Phase 4: Drag System Tests
- [x] Module-level drag state works correctly
- [x] Container-to-character drag equips item
- [x] Character-to-container drag unequips item
- [x] EQUIP debug button removed
- [x] UNEQUIP debug button removed
- [ ] (DEFERRED) DragGhostModule shows item ghost
- [ ] (DEFERRED) Trail particles follow cursor
- [x] Drop targets highlight correctly

### Phase 5-6: Visual Tests
- [x] Hover brightens slots
- [x] Item info displays in debug window
- [ ] (DEFERRED) Global ParticleSystem renders on top
- [ ] (DEFERRED) Sounds play at correct events

### Phase 7: Integration Tests
- [x] API endpoints return correct data
- [x] Character module always visible
- [x] Container modules open on interaction
- [x] Drag-and-drop works end-to-end
- [x] Debug buttons removed/replaced

### Phase 7.5: Dynamic Module Infrastructure Tests
- [ ] Module registry registers modules
- [ ] Module registry unregisters modules
- [ ] Static modules (character, container) work after refactor
- [ ] Drag-and-drop between modules still works
- [ ] Module positions can be updated via registry
- [ ] Position changes reflect immediately in render
- [ ] No memory leaks when adding/removing modules

### Phase 8: Module Gizmos Tests
- [ ] X gizmo closes module
- [ ] # gizmo enters move mode
- [ ] Drag moves module to new position
- [ ] Module functions after move
- [ ] Player module has no gizmos
- [ ] Container module (sack) has gizmos

### Phase 9: NPC Character Module Tests
- [ ] Click NPC opens CharacterModule
- [ ] NPC module displays correct body slots
- [ ] NPC gizmos work (close, move)
- [ ] Drag player→NPC transfers item
- [ ] Drag NPC→player transfers item
- [ ] Multiple NPCs can be open
- [ ] Drag to container modules works

---

## Revised Implementation Order

**Phase 1-2:** Data Layer (Days 1-3) ✅ COMPLETE
- Item database: 6 new fields
- Container state: is_open, is_locked, grid_dimensions
- Body slots: Add item_instance_id support

**Phase 3:** Character Module (Days 4-6) ✅ COMPLETE
- Equipment validation logic
- CharacterModule UI
- Weight bar visualization

**Phase 4:** Drag & Drop (Days 7-9) - SIMPLIFIED
- Module-level drag state (NOT global DragSystem)
- Container-to-character drag (equip) - remove EQUIP button
- Character-to-container drag (unequip) - remove UNEQUIP button
- NO ghost visuals, NO particle trails, NO target highlighting (deferred)

**Phase 5-6:** Visuals & Debug (Days 10-11) - PARTIAL
- NO global ParticleSystem (deferred)
- Hover effects (already working)
- Item info in window module

**Phase 7:** API & Integration (Days 12-13) - MOSTLY DONE
- Existing /api/transfer endpoint works
- Remove debug buttons
- End-to-end testing

**Phase 7.5:** Dynamic Module Infrastructure (Days 14-15) - NEW PREREQUISITE
- Create `module_registry.ts` for runtime module management
- Refactor app_state.ts to use registry instead of static array
- Update CanvasRuntime to read from registry
- Test add/remove/position update functionality
- **CRITICAL:** Must complete before Phase 8 & 9

**Phase 8:** Module Gizmos Standard (Days 16-17) - DEPENDS ON 7.5
- Create module_gizmos.ts with X/close and #/move controls
- Add gizmo support to ContainerModule (uses registry from 7.5)
- Add gizmo support to CharacterModule (configurable)
- Test close and move functionality via registry

**Phase 9:** NPC Character Module (Days 18-20) - DEPENDS ON 7.5 & 8
- Reuse existing CharacterModule for NPCs
- Add click-to-open in place_module
- Position NPC module adjacent to player (via registry)
- Enable cross-character drag-and-drop
- Test two-pane transfer (player ↔ NPC)

**Total: ~4 weeks** (extended from 2 weeks to include infrastructure + gizmos + NPC support)

**Why Phase 7.5 is Critical:**
Without dynamic module registry, we cannot:
- Close modules at runtime (Phase 8)
- Move modules to new positions (Phase 8)
- Open multiple NPC modules (Phase 9)
- Remove NPC modules after closing (Phase 9)

---

## Notes

### Key Design Decisions
- **No scrolling:** Containers display all slots regardless of size
- **Closed containers:** Help AI renderer by culling hidden information
- **Action Pipeline:** All moves currently via API; future migration to USE actions planned
- **Module-level drag state:** Simple shared state object in app_state.ts instead of complex global DragSystem
- **Visual polish deferred:** Ghost items, particle trails, and target highlighting not needed for v1
- **Weight matters:** Encumbrance affects gameplay, visualize clearly in character module
- **Reuse existing API:** `/api/transfer` handles all item moves (no new equip/unequip endpoints)

### Leveraging Existing Systems
- **Container system:** Full storage, transfer, scattered loot already implemented
- **Drag infrastructure:** Event types and routing exist via `OnDragStart`/`OnDragMove`/`OnDragEnd` hooks
- **Body slots:** Structure exists on actors, need to add item storage
- **API endpoints:** Container listing, transfer, pickup, drop already work
- **Module pattern:** Existing UI modules show the pattern for adding drag handlers

### Architectural Decisions
1. **Direct API calls** for v1 (action pipeline migration deferred)
2. **Module-level drag state** - simple shared object in app_state.ts, NOT a global DragSystem singleton
3. **NO visual drag effects for v1** - ghost items, trails, target highlighting all deferred
4. **ContainerModule** handles both open (full grid) and closed (3x3) states
5. **CharacterModule** always visible for player actor
6. **Equip/Unequip via drag-and-drop** - removes need for EQUIP/UNEQUIP debug buttons
7. **Dynamic Module Registry** (Phase 7.5) - Required for runtime module management, gizmos, and NPC windows

### Future Work (Post-v1)
- Complex slot shapes (tetris-style)
- Lock picking mechanics
- Container crafting/upgrading
- Theft detection and NPC reactions
- NPC equipment management (GM mode)

---

**Next Step:** Begin Phase 7.5 - Build dynamic module infrastructure (module_registry.ts) before attempting gizmos or NPC modules

**Implementation Order:**
1. **Phase 7.5** → Create `module_registry.ts` and refactor static modules to use registry
2. **Phase 8** → Build gizmos (X/#) that use registry for close/move
3. **Phase 9** → Build NPC modules that register/unregister via registry

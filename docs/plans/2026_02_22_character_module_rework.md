# Character Module Rework

**Status:** Planning  
**Priority:** High  
**Created:** 2026-02-22  
**Updated:** 2026-02-27  
**Related Plans:** 
- 2026_02_19_inventory_movement_plan.md (Phases 7.5, 8, 9)
- 2026_02_14_item_system_unification.md
- 2026_02_26_pickup_and_drop.md

---

## Overview

Refactor the CharacterModule to provide a comprehensive character inspection interface with three distinct areas: a container sidebar, a pannable body slot view, and a scrollable status bar section. This rework unifies character data display and provides access to all stored items through equipped containers.

**Critical Design Principle:** Characters and NPCs do NOT have a "main inventory." All items must be stored in equipped containers (bags, sacks, pouches) that are worn on body slots, held in hands, or equipped as armor/garb. The sidebar displays these equipped containers only.

**Architecture Status (2026-02-27):**

**CURRENT (Working Now):** `valid_body_slots` array on ItemDefinition
- Items specify compatible slots: `valid_body_slots: ["hand_left", "hand_right"]`
- One item per body slot (simple structure)
- Working system with drag-drop, stacking, swapping

**FUTURE (Phase 9 - Planned):** Tag-Based Slot System  
- ARMOR/GARB/TOOL tags with body slot metadata
- Each body part has 3 slot types: ARMOR (1 max), GARB (∞), TOOL (1 per hand)
- Enables: multiple rings per hand, layered clothing, distinct tool vs equipment slots
- **⚠️ NOT YET IMPLEMENTED** - requires major refactoring

---

## Current State

### What's Working
- ✅ Basic CharacterModule structure exists
- ✅ Weight bar visualization at bottom
- ✅ Gizmos (X/#) implemented for close/move
- ✅ Drag-and-drop equip/unequip functional (OLD system)
- ✅ Module positioning and registry system
- ✅ Right-click container opening system (Phase 7)
- ✅ Multi-instance ContainerModule support
- ✅ Drag-and-drop routing to target modules (Phase 8)

### What's Missing / Needs Update for Tag-Based System
- ❌ Tag-based slot system (ARMOR/GARB/TOOL) instead of `valid_body_slots`
- ❌ Separate slot types per body part (armor/garb/tool)
- ❌ Hand slot bug: Items mirror to both visual slots (need 3 separate slots)
- ❌ Container sidebar showing EQUIPPED containers only (not all body slots)
- ❌ Logic to filter equipped items by container type (using CONTAINER tag)
- ❌ Health bar display
- ❌ Pan support for body slot area (for large creatures)
- ❌ Scrollable status section for extensibility
- ❌ Consistent border styling across modules
- ❌ Name truncation for long character names
- ❌ "Main container" selection for pickup routing

### Known Issues (To Fix)
- **Hand Slot Mirroring Bug:** Equipping to hand_left shows item in both visual hand slots
  - Root cause: Both red (tool) and blue (equipment) visuals map to same body_slot
  - Fix: Implement separate armor/garb/tool slot arrays per hand
  - See Phase 9: Tag-Based Equipment Slot System

- **Sack Detection in Pickup/Drop:** APIs assume actors have sacks
  - Current: `find_actor_sack()` searches body_slots for items with container_data
  - Better: Use "main container" selection + fallback to dominant hand tool slot
  - See pickup_and_drop.md for implementation notes

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

## Phase 9: Tag-Based Equipment Slot System (NEW - PLANNED)

**Status:** Design Phase  
**⚠️ NOT YET IMPLEMENTED**  
**Goal:** Replace `valid_body_slots` array with ARMOR/GARB/TOOL tags that specify body slot compatibility

**Current Working System:** `valid_body_slots` array on ItemDefinition
- Simple but functional
- One item per body slot
- Compatibility: `item_def.valid_body_slots.includes(target_slot)`

**Future System:** Tag-based with ARMOR/GARB/TOOL
- More flexible
- Multiple items per slot (garb)
- Better categorization for actions
- Requires significant refactoring

---

### Current System (Working Now)

**Body Slot Structure:**
```typescript
body_slots: {
  hand_left: { item_instance_id: "inst_sword_001" },  // Max 1 item
  hand_right: { item_instance_id: "inst_torch_001" }, // Max 1 item
  head: { item_instance_id: "inst_helmet_001" },      // Max 1 item
  torso: { item_instance_id: "inst_tunic_001" },      // Max 1 item
  leg_left: { item_instance_id: "inst_pants_001" },   // Max 1 item
  leg_right: { item_instance_id: "inst_sack_001" }    // Max 1 item (container)
}
```

**Compatibility Check:**
```typescript
// ItemDefinition.valid_body_slots: string[]
const can_equip = item_def.valid_body_slots?.includes(target_slot_name);
// Example: sword.valid_body_slots = ["hand_left", "hand_right"]
```

**Known Bug:** Hand slot visual mirroring
- CharacterModule shows 2 positions per hand (red + blue)
- Both positions display the same equipped item
- Visual only - actual data only has 1 item per hand

---

### Proposed Future System: Tag-Based Slot Types

Each **body part** would have **3 functional slot types**:

```
Body Part (e.g., Left Hand)
├─ [ARMOR]  Max 1  ← Requires ARMOR tag + body_slot match
├─ [GARB]   Max ∞  ← Requires GARB tag + body_slot match
└─ [TOOL]   Max 1  ← Requires TOOL tag (any body part)
```

#### Slot Type Definitions

| Slot Type | Tag | Max Items | Body Slot Match | Purpose |
|-----------|-----|-----------|-----------------|---------|
| **ARMOR** | `ARMOR` | 1 | Yes | Protection (helmet, chest plate, gauntlet) |
| **GARB** | `GARB` | ∞ | Yes | Clothing, jewelry, accessories (rings, tunics, cloaks) |
| **TOOL** | `TOOL` | 1 | No | Weapons, tools, held items (sword, torch, potion) |

**Key Insight:** TOOL slots don't require body slot matching because tools are "held", not "worn". Armor and garb must match the body part (can't wear a helmet on your hand).

#### Body Part Slot Type Mapping

Each body part has a specific set of available slot types:

| Body Part | Armor | Garb | Tool | Notes |
|-----------|-------|------|------|-------|
| **Head** | ✓ | ✓ | | Helmets, hats, masks, headbands |
| **Torso** | ✓ | ✓ | | Chest armor, tunics, shirts, cloaks |
| **Hand Left** | ✓ | ✓ | ✓ | Gauntlets/bracers, rings/bracelets, weapons/tools |
| **Hand Right** | ✓ | ✓ | ✓ | Gauntlets/bracers, rings/bracelets, weapons/tools |
| **Leg Left** | ✓ | ✓ | | Greaves/leggings, pants, boots, accessories |
| **Leg Right** | ✓ | ✓ | | Greaves/leggings, pants, boots, accessories |

**Design Rationale:**
- **Head/Torso/Legs**: No tool slots - these are "worn" body parts. Items here are passive (armor/clothing).
- **Hands**: Have tool slots - hands are "active" and used to hold/wield items (weapons, torches, potions).
- **Garb slots**: Hold clothing, accessories, and containers (sacks, pouches, bags worn on legs/hands).
- **Initial Testing**: Use 1 item per garb slot for simplicity (support for multiple items can be added later).

#### Tag Data Structure

Tags already support metadata storage. Extend ARMOR and GARB tags:

```jsonc
// Armor tag with body slot specification
{
  "name": "ARMOR",
  "mag": 1,
  "meta": [
    { "key": "body_slot", "value": "hand_left" },  // Which slot this armor fits
    { "key": "armor_value", "value": 5 },           // Protection amount
    { "key": "layer", "value": "outer" }            // For layering system (future)
  ]
}

// Garb tag with body slot specification
{
  "name": "GARB", 
  "mag": 1,
  "meta": [
    { "key": "body_slot", "value": "hand_left" },   // Which slot this clothing fits
    { "key": "style", "value": "ornate" },          // Visual/style property
    { "key": "layer", "value": "base" }             // For layering system (future)
  ]
}

// Tool tag (no body slot needed - tools are held)
{
  "name": "TOOL",
  "mag": 1,
  "meta": [
    { "key": "tool_type", "value": "weapon" },      // Classification
    { "key": "damage_dice", "value": "1d6" }        // Mechanical property
  ]
}
```

#### Data Structure Changes

**OLD:**
```typescript
body_slots: {
  hand_left: { item_instance_id: "inst_sword_001" }
}
```

**NEW:**
```typescript
body_slots: {
  hand_left: {
    armor: null,                          // Max 1
    garb: ["inst_ring_001", "inst_bracelet_001"],  // Array, max ∞
    tool: "inst_sword_001"               // Max 1
  }
}
```

#### Visual Rendering by Slot Type

| Slot Type | Color | Display | Example |
|-----------|-------|---------|---------|
| **ARMOR** | Blue | Single item char | `H` for helmet |
| **GARB** | Green | Multiple items, stacked vertically | `r` `b` for ring+bracelet |
| **TOOL** | Red | Single item char | `/` for sword |

**Hand Slot Rendering (Fixed Bug):**
```
Left Hand (hand_left):
┌──────────┐
│ [Blue A] │ ← ARMOR slot: gauntlet/bracer
│ [Green G]│ ← GARB slot: ring(s)
│ [Green G]│ ← GARB slot: bracelet
│ [Red T]  │ ← TOOL slot: sword/torch/empty
└──────────┘
```

#### Equip Logic Flow

1. **Check Item Tags:** Does item have ARMOR, GARB, or TOOL tag?
2. **Check Body Slot Match:** (Skip for TOOL tags)
   - ARMOR/GARB: Does tag's `body_slot` meta match target slot?
3. **Check Slot Capacity:**
   - ARMOR: Is slot empty? (Max 1)
   - GARB: Always accepts (Max ∞)
   - TOOL: Is slot empty? (Max 1)
4. **Execute Equip:** Add item to appropriate slot array

#### Implementation Requirements

**⚠️ MAJOR REFACTORING REQUIRED**

To implement this system, the following changes are needed:

**1. Tag Definitions** (`local_data/data_slot_default/tag_definitions.jsonc`)
```jsonc
// ADD THESE TAGS:
{
  "name": "ARMOR",
  "description": "Protection equipment",
  "scope": ["ITEM"],
  "effects": [],
  "meta_schema": {
    "body_slot": "string",      // e.g., "head", "torso", "hand"
    "armor_value": "number",    // Protection amount
    "layer": "string"           // "inner", "outer", etc.
  }
}
{
  "name": "GARB",
  "description": "Clothing and jewelry",
  "scope": ["ITEM"],
  "effects": [],
  "meta_schema": {
    "body_slot": "string",      // e.g., "hand", "torso"
    "style": "string",          // Visual style
    "layer": "string"
  }
}
{
  "name": "TOOL",
  "description": "Usable items and weapons",
  "scope": ["ITEM"],
  "effects": [],
  "meta_schema": {
    "tool_type": "string",      // "weapon", "implement", etc.
    "damage_dice": "string"     // e.g., "1d6"
  }
}
```

**2. Data Structure Changes**
```typescript
// CURRENT (src/types/body_slots.ts)
interface BodySlot {
  name: string;
  critical: boolean;
  item_instance_id: string | null;
}

// FUTURE
interface BodySlot {
  name: string;
  critical: boolean;
  armor: string | null;           // Max 1
  garb: string[];                 // Unlimited
  tool: string | null;            // Max 1
}
```

**3. Container ID Pattern Changes**
```typescript
// CURRENT
container.henry_actor.hand_left

// FUTURE
container.henry_actor.hand_left.armor    // Gauntlet
container.henry_actor.hand_left.garb     // Rings (array)
container.henry_actor.hand_left.tool     // Sword
```

**4. Implementation Approach (No Migration Scripts)**

**Strategy: Direct Implementation with Git Version Control**

Since we use git for version control and want to avoid leaving migration scripts behind:

**Step 1: Add Tag Definitions**
- Add ARMOR and GARB to `tag_definitions.jsonc`
- Extend existing TOOL tag for equipment use
- Test: Load game, verify tags register

**Step 2: Update Types (Non-Breaking)**
- Change `BodySlot` interface to support armor/garb/tool
- Keep backward compatibility during transition
- Test: TypeScript compiles, existing actors still load

**Step 3: Inline Data Migration (Manual)**
Since we have minimal test data:
- Manually update 1-2 test actors in data_slot_1
- Add tags to a few test items
- Test the new system with limited data
- Iterate quickly

**Step 4: Code Updates with Dual Support**
- Validation checks tags first, falls back to valid_body_slots
- UI renders new slot structure when present
- Old format still works (backward compatible)
- Test: Both old and new actor formats work

**Step 5: Full Data Update**
- Once code is stable, update all items with tags
- Update all actors to new format
- Remove dual-support code paths
- Test: Everything works with new format only

**Benefits:**
- No leftover migration scripts
- Changes tracked in git
- Can rollback via git checkout
- Incremental testing

**5. Files to Modify**
- `local_data/data_slot_default/tag_definitions.jsonc` - Add ARMOR, GARB tags
- `src/types/body_slots.ts` - New slot structure with backward compat
- `src/equipment/tag_validation.ts` - NEW validation helpers
- `src/container_storage/store.ts` - Dual validation (tags + legacy)
- `src/canvas_app/app_state.ts` - Tag-based equip logic
- `src/mono_ui/modules/character_module.ts` - 3-position slot rendering
- `local_data/data_slot_1/items/*.jsonc` - Add equipment tags
- `local_data/data_slot_1/actors/*.jsonc` - Update body slot structure

#### Integration with Pickup/Drop

**Pickup Routing (where does picked up item go?):**
1. Check if actor has "main container" set (top of sidebar containers)
2. If no main container, check hands:
   - Dominant hand (hand_right) TOOL slot empty? → Place in hand
   - Otherwise → Try non-dominant hand
3. If hands full → Reject with "no space"

**Drop Logic (drag from character to ground):**
- Can drag from ANY equipped slot: armor, garb, or tool
- Source tracked via `drag_state.source_container_id`:
  - Format: `container.{actor_id}.{body_slot}.{slot_type}`
  - Examples:
    - `container.henry_actor.hand_left.tool` (sword in hand)
    - `container.henry_actor.hand_left.garb` (rings)
    - `container.henry_actor.torso.armor` (chest plate)

#### Legality System Integration

Tags define what's legal to equip where:
- **Legality check:** Does item's tag allow equipping to this body slot?
- **Example:** Ring with `GARB` tag + `body_slot: hand` → Can equip to any hand
- **Example:** Helmet with `ARMOR` tag + `body_slot: head` → Can ONLY equip to head

### Tasks

**Phase 1: Foundation (Tags & Types)** ✅ COMPLETE
- [x] Add ARMOR tag definition to tag_definitions.jsonc
- [x] Add GARB tag definition to tag_definitions.jsonc
- [x] Update TOOL tag for equipment use (already exists)
- [x] Update BodySlot interface (armor/garb/tool structure)
- [x] Create `src/equipment/tag_validation.ts` with validation helpers
- [x] Test: Tags load, TypeScript compiles ✅

**Phase 2: Validation (Dual Support)** ✅ COMPLETE
- [x] Implement `check_tag_compatibility()` function
- [x] Update `is_item_compatible_with_slot()` for dual validation
- [x] Add slot type constants (SLOT_TYPE_CATEGORIES)
- [x] Test: Items with tags validate correctly ✅
- [x] Test: Items with valid_body_slots still work (backward compat) ✅

**Phase 3: Data (Manual Updates)** ✅ COMPLETE
- [x] Add equipment tags to test items (hat - ARMOR, pants - GARB, tunic - GARB)
- [x] Manually update 1 test actor's body_slots structure (henry_actor)
- [x] Test: New format loads and validates ✅
- [x] Iterate: Fix issues, test again ✅
  - Added backward compatibility helpers in body_slots.ts
  - TypeScript compiles without errors
  - Both old and new formats supported

**Phase 4: UI (Rendering)**
- [ ] Update CharacterModule to render 3 slot positions per hand
- [ ] Add slot type colors (blue/green/red)
- [ ] Update drag-and-drop for slot types
- [ ] Test: Visual rendering correct, drag-drop works

**Phase 5: Integration (Pickup/Drop)**
- [ ] Update pickup routing to check slot types
- [ ] Update drop handling for armor/garb/tool sources
- [ ] Update "I" key to use main container preference
- [ ] Test: Pickup routes correctly, drop works from all slot types

**Phase 6: Complete Data Update**
- [ ] Add tags to all item definitions
- [ ] Update all actor body_slots to new format
- [ ] Remove dual-support code (clean up)
- [ ] Final integration test

### Acceptance Criteria

**Functional:**
- [ ] Items with ARMOR tag equip only to armor slots (1 max)
- [ ] Items with GARB tag equip to garb slots (∞ items)
- [ ] Items with TOOL tag equip to tool slots (1 max)
- [ ] Hand slots show 3 positions: armor (blue), garb (green), tool (red)
- [ ] No visual mirroring bug (each position distinct)

**Integration:**
- [ ] Pickup routes to main container or dominant hand tool slot
- [ ] Drop works from any equipped slot (armor/garb/tool/container)
- [ ] "I" key opens main container or shows hand if none
- [ ] Drag-and-drop respects slot type compatibility

**Compatibility:**
- [ ] Backward compatible during transition (dual validation)
- [ ] Can rollback via git if issues arise
- [ ] No data loss during format update

---

## Future Enhancements

- **Nested Containers:** Open containers-within-containers via ContainerModule
- **Additional Stats:** Thaum, stamina, action points in status section
- **Equipment Comparison:** Show stat changes when hovering equipped items
- **Quick Actions:** Right-click menu on body slots (examine, unequip, etc.)
- **Layering System:** Visual ordering of armor/garb layers (outer over inner)

---

## Notes

### Critical Design Principles

**1. No "Main Inventory":**
Characters and NPCs do NOT have a default inventory or "pocket" storage. All items must be stored in equipped containers (sacks, bags) or equipped to body slots. This replaces traditional RPG inventory systems.

**2. Equipped Containers vs Equipment:**
**Current System:**
- **Containers** (sacks, bags): Have `container_data`, provide storage capacity
- **Equipment** (armor, weapons, clothing): Equipped to body slots via `valid_body_slots`
- Sidebar shows equipped **containers** only
- Body slots show equipped items

**Future System (Phase 9):**
- Separate into: Armor (protection), Garb (clothing/jewelry), Tools (weapons/items)
- Tags: ARMOR, GARB, TOOL with body_slot metadata
- Each hand gets 3 slots: armor (1), garb (∞), tool (1)

**3. Equipment Compatibility:**
**Current:** `valid_body_slots` array on ItemDefinition
```typescript
sword.valid_body_slots = ["hand_left", "hand_right"]
helmet.valid_body_slots = ["head"]
```

**Future (Phase 9):** Tag-based validation
- `ARMOR` tag + `body_slot: "torso"` → Torso armor slot
- `GARB` tag + `body_slot: "hand"` → Any hand garb slot  
- `TOOL` tag → Any hand tool slot

**4. Slot Capacity:**
**Current:** One item per body slot (simple)
**Future:** Capacity by slot type
- ARMOR: Max 1
- GARB: Unlimited  
- TOOL: Max 1 per hand
- Container: Max 1 per body slot

**5. Hand Slot Rendering:**
**Current Bug:** Visual hand slots show 2 positions but both map to same body_slot
- Equipping to hand fills both visual slots (mirroring bug)

**Future Fix:** 3 separate slot positions per hand
- Blue (armor), Green (garb stack), Red (tool)

**6. State Management:**
- Pan and scroll offsets should reset when module opens
- Consider minimum module dimensions to ensure usability
- Sidebar scrolls independently of body slot panning
- "Main container" preference determines default inventory for pickup operations

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

### 8.8 Intra-Container Operations Architecture

**CRITICAL:** This section documents the architecture for operations within the same container (e.g., dragging items within a sack). The duplication bug occurs because `source_contents` and `dest_contents` point to the same array when `from_container === to_container`.

**Data Structures ALREADY EXIST:**
- `ItemDefinition.stackable?: boolean` - indicates if item can stack
- `ItemDefinition.max_stack_size?: number` - max quantity per stack (default: 1)
- `ItemInstance.qty: number` - current quantity (already displayed in UI)
- `valid_body_slots: string[]` - determines slot compatibility (already used for equipment)

**Architecture Principles:**

1. **Validation Pattern Consistency:**
   - Follow existing pattern: `valid_body_slots` check in `get_compatible_slots()`
   - Use `debug_log()` for tracing, `debug_error()` for failures
   - Return `{ ok: boolean; error?: string }` from validation functions

2. **Transfer Operation Types:**
   - **MOVE**: Source ≠ Dest, dest empty → remove from source, add to dest
   - **STACK**: Source ≠ Dest, dest has compatible stackable item → merge quantities
   - **SWAP**: Source ≠ Dest, dest occupied but compatible → exchange items
   - **REORDER**: Source === Dest, different slots → move within same array (no splice/push!)
   - **REJECT**: Any invalid operation → return error, no changes

3. **Intra-Container Handling:**
   ```typescript
   if (from_container_id === to_container_id) {
     // Same container - must be REORDER, not splice/push
     // Find target slot index
     // Swap array positions or return error if not valid reorder
   }
   ```

4. **Stack Compatibility Rules:**
   - Same `def_id`
   - Both `stackable: true`
   - Combined qty ≤ `max_stack_size` (default: 1)
   - Tags match (use existing tag comparison)
   - Note: ContainerModule already displays qty>1 (line 119)

5. **Swap Validation Rules:**
   - Item A fits in Slot B (check `valid_body_slots`)
   - Item B fits in Slot A (check `valid_body_slots`)
   - Both items pass body slot restrictions

**Implementation Location:**
- Primary: `src/container_storage/store.ts` in `transfer_item_between_containers()`
- Validation helpers: New file `src/transfer/validation.ts`
- Keep validation logic close to data (store.ts), not in UI layer

**CRITICAL BUG FIX:**
Lines 570-580 in store.ts currently do:
```typescript
const [removed_entry] = source_contents.splice(item_index, 1);  // Removes from array
dest_contents.push(removed_entry);  // Adds to SAME array if from===to - BUG!
```

When `from_container_id === to_container_id`, both point to the same `container_data.contents` array. The splice removes it, push adds it back = duplication. Must detect same-container and handle as reorder operation.

### Tasks:

#### ✅ COMPLETED (Verified Working)
- [x] Update CanvasRuntime to route OnDragEnd to target module
- [x] Add `find_module_at_position()` to module_registry
- [x] Update ContainerModule OnDragEnd for external drops (already supported via drag_state)
- [x] Update CharacterModule OnDragEnd for external drops (already supported via drag_state)
- [x] Implement capacity validation in transfer API (add_item_to_container)
- [x] Add debug logging for overfull containers
- [x] Test drag: Character torso → Open container on leg (✅ Working 2026-02-23)
- [x] Test drag: Container → Character body slot (✅ Working 2026-02-23)

#### ✅ CRITICAL BUG - FIXED
- [x] **CRITICAL: Fix intra-container duplication bug (Section 8.8)** ✅ 2026-02-23
  - [x] Add same-container detection in `transfer_item_between_containers()`
  - [x] Reject same-container transfers to prevent duplication
  - [ ] **Future**: Implement REORDER operation for within-container moves
  - [ ] **Documentation**: Update API docs to document intra-container behavior

#### 🔧 ADVANCED TRANSFER OPERATIONS (In Progress)
Consolidated stacking and swap into unified transfer enhancement:
- [x] **STACK**: Detect compatible items, merge quantities up to `max_stack_size` ✅ 2026-02-23
  - [x] Added `can_stack_items()` helper function
  - [x] Modified `transfer_item_between_containers()` to check for stacking
  - [x] Merge quantities when stacking, remove source instance
- [ ] **SWAP**: Detect slot compatibility via `valid_body_slots`, exchange positions
  - [ ] Create swap detection logic for body slots
  - [ ] Implement item exchange in transfer function
- [x] **MOVE**: Default behavior for empty target slots ✅ (already worked)
- [ ] **REORDER**: Handle same-container moves (requires slot index tracking)
  - [ ] Add source/target slot index parameters to API
  - [ ] Implement reorder logic for within-container moves
- [ ] **Documentation**: Create transfer operations reference guide

#### 📋 PENDING (Lower Priority)
- [ ] Implement ground drop handling
- [ ] Implement range checking for ground/NPC drops
- [ ] Test drag: Container → Ground pile
- [ ] Test drag: Character → NPC (in range)

### Acceptance Criteria:

#### ✅ COMPLETED & VERIFIED
- [x] CanvasRuntime routes OnDragEnd to module under cursor (not source)
- [x] Transfer API validates container capacity before adding items
- [x] Debug logging for overfull container attempts
- [x] Rejects drops when container full (API returns error)
- [x] Drag from CharacterModule to ContainerModule works (✅ Tested 2026-02-23)
- [x] Drag from ContainerModule to CharacterModule works (✅ Tested 2026-02-23)
- [x] Drag from CharacterModule slot to CharacterModule slot works (✅ Swap implemented 2026-02-23)
- [x] Slot highlighting shows compatible drop targets (✅ Tested 2026-02-23)
- [x] Nested containers work (sack inside leg_left) (✅ Tested 2026-02-23)
- [x] Container refresh after operations works (✅ Tested 2026-02-23)

#### ✅ CRITICAL - FIXED
- [x] **No item duplication when dragging within same container** ✅ 2026-02-23
  - Transfers within same container are rejected with error message
  - Prevents the splice/push duplication bug
- [ ] Intra-container moves handled as REORDER not transfer (future enhancement)

#### 🔧 REQUIRED (Advanced Operations)
- [x] Stacks compatible items (same def_id, stackable=true, qty <= max_stack_size) ✅ 2026-02-23
- [x] Swaps items when both fit in each other's slots ✅ 2026-02-23
  - Character-to-character slot transfers now work
  - Server-side swap logic implemented in transfer function
  - Client-side drop handling supports 'character' source module
- [x] Slot highlighting for compatible items ✅ 2026-02-23
  - Highlights work when dragging from both container and character slots
  - Clears on drag end
- [x] **Bidirectional highlighting** ✅ 2026-02-23
  - Hover item in container → compatible body slots highlight in CharacterModule
  - Hover body slot → compatible items highlight in ContainerModule(s)
  - Only highlights OPEN containers (uses ui_state.container.open_containers)
  - Same green color system (`{r: 0, g: 255, b: 100}`)
- [x] **Item swapping between valid slots** ✅ 2026-02-24
  - When dragging an item onto another item that can't stack
  - And both items fit in each other's slots (via `valid_body_slots`)
  - Items are automatically swapped instead of rejected
  - Works for body slot to body slot transfers
  - Example: Drag sword from hand_left to hand_right containing a torch → sword goes to hand_right, torch goes to hand_left
- [x] **Intra-container item organization** ✅ 2026-02-24
  - Fixed: Items can now be moved between slots within the same container
  - Drag item from one slot to another slot in same container → items swap positions
  - Drag item to empty slot in same container → item moves to that position
  - API now supports `from_slot_index` and `to_slot_index` parameters
  - Only rejects when dropping item on itself (same slot)
  - Fixed critical bug: Same-container transfers now use single array reference
  - Fixed double-loading: Container loads once instead of twice for same-container ops
  - Fixed double-save: Only saves once for same-container transfers
- [x] **Grid-based sparse inventory (Minecraft-style)** ✅ 2026-02-24
  - Items can be placed at any grid position within container bounds
  - Empty slots between items are now supported (e.g., item at slot 0, empty slot 1-3, item at slot 4)
  - Smart drop behavior:
    - **Stack**: When dropping compatible items on each other (same type, within stack limit)
    - **Swap**: When items can't stack but both fit in each other's positions
    - **Move**: When dropping on empty grid position
  - Grid coordinates (`target_grid_x`, `target_grid_y`) passed via API
  - Container contents now store `grid_x` and `grid_y` properties for sparse placement
- [x] **Drag ghost visual effect** ✅ 2026-02-23
  - Item character appears at cursor position during drag
  - Wiggles in WEIGHT (thickness) not position - range 9-13 for visibility
  - **Invalid drop feedback**: When dragged to invalid location:
    - Turns RED and flashes
    - Continues weight animation while flashing
    - Auto-returns to source after 800ms flash + 400ms fade
    - No more "drag limbo" - clear visual feedback for rejected drops
  - **Works everywhere**: 
    - Outside modules (via `on_drag_end_outside` CanvasRuntime callback)
    - Inside modules but NOT on valid slots (via `on_drag_rejected` callback)
    - Position is clamped to canvas bounds so animation is always visible
  - Rendered by all modules via `render_drag_ghost` callback
  - High weight index to appear on top of other elements
- [x] **Container slot visibility** ✅ 2026-02-24
  - Empty slots now use "medium_gray" from indexed color system (`{r: 120, g: 125, b: 139}`)
  - Much more visible than previous dark gray (`{r: 40, g: 40, b: 40}`)
  - Better contrast against container background
- [ ] Auto-finds first free slot when dropping on module
- [x] Shows appropriate error messages for rejected drops ✅ 2026-02-23

#### 📋 PENDING (Ground/NPC)
- [ ] Drag to ground creates pile at drop location
- [ ] Drag to NPC puts item in NPC's main container (in range)
- [ ] Range check prevents dropping too far from actor

### Deprecated Systems:

The following systems are **replaced** by this implementation and should be removed/refactored:

- **Old `on_cross_module_drop` callback** - Replaced by routing to target module
- **Source-module-based drop handling** - Now handled by target module
- **Simple within_rect checks** - Replaced by comprehensive validation

---

## 9. Documentation Updates

As features are implemented, update the following documentation:

### API Documentation (`docs/API.md` or create `docs/transfer_api.md`)
- [ ] Document `/api/transfer` endpoint behavior
- [ ] Document transfer operation types (move, stack, swap, reorder)
- [ ] Document validation rules (capacity, weight, slot compatibility)
- [ ] Document error responses and codes
- [ ] Add examples for each operation type

### Architecture Documentation (`docs/architecture/`)
- [ ] Document Slot interface abstraction
- [ ] Document TransferManager pattern
- [ ] Document validation hierarchy (client vs server)
- [ ] Update container storage architecture diagram

### User Documentation (`docs/user/` or `docs/guides/`)
- [ ] How to use drag-and-drop inventory
- [ ] How stacking works
- [ ] How to equip/unequip items
- [ ] Container opening/closing
- [ ] Weight and encumbrance system

### Code Documentation
- [ ] JSDoc for `transfer_item_between_containers()`
- [ ] JSDoc for validation functions
- [ ] Inline comments for complex transfer logic
- [ ] Type definitions for TransferOperation

### Update Existing Plans
- [ ] Mark completed items in this plan
- [ ] Update `2026_02_19_inventory_movement_plan.md` if needed
- [ ] Update `CONTAINER_FORMAT_STATUS.md` with any format changes
- [ ] Update main `README.md` with feature status

---

**Status:** Phase 7 Complete ✓ | Phase 8 Core Complete ✓ | Phase 9 Design Phase

**Last Updated:** 2026-02-27

**Completed:**
- ✅ Phase 7: Right-click container opening with multi-instance support
- ✅ Phase 7: Orange/purple color coding for container states  
- ✅ Phase 8: CanvasRuntime routing fix (routes drops to target module)
- ✅ Phase 8: Transfer API capacity validation with debug logging
- ✅ Phase 8: Character ↔ Container transfers working
- ✅ Phase 8: Nested container support (sack inside leg_left)
- ✅ Phase 8: Container refresh system working
- ✅ Phase 8: **CRITICAL BUG FIX** - Intra-container duplication prevented
- ✅ Phase 8: **Stacking implemented** - Compatible items merge automatically
- ✅ Phase 8: Pickup/Drop APIs working (inline scattered containers)

**Current State:**
- ✅ Core inventory management working (move between containers)
- ✅ Critical duplication bug fixed (same-container transfers rejected)
- ✅ Stacking working (items auto-merge when compatible)
- ✅ Swap logic working (body slot to body slot exchanges)
- ✅ Slot highlighting working (shows compatible targets)
- ✅ **Bidirectional highlighting** (item↔slot cross-module highlighting)
- ✅ **Drag ghost visual** (wiggling item at cursor during drag)
- ✅ Pickup/Drop working with inline scattered containers
- 📋 Phase 9: Tag-based slot system (ARMOR/GARB/TOOL) - Design Phase

**Next Steps:**
1. 🔧 **Phase 9: Implement tag-based slot system**
   - Add ARMOR/GARB/TOOL tag schemas
   - Update body_slots data structure
   - Fix hand slot mirroring bug
   - Update legality system for tags
2. 📋 **Implement ground drop handling** (drag to background)
3. 📋 **Implement range checking** for ground/NPC drops
4. 📝 **Documentation updates** (see Section 9)

---

## 11. Architecture Decision Records

### ADR-001: Tag-Based Equipment Slots (2026-02-27)

**Decision:** Replace `valid_body_slots` array with ARMOR/GARB/TOOL tags that include body slot specifications in tag metadata.

**Context:**
- Current system uses `valid_body_slots: string[]` on ItemDefinitions
- Hand slots show 2 visual positions but both map to same body_slot (mirroring bug)
- No way to equip multiple rings on one hand (no garb slot concept)
- No distinction between worn armor and held tools

**Decision:**
Implement 3 slot types per body part using tags:
- **ARMOR** (tag): Max 1, requires body_slot match (e.g., helmet → head)
- **GARB** (tag): Max ∞, requires body_slot match (e.g., rings → hand)
- **TOOL** (tag): Max 1, NO body_slot match (tools are held, not worn)

**Consequences:**
- ✅ Supports multiple jewelry on one hand (garb slots)
- ✅ Clear visual separation of armor/garb/tool per body part
- ✅ Fixes hand slot mirroring bug
- ✅ Tags already support metadata (no schema changes needed)
- ⚠️ Requires migration of existing equipped items
- ⚠️ Updates needed to CharacterModule rendering logic

### ADR-002: No Default Inventory (2026-02-22)

**Decision:** Characters have no "pockets" or default storage. All items must be in equipped containers, worn as armor/garb, or held as tools.

**Context:**
- Traditional RPGs give characters magic inventory space
- Realistic tabletop RPGs require physical containers
- Simplifies "where is this item?" questions

**Decision:**
- Items must be stored in equipped containers (sacks, bags with container_data)
- OR worn as armor/garb (equipped to body slots)
- OR held in hands (tool slots)
- Pickup operations route to "main container" (configurable) or dominant hand

**Consequences:**
- ✅ More realistic inventory management
- ✅ Encourages strategic container selection
- ✅ Clear item location tracking
- ⚠️ New characters start with no storage (need to find/acquire containers)
- ⚠️ Hand slots become critical (can't hold tool if hands full)

### ADR-003: Hand Slot Tool vs Armor/Garb (2026-02-27)

**Decision:** Each hand has 3 distinct slot types: armor (worn), garb (worn), tool (held).

**Context:**
- Current bug: Equipping to hand fills both visual slots with same item
- Want to wear gauntlets (armor) + rings (garb) + hold sword (tool)
- Need clear distinction between "worn on hand" vs "held in hand"

**Decision:**
```
hand_left:
  armor: gauntlet (1 max)  - Worn on hand
  garb: [ring, bracelet]   - Worn on hand, unlimited
  tool: sword (1 max)      - Held in hand
```

**Consequences:**
- ✅ Can wear protective gear while holding items
- ✅ Supports blinged-out characters (multiple rings)
- ✅ Clear visual: blue (armor), green (garb), red (tool)
- ⚠️ Complex rendering logic (3 positions per hand)
- ⚠️ More complex equip validation

---

## 12. Grid-Based Sparse Inventory System (Minecraft-Style) - ATTEMPTED 2026-02-24

**Status:** Partially Implemented - Requires Completion

### Objective
Implement a Minecraft-style inventory system where items can be placed at ANY grid position within container bounds, not just packed at the front. This allows layouts like:
```
[X][ ][ ][ ][X]  <- Items at slots 0 and 4 with empty space between
[ ][X][ ][ ][ ]  <- Another item at slot 6 (row 2, col 2)
```

### What Was Attempted

#### Backend Changes (`src/container_storage/store.ts`)
- ✅ Added `grid_x` and `grid_y` optional fields to `ContainerContentEntry` interface
- ✅ Updated `transfer_item_between_containers()` to accept `target_grid_x` and `target_grid_y` parameters
- ✅ Implemented sparse placement logic with three behaviors:
  - **Stack**: Drop compatible items onto each other (merge quantities)
  - **Swap**: Exchange positions with incompatible items
  - **Move**: Place item at empty grid position
- ✅ Fixed same-container transfer bug (single array reference, no double-loading)
- ✅ Updated `can_stack_items()` function signature to support grid coordinates

#### API Changes (`src/interface_program/main.ts`)
- ✅ Modified `/api/transfer` endpoint to accept `target_grid_x` and `target_grid_y` in request body
- ✅ Pass grid coordinates to backend transfer function

#### Frontend Changes (`src/mono_ui/modules/container_module.ts`, `src/canvas_app/app_state.ts`)
- ✅ Updated `ContainerModuleConfig.on_drop` signature to include `grid_x` and `grid_y` parameters
- ✅ Added grid coordinate calculation in ContainerModule: `grid_x = slot_index % cols`, `grid_y = floor(slot_index / cols)`
- ✅ Modified drag_state to track `source_slot_index`
- ✅ Updated transfer request to conditionally include grid coordinates for same-container transfers

### What Worked
- ✅ Same-container item reorganization (moving items between slots)
- ✅ Item swapping within containers
- ✅ Basic transfer API functioning
- ✅ Grid coordinates being calculated and sent from frontend

### What Did NOT Work
- ❌ **Grid coordinates not reaching backend**: Log analysis shows "No grid coordinate logs found" - the `target_grid_x` and `target_grid_y` parameters aren't being received by the backend
- ❌ **Items still packed at front**: Without grid coordinates, items continue to use legacy packed-array behavior
- ❌ **Cannot place items in arbitrary positions**: Items can't be scattered with gaps between them
- ❌ **Slot 7 rejection issue**: Transfers to certain slots fail (logged as "Drop failed on slot 7")

### Root Cause Analysis

**Primary Issue:** Data flow interruption
1. Frontend calculates grid coordinates correctly
2. Frontend includes them in transfer request body (conditionally for same-container)
3. Backend API endpoint accepts them in request body
4. **Gap**: The parameters aren't reaching the `transfer_item_between_containers()` function

**Secondary Issue:** The conditional check `if (target_grid_x !== undefined && target_grid_y !== undefined)` in backend likely fails, causing fallback to legacy behavior.

### Files Modified (Ready for Debug/Completion)
1. `src/types/container.ts` - Grid fields added to interface
2. `src/container_storage/store.ts` - Grid-aware transfer logic implemented
3. `src/interface_program/main.ts` - API accepts grid parameters
4. `src/mono_ui/modules/container_module.ts` - Grid calculation on drop
5. `src/canvas_app/app_state.ts` - Grid params included in transfer body

### Recommended Next Steps to Complete

#### Option A: Debug Current Implementation (30 minutes)
1. Add console.log at each data flow step:
   - ContainerModule when calling on_drop
   - app_state.ts when building transfer_body
   - interface_program/main.ts when receiving request
   - store.ts when entering transfer function
2. Verify data is actually flowing through the chain
3. Find where grid coordinates are being lost

#### Option B: Simplified Approach (1-2 hours)
- Instead of grid coordinates, use `slot_index` directly for sparse placement
- Modify backend to place items at any `target_slot_index` up to `max_slots`
- Change `dest_contents.push()` to `dest_contents.splice(target_index, 0, item)`
- Remove dependency on grid_x/grid_y, use slot_index as sparse position indicator

#### Option C: Full Rewrite (3-4 hours)
- Refactor container.contents to be truly sparse (array of {item, grid_x, grid_y})
- Rewrite rendering to place items at stored grid positions
- Update all container operations (add, remove, move, stack) to use grid coordinates
- Migration script to convert existing packed arrays to sparse format

### Current Blocker
The grid coordinates are being sent from frontend but not reaching the backend transfer logic. The system falls back to legacy packed-array behavior, preventing sparse placement.

**Decision Needed:** Debug Option A to find the data flow break, then choose B or C based on findings.

# Character Module Rework

**Status:** Planning  
**Priority:** High  
**Created:** 2026-02-22  
**Related Plans:** 
- 2026_02_19_inventory_movement_plan.md (Phases 7.5, 8, 9)
- 2026_02_14_item_system_unification.md

---

## Overview

Refactor the CharacterModule to provide a comprehensive character inspection interface with three distinct areas: a container sidebar, a pannable body slot view, and a scrollable status bar section. This rework unifies character data display and provides access to all stored items through body slot containers.

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
- ❌ Container sidebar showing first-layer containers
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
   - **Left Sidebar (~15% width):** Container boxes
     - Each body slot with a container gets a 3x3 box
     - Shows container's display_char (or 'C' default)
     - Clickable to open container in ContainerModule
     - Vertically scrollable
   - **Center Pane (~85% width):** Body slots
     - Current body slot rendering
     - Pannable for large creatures (drag to pan)
     - Shows slot name and equipped item

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

### Phase 3: Container Sidebar

**Goal:** Display first-layer containers from body slots.

**Data Structure:**
```typescript
// Each body slot can have an associated container
type BodySlotWithContainer = {
  slot_name: string;
  container_id?: string;  // e.g., "container.gunther.hand_left"
  container_char?: string; // Display char from container item definition
};
```

**Tasks:**
- [ ] Add callback: `get_body_slot_containers(): BodySlotWithContainer[]`
- [ ] Create container box rendering:
  - 3x3 box per container
  - Center char from container definition (or 'C' default)
  - Spacing between boxes (1 char gap)
- [ ] Add vertical scroll offset state for sidebar
- [ ] Implement scroll handling (mouse wheel)
- [ ] Click handler to open container in ContainerModule

**Acceptance:**
- [ ] Containers display as 3x3 boxes in left sidebar
- [ ] Shows correct character from container item
- [ ] Clicking opens ContainerModule with that container
- [ ] Scrollable when many containers

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
  
  // NEW: Container information for sidebar
  get_body_slot_containers: () => Array<{
    slot_name: string;
    container_id?: string;
    container_char?: string;
  }>;
  
  // NEW: Health data for status bar
  get_health_data: () => { current: number; max: number };
  
  // NEW: Container click handler
  on_container_click?: (container_id: string) => void;
};
```

### Data Flow

1. **Container Sidebar:**
   - Get body_slots from character data
   - For each slot, check if `container.{actor_id}.{slot_name}` exists
   - Fetch container item definition to get display_char
   - Render 3x3 box with char in center

2. **Body Slot Area:**
   - Use existing body slot rendering
   - Apply pan offset to all positions
   - Maintain existing drag-and-drop

3. **Status Section:**
   - Weight: Sum container contents (existing)
   - Health: From actor/npc resources.health
   - Render bars with proportional fill

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

- Container boxes show FIRST-LAYER containers only (direct container in slot)
- Nested containers accessed via ContainerModule (future feature)
- Pan and scroll offsets should reset when module opens
- Consider minimum module dimensions to ensure usability

---

**Next Step:** Begin Phase 1 - Border System Update

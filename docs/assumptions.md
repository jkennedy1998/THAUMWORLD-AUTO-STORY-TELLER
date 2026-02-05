# Place Module Development Assumptions

This document logs all assumptions and design decisions made during the development of the `place_module` for the THAUMWORLD-AUTO-STORY-TELLER UI system.

## Date: 2025-02-05

---

## 1. UI Grid Expansion

**Decision:** Expanded grid from 120x44 to 160x50

**Rationale:**
- Need space for place_module on the right side of existing modules
- Existing modules occupy x0: 0-118
- Place module positioned at x0: 120-158 (38 chars wide)
- Height increased to 50 to give more vertical room

**Impact:**
- Canvas size increased
- All existing module positions remain valid
- Place module fits on right side without overlap

---

## 2. Entity Representation

**Decision:** Use first letter of entity name, capitalized

**Implementation:**
- NPCs: First letter of npc_ref (after "npc." prefix), displayed in pale yellow
- Actors: First letter of actor_ref (after "actor." prefix), displayed in vivid green
- Example: "npc.gunther" → "G", "actor.henry_actor" → "H"

**Rationale:**
- Compact single-character representation fits tile grid
- Capitalization adds visual distinction
- Color coding distinguishes NPCs from actors
- Easy to parse from entity reference strings

**Fallback:**
- If entity name cannot be parsed, defaults to "N" for NPC, "A" for Actor
- If completely invalid, shows "?"

---

## 3. Viewport and Scaling System

**Decision:** Implement variable scale with power-of-2 values (1, 2, 4, 8)

**Scale Definition:**
- Scale 1: 1 tile = 1 character (1:1)
- Scale 2: 2x2 tiles = 1 character
- Scale 4: 4x4 tiles = 1 character
- Scale 8: 8x8 tiles = 1 character

**Rationale:**
- Power-of-2 values simplify tile-to-screen coordinate math
- Allows viewing large places (40x40) on small modules (37x46 chars)
- At higher scales, entity priority ensures important objects remain visible

**Entity Priority at Scale > 1:**
When multiple tiles map to one character, priority is:
1. NPC (if any tile in block has NPC)
2. Actor (if any tile in block has Actor)
3. Floor (default)

---

## 4. Coordinate System

**Decision:** Use bottom-left origin for place tiles, matching canvas coordinates

**Mapping:**
- Place tiles use (0, 0) at bottom-left
- Canvas uses bottom-left coordinate system
- Viewport offset tracks bottom-left corner of visible area
- Screen coordinates converted to tile coordinates using:
  ```
  tile_x = view_offset_x + (screen_x - inner_x0) * scale
  tile_y = view_offset_y + (screen_y - inner_y0) * scale
  ```

**Rationale:**
- Consistent with existing canvas coordinate system
- Natural for place grid where (0,0) is typically entry point
- Avoids Y-flipping mental overhead

---

## 5. Scrolling and Panning Controls

### Keyboard Controls:
- **Arrow keys / WASD:** Pan viewport by 1 tile (or scale tiles)
- **Home:** Center view on default entry point
- **+ / =:** Zoom in (decrease scale)
- **- / _:** Zoom out (increase scale)
- **0:** Reset to 1:1 scale and center on entry

### Mouse Controls:
- **Left click + drag:** Pan viewport
- **Wheel:** Vertical scroll (pan up/down)
- **Shift + Wheel:** Horizontal scroll (pan left/right)
- **Ctrl + Wheel:** Zoom in/out

**Rationale:**
- Standard controls matching common map applications
- Multiple input methods accommodate user preferences
- Discrete zoom levels prevent "stuck" zoom states

---

## 6. Place Boundary Rendering

**Decision:** Draw boundary lines with box-drawing characters

**Implementation:**
- Uses "│" (vertical) and "─" (horizontal) characters
- Boundary drawn in medium gray
- Only renders edges that are visible in current viewport
- Boundaries represent the 0..width and 0..height limits

**Rationale:**
- Clear visual indication of place extent
- Box-drawing characters fit monospace aesthetic
- Dynamic rendering only draws visible portions for performance

---

## 7. Hover and Selection System (Phase 1)

**Decision:** Implement hover highlighting in Phase 1, defer click selection to Phase 2

**Phase 1 Implementation:**
- Mouse hover highlights tile in pale orange
- Displays entity info at bottom of module:
  - Entity reference (npc.name or actor.name)
  - Current status (present, moving, busy, sleeping)
- Info bar at top shows:
  - Place name
  - Place dimensions
  - Current view offset
  - Current scale ratio

**Rationale:**
- Hover provides immediate feedback
- Info display helps users understand what they're seeing
- Phase 2 will add click-to-select for targeting

---

## 8. Place Data Loading

**Decision:** Load place data reactively based on place_id from targets endpoint

**Implementation:**
- `get_current_place()` returns cached Place object
- `update_current_place(place_id)` loads from storage:
  - Uses `load_place(slot, place_id)` from place_storage/store.ts
  - Caches result in ui_state.place.current_place
  - Updates ui_state.place.current_place_id
- Triggered when targets endpoint returns different place_id
- Also refreshes data when place_id stays same (to get updates)

**Rationale:**
- Reactive updates when player moves between places
- Avoids loading place data every frame
- Ensures fresh data when place contents change

**Fallback:**
- If place load fails, displays "No place loaded" with placeholder
- Continues retrying on next poll cycle

---

## 9. Initial View Position

**Decision:** Center viewport on place's default_entry point

**Implementation:**
- When place first loads and view is at (0,0), automatically center
- Calculates offset to put default_entry at center of viewport
- Respects viewport boundaries (won't center outside place bounds)

**Rationale:**
- Player typically enters at default_entry
- Provides consistent starting view
- Home key (0) provides quick return to centered view

---

## 10. Focus Management

**Decision:** Place module is focusable (Focusable: true)

**Implementation:**
- Module accepts focus for keyboard input
- Arrow keys and other shortcuts only work when focused
- User must click into module to pan with keyboard
- Mouse interactions work regardless of focus

**Rationale:**
- Prevents accidental viewport movement when typing in input
- Standard UI pattern for interactive modules
- Mouse users can interact immediately

---

## 11. Color Scheme

**Decision:** Use existing color palette from colors.ts

**Assignments:**
- Border: light_gray
- Background: off_black
- Floor tiles: dark_gray
- NPCs: pale_yellow
- Actors: vivid_green
- Grid/boundaries: medium_gray
- Hover highlight: pale_orange
- Info text: off_white, pale_yellow

**Rationale:**
- Consistent with existing UI color scheme
- Sufficient contrast for readability
- Semantic colors (green for player/actor, yellow for NPCs)

---

## 12. Floor Rendering

**Decision:** Use "." for floor at scale 1-2, "·" (middle dot) at scale 4-8

**Rationale:**
- Period is traditional roguelike floor representation
- Middle dot is more subtle for zoomed-out views
- Reduces visual noise when many tiles visible

---

## 13. Spatial Index for Entity Lookup

**Decision:** Implement a spatial index (`place_entity_index.jsonc`) to map place_id → entity_refs

**Implementation:**
- **File:** `src/place_storage/entity_index.ts`
- **Structure:** `{ [place_id]: { npcs: string[], actors: string[], last_updated: string } }`
- **Storage:** JSON file at `local_data/data_slot_X/place_entity_index.jsonc`
- **Status:** DEBUG/TEMPORARY - can be deleted and rebuilt at any time

**Update Mechanism:**
- Synchronous hooks in movement system (`travel_between_places`)
- Updates immediately when entity moves from one place to another
- No stale data - always reflects current entity locations

**API Integration:**
- `/api/place` endpoint uses index to find entities in place
- Loads full NPC/actor data to populate `place.contents`
- Returns enriched place data with current entity positions

**Migration:**
- `scripts/build_place_index.ts` - one-time scan to build initial index
- Run with `npx tsx scripts/build_place_index.ts [--slot=1] [--force]`

**Performance:**
- O(1) lookup to get entity refs for a place
- Loads only ~dozens of entities actually present (not thousands)
- No full scan of all NPC/actor files per place load

**Debug Logging:**
- All index operations logged with `[PlaceEntityIndex]` prefix
- Logs: add/remove/move operations with counts
- Logs: rebuild progress with statistics
- Logs: warnings for missing entities or invalid refs

**Rationale:**
- Supports thousands of world-wide NPCs efficiently
- Real-time updates without batch/sync scripts
- No cache invalidation complexity
- Scalable: Index size = total entities, not query complexity
- Tabletop-appropriate: Turn-based, batch updates fine

---

## Future Phase 2 Considerations

Planned for future implementation:
1. Click to select tile/entity for targeting
2. Show feature icons/features on tiles
3. Path highlighting for movement
4. Visual effects for active events
5. Fog of war / unexplored areas
6. Connection indicators to other places

---

## Open Questions

1. **Feature Rendering:** How to represent multi-tile features in viewport?
2. **Item Display:** Should items on ground be shown? With what priority?
3. **Multiple Entities:** How to handle multiple NPCs on same tile?
4. **Performance:** Should we throttle rendering for very large places?
5. **Persistence:** Should viewport position persist between sessions?


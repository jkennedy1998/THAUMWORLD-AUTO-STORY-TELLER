# Place Module Development Plan

**Date:** 2025-02-05  
**Status:** SUPERSEDED - See PLACE_SYSTEM_PLAN.md (2026-02-02)  
**File:** `docs/PLACE_MODULE_PLAN.md`

> ⚠️ **NOTE:** This plan has been superseded by `PLACE_SYSTEM_PLAN.md` (dated 2026-02-02).  
> The newer document contains the current canonical place system architecture.  
> This file is preserved for historical reference only.

---

## Overview

This document outlines the phased development of the place module for THAUMWORLD-AUTO-STORY-TELLER. The place module serves as the primary interface for visualizing and interacting with the game world at the "place" scale (20-40 tile grids).

---

## Core Design Principles

### Visual Style
- **Pure ASCII:** No emojis, no special symbols, no grid lines
- **Monospace only:** Martian Mono as primary, fallback to similar monospace
- **Character-based representation:** Use best visual ASCII character for each entity type
- **No color-based characters:** Symbols must work without color dependency

### Rendering Priority System
When multiple entities occupy one tile, cycle through them every 0.5 seconds:
1. NPCs (highest priority)
2. Actors
3. Features
4. Items (lowest priority)
5. **Exclude:** Particles from targeting

### Animated ASCII Support (Future)
- Multi-character animations for special tiles/items
- Particle effects that can draw outside tile bounds temporarily
- System designed with accommodation for this from the start

---

## Phase 1: Foundation & Polish

### 1.1 Fix Border Rendering
**Status:** ✅ COMPLETED  
**Problem:** Borders rendered ON valid tiles (0,0), obscuring entities  
**Solution:**
- Place border lines on the first INVALID tile (outside place bounds)
- Left border at tile x = -1
- Right border at tile x = width
- Bottom border at tile y = -1
- Top border at tile y = height
- Walls now render one tile outside the valid 0..width-1 range
- Entities at position (0,0) render clearly inside the room

**Implementation:** `src/mono_ui/modules/place_module.ts`

### 1.2 Fix Entity Positioning
**Status:** ✅ COMPLETED  
**Problem:** Entities at (0,0) or edges appeared on walls  
**Solution:** 
- API-level clamping ensures entities stay within 0..width-1 bounds
- Position validation with debug warnings for out-of-bounds entities
- Combined with border fix, entities render clearly inside room

**Implementation:** `src/interface_program/main.ts` - `/api/place` endpoint

### 1.3 Visual Polish
**Status:** ✅ COMPLETED  
**Changes:**
- Bold text (weight_index: 6) for entities
- Vivid colors for better visibility
- Hover highlighting with pale orange

**Completed:**
- ✅ Spatial index system for fast entity lookups
- ✅ 25-tile padding beyond place edges for panning
- ✅ Border rendering on invalid tiles (outside place bounds)
- ✅ Entity position clamping in API
- ✅ Bold text for entities
- ✅ Hover highlighting
- ✅ Visual distinction between NPCs (yellow) and actors (green)
- ✅ Debug logging disabled (reduced console spam)
- ✅ Door rendering at connection points
- ✅ Door interaction (right-click shows destination)
- ✅ Door visual feedback (cyan color, semi-bold)
- ✅ Outbox fixed (removed empty message causing errors)
- ✅ Click-to-move system (left-click empty tile to move)
- ✅ Particle system for path visualization
- ✅ BFS pathfinding with 8-directional movement
- ✅ Real-time actor movement (1 tile/sec)
- ✅ Movement constraints (blocked by entities, bounds)

---

## Phase 2: Interactive Targeting

### 2.1 Right-Click Target Detection
**Status:** ✅ COMPLETED  
**Implementation:**
- Added `OnContextMenu` handler to Module type and place module
- Event dispatched from canvas_runtime.ts on right-click
- Converts screen coordinates to tile coordinates
- Identifies entity at tile (NPC, actor, or empty)
- **Debug output:** Logs targeted entity type and ref to console

**Files Modified:**
- `src/mono_ui/types.ts` - Added OnContextMenu to Module interface
- `src/mono_ui/runtime/canvas_runtime.ts` - Added contextmenu event listener
- `src/mono_ui/modules/place_module.ts` - Implemented OnContextMenu handler

### 2.2 Multi-Entity Tile Cycling
**Status:** ✅ COMPLETED  
**Implementation:**
- Added `tile_cycle_state` Map to track cycling state per tile
- `get_all_entities_at()` collects all entities at a tile position
- `get_entity_at()` now cycles through entities every 500ms when multiple present
- Priority: NPCs first, then Actors (via array ordering)
- State persists across renders with timestamp tracking
- Debug logging shows when cycling occurs

**Key Implementation Details:**
- Cycle interval: 500ms (CYCLE_INTERVAL_MS constant)
- State stored as `{last_update: timestamp, current_index: number}`
- Tile key format: `"x,y"` for Map lookup
- Falls back to null if entity array is somehow empty

**Files Modified:**
- `src/mono_ui/modules/place_module.ts` - Added cycling logic and state management

### 2.3 Target Selection Integration
**Status:** ✅ COMPLETED  
**Implementation:**
- Added `on_select_target` callback to PlaceModuleConfig
- Right-click on entity attempts to set it as the UI target
- Callback validates target exists in available targets list
- Visual feedback via flash_status: "Target: [entity_name]"
- Returns boolean indicating success/failure

**Integration Flow:**
1. User right-clicks entity in place module
2. `get_all_entities_at()` retrieves all entities at tile
3. `on_select_target(ref)` callback invoked with entity reference
4. Callback checks if ref exists in `ui_state.controls.targets`
5. If valid: sets `selected_target` and shows status confirmation
6. If invalid: returns false, logs to console

**Files Modified:**
- `src/mono_ui/modules/place_module.ts` - Added on_select_target callback and ContextMenu logic
- `src/canvas_app/app_state.ts` - Implemented target validation and selection logic

---

## Phase 3: Doors & Navigation

### 3.1 Door Rendering
**Status:** ✅ COMPLETED  
**Implementation:**
- Doors render at place connection points based on direction
- Direction mapping: north/up (top edge), south/down (bottom), east/right, west/left
- Default position: center of appropriate edge or default_entry
- Character: `=` (equals sign) - visible but ASCII-compliant
- Color: vivid_cyan for visibility
- Weight: 5 (semi-bold)

### 3.2 Door Interaction
**Status:** ✅ COMPLETED  
**Implementation:**
- Right-click on door tile (inside or outside place bounds)
- Detects clicks within 1 tile of door position
- Debug logs:
  - `target_place_id`: Where the door leads
  - `direction`: Cardinal direction or custom
  - `description`: Connection description
  - `travel_time`: Seconds to travel

### 3.3 Visual Feedback
**Status:** ✅ COMPLETED  
**Implementation:**
- Bright cyan color distinguishes doors from walls (gray) and entities (yellow/green)
- Semi-bold weight makes doors stand out
- Positioned on edges at appropriate cardinal directions

### 3.4 Auto-Pathing (Research Phase)
**Status:** PENDING - RESEARCH REQUIRED  
**Notes:**
- Must integrate with movement system
- Consider timed event constraints:
  - Movement cost during combat/conversation
  - Action slot usage during timed events
  - Free movement outside timed events
- Path visualization: line showing route
- Blocked by obstacles/features

**Research Questions:**
- How does movement system calculate costs during timed events?
- Can we preview path cost before committing?
- What blocks movement? (features, entities, walls)

---

## Phase 5: Click-to-Move & Free Movement System

### 5.1 Click-to-Move (Non-Timed Events)
**Status:** ✅ COMPLETED  
**Implementation:**
- **Left-click** on empty tile → Initiates movement to that tile
- Checks if target is walkable (no entities, in bounds)
- Finds path using BFS pathfinding (8-directional movement)
- Movement speed: 1 tile per second (MOVEMENT_SPEED_MS = 1000)
- Real-time movement: Actor moves tile-by-tile automatically
- Debug logging shows path length and movement status

**Key Features:**
- Won't move if clicked on entity (let targeting handle that)
- Won't move to non-walkable tiles
- Shows "No path found" if blocked
- Movement state tracked with path array and current index

**Files Modified:**
- `src/mono_ui/modules/place_module.ts` - Added OnClick handler, movement logic

### 5.2 Particle System for Path Visualization
**Status:** ✅ COMPLETED  
**Implementation:**
- **Particle type**: Static markers with position, char, color, lifespan
- **Path Particles**: Spawned along the calculated path on movement start
- **Movement Particles**: Cyan dots spawn at each tile as actor moves
- **Properties:**
  - Character: `·` (middle dot)
  - Path color: Pale yellow
  - Movement color: Vivid cyan
  - Lifespan: 500ms (short-lived)
  - Static position (no movement)
- **Auto-cleanup**: Particles filter out after lifespan expires
- **Rendering**: Drawn after entities but only on empty tiles

**Technical Implementation:**
```typescript
type Particle = {
  x: number; y: number; char: string; rgb: Rgb;
  created_at: number; lifespan_ms: number;
};
// spawn_path_particles(), update_particles() functions
```

### 5.3 Range System for Actions
**Status:** PENDING  
**Implementation:**
- **Touch/Adjacent Range** (default for physical actions):
  - Same tile OR immediately adjacent (including diagonals)
  - Range: 0-1 tiles
  - Used for: Attacking, touching, picking up items
- **Inspect Range** (observation):
  - Range: 5 tiles
  - Used for: Examining entities, features, items from distance
- **Communication Range** (talking):
  - Range: Entire place (for now)
  - TODO: Add proximity-based communication (whisper/yell/normal)
    - Whisper: 1-2 tiles
    - Talk: 3-10 tiles  
    - Yell: 20+ tiles or entire place
    - Connect to senses system

**Range Visualization:**
- Highlight tiles within range when targeting
- Different colors for different range types
- Show range indicator on hover

### 5.4 NPC/Actor Free Movement (Rimworld-style)
**Status:** IN PROGRESS  
**Implementation:**

#### Core Philosophy
NPCs live autonomously during non-timed events, making decisions based on:
- **Personality & needs** (from NPC sheet)
- **Schedule & routines** (from schedule_manager)
- **Environmental context** (features, other NPCs, player actions)

**AI Decision Frequency:**
- **NOT called every frame** - uses efficient reassessment triggers
- Reassess only when: action completes, path blocked, interrupted, or goal expires
- Movement decisions use lightweight heuristics, not LLM
- LLM only for complex narrative responses (already existing system)

#### Movement State Tracking
Each NPC maintains persistent state:
```typescript
NPCMovementState {
  current_goal: Goal;           // What they're trying to do
  current_action: Action;       // What they're doing right now
  path: TilePosition[];         // Current path
  is_moving: boolean;           // Actively moving?
  last_reassess_time: number;   // When we last picked a new goal
}
```

**Goal Types:**
- `wander` - Random exploration (low priority)
- `patrol` - Guard routes, shopkeeper circuits
- `interact` - Go to feature and use it (sit, work, etc.)
- `social` - Move toward conversation/interesting activity
- `follow` - Follow target entity
- `flee` - Move away from threat (high priority)
- `rest` - Stand idle or sit

#### Action Logging System (NEW)
Every NPC maintains a **current activity log** in their sheet for AI narration:

```typescript
// Stored in npc.memory_sheet.current_activity
CurrentActivity {
  action_type: string;          // "walking", "sitting", "working", "talking"
  description: string;          // "Walking to the bar counter"
  target?: string;              // Feature, entity, or location
  started_at: string;           // ISO timestamp
  duration_ms?: number;         // How long action took
  completed_at?: string;        // When finished
  location: {                   // Where it happened
    place_id: string;
    tile: TilePosition;
  };
}

// Activity history (last 10 activities)
ActivityHistory: CurrentActivity[];
```

**Logged Activities:**
- Movement: "Walked from (5,3) to (8,7)" → "Standing near the fireplace"
- Interactions: "Sat on the wooden chair" → "Sitting by the window"
- Social: "Approached npc.gunther" → "Talking with Gunther"
- Schedule: "Started shift at the bar" → "Working behind the counter"

**Benefits:**
- AI can narrate what NPCs were doing when player arrives
- NPCs reference their own recent actions in conversation
- Creates sense of persistent, living world
- No LLM calls needed - simple string generation

#### Visualization
- Smooth tile-by-tile movement at 1 tile/second
- Particle trail showing path taken
- NPCs cycle through render priority with actors
- Activity status shown in hover tooltip: "Gunther - Sitting at table"

#### Collision & Coordination
- Cannot occupy same tile (queue or path around)
- If blocked: wait 2s → try alternate path → pick new goal
- Multiple NPCs: coordinate via path reservation system

#### Files to Create/Modify:
**New Files:**
- `src/npc_ai/movement_state.ts` - State management per NPC
- `src/npc_ai/goal_selector.ts` - Heuristic goal selection
- `src/npc_ai/movement_loop.ts` - Real-time update service
- `src/npc_ai/action_logger.ts` - Activity logging to NPC sheet
- `src/npc_ai/path_coordinator.ts` - Multi-NPC collision avoidance

**Modified Files:**
- `src/npc_ai/main.ts` - Integrate movement state
- `src/travel/movement.ts` - Add NPC pathfinding functions
- `src/mono_ui/modules/place_module.ts` - Render moving NPCs
- `src/npc_storage/store.ts` - Add activity log fields
- `src/types/npc.ts` - Add CurrentActivity types

### 5.5 Movement Constraints
**Status:** ✅ PARTIALLY COMPLETED  
**Implementation:**
- **Blocked Tiles**:
  - ✅ Tiles with entities (NPCs, actors)
  - ⏳ Tiles with solid features (walls, furniture) - TODO
  - ✅ Out-of-bounds tiles
- **Pathfinding**: ✅ BFS pathfinding around obstacles (8-directional)
- **Queue System**: If target tile occupied, can't move there
- **Place Boundaries**: Cannot move outside current place
  - Must use doors to exit
  - Place transitions load new place view

### 5.6 TODO List (Future Enhancements)
**Status:** BACKLOG  
- [ ] **Proximity Communication System**: Whisper/talk/yell with sense-based ranges
- [ ] **Sense-Based Ranges**: Connect inspect range to vision/hearing stats
- [ ] **Sprint Mode**: Faster movement at stamina cost
- [ ] **Stealth Movement**: Slower but quieter (hide particles?)
- [ ] **Group Movement**: Formations and following
- [ ] **Mount System**: Ride animals/vehicles for faster travel
- [ ] **Solid Features**: Block movement through walls/furniture
- [ ] **NPC Free Movement**: Autonomous NPC movement like Rimworld/Sims

---

## Phase 4: World Detail & Features

### 4.1 Items on Ground
**Status:** PENDING  
**Implementation:**
- Render items from `place.contents.items_on_ground`
- Simple representation: `*` for all items initially
- Position: on floor tiles
- Targetable for pickup/interaction

### 4.2 Features System
**Status:** PENDING  
**Implementation:**
- Render features from `place.contents.features`
- Features need tile positions assigned
- Different ASCII chars for different feature types:
  - Chairs: `π` or `h`
  - Tables: `T` or `□`
  - Chests: `©` or `c`
  - Doors: `D` or `=`
  - Walls: `│` `─` `┌` etc.

### 4.3 Interactive Objects
**Status:** PENDING  
**Implementation:**
- Features have interaction options
- Example: Chair → "sit", Chest → "open"
- Clicking feature shows available actions
- Effects modify actor state:
  - Position actor on same tile as feature
  - Set narrative state ("sitting", "searching")
  - Record last action

### 4.4 Feature Data Structure
**Status:** PENDING  
**Notes:**
- Features need use options with effects
- Narrative state tracking
- Position validation (can't place two solid features on same tile)
- Current place files are temporary - will regenerate

---

## Tileset System (Future)

### Character Rendering Standards
Different body types/sizes need different rendering:
- Small: `o` `*` `·`
- Medium: `n` `@` `&`
- Large: `N` `M` `W`

### Item Rendering Standards
- Default: `*` 
- Weapons: `/` `|` `-`
- Containers: `[]` `()` `{}`
- Valuables: `♦` `$` (if available in font, else `d` `$`)

### Feature Rendering Standards
- Furniture: `T` `h` `□`
- Doors: `=` `D` `>`
- Terrain: `.` `,` `:` `;`
- Obstacles: `#` `X` `█`

### Fallback Strategy
- Primary: Martian Mono
- Fallback: System monospace with similar metrics
- Character availability check at runtime
- Graceful degradation to simpler chars

---

## Technical Notes

### Coordinate System
- Place tiles: 0 to width-1, 0 to height-1 (inclusive)
- Screen coordinates: module-relative, bottom-left origin
- View offset: tile coordinate at bottom-left of viewport
- Valid entity positions: 1 to width-2, 1 to height-2 (inner area)

### Animation System (Future)
- Multi-frame ASCII animations
- Particle effects drawing outside bounds
- Time-based updates (not frame-based)
- Cleanup after animation completes

### Performance Considerations
- Spatial index for O(1) entity lookups
- Only render visible tiles
- Cycle animation every 500ms (2Hz)
- Debounce hover/target updates

---

## Current Blockers

None - Phase 5.1 and 5.2 are complete. Ready to continue with range system and NPC movement.

---

## Next Steps

### Immediate (Phase 5 Continued):
1. **5.3:** Implement range system (touch/adjacent/inspect/communication)
2. **5.4:** Add NPC free movement (Rimworld-style autonomous movement)
3. **5.5:** Add solid feature blocking (walls, furniture)
4. **Test:** Verify ranges show correctly, NPCs move autonomously

### Completed Phases:
- ✅ **Phase 1:** Border rendering, entity positioning, visual polish
- ✅ **Phase 2:** Right-click targeting, tile cycling, target selection
- ✅ **Phase 3:** Door rendering, door interaction, navigation
- ✅ **Phase 5.1-5.2:** Click-to-move, particle visualization, pathfinding
- ⏳ **Phase 4:** Items and features (deferred)
- 🔄 **Phase 5.3-5.5:** Range system, NPC movement, feature blocking (IN PROGRESS)

---

**Last Updated:** 2025-02-05  
**Next Review:** After Phase 5.3 (range system) completion

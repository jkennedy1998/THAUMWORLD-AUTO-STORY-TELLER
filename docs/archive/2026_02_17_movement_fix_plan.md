# Movement System Fix Plan - Reconstructed

**Date:** 2026-02-17  
**Status:** 🟡 PLANNING - Reconstruction  
**Priority:** Critical - Core User Experience  
**Type:** BUG FIX & ARCHITECTURE CLARIFICATION  

> **NOTE:** This plan was rewritten after discovering the original plan misunderstood the visualization problem. This version focuses on ensuring entities are visible at each intermediate tile WITHIN the ASCII grid, without fractional rendering.

---

## Problem Statement

**Current State:**
```
User clicks to move → Path appears → Footstep sounds play → Character NOT visible during movement → Character appears at destination
```

**Expected State:**
```
User clicks to move → Path appears → Footstep sounds play → Character visible at EACH tile along path → Arrives at destination
```

**What Changed:**
- Movement engine underwent refactoring (Phase 8: Unified Movement)
- Renderer was updated to pull positions from multiple sources
- **Result:** Entity positions are not being read/updated correctly during movement
- Entity IS moving (sounds/particles prove timing is right) but not being rendered

**Root Cause Hypothesis:**
The renderer is reading from cached/stale position data instead of the live place object that the movement engine is updating per-tile.

---

## Core Concept: Square-by-Square Movement (NO FRACTIONAL COORDINATES)

**FUNDAMENTAL RULE:** Characters move and render ONLY on integer tile coordinates. No fractional rendering, no off-grid positions.

### Visual Smoothness Through Timing, Not Interpolation

**How it works:**
1. Movement engine triggers every 200ms per tile (at default speed)
2. On each trigger, updates `place.npcs_present[i].tile_position` to the NEXT tile
3. Renderer reads current state every frame (60fps)
4. Entity appears at tile A for ~12 frames (200ms @ 60fps)
5. Movement engine updates: now at tile B
6. Entity appears at tile B for ~12 frames
7. Repeat until destination

**Result:** Each intermediate tile is clearly visible. Movement looks smooth because you see the character step through each square.

**THIS IS HOW IT USED TO WORK.**

```
Timeline (default 300 tiles/minute = 200ms per tile):
----------------------------------------------------------------------------------------
Time:    0ms        50ms      100ms     150ms     200ms     250ms     300ms
Frame:   0          3         6         9         12        15        18
Render:  ████████  ████████  ████████  ████████  ████████  ████████  ████████
         Tile A    Tile A    Tile A    Tile A    Tile B    Tile B    Tile B
         ^                                              ^
         |                                              |
    Engine updates                           Engine updates
    to Tile A                                to Tile B
```

**Visual smoothness comes from:**
- Each tile being visible for 12 frames (clearly seen)
- Transition effects at boundary (particles, footstep effects)
- Player perceives movement as "walking" through each square

**NOT from:**
- Fractional positions (entity between tiles)
- Off-grid rendering

---

## Why the Current System is Broken

### Analysis of Current Code Flow

**Movement Engine:** (src/shared/movement_engine.ts)
```typescript
// Engine ticks at 20Hz (every 50ms loop, moves every 200ms per tile)
function execute_step(entity_ref, state, place): void {
  const next_tile = state.path[state.path_index];
  
  // Updates place object DIRECTLY
  move_entity_to_tile(place, entity_ref, state.entity_type, next_tile);
  // This sets: npc.tile_position = next_tile (INTEGER TILE)
  
  state.path_index++;
  state.last_step_time = now;
}
```

**Renderer:** (src/mono_ui/modules/place_module.ts)
```typescript
// Renderer ticks at 60fps (every ~16.6ms)
function draw_place(canvas, place): void {
  for each frame:
    for each tile in viewport:
      entity = get_entity_at(tile_x, tile_y, place)
      // ❌ PROBLEM: This uses cached queries or stale data
      // instead of reading directly from place.npcs_present
```

**Broken Path:**
```
1. Engine: place.npcs_present[i].tile_position = (6,5)  // Step 1
   ↓ (16ms passes, 1 frame rendered)
2. Renderer: get_entity_at(6,5) reads... cached position? Stale data?
   ↓
3. Entity NOT found at (6,5) - returns null
   ↓
4. Renderer draws: "·" (floor) instead of entity character
   ↓
5. Entity invisible even though it's in the place object at correct position
```

### The Bug Location: `get_entity_at()`

Looking at place_module.ts:
```typescript
function get_entity_at(tx, ty, place): PlaceNPC | PlaceActor | null {
  const entities = get_all_entities_at(tx, ty, place);
  
  if (entities.length === 0) return null;
  
  if (entities.length === 1) return entities[0];
  
  // Cycling logic for multiple entities
  // ... returns entities[cycle.current_index]
}

function get_all_entities_at(tx, ty, place): (PlaceNPC | PlaceActor)[] {
  const entities: (PlaceNPC | PlaceActor)[] = [];
  
  // READING FROM PLACE OBJECT DIRECTLY - This should work!
  const npcs = place.contents.npcs_present.filter(
    (n) => n.tile_position.x === tile_x && n.tile_position.y === tile_y
  );
  entities.push(...npcs);
  
  const actors = place.contents.actors_present.filter(
    (a) => a.tile_position.x === tile_x && a.tile_position.y === tile_y
  );
  entities.push(...actors);
  
  return entities;
}
```

**This should work!** The renderer IS reading directly from the place object.

**What's preventing it from working?** Options:

**Option A:** Place object reference is not the same between engine and renderer
- Renderer has a cached/stale copy of place object
- Engine updates its copy, renderer reads different copy

**Option B:** Movement state tracking interferes
- Renderer uses `previous_positions` and `current_positions` to detect movement
- These caches might be used instead of live position

**Option C:** Timing issue - render happens between engine updates
- Engine updates position to (6,5) at t=200ms
- Renderer reads at t=210ms, but something resets or interferes

**Option D:** z-index/weight issues - entity IS rendered but hidden
- Path particles (yellow dots) might render ON TOP of entity
- Or weight system causing entity to be invisible

### Hypothesis: Option A (Stale Place Object)

Looking at `movement_command_handler.ts`:

```typescript
// Track NPC actual positions (persisted between movements to prevent snap-back)
const npc_actual_positions = new Map<string, TilePosition>();

export function get_entity_position(entity_ref: string): TilePosition | null {
  // Prefer renderer-tracked positions (most up-to-date)
  const tracked = npc_actual_positions.get(entity_ref);
  if (tracked) return tracked;

  if (entity_ref.startsWith("npc.")) {
    const npc = current_place.contents.npcs_present.find(...);
    return npc?.tile_position ?? null;  // Could return stale data
  }
}
```

**AHA! This is the problem.** The renderer cache (`npc_actual_positions`) is taking precedence over the live place object.

When movement engine updates `place.npcs_present[i].tile_position`, the renderer doesn't see it because it's returning cached positions.

The cache is used to prevent snap-back when place object reloads from disk, but it's interfering with real-time movement visualization.

---

## Correct Solution: Fix Renderer to Use Live Place Object During Movement

**RULING:** No fractional coordinates. No off-grid rendering. Fix the cache problem.

### Solution Architecture

```
Movement Engine (20Hz updates)
    ↓
place.npcs_present[i].tile_position = (6,5)  // INTEGER TILE
    ↓
Renderer (60fps) reads directly from place object
    ↓
Renders entity at integer tile (6,5)
```

**Key Requirements:**

1. **During movement:** Renderer must read from LIVE place object, not cached positions
2. **On completion:** Position saved to character sheet (persistence)
3. **On place reload:** Character sheet position used to initialize (prevent snap-back)
4. **Visual feedback:** Add particles/effects to make movement clear
5. **Timing:** Ensure each tile is visible for enough frames

---

## Implementation Plan

### Phase 1: Fix Position Reading in Renderer

**Goal:** Eliminate stale position caches during movement visualization.

**Files:** `src/mono_ui/modules/movement_command_handler.ts`, `src/mono_ui/modules/place_module.ts`

**Steps:**

**1.1 Identify position cache**:
```typescript
// In movement_command_handler.ts (line 39-39)
const npc_actual_positions = new Map<string, TilePosition>();

// And get_entity_position() (line 55-72) prioritizes cached over live
```

**1.2 Create "during movement" flag**:
```typescript
// Add to movement_engine.ts

function is_entity_moving(entity_ref: string): boolean {
  const state = movement_states.get(entity_ref);
  return state?.is_moving ?? false;
}

export function is_entity_moving(entity_ref: string): boolean {
  return movement_states.has(entity_ref) && movement_states.get(entity_ref)!.is_moving;
}
```

**1.3 Update renderer to use live positions during movement**:
```typescript
// In movement_command_handler.ts

export function get_entity_position(
  entity_ref: string,
  place: Place
): TilePosition | null {
  // CRITICAL FIX: During movement, read from live place object
  // NOT from cache - cache causes visualization bugs
  
  if (is_entity_moving(entity_ref)) {
    // Entity is moving - read from live place object
    if (entity_ref.startsWith("npc.")) {
      const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
      if (npc) {
        const live_pos = npc.tile_position;
        // Optional: Update cache to match live position
        npc_actual_positions.set(entity_ref, { ...live_pos });
        return live_pos;
      }
    } else if (entity_ref.startsWith("actor.")) {
      const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
      if (actor) {
        const live_pos = actor.tile_position;
        npc_actual_positions.set(entity_ref, { ...live_pos });
        return live_pos;
      }
    }
  }
  
  // Not moving - safe to use cached position
  const cached = npc_actual_positions.get(entity_ref);
  if (cached) return cached;
  
  // Fallback: read from place
  if (entity_ref.startsWith("npc.")) {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    return npc?.tile_position ?? null;
  } else {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    return actor?.tile_position ?? null;
  }
}
```

**1.4 Update place_module to use live positions**:
```typescript
// In place_module.ts

// Verify get_all_entities_at() uses live position
function get_all_entities_at(
  tile_x: number,
  tile_y: number,
  place: Place
): (PlaceNPC | PlaceActor)[] {
  const entities: (PlaceNPC | PlaceActor)[] = [];
  
  // Use live positions directly from place object
  // DO NOT use cached positions here
  
  const npcs = place.contents.npcs_present.filter(n =>
    n.tile_position.x === tile_x && n.tile_position.y === tile_y
  );
  entities.push(...npcs);
  
  const actors = place.contents.actors_present.filter(a =>
    a.tile_position.x === tile_x && a.tile_position.y === tile_y
  );
  entities.push(...actors);
  
  return entities;
}
```

**Test:** After this change, entities should become visible during movement.

---

### Phase 2: Verify Movement Updates Place Object

**Goal:** Confirm movement engine is actually updating positions per-tile.

**Files:** `src/shared/movement_engine.ts`

**Steps:**

**2.1 Add debug logging**:
```typescript
// In movement_engine.ts - move_entity_to_tile()

function move_entity_to_tile(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc",
  tile: TilePosition
): boolean {
  log("move_entity_to_tile", entity_ref, "to", tile, "type", entity_type);
  
  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (!actor) {
      log("  ❌ Actor not found!");
      return false;
    }
    
    actor.tile_position = tile;  // Atomic update
    actor.status = "moving";
    log("  ✅ Actor moved to", tile);
    return true;
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (!npc) {
      log("  ❌ NPC not found!");
      return false;
    }
    
    npc.tile_position = tile;  // Atomic update
    npc.status = "moving";
    log("  ✅ NPC moved to", tile);
    return true;
  }
}
```

**2.2 Test with debug enabled**:
- Start movement
- Check logs show position updates per-tile
- Verify renderer reads updated positions

---

### Phase 3: Enhance Visual Feedback

**Goal:** Make movement obvious even if timing is perfect.

**Files:** `src/mono_ui/modules/place_module.ts`

**Steps:**

**3.1 Increase particle visibility**:
```typescript
// In place_module.ts - spawn_path_particles()

function spawn_path_particles(path: TilePosition[]): void {
  const now = Date.now();
  const path_rgb = get_color_by_name("bright_yellow").rgb;  // More visible
  
  for (const pos of path) {
    particles.push({
      x: pos.x,
      y: pos.y,
      char: "·",           // Use · for path
      rgb: path_rgb,
      created_at: now,
      lifespan_ms: 1200,   // Last 1.2 seconds (6 tiles worth)
      weight: 5            // Middle weight - visible but doesn't block entity
    });
  }
  log("Path particles spawned:", path.length, "tiles");
}

function spawn_movement_particle(pos: TilePosition): void {
  const now = Date.now();
  const move_rgb = get_color_by_name("bright_cyan").rgb;
  
  particles.push({
    x: pos.x,
    y: pos.y,
    char: "·",
    rgb: move_rgb,
    created_at: now,
    lifespan_ms: 800,  // Shorter - shows current pos
    weight: 9          // Highest weight - on top
  });
}
```

**3.2 Add movement indicator on entity**:
```typescript
// In draw_place() - after drawing entity

function draw_movement_indicator(
  canvas: Canvas,
  screen_x: number,
  screen_y: number,
  entity: PlaceNPC | PlaceActor
): void {
  const moving = is_entity_moving('npc_ref' in entity ? entity.npc_ref : entity.actor_ref);
  
  if (moving) {
    // Small indicator that entity is moving (lighter color, or sub-char)
    const cell = canvas.get(screen_x, screen_y);
    if (cell) {
      // Make character slightly brighter or add marker
      canvas.set(screen_x, screen_y, {
        ...cell,
        weight_index: 8,  // Bold
        style: "bold"
      });
    }
  }
}
```

**3.3 Ensure particles render BELOW entities**:
```typescript
// In draw_place() - render particles BEFORE entities

// 1. Draw floor and static features
// 2. Draw path particles (weight 4-5)
// 3. Draw entities (weight 6-8)  ← Entities on top!
// 4. Draw effects (weight 7-9)    ← Effects on very top
```

---

### Phase 4: Fix Timing & Frame Duration

**Goal:** Ensure each tile is visible for enough frames.

**Problem:** If movement is too fast, tiles blur together
**Solution:** Tune speeds or add "hold time" at each tile

**Files:** `src/shared/movement_engine.ts`, `src/mono_ui/modules/place_module.ts`

**4.1 Verify 200ms per tile is sufficient**:
```typescript
// At 60fps, 200ms = 12 frames per tile
// That's plenty visible - should be very clear

// If still too fast, adjust speed in place_module.ts when starting movement
const started = start_entity_movement(
  actor.actor_ref,
  "actor",
  place,
  { type: "move_to", target_position: { x: tile.x, y: tile.y }, priority: 10 },
  Math.min(300, speed_tpm),  // Cap at 300 tpm minimum (200ms per tile)
  // ...
);
```

**4.2 Add frame-by-frame tracing**:
```typescript
// In place_module.ts - Frame logging for debugging

// At top of draw_place()
const frame_id = (frame_counter++).toString().padStart(6, "0");
log(`[FRAME ${frame_id}] Rendering place`, place.id);

// In entity rendering loop
if (entity) {
  const entity_ref = 'npc_ref' in entity ? entity.npc_ref : entity.actor_ref;
  const pos = 'npc_ref' in entity ? entity.tile_position : entity.tile_position;
  log(`[FRAME ${frame_id}] Rendering ${entity_ref} at tile (${pos.x},${pos.y}) at screen (${screen_x},${screen_y})`);
}
```

**Test:** Run with debug logging to see if entity renders at each intermediate tile.

---

### Phase 5: Verify and Validate

**Test each scenario :

**5.1 Single entity movement:**
```
- Start: Character at (5,5), visible
- Click: Move to (10,5)
- Expected:
  * Path particles appear (yellow dots: 6,5 7,5 8,5 9,5 10,5)
  * Character visible at (5,5) for ~12 frames
  * Character visible at (6,5) for ~12 frames
  * Character visible at (7,5) for ~12 frames
  * ... continues step-by-step ...
  * Character visible at (10,5)
  * Footstep sound plays on tiles 6,5 then 9,5 (every 3 tiles)
RESULT: Character clearly visible at each tile, no disappearing
```

**5.2 Multiple entity movement:**
```
- Start: 3 NPCs different locations
- All begin wandering
- Expected: All 3 visible moving step-by-step
RESULT: No conflicts, no entity hiding, all visible
```

**5.3 Movement during fast action:**
```
- Start: Player moving
- During movement: Click another tile (change destination)
- Click: Target entity for conversation
- Expected: Clear visibility through all interactions
RESULT: No flickering or disappearing
```

**5.4 Place transition:**
```
- Player moves to door (3 tiles)
- Expected: See player walk to door step-by-step
- Enter new place
- Expected: Player at entry position
RESULT: Smooth transition, correct position
```

---

## Acceptance Criteria

### Primary (Critical)
- [ ] When clicking to move, character is **visible at every intermediate tile**
- [ ] Character does **not disappear** during movement
- [ ] Footstep sounds and timing are correct (as they are now)
- [ ] Path particles are clearly visible
- [ ] Movement looks smooth and purposeful

### Secondary (Quality)
- [ ] Multiple entities moving simultaneously all visible
- [ ] Place transitions show movement to door/exit
- [ ] Targeting/clicking during movement shows correct positions
- [ ] Debug logging confirms entity renders at each tile

### Tertiary (Performance)
- [ ] No frame rate drops during movement
- [ ] Update loop remains efficient
- [ ] Rendering loop confident of entity positions

---

## Implementation Order

**IMPLEMENT IN THIS ORDER:**

### Step 1 (10 mins): Diagnostic Logging
- Add logging to `move_entity_to_tile()` to confirm positions update
- Add logging to `get_all_entities_at()` to confirm it reads current positions
- Add frame-by-frame logging in `draw_place()` to see what's rendered

**Expected:** Logs should show position updates AND entity rendering at each position.

### Step 2 (30 mins): Fix Position Reading
- Modify `get_entity_position()` to use live place object during movement
- Remove any caching that interferes with real-time visualization
- Test: Entity should become visible during movement

### Step 3 (20 mins): Enhance Visual Feedback
- Increase particle lifespan/visibility
- Ensure particles render below entities
- Add movement indicator to entity character

### Step 4 (15 mins): Test & Tune
- Run through test scenarios
- Verify each intermediate tile visible
- Tune if needed

**Total Estimated Time: 75-90 minutes**

---

## Key Files to Modify

**Core Movement:**
- `src/shared/movement_engine.ts` - Add `is_entity_moving()` helper

**Renderer:**
- `src/mono_ui/modules/movement_command_handler.ts` - Fix position reading
- `src/mono_ui/modules/place_module.ts` - Enhance visual feedback

*(DO NOT MODIFY: Position update logic is already correct)*

---

## What NOT to Do

❌ **DO NOT add fractional coordinate rendering** - This is NOT the problem  
❌ **DO NOT interpolate positions** - Characters should be ON integer tiles  
❌ **DO NOT change movement timing** - 200ms per tile is already good  
❌ **DO NOT add state machines for smooth interpolation** - Not needed  

---

## What the Original Working System Probably Did

Looking at the code, it's close to working. The issue is likely:

1. Movement engine updates `place.npcs_present[i].tile_position` correctly
2. Renderer reads from `place.contents.npcs_present` in `get_all_entities_at()`
3. BUT: Something is using `npc_actual_positions` Map which has stale data
4. Result: Entity position is updated in place object but renderer reads stale cache

**Fix:** Make renderer read live place positions during movement visualization.

---

## Test Verification Steps

**Before fix:**
```
> Start movement
> Frame 0: Entity at (5,5) ✓
> Frame 1-11: Entity not found ↯ (BUG)
> Frame 12-23: Entity not found ↯ (BUG)
> Frame 24-35: Entity not found ↯ (BUG)
> Frame 36: Entity at (10,5) ✓
Result: Entity invisible during movement
```

**After fix:**
```
> Start movement
> Frame 0-11: Entity at (5,5) ✓
> Frame 12-23: Entity at (6,5) ✓
> Frame 24-35: Entity at (7,5) ✓
> Frame 36-47: Entity at (8,5) ✓
> Frame 48-59: Entity at (9,5) ✓
> Frame 60+: Entity at (10,5) ✓
Result: Entity visible at each tile step-by-step
```

---

## Summary

**Problem:** Entities not visible during movement even though position data is correct

**Root Cause:** Renderer reading stale cached positions instead of live place object during movement

**Solution:** Fix renderer to read from live place object during movement animation

**Result:** Entities become visible at each intermediate tile (square-by-square movement)

**No fractional coordinates needed. No off-grid rendering. Just fix the cache to use live data.**

---

**Next Step:** Begin Phase 1 - Add diagnostic logging to confirm position updates

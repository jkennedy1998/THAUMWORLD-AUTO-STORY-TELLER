# Movement System Unification Plan

**Date:** 2026-02-17  
**Status:** 🟡 PLANNING - Not yet implemented  
**Priority:** High - Core User Experience  
**File:** `docs/plans/2026_02_17_movement_system_unification.md`

> **NOTE:** This plan addresses the fragmented movement system and implements smooth visual movement for all entities.

---

## Overview

The current movement system has **multiple sources of truth** for entity positions and renders entities at discrete tile positions only. This results in players seeing characters "teleport" between tiles rather than moving smoothly across them.

### Current Architecture Problem

```
Multiple Position Sources:
├─ Renderer cache (npc_actual_positions Map) - Prevents snap-back
├─ Place object (npc.tile_position) - Updated every 200ms by engine
├─ Movement engine state (movement_states Map) - Has interpolation but unused
└─ Disk storage (JSON files) - Updated only on completion

Rendering Path:
Place Module → Reads place.npcs_present[].tile_position (integer)
              → Never uses get_interpolated_position()
              → Characters teleport between tiles
```

### Target Architecture

```
Single Source of Truth:
NPC/Character Sheets (disk) ←→ Place System (runtime) ←→ Movement Engine (interpolation)
                                    ↓
                              Renderer uses interpolated positions
                                    ↓
                            Smooth visual movement (sub-tile)
```

---

## Core Concepts

### 1. Single Source of Truth
**Definition:** Entity positions are authoritatively stored in their character sheets (NPC/actor storage), not duplicated across systems.

**Implementation:**
- All position reads go through `movement_engine.ts` API
- **CRITICAL DISTINCTION:** Two separate position APIs:
  - `get_gameplay_position(entity_ref, place)`: Returns integer tile position for ALL gameplay calculations (range, AoE, targeting)
  - `get_visual_position(entity_ref)`: Returns interpolated fractional position for rendering only
- Position writes go to character sheets first, then propagate to place system
- Movement engine becomes the sole authority for runtime positions

**TABLETOP RPG RULES:**
- Gameplay position is ALWAYS integer tiles, even during movement
- Visual position is interpolated for smooth animation ONLY
- Never use interpolated positions for gameplay logic (attacks, range, AoE, etc.)
- During movement between Tile A → Tile B, entity is considered at Tile A for gameplay purposes until the step completes

### 2. Smooth Visual Interpolation
**Definition:** Entities render at fractional tile positions between steps

**Implementation:**
- Renderer queries `get_interpolated_position()` every frame (60fps)
- Interpolation based on time elapsed since last step
- Sub-tile positioning creates smooth movement animation
- Integer tile positions still used for collision/pathfinding

### 3. Unified Movement Pipeline
**Definition:** Actors and NPCs share identical movement infrastructure

**Current State:** Already unified at engine level, but rendering differentiates

**Implementation:**
- Renderer treats actors and NPCs identically for position queries
- Both use same interpolation logic
- Both trigger same visual effects (footsteps, particles)
- No special cases in rendering path

---

## Goals

- [ ] Players see characters move smoothly between tiles, not teleport
- [ ] Single authoritative source for entity positions (character sheets)
- [ ] All existing features preserved: footstep broadcasts, movement sounds, path visualization
- [ ] No breaking changes to action pipeline or NPC AI systems
- [ ] Updated documentation reflects actual implementation
- [ ] Consistent behavior for actors and NPCs

---

## Scope

### In-Scope
- Movement engine refinement to become single source of truth
- Place module renderer updated to use interpolated positions
- Position persistence to character sheets on movement completion
- Documentation updates for all movement-related systems
- Testing to verify all movement features still work

### Out-of-Scope
- Changes to pathfinding algorithm (A* implementation remains)
- Changes to movement speeds or timing mechanics
- Changes to witness/perception systems
- Changes to conversation interruption logic
- New visual effects beyond smooth movement

---

## Current Problems

### 1. Fragmented Position Storage
**Problem:** Position data exists in 4 places simultaneously
- **Impact:** Race conditions, snap-back on place reload, inconsistent state
- **Root Cause:** Place system reloads from disk, overwriting runtime positions

### 2. Renderer Ignores Interpolation
**Problem:** `get_interpolated_position()` exists but place module never calls it
- **Impact:** Players see discrete jumps instead of smooth movement
- **Root Cause:** Place module written before interpolation was added to engine

### 3. Position Persistence Gaps
**Problem:** NPC positions only saved on movement completion, not during
- **Impact:** If game crashes/reloads during movement, position is wrong
- **Root Cause:** Save only happens in `on_complete` callback

### 4. Documentation Mismatch
**Problem:** Some docs describe old movement systems that no longer exist
- **Impact:** Developer confusion, incorrect assumptions
- **Root Cause:** Phase 8 (Unified Movement) refactored without doc updates

---

## Technical Approach

### Phase 1: Make Movement Engine Single Source of Truth

**1.1 Position Query API**
```typescript
// Current: Renderer reads place.npcs_present[i].tile_position directly
// New: All reads go through movement engine

export function get_entity_position(
  entity_ref: string, 
  place: Place
): TilePosition {
  // During movement: return interpolated position
  const moving = get_movement_state(entity_ref);
  if (moving?.is_moving) {
    return get_interpolated_position(entity_ref) || moving.path[moving.path_index];
  }
  
  // Not moving: read from place (which loads from disk)
  return get_entity_position_from_place(place, entity_ref);
}
```

**1.2 Position Write API**
```typescript
// Current: Engine writes directly to place object
// New: Write to character sheet first, then update place

function persist_position_to_sheet(
  entity_ref: string, 
  position: TilePosition
): void {
  if (entity_ref.startsWith('npc.')) {
    save_npc_position(entity_ref, position);
  } else {
    save_actor_position(entity_ref, position);
  }
}
```

**1.3 Initialize from Sheets**
```typescript
// On place load, initialize NPC positions from their sheets, not place data

function initialize_place_entities(place: Place): void {
  for (const npc of place.contents.npcs_present) {
    const sheet_position = load_npc_position(npc.npc_ref);
    if (sheet_position) {
      npc.tile_position = sheet_position;
    }
  }
}
```

### Phase 2: Update Renderer for Interpolated Positions

**2.1 Place Module Changes**
```typescript
// In place_module.ts draw_place() function:

// CURRENT CODE (line ~758-777):
const entity = get_entity_at(tx, ty, place);
if (entity) {
  const is_npc = "npc_ref" in entity;
  const name = is_npc ? entity.npc_ref.split(".").pop() : entity.actor_ref.split(".").pop();
  canvas.set(screen_x, screen_y, {
    char: get_initial(name),
    rgb: is_npc ? npc_rgb : actor_rgb,
    weight_index: 6,
  });
}

// NEW CODE:
const interpolated_pos = get_interpolated_position(entity_ref);
const render_x = interpolated_pos ? interpolated_pos.x : entity.tile_position.x;
const render_y = interpolated_pos ? interpolated_pos.y : entity.tile_position.y;

// Convert world coordinates to screen (handles fractional positions)
const screen_x = inner.x0 + ((render_x - view.offset_x) / view.scale);
const screen_y = inner.y0 + ((render_y - view.offset_y) / view.scale);

// Render at fractional screen position (requires sub-tile rendering support)
render_entity_at_fractional_position(canvas, screen_x, screen_y, entity);
```

**2.2 Sub-Tile Rendering**
```typescript
// New helper function for sub-tile rendering

function render_entity_at_fractional_position(
  canvas: Canvas,
  screen_x: number,  // Can be fractional (e.g., 15.3)
  screen_y: number,  // Can be fractional (e.g., 8.7)
  entity: PlaceNPC | PlaceActor
): void {
  const base_x = Math.floor(screen_x);
  const base_y = Math.floor(screen_y);
  const frac_x = screen_x - base_x;
  const frac_y = screen_y - base_y;
  
  // For ASCII/terminal rendering: use character weight or color blending
  // to hint at sub-tile position (implementation depends on canvas capabilities)
  const weight = calculate_subtile_weight(frac_x, frac_y);
  
  canvas.set(base_x, base_y, {
    char: get_entity_char(entity),
    rgb: get_entity_color(entity),
    weight_index: weight,
  });
}
```

### Phase 3: Maintain Feature Compatibility

**3.1 Footstep Broadcasts**
- Currently triggered in `place_module.ts:638-644` and `:677-683`
- These trigger on discrete tile changes
- **Keep this behavior**: broadcasts happen per tile, not per frame
- No changes needed - already uses discrete position checks

**3.2 Movement Sound Effects**
- Currently triggered in `on_step` callback (movement_engine.ts:453-454)
- Sound plays at tile transition points
- **Keep this behavior**: sounds trigger at step boundaries
- No changes needed

**3.3 Path Visualization**
- Path particles currently rendered from `get_entity_path()`
- Interpolation is visual-only; path remains same
- **Keep this behavior**: particles show planned path
- No changes needed

**3.4 Witness/Perception**
- Currently triggers every 3 steps (movement_engine.ts:407-409)
- Based on discrete step count, not interpolation
- **Keep this behavior**: perception events at tile boundaries
- No changes needed

### Phase 4: Documentation Updates

**4.1 Update Core Documentation**
- Update `movement_engine.ts` header comment to reflect single source of truth
- Document new query API (`get_entity_position`)
- Document position persistence flow
- Update `movement_commands.ts` docs if needed

**4.2 Update Place System Guide**
- Update `2026_02_03_place_system_visual_guide.md`
- Document interpolated rendering
- Document that place reload doesn't overwrite runtime positions

**4.3 Add Movement System Architecture Doc**
- New document: `movement_system_architecture.md`
- Explain single source of truth pattern
- Show flow: Sheet → Place → Engine → Renderer
- Document all APIs and their responsibilities

---

## Additional Tabletop RPG Rules & Implementation Details

### Rule 1: Gameplay vs Visual Position - THE MOST IMPORTANT RULE

**DEFINITION:** There are TWO positions for each entity:
- **GAMEPLAY POSITION:** Integer tile coordinates for all gameplay logic (attacks, range, AoE, targeting, opportunity attacks)
- **VISUAL POSITION:** Interpolated fractional coordinates for rendering only

**CRITICAL - NEVER MIX THESE:**

```typescript
// ❌ WRONG - Never use visual/interpolated positions for gameplay
const range = calculate_distance(
  get_visual_position(attacker), 
  get_visual_position(target)  // Fractional positions - WRONG!
);
if (range <= 1) { /* melee attack */ }  // Might be wrong due to interpolation!

// ✅ CORRECT - Always use integer gameplay positions
const range = calculate_distance(
  get_gameplay_position(attacker, place),
  get_gameplay_position(target, place)  // Integer tiles - CORRECT!
);
if (range <= 1) { /* melee attack */ }  // Accurate!
```

**WHEN TO USE EACH:**

| Use Case | Function | Returns | Use For |
|----------|----------|---------|---------|
| Gameplay: attacks, range, AoE, cover, LoS | `get_gameplay_position(entity_ref, place)` | Integer `{x: 5, y: 5}` | ALL gameplay logic |
| Visual: rendering, animations | `get_visual_position(entity_ref)` | Fractional `{x: 5.6, y: 5.0}` | Rendering ONLY |

**IMPLEMENTATION:**

```typescript
// In movement_engine.ts

/**
 * Get position for GAMEPLAY calculations (ALWAYS integer tiles)
 * RULE: During movement, entity occupies the tile it's moving FROM
 * 
 * @param entity_ref - Entity reference (npc. or actor.)
 * @param place - Current place (needed to access place object for stationary entities)
 * @returns Integer tile position for gameplay logic
 * 
 * USE THIS FOR: attacks, range checks, AoE, targeting, opportunity attacks, cover, LoS
 * NEVER USE FOR: rendering, visual effects
 */
export function get_gameplay_position(
  entity_ref: string,
  place: Place
): TilePosition {
  // Check if entity is moving
  const moving_state = movement_states.get(entity_ref);
  
  if (moving_state?.is_moving) {
    // TABLETOP RPG RULE: During movement, entity is at FROM tile
    // Path index has already advanced, so use previous index
    const current_step_idx = Math.max(0, moving_state.path_index - 1);
    const gameplay_tile = moving_state.path[current_step_idx];
    
    if (gameplay_tile) {
      return { x: Math.round(gameplay_tile.x), y: Math.round(gameplay_tile.y) };
    }
  }
  
  // Not moving, or state missing - use position from place
  return get_entity_position_from_place(place, entity_ref);
}

/**
 * Get position for VISUAL RENDERING (can be fractional)
 * 
 * @param entity_ref - Entity reference (npc. or actor.)
 * @returns Interpolated fractional position, or null if not moving
 * 
 * USE THIS FOR: rendering, visual effects, animations
 * NEVER USE FOR: gameplay logic, attacks, range, AoE, targeting
 */
export function get_visual_position(entity_ref: string): TilePosition | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.is_moving) {
    return null;  // Not moving, renderer should use gameplay position from place
  }
  
  return get_interpolated_position(entity_ref);
}

// Helper: internal function to get raw interpolated position
function get_interpolated_position(entity_ref: string): TilePosition | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.is_moving) return null;
  
  const now = Date.now();
  const time_since_last = now - state.last_step_time;
  const progress = Math.min(time_since_last / state.ms_per_tile, 1);
  
  // Path index has already advanced, so current is path_index-1
  const current_idx = Math.max(0, state.path_index - 1);
  const next_idx = state.path_index;
  
  if (current_idx >= state.path.length || next_idx >= state.path.length) {
    return null;
  }
  
  const current = state.path[current_idx];
  const next = state.path[next_idx];
  
  if (!current || !next) return null;
  
  // Interpolate between tiles
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
  };
}
```

### Rule 2: Targeting and Action Range During Movement

**SCENARIO:** Player clicks on an entity during its movement to attack/cast a spell.

**TABLETOP RPG RULE:**
- Targeting uses **GAMEPLAY POSITION** (integer tile)
- Visual position is irrelevant for gameplay
- If entity is moving from A→B, you target it at tile A until movement completes

**IMPLEMENTATION:**

```typescript
// In place_module.ts - when finding entity at a clicked tile

function get_targetable_entity_at(
  tile_x: number,
  tile_y: number,
  place: Place
): PlaceNPC | PlaceActor | null {
  // Use GAMEPLAY POSITIONS for targeting, not visual positions
  
  const npcs = place.contents.npcs_present.filter(npc => {
    const gameplayPos = get_gameplay_position(npc.npc_ref, place);
    return gameplayPos.x === tile_x && gameplayPos.y === tile_y;
  });
  
  if (npcs.length > 0) return npcs[0];
  
  const actors = place.contents.actors_present.filter(actor => {
    const gameplayPos = get_gameplay_position(actor.actor_ref, place);
    return gameplayPos.x === tile_x && gameplayPos.y === tile_y;
  });
  
  if (actors.length > 0) return actors[0];
  
  return null;
}

// When calculating range for action (action_range/range_calculator.ts)
function calculate_range(attacker_ref, target_ref, place) {
  const attackerPos = get_gameplay_position(attacker_ref, place);
  const targetPos = get_gameplay_position(target_ref, place);
  
  // Use actual distances, not interpolated
  const distance = Math.sqrt(
    Math.pow(attackerPos.x - targetPos.x, 2) + 
    Math.pow(attackerPos.y - targetPos.y, 2)
  );
  
  return distance;  // Integer positions = clear range calculation
}
```

**EXAMPLE:**
```
1. NPC at (5,5) moves to (6,5) - movement in progress
2. Player at (5,6) clicks to attack NPC
3. NPC's visual position: (5.6, 5.0)
4. NPC's gameplay position: (5,5) [FROM tile rule]
5. Distance calculation: |5-5| + |6-5| = 1 tile
6. Melee attack (range 1): VALID - NPC is adjacent
```

### Rule 3: Movement Interruption (Conversation, Combat, etc.)

**SCENARIO:** NPC is moving when player initiates conversation or enters combat.

**TABLETOP RPG RULE:**
- Interrupted movement snaps to the tile entity was moving **FROM**
- You cannot "interrupt" to catch them mid-step in a different position
- This maintains discrete, unambiguous positioning

**IMPLEMENTATION:**

```typescript
// In movement_engine.ts

export function stop_entity_movement(entity_ref: string): void {
  const state = movement_states.get(entity_ref);
  if (!state) return;
  
  // TABLETOP RPG RULE: If interrupted, snap to FROM tile
  if (state.is_moving && state.path_index > 0) {
    const from_tile = state.path[state.path_index - 1];  // Tile we were moving FROM
    const place = find_entity_place(entity_ref);
    
    if (place && from_tile) {
      move_entity_to_tile(place, entity_ref, state.entity_type, from_tile);
      persist_position_to_sheet(entity_ref, from_tile);
      
      // Call completion callback with FROM tile
      if (state.on_complete) {
        state.on_complete(from_tile);
      }
      
      log("Movement interrupted", entity_ref, "snapped to", from_tile);
    }
  }
  
  state.is_moving = false;
  state.show_path = false;
  movement_states.delete(entity_ref);
}
```

**EXAMPLE:**
```
1. NPC moving from (5,5) → (6,5) → (7,5)
2. Currently at step 1: visual (5.6,5.0), gameplay (5,5)
3. Player talks to NPC (interruption)
4. NPC stops at (5,5) [FROM tile]
5. Next move would have been to (6,5), but conversation starts
6. Position is unambiguous: (5,5)
```

### Rule 4: Place Reload During Movement

**PROBLEM:** Place data reloads from disk can overwrite runtime positions if NPCs are moving.

**TABLETOP RPG IMPACT:**
- Would cause "snap-back" - NPCs jump to old positions
- Breaks immersion and trust
- Players see teleporting/jitter

**STRONG SOLUTION:**

```typescript
// In movement_command_handler.ts - set_command_handler_place()

export function set_command_handler_place(place: Place): void {
  current_place = place;
  
  // TABLETOP RPG RULE: Preserve runtime positions during movement
  // Place reload should NOT overwrite characters mid-movement
  
  for (const npc of place.contents.npcs_present) {
    const movement_state = get_movement_state(npc.npc_ref);
    
    if (movement_state?.is_moving) {
      // NPC is moving - use our tracked runtime position
      const trackedPos = npc_actual_positions.get(npc.npc_ref);
      if (trackedPos) {
        // Override place position with runtime position
        npc.tile_position = { ...trackedPos };
        log("Place reload: Preserved runtime position for moving NPC", npc.npc_ref);
      }
    } else {
      // NPC not moving - verify position matches sheet
      const sheetPos = load_npc_position(npc.npc_ref);
      if (sheetPos && (sheetPos.x !== npc.tile_position.x || sheetPos.y !== npc.tile_position.y)) {
        // Sheet has different position - this is a bug or out-of-order save
        log("WARNING: Sheet position differs from place for stationary NPC", npc.npc_ref);
        // Still trust sheet as authoritative for non-moving NPCs
        npc.tile_position = { ...sheetPos };
      }
      // Update tracker to match
      npc_actual_positions.set(npc.npc_ref, { ...npc.tile_position });
    }
  }
  
  // Same logic for actors
  for (const actor of place.contents.actors_present) {
    const movement_state = get_movement_state(actor.actor_ref);
    
    if (movement_state?.is_moving) {
      const trackedPos = npc_actual_positions.get(actor.actor_ref);
      if (trackedPos) {
        actor.tile_position = { ...trackedPos };
      }
    } else {
      const sheetPos = load_actor_position(actor.actor_ref);
      if (sheetPos && (sheetPos.x !== actor.tile_position.x || sheetPos.y !== actor.tile_position.y)) {
        log("WARNING: Sheet position differs from place for stationary actor", actor.actor_ref);
        actor.tile_position = { ...sheetPos };
      }
      npc_actual_positions.set(actor.actor_ref, { ...actor.tile_position });
    }
  }
}
```

### Rule 5: Opportunity Attacks (Future Feature Hook)

**NOTE:** Opportunity attacks not yet implemented, but plan should leave room for them.

**TABLETOP RPG RULE:**
- When an entity leaves a threatened adjacent tile (enemy in melee range), enemies get opportunity attack
- Attack resolves before entity completes movement
- Movement may continue after opportunity attack if entity survives

**IMPLEMENTATION HOOK:**

```typescript
// In movement_engine.ts - execute_step() after successful move

if (success) {
  // Check for opportunity attacks
  const from_tile = current_tile;  // Tile we were in
  const to_tile = next_tile;       // Tile we're moving to
  
  // Find enemies adjacent to from_tile (threatened squares)
  const threatened_by = find_enemies_threatening_tile(place, entity_ref, from_tile);
  
  if (threatened_by.length > 0) {
    // Opportunity attack triggers - resolve before leaving tile
    for (const threat of threatened_by) {
      const opportunityAttack = create_opportunity_attack(threat, entity_ref, from_tile);
      resolve_action_immediately(opportunityAttack);
    }
    
    // Check if movement interrupted by opportunity attack
    const entityStillAbleToMove = check_entity_status(entity_ref);
    if (!entityStillAbleToMove) {
      // Entity was stopped (prone, dead, etc.)
      complete_movement(entity_ref, state, place);
      return;
    }
  }
  
  // Continue with movement
  state.path_index++;
  // ... rest of movement
}
```

---

## Updated Implementation Phases

### Phase 1: Engine API Refinement (CRITICAL FOUNDATION)

**Core Objective:** Create the dual-position API (gameplay vs visual) and make engine the single source of truth.

**Files Modified:**
- `src/shared/movement_engine.ts` - Add new APIs, refactor internal logic
- `src/npc_storage/location.ts` - Add position persistence functions
- `src/actor_storage/store.ts` - Add position persistence functions
- `src/npc_storage/store.ts` - Add save position helper
- `src/actor_storage/store.ts` - Ensure position save methods exist

**Implementation Steps:**

**1.1 Add Gameplay vs Visual Position APIs**
```typescript
// Add these to movement_engine.ts

export function get_gameplay_position(
  entity_ref: string,
  place: Place
): TilePosition {
  // ALWAYS returns integer tile position
  // During movement, returns FROM tile
  // Use for ALL gameplay logic
}

export function get_visual_position(entity_ref: string): TilePosition | null {
  // Returns interpolated fractional position during movement
  // Returns null if not moving (use gameplay position instead)
  // Use for RENDERING ONLY
}

// Internal helper - keep existing get_interpolated_position() but make it private
// OR rename to _get_interpolated_position() to indicate internal use
```

**1.2 Add Position Persistence**
```typescript
// In npc_storage/location.ts and actor_storage/store.ts

export function save_npc_position(slot: number, npc_ref: string, position: TilePosition): void
export function load_npc_position(slot: number, npc_ref: string): TilePosition | null
export function save_actor_position(slot: number, actor_ref: string, position: TilePosition): void
export function load_actor_position(slot: number, actor_ref: string): TilePosition | null
```

**1.3 Update Movement Completion**
```typescript
// In movement_engine.ts - complete_movement()

function complete_movement(
  entity_ref: string,
  state: EntityMovementState,
  place: Place
): void {
  state.is_moving = false;
  state.show_path = false;
  
  // Get final position
  const final_position = state.path[state.path.length - 1];
  
  // TABLETOP RPG RULE: Update position in place object
  if (state.entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (actor) {
      actor.tile_position = { ...final_position };
      actor.status = "present";
    }
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (npc) {
      npc.tile_position = { ...final_position };
      npc.status = "present";
    }
  }
  
  // PERSIST TO SHEET - NEW: Save to character sheet
  persist_position_to_sheet(entity_ref, final_position);
  
  // Call completion callback
  if (state.on_complete && final_position) {
    state.on_complete(final_position);
  }
  
  // Clean up
  movement_states.delete(entity_ref);
  log("Movement completed", entity_ref, "at", final_position);
  
  // Notify renderer
  if (on_place_update) {
    on_place_update(place);
  }
}
```

**1.4 Update Movement Interruption**
```typescript
// In movement_engine.ts - stop_entity_movement()

export function stop_entity_movement(entity_ref: string): void {
  const state = movement_states.get(entity_ref);
  if (!state) return;
  
  // TABLETOP RPG RULE: Snap to FROM tile when interrupted
  if (state.is_moving && state.path_index > 0) {
    const from_tile = state.path[state.path_index - 1];
    const place = find_entity_place(entity_ref);
    
    if (place && from_tile) {
      move_entity_to_tile(place, entity_ref, state.entity_type, from_tile);
      persist_position_to_sheet(entity_ref, from_tile);
      
      // Call callback with FROM tile
      if (state.on_complete) {
        state.on_complete(from_tile);
      }
    }
  }
  
  state.is_moving = false;
  state.show_path = false;
  movement_states.delete(entity_ref);
  log("Movement interrupted", entity_ref, "at FROM tile");
}
```

**Checklist:**
- [ ] Create `get_gameplay_position()` with FROM-tile rule
- [ ] Create `get_visual_position()` that uses interpolation
- [ ] Create `persist_position_to_sheet()` helper
- [ ] Update `complete_movement()` to save to sheet
- [ ] Update `stop_entity_movement()` to snap to FROM tile
- [ ] Update internal code to use gameplay position for ALL logic
- [ ] Mark `get_interpolated_position()` as internal/private
- [ ] Update code comments to reflect dual-position architecture

**Testing:**
- [ ] Test `get_gameplay_position()` returns integer tiles during movement (FROM tile)
- [ ] Test `get_visual_position()` returns fractional values during movement
- [ ] Test `get_visual_position()` returns null when not moving
- [ ] Test position saves correctly on movement completion
- [ ] Test position saves correctly on interruption
- [ ] Test positions load from sheets on place entry
- [ ] All existing tests still pass

---

### Phase 2: Renderer Updates (VISUAL SMOOTHING)

**Core Objective:** Update renderer to use interpolated positions for smooth visuals while keeping gameplay positions separate.

**Files Modified:**
- `src/mono_ui/modules/place_module.ts` - Main rendering module

**Implementation Steps:**

**2.1 Update Entity Rendering**
```typescript
// In place_module.ts draw_place() function - locate entity rendering section

// OLD CODE (~lines 758-777):
const entity = get_entity_at(tx, ty, place);
if (entity) {
  const is_npc = "npc_ref" in entity;
  const name = is_npc ? entity.npc_ref.split(".").pop() : entity.actor_ref.split(".").pop();
  canvas.set(screen_x, screen_y, {
    char: get_initial(name),
    rgb: is_npc ? npc_rgb : actor_rgb,
    weight_index: 6,
  });
}

// NEW CODE:
// IMPORTANT: Use gameplay position to FIND entity at tile (targeting)
// Then use visual position to RENDER it smoothly (animation)

// First, check if there's an entity at this tile using GAMEPLAY position
const entities_here = get_all_entities_at(tx, ty, place);

for (const entity of entities_here) {
  const entity_ref = 'npc_ref' in entity ? entity.npc_ref : entity.actor_ref;
  
  // Check if this entity is moving (needs interpolated rendering)
  const visual_pos = get_visual_position(entity_ref);
  const gameplay_pos = get_gameplay_position(entity_ref, place);
  
  let render_x, render_y;
  
  if (visual_pos) {
    // Entity is moving - use VISUAL POSITION for smooth rendering
    render_x = visual_pos.x;
    render_y = visual_pos.y;
  } else {
    // Entity not moving - use GAMEPLAY POSITION (integer tiles)
    render_x = gameplay_pos.x;
    render_y = gameplay_pos.y;
  }
  
  // Convert world coordinates (possibly fractional) to screen coordinates
  const screen_x = inner.x0 + ((render_x - view.offset_x) / view.scale);
  const screen_y = inner.y0 + ((render_y - view.offset_y) / view.scale);
  
  // For ASCII/terminal rendering, we need to render at integer screen cells
  // Use sub-tile effects to hint at fractional position
  const screen_cell_x = Math.floor(screen_x);
  const screen_cell_y = Math.floor(screen_y);
  const frac_x = screen_x - screen_cell_x;
  const frac_y = screen_y - screen_cell_y;
  
  // Render at calculated screen cell
  const is_npc = 'npc_ref' in entity;
  const name = is_npc ? entity.npc_ref.split('.').pop() : entity.actor_ref.split('.').pop();
  
  // Calculate weight based on sub-tile position (0-7 scale, 4=center)
  // Middle of tile = 3-4, edge of tile = 0 or 7
  const weight_index = calculate_render_weight(frac_x, frac_y);
  
  canvas.set(screen_cell_x, screen_cell_y, {
    char: get_initial(name),
    rgb: is_npc ? npc_rgb : actor_rgb,
    weight_index: weight_index,
  });
  
  // Only render first entity at this tile (prevent stacking overlaps)
  break;
}
```

**2.2 Add Sub-Tile Weight Calculation**
```typescript
// In place_module.ts

function calculate_render_weight(frac_x: number, frac_y: number): number {
  // frac_x and frac_y are 0.0 to 1.0 (sub-tile position)
  // 0.5 = center of tile, 0.0 or 1.0 = edge
  
  const center_threshold = 0.3;  // Center 30% of tile
  const min_weight = 2;          // Lightest rendering
  const center_weight = 4;       // Normal render weight
  const edge_weight_1 = 6;       // Heavy render weight (approaching edge)
  const edge_weight_2 = 7;       // Heaviest (at edge)
  
  // Check if near center of tile
  if (frac_x >= 0.5 - center_threshold && frac_x <= 0.5 + center_threshold &&
      frac_y >= 0.5 - center_threshold && frac_y <= 0.5 + center_threshold) {
    return center_weight;
  }
  
  // Check if at extreme edges
  const is_edge_x = frac_x < 0.1 || frac_x > 0.9;
  const is_edge_y = frac_y < 0.1 || frac_y > 0.9;
  
  if (is_edge_x || is_edge_y) {
    return edge_weight_2;
  }
  
  // Approaching edge but not extreme
  return edge_weight_1;
}
```

**2.3 Update Targeting/Click Handling**
```typescript
// In place_module.ts - OnClick handler

OnClick(e: PointerEvent): void {
  // ... existing door/transition logic ...
  
  // Convert click to tile coordinates
  const tile = screen_to_tile(e.x, e.y);
  if (!tile) return;
  
  // Find entity at clicked tile using GAMEPLAY POSITION
  // CRITICAL: This must use gameplay position for accurate targeting
  const entity = get_targetable_entity_at(tile.x, tile.y, place);
  
  if (entity) {
    const entity_ref = 'npc_ref' in entity ? entity.npc_ref : entity.actor_ref;
    
    // Double-check range using GAMEPLAY positions
    const player = place.contents.actors_present[0];
    if (player) {
      const playerPos = get_gameplay_position(player.actor_ref, place);
      const targetPos = get_gameplay_position(entity_ref, place);
      const distance = calculate_tile_distance(playerPos, targetPos);
      
      if (distance <= 10) {  // Within interaction range
        // Valid target - set as communication target
        set_target({ x: tile.x, y: tile.y, entity });
        if (config.on_select_target) {
          config.on_select_target(entity_ref);
        }
      } else {
        log("Target too far", distance, "tiles");
      }
    }
  }
  
  // ... rest of click logic ...
}
```

**Checklist:**
- [ ] Update `get_entity_at()` to use `get_gameplay_position()` for finding entities
- [ ] Update rendering loop to query both visual and gameplay positions
- [ ] Implement `calculate_render_weight()` for sub-tile effects
- [ ] Update click targeting to verify range with gameplay positions
- [ ] Test hover highlight follows visual position during movement
- [ ] Ensure target highlighting uses gameplay position
- [ ] Verify particles still spawn at correct positions

**Testing:**
- [ ] Characters appear to move smoothly between tiles (no teleporting)
- [ ] Target selection works correctly during movement
- [ ] Hover highlights accurately track entities
- [ ] No visual glitches or stuttering during movement
- [ ] Path visualization particles remain accurate
- [ ] Movement effects (particles, sounds) trigger correctly
- [ ] Frame rate remains stable (60fps) during heavy movement

---

### Phase 3: Place System Integration (PERSISTENCE & SYNC)

**Core Objective:** Ensure place reloads don't overwrite runtime positions and that positions persist correctly.

**Files Modified:**
- `src/canvas_app/app_state.ts` - Place loading logic
- `src/mono_ui/modules/movement_command_handler.ts` - Place sync

**Implementation Steps:**

**3.1 Strong Place Reload Protection**
```typescript
// In movement_command_handler.ts - set_command_handler_place()

export function set_command_handler_place(place: Place): void {
  current_place = place;
  
  // TABLETOP RPG RULE: Preserve runtime positions during movement
  // Do NOT let place reload overwrite moving entities
  
  for (const npc of place.contents.npcs_present) {
    const movement_state = get_movement_state(npc.npc_ref);
    
    if (movement_state?.is_moving) {
      // NPC is moving - use tracked runtime position
      const trackedPos = npc_actual_positions.get(npc.npc_ref);
      if (trackedPos) {
        npc.tile_position = { ...trackedPos };
        log("Place reload preserved runtime position", npc.npc_ref, trackedPos);
      }
    } else {
      // NPC stationary - verify against sheet
      const sheetPos = load_npc_position(npc.npc_ref);
      if (sheetPos && (sheetPos.x !== npc.tile_position.x || sheetPos.y !== npc.tile_position.y)) {
        log("WARNING: Sheet position differs from place", npc.npc_ref, 
            "sheet:", sheetPos, "place:", npc.tile_position);
        npc.tile_position = { ...sheetPos };  // Trust sheet
      }
      npc_actual_positions.set(npc.npc_ref, { ...npc.tile_position });
    }
  }
  
  // Same logic for actors
  for (const actor of place.contents.actors_present) {
    const movement_state = get_movement_state(actor.actor_ref);
    
    if (movement_state?.is_moving) {
      const trackedPos = npc_actual_positions.get(actor.actor_ref);
      if (trackedPos) {
        actor.tile_position = { ...trackedPos };
      }
    } else {
      const sheetPos = load_actor_position(actor.actor_ref);
      if (sheetPos && (sheetPos.x !== actor.tile_position.x || sheetPos.y !== actor.tile_position.y)) {
        log("WARNING: Sheet position differs from place", actor.actor_ref);
        actor.tile_position = { ...sheetPos };
      }
      npc_actual_positions.set(actor.actor_ref, { ...actor.tile_position });
    }
  }
}
```

**3.2 Initialize Place with Sheet Positions**
```typescript
// In canvas_app/app_state.ts or appropriate place loading location

function load_place_with_positions(place_id: string): Place {
  const place = load_place(place_id);
  
  // Initialize NPC positions from sheets (not place file)
  // Place file may have stale positions if characters moved
  for (const npc of place.contents.npcs_present) {
    const sheetPos = load_npc_position(npc.npc_ref);
    if (sheetPos) {
      npc.tile_position = { ...sheetPos };
      log("Initialized NPC position from sheet", npc.npc_ref, sheetPos);
    }
  }
  
  // Same for actors
  for (const actor of place.contents.actors_present) {
    const sheetPos = load_actor_position(actor.actor_ref);
    if (sheetPos) {
      actor.tile_position = { ...sheetPos };
      log("Initialized actor position from sheet", actor.actor_ref, sheetPos);
    }
  }
  
  return place;
}
```

**Checklist:**
- [ ] Place reloading preserves moving entity positions
- [ ] Place initialization loads from sheets, not place file
- [ ] Warning logs when sheet and place positions differ
- [ ] Place transitions maintain position integrity
- [ ] Position save happens before place transitions

**Testing:**
- [ ] Place reload during movement doesn't cause snap-back
- [ ] Return to place shows entities at correct sheet-loaded positions
- [ ] Place transitions preserve positions correctly
- [ ] No position drift over multiple place transitions
- [ ] Concurrent movements don't corrupt positions

---

### Phase 4: Feature Validation (NO REGRESSION)

**Core Objective:** Verify all existing features work correctly with new architecture.

**Files Modified:** None (testing only)

**Test Scenarios:**

**4.1 Footstep Broadcasts**
- Setup: Enable debug logging for broadcasts
- Test: NPC moves 6 tiles
- Verify: Broadcast triggers at tiles 1-2, 4-5 (every ~3 tiles)
- Verify: DOES NOT trigger every frame with interpolation
- Verify: Position used for broadcast is integer tile (gameplay position)

**4.2 Movement Sound Effects**
- Test: Player moves 5 tiles
- Verify: Sound plays when crossing each tile boundary
- Verify: Sound does NOT play continuously during interpolation
- Verify: Cooldown prevents sound spam

**4.3 Witness System/Perception**
- Setup: Two NPCs in same place, one moves
- Test: Move NPC through witness range
- Verify: Witness detects movement at correct intervals (every 3 steps)
- Verify: Detection uses gameplay positions (integer tiles)

**4.4 Movement Interruption**
- Test: Start NPC wandering, then immediately start conversation
- Verify: NPC stops at FROM tile (not mid-movement visual position)
- Verify: Position is unambiguous and matches FROM tile

**4.5 Targeting During Movement**
- Test: Start NPC moving, click on it during movement
- Verify: Targeting works (uses gameplay position at FROM tile)
- Verify: Range calculation uses FROM tile position
- Verify: Attacks resolve correctly from correct positions

**4.6 Multi-Entity Movement**
- Test: 3 NPCs wandering simultaneously
- Verify: All move smoothly without conflicts
- Verify: No entity overlaps or collision issues
- Verify: Each follows their own path correctly

**4.7 Place Reload During Movement**
- Test: Start NPC moving, trigger place reload
- Verify: NPC continues smooth movement from correct position
- Verify: No snap-back or jitter occurs

**4.8 Position Persistence**
- Test: Move entities, exit place, re-enter place
- Verify: Entities at correct saved positions
- Test: Save game, reload, verify positions maintained

**4.9 Performance**
- Test: 10+ entities moving simultaneously
- Verify: Frame rate stays at 60fps
- Verify: No input lag or dropped frames

**Checklist:**
- [ ] All features work as before (feature parity)
- [ ] No gameplay-affecting bugs introduced
- [ ] Visual improvements are noticeable but don't break mechanics
- [ ] Debug logging confirms correct position usage
- [ ] Performance benchmarks pass

---

### Phase 5: Documentation
**Files Modified:**
- `docs/plans/` (this file, mark phases complete)
- `src/shared/movement_engine.ts` (header comments)
- New: `docs/movement_system_architecture.md`
- Update: `docs/plans/2026_02_03_place_system_visual_guide.md`

**Checklist:**
- [ ] Update all code comments to reflect new architecture
- [ ] Create comprehensive architecture document
- [ ] Update place system guide with interpolation details
- [ ] Update any affected API documentation
- [ ] Mark this plan phases as complete

---

### Phase 5: Documentation & Debug Infrastructure

**Core Objective:** Ensure code is well-documented and debuggable.

**Files Modified:**
- All source files touched - add comprehensive comments
- `src/shared/movement_engine.ts` - Update header docs
- Write new: `docs/architecture/movement_system_architecture.md`

**Implementation Steps:**

**5.1 Add Debug Visualizations**
```typescript
// Debug mode toggle (Ctrl+\\ or similar)
// When enabled, show both gameplay and visual positions

if (UI_DEBUG_ENABLED) {
  // Draw gameplay position marker (integer tile)
  const gameplayPos = get_gameplay_position(entity_ref, place);
  const screenX = inner.x0 + ((gameplayPos.x - view.offset_x) / view.scale);
  const screenY = inner.y0 + ((gameplayPos.y - view.offset_y) / view.scale);
  
  canvas.set(Math.floor(screenX), Math.floor(screenY), {
    char: "□",  // Hollow square
    rgb: get_color_by_name("vivid_green").rgb,
    weight_index: 5
  });
  
  // Draw visual position marker (interpolated)
  const visualPos = get_visual_position(entity_ref);
  if (visualPos) {
    const visualScreenX = inner.x0 + ((visualPos.x - view.offset_x) / view.scale);
    const visualScreenY = inner.y0 + ((visualPos.y - view.offset_y) / view.scale);
    
    canvas.set(Math.floor(visualScreenX), Math.floor(visualScreenY), {
      char: "·",  // Dot
      rgb: get_color_by_name("pale_yellow").rgb,
      weight_index: 7
    });
  }
}
```

**5.2 Update Code Comments**
Every function in movement system must have:
```typescript
/**
 * Brief description
 * 
 * TABLETOP RPG RULE: [explicit rule if applicable]
 * 
 * @param param - Description
 * @returns Description
 * 
 * USE THIS FOR: [gameplay|rendering|both]
 * NEVER USE FOR: [opposite use case]
 * 
 * Example: [typical usage with context]
 */
```

**5.3 Create Architecture Documentation**
New file: `docs/architecture/movement_system_architecture.md`

Contents:
- Architecture diagram (Sheet → Place → Engine → Renderer)
- Gameplay vs Visual position distinction (with examples)
- State machine diagram for movement
- API reference with use cases
- Common pitfalls and anti-patterns
- Performance considerations

**Checklist:**
- [ ] Add debug visualization for gameplay vs visual positions
- [ ] Add debug toggle switch
- [ ] Update ALL movement-related functions with TABLETOP RPG rules in comments
- [ ] Document what each API should and should not be used for
- [ ] Write architecture overview document
- [ ] Update affected plans/docs with references

---

## Updated Acceptance Criteria

### Updated Functional Requirements
- [ ] ✅ Players visually see characters moving smoothly across tiles (not teleporting)
- [ ] ✅ Gameplay position is ALWAYS integer tiles (never fractional for mechanics)
- [ ] ✅ Visual position is interpolated smoothly between tiles (rendering only)
- [ ] ✅ Targeting uses gameplay positions (clear for attacks, range checks)
- [ ] ✅ During movement, entity is considered at FROM tile for gameplay
- [ ] ✅ Movement interruption snaps to FROM tile (not visual position)
- [ ] ✅ Place reload during movement preserves runtime positions
- [ ] ✅ All gameplay systems (range, AoE, cover, targeting) use integer tiles
- [ ] ✅ No gameplay-affecting bugs or positioning ambiguities introduced

### Feature Preservation (Must Pass All)
- [ ] ✅ Footstep broadcasts trigger every ~3 tiles (not every frame)
- [ ] ✅ Movement sound effects play at tile boundaries only
- [ ] ✅ Path visualization particles accurate and visible
- [ ] ✅ Witness/perception detection works correctly (integer positions)
- [ ] ✅ Movement interrupts work (conversation, combat) - snap to FROM tile
- [ ] ✅ NPC facing updates correctly during movement
- [ ] ✅ Target selection works during movement (gameplay position)
- [ ] ✅ Multi-entity movement works without conflicts

### Performance & Quality
- [ ] ✅ Frame rate maintains 60fps with 10+ moving entities
- [ ] ✅ No memory leaks from position tracking
- [ ] ✅ Position persistence works correctly (save/load, place transitions)
- [ ] ✅ No positioning desyncs or snap-back after 1 hour of gameplay
- [ ] ✅ Debug logging shows correct position usage (gameplay vs visual)

### Code Quality
- [ ] ✅ All functions documented with TABLETOP RPG RULES where applicable
- [ ] ✅ Clear distinction between `get_gameplay_position()` and `get_visual_position()` throughout codebase
- [ ] ✅ No accidental use of fractional positions in gameplay logic
- [ ] ✅ Architecture document explains dual-position system clearly

### Documentation
- [ ] ✅ Architecture document complete
- [ ] ✅ Code comments updated on all modified files
- [ ] ✅ README or dev docs updated for new developers
- [ ] ✅ This plan marked complete with notes on actual implementation

---

## Summary of Critical Tabletop RPG Rules

### RULE 1: Gameplay vs Visual Position
**GAMEPLAY:** Always integer tiles, even during movement  
**VISUAL:** Interpolated fractional positions for rendering  
**CONSEQUENCE:** Never use interpolated positions for attacks, range, targeting

### RULE 2: FROM Tile During Movement
**When:** Entity moves from Tile A → Tile B  
**Gameplay Position:** Tile A (FROM tile) until step completes  
**Visual Position:** Interpolated between A and B  
**CONSEQUENCE:** Targeting, range, AoE use Tile A until movement finishes

### RULE 3: Interruption Snaps to FROM Tile
**When:** Movement interrupted (conversation, combat, etc.)  
**Result:** Entity ends at FROM tile (where they started the step)  
**CONSEQUENCE:** Clear, unambiguous positioning, no mid-step interrupts

### RULE 4: Single Source of Truth
**Authoritative Storage:** Character sheets (NPC/actor JSON files)  
**Runtime Authority:** Movement engine state  
**Renderer Authority:** Visual interpolation only  
**CONSEQUENCE:** No desync, clear save/load behavior

---

## Final Checklist for Implementation

Before starting implementation, verify:

- [ ] **Reviewed this entire plan and understand the dual-position architecture**
- [ ] **Clear on difference between `get_gameplay_position()` and `get_visual_position()`**
- [ ] **Understand FROM tile rule during movement**
- [ ] **Know when to use integer vs interpolated positions**
- [ ] **All tabletop RPG rules documented in code comments**
- [ ] **Phases understood (1: Engine, 2: Renderer, 3: Integration, 4: Validation)**
- [ ] **Testing strategy clear for each phase**
- [ ] **Acceptance criteria understood and achievable**

---

## References & Resources

### Core Files
- `src/shared/movement_engine.ts` - Main movement logic
- `src/mono_ui/modules/place_module.ts` - Rendering
- `src/shared/movement_commands.ts` - Command protocol
- `src/types/place.ts` - Type definitions

### Documentation to Update
- `docs/plans/2026_02_17_movement_system_unification.md` (this file)
- `docs/plans/2026_02_03_place_system_visual_guide.md` - Add interpolation
- `docs/architecture/movement_system_architecture.md` - New document

### Testing Strategy
- Start Phase 1 (engine) - no visual changes, test with debug logs
- Then Phase 2 (renderer) - visual changes, manual testing
- Then Phase 3 (integration) - end-to-end testing
- Finally Phase 4 (validation) - feature regression testing

### Inspiration & Prior Art
- **Baldur's Gate 3** - Grid-based with interpolated visuals in real-time exploration
- **Solasta** - Explicit grid with smooth animations in turn-based combat
- **Divinity: Original Sin 2** - Hybrid real-time/turn-based with visual interpolation

All these games maintain discrete gameplay positions (grid squares) while interpolating visuals for polish - the exact architecture this plan implements.

---

**Status:** Plan complete and ready for implementation

**Next Step:** Begin Phase 1 - Engine API Refinement

### Functional Requirements
- [ ] Players can visibly see characters moving smoothly between tiles (not teleporting)
- [ ] Movement speed appears consistent and natural (no jitter or stuttering)
- [ ] All movement commands (click-to-move, wander, follow) show smooth movement
- [ ] Place transitions maintain correct entity positions
- [ ] Game restarts/reloads preserve entity positions correctly

### Feature Preservation
- [ ] Footstep broadcasts trigger every ~3 tiles (not every frame)
- [ ] Movement sound effects play at tile transition boundaries
- [ ] Path visualization particles show planned route correctly
- [ ] Witness system detects movement with same frequency as before
- [ ] Movement interrupts work (conversation, combat, etc.)
- [ ] NPC facing updates correctly during movement

### Performance
- [ ] No frame rate drops during movement (maintain 60fps)
- [ ] Interpolation calculations efficient (<1ms per frame)
- [ ] Memory usage stable (no leaks from position tracking)

### Code Quality
- [ ] Single source of truth pattern documented and enforced
- [ ] All tests pass (or updated if movement-related)
- [ ] No duplicate position storage in multiple systems
- [ ] Clear API boundaries between engine, place, and renderer

---

## Risks and Mitigations

### Risk 1: Performance Impact
**Risk:** Interpolating every entity every frame may impact performance
- **Likelihood:** Low (interpolation is simple math)
- **Impact:** Medium (if many entities moving)
- **Mitigation:** Profile early, cache per-frame results, optimize if needed

### Risk 2: Visual Artifacts
**Risk:** Sub-tile rendering may look weird in ASCII/terminal UI
- **Likelihood:** Medium
- **Impact:** Medium (user experience)
- **Mitigation:** Experiment with weight/color blending, provide fallback to discrete rendering if needed

### Risk 3: Position Desync
**Risk:** Race condition between sheet writes and place reloads
- **Likelihood:** Low (if architecture implemented correctly)
- **Impact:** High (snap-back bugs)
- **Mitigation:** Strict API enforcement, thorough testing of place transitions

### Risk 4: Breaking Existing Features
**Risk:** Witness, sound, or particle systems break
- **Likelihood:** Medium (complex dependencies)
- **Impact:** Medium
- **Mitigation:** Comprehensive feature validation phase, debug logging

---

## Future Enhancements (Not in Scope)

- Variable movement speeds within a single path (acceleration/deceleration)
- Diagonal movement animation (currently instant N/E/S/W only)
- Entity stacking/render order based on Y position
- Smooth camera follow for targeted entities
- Animation frames for movement (walking sprites if graphics added)

---

## References

- **Current Movement Engine:** `src/shared/movement_engine.ts`
- **Place Module Renderer:** `src/mono_ui/modules/place_module.ts`
- **Movement Command Handler:** `src/mono_ui/modules/movement_command_handler.ts`
- **Movement Commands:** `src/shared/movement_commands.ts`
- **Place Types:** `src/types/place.ts`
- **NPC Storage:** `src/npc_storage/location.ts`
- **Actor Storage:** `src/actor_storage/store.ts`

---

## Success Metrics

- **User Experience:** Players report characters "feel alive" and movement looks natural
- **Bug Reports:** Zero snap-back or teleportation bug reports after implementation
- **Performance:** No regression in frame rate or input latency
- **Code Quality:** Position data no longer appears in multiple unrelated systems
- **Documentation:** All movement-related code has clear, accurate comments

---

## Notes

**Implementation Order Matters:**
1. Refine engine APIs first (no visual changes, low risk)
2. Then update renderer (visual impact, testable)
3. Then integrate with place system (complex interactions)
4. Finally validate features (ensure nothing broke)

**Testing Strategy:**
- Phase 1: Unit tests for new APIs if test framework exists
- Phase 2: Visual/manual testing with debug logging enabled
- Phase 3: Automated playthrough of common movement scenarios
- Phase 4: Long-term soak test (NPCs wandering for extended periods)

**Rollback Plan:**
Each phase should be committable independently. If issues arise:
- Phase 2 can be reverted without affecting engine logic
- Phase 1 can be extended with backward-compatibility shims
- Place system integration can be feature-flagged

# Movement System Plan Review & Critique

**Date:** 2026-02-17  
**Status:** Review Complete - Recommendations Added  
**Review File:** `docs/plans/2026_02_17_movement_system_unification_review.md`

> **CRITICAL NOTE:** This is a review and critique of the movement unification plan. It identifies strengths, weaknesses, and tabletop RPG-specific considerations.

---

## Executive Summary

The plan is **fundamentally sound** and addresses the core issues, but needs refinement for tabletop RPG gameplay requirements. The approach of separating **visual interpolation** from **gameplay position** is correct, but several edge cases and architectural decisions need clarification.

**Overall Assessment:** 85% - Good foundation, needs refinement

---

## Strengths of the Current Plan

### ✅ 1. Correct Separation of Concerns
**Good Decision:** Visual interpolation is separate from gameplay logic
- Gameplay calculations (range, AoE, etc.) continue using integer tile positions
- Visual rendering uses interpolated fractional positions
- This maintains clear, unambiguous gameplay rules while improving UX

### ✅ 2. Single Source of Truth Architecture
**Good Decision:** Character sheets as authoritative storage
- Prevents position desync across systems
- Enables persistence across game sessions
- Clear ownership: sheets store, engine runs, renderer displays

### ✅ 3. Phased Implementation
**Good Decision:** Engine → Renderer → Integration → Validation
- Each phase is testable independently
- Allows rollback if issues arise
- Minimizes risk to existing features

### ✅ 4. Feature Preservation Focus
**Good Decision:** Explicitly lists all features to preserve
- Footstep broadcasts, sounds, particles, witness system
- Ensures no regression in gameplay mechanics
- Good acceptance criteria

---

## Critical Issues & Gaps

### ❌ 1. **Tabletop RPG Gameplay vs Visuals Not Explicitly Defined**

**Problem:** The plan doesn't clearly state that **gameplay position always uses integer tiles**, even during movement.

**Why This Matters:**
In a tabletop RPG, precise positioning determines:
- Attack range checks (melee 1 tile, thrown 5-20 tiles, etc.)
- Spell/ability area of effect
- Cover and line of sight calculations
- Opportunity attacks when leaving threatened squares
- Movement cost penalties

**Current Plan Risk:** Developers might accidentally use interpolated positions for gameplay logic, creating ambiguous rules and bugs.

**Recommendation (MUST FIX):**
Add explicit rule to documentation:
```typescript
// RULE: Gameplay position is ALWAYS integer tiles
// Visual position is interpolated for smooth animation

// ❌ WRONG - Don't use for gameplay
const attackRange = get_interpolated_position(attacker) - get_interpolated_position(target);

// ✅ CORRECT - Use for gameplay
const attackRange = get_entity_position_from_place(attacker) - get_entity_position_from_place(target);
// OR: Use the planned get_gameplay_position() API
```

**Add to plan:**
```typescript
// New API to make this distinction explicit

/**
 * Get position for GAMEPLAY calculations (always integer tiles)
 * Use for: range checks, AoE, cover, line of sight, opportunity attacks
 * NEVER use interpolated positions for gameplay logic
 */
export function get_gameplay_position(
  entity_ref: string,
  place: Place
): TilePosition {
  // Always returns integer tile position, even during movement
  const interpolated = get_interpolated_position(entity_ref);
  if (interpolated) {
    return { x: Math.round(interpolated.x), y: Math.round(interpolated.y) };
  }
  return get_entity_position_from_place(place, entity_ref);
}

/**
 * Get position for VISUAL RENDERING (can be fractional)
 * Use for: rendering, animations, visual effects only
 * NEVER use for gameplay calculations
 */
export function get_visual_position(
  entity_ref: string
): TilePosition | null {
  return get_interpolated_position(entity_ref);
}
```

### ❌ 2. **Position Query During Movement - Race Condition**

**Problem:** If a player targets/attacks an entity during movement, which position is used?

**Scenario:**
```
1. NPC is moving from tile (5,5) to (6,5)
2. Player clicks to attack NPC during movement
3. NPC's interpolated position is (5.6, 5.0)
4. Player is at (6,6), distance = 1.02 tiles (line 8)
5. Should attack be valid? (melee range = 1 tile)

Current plan: UNCLEAR - might use interpolated position = invalid
Correct behavior: Use integer position = (5,5) or (6,5) = valid
```

**Why This Matters:**
- Tabletop RPGs have strict rules about when you can act
- Movement doesn't make you immune to opportunity attacks
- Players need clear, consistent positioning
- Game can't be "tricking" the player with interpolated positions

**Recommendation (MUST FIX):**
Add tabletop RPG rule to architecture:
```typescript
// TABLETOP RPG RULE: Position is discrete for gameplay
// During movement, entity is considered at the integer tile it's moving FROM
// Until the movement step completes, then it's at the destination
// This mimics "square-by-square" movement in D&D/Pathfinder

export function is_entity_at_tile(entity_ref: string, tile: TilePosition): boolean {
  const gameplay_pos = get_gameplay_position(entity_ref);
  return gameplay_pos.x === tile.x && gameplay_pos.y === tile.y;
}
```

Update the movement engine:
```typescript
// In movement_engine.ts, modify execute_step()

async function execute_step(entity_ref, state, place): Promise<void> {
  // ... current code ...
  
  // Before moving: entity is at current tile for gameplay
  // (already true in current implementation)
  
  // Move entity (in place object) - only for renderer
  const success = move_entity_to_tile(place, entity_ref, state.entity_type, next_tile);
  
  // During the 200ms movement: gameplay position is still the FROM tile
  // This needs to be tracked separately
  state.current_gameplay_tile = state.path[state.path_index - 1]; // Matrix/tile rules
  
  // After step completes: gameplay position updates to next_tile
  // (happens in on_complete callback)
}
```

### ❌ 3. **Place Reload Overwrite Risk Not Fully Addressed**

**Problem:** Plan mentions place reload can overwrite runtime positions, but doesn't fully solve it.

**Current Plan Approach:**
```typescript
// From movement_command_handler.ts line 179
function set_command_handler_place(place: Place): void {
  current_place = place;
  // Sync positions from place data to tracker (line 179)
  for (const npc of place.contents.npcs_present) {
    const current_tracked = npc_actual_positions.get(npc.npc_ref);
    if (!current_tracked) {  // Only if not tracked
      npc_actual_positions.set(npc.npc_ref, { ...npc.tile_position });
    }
  }
}
```

**Issue:** If place reloads during movement, `npc_actual_positions` might still be out of sync.

**For Tabletop RPG:**
- Position tracking must be absolutely reliable
- A GM/player needs to trust where entities are
- Can't have "ghost" positions that don't match rendered position

**Recommendation (SHOULD FIX):**
```typescript
// STRONGER SOLUTION: Movement engine intercepts place updates

export function set_command_handler_place(place: Place): void {
  current_place = place;
  
  // For each entity currently moving, preserve their runtime position
  // Do NOT trust the place object's position if entity is moving
  for (const npc of place.contents.npcs_present) {
    const movement_state = get_movement_state(npc.npc_ref);
    
    if (movement_state?.is_moving) {
      // Entity is moving - use tracked position, ignore place data
      const tracked = npc_actual_positions.get(npc.npc_ref);
      if (tracked) {
        npc.tile_position = { ...tracked };
        log("Place reload during movement: preserved runtime position", npc.npc_ref);
      }
    } else {
      // Entity not moving - sync from place data (authoritative)
      const sheet_pos = load_npc_position(npc.npc_ref);
      if (sheet_pos && (sheet_pos.x !== npc.tile_position.x || sheet_pos.y !== npc.tile_position.y)) {
        // Sheet has newer position - this shouldn't happen, but log it
        log("WARNING: Sheet position differs from place position", npc.npc_ref);
      }
    }
  }
  
  // Same for actors
}
```

### ❌ 4. **Action Targeting During Movement Not Specified**

**Problem:** How does the action system target entities during movement?

**Critical for Tabletop RPG:**
- Players can attack/throw/cast during NPC movement (opportunity attacks)
- Range must be calculated from gameplay positions, not visual positions
- Target selection must be reliable

**Current Plan Gap:**
- Place module has `get_entity_at(tx, ty, place)` which uses place.npcs_present[i].tile_position
- Does this return entities mid-movement? Unclear
- If an NPC is moving away, can you click on it to target? What position is used?

**Recommendation (MUST FIX):**
```typescript
// Add to plan

export function get_targetable_entity_at(
  tile_x: number,
  tile_y: number,
  place: Place
): PlaceNPC | PlaceActor | null {
  // Use GAMEPLAY position, not visual position
  // This means entities are targetable at their integer tile only
  
  const npcs = place.contents.npcs_present.filter(npc => {
    const gameplay_pos = get_gameplay_position(npc.npc_ref, place);
    return gameplay_pos.x === tile_x && gameplay_pos.y === tile_y;
  });
  
  if (npcs.length > 0) return npcs[0]; // First match or cycle
  
  const actors = place.contents.actors_present.filter(actor => {
    const gameplay_pos = get_gameplay_position(actor.actor_ref, place);
    return gameplay_pos.x === tile_x && gameplay_pos.y === tile_y;
  });
  
  if (actors.length > 0) return actors[0];
  
  return null;
}
```

**Add to plan documentation:**
```markdown
### Tabletop RPG Movement Rule
During an entity's movement, it is considered to occupy the tile it is moving FROM for all gameplay purposes (targeting, range, AoE, opportunity attacks). The visual position is interpolated for smooth animation ONLY.

Example:
- NPC at (5,5) moves to (6,5) - 200ms movement
- During movement, NPC is at (5.6, 5.0) visually
- Player attacks NPC? Range is calculated from (5,5) to player
- Player stands adjacent to path? Opportunity attack triggers when NPC leaves (5,5)
- Player stands at (6,5)? Can't target until movement completes
```

### ❌ 5. **Movement Interruption Persistence Not Addressed**

**Problem:** When movement is interrupted (conversation, combat), what's the final position?

**Tabletop RPG Scenarios:**
1. NPC is moving to tile (6,5), currently at interpolated (5.6, 5.0)
2. Player initiates conversation
3. NPC stops moving (movement interrupted)
4. Where does NPC end up? (5,5) or (6,5)?

**Current Plan:** `stop_entity_movement()` just deletes movement state, doesn't set final position

**Recommendation (SHOULD FIX):**
```typescript
// In movement_engine.ts

export function stop_entity_movement(entity_ref: string): void {
  const state = movement_states.get(entity_ref);
  if (!state) return;
  
  // If interrupted mid-movement, snap to the tile we were moving FROM
  // OR the tile we were moving TO?
  // TABLETOP RULE: Snap to the tile you were moving FROM
  // This simulates "stopping in your tracks"
  
  const from_tile = state.path[state.path_index - 1];
  if (from_tile) {
    // Find place and update position
    const place = find_entity_place(entity_ref);
    if (place) {
      move_entity_to_tile(place, entity_ref, state.entity_type, from_tile);
      persist_position_to_sheet(entity_ref, from_tile);
    }
  }
  
  state.is_moving = false;
  movement_states.delete(entity_ref);
  log(`${entity_ref} movement interrupted, snapping to ${from_tile?.x},${from_tile?.y}`);
}
```

**Document in plan:**
```markdown
### Movement Interruption Rule
When movement is interrupted (conversation, combat, etc.), the entity stops at the tile it was moving FROM, not the tile it was moving TO. This prevents "judgment calls" about partial movement and maintains clear positioning.
```

---

## Tabletop RPG-Specific Considerations

### ✅ What's Already Good

**Grid-Based Movement:** 
- Plan maintains tile grid as fundamental unit
- Movement is still square-by-square, not freeform
- Maintains tactical positioning importance

**Discrete Time Steps:**
- Movement still happens in 200ms steps (5 tiles/second)
- Each step represents moving one square
- Time is still quantized for action economy

**Clear Boundaries:**
- Plan preserves that tiles are either occupied or not
- No ambiguous "partially in two tiles" state for gameplay
- Line of sight, cover, AoE remain clear

### ⚠️ What Needs Explicit Definition

**Opportunity Attacks:**
- When entity leaves a threatened square, AoO triggers
- Need to ensure this happens at the right moment (when leaving FROM tile)
- Current plan doesn't explicitly address this

**Simultaneous Actions:**
- In tabletop, initiative order determines who moves when
- Current system is real-time, not turn-based
- Plan should acknowledge this hybrid approach

**Movement Cost:**
- Difficult terrain costs 2 tiles movement
- This is handled in pathfinding, not rendering
- Plan should explicitly state this is unchanged

**Difficult Terrain Example:**
```typescript
// In pathfinding, difficult terrain adds +1 movement cost
// Visual interpolation doesn't affect this
// Movement from (5,5) to (5,6) through difficult terrain:
// - Takes 400ms instead of 200ms (2 tiles of movement)
// - Visual interpolation still smooth, at half speed
// - Gameplay position updates to (5,6) after 400ms
```

---

## Alternative Approaches

### Alternative 1: Snap to Grid on Any Action
**Idea:** When any gameplay action occurs (attack, cast, etc.), all movement snaps to integer tiles first

**Pros:**
- Simplifies gameplay logic
- No ambiguity about positioning during actions

**Cons:**
- Loses visual smoothness during action sequences
- Might look jarring
- Doesn't solve the core architectural issues

**Verdict:** Not better than current plan

### Alternative 2: True Real-Time with Physics
**Idea:** Full real-time simulation with continuous positions for everything

**Pros:**
- Most realistic movement
- True fluid combat positioning

**Cons:**
- Breaks tabletop RPG paradigm (grid is fundamental)
- Action range calculations become continuous, not discrete
- Would require rewriting ALL gameplay systems
- Opportunity attacks no longer clear (when exactly did you leave threatened space?)

**Verdict:** Too radical, breaks core tabletop identity

### Alternative 3: Turn-Based Movement with Interpolation
**Idea:** Initiate movement during your turn, animation plays, but can't act until animation completes

**Pros:**
- Maintains action economy clarity
- Visual smoothness preserved
- Clear timing: you act, then animation plays

**Cons:**
- Adds latency to actions (wait for movement to finish)
- Not currently how system works (real-time)
- Would require initiative/order system

**Verdict:** Better for pure tabletop, but not for current hybrid real-time system

### Alternative 4: Current Plan + Explicit State Machine
**Idea:** Keep current plan, but add explicit state machine for movement

**Pros:**
- Maintains smooth visuals
- Clear gameplay position handling
- Can document state transitions explicitly

**Cons:**
- More complex to implement
- Adds state management overhead

**Example State Machine:**
```typescript
enum MovementState {
  IDLE,           // At integer tile, not moving
  STARTING,       // About to move, at FROM tile
  MOVING,         // Currently interpolating between FROM and TO
  COMPLETING,     // Move complete, at TO tile (frame or so)
}

// Transitions:
// IDLE -> STARTING -> MOVING (per tile) -> COMPLETING -> IDLE
// Can interrupt from: STARTING, MOVING, COMPLETING -> IDLE
```

**Verdict:** Strong improvement to current plan, recommended

---

## Recommendations Summary

### MUST FIX (Block implementation)
1. ✅ Add explicit separation: `get_gameplay_position()` vs `get_visual_position()`
2. ✅ Define tabletop RPG movement rule: entity at FROM tile during transition
3. ✅ Specify targeting/range uses gameplay position only

### SHOULD FIX (Improve robustness)
4. ✅ Strengthen place reload protection to preserve runtime positions
5. ✅ Define movement interruption behavior (snap to FROM tile)
6. ✅ Add state machine documentation (or actual state machine)
7. ✅ Clarify action targeting during movement

### NICE TO HAVE (Polish)
8. ✅ Add debug view to show both visual and gameplay positions
9. ✅ Add "square-by-square" vs "fluid" visual toggle for preference
10. ✅ Document all distance calculations remain integer-based

---

## Revised Plan Assessment

If the above issues are addressed, the plan becomes:

**Overall Assessment:** 95% - Excellent tabletop RPG movement system

**Why It Works for Tabletop RPG:**
- ✅ Maintains grid-based gameplay (fundamental to tabletop)
- ✅ Adds visual polish without breaking mechanics
- ✅ Clear separation of gameplay vs visual state
- ✅ Preserves tactical positioning importance
- ✅ Enables smooth animation while keeping discrete rules
- ✅ Supports opportunity attacks, AoE, range checks

**Key Insight:**
The best tabletop RPG digital implementations (Divinity: Original Sin, Solasta, Baldur's Gate 3) all do this: **gameplay on grid, visuals interpolated**. This plan achieves the same architecture.

---

## Final Recommendation

**Proceed with implementation AFTER addressing MUST FIX items**

The plan is 85% complete. Add the following sections:

1. **"Tabletop RPG Gameplay vs Visuals"** section defining explicit rules
2. **State machine documentation** for movement lifecycle
3. **Targeting/during-movement behavior** specification
4. **Stronger place reload protection** mechanism
5. **Debug visualization** support showing both positions

Then it's ready for implementation. The core architecture is sound and follows proven patterns from successful tabletop RPG video games.

---

## References & Inspiration

- **Baldur's Gate 3:** Uses grid for gameplay, smooth movement for visuals
- **Solasta:** Turn-based with interpolated movement during animations
- **Divinity: Original Sin 2:** Real-time exploration with turn-based combat, smooth movement throughout
- **Pathfinder: Kingmaker:** Grid-based with procedural animations

All these games maintain discrete gameplay positions while interpolating visuals - the approach this plan takes. This is the industry-standard pattern for tabletop RPG adaptations.

---

## Conclusion

**The plan is good, but needs tabletop RPG-specific clarifications before implementation.**

The core architecture (single source of truth + visual interpolation) is correct and proven. However, in a tabletop RPG, the distinction between **gameplay position** (integer tiles) and **visual position** (interpolation) must be **absolutely explicit and unambiguous** throughout the codebase.

Once the MUST FIX items are added, this will be an excellent implementation that maintains tabletop tactical depth while providing modern visual polish.

**Recommendation: Revise plan with noted changes, then implement.**

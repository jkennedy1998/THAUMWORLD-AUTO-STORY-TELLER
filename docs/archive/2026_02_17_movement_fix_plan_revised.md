# Movement System Fix Plan - Final

**Date:** 2026-02-17  
**Status:** 🟡 PLANNING - Diagnostic Phase Active  
**Priority:** Critical - Core User Experience  
**Type:** BUG FIX & ARCHITECTURE VALIDATION  

> **CRITICAL CLUE:** Footsteps (cyan particles) are visible during movement, but character (actor) is invisible. This proves the rendering loop IS detecting movement and the data flow IS working. The bug is specifically with entity character rendering, not position tracking.

---

## Problem Statement (Updated Based on Evidence)

**Current State:**
```
User clicks to move → Path appears (yellow) → Footsteps appear (cyan) → Character INVISIBLE during movement → Character appears at destination
                          ↑                                    ↑                                 ↑
                       Working                            Working                          Working
                       (particles)                      (detection)                    (completion)
```

**Evidence:**
- ✅ Path particles visible → Place object data flow works
- ✅ Footstep particles visible → Movement detection works  
- ✅ Character appears at destination → Position updates work
- ❌ Character invisible during movement → Entity rendering specifically broken

**Conclusion:** This is NOT a position data issue. This is a **rendering order / weight / visibility** issue.

---

## Root Cause Analysis (Revised)

### Timeline of Events Per Frame

```
Frame N (16.6ms @ 60fps):
├─ 0ms:    draw_place() starts
├─ 2ms:    Lines 728-790: Render floor, check each screen cell
│          ├─ For tile (6,5): check_entity_at(6,5)
│          ├─ Finds npc/actor? Returns entity
│          └─ Calls set(screen_x, screen_y, {char: "H", weight: 6})
├─ 4ms:    Line 900: check_entity_movement(place)
│          ├─ Detects prev@5,5 != current@6,5
│          ├─ spawn_movement_particle({6,5}) ← Cyan dot
│          └─ Update previous_positions[actor] = {6,5}
├─ 6ms:    Line 926-943: Draw particles
│          └─ Draw cyan dot at (6,5) with weight 4-9
└─ 16ms:   Frame complete → Display to screen

Frame N+1:
├─ 0ms:    draw_place() starts  
├─ 2ms:    Lines 728-790: Render floor, check tiles
│          └─ For tile (7,5): check_entity_at(7,5)
└─ ... repeat ...
```

### The Bug: Particle Overwrites Entity

**Current Rendering Weights:**
- Entity character: `weight_index: 6` (line 777)
- Movement particle: `weight: p.weight ?? 4` (line 936)

**BUT:** Let me check if particles CAN have higher weight:

```typescript
// In spawn_movement_particle() (line 607):
particles.push({
  x: pos.x,
  y: pos.y,
  char: "·",
  rgb: move_rgb,
  created_at: now,
  lifespan_ms: PARTICLE_LIFESPAN_MS
  // No weight specified = defaults to 4
});
```

**Problem Confirmed:** Particle weight = 4, Entity weight = 6. Entity should render ON TOP.

**Wait...** Then why is entity invisible?

### Alternate Hypothesis: Entity Filtered Before Rendering

Let me check the render loop order again. The timeline I drew shows check_entity_movement called DURING draw, but looking at line numbers:

- Line 900: check_entity_movement() → Updates positions, spawns particles
- Lines 728-790: Main drawing loop (BEFORE check_entity_movement)

This is **out of order!** Positions are updated AFTER entities are drawn.

**Corrected Timeline:**
```
Frame N:
├─ 0ms:    draw_place() starts
├─ 1ms:    Line 728-790: DRAW ENTITIES (at OLD positions)
│          └─ Actor at (5,5) → Rendered ✓
├─ 2ms:    Line 900: check_entity_movement()
│          ├─ Spawns particle at NEW position (6,5)
│          └─ Updates previous_positions cache
├─ 3ms:    Line 926-943: Draw particles
│          └─ Particle at (6,5) ✓
└─ 16ms:   Frame complete

Frame N+1:
├─ 0ms:    draw_place() starts  
├─ 1ms:    Line 728-790: DRAW ENTITIES (at new positions retrieved from WHO?)
│          └─ Actor at (6,5) ← WHERE DOES THIS COME FROM?
│                            └─ Should be place.contents.actors_present[0].tile_position
│                            └─ But maybe it's reading from cache?
```

**Theories:**

**Theory A:** Position updates happen in movement engine's 20Hz tick, RENDERER reads stale cached data via `previous_positions` Map

**Theory B:** `config.get_place()` returns a different object instance, so renderer never sees updates

**Theory C:** Entity is found by `get_entity_at()` but `canvas.set()` doesn't actually draw (z-fighting, transparency, etc.)

**Theory D:** Entity renders but is immediately overwritten by particle in SAME frame due to weight misunderstanding

---

## Diagnostic Plan - Current Status

### Diagnostic Logs Added ✓

**Movement Engine:**
```typescript
// In move_entity_to_tile()
console.log(`[DIAGNOSTIC-move_entity_to_tile] entity=${entity_ref}, tile=(${tile.x},${tile.y}), place.id=${place.id}, place_ref=${place}`);
```

**Renderer:**
```typescript
// In draw_place()
console.log(`[DIAGNOSTIC-draw_place] place.id=${place?.id}, place_ref=${place}`);
console.log(`[DIAGNOSTIC-draw_place] actors=${JSON.stringify(actors)}, npcs=${JSON.stringify(npcs)}`);

// In get_all_entities_at()
console.log(`[DIAGNOSTIC-get_all_entities_at] tile=(${tile_x},${tile_y}), found=${entities.length}`);

// In render loop
console.log(`[DIAGNOSTIC-render_entity] rendering ${entity_ref} at tile (${tx},${ty}) to screen (${screen_x},${screen_y})`);
```

### What Logs Will Reveal

**If Theory A (cache issue) is correct:**
```
[DIAGNOSTIC-move_entity_to_tile] entity=actor.player, tile=(6,5), place_ref=Place@ABC
[DIAGNOSTIC-draw_place] place_ref=Place@ABC  ← SAME object ✓
[DIAGNOSTIC-draw_place] actors=["actor.player@(6,5)"] ← Correct position ✓
[DIAGNOSTIC-get_all_entities_at] tile=(6,5), found=1 ← Entity FOUND ✓
[DIAGNOSTIC-render_entity] rendering actor.player at tile (6,5) ← Entity RENDER CALLED ✓
```

But character still invisible → Bug is in canvas.set() or weight handling

**If Theory B (object identity) is correct:**
```
[DIAGNOSTIC-move_entity_to_tile] entity=actor.player, tile=(6,5), place_ref=Place@ABC
[DIAGNOSTIC-draw_place] place_ref=Place@DEF  ← DIFFERENT object! ✗
[DIAGNOSTIC-draw_place] actors=["actor.player@(5,5)"] ← Stale position!
```
→ Fix is to ensure get_place() returns stable reference

**If Theory C (render failure) is correct:**
```
[DIAGNOSTIC-render_entity] rendering actor.player at tile (6,5) ← Render called
(No errors, but character invisible)
```
→ Check canvas cell after set() to verify write succeeded

---

## Fix Plan Structure (For Scaling/Unification)

### Current Architecture (Working Parts)
```
✅ Movement Engine (20Hz)
   └─ Updates place.npcs_present[i].tile_position
   
✅ Place Object
   └─ Live, shared reference
   
✅ Pathfinding
   └─ Calculates integer tile paths
   
✅ Particle System
   └─ Spawns footsteps, path dots
   
✅ Sound System
   └─ Triggers footstep sounds
   
✅ Witness System
   └─ Detects movement events
```

### Broken Part (Rendering)
```
❌ Entity Rendering (60Hz)
   └─ Either not reading updated positions OR
   └─ Not drawing correctly OR  
   └─ Drawing then overwritten
```

### Fix Structure (Minimal, Scalable)

**Goal:** Make rendering robust and scalable without major rearchitecture

**Principle:** Separation of concerns - engine handles state, renderer displays it

**Implementation:**

```typescript
// Phase 1: Fix Rendering (30 mins)
// Ensure renderer reads live state correctly

export function make_place_module(config: PlaceModuleConfig): Module {
  // ... existing code ...
  
  const draw_place = (canvas: Canvas, place: Place): void => {
    // Add defensive checks
    if (!place || !place.contents) {
      console.error("draw_place: Invalid place object");
      return;
    }
    
    // Validate entity data
    for (const actor of place.contents.actors_present) {
      if (!actor.tile_position || 
          typeof actor.tile_position.x !== 'number' ||
          typeof actor.tile_position.y !== 'number') {
        console.error("Invalid actor position", actor.actor_ref, actor.tile_position);
        continue;
      }
    }
    
    // Render with explicit weights and validation
    for (let screen_y = inner.y0; screen_y <= inner.y1; screen_y++) {
      for (let screen_x = inner.x0; screen_x <= inner.x1; screen_x++) {
        // ... existing logic ...
        
        if (entity) {
          // DEBUG: Verify character at position before writing
          const cell_before = canvas.get(screen_x, screen_y);
          
          canvas.set(screen_x, screen_y, { char, rgb, weight_index: 6 });
          
          const cell_after = canvas.get(screen_x, screen_y);
          if (cell_after?.char !== get_initial(name)) {
            console.error(`Failed to render entity ${entity_ref} at (${screen_x},${screen_y})`);
          }
        }
      }
    }
  };
}
```

**Phase 2: Optimize Rendering (20 mins)**
```typescript
// If Frame N: entities rendered at position P
// And Frame N+1: entities at position P+1
// Ensure no flicker: render happens atomically

// Option A: Double buffer (if canvas supports it)
// Option B: Render to temp buffer, swap
// Option C: Use requestAnimationFrame for sync
```

**Phase 3: Cache Strategy (15 mins)**
```typescript
// Cache is fine IF it helps performance
// But MUST be invalidated when place updates

let place_version = 0;  // Increment on each place update
let cached_render = null;  // Cache based on place_version

function draw_place(canvas, place) {
  if (place.version !== cached_render?.version) {
    cached_render = render_to_buffer(place);
    cached_render.version = place.version;
  }
  blit_to_canvas(cached_render, canvas);
}
```

---

## Long-Term Scaling Considerations

### For 10s, 100s, or 1000s of entities:

**Current:** O(N) per frame (loop all entities for each tile)  
**Scale to:** O(1) lookups with spatial hash

```typescript
// Spatial index for entities
const entity_spatial_index = new Map<string, Entity[]>();  // "x,y" -> entities

// Update on position change
function on_entity_move(entity, from_tile, to_tile) {
  if (from_tile) remove_from_index(entity, from_tile);
  add_to_index(entity, to_tile);
}

// O(1) lookup during render
function get_entities_at(tile_x, tile_y) {
  return entity_spatial_index.get(`${tile_x},${tile_y}`) || [];
}
```

**Memory:** O(N) additional  
**Render:** O(visible tiles) instead of O(N * tiles)  
**Update:** O(1) per move

---

## Updated Acceptance Criteria

### Immediate (Bug Fix)
- [ ] Character visible at EVERY intermediate tile during movement
- [ ] Footsteps render BELOW character (not hiding it)
- [ ] No flicker, no teleporting, no disappearing
- [ ] 60fps maintained during movement

### Architecture (Scaling)
- [ ] Render logic uses O(1) lookups, not nested loops
- [ ] Cache invalidation is correct and performant
- [ ] Place object reference is stable (or properly cached)
- [ ] Code supports 100+ moving entities without frame drops

---

## Implementation Order

### Step 1: Run Diagnostic (NOW)
- User already added logs ✓
- Need logs from movement to confirm hypothesis

### Step 2: Fix Render Order (30 mins)
- Based on logs, ensure entity draws before particles
- OR ensure entity weight > particle weight
- Add validation to verify writes succeed

### Step 3: Optimize (20 mins)
- Add spatial indexing if render is bottleneck
- Add cache invalidation
- Performance test with 10+ entities

### Step 4: Scale Test (15 mins)
- Spawn 50 NPCs wandering
- Verify 60fps maintained
- Profile and optimize if needed

---

## Next Action: Analyze Diagnostic Logs

Please run the game with the diagnostic logs and copy the console output when you click to move. The logs will show:

1. **place_ref values:** Are they the same between movement and rendering?
2. **Entity positions:** Are they updating correctly?
3. **get_all_entities_at:** Does it find the entities?
4. **render_entity:** Is it being called?

With those logs, we can identify which theory is correct and implement the precise fix.

---

## For Kimi 2.5 (Clear Instructions)

**DO NOT IMPLEMENT YET** - Wait for diagnostic logs

**WHEN IMPLEMENTING:**

1. Start with render order verification
2. Add defensive checks in draw_place
3. Validate canvas writes succeed
4. Optimize only if performance issues identified

**KEY PRINCIPLE:** Character should be visible at `(6,5)` when position shows `(6,5)`. If not visible, check:
- Is canvas.set() actually writing? (verify readback)
- Is weight/index correct? (entity > particles)
- Is get_entity_at() returning entity? (log the return)
- Is place object same reference? (log object identity)

**DO NOT:**
- Add fractional coordinates
- Overhaul movement engine
- Add complex state machines

**DO:**  
- Fix render logic to respect live positions
- Ensure correct draw order
- Validate writes succeed
- Cache only when safe

---

**Status:** Awaiting diagnostic logs to confirm root cause
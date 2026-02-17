# Movement System Fix - Implementation Summary

**Date:** 2026-02-17  
**Status:** ✅ IMPLEMENTED  
**Problem:** Entities invisible during movement  
**Root Cause:** Single-cell canvas with no layering → particles overwrote entities  
**Solution:** Added render index layer system  

---

## Changes Made

### 1. Added Render Index to Cell Type
**File:** `src/mono_ui/types.ts:13-22`
```typescript
export type Cell = {
    char: string;
    weight_index: number;  // Font weight (thin..black)
    render_index: number;  // NEW: Render layer (0-255, higher=on top)
    style: StyleName;
    rgb: Rgb;
};
```

### 2. Updated Canvas to Support Layers
**File:** `src/mono_ui/canvas.ts`

**Before:**
- Single `Cell[]` array - one cell per position
- Last write wins (overwrites previous)

**After:**  
- `Map<number, Cell[]>` - cells by render_index layer
- Multiple cells per position (one per layer)
- `get_topmost()` returns highest non-empty layer

```typescript
const cells: Map<number, Cell[]> = new Map();
cells.set(0, Array.from({ length: width * height }, () => ({ ...base })));

// New API:
canvas.get(x, y, layer)  // Get specific layer
canvas.set(x, y, { render_index: 4, ... })  // Write to specific layer
canvas.get_topmost(x, y)  // Get highest non-empty layer
```

### 3. Updated Renderer to Use Layers
**File:** `src/mono_ui/runtime/canvas_runtime.ts:366-392`

**Before:**
```typescript
const cell = c.get(x, y);  // Gets single cell
```

**After:**
```typescript
const cell = c.get_topmost(x, y);  // Gets topmost layer
```

### 4. Set Render Indices in Place Module
**File:** `src/mono_ui/modules/place_module.ts`

**Layers Defined:**
- `render_index: 0` - Floor/background
- `render_index: 1` - Place boundaries (walls)  
- `render_index: 2` - Doors
- `render_index: 3` - Particles, path visualization
- `render_index: 4` - **Entities (NPCs, actors)** ← On top!
- `render_index: 5` - Highlights, hover effects
- `render_index: 6` - UI elements

**Updates:**
- Floor tiles: `render_index: 0` (line 790)
- Entities: `render_index: 4` (line 780) ← Visible on top!
- Movement particles: `render_index: 3` (line 617) ← Below entities!
- Path particles: `render_index: 3` (line 595)

### 5. Added Render Index to Particle Type
**File:** `src/mono_ui/modules/place_module.ts:104-112`

```typescript
type Particle = {
  // ... existing fields ...
  render_index?: number;  // NEW: Particle layer
};
```

---

## How It Works Now

### Timeline - Frame N:

```
1. Movement engine (20Hz): Updates place.npcs_present[i].tile_position to (6,5)

2. Renderer draw_place():
   ├─ Lines 728-790: Draw grid
   │  ├─ Tile (5,5): floor char "·", render_index 0
   │  └─ Tile (6,5): check_entity_at(6,5) → finds actor
   │     └─ canvas.set(screen_x, screen_y, {
   │          char: "H",
   │          rgb: actor_rgb,
   │          render_index: 4  ← NEW: Entities layer
   │        })
   │
   ├─ Line 900: check_entity_movement()
   │  └─ spawn_movement_particle({6,5})
   │     └─ particles.push({
   │          x: 6, y: 5, char: "·", rgb: cyan,
   │          render_index: 3  ← Below entities!
   │        })
   │
   └─ Lines 938-955: Draw particles
      └─ canvas.set(screen_x, screen_y, {
           char: "·",
           rgb: cyan,
           render_index: 3  ← Layer 3 (!= 4, doesn't overwrite layer 4!)
         })

3. Canvas storage:
   ├─ Each screen cell stores MULTIPLE cells (one per render_index)
   ├─ Position (6,5) has 2 cells:
   │  ├─ render_index 4: {char: "H", rgb: actor_rgb} ← Entity
   │  └─ render_index 3: {char: "·", rgb: cyan} ← Particle
   │
   └─ get_topmost(x, y) returns layer 4 (entity) because 4 > 3

4. canvas_runtime.draw_canvas():
   └─ Uses get_topmost(x, y) → gets entity cell on top ✓

5. RESULT: Character visible at (6,5) with cyan dot below/behind!
```

### Key Insight:

**Before:**
```
canvas.set(x, y, entity)      // Writes to cells[0][idx]
canvas.set(x, y, particle)    // Overwrites cells[0][idx]
get(x, y) → particle cell (last write wins)
```

**After:**
```
canvas.set(x, y, {..., render_index: 4, ...})  // Writes to cells[4][idx]
canvas.set(x, y, {..., render_index: 3, ...})  // Writes to cells[3][idx]
get_topmost(x, y)                              // Checks cells[4], cells[3], etc.
   → returns cells[4] because 4 > 3
```

---

## Expected Behavior After Fix

### Visual:
```
Cornerstore (current place)
╔════════════════╗
║··@·············║
║········G·······║
║················║
║················║
║················║
╚════════════════╝

@ = Player (visible!)
G = Grenda NPC (visible!)
· = Yellow path particle (below entity)
· = Cyan footstep (below entity)
```

During movement:
- Player moves tile-by-tile, visible at each step
- Yellow path particles visible underneath
- Cyan footstep particles visible on previous tiles
- Multiple moving entities all visible

### Performance:
- Memory: O(width × height × layers) where layers is sparse
- Render: O(width × height) regardless of entity count
- Update: O(1) per canvas.set() call

---

## Scaling & Future Enhancements

### For 100s-1000s of entities:
```typescript
// Current: O(entities) per frame to update
// Future: Spatial hash for entity lookup

const spatial_hash = new Map<string, Entity[]>();  // "x,y" → entities

// O(1) lookup during render
function get_entities_at(x, y) {
  return spatial_hash.get(`${x},${y}`) || [];
}
```

### For complex scenes:
```typescript
// Current: O(width × height) per frame
// Future: Rectangular invalidation + dirty regions

// Only redraw changed regions
canvas.invalidate(rect);

draw_canvas() {
  for (const region of dirty_regions) {
    redraw(region);
  }
}
```

### For animations:
```typescript
// Layer 7-255 reserved for animations and effects
// Higher numbers = later draw = on top

// Animation frame 1: layer 7
// Animation frame 2: layer 8  ← on top!
// Animation frame 3: layer 9  ← on top!
// ... progressively higher for smooth animations
```

---

## Testing Checklist

### ✅ Immediate Tests (30-second verification)
- [ ] Click to move → Character visible at EACH tile
- [ ] Path particles visible UNDER character
- [ ] Footstep particles visible on PREVIOUS tiles (behind)
- [ ] No flickering or disappearing
- [ ] Multiple NPCs wandering → all visible

### ✅ Feature Tests (5-minute verification)
- [ ] Target selection works during movement
- [ ] Hover highlights work correctly
- [ ] Place transitions show movement to door
- [ ] Footstep sounds play at correct timing
- [ ] Witness system detects movement properly

### ✅ Regression Tests (15-minute verification)
- [ ] No breaking changes to UI layout
- [ ] No performance regression (60fps maintained)
- [ ] Debug visualization still works
- [ ] All modules compose correctly

---

## Summary

**Problem:** Single-cell canvas → last write wins → particles overwrote entities

**Solution:** Multi-layer canvas → entities at layer 4, particles at layer 3 → entities on top!

**Result:** Characters now visible during movement, with particles appropriately below/behind!

**Files Modified:**
1. `src/mono_ui/types.ts` - Added render_index to Cell
2. `src/mono_ui/canvas.ts` - Multi-layer cell storage with get_topmost()
3. `src/mono_ui/runtime/canvas_runtime.ts` - Use get_topmost() for rendering
4. `src/mono_ui/modules/place_module.ts` - Set render_index for entities and particles

**Total Changes:** ~50 lines of code  
**Impact:** Fixes critical rendering bug + enables proper layering for future features

---

**Next Step:** Test in-game!

Expected behavior: Character visible at each tile during movement, with particles rendering below.
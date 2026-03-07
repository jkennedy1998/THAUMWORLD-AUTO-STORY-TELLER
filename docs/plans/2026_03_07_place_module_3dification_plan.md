# Place Module 3Dification Plan (3-Layer World Z)

Date: 2026-03-07

## Intent

Evolve the current 2D top-down Place module into a 3D voxel-aware system while keeping the *player view and interaction* top-down.

We start with a constrained, fixed vertical extent:

- `z=0` "floor" layer (tiles)
- `z=1` "entity" layer (actors/NPCs/items that live on the walk plane)
- `z=2` "headspace" layer (overhead/air/experiments: projectiles, effects, hanging objects)

This is not a perspective renderer. World Z is treated as "height" for simulation + rendering layers. The camera remains orthographic top-down.

## Non-Goals (This Phase)

- No multi-height stairs/ramps or vertical movement constraints (walking stays at constant z).
- No isometric/perspective projection.
- No full voxel volume terrain editing UI inside the game client yet.
- No pressure/tilt gameplay from tablet input.

## Guiding Principles

- One source of truth for world contents per place.
- Rendering uses painter-style layered canvases (DOM) but shading/glyph choice uses the unified shader resolver.
- Selection/editing mirrors ASCII painter semantics: click resolves to (x,y) on the selected world layer; no implicit "pick topmost".
- Simulation math (distance, LOS, hearing) is 3D in helpers, even if walking stays 2D.
- Keep migration incremental: introduce 3D world coordinates without refactoring everything to 3D at once.

## Current Baseline (Repo)

- Place schema is 2D: `src/types/place.ts` uses `TilePosition {x,y}` and `tile_grid {width,height}`.
- Place view is 2D: `src/mono_ui/modules/place_module.ts` uses `ViewState {offset_x, offset_y, scale}`.
- Shader resolver exists and is already used by place module for many glyph decisions:
  - `src/render_shaders/resolver.ts`
  - `src/render_shaders/payload_builders.ts`
  - `src/render_shaders/render_queue.ts`
- Tile definition system already exists (definitions + tags + walkability/occlusion semantics):
  - `src/tile_storage/store.ts` (loads `local_data/shared/tiles/default_tiles.jsonc`)
  - `src/tile_storage/types.ts` (`walkable`, `blocks_sight`, `blocks_sound`, `tags`)
- Vision/hearing debug scaffolding already exists (2D today):
  - `src/mono_ui/vision_debugger.ts`
  - `src/npc_ai/cone_of_vision.ts`
- Painter has a working pattern for layered DOM rendering + clip masking:
  - `src/ascii_painter/voxel_dom_renderer.ts`

## Reuse Inventory (Avoid Rebuilding)

This plan must not create parallel systems for things that already exist:

- **Shading/glyph choice:** reuse `src/render_shaders/*` (do not add a second resolver).
- **Tile definitions:** reuse `src/tile_storage/*` (do not create a new tile definition DB).
- **Perception debug particles:** extend `src/mono_ui/vision_debugger.ts` (do not fork a second debug visualizer).
- **Layered DOM rendering:** reuse patterns from `src/ascii_painter/voxel_dom_renderer.ts` (do not invent a new coordinate system).

## Proposed Architecture

### A) World Data Model (Per Place)

Introduce a place-local world representation that is 3D-aware but starts with fixed Z height.

**Core types (conceptual):**

```ts
type VoxelPos = { x: number; y: number; z: 0|1|2 };

type VoxelCell = {
  kind: 'tile' | 'entity' | 'item' | 'empty';
  id: string;              // stable ref for shader + selection
  tags: any[];             // ordered tag instances (for shader + rules)
  occupying?: boolean;     // semantic: blocks movement at this voxel
  opaque?: boolean;        // semantic: blocks LOS at this voxel
};

type PlaceVoxelGrid3 = {
  width: number;
  height: number;
  get(x: number, y: number, z: 0|1|2): VoxelCell | null;
};
```

**Key separation:**

- World z (0/1/2) is height/space.
- Shader render layers (tiles/items/actors/particles/UI) remain a separate concept inside the shader system.

### B) Tiles (Authoritative Early)

We already have a tile definition system. The missing piece is **per-place tile instances**.

- Reuse `TileDefinition` from `src/tile_storage/types.ts`.
- Add per-place tile instance storage (a width×height grid for z=0).

Initial implementation can default-fill the tile grid with one tile id (e.g. `tile.stone_bricks`).
If that tile id does not exist yet, add it to `local_data/shared/tiles/default_tiles.jsonc` (as a `floor` tile).

### C) Occupancy Index (Per Place)

Build a cached occupancy index used by all subsystems:

- `blocks_movement(x,y,z)`
- `blocks_los(x,y,z)`

Use existing tile semantics as inputs:

- `blocks_movement` should be driven by tile `walkable === false` and/or explicit tags.
- `blocks_los` should be driven by tile `blocks_sight === true` and/or explicit tags.
- `blocks_sound` should be driven by tile `blocks_sound === true` and/or explicit tags.

Collision reads only the tiles/voxels the actor intersects (z fixed for walking).

### D) Rendering: Place DOM Layer Renderer

Render the place as three stacked canvas layers clipped to the place module rect.

- Use the same container pattern as painter (`#voxel_layers_container` + clip rect)
- Exactly 3 canvases for world z=0/1/2
- Each canvas is rendered from shaded `Cell` values derived from shader resolver

`place_module.ts` remains responsible for input + UI overlays (cursor, borders, debug), but the world visuals move to the layered renderer.

### E) Selection & Editing

Selection behavior matches ASCII painter:

- A `focus_z` (selected world layer) exists.
- Click resolves to `(tile_x, tile_y, focus_z)`.
- No implicit "pick topmost".

For now, `focus_z` is hard-set to the controlled actor's z (typically `z=1`).

### F) 3D Helpers for Simulation (Distance/LOS/Hearing)

Add shared helpers for 3D math:

- `dist3(a,b)` / `dist3_sq`
- `raycast3D` (initially axis-aligned or DDA; later upgraded)
- `sphere_intersection_with_plane(z=focus_z)` for debug rings

Vision and hearing become 3D-capable immediately:

- LOS uses `blocks_los` over 3D rays (for now, rays stay in `z=1` unless a use case needs otherwise)
- Hearing/broadcast ranges are 3D spheres; rendering shows intersection outlines on the focused plane
- Broadcast particles are culled when fully outside render distance

## Implementation Phases

Legend:

- [ ] incomplete
- [~] implemented (not fully integrated)
- [x] integrated + tested

### Phase 0: Decisions + Contracts

- [ ] Define world z semantics + constants (0/1/2)
- [ ] Define selection policy and confirm it matches painter
- [ ] Define `blocks_movement` vs `blocks_los` semantics
- [ ] Confirm initial LOS behavior: ray in actor plane (z=1) only

### Phase 1: Authoritative Tiles (z=0)

- [ ] Reuse `src/tile_storage/*` (no new tile definition system)
- [ ] Add per-place tile grid storage (instances) for z=0
- [ ] Add a default tile id for fill (e.g. `tile.stone_bricks`)
- [ ] Add `tile.stone_bricks` to `local_data/shared/tiles/default_tiles.jsonc` if missing
- [ ] Map rule semantics to existing fields: `walkable`, `blocks_sight`, `blocks_sound`, plus `tags`

### Phase 2: PlaceVoxelGrid3 view + Occupancy Index

- [ ] Implement `PlaceVoxelGrid3` for a place
- [ ] Implement cached occupancy index for blocks_movement + blocks_los
- [ ] Integrate collision checks to read `blocks_movement` from the index

### Phase 3: Place DOM Layer Renderer (3 canvases)

- [ ] Build a place-specific DOM renderer (3 layers) based on `VoxelDOMRenderer` architecture
- [ ] Clip and align to the place module viewport (type grid alignment)
- [ ] Render shaded cells for each world z

### Phase 4: Shader Integration for Tiles/Entities

- [ ] Extend existing shader tile payloads to carry tags/material context (no new resolver)
- [ ] Ensure entity/item shading works consistently across world z
- [ ] Add a reducer/compositor policy between shader layers and world layers

### Phase 5: 3D Vision/Hearing/Broadcast Debug

- [ ] Add shared 3D math helpers and use them in perception + debug
- [ ] LOS raycast uses `blocks_los`
- [ ] Hearing/broadcast use 3D distance + culling
- [ ] Add 3D debug visualization (outer bounds/intersection outlines)

## Risks / Watchouts

- Introducing tiles without a clear storage format can lock in a poor schema; keep it minimal but extensible.
- Avoid mixing "world z" with "shader render z".
- Ensure all per-place caches are invalidated deterministically when place contents change.
- Keep input selection deterministic (always focus plane).

## Acceptance Criteria (Milestone)

- A place renders as three clipped layers aligned to the type grid.
- `z=0` shows authoritative tiles (default stone bricks).
- `z=1` shows entities and items.
- Clicking edits/targets only the focused world layer.
- Collision reads `blocks_movement` from place occupancy index.
- LOS/hearing debug uses 3D helpers and culls out-of-range particles.

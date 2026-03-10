# Place Module 3Dification Plan (3-Layer World Z)

Date: 2026-03-07

## Intent

Evolve the current 2D top-down Place module into a 3D voxel-aware system while keeping the *player view and interaction* top-down.

We start with a constrained, fixed vertical extent:

- `z=0` "floor" layer (tiles only for now)
- `z=1` "entity" layer (tiles,actors/NPCs/items that live on the walk plane for testing)
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
- Keep two concepts separate:
  - **World Z** (0/1/2): which world-height canvas a voxel lives on.
  - **In-tile render ordering**: which thing wins when multiple things occupy the same (x,y,z) plane (e.g. 2 characters in same tile).
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

Important clarification:

- The existing render pass ordering (`tile > item > character > particle > ui`) is an **in-tile composition policy**.
- World Z is a separate axis. Each world-z canvas can still use an in-tile ordering when multiple things overlap.

In-tile overwrite ordering (within the same `(x,y,z)`):

- Tiles (exactly one per coordinate)
- Items (including piles/storage representation when multiple items occupy the coordinate)
- Characters (actors/NPCs). If 2+ characters share the same coordinate, they may flash between each other.
- Particles
- UI overlays

Interpretation:

- Earlier entries draw first and may be overwritten.
- Later entries draw last and "win" for the final visible cell at that coordinate.

Stacked character flash policy:

- Deterministic ordering: actor(s) before npc(s), then stable by ref/id.
- Flash period: 240ms.

`place_module.ts` remains responsible for input + UI overlays (cursor, borders, debug), but the world visuals move to the layered renderer.

Input routing note:

- DOM world layers should remain `pointer-events: none`.
  - All input continues to be handled by PlaceModule through the mono canvas.

### E) Selection & Editing

Selection behavior matches ASCII painter:

- A `focus_z` (selected world layer) exists.
- Click resolves to `(tile_x, tile_y, focus_z)`.
- No implicit "pick topmost".

For now:

- `focus_z` defaults to `z=1`.
- Mouse wheel cycles `focus_z` between `0..2`.
  - Wheel is reserved for layer selection (no zoom bound to wheel in Place module).
  - Wheel is clamped (no wrap/cycle).
- Clicks/edits always resolve to `(x,y,focus_z)`.

Targeting policy:

- If an entity/item is not on the focused layer, it is not targetable.

Focus z affordance (visual):

- Focus is communicated primarily through parallax separation between world-z canvases.
  - Non-focused layers transform so motion parallax makes the 3D stack readable.
  - Use the same parallax size/movement parameters as the ASCII painter.

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

- [x] Define world z semantics + constants (0/1/2) for the initial "zoo" test place:
  - `z=0` is fully filled with a single collidable tile type (the walk surface).
  - `z=1` is where characters stand and where items rest (they occupy the walk plane above the tile).
  - `z=2` is "air" reserved for later.
  - Footsteps are intended to render as particles on `z=0` (ground-attached effects).
- [x] Define selection policy: no implicit "pick topmost" (click resolves to focused world layer only).
- [x] Add focus layer control: mouse wheel cycles `focus_z` up/down in Place module (clamped to 0..2).
- [x] Confirm wheel binding: Place module wheel is reserved for layer selection (no zoom).
- [x] Define `blocks_movement` vs `blocks_los` semantics (tile vs entity vs item)
  - Initial semantics (zoo):
    - tiles:
      - movement: `OCCUPIES` on z=1 blocks movement; z=0 must have `OCCUPIES` to provide support (no holes)
      - LOS: `COVER` on z=1 blocks LOS (explicit tag for vision blocking)
    - entities: actors/NPCs block movement on z=1; they do not block LOS by default
    - items: items do not block movement or LOS by default
  - Implemented tag resolution (defs+deltas-safe) for movement/pathing:
    - `src/travel/movement.ts`
    - `src/shared/pathfinding.ts`
- [x] Confirm initial LOS behavior: ray in actor plane (z=1) only

### Phase 0.5: DOM Layer Lifecycle (Stability)

- [x] Define a single owner + lifecycle API for `#voxel_layers_container` in game mode:
  - Implemented shared ownership heartbeat + TTL cleanup:
    - `src/mono_ui/world_layers_owner.ts`
    - owners mark DOM roots with `data-world-layers-owner` (`place` / `painter`)
  - Place module touches owner every Draw; painter touches owner when it renders DOM layers.
  - Stale DOM roots are removed automatically when an owner stops touching (covers "hidden but still running" cases).
- [x] Efficiency constraint: reduce allocations and avoid waste when possible.
  - Reuse offscreen canvases for z=0/1/2 (no per-frame create/free) in `src/mono_ui/modules/place_module.ts`.
  - Reuse DOM-export `GridCell[][]` buffers and sync in-place (no per-frame object creation) in `src/mono_ui/modules/place_module.ts`.
  - Add per-layer content versioning so DOM renderer re-rasterizes only when cell content changes (transforms still update every frame):
    - `src/ascii_painter/voxel_dom_renderer.ts`
    - `src/mono_ui/place_dom_layers.ts`
  - Avoid redundant layer updates: PlaceModule only calls `set_layer_cells` when a layer's cells actually changed.
- [x] Deterministic alignment: one source of truth for mapping Place module tile rect -> DOM clip rect.
  - Implemented shared helper and wired in both game place + painter:
    - `src/mono_ui/runtime/dom_viewport.ts` (`compute_dom_viewport_for_rect`)
    - `src/mono_ui/modules/place_module.ts`
  - [x] Painter viewport math migrated to reuse the same helper:
    - `src/canvas_app/main.ts`

### Phase 0.6: Camera + Persistence (Maintainability)

- [~] Create a Place "camera" controller with the same settings/behaviors as the ASCII painter camera.
  - It drives Place module view (pan offsets) + layered DOM transforms.
  - Reuse the same helper logic as painter where possible so changes apply to both.
   - Current state: the camera behavior is integrated but split across:
     - `src/mono_ui/runtime/place_camera_controller.ts` (view state + persistence + shared tuning)
     - `src/mono_ui/runtime/canvas_runtime.ts` (Space+Drag routing)
     - `src/mono_ui/runtime/dom_viewport.ts` (viewport math)

Panning/interaction parity:

- Place panning should behave like the ASCII painter (space+drag / drag gestures), and should reuse the same helper code paths.
  - Goal: one sustainable implementation so future camera changes apply to both.

- [x] Space+Drag pans within Place (and does not trigger global UI pan).
  - Implemented routing in `src/mono_ui/runtime/canvas_runtime.ts`.

Persistence policy:

- Shared (global) across both programs (game + painter):
  - glyph sizing / base size
  - character spacing
  - leading
  - positional offsets
  - parallax parameters (size + motion)
- Per-program / per-module:
  - module position + size
  - module pan position

- [x] Persist Place view pan (offset_x/offset_y) per place id.
  - Implemented: `src/mono_ui/modules/place_module.ts` uses localStorage key prefix `thaumworld_place_view_state:`

- [x] Add a manual recovery control to re-center on the player.
  - Implemented debug button `CEN` (top right) in `src/canvas_app/app_state.ts` calling `place.debug_center_on_actor()`.

- [x] Persist focus plane (`focus_z`) for game place.
  - Implemented: `src/canvas_app/app_state.ts` localStorage key `thaumworld:place_focus_z:v1`

Implementation note (storage):

- Use shared storage keys for global tuning so painter and game stay in sync.
- Keep module layout/pan stored per module id (game modules vs painter modules).

Suggested implementation (align with existing code):

- Reuse the existing ASCII painter camera persistence key and helpers:
  - `src/ascii_painter/save_system.ts`
  - localStorage key: `thaumworld_ascii_painter_camera_config`
- Treat only the following fields as "shared global tuning" between painter and game:
  - `char_spacing_x`, `char_spacing_y`
  - `parallax_intensity`, `parallax_move_enabled`, `parallax_size_enabled`
  - `calibration` (positional offsets)
- Treat these as per-module/per-program (do not share across programs):
  - `pan_x`, `pan_y`
  - `focus_plane` / `focus_z`
  - module rect (position/size)

### Phase 1: Authoritative Tiles (z=0)

- [x] Reuse `src/tile_storage/*` (no new tile definition system)
- [~] Per-place tile instance grids already exist on Place (`tiles_z0` and `tiles`).
  - Ongoing work: ensure tiles are treated as defs+deltas (persist only `kind` + `tag_add/tag_remove`; never persist derived `tags/display_*`).
  - Server may still embed derived display/tags at response time for UI compatibility.
- [ ] Finalize authoritative z=0 semantics (server-owned mutations + persistence rules)
  - Map rule semantics to existing tile definition fields: `walkable`, `blocks_sight`, plus tags.

Storage preference:

- Prefer storing the tile grid inline on the Place (single source of truth) rather than splitting across multiple stores.
- Use the ASCII systems' saved data structures as inspiration for compact grid storage and deterministic reconstruction.

### Phase 2: PlaceVoxelGrid3 view + Occupancy Index

- [~] Implement `PlaceVoxelGrid3` for a place
  - Implemented minimal adapter over place tiles + occupancy index:
    - `src/place_storage/voxel_grid3.ts`
- [~] Implement cached occupancy index for blocks_movement + blocks_los
  - Implemented cached occupancy index for movement support/blocking:
    - `src/place_storage/occupancy_index.ts`
    - wired into `src/travel/movement.ts` and `src/shared/pathfinding.ts`
  - Updated LOS semantics: `COVER` tag blocks LOS (separate from movement).
- [~] Integrate collision checks to read `blocks_movement` from the index
  - Implemented for NPC movement + shared pathing:
    - `src/travel/movement.ts`
    - `src/shared/pathfinding.ts`

Initial movement semantics (zoo):

- Walking occurs on `z=1`.
- Movement is blocked by:
  - `z=0` tile below being non-walkable (`walkable === false`) and/or tags.
  - `z=1` occupants (actors/NPCs) marked as occupying.
- Items on `z=1` do not block movement by default.

### Phase 3: Place DOM Layer Renderer (3 canvases)

- [x] Build a place-specific DOM renderer (3 layers) based on `VoxelDOMRenderer` architecture
  - Implemented: `src/mono_ui/place_dom_layers.ts` + integration in `src/mono_ui/modules/place_module.ts`.
- [x] Clip and align to the place module viewport (type grid alignment)
  - Implemented via shared viewport helper + `#voxel_layers_container`.
- [~] Render shaded cells for each world z
  - Implemented: PlaceModule partitions requests into z=0/1/2 and renders each into DOM.
  - Optimized: DOM renderer re-rasterizes only when per-layer content versions change; transforms still update every frame.
  - TODO: incremental world draw into offscreen canvases (PlaceModule still draws full render queues each frame).

Ownership note:

- The layered DOM canvases represent the world/place. The Place system owns the DOM layer container lifecycle.
  - Implemented owner heartbeat + TTL cleanup to prevent stale canvases between mode switches.

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
- Ensure DOM layer mounts are tied to `place_id` changes (no stale layers when refreshing/switching places).
- Keep input selection deterministic (always focus plane).

## Acceptance Criteria (Milestone)

- A place renders as three clipped layers aligned to the type grid.
- `z=0` shows authoritative tiles (default stone bricks).
- `z=1` shows entities and items.
- Mouse wheel changes focused world layer (0/1/2) and click always targets only that layer.
- Clicking edits/targets only the focused world layer.
- Collision reads `blocks_movement` from place occupancy index.
- LOS/hearing debug uses 3D helpers and culls out-of-range particles.

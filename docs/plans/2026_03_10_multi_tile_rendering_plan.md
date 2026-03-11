# Multi Tile Rendering Plan (Body Models + Multi-Voxel Occupancy)

Date: 2026-03-10

## Intent

Support entities and tiles that occupy multiple voxels in the `(x,y,z)` matrix while remaining:

- deterministic (stable selection + stable composition)
- scalable (hundreds visible, thousands simulated)
- compatible with existing systems (tags, shader resolver, render queue, DOM world layers)

This is a dependency for realtime movement (multi-voxel traversal + collision) and for richer interaction semantics (hits/senses can target specific parts).

## Terminology

- **Voxel**: one cell in `(x,y,z)`.
- **Owner**: a single game object identity (actor/npc/tile-instance/item-instance).
- **Part**: a named sub-component of an owner (e.g. `body`, `head`, `trunk_mid`).
- **Body model**: the voxel footprint + part definitions for an owner.
- **Physical body model**: used for legality/collision/hits.
- **Render body model**: used for rendering; may vary per frame/tick for animation.
- **Anchor voxel**: the single voxel chosen as the owner's canonical focus point (camera pan + focus plane).

## Core Requirements

- A character's `body_model` is determined by its kind.
- A multi-voxel owner is legal only if *all* occupied voxels are legal.
- All connected voxels of a character (including `head` at `z+1`) block movement like the body.
- Multi-voxel tiles/structures are defined in the tile database (definition-time), and placed as instances in a place.
- Multi-voxel tiles/structures support direction/orientation.
- Rendering can represent high detail by allowing the shader system to vary glyph/color per part and per facing.
- Clicking any voxel of a multi-voxel owner should still target the same owner, but must preserve "where you clicked" (hit voxel + part).
- For camera targeting/panning, each owner must resolve to one anchor voxel.

## Non-Goals (This Plan)

- Final visuals (blend modes, palette quantization policy) beyond enabling the plumbing.
- Continuous physics; gravity/falling remains part of realtime movement plan.

## Existing Systems To Reuse

- Shader resolver + per-payload reduction:
  - `src/render_shaders/resolver.ts`
  - `src/render_shaders/reducer.ts` (`reduce_layers_to_cell`)
- Cross-renderable composition policy:
  - `src/render_shaders/render_queue.ts` (`draw_render_queue`)
- Place DOM world layer renderer (3 stacked canvases for world-z):
  - `src/mono_ui/place_dom_layers.ts`
  - `src/mono_ui/modules/place_module.ts`
  - `src/ascii_painter/voxel_dom_renderer.ts`

Already present and should be extended (not replaced):

- Tile-only occupancy + 3D tile adapter:
  - `src/place_storage/occupancy_index.ts` (tile-only; walking plane support)
  - `src/place_storage/voxel_grid3.ts` (`PlaceVoxelGrid3`; tile-only semantics)
- Facing direction system (for orientation transforms + render detail):
  - `src/npc_ai/facing_system.ts`

- Tag system (authoritative semantics; do not create a parallel tag set):
  - `src/tag_system/registry.ts`

## Architecture (Proposed)

### A) Body Model Definitions

Introduce a shared type for body models used by both characters and tile-instances.

Conceptual shape:

```ts
type BodyModelVoxel = {
  part: string;
  dx: number;
  dy: number;
  dz: number;
  // Tags contributed by this voxel of the owner.
  tags?: any[];
};

type BodyModelDef = {
  id: string;
  // Stable default pose used for collision/hits.
  physical: BodyModelVoxel[];
  // Optional render poses keyed by state/facing.
  // Render poses must remain within physical unless marked non_physical.
  render?: Record<string, BodyModelVoxel[]>;
};
```

Direction/orientation:

- Apply a transform to `(dx,dy)` based on facing when generating world voxels.
- `dz` is not rotated.

### A.1) Body Slots Representation (Characters)

Body slots remain stored on actors/NPCs as they are today (equipment/inventory).

Add a definition-time mapping (per kind) to relate body slots to body_model parts/voxels for UI and gameplay:

- A body slot may be represented by:
  - one part
  - multiple parts
  - multiple voxels across multiple z layers
- A displayed character may have multiple body slots (already true), and multiple body slots may map to the same part.

Required helper:

- Resolve clicked voxel/part to body slot(s):
  - `get_body_slots_for_character_hit(kind_id, hit_part, hit_voxel, facing) -> slot_names[]`

This helper should prefer stable part-based mappings over render-pose-dependent voxels.

### B) Multi-Voxel Occupancy Index

Extend the existing per-place occupancy cache to index *owners* and *parts* per voxel.

- `occupants_by_voxel["x_y_z"] -> Occupant[]`
- `Occupant = { owner_kind, owner_id, part, tags }`

Derived query helpers (examples):

- `blocks_movement(x,y,z)` if any occupant has `OCCUPIES`.
- `blocks_los(x,y,z)` if any occupant has `COVER`.
- `pick_interaction_target(x,y,z)` returns `(owner_kind, owner_id, part)` using a stable priority order.

Hit context:

- Queries should be able to return a hit context:
  - `hit = { owner_kind, owner_id, part, voxel:{x,y,z} }`
  - default actions may ignore `part` initially, but must be able to receive it.

### C) Rendering Across World-Z

Keep the current 3 world-z canvases. A multi-voxel owner emits render requests into each world-z layer for each occupied voxel.

Render payload/context additions (minimal):

- Add optional context fields used by shaders:
  - `ctx.body_part?: string`
  - `ctx.facing?: Direction`
  - `ctx.world_z?: number`

No compositor replacement: use `draw_render_queue` per world-z layer.

### D) Interaction, Sensing, Hits

Input resolves to `(x,y,focus_world_z)`.

- Query occupants at that voxel.
- Resolve to a hit context `{ owner_id, owner_kind, part, voxel }`.
- For now: any click on a character (any part/tile) may target the owner as a whole.
  - Still: preserve hit context so future combat/senses/UI can use it.
- Later: allow part-targeted actions using the same hit context.

Camera targeting note:

- When selecting an owner, the camera should use the owner's anchor voxel for pan and focus-z.

### E) Multi-Voxel Tiles / Structures

Tile definitions can declare body models (and facing-aware variants) for multi-voxel tiles.

Places store instances:

- `{ def_id, origin:{x,y,z}, facing, state }`

All voxels in the body model map back to the same instance id.

### F) Anchor Voxel (Camera Focus + Pan)

Each multi-voxel owner must resolve to a single anchor voxel used for:

- camera panning target
- camera focus plane (`focus_z`)

Rules:

- Default anchor is the owner's origin voxel.
- If the owner has an explicit anchor part (e.g. `body`), use the voxel for that part.
- Anchor selection must be deterministic and stable across frames.

## Implementation Phases

Legend:

- [ ] incomplete
- [~] implemented (not fully integrated)
- [x] integrated + tested (`npm run dev:logs`)

### Phase 0: Contracts + Types

- [x] Add `BodyModelDef` and helpers to a shared module (server+client safe)
- [~] Add `body_model_id` to kind definitions (or derive from kind id)
- [~] Add facing-aware transform helper (rotate/mirror) for `(dx,dy)`

- [~] Add body slot representation mapping to kind definitions (slot -> parts/voxels)
- [~] Add `get_body_slots_for_character_hit(...)` helper

- [ ] Define anchor voxel rules and add helper:
  - `get_owner_anchor_voxel(owner_kind, owner_state) -> {x,y,z}`

Extension constraints:

- This plan must extend `src/place_storage/occupancy_index.ts` and `src/place_storage/voxel_grid3.ts` rather than creating parallel occupancy/grid code.

### Phase 1: Character Body Models

- [~] Resolve character body model from kind id (actors + npcs)
- [x] Default implementation: 2-voxel vertical stack (`body` at `dz=0`, `head` at `dz=+1`)
- [x] Ensure both voxels contribute `OCCUPIES` so movement is blocked by head too

- [~] Ensure character selection returns hit context (part + voxel), even if action targets owner

### Phase 2: Occupancy Index v2 (Owners + Parts)

- [~] Extend `src/place_storage/occupancy_index.ts` to include occupant owner_id + part tags per voxel (keep tile-only fast-path)
- [~] Update movement/pathing collision queries to consult multi-voxel occupancy
- [x] Update LOS queries to consult multi-voxel occupancy where appropriate

- [~] Add hit-context query helper returning `{ owner_id, owner_kind, part, voxel }`

### Phase 3: Place Rendering (Multi-Voxel Characters)

- [x] When building Place render queues, emit character render requests for each voxel of the render body model
- [x] Pass `ctx.body_part`, `ctx.facing`, and `ctx.world_z` into payload resolution
- [~] Ensure character-collision flashing remains coherent across all parts (choose one owner, draw all its voxels)

### Phase 4: Interaction Routing

- [~] When selecting/hovering at `(x,y,z)`, surface hit context (owner + part + voxel)
- [ ] Default actions target the owner; allow optional part-targeted actions later
- [x] Ensure range gating checks the specific voxel targeted (strict adjacency + multi-voxel owner touch)

- [x] Ensure container grid moves work for place.* containers via `POST /api/transfer`

- [ ] Add helper to find body slot(s) for a character hit, and use it for UI highlighting

### Phase 5: Multi-Voxel Tiles / Structures

- [~] Extend tile definition schema to optionally define a `body_model`
- [~] Add place-level instances for multi-voxel tiles/structures (origin + facing + state)
- [~] Route interactions from any occupied voxel to the same instance id (e.g. 2-wide chest)

- [ ] Treat each occupied voxel as a distinct `part` by default for tiles/structures (supports per-tile behaviors)

### Phase 6: Animation Safety

- [ ] Split physical vs render body model evaluation
- [ ] Define rules for when physical shape may change (tick boundaries only)
- [ ] Ensure hits/senses use physical; rendering uses render

### Phase 6.5: Camera Targeting Compatibility

- [~] Ensure selecting an owner resolves to an anchor voxel for pan + focus-z
- [ ] Ensure the anchor voxel is stable under animation

### Phase 7: Performance + Caching

- [ ] Incremental occupancy rebuild per owner change (move, rotate, state change)
- [ ] Avoid per-frame allocations when emitting per-voxel render requests
- [ ] Stress scene: 100 multi-voxel characters visible without frame drops

## Devlog Verification (npm run dev:logs)

- [~] `MULTITILE_TEST PASS actor occupies head voxel` (occupancy shows `dz=+1` occupied)
- [ ] `MULTITILE_TEST PASS head voxel blocks movement` (attempt to path into head voxel is rejected)
- [~] `MULTITILE_TEST PASS head voxel render present` (upper world-z layer shows head glyph)
- [~] `MULTITILE_TEST PASS interaction resolves hit context` (log shows owner id + part + voxel when clicking head)
- [~] `MULTITILE_TEST PASS anchor voxel resolved` (log shows anchor voxel used for camera targeting)

## Notes

- DOM world layer rendering remains the world-z mechanism; multi-voxel is an *owner->many voxels* mechanism.
- Advanced composition (blending/tinting/quantization) stays in `docs/plans/2026_03_07_advanced_rendering_plan.md` unless needed for correctness.

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

## Core Requirements

- A character's `body_model` is determined by its kind.
- A multi-voxel owner is legal only if *all* occupied voxels are legal.
- All connected voxels of a character (including `head` at `z+1`) block movement like the body.
- Multi-voxel tiles/structures are defined in the tile database (definition-time), and placed as instances in a place.
- Multi-voxel tiles/structures support direction/orientation.
- Rendering can represent high detail by allowing the shader system to vary glyph/color per part and per facing.

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

### B) Multi-Voxel Occupancy Index

Extend the per-place occupancy cache to index *owners* and *parts* per voxel.

- `occupants_by_voxel["x_y_z"] -> Occupant[]`
- `Occupant = { owner_kind, owner_id, part, tags }`

Derived query helpers (examples):

- `blocks_movement(x,y,z)` if any occupant has `OCCUPIES`.
- `blocks_los(x,y,z)` if any occupant has `COVER`.
- `pick_interaction_target(x,y,z)` returns `(owner_kind, owner_id, part)` using a stable priority order.

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
- Default interaction targets the owner id.
- Optional: pass `part` through to action logic for targeted effects.

### E) Multi-Voxel Tiles / Structures

Tile definitions can declare body models (and facing-aware variants) for multi-voxel tiles.

Places store instances:

- `{ def_id, origin:{x,y,z}, facing, state }`

All voxels in the body model map back to the same instance id.

## Implementation Phases

Legend:

- [ ] incomplete
- [~] implemented (not fully integrated)
- [x] integrated + tested (`npm run dev:logs`)

### Phase 0: Contracts + Types

- [ ] Add `BodyModelDef` and helpers to a shared module (server+client safe)
- [ ] Add `body_model_id` to kind definitions (or derive from kind id)
- [ ] Add facing-aware transform helper (rotate/mirror) for `(dx,dy)`

### Phase 1: Character Body Models

- [ ] Resolve character body model from kind id (actors + npcs)
- [ ] Default implementation: 2-voxel vertical stack (`body` at `dz=0`, `head` at `dz=+1`)
- [ ] Ensure both voxels contribute `OCCUPIES` so movement is blocked by head too

### Phase 2: Occupancy Index v2 (Owners + Parts)

- [ ] Extend occupancy index to include occupant owner_id + part tags per voxel
- [ ] Update movement/pathing collision queries to consult multi-voxel occupancy
- [ ] Update LOS queries to consult multi-voxel occupancy where appropriate

### Phase 3: Place Rendering (Multi-Voxel Characters)

- [ ] When building Place render queues, emit character render requests for each voxel of the render body model
- [ ] Pass `ctx.body_part`, `ctx.facing`, and `ctx.world_z` into payload resolution
- [ ] Ensure character-collision flashing remains coherent across all parts (choose one owner, draw all its voxels)

### Phase 4: Interaction Routing

- [ ] When selecting/hovering at `(x,y,z)`, surface both the owner and the part
- [ ] Default actions target the owner; allow optional part-targeted actions later
- [ ] Ensure range gating checks the specific voxel targeted (already 3D in place + API)

### Phase 5: Multi-Voxel Tiles / Structures

- [ ] Extend tile definition schema to optionally define a `body_model`
- [ ] Add place-level instances for multi-voxel tiles/structures (origin + facing + state)
- [ ] Route interactions from any occupied voxel to the same instance id (e.g. 2-wide chest)

### Phase 6: Animation Safety

- [ ] Split physical vs render body model evaluation
- [ ] Define rules for when physical shape may change (tick boundaries only)
- [ ] Ensure hits/senses use physical; rendering uses render

### Phase 7: Performance + Caching

- [ ] Incremental occupancy rebuild per owner change (move, rotate, state change)
- [ ] Avoid per-frame allocations when emitting per-voxel render requests
- [ ] Stress scene: 100 multi-voxel characters visible without frame drops

## Devlog Verification (npm run dev:logs)

- [ ] `MULTITILE_TEST PASS actor occupies head voxel` (occupancy shows `dz=+1` occupied)
- [ ] `MULTITILE_TEST PASS head voxel blocks movement` (attempt to path into head voxel is rejected)
- [ ] `MULTITILE_TEST PASS head voxel render present` (upper world-z layer shows head glyph)
- [ ] `MULTITILE_TEST PASS interaction resolves owner+part` (log shows owner id + part when clicking head)

## Notes

- DOM world layer rendering remains the world-z mechanism; multi-voxel is an *owner->many voxels* mechanism.
- Advanced composition (blending/tinting/quantization) stays in `docs/plans/2026_03_07_advanced_rendering_plan.md` unless needed for correctness.

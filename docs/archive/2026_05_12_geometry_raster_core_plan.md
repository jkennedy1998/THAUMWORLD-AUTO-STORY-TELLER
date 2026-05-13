# Geometry Raster Core Plan

Date: 2026-05-12

## Intent

Refine the new `src/shared/geometry/` seam around a simpler and more general center of gravity:

- `Raster2<T>`
- `Raster3<T>`

The goal is to avoid prematurely baking the seam around ad hoc sparse helper return types while still preserving existing working helpers during migration.

This plan does **not** require immediate large rewrites.
It describes the intended next architecture and a safe migration path from the current modules:

- `src/shared/geometry/shape3d.ts`
- `src/shared/geometry/plane_raster.ts`
- `src/shared/geometry/voxel_raster.ts`

## Why This Follow-up Plan Exists

The current seam is already useful, but its result forms are mixed:

- point arrays
- voxel arrays
- `Set<string>` keyed outputs
- per-plane keyed projections

That is workable for early extraction, but it is not yet a clean general geometry substrate.

The key design question is:

> should geometry center on many shape-specific sparse outputs, or on a smaller set of general raster containers?

Current direction: prefer a more general raster-centered design.

## Core Decision

Treat dense rasters as the main shared geometry container family:

- `Raster2<T>` for bounded 2D cell data
- `Raster3<T>` for bounded 3D voxel data

Sparse outputs should remain allowed, but they should be treated as:

- derived views
- convenience extraction helpers
- compatibility outputs where still useful

not the main organizing abstraction for the seam.

## Why Raster-Centered Is Preferred

A raster-centered seam supports more than binary masks.
It can represent:

- masks
- fills
- shell/outline occupancy
- selection buffers
- IDs/material indices
- temporary work buffers
- debug intensity or annotation layers

This makes `Raster2<T>` / `Raster3<T>` more general than naming the whole seam around masks.

## Naming Direction

Preferred general container names:

- `Raster2<T>`
- `Raster3<T>`

Optional semantic aliases can exist later if useful, for example:

- `type Mask2 = Raster2<boolean>`
- `type Mask3 = Raster3<boolean>`

But `Mask` should be treated as a use-case, not the core container concept.

## Proposed Sub-layout

Recommended next target layout under `src/shared/geometry/`:

- `README.md`
- `raster2.ts`
- `raster3.ts`
- `raster_ops2.ts`
- `raster_ops3.ts`
- `plane_bridge.ts`
- `shapes.ts`

This is intentionally small.
It leaves room for future splits without requiring them now.

## Ownership by File

### `raster2.ts`

Owns the core bounded 2D container and basic access helpers.

Likely contents:

- `Raster2<T>`
- `create_raster2(...)`
- `raster2_index(...)`
- `raster2_in_bounds(...)`
- `raster2_get(...)`
- `raster2_set(...)`

### `raster3.ts`

Owns the core bounded 3D container and basic access helpers.

Likely contents:

- `Raster3<T>`
- `create_raster3(...)`
- `raster3_index(...)`
- `raster3_in_bounds(...)`
- `raster3_get(...)`
- `raster3_set(...)`

### `raster_ops2.ts`

Owns discrete 2D raster helpers and shape-writing logic.

Current function mapping:

- `normalize_rect_2d(...)`
- `get_line_points(...)`
- `get_rect_stroke_points(...)`
- `get_rect_fill_points(...)`

These can stay in point-array form initially, then gain `Raster2` writing variants later.

### `raster_ops3.ts`

Owns discrete voxel raster helpers and neighborhood/fill traversal.

Current function mapping:

- `get_line_voxels_3d(...)`
- `get_flood_fill_voxels(...)`

Also owns related internal traversal helpers.

### `plane_bridge.ts`

Owns repo-specific bridging between plane-local 2D coordinates and world voxel coordinates.

Current function mapping:

- `get_line_plane_points(...)`
- `get_rect_stroke_plane_points(...)`
- `get_rect_fill_plane_points(...)`
- `map_plane_points_to_voxels(...)`

### `shapes.ts`

Owns higher-level shape/projection helpers.

Current function mapping:

- `get_circle_outline_keys(...)`
- `get_sphere_outline_plane_slices(...)`
- `project_vision_cone_to_planes(...)`

Longer term, some projection-oriented helpers may split further, but that is not required now.

## Current Module Interpretation

The current modules are still acceptable as transitional surfaces:

- `plane_raster.ts` ≈ `raster_ops2 + plane_bridge`
- `voxel_raster.ts` ≈ `raster_ops3`
- `shape3d.ts` ≈ `shapes`

This means we do **not** need to rush another cleanup move immediately.
The conceptual plan can be clearer than the current physical split for a while.

## Minimal Data Model Sketch

The likely minimum starting point is:

```ts
export type Raster2<T> = {
  origin: { x: number; y: number };
  width: number;
  height: number;
  data: T[];
};

export type Raster3<T> = {
  origin: { x: number; y: number; z: number };
  width: number;
  height: number;
  depth: number;
  data: T[];
};
```

This should stay intentionally small at first.
Typed-array specialization can be added later if justified by real usage.

## Migration Strategy

### Phase 1 - clarify without broad breakage

- keep the existing three geometry modules working
- document the raster-centered direction
- avoid locking in many new ad hoc output forms

### Phase 2 - add core containers

- introduce `raster2.ts`
- introduce `raster3.ts`
- add only minimal create/get/set/index/in-bounds helpers

### Phase 3 - add adapters, not rewrites

- add helpers to extract active points/voxels from rasters
- add helpers that draw current primitives into rasters
- keep existing point/voxel array helpers as compatibility surfaces where useful

### Phase 4 - reshape current modules around ownership

- split or rename modules only when the container APIs are proven
- move plane/world bridging into `plane_bridge.ts`
- move higher-level shape logic toward `shapes.ts`

### Phase 5 - migrate consumers opportunistically

Likely consumers over time:

- painter tools
- painter canvas module
- vision/sense visualizers
- future template/targeting helpers

No broad migration should happen until the core container API feels obviously useful.

## Non-goals

For now, do **not**:

- force all geometry helpers to return dense rasters immediately
- remove sparse helpers just because a raster core exists
- over-design boolean/int/byte-specialized raster families too early
- merge `geometry` back down into `math3d`
- move rendering or gameplay semantics into geometry

## Open Questions

- Should `Raster2<T>` / `Raster3<T>` start with plain arrays, typed arrays, or support both?
- Should first-class sparse extraction helpers live beside the raster containers or in the ops files?
- Should current `Set<string>` shape outputs be replaced before or after raster containers land?
- How much of current vision-cone projection should remain in a generic `shapes.ts` surface versus a later dedicated projection file?

## Initial Definition of Done

This follow-up plan is successful when:

- the seam has a clearly documented raster-centered direction
- the repo keeps the current extracted modules stable
- `Raster2<T>` / `Raster3<T>` are introduced in a minimal way
- future geometry migrations can target a small, shared container model instead of inventing new output forms each time

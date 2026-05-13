# geometry

Colocated README for the encapsulated shared geometry seam.

Shared spatial/shape seam for `shared`, gameplay/runtime, debug tools, and ASCII painter consumers.

## Purpose

Owns pure geometry generation, projection, slicing, and rasterization helpers that should be reused across the repo.

It exists to prevent duplicate shape logic from spreading across painter code, debug visualization code, and gameplay-adjacent systems.

## Owns

- shared analytic shape helpers
- shared raster geometry helpers
- shape slicing/projection helpers
- shared outline/fill/shell/volume generation rules
- canonical geometry-oriented result forms used by multiple consumers
- compatibility migration targets for geometry logic currently living outside this seam

## Does not own

- low-level vector/grid traversal substrate owned by `../math3d.ts`
- coordinate vocabulary owned by `../coords.ts` and `../plane_coords.ts`
- painter drag/session/tool state
- DOM/canvas/particle rendering
- gameplay semantics such as awareness, targeting, or perception policy
- actor/NPC/world persistence
- app-specific debug logging

## How to talk to it

### Internal code

Geometry callers should import pure helpers from this folder.

Current first migrated helper surfaces:
- `./shape3d.ts`
- `./plane_raster.ts`
- `./voxel_raster.ts`

Expected usage style:
- pass explicit numeric coordinates and dimensions
- prefer shared coordinate vocabulary where practical
- receive pure geometry outputs such as keys, plane slices, projected sets, or voxel/cell collections
- keep consumer-specific interpretation outside this seam

### Coordinate/result conventions

- `geometry` may depend on `coords`, `plane_coords`, and `math3d`
- `math3d` should not depend on `geometry`
- result shapes should stay consumer-neutral and side-effect free
- outline/fill/shell/volume semantics belong here when they are reusable geometry behavior rather than UI/gameplay policy

## Dependencies

- `../coords.ts`
- `../plane_coords.ts`
- `../math3d.ts`
- other small shared math/data helpers when they remain consumer-neutral

## Side effects

None.

## Notes

This seam is intentionally beginning with a very small migration slice.

Current repo alignment:
- `math3d` remains the low-level numeric/traversal substrate
- `geometry` is the higher-level shared shape/projection/raster seam
- domain systems should increasingly consume this folder rather than owning duplicate shape logic

The initial implementation starts by moving proto-geometry helpers out of `src/shared/shape3d.ts` and shared plane/voxel raster helpers out of `src/shared/painter_tools.ts` into this seam while preserving compatibility exports during migration.

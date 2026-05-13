# Geometry Encapsulation Plan

Date: 2026-05-12

## Intent

Create a shared, encapsulated `geometry` seam for THAUMWORLD that can be used by both gameplay systems and the ASCII painter.

This plan now serves as the single canonical geometry plan.
It combines:

- seam and ownership direction
- current extraction status
- raster-core data-model direction
- target module layout
- migration guidance

It still does **not** commit to broad final APIs yet.
It still should avoid over-designing the seam too early.

Initial implementation has already started with a very small migration slice:

- `src/shared/geometry/README.md`
- `src/shared/geometry/shape3d.ts`
- `src/shared/geometry/plane_raster.ts`
- `src/shared/geometry/voxel_raster.ts`
- compatibility re-export preserved in `src/shared/shape3d.ts`
- compatibility exports preserved in `src/shared/painter_tools.ts` for migrated plane/voxel raster helpers

## Why This Exists

The repo now has multiple places that either already generate shape-like data or are trending toward it:

- painter 2D rectangle tools
- painter 3D rectangle tools
- debug sight visualization
- debug sound/sense visualization
- gameplay-facing spatial checks and templates
- reusable 3D helper work recently started around visualizers
- existing low-level 3D/grid traversal math already centralized in `src/shared/math3d.ts`
- existing coordinate/plane vocabulary already centralized in `src/shared/coords.ts` and `src/shared/plane_coords.ts`

These are all signs that the repo wants one shared geometry layer rather than several domain-specific shape implementations.

If we do not establish that seam now, shape logic will continue to spread across:

- painter-specific code
- debug visualization code
- gameplay code
- perception/LOS helper code

That would make consistency, reuse, and future shape expansion harder.

## Guiding Example

We already have a recent example of the intended style in:

- `src/interface_program/target/README.md`

That folder-level README is the model for the `geometry` seam:

- small and explicit
- colocated with the code it describes
- clear about ownership boundaries
- clear about how other code should use it
- clear about what it does **not** own

`geometry` should follow that same pattern.

## Proposed Seam

Primary home:

- `src/shared/geometry/`

This should become the shared home for pure spatial/shape logic that is meant to be consumed by:

- gameplay/runtime
- interface/debug tools
- ASCII painter
- future targeting/template systems

This seam should be introduced as a **sibling** to `src/shared/math3d.ts`, not as a replacement for it.

## Core Principle

`geometry` is a **pure shared math/data seam**.

It should generate, transform, project, rasterize, and describe geometry.

It should **not** decide gameplay meaning.
It should **not** render.
It should **not** own editor interaction state.

The preferred architecture is a split between:

- **analytic geometry**
- **raster geometry**

`math3d` remains the lower-level substrate beneath that seam where appropriate.

## What Geometry Should Own

At the concept level, `geometry` should own:

- shape vocabulary
- 2D primitive geometry
- 3D primitive geometry
- geometry helpers and shared geometric operations
- shape rasterization rules
- outline vs fill vs shell vs volume semantics
- projection/slice helpers
- bounds helpers
- shape metadata and canonical result forms
- stable geometry conventions used across the repo

Examples of likely owned concepts:

- points
- line segments
- rectangles
- boxes / rectangular prisms
- circles
- spheres
- cylinders
- cones / frustums
- 2D slices of 3D shapes
- footprints and outlines
- voxel/cell occupancy derived from primitives

## What Geometry Should Not Own

`geometry` should not own:

- painter drag/session state
- painter UX and tool mode state
- DOM/canvas/particle rendering
- place-module behavior
- perception policy
- awareness rules
- targeting rules
- LOS authority decisions as game rules
- actor/NPC/world persistence
- app-specific debug logging

Those systems may **use** geometry, but geometry should remain neutral.

## Desired Qualities

The seam should be:

- pure
- low-dependency
- consumer-neutral
- easy to document
- easy to test
- stable in vocabulary
- usable from both 2D and 3D workflows
- explicit about coordinate assumptions

## Documentation Strategy

The `geometry` seam should be documented the same way `target` was documented:

- a colocated folder-level `README.md`
- short, authoritative, and boundary-focused
- written before or alongside implementation extraction

The README should likely use the same sections as `src/interface_program/target/README.md`:

- `# geometry`
- short descriptor line
- `## Purpose`
- `## Owns`
- `## Does not own`
- `## How to talk to it`
- `## Dependencies`
- `## Side effects`
- `## Notes`

## Current Repo Reality

The repo already shows an emerging three-level stack.

### 1. Low-level numeric/traversal math

Current strongest example:

- `src/shared/math3d.ts`

This currently behaves like a low-level substrate for:

- vector-ish helpers
- distance helpers
- normalization
- 2D grid line traversal
- 3D voxel ray traversal
- 3D voxel line traversal
- low-level sphere/plane intersection math

This should remain a foundational dependency layer rather than being absorbed wholesale into `geometry`.

### 2. Mid-level shape/projection logic

Current strongest examples:

- `src/shared/shape3d.ts`
- reusable parts of `src/shared/painter_tools.ts`

This layer is where shape-aware logic is already emerging, such as:

- circle outlines
- sphere plane slices
- cone projection
- plane-mapped raster outputs
- rectangle stroke/fill generation
- geometry-aware mapping between plane points and voxels

This is the material that most naturally wants to consolidate under `src/shared/geometry/`.

### 3. Domain consumers

Current consumers include:

- `src/mono_ui/vision_debugger.ts`
- `src/canvas_app/app_state.ts`
- `src/npc_ai/cone_of_vision.ts`
- body/occupancy and projection systems elsewhere in `src/shared/` and `src/mono_ui/`

These systems use geometry-like concepts, but they should not define the shared geometry seam.

They should increasingly become consumers of `geometry` rather than owners of duplicate shape logic.

## Architectural Direction

### 0. Analytic geometry first, raster geometry second

The seam should not be defined only as a collection of tile/voxel generators.

Instead, it should be structured in two related layers:

#### Analytic geometry

Owns canonical shape definitions and shape-aware geometric operations.

Examples:

- point
- line segment
- rectangle
- box
- circle
- sphere
- cylinder
- cone / frustum
- bounds
- plane intersections
- containment/intersection helpers
- projection helpers

This layer should describe geometry in a reusable, consumer-neutral way.

#### Raster geometry

Owns conversion of analytic geometry into discrete outputs used by current systems.

Examples:

- 2D cell sets
- 3D voxel sets
- outlines
- fills
- shells
- per-plane slices
- footprints

This is the layer most directly consumed by painter previews, debug overlays, and some gameplay queries.

#### Why this split matters

If `geometry` only returns rasterized cells, higher-level shape reasoning will get reimplemented elsewhere.

The analytic/raster split gives us:

- shared canonical shape definitions
- a better home for future shape specs
- cleaner support for projections and slicing
- stronger reuse across painter, gameplay, and debug consumers
- room for future standard geometry inputs without redesigning the seam

### 1. One shared geometry vocabulary

We should avoid separate vocabularies for:

- painter shapes
- gameplay volumes
- debug overlays

Even if APIs differ later, the underlying concepts should align.

Terms should be consistent across the seam, such as:

- outline
- fill
- shell
- volume
- slice
- footprint
- bounds
- origin
- extent
- projection

### 2. Geometry produces data, not behavior

The seam should return shape data and metadata.

That may include both:

- analytic shape descriptions and helper results
- rasterized cell/voxel/slice results

Examples of downstream consumers:

- painter decides what to paint
- debug visualizers decide what to render
- gameplay systems decide what to query or validate

### 3. 2D and 3D should be related, not siloed

We should plan for 2D and 3D to share conventions and vocabulary.

That does **not** necessarily mean every 2D shape must be implemented as a 3D shape.
But it does mean they should feel like parts of one geometry system rather than two unrelated subsystems.

### 4. Primitive geometry should be separated from domain-specific geometry

Primitive/shared geometry concepts:

- line
- rectangle
- box
- circle
- sphere
- cone
- cylinder

Shared geometry operations:

- bounds
- intersection
- containment
- projection
- slicing
- rasterization

Domain-shaped uses built on top of primitives:

- vision cone visualization
- hearing range visualization
- painter brush previews
- targeting templates
- area-of-effect helpers

This distinction should be preserved in both docs and code organization.

### 5. Geometry should be able to accept standard geometry inputs later

A major benefit of the analytic layer is that it creates a future home for standard or normalized shape representations.

We do not need to decide those representations now, but this seam should leave room for:

- canonical internal shape specs
- normalized bounds/origin-based shape descriptions
- future import/adaptation of external geometry-style inputs

That future-facing flexibility is one reason not to define the seam as raster-only.

## Current Extracted Modules

The first concrete extracted geometry modules are:

- `src/shared/geometry/shape3d.ts`
- `src/shared/geometry/plane_raster.ts`
- `src/shared/geometry/voxel_raster.ts`

These are useful and valid, but still transitional.

### Current result-form reality

The current seam already works, but its result forms are mixed:

- point arrays
- voxel arrays
- `Set<string>` keyed outputs
- per-plane keyed projections

That is acceptable for the initial migration slice.
It is not yet the cleanest general geometry substrate.

## Core Data Model Direction

The preferred longer-term center of gravity is a small raster container family:

- `Raster2<T>`
- `Raster3<T>`

This does **not** mean sparse outputs are forbidden.
It means sparse outputs should be treated as:

- derived views
- extraction helpers
- compatibility outputs where useful

rather than the main organizing abstraction for the seam.

### Why raster-centered is preferred

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

### Naming direction

Preferred general container names:

- `Raster2<T>`
- `Raster3<T>`

Optional semantic aliases can exist later if useful, for example:

- `type Mask2 = Raster2<boolean>`
- `type Mask3 = Raster3<boolean>`

But `Mask` should be treated as a use-case, not the core container concept.

### Minimal data model sketch

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

## Coordinate And Contract Questions To Settle Later

### 1. Coordinate contract

Need one clear contract for:

- integer cell/voxel coordinates
- world-space vs plane-space
- inclusive vs exclusive bounds
- origin-based vs bounds-based shape definition
- plane index vs world z

### 2. Canonical result forms

Need a stable answer for what geometry returns.
Likely categories include:

- analytic shape descriptions
- helper/query results
- full cell/voxel sets
- outline/shell sets
- per-plane slices
- bounds
- shape metadata

### 3. Geometry vs `math3d`

Need a clean split between low-level math and higher-level geometry ownership.

Current direction:

- `math3d` remains low-level numeric/vector/raycast/intersection support
- `geometry` owns shape definitions, geometry-aware helpers, projection, and rasterization

### 4. Shape spec representation

At some point we may want a stable shape-spec layer so multiple systems can describe shapes in the same way.

Examples:

- 2D rectangle spec
- 3D box spec
- sphere spec
- cone spec

That should be treated as a later design decision, not an assumption baked in too early.

### 5. Placement of adapters

Open question:

- should painter/debug/gameplay adapters live inside `geometry`
- or next to their consuming systems

Current leaning: keep consumer adapters near consumers unless there is a strong reason to centralize them.
That keeps `geometry` cleaner.

## Target Sub-layout

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

## Current-to-Target Mapping

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

### Current module interpretation

The current modules are still acceptable as transitional surfaces:

- `plane_raster.ts` ≈ `raster_ops2 + plane_bridge`
- `voxel_raster.ts` ≈ `raster_ops3`
- `shape3d.ts` ≈ `shapes`

This means we do **not** need to rush another cleanup move immediately.
The conceptual plan can be clearer than the current physical split for a while.

## Folder Shape Direction

Without locking in exact files beyond the target direction above, the seam likely wants this kind of internal separation:

- analytic primitives
- geometry helpers / operations
- rasterization
- projection/slice helpers
- shared geometry types/concepts
- optional shape spec support
- colocated README/docs

The important point is not the exact filenames yet.
The important point is that the folder should read like an encapsulated subsystem rather than a loose utility bucket.

## Migration Philosophy

When implementation continues, we should **not** start by moving everything shape-related into `geometry`.

We should also avoid treating `math3d` and `geometry` as competing destinations.

Instead, classify existing logic into buckets.

### Low-level math/traversal substrate

Belongs in `math3d`.

Examples include:

- vector helpers
- normalization
- distance helpers
- line/ray traversal over integer grids
- low-level intersection helpers

### True shared geometry

Belongs in `geometry`.

Examples include:

- analytic shape definitions
- geometry-aware helper operations
- shape slicing/projection
- rasterization from analytic shapes into cells/voxels/slices
- shared rectangle/box/circle/sphere/cone style primitives

### Domain logic using geometry

Stays in:

- painter
- mono UI/debug
- gameplay/perception/targeting

### Rendering glue

Stays near renderers.

### Interaction/session logic

Stays near painter tools or UI controllers.

This classification step is important because it prevents accidental leakage of domain behavior into the shared seam.

## File Classification Direction

### Strong candidates to migrate under `geometry`

- `src/shared/shape3d.ts`
- reusable primitive/projection/raster portions of `src/shared/painter_tools.ts`

Current initial migrations already started here:

- `src/shared/geometry/shape3d.ts`
- `src/shared/geometry/plane_raster.ts`
- `src/shared/geometry/voxel_raster.ts`

### Strong candidates to remain under `math3d`

- `src/shared/math3d.ts`

### Strong candidates to remain domain-owned but consume `geometry`

- `src/mono_ui/vision_debugger.ts`
- `src/canvas_app/app_state.ts`
- `src/npc_ai/cone_of_vision.ts`
- `src/shared/body_model.ts`
- `src/mono_ui/runtime/place_view_projection.ts`

### Shared vocabulary likely to stay foundational

- `src/shared/coords.ts`
- `src/shared/plane_coords.ts`

These likely remain shared coordinate/type infrastructure used by both `math3d` and `geometry`.

## Consumers We Expect To Support

### ASCII painter

Likely use cases:

- 2D rectangle
- 3D rectangle / box
- previews
- fills
- outlines
- future volumetric tools

### Debug visualizers

Likely use cases:

- sight cones
- hearing/sense spheres
- shape slicing by visible plane
- reusable overlay geometry

### Gameplay/runtime

Likely use cases:

- spatial templates
- selection volumes
- line/cell queries
- future area-of-effect or placement helpers

### Targeting/template systems

Likely use cases:

- directionally shaped templates
- previewable area queries
- data-driven shape descriptions

## Dependency Direction

The intended dependency direction is:

- `coords` / `plane_coords` provide foundational shared spatial vocabulary
- `math3d` depends on shared coordinate vocabulary as needed
- `geometry` may depend on `coords`, `plane_coords`, and `math3d`
- domain systems may depend on `geometry`
- `math3d` should not depend on `geometry`

This direction keeps `geometry` higher-level and prevents circular ownership between low-level traversal math and higher-level shape semantics.

## Risks To Avoid

### 1. Utility bucket drift

If `geometry` becomes a random collection of helpers, the seam will fail.
It needs a strong README and strong ownership boundaries.

### 2. Domain leakage

If painter or debug-specific assumptions move into `geometry`, reuse will degrade quickly.

### 3. Coordinate inconsistency

If painter, gameplay, and debug all interpret bounds/origin/z differently, the seam will not produce real unification.

### 4. Premature API lock-in

We should not design a giant perfect abstraction before classifying real use cases already in the repo.

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

## Recommended Next Planning Steps

1. Keep the colocated `src/shared/geometry/README.md` aligned with this plan.
2. Continue shape-logic inventory across painter/debug/gameplay consumers as migrations happen.
3. Classify discovered logic into:
   - low-level math/traversal substrate
   - pure geometry
   - domain logic
   - rendering glue
   - interaction/session logic
4. Confirm the `math3d` vs `geometry` split against real files before moving code.
5. Introduce only the minimum initial `Raster2<T>` / `Raster3<T>` surface when there is a real migration target for it.
6. Only after that, plan any further physical sub-splits such as `plane_bridge.ts` or `shapes.ts`.

## Non-goals For This Plan

- do not define final APIs yet
- do not force all geometry helpers to return dense rasters immediately
- do not remove sparse helpers just because a raster core exists
- do not over-design boolean/int/byte-specialized raster families too early
- do not merge `geometry` back down into `math3d`
- do not mix gameplay policy into geometry planning
- do not turn `geometry` into a generic dumping ground for math utilities

## Open Questions

- Should `Raster2<T>` / `Raster3<T>` start with plain arrays, typed arrays, or support both?
- Should first-class sparse extraction helpers live beside the raster containers or in the ops files?
- Should current `Set<string>` shape outputs be replaced before or after raster containers land?
- How much of current vision-cone projection should remain in a generic `shapes.ts` surface versus a later dedicated projection file?
- When should current module names be physically split to match the target sub-layout versus remain transitional?

## Definition Of A Good Outcome

This plan will be succeeding when the future seam is able to support all of the following without duplicated shape math:

- painter 2D rectangle behavior
- painter 3D box behavior
- shared analytic primitives usable by multiple systems
- shared raster plane-slice helpers
- debug sight/sound overlay geometry
- future gameplay spatial templates

And it should do so while remaining:

- pure
- documented
- bounded
- colocated
- consumer-neutral

## Initial Definition of Done

This plan is successful when:

- the seam has one clearly documented canonical plan
- the current extracted modules stay stable and useful
- the seam has a clearly documented raster-centered direction
- `Raster2<T>` / `Raster3<T>` are introduced in a minimal way
- future geometry migrations can target a small shared container model instead of inventing new output forms each time

## Bottom Line

The repo should keep and grow a shared seam:

- `src/shared/geometry/`

It should be documented like:

- `src/interface_program/target/README.md`

And it should be developed as:

- an encapsulated shared geometry subsystem
- with colocated docs
- with strict ownership boundaries
- with no rendering or gameplay semantics baked into it
- with reuse across painter, debug, and gameplay as the main design goal
- with a small raster-centered container model guiding future migrations

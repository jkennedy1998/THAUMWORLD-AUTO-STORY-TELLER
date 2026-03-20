# Seam-Based Place Adjacency Plan

Date: 2026-03-20

## Status

- [ ] planned

## Intent

Replace the current same-region place-connector model with a seam-based adjacency model where place-to-place traversal is derived from directly touching `region_bounds` faces.

This is a replacement, not a compatibility layer.

The goal is to make place switching feel seamless, scalable, and tile-native:

- no authored connector objects for same-region traversal
- no border aperture math as the canonical movement model
- movement, collision, sensing, and culling all derive from touching tiles across adjacent places
- `x`, `y`, and `z` seams are treated the same for traversal purposes

## Product Direction

A place owns only its editable interior volume.

`region_bounds` is simply the full valid interior bounds of the place. Every tile within that volume belongs to the place and is valid for that place's local tile/collision logic.

Another place must not exist within those bounds, but it may touch those bounds exactly on a face.

When two places touch on a face in region space, every touching tile along that shared face is traversable by default.

This means:

- wide seams are naturally wide openings
- traversal is determined from tile adjacency, not connector placement
- sensing, collision, and movement can all use the same topology primitive
- vertical adjacency is valid and should work the same as horizontal adjacency

## Scope

This plan covers:

- same-region place adjacency and traversal
- same-scene place culling based on adjacency hops
- add/delete place tool rewiring
- use of the existing place resize tool to validate seam math in painter mode
- migration of the tavern testing area to the new model
- removal of same-region `place_connector` authority

This plan does not attempt to redesign:

- region-to-region travel
- general movement authority outside place transitions
- unrelated rendering systems
- unrelated world generation
- non-place gameplay systems

## Existing Capabilities To Reuse

This rewrite should be heavy on integration and light on subsystem replacement.

The following capabilities already exist and should be treated as extension points:

- canonical whole-place persistence in `src/place_storage/store.ts`
- runtime save/sync wrappers in `src/interface_program/main.ts`
- region-scene loading and visible-place payload assembly already in progress in `src/interface_program/main.ts`
- `scene_places`, selected-place state, and painter wiring in `src/canvas_app/app_state.ts`
- the existing place scene renderer and hit-testing in `src/mono_ui/modules/place_module.ts`
- current tile/body movement legality checks in `src/place_storage/movement_legality.ts`
- current movement authority/breath loop in `src/interface_program/main.ts`
- current travel entry points in `src/travel/movement.ts`
- existing place create, delete, and resize tool surfaces in place painter
- `list_places_in_region(...)`, `load_place(...)`, and `save_place(...)` as canonical storage boundaries

This work should replace the same-region connector assumptions inside those hosts rather than introduce parallel topology, rendering, persistence, or editor systems.

## Anti-Rewrite Rules

- do not create a second same-region scene renderer
- do not create a second place persistence format or save path
- do not replace the current movement engine wholesale
- do not replace the current place painter/editor stack
- do not replace world tile or region coordinate storage
- do not turn same-region place adjacency into a separate region-only authoring system
- do not rebuild collision/sensing legality when existing stance and occupancy checks can be reused
- do not require migration of disposable blank test places if deleting/recreating them is cheaper

## Non-Negotiable Invariants

- Same-region traversal is not stored as `place_connector`.
- Same-region traversal is derived from touching `region_bounds`.
- `x`, `y`, and `z` face adjacency are all traversable by default.
- Corner-only and edge-only contact do not count as adjacency.
- Overlapping place interiors are invalid.
- Face-touching place interiors are valid.
- Place switching must feel seamless during normal tile stepping.
- Movement legality across seams should use the same tile/body collision primitives already used within a place.
- The old connector model is removed rather than run alongside the new one.
- Border rendering is only visual/debug support and is never the gameplay authority.

## Canonical Mental Model

### Place interior

Each place owns an interior volume defined by `region_bounds`.

`region_bounds` is the canonical placement data for same-region topology.

Every tile inside `region_bounds` is part of that place.

No other place may overlap that volume.

### Seam adjacency

Two places are adjacent when:

- their `region_bounds` touch on exactly one face
- their spans overlap on the other two axes
- they do not overlap in interior volume

Examples:

- `x` seam: one place max `x` is exactly one step from the other place min `x`
- `y` seam: one place max `y` is exactly one step from the other place min `y`
- `z` seam: one place max `z` is exactly one step from the other place min `z`

### Traversal

If an entity steps out of one place and the destination lies across a valid seam into an adjacent place, the entity transfers to that place at the matching tile.

All touching seam tiles are open by default.

There is no authored same-region connector aperture.

### Borders

Borders may continue to render as a readability/debug layer.

However:

- borders are not stored as traversal data
- borders are not scanned to discover same-region connectivity
- borders are not the authoritative source of movement topology
- if a place tile, character, item, or other gameplay content should render at a position, that content wins over the border
- border rendering is the least important visual layer compared to place tiles, characters, items, and other gameplay content

## Data Model Changes

### Place type

Update `src/types/place.ts` so same-region topology no longer depends on `place_connectors`.

Recommended direction:

- keep `region_bounds`
- remove `place_connectors` as canonical same-region topology
- remove legacy `connections`
- retain `region_connectors` only for region-to-region travel if still needed

### Derived adjacency helpers

Introduce helpers that derive adjacency from `region_bounds`, for example:

- region-bounds overlap check
- face-touch adjacency check
- overlap-span extraction along the seam
- neighbor lookup for a place within a region

These should become the canonical source for:

- movement transitions
- scene graph visibility hops
- place create/delete tool targeting
- resize validation
- topology validation

### Integration direction

Derived adjacency should be implemented as helpers around existing persisted place data, not as a second persisted topology layer.

Recommended direction:

- keep using persisted `region_bounds` on `Place`
- derive neighbors on demand or through lightweight cached helpers
- plug those helpers into existing movement, rendering, and painter hosts
- avoid introducing a second canonical adjacency file or region-topology database

## Movement Model

### Current problem

Movement between places is currently split between:

- explicit travel helpers
- connector-volume transition logic
- runtime connector repair/discovery

This creates geometry-heavy special cases and unstable topology.

### Reuse direction

Do not replace the movement host.

Instead:

- keep the current authoritative movement/breath loop in `src/interface_program/main.ts`
- keep the current legality checks in `src/place_storage/movement_legality.ts`
- replace only the same-region transition detection/resolution logic so it uses seam adjacency instead of connector geometry
- keep explicit travel entry points in `src/travel/movement.ts`, but make them delegate to the same adjacency model

### Target behavior

Replace connector-hit transition logic with seam crossing logic.

When processing a step:

1. compute the intended destination tile in world/region-local terms
2. if the tile remains inside the current place interior, resolve normally
3. if it exits the current place, check for a face-adjacent neighbor across that seam
4. if a neighbor exists and the matching tile lies inside that neighbor, transfer the entity
5. run the same occupancy/support/collision checks in the destination place
6. if blocked, reject the move
7. if valid, apply the place transition seamlessly

### Important requirement

`x`, `y`, and `z` seams must all work.

`z` transitions should not be treated as a separate topology model even if movement flavor later distinguishes stairs, ladders, jumping, or falling.

## Collision, Sensing, And Legality

Use existing tile/body collision logic as much as possible.

The new system should:

- reuse existing stance and occupancy checks
- validate destination stance in the target place after seam crossing
- avoid connector-specific aperture validation entirely
- allow sensing/culling systems to reason from the same adjacency primitive used by movement

New legality focus:

- place interiors may touch on faces
- place interiors may not overlap
- seam mapping between adjacent places must be deterministic
- destination transfer should preserve the correct matching coordinates across `x`, `y`, and `z` seams

## Scene Culling And Visibility

### Current problem

Scene inclusion is currently connector-hop based.

### Target behavior

Build the visible place graph from derived place adjacency.

For v1:

- keep hop-based visibility
- hops are computed from adjacency, not connector objects

This preserves the current UX direction while removing connector bookkeeping.

Longer-term, this system could support:

- seam-width-aware visibility
- physical LOS propagation
- perception attenuation across adjacency depth

Those are follow-up improvements, not part of this rewrite.

### Reuse direction

Do not build a new region renderer or a second scene cache.

Instead:

- reuse the current region-scene payload shape and `scene_places` flow already underway
- reuse the place renderer in `src/mono_ui/modules/place_module.ts`
- replace connector-derived adjacency/hop calculations with seam-derived adjacency
- keep the current selected-place versus actor-current-place scene model

## Place Authoring Tools

### Add place

Rewire the add-place tool so clicking a valid side creates a new place directly adjacent to the selected place.

Behavior:

- choose a direction from the targeted face
- compute new `region_bounds` so the new place touches the source place on that face
- allow `x`, `y`, and `z` placement
- validate against overlap with existing interiors
- do not create a same-region connector object

Reuse direction:

- keep the existing place painter input flow and preview/status UI
- keep backend topology validation in `src/interface_program/main.ts`
- replace connector-era create math rather than building a second authoring endpoint family

### Delete place

Rewire delete-place so it operates on adjacent places discovered from derived adjacency.

Behavior:

- resolve the neighboring place on the targeted seam
- allow deletion only when the target place is empty and valid to remove
- update any scene/tool state without connector cleanup paths

Reuse direction:

- keep the existing delete-place tool surface
- keep backend authority for delete validation and persistence
- replace connector lookup with derived neighbor lookup

### Resize

Use the existing place resize tool in painter mode as a primary testing surface for seam math.

Resize behavior must:

- preserve non-overlapping interior placement
- allow exact face-touching adjacency
- recompute derived adjacency automatically
- keep movement/culling stable after size changes

Reuse direction:

- keep the existing resize tool and resize workflow in painter mode
- use it as the main test harness for adjacency correctness
- update validation rules under that tool rather than inventing a seam-specific debug editor

## Migration Strategy

This is a replacement, not a dual-stack migration.

Recommended migration approach:

- prioritize the tavern testing cluster
- do not spend time preserving blank stone-brick testing places if they are inconvenient
- delete and rebuild disposable test places under the new rules
- remove runtime repair logic for old same-region connectors once the new model lands

Migration order:

1. implement derived adjacency helpers
2. switch movement transitions to seam crossing
3. switch scene graph/culling to adjacency hops
4. rewire add/delete place tools
5. use resize in painter mode to stress-test seam math
6. migrate tavern test places
7. remove obsolete same-region connector logic

## Keep Vs Replace

Keep:

- place painter mode and toolbox
- canonical place persistence boundaries
- region-scene loading/state already in progress
- place renderer and scene hit-testing
- movement legality/body collision primitives
- backend validation and save authority
- region/world coordinate model

Replace or rewrite:

- same-region `place_connector` as the topology authority
- connector-volume transition detection
- runtime connector discovery/repair for same-region travel
- connector-based scene adjacency and visibility hops
- connector-era add/delete place assumptions

Delete when no longer needed:

- same-region connector record creation helpers
- same-region connector validation paths
- same-region connector migration/repair compatibility code

## Validation Rules

Add or update validation so that:

- interior overlap is rejected
- face-touching adjacency is allowed
- edge-only or corner-only touching is ignored for traversal
- seam-derived neighbor discovery is stable and deterministic
- place creation and resizing cannot generate invalid ambiguous topology

## Rendering Direction

Rendering may still show boundaries for readability.

Recommended direction:

- continue using existing border graphics for now where helpful
- render borders from world-space place bounds rather than connector data
- if another place occupies the rendered position, render the place content and not the border
- fix the current issue where the selected/loaded place border is correct but adjacent loaded places render misplaced borders
- keep border rendering subordinate to place tiles, characters, items, and other gameplay content
- do not depend on border cells as persisted topology data

## Likely File Targets

Primary files:

- `src/types/place.ts`
- `src/place_storage/store.ts`
- `src/interface_program/main.ts`
- `src/travel/movement.ts`
- `src/mono_ui/modules/place_module.ts`
- `src/canvas_app/app_state.ts`

Likely removals or heavy rewrites:

- same-region connector record creation
- same-region connector validation
- runtime external connector discovery
- connector-based scene adjacency
- connector-based place add/delete tool assumptions

## Implementation Phases

### Phase 1: Topology primitives

- define derived adjacency helpers from `region_bounds`
- update overlap rules to allow face-touching but reject interior overlap
- remove same-region connector authority from the type model

### Phase 2: Seam-based movement

- replace connector transition detection with seam crossing
- validate destination stance in target place
- support `x`, `y`, and `z` transitions

### Phase 3: Scene graph and culling

- derive visible place graph from adjacency
- preserve hop-based visibility using adjacency depth

### Phase 4: Place tools

- restore add-place tool using adjacency placement
- restore delete-place tool using adjacency lookup
- use the resize tool to validate seam and touching-bound math
- keep tool interactions consistent with same-scene editing

### Phase 5: Rendering cleanup

- fix border placement for adjacent visible places
- ensure borders lose draw priority to place content
- keep borders as supporting readability graphics only

### Phase 6: Migration and cleanup

- migrate tavern test layout
- delete or ignore disposable blank test places
- remove obsolete same-region connector codepaths

## Definition Of Done

- Same-region place traversal no longer depends on `place_connector`.
- Place adjacency is derived from touching `region_bounds`.
- Movement across touching `x`, `y`, and `z` faces works seamlessly.
- Scene visibility hops derive from adjacency instead of connectors.
- Add-place tool works again without door/connector assumptions.
- Delete-place tool works again without connector cleanup assumptions.
- Resize tool can be used to validate touching-bound seam behavior in painter mode.
- Tavern test layout functions under the new model.
- Adjacent loaded place borders no longer render in the wrong location.
- Border rendering no longer overrides more important gameplay visuals.
- Obsolete same-region connector discovery and repair paths are removed.

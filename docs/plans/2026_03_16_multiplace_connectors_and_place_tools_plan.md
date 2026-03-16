# Multi-Place Connectors And Place Tools Plan

Date: 2026-03-16

## Status

- [ ] planned

## Intent

Replace the current single-place door-based connection model with a connector-based multi-place region scene model, and extend `place_painter` so users can create, resize, connect, and delete places directly in-game.

This plan intentionally does not preserve the legacy door system.

Instead, it establishes:

- canonical `place_connector` data for same-region connected places
- canonical `region_connector` data for region-to-region travel points
- region-local place positioning and bounds so multiple places can render at once
- place-painter tools for place creation, resizing, and deletion
- removal of legacy door tile definitions, door metadata, and door-driven place travel logic

## Scope Constraint

This is a targeted rewrite of the place connection model.

It must not trigger unrelated rewrites of:

- place persistence hardening already underway
- unified movement authority
- item/container systems
- general renderer architecture beyond what is required for multi-place rendering
- unrelated world/region systems outside connector integration points

The project already has meaningful early-alpha game progress. This work should extend existing hosts and storage boundaries rather than replacing broad subsystems.

## Source Of Truth / Dependencies

- Place painter plan: `docs/plans/2026_03_15_place_painter_implementation_plan.md`
- Place persistence plan: `docs/plans/2026_03_16_place_persistence_consolidation_plan.md`
- Place types: `src/types/place.ts`
- Place renderer/interactions: `src/mono_ui/modules/place_module.ts`
- Game app state + place painter wiring: `src/canvas_app/app_state.ts`
- Canonical place storage: `src/place_storage/store.ts`
- Current derived door stamping: `src/place_storage/tiles.ts`
- Current place travel: `src/travel/movement.ts`
- Region/world tile model: `src/world_storage/store.ts`
- Authoritative active-place mutation host: `src/interface_program/main.ts`
- Tile databank: `local_data/tiles/`

## Product Direction

The player should be able to stand in a place, enter `place_painter`, and author a connected cluster of places inside the same region without leaving the running game.

Same-region connected places should behave as one local scene for rendering and editing.

Region-to-region travel should remain a scene transition for now, but use `region_connector` rather than legacy door logic.

## Existing Capabilities To Reuse

This plan should build on the systems already present in the codebase rather than replacing them.

The following capabilities already exist and should be treated as extension points, not rewrite targets:

- `place_painter` session state, palette loading, tool selection, and pause integration already exist in `src/canvas_app/app_state.ts`.
- Current place pause/resume APIs already exist through `/api/place/pause` and the active place pause source model in `src/interface_program/main.ts` and `src/canvas_app/app_state.ts`.
- Tile/item painter endpoints already exist in `src/interface_program/main.ts` and should be extended where practical instead of creating a separate authoring service.
- Canonical place persistence already lives in `src/place_storage/store.ts`, with runtime save/sync wrappers in `src/interface_program/main.ts`.
- Region/world tile lookup and region coordinate resolution already exist in `src/world_storage/store.ts`.
- Region place enumeration already exists via `list_places_in_region(...)` in `src/place_storage/store.ts`.
- Current place rendering, hit-testing, focus-z behavior, and painter-mode branching already exist in `src/mono_ui/modules/place_module.ts`.
- Current cross-place travel bookkeeping already exists in `src/travel/movement.ts` and `src/place_storage/entity_index.ts`.

The work here should only replace the legacy door-specific parts and the single-place rendering assumption where they block the new connector model.

## Invariants (Non-Negotiable)

- Legacy `door` is removed as a gameplay/system concept.
- Legacy `door` tile definition is removed from the tile databank.
- `place.connections` is removed as the canonical same-region travel model.
- `tile.door` metadata is removed as the canonical travel model.
- `place_connector` is stored as canonical top-level place data, not only as a painted tile.
- `region_connector` is distinct from `place_connector`.
- Multiple places may exist in one region scene with non-editable shared border space between them and no overlapping claimed coordinates.
- Coordinate ownership is per region.
- Place interiors may not touch directly on a face; adjacency is mediated by one shared border layer that belongs to connector space, not to either place interior.
- The shared connector border may exist along `x`, `y`, or `z`.
- Border cells are not editable place tiles.
- Border cells always render as `_` for now.
- Border cells count as walls for collision.
- Place creation/resizing/deletion must go through backend validation and canonical persistence.
- This work must reuse existing place persistence and active-place sync boundaries rather than inventing a second editor save model.

## Canonical Data Model

### Place

Extend `Place` in `src/types/place.ts` with region-scene data required for multi-place rendering and editing.

Recommended additions:

```ts
type PlaceRegionBounds = {
  origin: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
};

type PlaceConnectorDirection = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';

type PlaceConnector = {
  id: string;
  kind: 'place_connector';
  place_a_id: string;
  place_b_id: string;
  direction_from_a: PlaceConnectorDirection;
  border_tile_a: { x: number; y: number; z: number };
  border_tile_b: { x: number; y: number; z: number };
};

type RegionConnector = {
  id: string;
  kind: 'region_connector';
  local_tile: { x: number; y: number; z: number };
  target_region_coords: {
    world_x: number;
    world_y: number;
    region_x: number;
    region_y: number;
  };
  target_place_id?: string;
};
```

Recommended `Place` shape changes:

- add `region_bounds`
- add `place_connectors`
- add `region_connectors`
- remove `connections`
- remove `PlaceDoorMeta`
- remove `door?: ...` from `PlaceTile`

### Connector tile definitions

Add two canonical tile definitions in `local_data/tiles/structures/`:

- `place_connector`
- `region_connector`

Both should carry a `CONNECTOR` tag.

Recommended tag direction:

- `place_connector`: `STRUCTURE`, `CONNECTOR`
- `region_connector`: `STRUCTURE`, `CONNECTOR`

Do not reuse the `DOOR` tag.

If movement blocking differs between the two, define that through tags now rather than special-casing legacy door behavior later.

### Region ownership / placement

Each place must claim a region-local volume through `region_bounds`.

`region_bounds` describes only the editable interior volume of the place.

The border layer around that interior is outside the place bounds and is not owned by the place interior tile volume.

When two places connect, they do not share interior face contact. They share a connector border layer between them.

Example model:

```text
____________
_....._....._
_.....=....._
_....._....._
____________
```

In this model:

- `_` is border space, not editable place interior
- `.` is editable place interior
- `=` is the connector position on the shared border layer

This becomes the basis for:

- overlap validation
- multi-place rendering
- connector adjacency validation
- create/resize/delete rules

### Border model

The border model should be treated as explicit and canonical, not implied.

- Border cells are outside place interiors.
- Border cells are not paintable/editable with normal place tools.
- Border cells should remain visibly rendered as `_` for now so place boundaries stay legible during alpha.
- Border cells count as solid walls for collision except at connector semantics handled by travel logic.
- If the user clicks a border cell to create a place, that border cell is the shared connector location for both places.
- That connector cell is not inside either place interior; travel logic must account for the fact that the connector exists in border space rather than in an interior tile.

## Legacy Removal Policy

This plan intentionally removes legacy door behavior instead of supporting migration compatibility.

That means implementation should:

- remove door derivation from `src/place_storage/tiles.ts`
- remove door hit-testing and door-click travel in `src/mono_ui/modules/place_module.ts`
- remove door-based entry placement assumptions in `src/travel/movement.ts`
- remove `door.jsonc` from `local_data/tiles/structures/door.jsonc`
- remove any generation logic that writes `kind: "door"` into places
- remove any place storage/type logic that expects `connections` or `tile.door`

Any existing seeded/sample place generation should be rewritten directly to use connectors.

## Definition Of Done

- The place schema supports region-local bounds, `place_connectors`, and `region_connectors`.
- The tile databank contains `place_connector` and `region_connector`.
- The legacy `door` tile definition is gone from the databank.
- Door-specific type/runtime logic is removed from place rendering and travel.
- Same-region connected places can render together in one region scene.
- Only directly connected places to the selected place render in v1.
- `place_painter` has place creation, resize, and deletion tools.
- Place creation enforces region-local non-overlap.
- Place deletion only succeeds when the place is empty by the defined rules.
- `place_connector` tiles can be repositioned along valid shared borders with the move entity tool.
- Invalid place-tool actions report their rejection reason through the system info window module.
- Unrelated systems are not rewritten beyond required integration points.

## Non-Goals For This Plan

- full generic world editor
- NPC spawning/editor workflow
- new standalone editor app
- large-scale world storage redesign
- fully generalized cross-region streaming
- broad renderer rewrite outside region-scene support for adjacent places

## Development Sequence

### Phase 1: Canonical schema rewrite

#### Goal

Replace door-centric place connection types with connector-centric place and region data.

#### Tasks

- Update `src/types/place.ts` to add:
  - region-local bounds/origin data
  - `place_connectors`
  - `region_connectors`
- Remove:
  - `PlaceDoorMeta`
  - `Place.connections`
  - `PlaceTile.door`
- Define canonical connector direction vocabulary as axis-based directions.
- Ensure persistence sanitization knows connector/editor fields are canonical, not runtime-only.
- Define border-space semantics explicitly so place bounds describe interior only, not border cells.

#### Reuse Notes

- Extend the existing `Place` type in `src/types/place.ts`; do not create a parallel place schema.
- Keep existing fields such as `region_id`, `coordinates`, `tile_grid`, and `contents` unless a field is specifically door-only.
- Reuse the current canonical persistence boundary from `src/place_storage/store.ts` and the persistence hardening plan rather than inventing a connector-specific save format.

#### Success Criteria

- The place schema expresses multi-place spatial relationships directly.
- No canonical place type depends on legacy door metadata.

### Phase 2: Tile databank connector definitions

#### Goal

Make connectors first-class tile definitions and remove the legacy door tile.

#### Tasks

- Add `place_connector` tile definition.
- Add `region_connector` tile definition.
- Add `CONNECTOR` tag usage.
- Remove `local_data/tiles/structures/door.jsonc`.
- Audit any tile lookup code or scripts that explicitly expect `door`.

#### Reuse Notes

- Reuse the existing tile databank structure and tile resolve path; connectors should be ordinary tile defs from the resolver's perspective.
- Do not introduce a second connector-definition registry outside `local_data/tiles/`.

#### Success Criteria

- Connector tiles exist in the databank and resolve normally.
- Door tile definition no longer exists.

### Phase 3: Backend place topology primitives

#### Goal

Add authoritative helpers for place bounds, connector validation, and place topology mutation.

#### Tasks

- Add helpers in `src/place_storage/store.ts` and/or `src/interface_program/main.ts` for:
  - list all places in region with bounds
  - test region-local overlap
  - test shared-border adjacency
  - create connected place
  - resize place
  - delete place
  - add/move/remove `place_connector`
- Define the empty-place deletion predicate:
  - no non-air interior tiles
  - no actors
  - no NPCs
  - no items
  - only the single connector back to the surviving place
- Keep all topology edits on canonical place data and save through existing place persistence boundaries.

Deletion emptiness should follow the current place concept of traversable blank interior tiles.

- If a tile is currently treated by the place system as the default blank/traversable interior state, it counts as empty.
- Do not introduce a second separate "editor air" concept if the current place system already has one.
- All interior cells within place bounds should be valid blank/traversable tiles when they contain nothing else.
- Border cells are outside the place and are not part of this emptiness check.

#### Reuse Notes

- Reuse `list_places_in_region(...)`, `load_place(...)`, `save_place(...)`, and the active-place sync wrappers already present.
- Extend the current mutation host in `src/interface_program/main.ts`; do not introduce a new topology daemon or editor-only storage layer.
- Reuse the existing delete/create place storage helpers where they fit, broadening them for region-bounds and connector validation.

#### Success Criteria

- The backend can validate and mutate multi-place topology safely.
- No topology mutation bypasses canonical place persistence.

### Phase 4: Replace door-derived tiles with connector-derived tiles

#### Goal

Remove legacy door stamping and derive visible connector tiles from canonical connector data.

#### Tasks

- Rewrite `src/place_storage/tiles.ts` so authored/generated place tiles no longer stamp `door`.
- Derive visible connector occupancy/tiles from `place_connectors` and `region_connectors`.
- Ensure connector tiles are present only at valid shared border positions.
- Keep this logic narrow and local to the existing place tile augmentation path.

#### Reuse Notes

- Keep using the existing tile augmentation/derivation pipeline in `src/place_storage/tiles.ts`.
- Replace only the door-specific derivation logic rather than reworking all authored tile processing.

#### Success Criteria

- Rendered connectors come from canonical connector records.
- No door tile generation remains.

### Phase 5: Region-scene loading in frontend app state

#### Goal

Move from single-place-only scene assumptions to a selected-place plus rendered-neighbors model.

#### Tasks

- Extend `src/canvas_app/app_state.ts` to track:
  - selected/editing place id
  - active region scene places
  - loaded neighboring place snapshots
- Add a region-scene fetch/load path rather than repeatedly treating travel as full single-place replacement.
- Preserve existing place-painter state ownership in app state rather than creating a second app.
- Render only directly connected places to the selected place in v1 rather than the whole region.
- Keep render distance as a global debug-tunable variable so this can expand later.

#### Reuse Notes

- Extend the current `ui_state.place` branch instead of building a new scene store.
- Reuse current-place fetch/update flow, pause-state flow, and painter-state flow as the backbone for region-scene loading.
- Treat the selected place as the existing current-place concept generalized to a rendered place set, not as a second independent selection model.
- Put the v1 place render-distance variable in a globally sensible host, ideally close to shared camera/render-distance tuning rather than buried inside place-tool code.

#### Success Criteria

- The frontend can hold more than one rendered place snapshot at once.
- One place remains the selected/editing place.

### Phase 6: Multi-place rendering and hit-testing

#### Goal

Render multiple region-local places in one scene and route interactions to the correct place.

#### Tasks

- Refactor `src/mono_ui/modules/place_module.ts` so hit-testing and rendering can map scene coordinates to a specific place and local tile.
- Replace door click logic with connector click logic.
- Preserve current camera/focus-z behavior where possible.
- Minimize renderer churn by extending the current place module rather than creating a second renderer.
- Treat `z` and elevation the same way as `x` and `y` for global relative positioning.
- Keep camera focus centered on the camera target; place positioning is responsible for preserving correct relative layout between places.

#### Reuse Notes

- Reuse the existing place module, DOM layer stack, viewport math, and painter-mode interaction branch.
- Reuse current hit-testing and scene interaction entry points where possible, adding place-id resolution instead of replacing the module shell.
- Do not reintroduce the standalone ASCII painter canvas as a second renderer for place scenes.

#### Success Criteria

- Adjacent places render together in one region scene.
- Connector clicks target the right connected place.
- Painter interactions can target border/shared-connector positions correctly.

### Phase 7: Same-region connector travel rewrite

#### Goal

Replace door-based place travel with connector-based same-region movement.

#### Tasks

- Rewrite `src/travel/movement.ts` place travel entry logic to use `place_connector`.
- Entry placement should use connector border mapping, not return-door heuristics.
- Same-region connector travel should move the entity across the connected places without treating it as region reload.
- Update place index / location bookkeeping accordingly.

#### Reuse Notes

- Reuse the existing movement authority, place load/save helpers, and entity index update flow.
- Replace the connection lookup and entry-position logic, not the broader movement/travel framework.

#### Note

- Precise same-region traversal semantics remain a TODO and should be specified during implementation.

#### Success Criteria

- Same-region place travel is connector-driven.
- No travel path depends on `connections` or `door`.

### Phase 8: Region connector travel integration

#### Goal

Introduce region-level travel points without overhauling cross-region loading.

#### Tasks

- Add region-connector interaction handling.
- Leave region-connector travel semantics as TODO for now.
- If travel is attempted through a `region_connector` during this implementation phase, it may be rejected cleanly rather than partially implemented.

#### Reuse Notes

- Reuse the current region coordinate model and `get_default_place_for_region(...)` path.
- Reuse current full reload place transition behavior for cross-region travel instead of introducing streaming or multi-region scene support.

#### Success Criteria

- Region-connector interactions are recognized cleanly without forcing a premature region-travel implementation.
- Same-region and cross-region connector concepts are clearly separated.

### Phase 9: Place painter place tools

#### Goal

Extend `place_painter` from tile/item authoring to place topology authoring.

#### Tasks

- Add tools to `src/canvas_app/app_state.ts` place-painter tool state:
  - `place_resize`
  - `place_create`
  - `place_delete`
- Keep these tools inside the existing place-painter session/toolbox structure.
- Keep place tools behaving like normal tools: one mouse button maps to one selected tool and the other mouse button maps to the other selected tool.
- Update tool status and preview UI to show:
  - selected place bounds
  - hovered border tile
  - creation preview
  - invalid overlap preview
  - deletion eligibility feedback

#### Reuse Notes

- Reuse the current `place_painter` state branch, pause controller, palette loading, and tool dispatch.
- Extend the existing toolbox and preview pathways instead of creating a second place-topology editor mode.
- Reuse the current invalid-action red preview/animation style already used by invalid item/slot movement where practical.

#### Success Criteria

- Place tools feel like extensions of the current place painter, not a separate mode.

### Phase 10: Place create tool

#### Goal

Allow users to create a connected neighboring place from a border tile.

#### Tasks

- From selected place, detect border-tile hover/click.
- Show 3x3x3 preview for the new place in the chosen relative direction.
- Validate new place volume against all existing place bounds in the same region.
- On commit:
  - create new place
  - set region bounds
  - create one `place_connector`
  - place connector on the shared border cell between the two place interiors
- Use backend validation as authority.

#### Reuse Notes

- Reuse existing painter pointer routing and preview rendering.
- Reuse existing place creation/storage helpers where possible instead of writing raw place files directly from the UI.

#### Success Criteria

- Users can create a new connected place from a border tile.
- Overlapping or invalid placements are rejected before commit.

### Phase 11: Place resize tool

#### Goal

Allow users to resize the selected place by dragging its bounds.

#### Tasks

- Highlight current place borders.
- Allow edge/corner drag similar to existing resize widget behavior.
- Validate resized bounds against:
  - region overlap rules
  - connector validity
  - minimum size rules
- Decide resize handling for invalidated connectors:
  - reject resize if it breaks shared-border legality
  - or snap connector to another valid shared border tile
- Prefer rejection in v1 for simplicity and safety.

#### Reuse Notes

- Reuse current place-painter selection/highlight behavior and existing resize-widget interaction patterns where available.
- Keep validation backend-authoritative; the frontend should preview and submit, not own the topology rules.

#### Success Criteria

- Selected place can be resized safely.
- Invalid resizes do not corrupt topology.

### Phase 12: Place delete tool

#### Goal

Allow users to delete an empty connected place from the surviving neighboring place.

#### Tasks

- Click the connector from the surviving place side.
- Resolve the connected place targeted for deletion.
- Validate deletion predicate.
- If valid:
  - remove connected place file/state
  - remove shared connector record(s)
  - refresh region scene
- If invalid, return specific reason to the UI.

Deletion rejections should be surfaced in the system info window module.

#### Reuse Notes

- Reuse current place deletion/storage helpers as the low-level file removal path once validation passes.
- Reuse current region-scene refresh flow rather than inventing a delete-specific reload mechanism.

#### Success Criteria

- Empty connected places can be deleted safely.
- Non-empty places are protected from accidental deletion.

### Phase 13: Move-tool connector relocation

#### Goal

Allow shared `place_connector` position to be moved along a valid shared border.

#### Tasks

- Extend existing move-entity semantics to understand connector entities/targets.
- Restrict connector relocation to valid shared-border tiles between the same two places.
- Update canonical connector record and re-render.

#### Reuse Notes

- Extend the existing move entity tool semantics already planned for place painter.
- Do not create a connector-only movement subsystem separate from the normal painter move interaction path.

#### Success Criteria

- Connectors can be repositioned without editing raw data.
- Illegal connector moves are rejected.

### Phase 14: Seed/sample content rewrite

#### Goal

Remove door-era sample content and seed connector-era equivalents directly.

#### Tasks

- Rewrite seeded place generation in `src/interface_program/main.ts` to create places with bounds and connectors.
- Remove any sample assumptions that generate `connections` or `door` tiles.
- Keep sample content narrow and representative rather than broad.
- Remove legacy door usage from the currently used tavern and town square content.
- Purge other unused current places so connector-era content starts from a clean base.

#### Reuse Notes

- Limit content rewrites to seed/sample/bootstrap content that is actually door-era.
- Do not touch unrelated player progress data or broad world content that is already valid under existing persistence unless it directly depends on doors.

For the current alpha content set, the intended cleanup is narrow and explicit:

- keep and rewrite the tavern and town square
- purge other unused current places rather than carrying legacy door-era content forward

#### Success Criteria

- Sample content uses only the new connector model.
- No bootstrap logic depends on doors.

## Explicit Anti-Rewrite Rules

The implementation should not do any of the following unless a later dedicated plan explicitly calls for it:

- replace `place_painter` with a new editor app
- replace canonical place persistence with a connector-specific persistence service
- replace the movement engine or server-authoritative movement model
- replace the existing pause-source model
- replace world/region storage with a new region database format
- introduce multi-region streaming just to support `region_connector`
- rewrite item, container, or inventory systems as part of connector work

## Validation Checklist

- schema load/save works for connector-era places
- no codepath still stamps or expects `kind: "door"`
- no codepath still expects `place.connections`
- no codepath still expects `tile.door`
- multi-place region scene renders adjacent places correctly
- place creation rejects overlap
- place resize rejects illegal overlap/broken topology
- place deletion only succeeds for valid empty places
- `place_connector` relocation respects shared border legality
- invalid place-tool actions surface in the system info window
- directly connected neighbor render scope behaves correctly
- unrelated systems remain stable

## Recommended Initial Execution Order

1. schema rewrite
2. connector tile databank additions + door tile removal
3. backend topology helpers
4. tile derivation rewrite
5. frontend region-scene loading
6. multi-place rendering/hit-testing
7. same-region connector travel
8. region connector travel
9. painter place tools
10. sample content rewrite

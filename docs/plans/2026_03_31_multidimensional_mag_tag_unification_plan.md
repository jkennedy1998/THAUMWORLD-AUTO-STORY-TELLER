# Multidimensional MAG Tag Unification Plan

Date: 2026-03-31

## Status

- [ ] planned

## Intent

Unify THAUMWORLD onto one canonical tag system where tags are definition-backed, instance-delta-driven, and dimensioned in MAG.

This plan is architecture-first. It defines the target model, migration rules, and deletion rules before implementation details for specific tags.

This plan exists to solve the next layer of the same problem space already being addressed by storage surfaces and defs+deltas:

- tags are game rules
- tags need to change over time
- entities need long-lived instance variation without forking their whole definition
- tags need comparable MAG-native dimensions
- tags need to contribute to value in MAG
- special tag behavior such as `GROW` must plug into the unified storage surface system instead of becoming a side system

At the end of this plan there must be one active tag system.

## Related Files And Plans

- Tag definitions: `local_data/data_slot_default/tag_definitions.jsonc`
- Current tag delta application: `src/tag_system/tag_deltas.ts`
- Current tag identity: `src/tag_system/tag_key.ts`
- Current tag registry/types: `src/tag_system/registry.ts`
- Current item defs+deltas resolution: `src/item_storage/resolve.ts`
- Current tile defs+deltas resolution: `src/tile_storage/resolve.ts`
- Current actor storage: `src/actor_storage/store.ts`
- Current NPC storage: `src/npc_storage/store.ts`
- Current meta processing: `src/tag_system/meta_processor.ts`
- Current GROW runtime: `src/interface_program/main.ts`
- Storage surface inventory plan: `docs/plans/2026_03_27_storage_surface_inventory_plan.md`
- Advanced tags plan: `docs/plans/2026_02_17_advanced_tags.md`
- Archived tag unification plan: `docs/plans/archive/2026_02_17_tag_unification.md`

If this plan conflicts with older assumptions that treat tags as either a flat `mag` only system or an ad hoc `info[]` payload system, this plan wins.

## Problem Statement

The current codebase already has useful tag building blocks, but they are split across overlapping models.

### What is already good

- items, tiles, and structures already use the newer `definition + instance delta` direction
- `tag_add` and `tag_remove` already exist for inline items and place tiles
- `GROW` already participates in storage surfaces conceptually
- MAG is already used broadly across systems and is part of the game's language

### What is still broken

- actors and NPCs still persist direct mutable tag arrays instead of fully participating in defs+deltas
- many mechanics still treat tags as either one anonymous `mag` or an untyped `info[]`
- `GROW` currently relies on bespoke parsing instead of a canonical resolved tag state
- tag valuation is not unified with entity value in MAG
- there are effectively multiple tag systems in the repo:
  - live defs+deltas resolution for items/tiles
  - direct actor/NPC tag mutation
  - older registry/budget/resolver code paths that partially overlap but are not the canonical runtime path

Without unification, every new tag with multiple dimensions risks becoming another special parser, another custom runtime shape, and another half-integrated value model.

## Product Direction

The canonical abstraction is:

- `tag definition`: what a tag is and what MAG dimensions it owns
- `tag instance`: which tag is present on a specific owner and what deltas/overrides apply
- `resolved tag state`: the merged result used by runtime, UI, legality, value, and storage-surface contributors

The canonical unit for tag dimensions is MAG.

This means:

- every named tag dimension is stored canonically as MAG
- realistic runtime outputs are derived from MAG through formulas or tables
- tag value in MAG is computed from tag definition rules, not guessed ad hoc at call sites

Example:

- `GROW` does not store raw `period_breaths` as canonical state
- `GROW` stores dimensions such as `grow_speed_mag`, `grow_capacity_mag`, and `grow_yield_mag`
- runtime formulas convert those MAG values into breaths per cycle, max grow slots, and produced quantity

## Canonical Design Rules

### One Tag System Only

This plan ends with one canonical runtime tag system.

Migration scaffolding is allowed only when it directly shortens the path to cutover, and every scaffold must have a named deletion phase.

No long-lived compatibility layer is allowed to survive once the new path is verified.

### Reuse Existing Unified Helpers First

This work must prefer extending existing shared seams over inventing parallel ones.

Prefer integrating into:

- `src/tag_system/tag_deltas.ts`
- `src/tag_system/tag_key.ts`
- `src/item_storage/resolve.ts`
- `src/tile_storage/resolve.ts`
- storage surface resolvers and owner-view builders
- defs+deltas sanitizers

Do not add a second independent tag resolution stack when the current resolver direction can be expanded.

### MAG Is Canonical For Tag Dimensions

Each named dimension on a tag is stored as MAG.

Examples:

- `grow_speed_mag`
- `grow_capacity_mag`
- `grow_yield_mag`
- `fire_intensity_mag`
- `fire_spread_mag`

If runtime wants realistic numbers, it derives them from MAG.

Examples:

- breaths per growth cycle from `grow_speed_mag`
- slots from `grow_capacity_mag`
- damage dice from `fire_intensity_mag`

### Named Dimensions, Not Positional Info Arrays

The active system must stop relying on anonymous `info[]` semantics for core mechanics.

Named dimensions are required so runtime code can ask for explicit concepts rather than array positions.

Bad:

- `tag.info[0]`
- `tag.info[1]`

Good:

- `get_tag_dim_mag(tag, "grow_speed")`
- `get_tag_dim_mag(tag, "grow_capacity")`

### Tag Value Supports Both Default Summation And Per-Tag Override

Each tag definition may expose how it contributes value in MAG.

Default behavior:

- tag value = sum of dimension MAG contributions

Override behavior:

- a tag may define a value formula that replaces or reshapes the default sum

This is required because a multidimensional tag like `GROW` should not be forced to value itself the same way as a multidimensional damage or condition tag.

### Definitions Plus Deltas Remain Lean

Items, tiles, and structures already lean toward the correct persistence model and should stay that way.

Persist:

- definition references
- tag add/remove ops
- tag dimension delta ops where needed
- owner-specific runtime state that must survive reloads

Do not persist:

- derived resolved tag snapshots
- duplicated definition data
- duplicated calculated value data

### Actors And NPCs Must Join The Same Model

This plan is not complete until actors and NPCs participate in the same tag architecture principles as items and tiles.

They do not need to share identical file shape with items or tiles, but they must share:

- definition-backed or baseline-backed tag resolution
- delta application
- resolved tag helper access
- canonical add/remove/update semantics

### Storage Surface Integration Is First-Class

Tag-contributed surfaces such as `GROW` must be expressed through the storage surface model, not a tag-specific inventory model.

Tags may contribute surfaces.
They may not invent a second inventory language.

## Target Canonical Data Model

Field names may shift during implementation, but the model must preserve these concepts.

```ts
type TagDimensionDefinition = {
  id: string;
  label: string;
  default_mag: number;
  min_mag?: number;
  max_mag?: number;
  description?: string;
  runtime_projection?: {
    kind: "table" | "formula" | "custom";
    value_type: "number" | "integer" | "dice" | "duration" | "slots" | "weight" | "custom";
    table_id?: string;
    formula?: string;
  };
  value_weight?: number;
};

type TagDefinition = {
  name: string;
  stacking: "sum" | "none" | "custom";
  scope: Array<"CHARACTER" | "ITEM" | "TILE" | "TAG">;
  dimensions: TagDimensionDefinition[];
  value_model?: {
    mode: "sum_dimensions" | "formula";
    formula?: string;
  };
  contributes_surfaces?: Array<{
    surface_kind: "grow" | "container" | "custom";
    contributor_name: string;
    projection_kind: "definition" | "custom";
  }>;
  lifecycle?: {
    expiry?: boolean;
    dispersing?: boolean;
  };
};

type TagInstance = {
  key?: string;
  name: string;
  rank_mag?: number;
  dim_mag?: Record<string, number>;
  source?: string;
  expiry?: number;
  scope?: Array<"CHARACTER" | "ITEM" | "TILE" | "TAG">;
};

type ResolvedTagState = {
  key: string;
  name: string;
  definition: TagDefinition;
  rank_mag: number;
  dim_mag: Record<string, number>;
  value_mag: number;
};
```

## How Existing Concepts Map Forward

### `tag.mag`

Current `tag.mag` is too overloaded to remain the main meaning carrier.

Forward rule:

- use explicit named dimensions for mechanics
- keep a single optional `rank_mag` only when a tag benefits from an overall intensity shorthand

For simple tags, `rank_mag` may remain the only meaningful dimension.

For multidimensional tags, `rank_mag` is optional and secondary.

### `tag.info`

`info[]` is migration-only scaffolding where needed during cutover.

Active systems must move to named dimension access.

At the end of this plan, core active tags must not require `info[]` parsing to function.

### `tag_add` and `tag_remove`

Keep the current delta direction.

Extend it rather than replacing it with a separate delta system.

Needed expansion:

- support dimension MAG deltas cleanly
- preserve stable tag identity semantics through `tag_key`

### Tag Identity

`src/tag_system/tag_key.ts` is already the closest thing to canonical tag instance identity and should remain the basis unless a strictly better deterministic key is needed.

If identity rules change, the migration must account for:

- persisted remove ops
- GROW stream ordering and identity
- any future tag-on-tag references

## Canonical Runtime Services

This plan should converge runtime onto a small set of canonical helpers.

### 1) Tag Definition Loader

Responsibility:

- load canonical tag definitions
- validate dimension schemas
- expose definition lookup by tag name

Bias:

- extend current definition loading rather than creating a second unrelated loader

### 2) Tag Resolver

Responsibility:

- merge tag definition defaults with instance deltas
- produce `ResolvedTagState`
- expose helpers for dimension MAG lookup, runtime projection, and value

Bias:

- integrate into `src/tag_system/` and extend current defs+deltas resolution patterns used by item/tile resolution

### 3) Owner Tag Resolver

Responsibility:

- resolve all effective tags for an owner
- support items, tiles, structures, actors, NPCs under one conceptual contract

Bias:

- do not replace working item/tile resolvers with new parallel abstractions if they can be upgraded to call a shared tag resolver

### 4) Tag Value Service

Responsibility:

- compute tag value in MAG
- compute entity value in MAG from base value plus tag contributions
- provide canonical value answers for UI, balance, and generation logic

### 5) Tag Surface Contributor Resolver

Responsibility:

- map resolved tag state into inventory/storage surface contributions when definitions say the tag grants surfaces

Bias:

- integrate with the storage surface system already in progress
- do not create a tag-specific UI or inventory payload shape

## Entity Value In MAG

This plan introduces a canonical entity value model.

Each entity can have:

- `base_value_mag` from its definition or kind
- `tag_value_mag` from resolved active tags
- `total_value_mag` = base + tag contributions

This model should work for:

- items
- tiles
- characters
- NPCs
- structures

This plan does not define the final MAG charts. It defines where they plug in.

Runtime code should not need to know the whole chart to know where value comes from.

## GROW As The First Proof Tag

`GROW` is the correct first proof because it already touches:

- tag state
- long-lived tile mutation
- storage surfaces
- inventory UI
- time/breath processing
- produced item generation

### Target `GROW` shape

Canonical dimensions should be MAG-native concepts such as:

- `grow_speed_mag`
- `grow_capacity_mag`
- `grow_yield_mag`
- optional later dimensions such as `grow_variety_mag` or `grow_quality_mag`

Runtime projections should derive:

- breaths per cycle
- max harvest slots
- produced item count or stack amount

The currently bespoke parser in `src/interface_program/main.ts` should be replaced by canonical resolved-tag helpers once the new path is validated.

## Fire And Other Tags

This plan does not fully specify every tag's gameplay details yet.

It does define the architecture they must fit into.

Examples:

- `FIRE!` should use named MAG dimensions such as intensity and spread
- `BROKEN` may remain effectively single-dimension
- future disease tags may use severity, spread, and cure resistance dimensions

The key requirement is that all of them use the same definition/resolution/value architecture.

## Migration Strategy

### Non-Negotiable Migration Rule

Every migration phase must name what old code becomes deletable.

If a phase cannot identify deletion targets, it is too vague and should be redesigned.

### Phase 1: Canonical Tag Architecture Seams

- define the canonical tag definition shape
- define dimension MAG semantics
- define resolved tag state helpers
- define tag value service contract
- define how tag-contributed surfaces project into storage surfaces

Deliverable:

- one architectural contract for the future tag system

Deletion queue created in this phase:

- list of active call sites relying on positional `info[]` for first-wave migration tags
- list of duplicate/older tag-resolver concepts in `src/tag_system/`

### Phase 2: Shared Tag Resolver Integration

- extend current tag loading and delta application helpers rather than replacing them wholesale
- create canonical helpers for:
  - get resolved tag state
  - get dimension MAG
  - get runtime projection
  - get tag value MAG

Deliverable:

- one shared resolver path usable by item and tile resolution

Cleanup required before leaving this phase:

- stop adding new active runtime systems that parse tag meaning directly from `info[]`
- stop adding new logic that assumes plain `tag.mag` is enough for multidimensional tags

### Phase 3: GROW Migration

- migrate `GROW` definition to the new dimension model
- update breath processing to read resolved dimensions instead of bespoke config parsing
- update tile surface contribution path so `GROW` surfaces come from the canonical tag model
- preserve current storage surface behavior while changing the source of truth

Deliverable:

- `GROW` runs fully through the canonical tag resolver and storage surface integration

Cleanup required before leaving this phase:

- remove bespoke `GROW` config parsing for active code paths
- remove now-redundant `GROW`-specific shape assumptions in API/view builders where shared helpers can answer the same questions

### Phase 4: Value In MAG

- add base value MAG fields where needed for entity definitions
- implement canonical entity value calculation
- expose value in shared read models or inspection payloads where appropriate

Deliverable:

- items and tiles can report total value MAG from base value plus resolved tag contributions

Cleanup required before leaving this phase:

- remove scattered value guesses for migrated entities where the canonical service replaces them

### Phase 5: Actor And NPC Tag Migration

- move actors and NPCs onto the same conceptual resolution model
- decide whether their base tags come from `kind`, explicit tag definitions, or both
- update tag mutation flows so runtime changes produce deltas against canonical baseline rather than only mutating raw stored arrays

Deliverable:

- actors and NPCs participate in the same tag system architecture as items and tiles

Cleanup required before leaving this phase:

- remove actor/NPC-only tag mutation assumptions that bypass canonical resolution
- reduce raw direct-tag save/load logic that no longer represents the source of truth

### Phase 6: Meta Processing Unification

- update meta tag processing to operate on canonical resolved tag state
- ensure dispersing/expiry behavior can work across all owners, not just actor/NPC direct arrays

Deliverable:

- one meta processing path that understands canonical tag instances and resolved dimensions

Cleanup required before leaving this phase:

- remove special-case meta processing assumptions that only work for raw actor/NPC tag arrays

### Phase 7: Legacy Tag Path Removal

After migrated tags and owners are stable, perform an explicit deletion pass.

This phase must remove:

- active `info[]` parsing for migrated tags
- duplicate older tag interpretation paths that no longer serve runtime
- direct call-site logic duplicating shared tag resolver behavior
- leftover compatibility fallbacks that keep old tag payload assumptions alive

Deliverable:

- one canonical tag system in active runtime code

## Implementation Slices

These slices turn the migration phases into concrete buildable chunks.

Each slice should leave the codebase in a usable state.
Each slice must either delete superseded code immediately or create a clearly named deletion target for the next slice.

### Slice 1: Canonical Tag Definition Expansion

Goal:

- teach the existing definition-loading path how to understand MAG-native named dimensions and value rules

Primary files to extend first:

- `local_data/data_slot_default/tag_definitions.jsonc`
- `src/tag_system/definitions.ts`
- `src/tag_system/registry.ts`

Work:

- add canonical schema fields for tag dimensions, value model, lifecycle, and surface contribution metadata
- keep the loader centered on the existing tag definition source instead of creating a second tag definition file format unless strictly needed later
- make the in-code types match the new architecture plan
- document which current tags are first-wave migration tags, starting with `GROW`

Acceptance:

- tag definitions can express named MAG dimensions
- tag definitions can express default dimension MAG values
- tag definitions can express value mode as default sum or per-tag formula
- tag definitions can express whether they contribute storage surfaces

Deletion target created by this slice:

- older code in `src/tag_system/registry.ts`, `src/tag_system/resolver.ts`, and `src/tag_system/budget.ts` that overlaps conceptually with the new canonical contracts must be marked as either reusable or deletable in later slices

### Slice 2: Shared Resolved Tag Helpers

Goal:

- create one canonical helper layer that resolves named MAG dimensions and value from a tag instance plus definition

Primary files to extend first:

- `src/tag_system/tag_deltas.ts`
- `src/tag_system/tag_key.ts`
- new shared helpers in `src/tag_system/`

Work:

- define `ResolvedTagState`
- add helpers for `get_tag_dim_mag`, `get_tag_rank_mag`, `get_tag_value_mag`, and runtime projection lookup
- extend delta application so dimension MAG data can be merged without creating a parallel delta mechanism
- preserve stable tag identity behavior or explicitly version it if unavoidable

Acceptance:

- one shared helper path can resolve a tag's named dimension MAG values
- the helper path can compute tag value in MAG
- the helper path does not require `info[]` for migrated tags

Deletion target created by this slice:

- ad hoc call-site logic that reads multidimensional meaning directly from `tag.mag` or `tag.info[]`

### Slice 3: Item And Tile Resolver Integration

Goal:

- make existing item and tile resolution call the canonical tag helpers instead of keeping tag interpretation inline

Primary files to extend first:

- `src/item_storage/resolve.ts`
- `src/tile_storage/resolve.ts`
- `src/shared/physics_tags.ts`

Work:

- update item and tile resolution to expose resolved-tag-state-aware outputs
- keep the current defs+deltas persistence shape for items and tiles
- avoid breaking existing consumers that only need effective tag presence, while shifting the source of truth under them

Acceptance:

- items and tiles resolve tags through the shared canonical tag helper layer
- item/tile callers can ask for resolved dimensions and tag value without adding parallel resolvers

Deletion target created by this slice:

- duplicate item/tile tag interpretation logic outside the shared helper layer

### Slice 4: GROW Cutover

Goal:

- migrate `GROW` completely onto named MAG dimensions and canonical surface contribution

Primary files to extend first:

- `local_data/data_slot_default/tag_definitions.jsonc`
- `src/interface_program/main.ts`
- inventory surface helpers under `src/inventory_surfaces/`
- inspection readers such as `src/inspection/data_service.ts`

Work:

- define `GROW` dimensions such as speed, capacity, and yield in MAG
- replace bespoke `parse_grow_configs(...)` style interpretation with canonical resolved-tag access
- route grow-slot count and harvest surface contribution through canonical projection helpers
- preserve existing behavior where possible while shifting source of truth to resolved tag dimensions

Acceptance:

- `GROW` no longer needs core runtime logic to parse anonymous `info[]`
- tile grow surfaces are derived from canonical tag projections
- inventory and inspection views ask shared helpers for GROW data instead of re-decoding the tag themselves

Deletion required before closing this slice:

- remove active bespoke GROW parsing code paths that the new helper layer replaces

### Slice 5: Canonical Entity Value In MAG

Goal:

- make entity value in MAG a first-class computed service instead of a future idea

Primary files to extend first:

- item definition loaders in `src/item_storage/store.ts`
- tile or structure definition loaders as needed
- new shared value helpers in `src/tag_system/` or `src/shared/`

Work:

- add or normalize `base_value_mag` on definitions where appropriate
- compute `tag_value_mag` from resolved tag states
- compute `total_value_mag` from base plus tags
- expose value through shared inspection/read payloads where useful

Acceptance:

- migrated items and tiles can answer total value in MAG from one canonical path
- value calculations do not re-implement tag math at UI call sites

Deletion target created by this slice:

- scattered hand-rolled value logic for migrated entities

### Slice 6: Actor And NPC Tag Baseline Migration

Goal:

- stop actors and NPCs from remaining the last separate tag world

Primary files to extend first:

- `src/actor_storage/store.ts`
- `src/npc_storage/store.ts`
- `src/kind_storage/store.ts`
- character payload helpers in `src/shared/`

Work:

- define canonical baseline tag sources for characters and NPCs, likely from kind and/or explicit character defs
- introduce delta-driven character tag mutation rules consistent with items/tiles
- make character-facing payloads expose resolved tag state through shared helpers

Acceptance:

- actor and NPC tags resolve through the same canonical tag system concepts as items and tiles
- runtime changes can be expressed as deltas against baseline rather than only raw direct array mutation

Deletion required before closing this slice:

- remove raw actor/NPC tag assumptions that bypass canonical resolution where migrated paths exist

### Slice 7: Meta And Lifecycle Unification

Goal:

- move dispersing, expiry, and similar lifecycle behavior onto canonical resolved tags

Primary files to extend first:

- `src/tag_system/meta_processor.ts`
- time hooks in `src/time_system/tracker.ts`, `src/state_applier/main.ts`, and `src/travel/movement.ts`

Work:

- make lifecycle processing owner-agnostic
- process tag lifecycle based on canonical resolved state and persisted deltas
- support migrated items, tiles, actors, and NPCs through one conceptual path

Acceptance:

- meta and lifecycle processing no longer depend on raw actor/NPC tag arrays as the special case source of truth

Deletion required before closing this slice:

- remove actor/NPC-only lifecycle assumptions once the canonical path is active

### Slice 8: Final Tag System Consolidation

Goal:

- perform the explicit deletion pass that makes the architecture real

Primary files to review:

- all of `src/tag_system/`
- runtime call sites in API, UI, inspection, time, and storage modules that still decode tags directly

Work:

- remove legacy `info[]`-based logic for migrated tags
- remove duplicate resolver/value paths that are no longer canonical
- simplify call sites to use shared helpers
- verify that the remaining system still supports items, tiles, structures, actors, and NPCs

Acceptance:

- one active tag system remains in runtime code
- there is no long-lived compatibility branch keeping older tag models alive
- migrated systems obtain tag meaning through shared canonical helpers

Definition of done for this plan:

- the repo has one tag system, not a new one layered on top of the old one

## Slice Development Notes

This section turns the slices into a practical build sequence.

The bias here is:

- extend the live defs+deltas path already used by items and tiles
- keep the working storage-surface direction intact
- avoid inventing replacement layers where an existing seam can be deepened
- delete obsolete paths as soon as the new path is proven

### Cross-Slice Build Rules

Before changing code in any slice:

- identify whether the change belongs in `src/tag_system/`, an owner resolver, a store loader, or a view/helper layer
- prefer adding one shared helper used by multiple call sites instead of solving the same question separately in API, UI, and inspection code
- if a call site only needs presence checks, keep that surface simple, but move the source of truth under it to the shared canonical resolver
- if a new field is added to persisted data, define how it is sanitized, loaded, and migrated before writing production logic against it

Definition of a bad slice implementation:

- a new helper exists only for `GROW` when a generic helper could answer the same class of question
- a new resolver is added but item/tile/actor code keeps bypassing it
- a temporary compatibility branch is added without a named deletion step

### Slice 1 Detailed Build Notes

This slice should stay schema-and-helper focused.

It should not yet rewrite broad runtime behavior.

Recommended sequence:

1. Extend tag definition types in `src/tag_system/definitions.ts`
2. Add parsing/normalization for:
   - named dimensions
   - default MAG values
   - value model
   - lifecycle flags
   - surface contribution metadata
3. Keep `get_tag_stacking_mode(...)` working, but make it read from the richer normalized definition record instead of only a tiny stacking map
4. Add loader helpers that return the full normalized definition, not just stacking mode
5. Record first-wave migrated tags directly in definitions or in clear plan comments, starting with `GROW`

At the end of Slice 1, the codebase should be able to answer:

- what dimensions a tag owns
- what their default MAG values are
- how that tag values itself
- whether the tag contributes a surface

It does not yet need to route all runtime through those answers.

Suggested helper shape to aim for:

```ts
type NormalizedTagDefinition = {
  name: string;
  stacking: TagStackingMode;
  scope: string[];
  dimensions: Array<{
    id: string;
    default_mag: number;
    min_mag: number | null;
    max_mag: number | null;
    runtime_projection: NormalizedRuntimeProjection | null;
    value_weight: number;
  }>;
  value_model: {
    mode: "sum_dimensions" | "formula";
    formula: string | null;
  };
  contributes_surfaces: NormalizedTagSurfaceContribution[];
  lifecycle: {
    dispersing: boolean;
    expiry: boolean;
  };
};
```

### Slice 2 Detailed Build Notes

This slice should create the canonical tag-resolution vocabulary that the rest of the repo will consume.

Recommended sequence:

1. Add a new shared resolved-tag helper module under `src/tag_system/`
2. Keep `tag_key(...)` as the identity primitive unless there is a proven migration reason to change it
3. Extend `apply_tag_deltas(...)` or sibling helpers so instance dimension MAG can merge in the same resolution pass
4. Define `ResolvedTagState`
5. Add small read helpers rather than encouraging direct object property reach-through everywhere

Recommended helpers:

- `resolve_tag_state(definition, instance)`
- `resolve_tag_states(base_tags, add_tags, remove_ops)`
- `get_tag_dim_mag(tag_state, dim_id)`
- `get_tag_rank_mag(tag_state)`
- `get_tag_value_mag(tag_state)`
- `project_tag_runtime_value(tag_state, dim_id)`

Important:

- `ResolvedTagState` should be the place where dimensions become dependable
- call sites should not need to remember fallback order between definition defaults and instance overrides

### Slice 3 Detailed Build Notes

This slice is where the new tag system becomes real for live defs+deltas owners.

Recommended sequence:

1. Update `src/item_storage/resolve.ts` so `ResolvedItem` includes resolved tag states or enough canonical output to avoid re-resolving ad hoc downstream
2. Update `src/tile_storage/resolve.ts` the same way
3. Keep existing `effective_tags` outputs if needed temporarily, but derive them from the canonical resolver output
4. Update low-level shared consumers such as `src/shared/physics_tags.ts` to use canonical resolved tags rather than old assumptions

Important boundary:

- this slice should not yet touch every UI reader
- it should make the owner resolvers trustworthy enough that downstream systems can migrate onto them slice by slice

Definition of success:

- item/tile resolution is no longer doing private tag interpretation outside the shared canonical helper layer

### Slice 4 Detailed Build Notes

This slice is the first real behavioral proof.

Recommended sequence:

1. Add `GROW` dimensions to `tag_definitions.jsonc`
2. Add runtime projection rules for:
   - period in breaths
   - max harvest slots
   - yield amount
3. Create one canonical helper that turns resolved `GROW` tag state into grow runtime config
4. Replace `parse_grow_configs(...)` usage in `src/interface_program/main.ts` with that helper
5. Replace any inspection/UI `GROW` decoding with the same helper or a thin shared view helper

Recommended helper target:

- `resolve_grow_runtime_config(tag_state)` or a generic tag projection helper that `GROW` calls through

Important:

- the helper may be `GROW`-specific for the runtime projection stage
- the tag resolution feeding it should not be `GROW`-specific

This is where the project proves that:

- tags can own multiple MAG dimensions
- runtime can derive realistic behavior from MAG
- a tag can contribute a storage surface through canonical projection

### Slice 5 Detailed Build Notes

This slice should establish value as a shared service, not a UI decoration.

Recommended sequence:

1. Add normalized `base_value_mag` support to item definitions
2. Add the same concept to tiles/structures where it makes sense
3. Build shared helpers for:
   - `get_entity_base_value_mag(...)`
   - `get_entity_tag_value_mag(...)`
   - `get_entity_total_value_mag(...)`
4. Expose value in one or two shared payload paths first, preferably inspection/read models rather than many UI-specific endpoints

Important:

- the tag value service should consume resolved tag states, not raw tag arrays
- this is the point where per-tag formula override becomes operational rather than only planned

### Slice 6 Detailed Build Notes

This is the hardest architectural slice because it closes the main remaining split system.

Recommended sequence:

1. Decide the canonical baseline source for actor/NPC tags
2. Decide whether character tag deltas live as explicit `tag_add` / `tag_remove`, a character-specific equivalent, or a normalized shared shape
3. Update canonical load/save helpers to resolve character tags through the same helper vocabulary as items/tiles
4. Update character payload builders to expose canonical outputs to UI and runtime consumers
5. Then update mutation call sites

Important:

- do not start by changing every actor/NPC call site first
- start by making canonical actor/NPC resolution possible, then cut consumers over to it

Decision constraint:

- whatever baseline source is chosen, it must support long-lived character change over time without requiring whole-definition forks

### Slice 7 Detailed Build Notes

This slice should turn lifecycle behavior into a feature of canonical resolved tags rather than owner-specific array hacking.

Recommended sequence:

1. teach lifecycle processing how to iterate owners through canonical tag resolution
2. move dispersing/expiry rules to definition-driven or resolved-state-driven checks
3. persist resulting changes through the owner's canonical delta path
4. verify the same conceptual processing works for actors, NPCs, items, and tiles that participate in lifecycle behavior

Important:

- meta processing should stop caring whether the owner is an actor, NPC, tile, or item and instead care about how to load and persist canonical tag state for that owner type

### Slice 8 Detailed Build Notes

This is not optional cleanup.
This is a required architecture slice.

Recommended sequence:

1. grep for active `tag.info` readers on migrated tags
2. grep for direct `tag.mag` assumptions in multidimensional contexts
3. review `src/tag_system/` for older overlapping helpers that no longer serve the canonical path
4. delete obsolete branches
5. verify the surviving path is the one every migrated system actually uses

The completion question for this slice is simple:

- if a new engineer asks "how do tags work here?" is there one real answer?

If not, this slice is not done.

### Slice 9: Repo-Wide Canonical Cleanup And Validation

Goal:

- finish the repo-wide follow-up pass after the main migration slices so the canonical tag system is not only implemented, but also the only practical source of truth for engineering work

Primary files and areas to review first:

- `src/tag_system/index.ts`
- `src/tag_system/registry.ts`
- `src/tag_system/resolver.ts`
- `src/tag_system/budget.ts`
- `src/tool_system/`
- `src/action_range/`
- `src/integration/action_system_integration.ts`
- `src/item_instances/store.ts`
- `src/container_storage/store.ts`
- `src/context_manager/`
- `src/npc_ai/`
- `src/rules_lawyer/`
- API and payload builders in `src/interface_program/main.ts`
- character and place payload helpers in `src/shared/`

Why this slice exists:

- the core runtime path now uses the canonical tag model
- some utility, AI, rules, payload, and legacy storage paths still depend on flattened `tags`, old resolver utilities, or direct `tag.info` / `tag.mag` assumptions
- if these paths are left alone, the repo will drift into a split reality where the canonical system exists but older modules still teach engineers a different model

Work:

- quarantine or remove old tag utility exports from `src/tag_system/index.ts` so the main entrypoint advertises the canonical system first
- migrate remaining runtime or rules code that still treats raw `entity.tags` as authoritative
- replace repeated AWARENESS decoding logic with one shared helper/accessor
- replace remaining gameplay reads of `tag.info` or `tag.mag` where canonical helpers can answer the same question
- audit item/container legacy modules and either:
  - migrate them onto inline defs+deltas resolution, or
  - explicitly quarantine them as legacy so they stop acting like active reference architecture
- extend important API payloads so resolved tag state and MAG value data are available without downstream re-resolution
- update tests/examples/tooling that still bootstrap the old resolver stack so they stop implying it is canonical

Acceptance:

- the main tag system entrypoint no longer suggests two equal architectures
- old tag utility modules are either migrated, isolated, or clearly marked non-canonical
- common gameplay/runtime consumers use shared canonical accessors instead of bespoke reads of `tags`, `tag.info`, or `tag.mag`
- actor/NPC/item/tile payloads expose enough canonical tag/value data that clients do not need to guess or reconstruct core tag meaning
- legacy item/container modules no longer silently bypass the canonical tag path

Deletion and quarantine targets for this slice:

- re-exported old resolver/budget/registry APIs from `src/tag_system/index.ts`
- duplicated AWARENESS decoding logic in rules/runtime layers
- stale raw-tag persistence helpers in `src/item_instances/store.ts` and `src/container_storage/store.ts` if they remain active
- outdated examples/tests/tooling that instantiate the old tag stack as though it is current architecture

Recommended sequence:

1. Main entrypoint cleanup
   - remove or demote legacy exports from `src/tag_system/index.ts`
   - force remaining legacy consumers to import legacy modules directly so they become visible
2. Shared canonical readers
   - add helpers for awareness targets, status effects, and tag-presence summaries over canonical resolved state
   - use these helpers before doing file-by-file rewrites of every consumer
3. Runtime and rules consumers
   - update `src/context_manager/index.ts`
   - update `src/npc_ai/action_selector.ts`
   - update `src/rules_lawyer/effects.ts`
   - update nearby place/character presence helpers in `src/shared/`
4. Payload normalization
   - extend API payload builders so items, tiles, actors, and NPCs can expose `resolved_tag_states` and MAG value summaries where appropriate
5. Legacy module decision pass
   - inspect `src/item_instances/store.ts` and `src/container_storage/store.ts`
   - either migrate them or clearly fence them off as non-canonical legacy code
6. Tests, tooling, and examples
   - migrate or quarantine remaining code that still teaches `TagRegistry` / `TagResolver` as the main system

Top risks this slice addresses:

- old utility modules diverging from canonical definitions and resolved-tag behavior
- AI/rules/context code reasoning from flattened tags while gameplay state is actually canonical deltas plus resolved state
- API/UI layers continuing to depend on convenience `tags` forever because canonical payloads were never surfaced cleanly
- legacy container/item modules silently reintroducing raw tag persistence assumptions

Definition of done for Slice 9:

- when searching the repo for how tags work, there is one obvious architecture path for active gameplay code
- remaining legacy files are visibly legacy, not silently authoritative
- common subsystems no longer need bespoke tag decoding where canonical helpers already exist

## Near-Term Execution Recommendation

The next practical build order should be:

1. Slice 1
2. Slice 2
3. Slice 3
4. Slice 4

That sequence gets the project to the first meaningful proof quickly:

- canonical definition support exists
- canonical resolved tag helpers exist
- live item/tile resolution depends on them
- `GROW` proves the model can drive simulation plus storage surfaces

Only after that should value and character migration become the main focus.

## Initial File-by-File Checklist For Slice 1

### `local_data/data_slot_default/tag_definitions.jsonc`

- add richer fields for dimensions, lifecycle, surface contribution, and value model
- migrate `GROW` definition shape first as the reference example
- avoid changing every tag at once; only convert enough tags to prove the schema and keep non-migrated tags loadable

### `src/tag_system/definitions.ts`

- replace the current stacking-only cache with full normalized definition caching
- keep `get_tag_stacking_mode(...)` as a compatibility convenience during migration, but back it with the normalized definition record
- add helpers like `get_tag_definition(...)` and `list_tag_definitions(...)`

### `src/tag_system/registry.ts`

- decide what remains canonical here versus what should move toward definition/resolution helpers
- avoid growing `registry.ts` into a second competing source of truth if `definitions.ts` becomes the canonical definition loader

### `src/tag_system/resolver.ts` and `src/tag_system/budget.ts`

- review and mark what logic can be reused later versus what becomes obsolete under the new plan
- do not wire new features into these files by default unless they become part of the chosen canonical path

## Reuse-First Implementation Rules

Before adding new helpers, check whether the need should be solved by extending:

- `src/tag_system/tag_deltas.ts`
- `src/tag_system/tag_key.ts`
- `src/item_storage/resolve.ts`
- `src/tile_storage/resolve.ts`
- `src/shared/defs_deltas_sanitize.ts`
- inventory surface owner-view resolvers

Do not build:

- a second inventory-like tag surface DTO
- a second independent defs+deltas engine for tags
- a tag-specific value system that bypasses canonical entity value calculation
- a long-lived compatibility layer for legacy fields once migrated code is verified

## Major Risks

### `mag` Meaning Drift

The repo already uses MAG in several related but different ways.

If new multidimensional work is sloppy, `tag.mag`, item `mag`, and dimension MAGs will become more confusing instead of less.

Mitigation:

- require explicit naming such as `rank_mag` and named dimension ids

### Identity Breakage

If tag identity semantics change carelessly, remove ops and GROW stream indexing can break.

Mitigation:

- preserve deterministic tag identity rules or migrate them explicitly

### Duplicate Resolver Growth

There is a risk of adding a shiny new tag resolver while old item/tile resolution keeps living beside it.

Mitigation:

- make item/tile/actor/NPC paths converge on shared helpers rather than layering a new parallel path

### Actor/NPC Drift Surviving Too Long

If actor/NPC migration is deferred indefinitely, the project still has multiple real tag systems.

Mitigation:

- treat actor/NPC migration as required for plan completion, not optional follow-up

## Verification Checklist

- [ ] items, tiles, structures, actors, and NPCs can all be described under one canonical tag architecture
- [ ] active multidimensional tags use named MAG dimensions instead of positional `info[]`
- [ ] `GROW` runs through canonical tag resolution and storage surface contribution
- [ ] entity value in MAG is computed through one canonical service
- [ ] no migrated runtime path needs direct bespoke tag parsing when shared helpers can answer the question
- [ ] meta processing can operate on canonical resolved tag state
- [ ] migration phases delete superseded code instead of only adding adapters
- [ ] at plan completion there is only one active tag system

## Immediate Next Step

Implement the architecture seams before deep-diving on every tag.

Recommended first implementation slice:

- extend tag definition loading to support named MAG dimensions and value model rules
- add canonical resolved-tag helpers in `src/tag_system/`
- integrate those helpers into existing item/tile resolution instead of building a parallel resolver path
- migrate `GROW` as the first proof tag

That is the smallest slice that validates the architecture, exercises storage surfaces, and keeps the project moving toward one tag system instead of many.

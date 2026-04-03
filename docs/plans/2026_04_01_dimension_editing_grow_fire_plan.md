# Dimension Editing, GROW, And FIRE Plan

Date: 2026-04-01

## Status

- [ ] planned
- [ ] phase 1 payload widening
- [ ] phase 2 schema exposure
- [ ] phase 3 generic dimension editor UI
- [ ] phase 4 tag identity hardening
- [ ] phase 5 tile tag editing for GROW
- [ ] phase 6 GROW validation
- [ ] phase 7 FIRE conversion

## Intent

Ship in-game dimension editing through the shared tag editor path, use `GROW` as the first real multidimensional gameplay tag, and then move `FIRE!` from raw stack MAG to named dimensions on the same canonical model.

This plan is execution-first. It takes the recommended order already identified and turns it into a sequence of concrete phases that can be worked through without reopening the architecture question every session.

## Why This Order

The current repo already has the low-level shape for dimensioned tags:

- `TagInstance` already supports `rank_mag` and `dim_mag` in `src/tag_system/registry.ts`
- resolved tag state already merges definition dimensions in `src/tag_system/resolved.ts`
- `GROW` already consumes named dimensions in `src/tag_system/grow.ts`

The blocker is not storage. The blocker is that the editor and update path flatten tags down to `name`, `mag`, and `meta`, which means dimension-bearing tags cannot be safely edited yet.

So the correct order is:

1. widen the payloads
2. expose dimension schema
3. build generic dimension controls
4. harden tag identity
5. add tile-side editing so `GROW` can actually be tested
6. validate `GROW`
7. convert `FIRE!`

## Success Criteria

At the end of this plan:

- editing a multidimensional tag does not drop unedited fields
- the tag picker can show and edit dimensions from tag definitions
- one tile can be edited in-game to tune `GROW` dimensions and see runtime results
- `GROW` no longer depends on ambiguous or editor-hostile configuration paths
- `FIRE!` can use named dimensions for at least intensity while preserving gameplay behavior
- this same UI/data path remains reusable for characters, items, and tiles

## Guardrails

- Do not add a second dimension editor for each entity type
- Do not make `GROW` a tile-only special editor; use the generic tag picker model
- Do not convert `FIRE!` before the editor, payload, and identity work are stable
- Do not silently flatten `dim_mag`, `rank_mag`, `info`, `scope`, or `source` during save

## Phase 1 - Widen Canonical Edit Payloads

Goal: make the editor and API preserve full tag state so multidimensional tags can survive round-trips.

### Scope

- Extend the UI draft model in `src/mono_ui/modules/tag_picker_module.ts`
- Extend tag picker state in `src/canvas_app/app_state.ts`
- Extend `/api/character/tag/update` in `src/interface_program/main.ts`

### Required Changes

- Replace the current reduced `TagPickerDraft` shape with a fuller tag-edit shape containing at minimum:
  - `name`
  - `mag`
  - `rank_mag`
  - `dim_mag`
  - `meta`
  - `info`
  - `scope`
  - `source`
  - `expiry`
  - `key` or `previous_key`
- Update UI normalization helpers in `src/canvas_app/app_state.ts` so selected tags are cloned without losing dimension fields.
- Update `/api/character/tag/update` so it accepts and persists `rank_mag` and `dim_mag` instead of reconstructing tags from only `name`, `mag`, and `meta`.
- Keep the backend tolerant of partial payloads, but never drop existing fields just because the UI did not edit them.

### Done When

- selecting a tag with `dim_mag` and saving it without changing dimensions preserves the exact same dimensions
- tag edits do not erase `info` for `GROW`
- character tag update responses still return hydrated `tags` and `resolved_tag_states`

### Risks

- existing helper paths such as `upsert_character_tag()` are name-oriented and may need overloads or a parallel full-instance upsert path
- event and cache update paths may still assume `oldMag/newMag` only

## Phase 2 - Expose Tag Dimension Schema

Goal: let the editor discover how to render a tag's dimensions from definitions.

### Scope

- `src/interface_program/main.ts`
- `src/tag_system/index.ts`
- `local_data/data_slot_default/tag_definitions.jsonc`

### Required Changes

- Extend the tag picker options API so tag selection can return enough schema for UI rendering, or add a dedicated tag-definition endpoint.
- The schema returned to the client must include:
  - `name`
  - `scope`
  - `dimensions[]`
  - per dimension: `id`, `label`, `default_mag`, `min_mag`, `max_mag`, `description`, `runtime_projection`
- Add a small client-side helper in `src/canvas_app/app_state.ts` to cache the selected tag definition for the current tag draft.

### Done When

- the client can ask, for a selected tag, which dimensions exist and their legal ranges
- the UI no longer needs hardcoded knowledge of `grow_speed_mag`, `grow_capacity_mag`, or `grow_yield_mag`

### Risks

- scope filtering must remain entity-aware so the picker does not offer irrelevant tags in each editor surface

## Phase 3 - Build Generic Dimension Controls In The Tag Picker

Goal: edit dimensions generically through the shared tag picker module.

### Scope

- `src/mono_ui/modules/tag_picker_module.ts`
- `src/canvas_app/app_state.ts`

### Required Changes

- Add a dimension section below base tag fields in `tag_picker_module`.
- Render one row per dimension from the selected tag definition.
- Use the same interaction style already requested for the picker:
  - valid-entry commit behavior
  - fast list/index selection
  - range-style controls for numbers
  - no fragile freeform numeric editing as the primary path
- Add increment/decrement controls per dimension with clamping to `min_mag` and `max_mag` when present.
- Preserve keyboard speed:
  - arrows move between fields and dimensions
  - left/right adjust selected numeric dimension
  - enter commits valid text-backed fields when used
- Update drag payload/application so dragging from the picker onto an entity carries the selected draft including `dim_mag`.

### Done When

- selecting a multidimensional tag shows its dimensions in the picker
- adjusting a dimension updates the draft without losing other fields
- the picker remains usable for non-dimensional tags

### Risks

- panel height and row hit testing may need revision once dimensions are shown
- dimension-rich tags may need scrolling or paging later; keep first version simple but structurally ready

## Phase 4 - Harden Tag Identity Semantics

Goal: make same-name tags with different state editable and runtime-safe.

### Scope

- `src/tag_system/tag_key.ts`
- `src/shared/character_tags.ts`
- any tag update API using name-only semantics
- any runtime path indexing tags by `tag_key()` such as grow stream resolution in `src/interface_program/main.ts`

### Required Decisions

- Tags that differ only by dimensions should count as different instances for runtime identity.
- That is especially required for `GROW`, where multiple streams may share the same name but differ by dimension values.

### Required Changes

- Update `tag_key()` to include `rank_mag` and `dim_mag`.
- Update tag edit/remove APIs to accept `previous_key` so replacement can safely target the correct instance.
- Update helper paths in `src/shared/character_tags.ts` to support key-aware upsert/remove in addition to simple name-based edit behavior.
- Audit grow surface index resolution so it remains stable under dimension edits.

### Done When

- two same-name tags with different dimensions no longer collide
- editing one dimensioned tag does not accidentally replace another same-name tag on the same owner
- grow stream indexing is stable and predictable

### Risks

- changing `tag_key()` affects delta matching and any remove ops keyed against previous identity
- some existing data may need migration or graceful fallback for old keys

## Phase 5 - Add Tile Tag Editing So GROW Can Be Tested

Goal: make one tile editable in-game through the same tag picker path so `GROW` can be validated where it actually runs.

### Scope

- `src/interface_program/main.ts`
- place painter UI in `src/canvas_app/app_state.ts`
- tile-focused edit selection in `src/mono_ui/modules/place_module.ts` or adjacent painter/editor seams

### Required Changes

- Add a tile tag read/update API parallel to the character tag update path.
- Start with one selected tile instance at a time.
- Allow selecting a tile in place painter, opening its tag list, and routing the selected tag into the same shared tag picker.
- Ensure the tile payload preserves:
  - `tag_add`
  - `tag_remove`
  - any per-instance `info` needed by `GROW`
  - any dimension values
- Keep the UI small: one selected tile, one selected tag, shared picker.

### Required GROW-Specific Support

- Ensure `GROW` editing exposes both dimensions and `info` in a survivable form.
- `GROW` currently still needs valid item-def configuration from `info` in `src/tag_system/grow.ts`.
- For the first vertical slice, support editing one tile whose `GROW` tag already has valid grow item config, then optionally expose item-def config editing later.

### Done When

- a tile can be selected in place painter
- its tag list is visible
- a `GROW` tag can be selected
- its dimensions can be edited and saved without destroying grow item config

### Risks

- this phase is where `GROW` stops being theoretical and starts surfacing real UI/runtime bugs
- tile instance mutation must stay canonical and must not reintroduce raw tag writes as a side path

## Phase 6 - Validate And Harden GROW

Goal: prove that canonical dimension editing produces correct `GROW` runtime behavior.

### Scope

- `src/tag_system/grow.ts`
- `src/interface_program/main.ts`
- tile owner/grow view APIs
- manual in-game testing through place painter

### Required Checks

- changing `grow_speed_mag` changes period timing as expected
- changing `grow_capacity_mag` changes grow surface slot count as expected
- changing `grow_yield_mag` changes produced quantity as expected
- multiple `GROW` tags with different dimensions do not alias each other
- transfers in and out of grow surfaces remain trustworthy after the edit flow

### Recommended Hardening

- add focused log lines for tag key, dim values, computed period, slot count, and yield during growth pulses
- verify the grow surface count and stream index mapping after edits
- confirm that saving and reloading the place preserves the exact tag dimensions

### Done When

- one edited block can reliably demonstrate dimension-driven growth changes
- no data loss occurs on reload
- stream identity remains stable

### Risks

- `GROW` still depends on `info` for item-def ids, so the first slice must avoid accidental `info` loss
- if transfer/source validation remains unstable around grow surfaces, runtime verification will be noisy

## Phase 7 - Convert FIRE! To Named Dimensions

Goal: move `FIRE!` from raw `mag` stacks to named dimensions on the same editor/runtime model.

### Suggested FIRE Shape

Start small. Do not model every fire behavior dimension at once.

Recommended first FIRE dimensions:

- `fire_intensity_mag`
- `fire_spread_mag`

Optional later:

- `fire_heat_mag`
- `fire_duration_mag`

### Required Changes

- Add FIRE dimensions to `local_data/data_slot_default/tag_definitions.jsonc`.
- Add a `tag_system/fire.ts` helper that reads resolved FIRE dimensions the same way `src/tag_system/grow.ts` reads `GROW`.
- Update `src/render_shaders/tags/fire.ts` to read FIRE dimensions instead of raw `fire.mag`.
- Update any dispersing logic in `src/tag_system/meta_processor.ts` so decay semantics are dimension-aware, not just `mag` decrement.
- Update FIRE application/update paths so stack-like edits are represented through the chosen FIRE dimension rather than raw tag mag where appropriate.

### Transitional Rule

During conversion, keep a temporary bridge so old FIRE data that only has raw `mag` can still project a default `fire_intensity_mag` until data is migrated.

### Done When

- FIRE visuals use the new dimension helper
- FIRE edits in the tag picker show its dimensions
- gameplay still behaves correctly for adjacent spread and intensity-driven effects

### Risks

- FIRE currently has more runtime touchpoints than GROW and still assumes `ref:tag.mag` in definition data
- a full effect-system conversion may be larger than the editor work itself, so start with the smallest dimension-backed behavioral slice that gives real value

## Cross-Cutting Follow-Up Work

These are not separate phases, but they must be watched across the whole effort.

### Event And Cache Payloads

- widen tag change events beyond `oldMag/newMag`
- preserve dimension data in client caches and place/entity tag displays

### Tests And Logging

- add targeted logs for dimension edits and runtime projections
- add at least one build-safe regression path for `GROW`
- add a small verification path for FIRE render color/intensity

### Future Reuse

- the same tag picker/dimension controls should be reused for items and tiles
- do not fork a second editor path once tile/item editors arrive

## Working Order Checklist

This is the chug-through list.

### 1. Widen payloads

- [ ] widen `TagPickerDraft`
- [ ] preserve `dim_mag`, `rank_mag`, `info`, `scope`, `source`, `expiry`
- [ ] widen `/api/character/tag/update`
- [ ] verify no-save round-trip keeps dimensions intact

### 2. Expose schema

- [ ] add tag-definition detail exposure to the picker flow
- [ ] return dimension metadata to the client
- [ ] cache selected tag definition in UI state

### 3. Generic dimension UI

- [ ] render dimension rows in `tag_picker_module`
- [ ] support ranged numeric adjustment
- [ ] commit valid entry changes
- [ ] preserve drag-apply behavior with dimensions

### 4. Identity hardening

- [ ] include dimensions in tag identity
- [ ] add key-aware update/remove behavior
- [ ] verify multiple same-name tags can coexist safely

### 5. Tile editing for GROW

- [ ] add tile tag read/update API
- [ ] add tile tag list UI in place painter
- [ ] route selected tile tag into shared tag picker
- [ ] preserve `GROW` info and dimensions on save

### 6. Validate GROW

- [ ] test speed dimension
- [ ] test capacity dimension
- [ ] test yield dimension
- [ ] test reload persistence
- [ ] test multiple grow streams

### 7. Convert FIRE!

- [ ] add FIRE dimensions to definitions
- [ ] add FIRE dimension helper
- [ ] convert shader to dimension reads
- [ ] define dimension-aware dispersing behavior
- [ ] preserve compatibility with old FIRE data during transition

## Recommended Immediate Next Move

Start Phase 1 now.

The very next implementation slice should be:

- widen `TagPickerDraft`
- widen app-state tag normalization
- widen `/api/character/tag/update`
- prove that a dimension-bearing tag can survive a save untouched

That is the smallest change that unlocks everything else in this plan.

# Unified Graphic Payload Source-of-Truth Plan

Date: 2026-05-07

## Intent

Define the next source-of-truth visual payload shared by the ASCII painter and the game render stack.

This plan exists to replace the current split mental model:

- text cells as `char + rgb + weight`
- graphic cells as `graphic + materials + weight`

with one canonical visual model centered on:

- `graphic_id`
- up to 3 appearance slots
- shared 4-step weight
- runtime selector inputs for choosing a rendered presentation

Where each appearance slot stores a small tagged value:

- semantic material reference
- or flat RGB color

This plan is architecture-first. It intentionally precedes implementation. Several render-path deep dives should happen before code changes begin.

## Source Of Truth Goal

At the end of this work there should be:

- one canonical authored visual payload
- one canonical runtime cell visual contract
- one canonical render-resolution step for choosing what presentation a graphic uses
- one canonical graphic-definition authority surface
- one canonical slot-application path

There should **not** be:

- parallel legacy visual payloads that both claim authority
- long-term `char/rgb` vs `graphic/materials` split ownership
- compatibility bandaids treated as architecture

## Relationship To Existing Notes

This plan builds on observations in:

- `docs/design/painter_game_render_alignment_observations.md`

Especially:

- observation 8: rich visual payloads and special rendered glyphs
- observation 11: facing-aware body/render behavior living on the game side

This plan also intersects with prior atlas/material work such as:

- `docs/plans/2026_04_07_tile_id_atlas_material_lighting_architecture_plan.md`

If conflicts appear, this plan should become the source of truth for the shared authored/runtime visual payload direction.

## Core Architectural Decision

The system should unify around a single concept:

## A cell stores a visual payload, not separate text-vs-tile models.

That payload has three authored parts:

1. **Graphic identity**
   - what visual family this cell wants to render
2. **Appearance slot assignments**
   - up to 3 slots
   - each slot carries a small appearance value
   - first pass: material reference or flat RGB color
3. **Weight**
   - one shared 4-step weight across text-like and atlas-like graphics

The rendered result is then chosen at runtime using selector inputs such as:

- facing
- view direction
- cardinal neighbors
- diagonal neighbors
- breath phase
- cell position

The system should think in terms of **graphic resolution** rather than separate systems for:

- variant
- directional graphics
- neighbor graphics
- animation frames

Those are all selector inputs into one resolution step.

## Locked Conceptual Model

### 1) Graphic Identity

Each cell has a compact `graphic_id`.

This `graphic_id` is the canonical identity for both:

- single-character / glyph-like visuals
- atlas/tile/sprite-like visuals

A plain character is therefore not a separate visual architecture. It is a small graphic source.

### 2) Appearance Slots

Each cell supports at most 3 slots.

The slots map to the existing RGB-band style logic:

- slot 1
- slot 2
- slot 3

A graphic definition determines how many slots it actually uses.

Typical use:

- glyph-like graphic: usually slot 1 only
- simple tile: 1 to 3 slots
- compound/directional atlas graphic: 1 to 3 slots

User-facing language may still say "color", but internally this should be treated as slot-based appearance data.

First-pass canonical shape:

```ts
type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: { r: number; g: number; b: number } };

type SlotAssignments = Partial<Record<1 | 2 | 3, SlotValue>>;
```

Important first-pass lighting rule:

- material slot values are light-reactive
- flat RGB slot values are direct color in first pass

### 3) Weight

Weight remains shared and universal:

- 4 steps
- same authored meaning everywhere
- different backends may realize it differently
  - font weight for glyphs
  - atlas frame row/column selection for tiles

### 4) Runtime Selector Inputs

The stored payload stays small.

The renderer receives context inputs such as:

- resolved cell/world position
- facing
- viewer direction
- cardinal neighbors
- diagonal neighbors
- current breath phase
- lighting or other render context already supplied by runtime

These inputs do not create different payload categories.
They only influence how a graphic resolves its presentation.

### 5) Presentation Resolution

A graphic definition resolves from:

- `graphic_id`
- weight
- slot assignments
- selector inputs

into a chosen presentation.

Examples of presentation choice:

- a front-facing chest form vs side-facing chest form
- a wall corner vs center vs edge form
- a grass sway breath state
- a glyph shading differently because it is surrounded

This plan uses **presentation** as the neutral term instead of overcommitting to separate systems like "variant", "dynamic", or "frame".

## Important Naming Direction

The system should avoid muddy top-level categories like:

- dynamic graphics
- special graphics
- simple vs dynamic payloads

Instead, a graphic definition should simply declare what selector inputs it cares about.

Examples:

- ignores all selector inputs
- uses facing
- uses view direction
- uses cardinal neighbors
- uses diagonal neighbors
- uses breath phase
- uses combinations of the above

This is the cleaner seam.

## Graphic Definitions vs Material Definitions

A crucial architectural split:

### Graphics own structure and presentation selection

Graphic definitions should own things like:

- stable `graphic_id`
- source/backend kind
- how many slots are used
- default weight
- default slot assignments if any
- facing/view presentation selection
- neighbor-based presentation selection
- breath-based presentation selection
- compound presentation rules if needed

Long-term this should be represented by an explicit graphic-definition registry rather than naming conventions or backend-specific manifests acting as the primary authority.

### Materials own surface/color behavior

Material definitions should own things like:

- semantic color response
- lighting response
- palette mapping
- blend/surface traits
- future shader-like color behavior

A material should not decide the silhouette/form of the chest.
A graphic should not decide the internal lit response of bronze.

## Breath, Not Free Time

This architecture should be built around:

- breath phase / breath count

It should **not** be designed around raw continuous time in the first pass.

Why:

- breath already exists as a shared language
- breath-based animation will look more coherent in this project
- breath keeps the presentation model discrete and legible
- raw-time support would add complexity early without clear need

If a future system needs true time, it should be added later as another selector input, not as a first-pass foundation.

## Canonical Payload Direction

The end-state canonical payload should conceptually be:

- `graphic_id`
- `slot assignments` (up to 3)
- `weight`

The legacy idea that a cell is fundamentally:

- `char`
- `rgb`
- `weight_index`

should be retired as a source-of-truth model.

A printable single character may still exist as a derived or minimal case, but it should not remain a separate architectural truth.

`rgb` may survive temporarily as a runtime compatibility field for current font/UI draw paths, but it should be treated as derived or mirrored convenience data rather than canonical authored appearance truth.

## Critique Of Compact Id Strategy

Compact ids are good for storage size.

However:

- the id prefix should not be the real source of behavior truth
- behavior must live in the graphic definition registry/resolver

So even if compact namespaces are used, such as short ids for storage, the architecture should not depend on string prefixes like `s` or `d` as the authoritative behavior split.

The definition table/resolver must remain authoritative.

## Authoring Direction

The painter should eventually author this same canonical payload.

That implies future painter support for:

- selecting a `graphic_id`
- editing slot 1 / 2 / 3 selectively
- writing to all slots or filtered combinations
- keeping weight as a shared axis
- preserving richer per-cell visual data through save/load/history/projection

This suggests a useful painter UX direction:

- no explosion of new tools
- use filters / locks / channel targeting instead

Examples:

- paint only slot 1
- paint only slot 2
- paint only slot 3
- paint all slots
- lock shape while editing slots
- lock slots while editing weight or graphic

## Scope Boundary

This plan is about:

- visual payload unification
- render selection architecture
- painter/game source-of-truth alignment

This plan is not yet the final implementation plan for:

- painter tool UX details
- full atlas authoring workflow
- multi-cell object authoring UX
- migration tooling for old documents
- serialization compression format details

## Required Rewrites And Reconnections

This is the main practical architecture impact.

### 1) Canonical cell/voxel storage rewrite

Current issue:

- `src/ascii_painter/painter_document.ts` canonical voxel records only store `char`, `rgb`, `weight_index`
- richer payloads already exist elsewhere but are not the canonical saved truth

Needed direction:

- replace painter canonical voxel truth with the unified visual payload model
- remove the schema gap between saved painter content and runtime display cells

Primary files to revisit:

- `src/ascii_painter/painter_document.ts`
- `src/ascii_painter/types.ts`
- any clone/normalize/save/load/history helpers touching painter voxels

### 2) Runtime cell contract unification

Current issue:

- `src/ascii_painter/types.ts` and `src/mono_ui/types.ts` already partially overlap
- there is still conceptual split ownership between text-style and graphic-style fields

Needed direction:

- define one canonical runtime cell visual contract shared across painter/game paths where possible
- ensure the contract is built around graphic identity + slot assignments + weight, not legacy text-first assumptions
- demote `rgb` to compatibility/derived status where old draw paths still need it
- replace material-id-only slot typing with the first-pass slot-value union

Primary files to revisit:

- `src/ascii_painter/types.ts`
- `src/mono_ui/types.ts`
- adapters that clone or project cells

### 3) Graphic resolution pipeline cleanup

Current issue:

- the game render stack already contains useful pieces for graphic resolution, materials, facing, view direction, and atlas lookup
- the naming/ownership still reflects earlier incremental growth

Needed direction:

- define one explicit render-resolution step from payload + selector inputs -> presentation
- clarify what belongs to graphic definition resolution vs material/surface resolution
- replace prefix-based backend routing with explicit graphic-definition/source-kind authority

Primary files to study and likely reshape:

- `src/render_shaders/graphics_contract.ts`
- `src/render_shaders/graphic_resolver.ts`
- `src/render_shaders/resolver.ts`
- `src/render_shaders/types.ts`
- `src/render_shaders/context_builders.ts`

### 4) Atlas/material application path cleanup

Current issue:

- atlas rendering already decodes RGB bands into material slots and applies lighting
- this is close to the desired direction, but not yet framed as the universal slot-application path

Needed direction:

- make the slot-application path the canonical appearance application concept
- keep glyph-like and atlas-like graphics aligned under the same slot model
- allow the canonical slot model to represent both semantic materials and flat RGB values
- keep atlas backend/source manifests subordinate to shared graphic-definition authority

Primary files to revisit:

- `src/mono_ui/runtime/atlas_runtime.ts`
- `src/mono_ui/runtime/cell_renderer.ts`
- `src/mono_ui/runtime/material_registry.ts`
- `src/mag/light.ts`

### 5) Painter projection and runtime adapters

Current issue:

- painter adapters already preserve some richer cell data
- canonical document truth still lags behind

Needed direction:

- reconnect painter document -> runtime projection -> render cells through one unified payload contract

Primary files to revisit:

- `src/ascii_painter/painter_view_projection_adapter.ts`
- any painter projection/runtime scene builders
- any painter display-cell cloning helpers

### 6) Render payload builders and producers

Current issue:

- game payload builders produce graphics/materials/state in several places
- painter and game do not yet clearly converge on one authored/runtime visual source format

Needed direction:

- audit all places that produce render payloads or cells
- reconnect them to the unified visual payload language

Primary files to revisit:

- `src/render_shaders/payload_builders.ts`
- entity/tile/item render profile producers
- painter brush / edit state producers later in implementation

## Required Deep Dives Before Implementation

Before any rewrite begins, perform focused deep dives in this order.

### Deep Dive 1: Current runtime visual data flow

Trace exactly how visual data moves today across:

- payload builders
- render resolution
- layer reduction
- cell renderers
- atlas resolution
- painter projection adapters

Output needed:

- one diagram or note set showing the true current data flow
- explicit list of all current sources of `char`, `graphic`, `materials`, `rgb`, `weight_index`, `light_mag`, facing, and neighbor data

### Deep Dive 2: Canonical graphic definition surface

Status: completed.

Conclusions locked for planning:

- graphics own structure and presentation selection
- materials own appearance behavior
- slot assignments own per-instance fill choices
- the architecture should move toward an explicit graphic-definition registry
- backend/source kind must be explicit rather than inferred from prefixes like `text_` or `tile_`

Output produced:

- `docs/plans/2026_05_07_unified_graphic_payload_graphic_definition_surface_deep_dive_2.md`

### Deep Dive 3: Slot value model

Status: completed.

Conclusions locked for planning:

- canonical slot assignments should use a small tagged union
- first pass slot value kinds are:
  - `{ kind: 'material'; material_id: string }`
  - `{ kind: 'flat_rgb'; rgb }`
- canonical authored appearance truth should move into slot assignments
- `rgb` should be treated as compatibility/derived runtime data during migration
- first-pass lighting policy differs by slot kind:
  - material values are light-reactive
  - flat RGB values are direct color

Output produced:

- `docs/plans/2026_05_07_unified_graphic_payload_slot_value_model_deep_dive_3.md`

### Deep Dive 4: Breath-driven presentation selection

Define how breath picks presentation without bringing in raw time.

Questions to settle:

- what exact breath input is supplied?
- global breath phase, local breath modulo, or both?
- how does a graphic definition specify breath presentation changes?

Output needed:

- one agreed breath selector model
- examples: grass sway, leaf movement, subtle glyph shimmer if allowed

### Deep Dive 5: Legacy cutover strategy

Even though the end goal is no legacy source-of-truth split, the repo still contains older assumptions.

Questions to settle:

- what gets hard-rewritten?
- what gets temporarily adapted?
- where is compatibility acceptable only as a migration bridge?
- what old fields stop being authoritative immediately?

Output needed:

- explicit cutover strategy with a deletion list

## Proposed Implementation Phases

The implementation has now begun. The plan should be read using the status labels below rather than as a purely future phase list.

### Phase A: Canonical authored truth

Status: completed.

Completed work:

- unified painter-authored storage now preserves `graphic`, `appearance_slots`, `materials`, `rgb`, `weight_index`, and related payload fields
- painter document schema was bumped to version `6`
- save/load and legacy adapters now preserve richer visual payloads instead of dropping them

### Phase B: Projection/runtime contract preservation

Status: completed.

Completed work:

- painter projection adapters now preserve `graphic`, `appearance_slots`, and `materials`
- projection clone paths deep-copy richer visual payloads
- shared runtime contract types now include canonical `AppearanceSlotAssignments` / `AppearanceSlotValue`
- render-layer reduction preserves `appearance_slots` through to cells

### Phase C: Producer/resolver threading

Status: completed for primary/runtime-authoritative paths, with low-traffic audits still useful.

Completed work:

- payload builders now accept and emit `appearance_slots`
- several tile/item/structure producer paths now pass `appearance_slots`
- render resolution preserves `appearance_slots` as first-class runtime payload
- compatibility `materials` can now be derived from authoritative material-kind slot assignments

Remaining work in this phase:

- audit remaining low-traffic producers and helper paths that may still reconstruct old-shape cells or payloads
- remove any remaining silent loss of `appearance_slots` in secondary UI/runtime pipelines

### Phase D: Backend consumption cutover

Status: completed for active painter preview, authoritative store, and authoritative server-command paths; consistency follow-up still active.

Completed work:

- runtime font drawing now prefers authoritative `appearance_slots` before legacy `rgb`
- atlas tint resolution now prefers authoritative `appearance_slots` before compatibility `materials`
- atlas/frame cache keys now include `appearance_slots`
- runtime authority/fallback ordering is now established as:
  - `appearance_slots`
  - compatibility `materials`
  - legacy `rgb`
- authoritative store/history/raster-state paths now preserve `graphic`, `appearance_slots`, and `materials`
- `/api/painter/command` authoritative parsing now preserves rich voxel payload for:
  - `apply_group_voxels`
  - `set_group_raster_state`
  - raster `set_group_property_block`

Remaining work in this phase:

- continue sweeping secondary editor/runtime paths so the same authority ordering holds everywhere
- continue reducing legacy assumptions in brush, erase, text, paste, and move behaviors
- keep `materials` as compatibility-only rather than user-facing authority
- add targeted regressions around authoritative command normalization so server payload preservation cannot silently regress

Primary targets:

- `src/mono_ui/runtime/cell_renderer.ts`
- `src/mono_ui/runtime/atlas_runtime.ts`
- `src/mono_ui/runtime/material_registry.ts`
- `src/mag/light.ts` if needed for slot-kind lighting policy clarity
- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`
- `src/ascii_painter/save_system.ts`

### Phase E: Visual picker / brush authority cleanup

Status: active implementation phase, but no longer blocked by destructive authoritative tile loss.

Goal:

- make painter brush state participate in the unified visual payload model instead of remaining char-only state
- ensure picker-selected atlas/tile graphics survive brush persistence, sampling, erase, and repaint flows
- make brush/erase semantics respect canonical authority ordering as much as practical before full slot-targeted UX lands

Completed work:

- the `VISUALS` picker now includes first-pass atlas/tile graphic entries alongside glyphs and gradiator controls
- picker selection can now populate brush `graphic`, `appearance_slots`, `materials`, `rgb`, and `weight_index`
- painter brush application paths now write richer visual payloads into cells instead of dropping them
- eyedropper/sample paths now preserve richer visual payloads back into brushes
- tool-property persistence now preserves full brush visual payload, including `graphic`, `appearance_slots`, and `materials`
- graphic brush weight is now synchronized with brush weight state during load and weight edits
- initial brush erase/paste/text consistency fixes now treat graphic-only cells more correctly in several key paths
- registry-driven atlas/tile picker data has replaced the earlier curated first-pass picker list

Next work inside this phase:

- make brush color and erase semantics increasingly slot-aware
- continue sweeping `char === ' '` assumptions where graphic-only cells should count as occupied
- clean up remaining move/text/helper paths that still reconstruct legacy text-only cells in low-traffic operations
- expand regression coverage for graphic-only cells in authority, move, and property-raster operations

### Phase F: Presentation/definition cleanup

Status: planned after slot-behavior refinement and remaining legacy empty-path cleanup.

Goal:

- formalize presentation selection more explicitly around graphic definitions
- continue reducing backend- and prefix-driven authority assumptions
- reconnect facing/view/neighbors/breath into one clearer presentation-selection surface

### Phase G: Legacy authority removal

Status: planned.

Goal:

- retire legacy text-first assumptions as source of truth
- reduce `materials` to a derived/compatibility bridge
- reduce `rgb` to derived/fallback behavior
- keep only minimal temporary shims where required during cutover

## Explicit Non-Goals

- preserving legacy `char/rgb` authority forever
- keeping two equal source-of-truth payload models
- designing around raw free-running time
- committing to prefix-based id behavior rules as architecture
- solving all painter UX details in this plan

## Open Decisions

These still need to be locked before implementation planning becomes concrete.

### 1) Exact slot value representation

Locked by Deep Dive 3:

- first-pass slot assignment shape is a tagged union of:
  - flat RGB color
  - material reference

### 2) Compact id format

Need to decide:

- exact compact id shape for storage
- whether graphic ids and material ids share a common compact registry style
- how runtime-generated custom directional graphics are registered

### 3) Compound presentation scope

Need to decide whether first implementation includes:

- only single-cell presentations
- or also compound/multi-cell presentation definitions

### 4) Glyph source registration

Need to decide how glyph-like graphics are represented canonically:

- direct single-character literal in definition data
- compact glyph id pointing to a char source
- hybrid approach

### 5) Neighbor context surface

Need to decide the minimum neighbor information exposed to presentation selection:

- occupancy only
- graphic family/type hints
- material/type hints
- full neighboring rendered payload metadata

## Acceptance Criteria For The Architecture

The architecture is ready for implementation planning when all of the following are true:

- one plain-English canonical visual payload has been agreed
- one plain-English presentation resolution model has been agreed
- one plain-English slot/application model has been agreed
- painter and game no longer have competing visual source-of-truth descriptions
- the rewrite targets and cutover sequence are explicit
- deep-dive outputs exist for the render path questions above

## Final Direction

The intended destination is:

- one small stored visual payload per cell
- one shared slot-based appearance model
- one shared 4-step weight model
- one render-resolution step that selects presentation from context
- one source of truth across painter and game visual data

This should be treated as a rewrite toward architectural clarity, not as a compatibility layering exercise.

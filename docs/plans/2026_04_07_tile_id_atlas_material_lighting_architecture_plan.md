# Tile-ID Atlas Material Lighting Architecture Plan

Date: 2026-04-07

## Intent

Establish the primary rendering architecture for moving THAUMWORLD from character-first/font-first rendering to tile-id-driven atlas rendering while preserving the fixed `12x16` cell contract and keeping font rendering as a compatible fallback.

This plan is architecture-first. It is meant to lock contracts, boundaries, data flow, and system responsibilities before we do a larger backend implementation pass.

This plan is also the source of truth for how the following systems are expected to fit together:

- tile-id-driven atlas rendering
- font fallback rendering
- atlas families and multi-sheet growth
- sprite material decoding
- semantic value bands and future world lighting
- indexed-palette quantization
- facing and 6-direction view rendering
- future FOV/visibility-aware rendering inputs
- future character animation atlas compatibility

Implementation priority for this plan:

1. lock rendering contracts and semantic data flow
2. lock atlas/material/value architecture
3. lock performance architecture expectations before large content growth
4. implement a narrow vertical slice (`grass`) without violating the long-term model

If an implementation task conflicts with this priority order, follow the priority order.

## Relationship To Existing Plans

This plan builds on and updates earlier rendering documents:

- `docs/plans/2026_03_07_advanced_rendering_plan.md`
- `docs/plans/2026_03_10_multi_tile_rendering_plan.md`

Those plans remain important architectural references, especially for:

- render queue and reduction expectations
- shader system integration
- multi-voxel and facing-aware rendering
- future DOM world-layer performance work

But this document is the primary source of truth for tile-id atlas rendering, material decoding, semantic value handling, and the future-facing renderer contract.

## Non-Goals

- Do not implement the full world-lighting simulation in this pass.
- Do not implement final character animation behavior in this pass.
- Do not implement final FOV gameplay logic in this pass.
- Do not finalize every performance optimization before the first atlas pilot works.
- Do not replace font rendering everywhere immediately.
- Do not redesign gameplay tags or movement systems around rendering in this pass.

## Locked Decisions

- The authoritative render cell contract remains fixed at `12x16`.
- Rendering is tile-id driven, not character driven, even if font fallback remains available.
- The atlas schema supports all 6 view directions from the start:
  - `north`
  - `south`
  - `east`
  - `west`
  - `up`
  - `down`
- Weight count is `4`.
- Atlas weight ordering stays stable and in-order.
- Color bands are semantic and fixed as:
  - `1 = red`
  - `2 = green`
  - `3 = blue`
- `black` and `white` are overrides, not normal material-value steps.
- There are `4` semantic value levels other than the overrides:
  - `darkest`
  - `2nd_darkest`
  - `2nd_lightest`
  - `lightest`
- Sprites do not encode final indexed world colors directly.
- Sprite colors encode band identity and semantic brightness/value intent.
- Material assignment is external to sprite art.
- Initial renderer behavior may assume full lighting for all cells, but the architecture must reserve a clean place for future per-cell lighting inputs.
- Material color selection is post-lighting for now.
- A material currently means exactly 4 resolved colors plus a stable material id/name.
- Materials are stored in their own database, not as ordinary general-purpose tag definitions.
- Materials are a higher-order content layer that can affect both rendering and rules.
- Materials may later change at runtime because of upgrades, heat, state changes, or other gameplay transformations.
- Transparent atlas pixels leave lower layers/background intact.
- First pilot asset is `grass`.
- `grass` pilot constraints:
  - same graphic for all 6 view directions initially
  - 4 separate weight graphics
  - only one material slot used initially
  - only the red band/material slot is active initially
  - pilot source art currently exists at `graphics/thaumworld/tiles/grass.png`
  - current pilot layout is one column with 4 rows, one row per weight

## Current State (Already In Repo)

- The fixed `12x16` cell contract is already centralized.
  - `src/mono_ui/runtime/ui_metrics.ts`
- Render backend selection already exists conceptually as `font | atlas`.
  - `src/mono_ui/runtime/render_theme.ts`
- Shared cell rendering already routes both canvas and DOM rendering through one seam.
  - `src/mono_ui/runtime/cell_renderer.ts`
  - `src/ascii_painter/voxel_dom_renderer.ts`
  - `src/mono_ui/runtime/canvas_runtime.ts`
- The current atlas backend is only a stub and falls back to font rendering.
  - `src/mono_ui/runtime/cell_renderer.ts`
- Current render output is still effectively character-first.
  - `src/render_shaders/types.ts`
  - `RenderLayer` currently carries `char`, colors, weight, and style, but not a semantic graphic reference.
- Facing already exists in parts of the data model and render context.
  - `src/render_shaders/types.ts`
  - `src/types/place.ts`
- The shader/render stack already exists and should be extended, not replaced.
  - `src/render_shaders/`
- The first pilot atlas source asset now exists in repo.
  - `graphics/thaumworld/tiles/grass.png`
  - current interpretation: one tile id, one source column, 4 stacked weight rows

## Working Render Taxonomy

This plan uses the following content/render taxonomy.

- `tiles` are land and atomic place render cells
- `items` are things that can be picked up
- `characters` are actors and NPCs
- `structures` are grouped or multi-cell place objects that provide shared state/context but do not replace cells as the final render unit

Architecture rule:

- the visible world is still rendered cell-by-cell
- multi-cell structures and multi-cell characters should provide shared context used during per-cell render resolution
- a tree, double chest, double door, or two-cell character should still render as individual cells whose final graphics are resolved with extra shared context

## Immediate Working Assumptions For The Grass Pilot

These assumptions are intentionally concrete so implementation can begin alongside this plan without reopening basic format questions.

- `grass.png` is the first authoritative pilot atlas source.
- It currently represents one tile id only: `grass`.
- The file is laid out as:
  - 1 column
  - 4 rows
  - each row is one `12x16` weight variant
- The current file does not yet encode directional variation.
- All 6 schema directions for `grass` should resolve to the same source entry initially.
- Only color band `1` / red is used in the pilot.
- Initial rendering should assume full lighting.
- Initial implementation may hardcode or manifest-encode the pilot atlas layout, but the code path must already be shaped for multi-sheet atlas families.

## Working Development Rule

This plan is no longer only a future architecture note. It should now be treated as a development companion document.

That means:

- architecture decisions should be written here before broad implementation expands
- when implementation lands, the checklist in this file should be updated
- if a concrete pilot decision is made for `grass`, atlas families, material decoding, or quantization, it should be recorded here rather than left only in code

## Core Architectural Goals

- One render-output model must support both font and atlas rendering.
- Graphic identity must come from content databases, not from hardcoded renderer-only mappings.
- Tile-id graphics must become first-class renderer inputs.
- Atlas graphics must be resolved by semantic identity, not by hardcoded pixel coordinates embedded in gameplay code.
- Material assignment must be external to sprite art and scalable to many content families.
- Sprite value bands must remain compatible with future lighting transforms.
- Final visible colors must remain compatible with the indexed game palette.
- View direction and object facing must stay separate concepts.
- Future FOV/visibility data must be easy to route into renderer decisions without reworking atlas contracts.
- Character-specific atlas sheets must be able to share animation structure and rendering code.
- The architecture must scale to many visible tiles and eventually thousands of assets.

## Target Architecture

### 1) Render Identity Layer

Rendering should move from this mental model:

```text
payload -> char/color/weight -> draw
```

to this mental model:

```text
payload -> semantic render identity -> resolver -> font or atlas draw
```

Core rule:

- The renderer should receive a semantic graphic reference such as `terrain:grass` rather than only a character.
- `char` should remain as fallback/debug data, not as the long-term primary identity for world graphics.

### 1.1) Database-Owned Graphic Identity

Graphic identity should be authored in the same databases that already define tiles, items, characters, and grouped place objects/structures.

Core rules:

- tile graphics should be defined in tile/structure databases
- item graphics should be defined in item databases
- character graphics should be defined in character/kind databases
- the database is the source of truth for base graphic identity
- renderer code should resolve database-provided graphic definitions rather than inventing parallel hardcoded asset mappings

Initial expectation:

- database records should be able to describe a base atlas tile id and directional/view-specific graphic callouts
- these definitions should eventually replace char-only display data as the primary world-graphic source

### 1.2) State / Tag / UX Graphic Overrides

Base graphic identity does not mean fixed final graphics.

The final rendered graphic may still change because of:

- object state
- tags
- UI/interaction state
- renderer context

Examples already present in the game:

- chests opening/closing
- fire-related display changes
- foliage/berry-like state changes

Architectural rule:

- base graphic identity comes from the database
- final override decisions may be applied by the render pipeline, shader/tag modifier layer, or state-aware graphic resolver
- this work should migrate current ad hoc tag-driven char replacement toward semantic graphic replacement

### 2) Atlas Family Layer

Atlas assets should be organized by family, not as one global monolithic sheet.

Initial expected family examples:

- `terrain`
- `props`
- `items`
- `actors_humanoid`
- `actors_creature`
- `ui`

Family rules:

- each family may have one or more PNG sheets
- each family has one semantic manifest
- each family uses the same fixed render cell contract unless explicitly declared otherwise in a future extension
- each family supports all 6 view directions in schema, even if some tiles alias to the same art initially
- early implementation may begin with one-file pilot families, but runtime contracts must not assume a single-sheet future

### 2.1) Source Asset Tree

The graphics source tree should be treated as authoring input, not necessarily as the final runtime-packed layout.

Current pilot source root:

- `graphics/thaumworld/tiles/`

Expected near-term growth:

- `graphics/thaumworld/tiles/`
- `graphics/thaumworld/props/`
- `graphics/thaumworld/items/`
- `graphics/thaumworld/actors/`

Architectural rule:

- source art organization should stay human-manageable
- runtime atlas manifests/loaders may later pack, alias, or reorganize these sources without changing semantic tile ids

### 3) Material Layer

Sprites are not drawn as final materials. They are drawn as brightness/material masks.

Core rules:

- sprites do not define what material an object is made of
- render payloads or resolved object data define material assignments
- a sprite can expose up to 3 material bands
- material bands map to semantic slots rather than to one hardcoded color ramp
- materials currently resolve to 4 stored colors, one for each non-override semantic value
- materials are their own content database layer, not a subsection of ordinary tag definitions
- materials may contribute rule-facing semantics to objects made from them

Example long-term usage:

- the same tree sprite can be rendered using different wood-like or magical material ramps
- the same chest sprite can be rendered with different body/metal/gem materials without redrawing the sprite

### 3.1) Material Definition Contract

Materials should be small, precise content definitions.

They are not broad tags like `MEAT` or `FLORA`.
They are specific material identities like:

- `SANDSTONE`
- `WOOD_DARK`
- `WOOD_LIGHT`

Initial material contract:

```ts
type MaterialDef = {
  id: string;
  name: string;
  render: {
    colors: {
      darkest: IndexedColorRef;
      '2nd_darkest': IndexedColorRef;
      '2nd_lightest': IndexedColorRef;
      lightest: IndexedColorRef;
    };
  };
  rules: {
    hardness_mag?: number;
    weight_mag?: number;
    flammability_mag?: number;
  };
  contributes_tags?: string[];
};
```

Current architectural rule:

- material colors are currently treated as the 4 post-lighting resolved colors used by the renderer
- future expansions may add fields like footstep sounds, flammability, edibility, and other rules-facing semantics
- that future growth is expected, but the initial renderer integration should keep the material definition simple
- start with real rule-facing numeric data and real contributed tags, but keep the schema intentionally compact

### 3.2) Material Database Ownership

Materials should live in a dedicated material-definition database.

Architectural rules:

- materials are not ordinary tag definitions
- materials may contribute tags to tiles/items/entities/characters that use them
- material assignment should come from content databases for tiles, items, entities, and structures
- renderers and rule systems should both be able to consume the same material definition

Recommended first storage model:

- a dedicated material definition file/database
- object definitions reference material ids by slot
- effective tag/rule resolution may later merge material-contributed tags into the object's final semantic state

### 3.3) Material-Driven Derived Properties

Materials are expected to affect more than visuals.

Examples:

- item weight derived from item size mag plus material weight mag
- hardness-based interaction or break rules
- flammability-based fire interaction
- later sound or effect differences

Current architecture rule:

- materials are the precise physical/render identity layer
- tags remain the broader semantic/runtime rule layer
- materials may feed tags and derived stats, but should not be reduced to ordinary tags themselves

### 3.4) Initial Material Set

The initial implementation should stay small and use only currently useful/fun in-game materials.

Initial material targets:

- `FOLIAGE_GREEN`
  - for grass and bushes
- `WOOD_LIVE`
  - for bushes and chests
- `BRONZE`
  - for things like swords
- `STONE_PALE`
  - for stone bricks and statues

These are the first real data-backed materials and should be treated as the pilot set for both rendering and future rules integration.

### 4) Value + Lighting Layer

Sprite values are semantic brightness intents, not final world-lighting results.

Locked semantic ladder:

- `black` override
- `darkest`
- `2nd_darkest`
- `2nd_lightest`
- `lightest`
- `white` override

Initial implementation rule:

- all cells may render as if under full lighting

Architecture rule:

- world lighting must later be able to remap the 4 semantic value levels per cell without changing sprite art or tile ids
- black and white remain absolute overrides

Current implementation direction:

- write the lighting system seam now as constants/stubs/interfaces
- keep the first atlas pilot rendering under full lighting
- do not delay atlas architecture waiting for final world-lighting implementation

### 5) Palette Quantization Layer

The final visible output should remain compatible with the indexed palette system.

Pipeline rule:

```text
sprite pixel
-> decode band + semantic value
-> map band to material slot
-> resolve material ramp color
-> apply lighting transform
-> quantize to nearest indexed palette color
-> render
```

This preserves compatibility with:

- indexed-palette readability
- future blend modes
- future shader composition policy

Current simplification:

- for the first pass, materials provide 4 resolved indexed colors directly
- that means the initial atlas/material pilot can stay simple while still preserving the architecture seam for later lighting and quantization changes

### 6) View Direction And Facing Layer

The architecture must keep these separate:

- `view_direction`: where the camera/view is looking from
- `facing`: the orientation of the tile/entity/item itself

This is required for:

- orthographic 6-view mode
- future 90-degree matrix-view switching
- future fake perspective plane transforms
- multi-sided tiles and props
- character-facing graphics

### 7) Visibility / FOV Layer

FOV and hidden/revealed rendering is not implemented in this pass, but renderer contracts must reserve a place for it.

Architectural requirement:

- visibility/FOV should enter rendering as context/state, not as hardcoded atlas special cases

Likely future shape:

- `visible`
- `remembered`
- `hidden`
- `revealed_hidden_feature`

## Canonical Data Contracts (Proposed)

These are planning contracts, not yet final implementation code.

### A) Graphic Reference

```ts
type ViewDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

type RenderGraphicRef = {
  graphic_id: string;
  view_direction: ViewDirection;
  facing?: ViewDirection;
  weight_index: 0 | 1 | 2 | 3;
  variant?: string;
  frame?: string;
};
```

Graphic id note:

- graphic references should use one semantic id string rather than exposing atlas coordinates directly
- examples:
  - `tile_small_grass`
  - `item_sword`
  - `character_humanoid_idle`
  - `text_A`
- helper functions may later route `tile_`, `item_`, `character_`, and `text_` namespaces differently without changing gameplay/content semantics
- graphic ids should stay material-agnostic where possible
- material selection should provide bronze/wood/stone/etc behavior and coloration rather than baking that identity into the graphic id

### B) Render Layer

```ts
type RenderLayer = {
  char?: string;
  graphic?: RenderGraphicRef;
  fg?: Rgb;
  bg?: Rgb;
  z: number;
  blend?: RenderBlendMode;
  style?: StyleName;
  weight_index?: number;
  flags?: string[];
  materials?: Partial<Record<1 | 2 | 3, string>>;
};
```

Design note:

- `char` remains valid for font fallback and debug visualization.
- `graphic` becomes the long-term world/tile/entity rendering identity.
- if both are present, `graphic` should be preferred for atlas-backed rendering while `char` remains a stable fallback/debug representation

### C) Render Context

```ts
type RenderContext = {
  where: RenderWhere;
  space?: RenderSpace;
  x?: number;
  y?: number;
  screen_x?: number;
  screen_y?: number;
  place_x?: number;
  place_y?: number;
  world_x?: number;
  world_y?: number;
  world_z?: number;
  time_ms?: number;
  breath_index?: number;
  facing?: ViewDirection;
  view_direction?: ViewDirection;
  visibility_state?: 'visible' | 'remembered' | 'hidden' | 'revealed';
};
```

### D) Decoded Sprite Pixel

```ts
type DecodedSpriteBand = 0 | 1 | 2 | 3;

type DecodedSpriteValue =
  | 'black'
  | 'darkest'
  | '2nd_darkest'
  | '2nd_lightest'
  | 'lightest'
  | 'white';

type DecodedSpritePixel = {
  band: DecodedSpriteBand;
  value: DecodedSpriteValue;
};
```

### E) Material Assignment

```ts
type RenderMaterialAssignments = Partial<Record<1 | 2 | 3, string>>;
```

Interpretation:

- `1` maps to red-band pixels
- `2` maps to green-band pixels
- `3` maps to blue-band pixels

Initial pilot rule:

- `grass` uses only slot `1`

Object-definition rule:

- tiles/items/entities/structures assign material ids by slot in their own databases
- those assignments are the source of truth for which materials a graphic uses at render time

### E.1) Text / Font Fallback Contract

Text fallback should still route through the semantic render pipeline.

Architectural rule:

- content definitions should refer to either a tile-like graphic reference or a text-like graphic reference
- do not introduce a separate fallback-text-id field as a parallel identity path
- renderer resolution should choose atlas graphics first when available
- text fallback should come from the same semantic graphic entry rather than from a disconnected ad hoc glyph path

Practical implication:

- a semantic graphic id such as `text_A` can be routed to text rendering today
- that same namespace can later resolve to an atlas-backed text sheet if that becomes preferable

### F) Lighting Stub Contract

Initial architecture stub only:

```ts
type LightingMode = 'full_light';
```

Future expected expansion:

- per-cell lighting state
- semantic remapping table for the 4 non-override values
- black/white preserved as overrides

Recommended near-term constant table shape:

```ts
type SemanticValue = 'darkest' | '2nd_darkest' | '2nd_lightest' | 'lightest';

type LightingTransferTable = {
  darkest: SemanticValue;
  '2nd_darkest': SemanticValue;
  '2nd_lightest': SemanticValue;
  lightest: SemanticValue;
};
```

Initial stub mode:

- `full_light` leaves all 4 semantic values unchanged
- black stays black override
- white stays white override

Current simplification:

- material definitions already store 4 resolved colors
- future lighting work may later remap semantic values before final color resolution, but the first pilot does not need to solve that fully

## Atlas Manifest Schema (Planning Draft)

Atlas manifests should be semantic, family-based, and reusable across multiple PNG sheets.

Planning shape:

```ts
type AtlasSheetRef = {
  id: string;
  src: string;
};

type AtlasWeightFrameRef = {
  sheet: string;
  x: number;
  y: number;
};

type AtlasViewEntry =
  | {
      weights: [AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef, AtlasWeightFrameRef];
    }
  | {
      sameAs: ViewDirection;
    };

type AtlasTileEntry = {
  views: Record<ViewDirection, AtlasViewEntry>;
  material_slots?: Partial<Record<1 | 2 | 3, string>>;
  source_layout?: 'column_weights';
  fallback_char?: string;
};

type AtlasFamilyManifest = {
  family: string;
  cellWidth: 12;
  cellHeight: 16;
  bands: {
    1: 'red';
    2: 'green';
    3: 'blue';
  };
  sheets: AtlasSheetRef[];
  tiles: Record<string, AtlasTileEntry>;
};
```

### Grass Pilot Manifest Interpretation

The current `grass.png` pilot should be interpreted as:

```text
tile_id: grass
sheet: grass
layout: 1 column x 4 rows
row 0 -> weight 0
row 1 -> weight 1
row 2 -> weight 2
row 3 -> weight 3
all 6 views -> same source mapping initially
```

That means the first real atlas resolver does not need directional art selection for `grass`, but the schema must still resolve through the full 6-direction contract.

## Grass Pilot (Planning Target)

The first pilot asset should prove the architecture with minimal content scope.

Pilot rules:

- family: `terrain`
- tile id: `grass`
- all 6 view directions exist in schema
- all 6 directions may alias to one source initially
- 4 weights are distinct atlas entries
- only material slot `1` is used
- only red-band pixels are active initially
- lighting runs in full-light mode initially
- final colors still route through indexed-palette quantization
- current source art is authored in `graphics/thaumworld/tiles/grass.png`
- current source layout is one-column, four-row, weight-stacked atlas input

## Color / Value / Material Pipeline

The renderer should eventually execute this flow:

```text
render payload
-> semantic graphic ref + material assignments
-> atlas resolver picks family/sheet/view/weight/frame
-> atlas pixel decoder extracts band + semantic value
-> band maps to material slot (1 red / 2 green / 3 blue)
-> material system resolves a ramp for that slot
-> lighting system remaps semantic value for the current cell
-> result quantizes to nearest indexed palette color
-> pixel/cell is rendered
```

Core architectural rules:

- atlas art is not the final world color
- materials are not baked into sprite art
- lighting is not baked into sprite art
- palette quantization happens after material + lighting resolution

Current simplified implementation note:

- the first implementation may treat material colors as the 4 direct resolved colors for the non-override semantic values
- later lighting work may insert a stricter semantic-value transfer stage without changing atlas ids or material ids

## Transparency / Background / Layering Rules

These rules need to stay explicit because atlas rendering introduces more ambiguity than font rendering.

Locked current rule:

- transparent atlas pixels leave existing lower layers/background intact

Additional rules:

- black override and white override are sprite value signals, not transparency
- a transparent pixel is not the same as an unassigned material band pixel
- background fills remain a separate lower-layer concern unless a renderer pass explicitly emits background data

## Graphics Model Contract

Graphics should be owned by the content databases for tiles, items, characters, and grouped place objects/structures.

## Definition vs Instance Ownership

This split needs to stay explicit so graphics, materials, and runtime difs do not get mixed together.

### Definition Database Owns

- base graphics model
- default weight
- 6-direction view mapping
- known override declarations
- legal material choices
- default material choices

For grouped or multi-cell objects, the definition layer may also own:

- shared group graphics metadata
- known per-cell part roles
- main/reference tile rules

This is the authored source of truth.

### Inline Instance Owns

- active material assignments
- current state
- facing
- local tag deltas / runtime semantic differences
- any runtime difs that change how this specific instance renders

For grouped or multi-cell objects, inline/runtime ownership may also include:

- current shared/group state
- active per-cell role or role lookup
- current main/reference tile context

This is the live runtime owner for per-instance variation.

### Architecture Rule

- definitions declare what is possible and what is normal
- instances declare what is currently true
- the renderer should not invent authoritative base graphics or materials outside these sources
- material assignment normalization should happen through a shared helper so invalid/out-of-date materials can be repaired in one place

Planning shape:

```ts
type GraphicsModel = {
  base_graphic_id: string;
  default_weight: 0 | 1 | 2 | 3;
  views?: Partial<Record<ViewDirection, {
    graphic_id?: string;
    same_as?: ViewDirection;
  }>>;
  material_slots?: Partial<Record<1 | 2 | 3, string>>;
  overrides?: GraphicOverrideRule[];
};
```

Architectural rules:

- the database is the source of truth for a renderable's base graphics model
- the graphics model may point to tile-style or text-style semantic graphic ids
- graphic ids should be reusable across multiple content definitions
- views should support all 6 directions even if many entries alias initially

### Shared Graphics Model Schema Rule

All major content types should share this same base graphics model shape:

- tiles
- structures
- items
- characters

Some content types may extend the model later.

Expected examples:

- characters may add animation-oriented fields later
- tiles/structures may use richer state override sets and role-aware graphics data
- items may remain relatively simple

But the base shape should stay shared.

### Cell-As-Render-Unit Rule

The render system should treat the cell as the final atomic draw unit.

That means:

- even multi-cell objects render as one resolved state per occupied cell
- structures are not a separate giant render primitive replacing cell output
- characters with more than one occupied tile still render cell-by-cell

This keeps the render pipeline compatible with the existing matrix/cell model while allowing richer grouped visuals.

### Group / Shared Context Contract

Grouped or multi-cell objects should provide shared context to per-cell render resolution.

Planning shape:

```ts
type GroupRenderContext = {
  group_id: string;
  group_kind: 'structure' | 'character';
  main_tile?: { x: number; y: number; z?: number };
  facing?: ViewDirection;
  shared_state?: Record<string, unknown>;
  part_role?: string;
};
```

Architectural rule:

- the renderer resolves each occupied cell using both its local content data and any shared group context
- this is how trees, double doors, double chests, and multi-cell characters should be represented

### Inline Material Assignment Schema

Material assignments should be stored on the inline/live entity instance, not only on the authored definition.

Planning shape:

```ts
type InlineMaterialAssignments = Partial<Record<1 | 2 | 3, string>>;
```

Rules:

- definition data declares legal/default materials
- inline data stores active materials
- material-setting should go through a shared helper
- the helper should normalize illegal, missing, or outdated material ids back to legal/default choices

## Override Categories

Not all graphic overrides should be modeled the same way.

### 1) State Overrides

Used for persistent object state.

Examples:

- doors open/shut
- chest open/closed
- bush empty / partial / full
- upgraded or transformed objects

### 2) Tag / Rule Overrides

Used for effective semantic/runtime conditions.

Examples:

- trampled grass
- growth stage
- heated / frozen / burning states
- hidden / revealed variants later

### 3) Renderer Effect Overrides

Used for time-based or purely visual presentation effects.

Examples:

- fire flicker brightness
- subtle sway
- hover highlight
- selection flash

Architectural rule:

- state and tag/rule overrides belong to content/resolution architecture
- renderer effect overrides belong to renderer/effect systems
- renderer effect overrides should not become the only owner of persistent object-truth graphics

## Override Contract (Planning Shape)

```ts
type GraphicOverrideRule =
  | {
      kind: 'state';
      when_state: string;
      graphic_id?: string;
      material_slots?: Partial<Record<1 | 2 | 3, string>>;
      set_weight?: 0 | 1 | 2 | 3;
    }
  | {
      kind: 'tags';
      when_tags_all?: string[];
      when_tags_any?: string[];
      when_tags_none?: string[];
      graphic_id?: string;
      material_slots?: Partial<Record<1 | 2 | 3, string>>;
      set_weight?: 0 | 1 | 2 | 3;
      add_weight?: -3 | -2 | -1 | 0 | 1 | 2 | 3;
    };
```

Current design rule:

- keep content-defined overrides to state and tag/rule categories for now
- renderer-owned effect overrides can remain a separate system until a stronger shared effect contract is needed

## Override Precedence

Override precedence should be explicit and deterministic.

Recommended order:

1. base graphics model from the content database
2. state overrides
3. tag/rule overrides
4. renderer effect overrides
5. text fallback / placeholder if no atlas-backed result resolves

This keeps persistent object truth and transient visual effects clearly separated.

## Graphic Resolver Contract

Graphic resolution should be centralized.

It should happen before final drawing, not be reinvented separately by each final renderer path.

Planning flow:

```text
definition graphics model
+ definition material defaults/options
+ inline instance materials
+ inline state
+ effective tags
+ facing
+ view direction
+ optional group/shared context
-> effective render state
-> renderer effect modifiers
-> final font/atlas draw
```

Resolver inputs should include:

- definition graphics model
- definition material options/defaults
- inline material assignments
- inline state
- effective tags
- facing
- view direction
- optional group/shared context for multi-cell structures/characters

Resolver outputs should include one normalized render state used by the actual renderer.

## Effective Render State

The graphics resolver should produce one normalized render state before final drawing.

Planning shape:

```ts
type EffectiveRenderState = {
  graphic_id: string;
  weight: 0 | 1 | 2 | 3;
  material_slots: Partial<Record<1 | 2 | 3, string>>;
  view_direction: ViewDirection;
  facing?: ViewDirection;
  part_role?: string;
};
```

Architectural rule:

- the resolver should read content graphics models, effective tags, state, and renderer context
- the cell renderer should consume the effective render state rather than re-deciding content/state rules itself

## Content Definition Schema Pass

This is the next refinement point because the architecture is now clear enough to define exact database field shapes.

This pass must lock:

- the exact graphics-model field layout in tile/item/character/structure definitions
- the exact legal/default material field layout in those definitions
- the exact inline material assignment field layout
- the exact expression format for state overrides
- the exact expression format for tag/rule overrides
- the exact grouped-context / per-cell role field layout for multi-cell structures and characters

This pass is required before wide implementation because otherwise different systems will invent incompatible content shapes.

### Planned Definition Field Layouts

The exact file/database implementation may vary, but the content-facing field layout should converge on the following shapes.

### A) Tile Definition Shape

Tiles are land and atomic place render cells.

Planning shape:

```ts
type TileGraphicsDef = {
  graphics: GraphicsModel;
  materials?: {
    defaults?: Partial<Record<1 | 2 | 3, string>>;
    allowed?: Partial<Record<1 | 2 | 3, string[]>>;
  };
};
```

Expected use:

- base land graphics like grass, soil, stone, water-edge variants later
- optional state/tag overrides for growth, trampling, hidden surface features, etc.

### B) Item Definition Shape

Items are pickup objects.

Planning shape:

```ts
type ItemGraphicsDef = {
  graphics: GraphicsModel;
  materials?: {
    defaults?: Partial<Record<1 | 2 | 3, string>>;
    allowed?: Partial<Record<1 | 2 | 3, string[]>>;
  };
};
```

Expected use:

- `item_sword` stays material-agnostic at the graphic-id level
- material assignments determine bronze/wood/stone/etc behavior and color
- later derived weight can use item size plus material mags

### C) Character Definition Shape

Characters are actors and NPCs.

Planning shape:

```ts
type CharacterGraphicsDef = {
  graphics: GraphicsModel;
  materials?: {
    defaults?: Partial<Record<1 | 2 | 3, string>>;
    allowed?: Partial<Record<1 | 2 | 3, string[]>>;
  };
  group_render?: {
    part_roles?: string[];
    main_part_role?: string;
  };
  animation?: {
    family?: string;
    default_state?: string;
  };
};
```

Expected use:

- two-tile characters render cell-by-cell
- shared character context informs both occupied cells
- later animation fields can extend the same shared model

### D) Grouped Place Object / Structure Definition Shape

Grouped place objects coordinate multiple rendered cells but do not replace cells as the final render unit.

Planning shape:

```ts
type GroupedPlaceGraphicsDef = {
  graphics: GraphicsModel;
  materials?: {
    defaults?: Partial<Record<1 | 2 | 3, string>>;
    allowed?: Partial<Record<1 | 2 | 3, string[]>>;
  };
  group_render: {
    part_roles: string[];
    main_part_role: string;
  };
};
```

Expected use:

- trees
- double doors
- double chests
- statues or larger grouped place props

### Shared Material Definition Rule In Content

All four content categories should use the same material layout ideas:

- `defaults` define normal material choices authored in the database
- `allowed` defines legal runtime-selectable materials per slot
- inline/live instances store the currently active material ids

### Planned Inline / Runtime Field Layouts

These fields belong on the live instance or inline place object, not only the authored definition.

### A) Shared Inline Material Fields

```ts
type InlineRenderMaterialState = {
  materials?: Partial<Record<1 | 2 | 3, string>>;
};
```

### B) Shared Inline State Fields

```ts
type InlineRenderStateFields = {
  state?: Record<string, unknown>;
  facing?: ViewDirection | string;
};
```

### C) Grouped Context Fields

```ts
type InlineGroupedRenderState = {
  group_id?: string;
  part_role?: string;
  main_tile?: { x: number; y: number; z?: number };
};
```

For grouped place objects and multi-cell characters, these fields should provide the shared context that the resolver uses to produce one final cell render state per occupied tile.

### Planned Override Data Shape In Content

The content databases should express state and tag/rule overrides using a shared override vocabulary as much as possible.

Planning shape:

```ts
type GraphicOverrideRule =
  | {
      kind: 'state';
      when_state: string;
      graphic_id?: string;
      material_slots?: Partial<Record<1 | 2 | 3, string>>;
      set_weight?: 0 | 1 | 2 | 3;
    }
  | {
      kind: 'tags';
      when_tags_all?: string[];
      when_tags_any?: string[];
      when_tags_none?: string[];
      graphic_id?: string;
      material_slots?: Partial<Record<1 | 2 | 3, string>>;
      set_weight?: 0 | 1 | 2 | 3;
      add_weight?: -3 | -2 | -1 | 0 | 1 | 2 | 3;
    };
```

Current interpretation:

- state overrides handle things like open/closed or berry/fullness states
- tag/rule overrides handle things like trampled grass, growth, burning, hidden/revealed presentation, etc.
- purely visual animation/flicker/sway remains renderer-owned unless promoted later

## Performance Architecture (Initial Notes)

This section is architecture-only for now and should be refined in a later pass.

### Principles

- Prefer atlas families over one giant global atlas.
- Prefer manifest-driven semantic lookup over runtime string hacks.
- Prefer cacheable decode/lookup paths over recomputing per-pixel metadata every frame.
- Prefer correctness-first implementation for the pilot, then optimize the hot paths with data we can measure.

### Expected Runtime Needs

- atlas family cache
- PNG sheet image cache
- manifest cache
- atlas frame rect cache
- decoded sprite metadata cache
- dirty-layer or dirty-region invalidation where practical

### Near-Term Performance Rule

For the `grass` pilot, prefer a correctness-first implementation with explicit caches over premature packing/optimization.

That means:

- decode and cache the pilot sheet once
- cache frame rect lookup per tile id + view + weight
- do not build a giant packing pipeline before the pilot renderer path is proven
- do write the atlas-family APIs so multiple sheets can be introduced without reworking the renderer seam

### Expected Scale Concerns

- many visible tiles at once
- future thousands of assets overall
- future multiple actor atlas families with shared animation schema
- future visibility/FOV/lighting lookups per rendered cell

### Asset Loading / Memory Strategy (Stub)

This needs to stay part of the architecture even before the first optimization pass.

Initial rules:

- atlas families should be loadable independently
- renderer should tolerate missing or unloaded families with deterministic fallback behavior
- the pilot may eagerly load one family, but runtime contracts must support later lazy/on-demand loading
- source assets under `graphics/thaumworld/...` should be treated as authoring input; runtime loading/packing may evolve later without changing semantic ids

### Performance Questions For Refinement Passes

- Should decoded sprite pixels be cached per tile frame or pre-expanded into palette-ready ramps?
- When do we switch from simple per-cell draw to stronger dirty-region invalidation?
- How should atlas family loading be paged or grouped for large texture packs?

### Approach Candidates To Evaluate In Later Refinement Passes

Candidate A: Source-file-driven manifests

- simplest for early iteration
- easier to author by hand
- weaker for large-scale packing and build-time optimization

Candidate B: Build-time atlas packing + generated manifests

- stronger long-term performance and organization
- more upfront tooling complexity
- likely better once families contain many assets

Current recommendation:

- start with source-file-driven manifests/runtime loading for the pilot
- keep APIs compatible with later build-time packing

## System Interaction Notes

### Shader System

- The shader system should not be bypassed.
- Atlas graphics should integrate with the existing render payload/context/layer pipeline.
- Shaders may later modify layer graphics, colors, or material bindings rather than only `char` and `fg`.

### Render Identity Migration Strategy

Migration should happen by updating the content databases and the renderer contracts together.

Core rule:

- database definitions become the source of truth for graphics
- renderer resolves from those database definitions
- old char-based behavior remains only as fallback during migration

Expected migration order:

- tiles and grouped place objects first
- items next
- characters after the tile-id + direction + material path is proven
- UI remains mostly font-based until explicitly migrated

Current ad hoc graphic-changing logic that likely needs migration later:

- chest state display changes
- fire display logic
- foliage/fruit-like display logic

Migration rule:

- move these systems toward semantic graphic overrides and effective render state resolution rather than direct char substitution in renderer logic

## Migration From `display_char` And `render_shader`

Current rendering still uses older authored/runtime visual fields in several places.

### `display_char`

Current role:

- primitive authored or resolved visual identity
- often used as the direct character shown by the renderer

Migration direction:

- `display_char` should stop being the primary world-graphic identity
- base graphic identity should come from the graphics model in the content database
- `display_char` may remain temporarily as a fallback character source during migration

### `render_shader`

Current role:

- primitive graphics/state logic for things like containers, fire behavior, and display variation

Migration direction:

- some current `render_shader` responsibilities should move into:
  - graphics-model override declarations
  - centralized graphic resolver logic
  - renderer effect systems for purely visual/time-based behavior
- `render_shader` should not remain the only owner of persistent graphic-state decisions long-term

### Immediate Migration Targets

- chest open/closed display logic
- fire display variation
- foliage/fruit/growth-related display logic

These should be re-expressed through graphics models, state/tag overrides, and effective render state resolution.

### Tags And Materials

- Material assignment may eventually be tag-driven.
- This is desirable because rendering semantics can then align with gameplay semantics.
- This plan does not implement that logic yet, but it must not block it.

Current direction:

- materials should be able to contribute real tag instances or equivalent semantic tags to objects that use them
- start small with real data and the ability to swap materials out cleanly
- do not collapse materials into ordinary tag definitions

### Facing And Multi-Sided Rendering

- Multi-sided graphics depend on both `view_direction` and `facing`.
- Items, tiles, and entities should all be able to reuse the same semantic model.

### Future Rotations

- perspective-like plane transforms should consume the same renderer-facing `view_direction` and layer semantics
- 90-degree matrix-view switching should alter how world cells are read/projected without changing game mechanics
- both modes should remain renderer/view concerns, not gameplay-state mutations

### Future Character Atlases

- character atlases should share animation structure even if they use different sheets
- animation/schema compatibility should be preserved as a contract from the start
- characters should still fit the same grouped-context per-cell render model, even if they gain richer animation data later

## Failure / Fallback Policy (Architecture Stub)

Renderer behavior should stay deterministic when data is missing or incomplete.

Initial rules:

- missing atlas graphic -> use semantic fallback char if present
- missing fallback char -> use a stable placeholder glyph
- missing material assignment for an active band -> use a stable debug/default material
- missing family/sheet/manifest entry should not crash the renderer
- pilot implementation should log these conditions in a way that makes atlas migration debuggable

## Testing Strategy (Architecture Stub)

The eventual implementation should be validated by more than manual visual checking.

Planned test categories:

- manifest validation tests
- atlas frame lookup tests
- band/value decode tests
- material application tests
- palette quantization tests
- small-scene visual regression tests

## Implementation Phases

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested

### Phase 0: Contracts + Types

- [x] extend render-layer contracts to support semantic graphic refs
- [x] extend render context to include `view_direction`
- [x] define material assignment contracts for render layers/payloads
- [x] define material definition contracts and fallback behavior
- [~] define dedicated material database ownership and initial schema
- [x] define graphics model contract for tiles/items/characters/grouped place objects
- [x] define override categories and precedence contract
- [x] define grouped-context / per-cell role contract for multi-cell structures and characters
- [x] keep font fallback valid while contracts expand

### Phase 1: Atlas Family Schema + Loader Skeleton

- [x] define atlas family manifest schema in code
- [x] add atlas family loader/cache skeleton
- [~] support multiple PNG sheets per family
- [x] support per-view `sameAs` aliases
- [x] support the current `graphics/thaumworld/tiles/grass.png` one-column/four-row pilot layout without special-casing away the future multi-sheet model

### Phase 2: Material / Value Decoder Skeleton

- [x] define decoded sprite pixel model in code
- [x] implement red/green/blue band detection
- [x] implement semantic value detection for the 4 non-override levels plus black/white overrides
- [x] add MAG-native lighting transfer-table stubs for exact `-1 | 0 | 1 | 2` presets
- [x] add initial real material definitions for `FOLIAGE_GREEN`, `WOOD_LIVE`, `BRONZE`, and `STONE_PALE`
- [x] represent interpolative source-value colors explicitly in code
- [x] add a first pale-metal material for live multi-band content

### Phase 3: Palette Quantization Skeleton

- [x] define the indexed-palette quantization seam used by atlas output
- [x] add a first nearest-palette policy for atlas-derived colors
- [~] leave room for future blend/shader refinement

### Phase 4: Atlas Backend In Cell Renderer

- [x] replace atlas fallback stub with real atlas lookup/draw path
- [x] preserve font fallback for missing graphics
- [x] keep shared cell renderer as the only backend seam

### Phase 5: Grass Pilot

- [x] add a `terrain` atlas family
- [x] add `grass` tile id manifest entry
- [x] add 4 grass weights
- [x] alias all 6 views to the same source initially
- [x] use only material slot `1` / red band initially
- [x] render through full-light path
- [~] verify final output quantizes back to indexed palette
- [x] load from the actual pilot source asset at `graphics/thaumworld/tiles/grass.png`

Additional live content status:

- [x] chest atlas now uses live green and blue source bands
- [x] chest hardware now resolves through non-wood material slots

## Immediate Next-Step Development Checklist

This section is the handoff from architecture into active implementation.

### Step 1: Render Contracts

- [x] extend `src/render_shaders/types.ts` so `RenderLayer` can carry a semantic `graphic` reference
- [x] add `view_direction` to render context contracts
- [x] keep `char` valid as font fallback

### Step 2: Atlas Runtime Skeleton

- [x] add a runtime-safe atlas family manifest type module
- [x] add a loader/cache module for family manifests and image sheets
- [x] add a pilot `terrain` family definition for `grass`

### Step 3: Grass Pilot Resolver

- [x] resolve `terrain:grass` through a 6-direction schema
- [x] map all directions to the same source initially
- [x] map row index directly to weight index for the pilot image

### Step 4: Material Decode Skeleton

- [x] add red/green/blue band decoding helpers
- [x] add semantic value decoding helpers
- [x] add `light_mag` transfer-table stubs in MAG tables
- [x] add explicit interpolative source-palette entries and decode path

### Step 5: First Draw Path

- [x] implement atlas drawing in `src/mono_ui/runtime/cell_renderer.ts`
- [x] preserve font fallback if atlas data is missing
- [x] test with `grass` in the ASCII painter or a controlled render surface before broader migration

### Phase 6: Payload Migration

- [x] start emitting semantic `graphic` refs from render payload resolution for pilot content
- [x] keep `char` fallback active where content is not migrated yet
- [x] move base graphic identity into tile/item/character/grouped-object databases rather than renderer-only mappings
- [x] move material assignment into tile/item/character/grouped-object databases rather than renderer-only mappings
- [~] migrate existing direct graphic-changing logic toward state/tag semantic override resolution

### Phase 7: Directional And Facing-Aware Resolution

- [~] introduce view-dependent tile resolution
- [~] introduce facing-aware tile/entity/item resolution
- [x] document side reuse patterns for assets like chests
- [~] apply shared directional behavior to both in-place and item-style representations where appropriate

### Phase 7.5: Tile Connectivity Pilot

- [x] add an isolated tile-connectivity resolver seam
- [x] pass cardinal neighbor tile kinds through render context for place-tile rendering
- [x] add a first stone-brick mask-to-variant pilot with swappable slot mapping
- [x] keep connectivity behavior opt-in per tile definition

### Phase 8: Deferred Hooks

- [x] add lighting constants/stubs that can be replaced later
- [ ] add visibility/FOV context hooks without enabling full gameplay logic
- [ ] add character atlas schema notes/stubs for future animation families

## Open Questions / Deferred Decisions

- Exact indexed-palette quantization policy
- Where material definitions live first: data files vs code constants
- Exact character animation manifest shape when character atlases are introduced
- Whether background fills stay as render-layer `bg` or grow into a richer background pass
- Whether decoded sprite metadata should be cached per sheet, per tile frame, or pre-expanded further for performance
- Exact migration design for existing tag-driven graphic replacements once tile-id graphic identity is live
- Exact expanded lighting transfer-table behavior once world-lighting grows beyond the current `-1 | 0 | 1 | 2` presets
- Exact shape for material-contributed tag instances vs simpler semantic tag injection in the first implementation
- Exact content-database field layout for graphics models on tiles/items/characters/structures

## Next Refinement Point

The strongest next refinement target is the content-database schema pass.

That pass should lock:

- exact graphics-model field layouts for tiles, items, characters, and grouped place objects
- exact material-assignment field layouts in those databases
- how state overrides are expressed in content data
- how tag/rule overrides are expressed in content data
- how existing chest/fire/foliage logic maps into the new override model
- how grouped structures and multi-cell characters express shared state plus per-cell roles

## Implementation Notes (Current Progress)

- `grass` is the first live tile-id atlas pilot and now renders in-place from `graphics/thaumworld/tiles/grass.png`
- atlas-backed sprites now scale with the same cell metrics as the rest of the grid
- a single chest tile is now migrated to semantic graphics with:
  - atlas-backed front/side/back closed variants
  - atlas-backed front/side/back open variants
  - state-driven `open` override resolution
  - relative view handling based on facing
- chest-like item/inventory representations now carry semantic graphics/material data instead of only display chars
- item-style chest rendering is now routed through the same semantic graphics path instead of only using the legacy chest glyph

## Recommended Next Implementation Slices

The next useful slices are now smaller and clearer.

### Option 1: Foliage / Growth Migration

- migrate bushes/foliage from direct char variation toward semantic graphics + state/tag overrides
- good fit for berries/fullness/growth stage behavior
- exercises tag/state override architecture without requiring animation complexity first

### Option 2: Fire Split

- move fire to a semantic base graphic/state choice
- keep flicker/brightness modulation in renderer effect logic
- good fit for proving the state-vs-effect split in the architecture

### Option 3: Palette / Lighting Skeleton

- replace the current approximate material tinting with the explicit semantic-value/override path
- define the first indexed-palette quantization seam
- this is the right next backend step if we want to strengthen the rendering core before migrating more content

Recommended order:

1. foliage / growth migration
2. fire split
3. palette / lighting skeleton

## Acceptance Criteria For This Architecture Pass

This architecture pass is successful when all of the following are true:

- a single primary plan exists for tile-id atlas rendering and related future systems
- locked decisions are written down explicitly
- render identity, material, value, lighting, palette, facing, and visibility responsibilities are separated clearly
- the atlas family and grass pilot shape are documented clearly enough to implement without redefining the contracts mid-flight
- implementation phases exist as an executable checklist for later passes

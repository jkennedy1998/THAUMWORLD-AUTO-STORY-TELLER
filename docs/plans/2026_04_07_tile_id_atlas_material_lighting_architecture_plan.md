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
- First pilot asset is `grass`.
- `grass` pilot constraints:
  - same graphic for all 6 view directions initially
  - 4 separate weight graphics
  - only one material slot used initially
  - only the red band/material slot is active initially

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

## Core Architectural Goals

- One render-output model must support both font and atlas rendering.
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

### 3) Material Layer

Sprites are not drawn as final materials. They are drawn as brightness/material masks.

Core rules:

- sprites do not define what material an object is made of
- render payloads or resolved object data define material assignments
- a sprite can expose up to 3 material bands
- material bands map to semantic slots rather than to one hardcoded color ramp

Example long-term usage:

- the same tree sprite can be rendered using different wood-like or magical material ramps
- the same chest sprite can be rendered with different body/metal/gem materials without redrawing the sprite

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
  family: string;
  tile_id: string;
  view_direction: ViewDirection;
  facing?: ViewDirection;
  weight_index: 0 | 1 | 2 | 3;
  variant?: string;
  frame?: string;
};
```

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

### F) Lighting Stub Contract

Initial architecture stub only:

```ts
type LightingMode = 'full_light';
```

Future expected expansion:

- per-cell lighting state
- semantic remapping table for the 4 non-override values
- black/white preserved as overrides

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

### Expected Scale Concerns

- many visible tiles at once
- future thousands of assets overall
- future multiple actor atlas families with shared animation schema
- future visibility/FOV/lighting lookups per rendered cell

### Performance Questions For Refinement Passes

- Should decoded sprite pixels be cached per tile frame or pre-expanded into palette-ready ramps?
- When do we switch from simple per-cell draw to stronger dirty-region invalidation?
- How should atlas family loading be paged or grouped for large texture packs?

## System Interaction Notes

### Shader System

- The shader system should not be bypassed.
- Atlas graphics should integrate with the existing render payload/context/layer pipeline.
- Shaders may later modify layer graphics, colors, or material bindings rather than only `char` and `fg`.

### Tags And Materials

- Material assignment may eventually be tag-driven.
- This is desirable because rendering semantics can then align with gameplay semantics.
- This plan does not implement that logic yet, but it must not block it.

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

## Implementation Phases

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested

### Phase 0: Contracts + Types

- [ ] extend render-layer contracts to support semantic graphic refs
- [ ] extend render context to include `view_direction`
- [ ] define material assignment contracts for render layers/payloads
- [ ] keep font fallback valid while contracts expand

### Phase 1: Atlas Family Schema + Loader Skeleton

- [ ] define atlas family manifest schema in code
- [ ] add atlas family loader/cache skeleton
- [ ] support multiple PNG sheets per family
- [ ] support per-view `sameAs` aliases

### Phase 2: Material / Value Decoder Skeleton

- [ ] define decoded sprite pixel model in code
- [ ] implement red/green/blue band detection
- [ ] implement semantic value detection for the 4 non-override levels plus black/white overrides
- [ ] add full-light stub path only

### Phase 3: Palette Quantization Skeleton

- [ ] define the indexed-palette quantization seam used by atlas output
- [ ] add a first nearest-palette policy for atlas-derived colors
- [ ] leave room for future blend/shader refinement

### Phase 4: Atlas Backend In Cell Renderer

- [ ] replace atlas fallback stub with real atlas lookup/draw path
- [ ] preserve font fallback for missing graphics
- [ ] keep shared cell renderer as the only backend seam

### Phase 5: Grass Pilot

- [ ] add a `terrain` atlas family
- [ ] add `grass` tile id manifest entry
- [ ] add 4 grass weights
- [ ] alias all 6 views to the same source initially
- [ ] use only material slot `1` / red band initially
- [ ] render through full-light path
- [ ] verify final output quantizes back to indexed palette

### Phase 6: Payload Migration

- [ ] start emitting semantic `graphic` refs from render payload resolution for pilot content
- [ ] keep `char` fallback active where content is not migrated yet

### Phase 7: Directional And Facing-Aware Resolution

- [ ] introduce view-dependent tile resolution
- [ ] introduce facing-aware tile/entity/item resolution
- [ ] document side reuse patterns for assets like chests

### Phase 8: Deferred Hooks

- [ ] add lighting constants/stubs that can be replaced later
- [ ] add visibility/FOV context hooks without enabling full gameplay logic
- [ ] add character atlas schema notes/stubs for future animation families

## Open Questions / Deferred Decisions

- Exact indexed-palette quantization policy
- Where material definitions live first: data files vs code constants
- Exact character animation manifest shape when character atlases are introduced
- Whether background fills stay as render-layer `bg` or grow into a richer background pass
- Whether decoded sprite metadata should be cached per sheet, per tile frame, or pre-expanded further for performance

## Acceptance Criteria For This Architecture Pass

This architecture pass is successful when all of the following are true:

- a single primary plan exists for tile-id atlas rendering and related future systems
- locked decisions are written down explicitly
- render identity, material, value, lighting, palette, facing, and visibility responsibilities are separated clearly
- the atlas family and grass pilot shape are documented clearly enough to implement without redefining the contracts mid-flight
- implementation phases exist as an executable checklist for later passes

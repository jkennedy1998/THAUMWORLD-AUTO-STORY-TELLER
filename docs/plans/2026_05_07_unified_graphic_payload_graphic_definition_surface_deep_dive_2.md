# Unified Graphic Payload Graphic Definition Surface Deep Dive 2

Date: 2026-05-07

## Purpose

Define the proper architectural surface for **graphic definitions** before implementation planning starts.

This deep dive is specifically about:

- what a graphic definition should own
- what a material definition should own
- what currently owns these responsibilities in the repo
- where current ownership is muddy or split
- what the first-pass canonical definition surface should be

This is still planning only.

## Main Question

If we want one source of truth for visuals, what is the actual thing called a **graphic definition**?

The answer from the current codebase is:

- we already have a partial graphic-definition concept in `GraphicsModel`
- we already have a partial atlas-definition concept in `AtlasFamilyManifest`
- we already have a partial material-definition concept in `material_registry`
- we do **not** yet have one canonical definition surface that cleanly separates:
  - visual structure/presentation selection
  - appearance/material application
  - backend/source lookup

So this deep dive proposes that separation explicitly.

## Executive Conclusion

The sustainable seam should be:

## graphics own structure and presentation selection

Meaning graphics should own:

- what visual source identity a cell uses
- what backend/source kind resolves that identity
- how many appearance slots it exposes
- what selector inputs matter to presentation choice
- how facing/view/neighbors/breath/state choose a presentation
- what weight means for that graphic source

## materials own appearance behavior

Meaning materials should own:

- how a slot resolves into final tones/colors
- how light affects that appearance
- any semantic surface behavior like stone, wood, foliage, metal

## slot assignments own per-instance appearance choice

Meaning inline/authored cell payload should own:

- which slot gets which material or flat-color value
- but not the structure of the graphic itself

That is the cleanest long-term split.

## Current Definition Surfaces In The Repo

## 1) `GraphicsModel` is the current partial graphic-definition layer

File:

- `src/render_shaders/graphics_contract.ts`

Current shape:

- `base_graphic_id`
- `default_weight`
- `views`
- `material_slots`
- `overrides`
- `connectivity`

### What it already owns correctly

It already owns several structure-level concerns:

- base semantic graphic identity
- default weight
- state/tag override rules
- some view mapping logic
- neighbor-driven connectivity substitution

This is strong evidence that the codebase already wants graphics to own:

- structure
- presentation selection
- selector-driven substitution

### What it does not own cleanly yet

`GraphicsModel` is still missing explicit ownership for:

- backend/source kind
- slot count
- whether the source is atlas-backed or glyph-backed
- whether a graphic supports breath-sensitive presentations
- presentation resolution as a first-class concept instead of ad hoc override buckets

It also still mixes in one thing that should be treated more carefully:

- `material_slots`

This is acceptable as a defaulting convenience, but conceptually it is not pure structure.
It is default appearance assignment.

So `GraphicsModel` is close, but not yet the final source-of-truth definition surface.

## 2) `AtlasFamilyManifest` is the current partial source/backend definition layer

File:

- `src/mono_ui/runtime/atlas_runtime.ts`

Current atlas layer owns:

- family id
- sheet references
- per-graphic tile entries
- per-view frame tables
- per-weight frame tables
- source band schema
- default material slots on atlas tile entries

### What it already owns correctly

This file already owns real source-level truths such as:

- where pixels come from
- how views map to frames
- how weights map to frames
- how slot bands are encoded in source art

Those are absolutely graphic-source concerns.

### What is wrong with the current arrangement

The atlas manifest currently does too much implicit authority work:

- it is also acting as the only place that really knows which `graphic_id`s are atlas-backed
- family lookup is routed by id prefix conventions like `tile_`, `item_`, `character_`
- atlas tile entries repeat default material slot information

So the atlas manifest is functioning as a backend implementation registry, but not as a clean, explicit graphic-definition registry.

## 3) Material registry is the current appearance-definition layer

Files:

- `src/mono_ui/runtime/material_registry.ts`
- `src/mag/light.ts`

Current material layer owns:

- semantic tone ramp lookup
- conversion from semantic tones to indexed/palette rgb
- light remapping of semantic values

### What it already owns correctly

This is already a good materials seam.

Materials currently answer questions like:

- what does `STONE_PALE` look like?
- what are its darkest/lightest semantic tones?
- how should lighting push those tones?

That is appearance behavior, not structure.

### What is still missing

Materials are still only addressable via string ids in slot assignments.
There is not yet a unified slot value model that can also represent flat color.

But this is a slot-value problem, not a reason to move color behavior into graphics.

## 4) Payload builders and resolvers show current ownership split

Files:

- `src/render_shaders/payload_builders.ts`
- `src/render_shaders/graphic_resolver.ts`
- `src/render_shaders/tile_connectivity.ts`

These files show the current split clearly:

- definitions supply `graphics`
- instances supply `materials`, `state`, `facing`
- resolver merges defaults and instance values
- connectivity may rewrite `graphic_id`
- fallback text creates `text_*` ids

### What this confirms

The current code already separates:

- definition-time normal behavior
- instance-time active state

That is good.

### What is muddy

The current split is still not explicit enough about where final authority lives for:

- backend/source kind
- text graphic definitions
- slot count
- graphic families versus naming conventions

## What A Graphic Definition Should Own

A canonical graphic definition should answer these questions.

## 1) What is this visual identity?

It should own:

- stable `graphic_id`
- optional human/debug name
- source/backend kind

Example conceptual question:

- is this graphic a font glyph source, an atlas tile source, or something else?

This should not be inferred from string prefixes.

## 2) What structure does it expose?

It should own:

- slot count, from 0 to 3 in first pass
- weight support
- view support
- whether facing matters
- whether neighbor context matters
- whether breath matters

This tells the resolver what kinds of selector inputs are relevant.

## 3) How is presentation selected?

It should own the rules that choose a presentation from selector inputs.

That includes inputs such as:

- current view direction
- facing
- state flags
- tags
- cardinal neighbors
- diagonal neighbors later
- breath phase
- group role if needed

This does **not** mean every graphic needs a mini scripting language.
It means the definition surface must clearly declare the selector dimensions that can affect presentation.

## 4) What source asset or glyph data backs each presentation?

It should own the mapping from resolved presentation to source data.

For atlas-backed graphics, that means:

- family/sheet/frame refs
- per-view/per-weight source frames

For glyph-backed graphics, that means:

- codepoint or glyph token
- weight rendering behavior
- possibly source font family class later

## 5) What are the default appearance assignments?

A graphic definition may own default slot assignments.

But these should be understood as:

- defaults
- not structural truth

So they should stay subordinate to the definition’s real structure.

## What A Graphic Definition Should Not Own

A canonical graphic definition should **not** own:

- the active per-instance material choice
- the active flat color choice for a specific placed cell
- the current light magnitude
- transient world state outside declared selector inputs
- backend routing by naming convention

Those belong elsewhere.

## What A Material Definition Should Own

A material definition should answer:

- what semantic surface is this?
- how do its tones resolve under light?
- what palette/index/rgb values represent its tone ramp?
- possibly later: emissive, reactive, translucent, metallic traits

A material definition should **not** own:

- graphic silhouettes
- connectivity shape logic
- view/facing frame changes
- whether a chest is open or closed
- whether a wall becomes a corner tile

Those are graphic/presentation concerns.

## What Slot Assignments Should Own

Slot assignments are instance/authored payload, not shared definition truth.

They should own:

- which appearance value is assigned to slot 1/2/3
- possibly later whether that value is:
  - a material id
  - a flat color

They should not own:

- slot count
- connectivity rules
- view mappings
- frame tables
- selector logic

## Current Mismatches In The Repo

## Mismatch 1: backend/source kind is implicit, not defined

Current reality:

- text-like graphics are inferred by `text_` prefix
- atlas graphics are inferred by `tile_` / `item_` / `character_` prefix

Files:

- `src/render_shaders/graphics_contract.ts`
- `src/mono_ui/runtime/cell_renderer.ts`
- `src/mono_ui/runtime/atlas_runtime.ts`

This is the clearest sign that a real graphic definition registry does not exist yet.

## Mismatch 2: default slot assignments are spread across two layers

Current reality:

- `GraphicsModel.material_slots`
- `AtlasTileEntry.material_slots`

That means default appearance can be declared both:

- in content graphics models
- in atlas backend tile entries

This is convenient, but it is muddier than ideal.

### Recommended rule

Long-term authority should be:

- shared graphic definition may declare default slot assignments
- backend source entries should only declare source requirements, not per-content defaults

Atlas source data can still declare slot availability or compatible bands, but not be the long-term source of everyday authored defaults.

## Mismatch 3: text graphics are not first-class definitions yet

Current reality:

- `make_text_graphic_id(char)` synthesizes ids on the fly
- no explicit text graphic registry exists
- font renderer still depends directly on `cell.char`

This means glyph-like graphics are conceptually present, but not yet definition-owned.

## Mismatch 4: `variant` and `frame` are typed but not authoritative

Current reality:

- `RenderGraphicRef` has `variant` and `frame`
- current pipeline resolves mostly by `graphic_id`, `view_direction`, `facing`, `weight_index`
- connectivity simply rewrites `graphic_id`

So the active architecture is not actually variant/frame-centered today.

## Mismatch 5: selector-driven presentation logic is fragmented

Current reality:

- state/tag overrides in `GraphicsModel`
- connectivity in separate helper
- breath utilities in `global_animation.ts`
- atlas view/weight lookup in atlas runtime

This works, but the concept of one graphic definition owning presentation selection is still split across layers.

## Proposed Canonical Graphic Definition Surface

First-pass conceptual shape:

```ts
type GraphicDefinition = {
  id: string;
  source_kind: 'glyph' | 'atlas';
  slot_count: 0 | 1 | 2 | 3;

  defaults?: {
    weight?: 0 | 1 | 2 | 3;
    slot_values?: SlotAssignments;
  };

  selector_usage?: {
    facing?: boolean;
    view_direction?: boolean;
    state?: boolean;
    tags?: boolean;
    cardinal_neighbors?: boolean;
    diagonal_neighbors?: boolean;
    breath_phase?: boolean;
    group_role?: boolean;
  };

  presentation_model: GraphicPresentationModel;
  source: GraphicSourceDefinition;
};
```

Where:

```ts
type SlotAssignments = Partial<Record<1 | 2 | 3, SlotValue>>;

type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: { r: number; g: number; b: number } };
```

And:

```ts
type GraphicPresentationModel = {
  base_presentation_id: string;
  selectors?: GraphicSelectorRule[];
};
```

And:

```ts
type GraphicSourceDefinition =
  | {
      kind: 'glyph';
      glyph: string;
      weight_behavior?: 'font_weight';
    }
  | {
      kind: 'atlas';
      family_id: string;
      presentations: Record<string, AtlasPresentationSource>;
    };
```

This exact shape may change, but the ownership boundaries should not.

## Why This Surface Fits The Repo

## 1) It preserves what already works

It keeps the current healthy ideas:

- graphic identity
- weight
- slot defaults
- selector-driven substitution
- atlas views/weights
- material-based recoloring

## 2) It removes naming-convention authority

Backend kind becomes explicit.
No more architectural dependence on:

- `text_`
- `tile_`
- `item_`
- `character_`

## 3) It makes glyphs first-class peers of atlas graphics

A glyph-backed graphic becomes a real definition, not just a synthesized fallback id.

## 4) It keeps structure and appearance separate

Graphics choose shape/presentation.
Materials choose surface appearance.
Slot assignments choose the per-instance fill.

## 5) It gives a clean home for breath-driven presentation later

Breath should become just another selector input a definition may opt into.

## Recommended First-Pass Responsibility Split

## Graphic definition owns

- `graphic_id`
- source kind/backend kind
- slot count
- default weight
- selector dimensions used
- state/tag/connectivity/breath presentation logic
- view/facing mapping
- source presentation references

## Material definition owns

- tone ramp / semantic appearance behavior
- light response
- final color resolution rules

## Authored/instance payload owns

- chosen `graphic_id`
- chosen slot assignments
- chosen weight override if any
- current state/facing data

## Render context owns

- world position
- view direction
- light
- neighbors
- breath phase
- group context

## Backend runtime owns

- loading source art/fonts
- caching resolved frames
- drawing presentation output

## Specific Repo-Level Recommendations Before Implementation

## Recommendation 1
Do not let atlas tile entries remain the long-term authority for per-content default slot assignments.

Use shared graphic definitions for that.
Atlas source manifests should stay source/backend-oriented.

## Recommendation 2
Promote glyph graphics into explicit registered definitions.

Even if first pass still generates them mechanically, the architecture should treat them as real definitions.

## Recommendation 3
Replace prefix-based backend routing with explicit source-kind lookup.

This applies to both:

- atlas family selection
- font-vs-atlas draw routing

## Recommendation 4
Treat current `GraphicsModel` as the migration bridge to the future `GraphicDefinition` surface, not the final end state.

It already contains many right ideas, but it is not yet explicit enough.

## Recommendation 5
Keep materials declarative.

Do not solve graphic-definition gaps by putting more behavior into materials.

## Open Questions For The Next Deep Dive

1. What should the first-pass `SlotValue` union be exactly?
2. Should glyph definitions be individually registered, or generated through one glyph-source family plus character token?
3. How much neighbor context should first-pass presentation selection receive?
4. How should connectivity-style substitution and view-style substitution be expressed under one presentation model?
5. What exact deletion targets remove prefix-based authority cleanly?

## Bottom Line

The repo already proves that the right long-term seam is:

- **graphics = structure + presentation selection**
- **materials = appearance behavior**
- **slot assignments = per-instance fill choices**

What is missing is not the idea.
What is missing is one explicit definition surface that owns those truths without depending on:

- string prefixes
- backend-specific manifests as primary authority
- ad hoc text fallback behavior
- split default-slot ownership

So Deep Dive 2 conclusion is:

## the architecture should move toward an explicit graphic-definition registry, with graphics and materials kept as separate but cooperating systems.

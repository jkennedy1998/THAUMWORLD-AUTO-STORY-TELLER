# Unified Graphic Payload Render Flow Deep Dive 1

Date: 2026-05-07

## Purpose

Double-check the current render path against the new unified graphic payload vision before implementation planning continues.

This document is not an implementation checklist.
It is a verification pass meant to answer:

- what is already true in the codebase
- what is only partially true
- what directly conflicts with the intended source-of-truth architecture
- what needs deeper inspection before rewriting anything

## Vision Being Checked

We are checking the repo against this target direction:

- one canonical cell visual payload
- one shared `graphic_id` concept for glyph-like and atlas-like visuals
- one shared 3-slot color/material model
- one shared 4-step weight model
- runtime selector inputs such as facing, neighbors, breath, and position
- one presentation-resolution step
- no permanent split authority between legacy text and richer graphics

## Executive Summary

The repo is **directionally aligned**, but **not yet source-of-truth aligned**.

The strongest confirmation is that the current runtime already has most of the pieces needed for the target model:

- graphic identity
- material slots
- weight
- facing
- view direction
- tile-neighbor context
- breath in render context
- atlas slot recoloring
- runtime fallback from plain text into a graphic identity

The strongest contradictions are:

- painter canonical storage still only saves `char`, `rgb`, `weight_index`
- slot values currently only store material ids, not flat-color-or-material unions
- neighbor context is currently cardinal-only tile-kind data, not diagonal/full cell context
- breath-based visual change exists in shader-style utilities, not yet in a unified graphic presentation resolver
- graphic ids are currently human-readable strings and behavior still partly leaks through prefixes and naming conventions
- `variant` and `frame` exist in types but are not the actual presentation-resolution seam today

So the repo already contains the **bones** of the desired architecture, but not the **single source of truth**.

## Current Render Data Flow

## 1) Payload producers create text-plus-graphics hybrid payloads

Primary file:

- `src/render_shaders/payload_builders.ts`

Current payload producers build render payloads that may include:

- `graphics`
- `materials`
- `state`
- `facing`
- tags
- base foreground color
- legacy/simple fields like `char`

This is already a hybrid authored/runtime surface.

Important examples:

- `make_simple_tile_payload()` includes `char`, `graphics`, `materials`, `state`, `facing`
- `make_item_payload()` includes `graphics`, `materials`, `state`, `facing`
- `make_entity_payload()` pulls `graphics` and material defaults from entity render profiles

### What this confirms

- the render stack already accepts richer payloads than plain characters
- payload authorship is already partly centered on `graphics + materials`

### What this contradicts

- the payload surface is still text-first in many call sites
- `char` is still a first-class authored/render input rather than a derived minimal case

## 2) Render context already carries several selector inputs

Primary files:

- `src/render_shaders/types.ts`
- `src/render_shaders/context_builders.ts`
- `src/mono_ui/modules/place_module.ts`

`RenderContext` already supports:

- `world_x`, `world_y`, `world_z`
- `place_x`, `place_y`
- `breath_index`
- `facing`
- `view_direction`
- `light_mag`
- `tile_neighbors`
- `group_context`

`ctx_place_tile()` currently passes through:

- world position
- breath index
- semantic view direction
- cardinal tile neighbors

### What this confirms

- runtime selector input is already a real concept in the codebase
- position, facing/view, breath, and neighbor data are not speculative features

### What this contradicts

- neighbor context is narrower than the target vision
- today it is only `tile_neighbors?: Partial<Record<CardinalDirection, string | null>>`
- there is no diagonal neighbor context in `RenderContext`
- there is no full neighboring cell visual payload exposure

So the current system supports **some selector inputs**, but not yet the full planned context surface.

## 3) `resolve_render()` is already the closest thing to a unified resolution step

Primary file:

- `src/render_shaders/resolver.ts`

Current behavior:

1. base shaders create layers
2. tag modifiers apply
3. ui modifiers apply
4. each layer is passed through `resolve_effective_render_state()`
5. missing `layer.graphic` is filled in from the effective graphic result
6. missing `layer.materials` is filled in from the effective material slots

This is very important.

The system already has a stage where:

- a layer has a visible char
- but a semantic graphic identity may be attached or synthesized
- and material slots may be attached or synthesized

### What this confirms

- the repo already wants a semantic render state separate from immediate glyph output
- there is already a practical hook for a future canonical presentation-resolution step

### What this contradicts

- the render path is not yet described or organized around that resolution step as the source of truth
- this is still layered on top of older shading outputs rather than clearly owning the whole presentation decision

## 4) `resolve_effective_render_state()` already resolves text into graphic identity

Primary file:

- `src/render_shaders/graphic_resolver.ts`

Current behavior:

- normalizes view direction
- resolves facing
- resolves base weight
- merges material slots from graphics defaults, payload materials, and layer materials
- applies state/tag-driven graphic overrides
- applies tile connectivity graphic substitution
- if no graphic is supplied, falls back to `make_text_graphic_id(layer.char)`

This is the strongest current proof that the architecture already leans toward:

- a graphic identity for everything
- not just for atlas tiles

### What this confirms

- plain text is already being projected into a graphic-id namespace through `make_text_graphic_id()`
- graphic resolution already combines identity, weight, materials, facing, and context

### Important caution

The text fallback currently produces ids like:

- `text_A`
- `text_#`
- `text_ `

These are convenient runtime ids, but they are not yet a canonical compact stored representation.

### What this contradicts

- behavior is still partly split between true graphics models and text fallback ids
- the effective state does not yet use breath or diagonal neighbors for presentation choice
- `variant` and `frame` exist in `RenderGraphicRef`, but are not actually driving the current resolver path

## 5) Connectivity is already a selector-driven presentation rule

Primary file:

- `src/render_shaders/tile_connectivity.ts`

Current behavior:

- reads `graphics.connectivity`
- reads cardinal neighbor tile kinds from `ctx.tile_neighbors`
- computes a connectivity mask
- chooses a variant graphic id such as corner, center, or end-cap

### What this confirms

- the repo already has a working example of selector-driven presentation resolution
- neighbor-sensitive presentation is already a real render concern
- the right seam is indeed "selector inputs choose presentation"

### What this contradicts

- the current selector surface is only tile-kind cardinal adjacency
- the result is a substituted `graphic_id`, not a more explicit general presentation object
- connectivity is tile-specific and not yet generalized to glyph-like neighbor-aware visuals

## 6) Final cell reduction still preserves both legacy and richer outputs

Primary file:

- `src/render_shaders/reducer.ts`

`reduce_layers_to_cell()` returns a `Cell` containing:

- `char`
- `graphic`
- `materials`
- `light_mag`
- `rgb`
- `weight_index`
- `style`

### What this confirms

- the final runtime cell already carries the richer payload pieces needed by atlas rendering
- lighting context is already threaded into the output cell

### What this contradicts

- the runtime cell still preserves dual authority:
  - visible `char`
  - semantic `graphic`
  - resolved `rgb`
- the architecture has not yet decided whether `char` is authored truth, fallback display, or derived presentation output

This is one of the biggest source-of-truth ambiguities still present.

## 7) Atlas rendering already acts like a slot-based material application backend

Primary files:

- `src/mono_ui/runtime/atlas_runtime.ts`
- `src/mono_ui/runtime/material_registry.ts`
- `src/mag/light.ts`

Current atlas behavior:

- families define 3 bands mapped to red/green/blue
- tiles define `material_slots`
- a `RenderGraphicRef` chooses view and weight frame
- source pixels decode into slot-band semantic values
- materials resolve semantic tones like `darkest` and `lightest`
- lighting remaps semantic tones before final color resolution

### What this confirms

- the repo already has a very strong implementation of the planned 3-slot model
- weight already means frame choice inside atlas assets
- facing/view selection already exists for atlas graphics
- materials already mean semantic surface identity rather than baked rgb

### What this contradicts

- current inline slot assignments are only `string` material ids
- there is no first-class slot value union for:
  - flat rgb
  - material id
- family lookup currently depends on graphic-id prefixes such as:
  - `tile_`
  - `item_`
  - `character_`

That prefix dependency is a real architectural smell if the long-term goal is one canonical graphic registry.

## 8) Atlas backend still excludes text-style graphics by naming convention

Primary file:

- `src/mono_ui/runtime/cell_renderer.ts`

Current behavior:

- atlas draw is skipped if `graphic.graphic_id.startsWith('text_')`
- font rendering then draws `cell.char`

### What this confirms

- the renderer already distinguishes glyph-like and atlas-like backends
- fallback behavior is stable and practical

### What this contradicts

- text and atlas are still not peers under one fully explicit visual-source model
- backend routing currently depends on string naming convention
- `char` remains required for font drawing even when a semantic graphic id exists

This is another place where the final source-of-truth architecture is not yet fully expressed.

## 9) Painter runtime adapters already preserve richer cell fields

Primary file:

- `src/ascii_painter/painter_view_projection_adapter.ts`

Important current behavior:

- empty cells include `graphic` and `materials`
- cloned cells preserve `graphic` and `materials`
- projection logic treats cells with either text or graphics as meaningful content

### What this confirms

- painter runtime/display path is already partly prepared for the richer visual model
- the painter-side display contract is ahead of the painter-side saved document contract

### What this contradicts

- canonical painter document storage still loses this richness
- the display path is richer than the saved/authored path

## 10) Painter canonical voxel storage is still the biggest hard contradiction

Primary file:

- `src/ascii_painter/painter_document.ts`

Current `PainterVoxelRecord` stores only:

- `char`
- `rgb`
- `weight_index`

Clone/create/normalize paths for painter voxel records also only preserve:

- `char`
- `rgb`
- `weight_index`

### What this confirms

- the biggest source-of-truth gap is real and clearly located

### What this contradicts

- the painter cannot currently be the source of truth for the richer visual payload we want
- graphic ids and material assignments are not canonical saved painter data
- any painter-authored rich visual content is at risk of being lossy or non-canonical

This is the most direct mismatch against the new plan.

## Current Truths Confirmed

These ideas are already truly supported by the codebase.

### Confirmed truth 1
A cell can already carry both:

- a semantic graphic reference
- material slot assignments

### Confirmed truth 2
Weight is already a shared low-cardinality axis used by both font and atlas paths.

### Confirmed truth 3
Facing and view direction are already real render inputs.

### Confirmed truth 4
Cardinal neighbor information is already used to choose presentation.

### Confirmed truth 5
Breath is already a runtime visual input in the render stack.

### Confirmed truth 6
Atlas visuals already implement a 3-band-to-3-slot style of material application.

### Confirmed truth 7
A plain visible character is already partially treated as a graphic identity fallback through `make_text_graphic_id()`.

## Partial Truths

These are aligned ideas, but not fully true yet.

### Partial truth 1
"Everything is a graphic id"

Partly true because text falls back to `text_*` ids.
Not fully true because text is still also a separate direct rendering path with special backend routing.

### Partial truth 2
"One unified presentation resolution step exists"

Partly true because `resolve_effective_render_state()` is close.
Not fully true because breath, diagonals, general presentation naming, and backend routing are not yet consolidated there.

### Partial truth 3
"Materials are the unified color model"

Partly true for atlas rendering.
Not fully true because the system still relies heavily on plain `rgb`, and slot values cannot yet directly hold flat colors.

### Partial truth 4
"Breath already drives graphics presentation"

Partly true at the wider render level.
Not fully true in the graphic resolver itself.
Current breath-sensitive logic is still shader/global-animation flavored rather than part of one general presentation selector.

## Direct Contradictions To The Planned Architecture

## Contradiction 1: painter canonical storage is still legacy-first

Files:

- `src/ascii_painter/painter_document.ts`

This directly blocks a source-of-truth unification.

## Contradiction 2: slot assignments are material-id-only today

Files:

- `src/render_shaders/graphics_contract.ts`
- `src/mono_ui/runtime/material_registry.ts`

`InlineMaterialAssignments = Partial<Record<1 | 2 | 3, string>>`

This does not yet support the planned slot-value flexibility.

## Contradiction 3: backend routing depends on naming conventions

Files:

- `src/mono_ui/runtime/cell_renderer.ts`
- `src/mono_ui/runtime/atlas_runtime.ts`

Examples:

- `text_` prefix means font backend
- `tile_` / `item_` / `character_` prefixes pick atlas family

This is practical now, but too string-convention-driven for the intended long-term source of truth.

## Contradiction 4: neighbor context is narrower than the target model

Files:

- `src/render_shaders/types.ts`
- `src/render_shaders/context_builders.ts`
- `src/render_shaders/tile_connectivity.ts`

Currently:

- cardinal only
- tile-kind strings only

Not yet:

- diagonals
- richer neighboring visual metadata
- generalized neighbor-aware glyph shading input

## Contradiction 5: `variant` and `frame` are not the real active seam

Files:

- `src/render_shaders/graphics_contract.ts`
- `src/mono_ui/types.ts`

They exist in types, but current rendering mostly resolves by:

- `graphic_id`
- `view_direction`
- `facing`
- `weight_index`
- connectivity substitution

So they should not be mistaken for already-solid architecture.

## Contradiction 6: graphics behavior truth is still split across several places

Files:

- `src/render_shaders/graphics_contract.ts`
- `src/render_shaders/graphic_resolver.ts`
- `src/render_shaders/tile_connectivity.ts`
- `src/mono_ui/runtime/atlas_runtime.ts`

Behavior currently comes from a mix of:

- graphics models
- override rules
- connectivity logic
- atlas family lookup by prefix
- text fallback id creation

This works, but it is not yet one explicit source of truth.

## Important Findings That Support The Planned Direction

These are the most encouraging confirmations.

### 1. The repo already has a de facto graphic identity path for text.

That means the planned "one graphic id concept" is not a wild rewrite from zero.

### 2. The repo already has a de facto material-slot atlas pipeline.

That means the planned 3-slot model has a real existing backbone.

### 3. The repo already passes render context with breath, world position, and neighbor data.

That means selector-driven presentation is already emerging naturally.

### 4. The painter runtime/display side is already ahead of painter storage.

That means the source-of-truth rewrite likely belongs first in canonical painter storage and shared cell contracts, not in inventing rendering ideas from scratch.

## Important Findings That Push Back On Our Vision

These are the main places where the current repo says "be careful."

### Pushback 1
The current system is not yet truly graphic-definition-driven.

It is partly definition-driven, but also partly naming-driven and payload-shape-driven.

### Pushback 2
The current system still relies on `rgb` heavily.

Any future slot/material rewrite must account for all the places where flat color is still the real final output, especially font rendering.

### Pushback 3
Breath-based animation currently lives in more than one conceptual area.

If we move presentation selection toward breath-driven graphics, we must avoid duplicating or fighting existing shader/global-animation behavior.

### Pushback 4
Neighbor-aware rendering is currently tile-kind-centric.

Generalizing it to glyph-like graphics will require a deliberate context model, not just widening one field.

## Recommended Next Verification Questions

Before implementation planning becomes concrete, the next pass should answer:

### 1) What is the first-pass slot value type?

Specifically:

- material ids only?
- flat rgb only for glyphs?
- tagged union for both?

This is the biggest unresolved contradiction between current code and planned architecture.

### 2) What is the canonical graphic-definition registry surface?

Need to define where these truths live:

- source kind
- backend kind
- slot count
- presentation selectors used
- atlas family/sheet lookup
- glyph source data

### 3) What exact neighbor context should a graphic resolver receive?

Need to decide whether first pass includes:

- cardinal only
- cardinal + diagonal
- tile-kind-only
- graphic-family metadata
- full neighboring visual payload summaries

### 4) Where should breath-driven presentation selection live relative to existing shader logic?

Need to prevent two competing animation systems.

### 5) What becomes authoritative for glyph rendering in the final model?

Need to decide if font backend should eventually resolve from:

- a glyph-source definition
- plus slot application
- plus weight

instead of direct `char + rgb` ownership.

## Bottom Line

The repo is aligned with the vision at the **runtime capability level**.

It is **not yet aligned at the source-of-truth architecture level**.

The most important conclusion from this pass is:

## we are not inventing the idea from scratch

but also:

## we absolutely still have split authority and naming-driven legacy seams that must be rewritten if we want a real unified model.

That means the vision is valid, but the rewrite must be deliberate and explicit about cutover, especially around:

- painter canonical storage
- slot value representation
- backend routing
- neighbor context surface
- graphic-definition authority

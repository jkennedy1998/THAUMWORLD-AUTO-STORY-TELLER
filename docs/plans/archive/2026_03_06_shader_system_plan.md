# Shader System Plan (Tag-Driven Glyph + Layers)

ARCHIVED (2026-03-07): Superseded by `docs/plans/2026_03_07_advanced_rendering_plan.md`.
This file keeps the original detailed narrative and checklist history.

Date: 2026-03-06

## Intent

Unify how items, tiles, NPCs/actors, particles, and UI overlays choose their glyph + color by routing all rendering decisions through a single shader-style resolver.

This plan treats the shader system as a "character setter" today (ASCII + indexed colors), while being compatible with a future 3D place renderer that is layered like the ASCII program's canvas.

Key design targets:

- One implementation for "what should this render as".
- Tag-driven modifiers that can stack (FIRE!, frost, poison, etc.) without embedding shader ids into tags.
- Deterministic ordering: same inputs -> same output, regardless of module.
- Layered output: tiles/items/characters/particles/effects/system UI follow a consistent z-order.
- Global "textures" (fields) usable anywhere as synchronized drivers (wind/ripple/noise) for coherent motion.

## Existing Systems to Reuse (Avoid Parallel Pipelines)

We already have several strong precedents in the repo. The shader system plan must integrate with them or deliberately replace them, not create a disconnected third rendering pipeline.

- ASCII painter 3D layers + camera/view transforms:
  - `src/ascii_painter/voxel_space.ts`
  - `src/ascii_painter/voxel_dom_renderer.ts`
  - These are the reference architecture for future 3Dification of place rendering.
  - The shader resolver output should be shaped so it can map to VoxelSpace layers later.

- Per-cell z metadata already exists in mono_ui:
  - `Cell.render_index` in `src/mono_ui/types.ts`
  - Note: the current mono_ui compositor is module-order "last write wins" (`src/mono_ui/compose.ts`) and does not sort by render_index.

- Tag-driven visual precedent already exists (FIRE!):
  - `src/mono_ui/modules/place_module.ts` contains tag-based color logic and a tag cache.
  - This should be migrated into shader tag modifiers once the resolver exists.

- Golden render capture precedent already exists:
  - `CanvasRuntime.write_ascii_snapshot()` in `src/mono_ui/runtime/canvas_runtime.ts`
  - Use this for shader regression snapshots instead of inventing a new capture mechanism.

- Screen-space global texture precedent already exists:
  - UI noise/texture filters + pan CSS vars in `src/canvas_app/main.ts`
  - Screen-space globals are the initial target because place rendering will change soon.

## Status Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested and working through `npm run dev:logs`

Plan-only changes (no implementation in this phase):

- [x] Define shader system as a single resolver (design)
- [x] Define layered output model compatible with 3Dification (design)
- [~] Define global textures/fields supporting screen-space + place-space (design)
- [x] Implement resolver + migrate modules (future work)

## Glossary

- Renderable: a tile, item instance, actor, NPC, particle, cursor, debug gizmo.
- Shader: a pure function that maps (payload + context) -> one or more glyph layers.
- Tag modifier: a shader step that mutates style based on an entity tag.
- Global texture/field: a time-varying function (or cached grid) accessible to any shader (e.g. diagonal sine wave).

## Layer Model (Per Tile / Coordinate)

Target ordering (lowest -> highest):

1) Tiles (floor/walls/doors)
2) Items (including single ground items)
3) Characters (actors + NPCs)
4) Particles (footsteps, sense broadcasts)
5) Shader effects (auras, outlines, ripples) [can also be implemented as layers emitted by entity shaders]
6) System UI overlays (cursor, selection box, debug grids, interaction hints)

Notes:

- Some entities may render multiple blocks later (multi-cell 3Dified sprites). The shader output should allow multiple quads/cells per entity, but the initial implementation can be single-cell.

### Renderer Compatibility: Mono-Cell Now, Multi-Layer Later

Today (mono_ui runtime) each (x,y) resolves to a single `Cell`. The shader resolver may emit multiple layers, but the runtime must reduce them deterministically to a single cell.

- Now: `RenderOutput.layers[]` is reduced by a shared reducer:
  - `reduce_layers_to_cell(layers) -> Cell`
- Later (3Dification): `RenderOutput.layers[]` can map directly to VoxelSpace layers/quads.

TODO:

- [x] Define `reduce_layers_to_cell` rules (z priority, blend policy, clamping)
- [x] Keep the reducer shared and module-agnostic

Reducer MVP rules (plan-level, to prevent drift):

- Char selection: highest `z` wins.
- Color selection: start from the winning layer's fg/bg, then apply modifier layers in `z` order.
- Blend modes: evaluate in linear-ish RGB, then quantize to the nearest indexed palette color as a final step.
- Background: mono_ui uses a global "clear" background; shaders may emit bg colors but the reducer decides if/when they apply.
- Runtime palette changes are allowed: quantization must read the current palette at render time.

## Architecture

### 0) Composition vs Shading (Two-Stage Rendering)

To keep the system scalable, separate two responsibilities:

1) Composition: decide WHAT renderables exist at a coordinate for a given draw context.
2) Shading: decide HOW a chosen renderable becomes glyph/color layers.

Composition should be centralized and shared, but it does not need to be a new "renderer". The recommended approach:

- Keep module stacking as the outermost compositor (window UI order stays as-is).
- Inside each module, build a small render queue (declarative), then shade each entry through the resolver.

This avoids per-module ad-hoc glyph logic while keeping performance predictable.

TODO:

- [x] Define a shared "render queue" shape (`RenderRequest`) that modules can emit
- [~] Define composition rules per module context (place tile, pile UI, container UI, character slots)
- [x] Keep composition rules and shader resolver in separate files

### 1) Single Entry Point

Add a central resolver (module-level service), e.g.:

- `resolve_render(payload) -> RenderOutput`

Every UI module calls this instead of deciding glyphs/colors locally.

TODO:

- [x] Add `src/render_shaders/resolver.ts` and route all glyph decisions through it
- [x] Ensure drag ghost also calls the resolver (context `where=drag_ghost`)

Integration note:

- Prefer making modules call the resolver and then writing a single cell to mono_ui.
- Do not introduce a second parallel renderer inside place/container/character modules.

### 2) Payload + Context (Shader Arguments)

Payload (data about the thing being drawn):

- `kind`: `tile | item | actor | npc | particle | ui`
- `id/ref`: stable id
- `name`, `def_id` (if any)
- `qty`, `weight` (if any)
- `tags`: ordered `TagInstance[]`
- optional: container info (is_container, contents_count, max_slots, is_open)
- optional: "parent" info (tile position, container id, owner ref)

Context (where/how it is being drawn):

- `where`: `place_tile | pile_ui | container_ui | character_slot | drag_ghost | tooltip | debug`
- `tile`: `{ x, y }` if applicable
- `ui`: hovered/selected/targeted, default_container, dragging state
- `time_ms`: for animation sampling
- `camera`: later 3Dified renderer will pass view/camera data

TODO:

- [~] Add payload builders (single place to create payload/context so modules do not drift)
- [x] Standardize `where` contexts and keep them minimal
- [x] Add explicit coordinate spaces for texture sampling (see Global Textures)

Payload builder note:

- Add payload builders as the single source of truth so that modules never invent ad-hoc fields.
- Tag caching belongs outside the shader system; shaders receive tags as inputs.

Coordinate note:

- The entire UI render system is grid-based. Global texture sampling should use the same (x,y) coordinate space that modules use.
- For future place-space sampling, use the "focus plane" (aligned to the 2D text grid) as the local coordinate system, matching the ASCII painter's selected layer alignment.

### 3) Output Type (Future-Proof)

Define output as a list of layers (even if most calls return 1 layer today):

- `RenderOutput = { layers: RenderLayer[] }`
- `RenderLayer = { char: string, fg: Color, bg?: Color, z: number, blend?: 'normal'|'add'|'multiply', flags?: string[] }`

Initial renderer may ignore `blend` and `flags`.

TODO:

- [x] Keep output layer list even when only 1 layer is returned
- [ ] Define optional multi-cell outputs for future (not implemented now)

Mapping note:

- In mono_ui, `RenderLayer.z` should map to `Cell.render_index` after reduction.
- In 3Dification, `RenderLayer.z` should map to a layer depth similar to VoxelSpace Z.

### 4) Shader Pipeline

Split rendering into:

1) Base shader: chooses initial glyph/style from entity + context.
2) Tag modifier chain: applies composable effects from tags.
3) UI modifier chain: hover/selection/cursor/debug overlays.

Determinism:

- Apply tag modifiers in a stable order: sort by `tag_priority[name]`, then original index.
- Keep modifiers pure (no stateful randomness). Use global textures for pseudo-randomness.

TODO:

- [x] Define tag modifier order as program order (registry list), not per-item metadata
- [ ] Define a stable rule for ties: registry order then original tag order
- [ ] Document how unknown tags behave (default: ignored)

Performance note (plan-level):

- The place view can shade many cells per frame.
- Plan for per-frame caching hooks (e.g. compiled modifier list keyed by tag-set signature).

### 5) Tag-Driven Modifiers (No Shader Ids in Tags)

Tag modifiers are code rules keyed by tag name (and optional magnitude):

- `FIRE!`: tint fg toward red/orange by mag (clamped)
- `FROSTBITE`: desaturate/shift toward pale/white-blue
- `POISONED`: shift toward green
- `INVISIBLE`: heavily dim or replace char with floor blend (later)
- `CONTAINER`: optional subtle glyph accent (not required if base glyph already communicates)

Base glyph identity should remain readable; modifiers should mostly affect color, not the char.

TODO:

- [ ] Define palette/indexed color mapping rules for modifiers (tint->nearest palette)
- [ ] Define clamping policy to preserve readability

Reuse note:

- The existing PlaceModule FIRE! color logic is the first modifier to migrate.
- After migration, remove the ad-hoc PlaceModule path (see Deprecation section).

### 6) Global Textures / Fields

Add a global "texture" registry accessible from any shader:

- Time-synchronized fields (same everywhere) for coherent motion.

Coordinate spaces:

- Screen-space: anchored to the viewport/canvas (stable regardless of place changes)
- Place-space: anchored to world tiles (future; stable as you pan/zoom in a place)

Starting point:

- Screen-space only, because place rendering and camera will change in the coming month.
- Keep the API capable of place-space from day one (same function signatures).

Coordinate convention:

- `x,y` are always grid coordinates in the same space the module uses to position itself.
- Screen-space means "screen grid" (not pixels). This stays stable as font/scale changes.
- Place-space means "place tile grid" projected onto the focus plane aligned to the same screen grid.

Reuse note:

- Phase A (screen-space drivers) may temporarily reference the existing UI noise/texture filter system in `src/canvas_app/main.ts`.
- Phase B replaces DOM-driven effects with pure function fields under `ShaderGlobals`.

Examples:

- `diag_sine(x, y, t)`: diagonal sine wave
- `wind(x, y, t)`: low-frequency field for tree sway
- `noise2(x, y, t)`: stable pseudo-noise

Implementation approach:

- Provide a `ShaderGlobals` object with methods and a deterministic PRNG.
- Fields should be pure functions of (x, y, t) and optional seed.
- Allow cheap sampling; if we need performance later, add caching per frame.

TODO:

- [~] Define `ShaderGlobals` sampling API that accepts `space` (`screen`/`place`/`ui`)
- [x] Add first built-in field: diagonal sine across screen
- [ ] Document deterministic PRNG usage (seeded by stable ids)
- [ ] Add per-frame caching hooks (optional)

### 7) Where This Lives

Suggested directory layout:

- `src/render_shaders/`
  - `resolver.ts` (single entry point)
  - `types.ts` (payload/context/output)
  - `base/` (base shaders per kind)
  - `tags/` (tag modifiers)
  - `ui/` (hover/selection/cursor modifiers)
  - `globals/` (global fields/textures)

Modules that draw (place/container/character) should import the resolver and stop deciding glyphs themselves.

TODO:

- [~] Update modules to stop using ad-hoc display_char rules
- [ ] Ensure server APIs do not need to inject display chars (unless we want server-authoritative visuals later)

## Initial Shaders (MVP)

### Base

- `tile_default`: existing tile chars
- `item_default`: existing item rules (definition.display_char else name[0]; qty overlay)
- `actor_default` / `npc_default`: existing glyph rules + default colors
- `particle_default`: current particle char + color

### Context Helpers

- `pile_tile`: if a tile has `count >= 2`, base layer uses `*`/`#` while still allowing tag overlays

### Tag Modifiers

- `FIRE!` modifier (move the existing PlaceModule FIRE color logic here)

TODO:

- [x] Add `FIRE!` modifier as first tag effect
- [ ] Add 1-2 more simple modifiers (e.g. FROSTBITE, POISONED) only after FIRE! is stable

## Migration Plan

Migration TODO (tracked statuses):

- [x] Add shader resolver + types + `item_default` shader
- [x] ContainerModule uses resolver
- [x] CharacterModule uses resolver
- [x] PlaceModule uses resolver
- [x] Pile glyph logic uses shader context (not module logic)
- [x] FIRE! color logic moved into tag modifier
- [~] Remove ad-hoc glyph logic from modules
- [x] (Future) Verify through `npm run dev:logs` after each migration step

## Deprecation / No Migration Artifacts Left Behind

This renderer refactor must not leave long-lived "temporary" systems.

TODO:

- [x] Remove ad-hoc glyph selection logic from modules once they call the resolver:
  - [x] `src/mono_ui/modules/container_module.ts`
  - [x] `src/mono_ui/modules/character_module.ts`
  - [x] `src/mono_ui/modules/place_module.ts`
- [x] Migrate FIRE! tag visuals out of `src/mono_ui/modules/place_module.ts` into tag modifiers, then delete the old path
- [x] Avoid shipping one-off migration scripts for renderer data.
  - If any migration script is created for development, it must be removed once data is migrated.
  - Prefer runtime repair/sanitization (idempotent) over permanent migrations.
- [ ] Avoid server-side "display char injection" once the resolver is authoritative for glyph choice

Safeguard note:

- Do not remove server-side display helpers until drag ghosts and all draw contexts have a stable local fallback (payload builders + resolver).

Non-goal in this phase:

- Server-authoritative rendering (keep it client-side for now).
- 3Dified place rendering; this plan only ensures the API/structures support it.

## 3Dification Compatibility Notes

- Keep `RenderOutput.layers[]` as the durable interface.
- The ASCII renderer maps each layer to a draw call at a glyph cell.
- A future 3D renderer can map each layer to a quad/material instance (or a sprite atlas index).
- Global textures/fields become shader uniforms in the 3D renderer.

## UX Guidelines

- Readability first: base glyph identity should remain stable.
- Use color shifts for states; reserve glyph changes for strong semantic differences (pile vs single item).
- Animations should be subtle and globally coherent (use shared fields).
- Avoid per-module visual drift: every glyph decision routes through the resolver.

TODO:

- [x] Add a small "golden render" test harness (snapshot expected glyphs/colors for a few scenes)
- [ ] Add guidelines for subtle animations (global fields, low frequency)

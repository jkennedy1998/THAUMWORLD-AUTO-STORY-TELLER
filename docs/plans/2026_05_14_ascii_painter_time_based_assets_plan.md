# ASCII Painter Time-Based Assets Plan

Date: 2026-05-14

## Status

Active planning document.

This plan focuses on aligning the ASCII painter and Thaumworld around a shared breath/time model for authored assets, while keeping runtime simulation separate from painter UI concepts.

## Goal

Turn the painter into a clean authoring system for time-based visual assets that Thaumworld can consume at runtime.

The core intent is:
- one shared breath clock
- authored clips/loops/state on that clock
- optional playback and baking
- no hidden group-mask behavior
- runtime game systems consume exported assets, not painter UI semantics

## Step 0: Remove group content masks

Before adding anything new, remove the current concept of **timed content masking inside groups**.

Important:
- this does **not** mean selection tools lose masking-like behavior if they need it
- this does **not** mean any painter selection UX is removed
- this only means the hidden/unsupported group-content mask concept should be deleted so the model is clean

Why this is first:
- it removes ambiguous behavior from the group model
- it prevents new animation/timeline work from depending on an unclear legacy path
- it makes the authored content model easier to reason about

## Architectural direction

### 1) One engine time model

Use breaths as the shared unit of time across:
- game simulation
- authored animation
- playback
- preview

The difference is not separate clocks; the difference is which system consumes the clock.

### 2) Painter is an authoring tool

Painter should primarily author:
- clips
- loops
- keyframes
- emitters
- masks/shapes
- baked outputs

Painter should preview content, but it should not be the game runtime.

### 3) Thaumworld is the runtime consumer

Thaumworld should load exported painter assets as runtime content.

It should not need painter-only concepts like UI groups, timeline editing controls, or temporary editing focus state.

### 4) Groups evolve into tracks/layers

The current `groups` module should eventually behave more like a timeline/layer authoring surface than a generic group editor.

Good future language:
- track
- clip
- loop
- emitter
- layer
- baked state

## Core asset primitives

### Clip
A timed authored asset on the breath axis.

### Loop
A defined active breath window for repeated playback.

### Keyframe
A saved authored state at a specific breath.

### Emitter
A particle source with authorable emission settings.

### Mask / shape source
A region that defines where an emitter or effect can originate.

This can be geometry-derived or a simple editable 1-bit raster-like source.

### Baked frame / baked state
A runtime-friendly exported result produced from authored content.

## Design principles

- Do not reintroduce group masks as a hidden special case.
- Keep selection tools separate from authored content masking.
- Keep the breath axis unified.
- Allow playback by breath or by discrete state where appropriate.
- Prefer explicit export/import boundaries over implicit coupling.
- Keep game mechanics separate from decorative effect authoring.
- Support decorative particles as a first-class authored/runtime channel.

## Target use cases

This plan should support:
- multi-tile character animation
- decorative particles
- UX effect particles
- cutscene animation
- looped visual clips
- plant growth style animation
- hybrid authored + simulated motion later

## Phased plan

### Phase 1: Clean the current painter model

- Remove group-content masks from the group/timeline model.
- Verify there are no remaining runtime or UI dependencies on that path.
- Add a regression test or diagnostic coverage for the removed behavior.

### Phase 2: Stabilize breath-based authored playback

- Treat loop windows as the current asset boundary.
- Use breaths as the clip range.
- Make keyframes the authored states inside the loop.
- Support preview playback without changing the world/runtime model.

### Phase 3: Define reusable effect primitives

- Introduce emitter/shape/mask concepts as authored data, not mechanics.
- Keep emission shape separate from emission behavior.
- Allow geometry or simple raster regions as the authoring source.

### Phase 4: Add export/import boundaries

- Export painter-authored clips and effects as saved assets.
- Import them into Thaumworld as runtime content.
- Keep the runtime data model independent from painter editing state.

### Phase 5: Add baked playback paths

- Support baked outputs for cutscenes and decorative effects.
- Allow playback by breath or by discrete state sampling.
- Keep live simulation optional, not mandatory.

### Phase 6: Add hybrid simulation later

- Permit authored keyframes to act as simulation seeds.
- Let runtime or offline baking evolve the state forward.
- Store the result as replayable asset data.

## Non-goals for now

- No fire/water/sand mechanic implementation in the painter.
- No deep gameplay mechanics based on particles yet.
- No forced unification of painter UI with game UI.
- No dependence on group masks or other hidden painter-only content filters.

## Success criteria

- The painter has a clean, understandable time-based authoring model.
- Thaumworld can consume authored content without painter-specific assumptions.
- Breath remains the shared clock across systems.
- Decorative particles and cutscene-style assets are a natural fit.
- Group masks are gone from the timed content model.

## Related docs

- `docs/design/painter_game_render_alignment_observations.md`
- `docs/plans/2026_04_29_ascii_painter_breath_group_animation_architecture_plan.md`
- `docs/plans/2026_05_01_ascii_painter_unified_channel_animation_plan.md`
- `docs/plans/2026_05_02_ascii_painter_property_block_animation_plan.md`
- `docs/plans/2026_05_14_ascii_painter_time_based_assets_plan.md`

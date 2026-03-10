# Advanced Rendering Plan (Post-Shader-System)

Date: 2026-03-07

## Intent

Push the current tag-driven shader resolver into an "advanced rendering" phase: better layer composition, deterministic effects, global fields, multi-cell outputs, and testable visuals.

This plan is intentionally condensed and focuses only on unfinished / next-step work.

## Current State (Already In Repo)

- A central shader resolver exists under `src/render_shaders/` (resolver + payload/context builders + reducer + modifiers).
- UI modules route glyph/color decisions through it (Place/Container/Character, plus drag ghost).
- Golden eval coverage exists (`npm run eval:shader_golden`) and render-queue contract eval exists (`npm run eval:render_queue_contract`).

Reference (archived detailed plan): `docs/plans/archive/2026_03_06_shader_system_plan.md`

## Status Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested and working through `npm run dev:logs`

### 1) Composition + Reduction (Make Layering Real)

- [ ] Implement full `reduce_layers_to_cell` rules (blend modes, bg policy, modifier stacking order)
- [ ] Decide and document how `RenderLayer.z` maps to mono_ui output `Cell.render_index` (and when it should be preserved vs derived)
- [ ] Quantize-to-palette + clamping policy for readability (tint->nearest palette, max saturation/contrast constraints)

### 2) Tag Modifier Determinism + Documentation

- [ ] Define stable tie-breaking for tag modifiers and tag instances (registry order vs input order)
- [ ] Document unknown-tag behavior (default ignore; optional debug flag to surface)
- [ ] Add 1-2 additional tag modifiers after FIRE! is stable (e.g. FROSTBITE, POISONED)

### 3) Shader Globals / Fields (Coherent Motion)

- [ ] Document deterministic PRNG usage (seeded by stable ids; no hidden randomness)
- [ ] Add per-frame caching hooks (optional) for expensive fields/modifier precomputation
- [ ] Make `space` semantics real and documented (`screen`/`place`/`ui` coordinate mapping)

### 4) Multi-Cell Outputs (Future 3Dified Sprites)

- [ ] Extend output type to optionally emit multiple cells/quads per renderable
- [ ] Define reduction behavior for mono_ui when a renderable emits multiple cells (clip/priority rules)

### 5) Remove Remaining Ad-Hoc / Server-Injected Visual Paths

- [ ] Remove server-side "display_char injection" once the resolver + payload builders fully cover client needs
- [ ] Ensure drag ghost and all UI contexts have a stable local fallback without server help

### 6) Testing + Visual Regression

- [~] Expand golden coverage beyond current eval (more contexts: place_tile vs container_ui vs character_slot)
- [ ] Add a snapshot harness that uses `CanvasRuntime.write_ascii_snapshot()` for scene-level regression (small fixed scenes)

### 7) UX / Animation Guidelines

- [ ] Write compact guidelines for subtle animations (global fields, low frequency, readability-first)

### 8) Place DOM Layer Renderer Upgrades (Deprioritized From 3Dification)

- [ ] Incremental world draw into offscreen canvases (avoid rebuilding full render queues each frame when unchanged)
- [ ] Dirty-region tracking for place updates (tiles/items/entities/particles) with deterministic invalidation
- [ ] Performance harness for place rendering (frame-time logs + simple stress scenes)

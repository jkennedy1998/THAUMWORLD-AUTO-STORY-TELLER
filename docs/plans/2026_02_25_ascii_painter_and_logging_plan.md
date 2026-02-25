# ASCII Painter + Shared Renderer Plan (2026-02-25)

This plan defines a safe path to build an ASCII painter workflow without fragmenting the UI stack. The goal is one renderer core used by both game mode and painter mode.

## Goals

- [ ] Add a dedicated ASCII painter launch mode that does not spawn full game services by default.
- [ ] Keep painter logs isolated from game logs.
- [ ] Fix log discovery reliability issues affecting `npm run dev:logs`.
- [ ] Improve glyph legibility (letter spacing and fallback font behavior).
- [ ] Build a shared `ascii_painter` utility module for image import and mouse painting.
- [ ] Keep renderer changes unified so both app runs pick them up automatically.

## Confirmed Decisions

- [x] Use isolated painter logs.
- [x] Font assets for renderer work are stored under `src/mono_ui/assets/fonts/`.

## Architecture Direction: One Renderer, Two App Shells

- [ ] Keep `src/mono_ui/` as the renderer kernel (canvas model, runtime loop, module contracts, event routing).
- [ ] Split app composition from renderer core:
  - [ ] `game_app_state` (current game-specific module graph, APIs, polling)
  - [ ] `ascii_painter_app_state` (tooling UI, no hard dependency on game services)
- [ ] Keep `CanvasRuntime` shared, with no mode-specific branching for app behavior.
- [ ] If renderer internals change (draw order, typography, input semantics), both app shells inherit the update automatically.

## Current Pain Points To Buffer Out

- [ ] App composition is currently monolithic and game-coupled (`src/canvas_app/app_state.ts`), making reuse hard.
- [ ] Font stack fallback behavior is constrained by runtime font-family handling.
- [ ] Letter spacing is too tight for readability in current defaults.
- [ ] Layer metadata exists (`render_index`) but effective composition is still module-order overwrite.

## Logging Reliability Plan (Game + Painter)

### A) Root causes to address

- [ ] Session filename assumptions are inconsistent across scripts.
- [ ] Log viewer filtering is too strict for some session naming variants.
- [ ] Date-directory selection can miss logs near day boundaries.

### B) Shared logging foundation

- [ ] Extract common launcher/log helpers used by both game and painter launchers.
- [ ] Standardize session naming format across launch paths.
- [ ] Standardize latest pointer metadata fields.
- [ ] Add robust fallback lookup: newest valid session if `latest.log` is stale.

### C) Isolated painter log namespace

- [ ] Write painter logs to `local_data/data_slot_<N>/logs_ascii_painter/YYYY-MM-DD/`.
- [ ] Maintain separate painter `latest.log`.
- [ ] Preserve existing game logs at `local_data/data_slot_<N>/logs/YYYY-MM-DD/`.

## Dev Command Plan

- [ ] Add `dev:ascii` for quick standalone painter mode.
- [ ] Add `dev:ascii:logs` for isolated painter log capture.
- [ ] Keep process set minimal by default (`vite + electron`), optional game services only when needed.

## Typography + Font Plan

- [ ] Use Martian Mono as primary UI face.
- [ ] Use Noto Sans Mono as fallback for extended glyph coverage.
- [ ] Ensure renderer font-family handling supports a true fallback stack.
- [ ] Tune letter spacing in painter mode first, then promote shared default.
- [ ] Add a glyph coverage panel in painter mode for fast visual verification.

## ASCII Painter Utility Plan

- [ ] Add `src/ascii_painter/` shared module (engine-agnostic).
- [ ] Define core grid cell model (`char`, `rgb`, `weight_index`, optional `render_index`).
- [ ] Implement tools: pencil, eraser, line, rectangle, fill, eyedropper.
- [ ] Implement undo/redo history.
- [ ] Add import/export helpers for grid serialization.

## Clipboard PNG -> ASCII Plan

- [ ] Add Electron IPC channel for clipboard image retrieval.
- [ ] Conversion pipeline: resample -> luminance map -> glyph mapping -> optional color mapping.
- [ ] Output directly to editable painter grid.

## Standalone Painter App Plan

- [ ] Add painter app entry and module graph separate from game app state.
- [ ] Reuse existing renderer runtime and module interfaces.
- [ ] Include tool palette, character palette, and import/export actions.

## Implementation Order

1. [ ] Logging foundation and reliability fixes.
2. [ ] Painter launcher with isolated logs.
3. [ ] Shared renderer typography/fallback fixes.
4. [ ] Shared `ascii_painter` core module.
5. [ ] Clipboard PNG import path.
6. [ ] Painter app shell and interaction layer.

## Definition of Done

- [ ] One renderer core powers both runs.
- [ ] Renderer edits are reflected in both game and painter modes.
- [ ] Painter logs are isolated and discoverable.
- [ ] Game log discovery for `dev:logs` is reliable.
- [ ] Extended glyphs render with fallback coverage.
- [ ] PNG import and mouse painting both work on the shared grid model.

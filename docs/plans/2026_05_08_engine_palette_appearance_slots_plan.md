# Engine Palette + Appearance Slots Implementation Plan

Date: 2026-05-08

## Context

Right now the project is in an active dev/refactor phase around painter/game visual alignment.

A lot of the richer payload preservation work is already much better than it used to be:
- painter-authored cells can preserve `graphic`
- painter-authored cells can preserve `appearance_slots`
- compatibility `materials` still exist
- legacy `rgb` still exists
- renderer paths already understand a mix of semantic materials, direct color, and indexed palette behavior

So the next step is not "add more payload capacity."

The next step is to make color/material handling feel like **one engine system** that both:
- the ASCII painter uses for authoring
- the game uses for world rendering

while still allowing the two apps to expose different workflows.

### Current desired direction

- The engine should own the indexed palette system, palette resolution, nearest-color logic, material tone resolution, and palette change propagation.
- The painter and the game should both use that same engine system so they are visually running under one hood.
- The painter and the game should still be allowed to expose different UX, input policies, and storage scopes.
- For direct authored color, we currently want **`flat_rgb` to remain valid authored truth**.
- For semantic surface appearance, we want **`material` slot values**.
- We do **not** currently want durable authored references to indexed color ids for direct-color cells.
- Indexed palette behavior should remain dynamic and engine-owned, so palette tuning can affect both painter and game live during development.
- Even if authored truth stays RGB-based, painter-facing swatches / color blocks should still come from the engine palette system so users are normally guided by curated colors rather than arbitrary raw RGB picking.
- The important difference between future "free color" workflows and indexed-palette workflows should mostly be **input policy / available colors**, not a different saved file format.

### Near-term project rule

For now, both painter and game should be able to point at the same active palette authority during development, so system color tweaks can be observed live in both places.

Later, the painter may gain per-document palette overrides, while the game continues using game-scoped palette state.

---

## Working source-of-truth model

### Authored visual truth

Shared cell visual payload should converge around:
- `graphic`
- `appearance_slots`
- `weight_index`

Where each appearance slot is one of:
- `{ kind: 'material', material_id: string }`
- `{ kind: 'flat_rgb', rgb: { r: number; g: number; b: number } }`

This should be the same storage model whether a painter session is currently palette-guided, custom-palette-driven, or later allows broader/free color placement.

### Engine-owned dynamic interpretation

The engine owns:
- indexed palette definitions
- nearest palette color lookup
- optional quantization policy
- material tone -> rendered RGB resolution
- lighting interaction for material-backed slots
- active palette scope resolution

### Compatibility-only fields

These should move toward bridge/fallback status only:
- `materials`
- legacy top-level `rgb`

### Authority order

For appearance resolution:
1. `appearance_slots`
2. compatibility `materials`
3. legacy `rgb`

---

## Goals

1. Make appearance/color/material handling an engine concern instead of duplicated painter/game/renderer logic.
2. Keep direct authored color durable via `flat_rgb`.
3. Keep semantic surface appearance durable via `material` slot values.
4. Keep indexed palette behavior dynamic so palette/system changes can be previewed live.
5. Ensure painter-authored content can transfer into game/world sculpting with minimal or no lossy conversion.
6. Leave room for later painter document palette overrides without splitting the engine color model.
7. Keep painter and game visually unified by sharing one engine palette/material resolver even when app UX differs.
8. Let the painter expose palette-guided swatches / color blocks without making arbitrary RGB grabbing the default workflow.
9. Treat "indexed vs free color" primarily as an authoring/input-policy distinction, not a file-format distinction.
10. Provide a safety valve for normalization, including a painter command to flatten authored colors to the active indexed palette when needed.

---

## Non-goals for this pass

- Do not fully redesign the indexed palette system yet.
- Do not require painter direct colors to become indexed-color ids.
- Do not force painter and game to expose identical palette-editing UX.
- Do not attempt broad scene/composition unification here.
- Do not solve every material-definition authoring problem in the same pass.

---

## Phase 1 - Lock the engine appearance contract

### Purpose

Make the shared contract explicit before refactoring resolver and renderer code.

### Todos

- [ ] Confirm the canonical slot value model remains:
  - [ ] `{ kind: 'material', material_id }`
  - [ ] `{ kind: 'flat_rgb', rgb }`
- [ ] Confirm `appearance_slots` is the real authored appearance authority.
- [ ] Confirm `materials` is compatibility-only input/output, not long-term authored truth.
- [ ] Confirm top-level `rgb` is compatibility/resolved-output data, not preferred authored truth when slots exist.
- [ ] Document the exact appearance authority order in code comments and plan notes.
- [ ] Identify all types that still imply dual authority and list whether they need cleanup now or later.

### Key files / areas

- `src/render_shaders/graphics_contract.ts`
- `src/mono_ui/runtime/automation_interfaces.ts`
- `src/ascii_painter/painter_document.ts`
- `src/mono_ui/types.ts`

---

## Phase 2 - Create one shared engine appearance resolver

### Purpose

Stop font renderer, atlas renderer, and helper paths from each owning slightly different color/material logic.

Important boundary: this resolver should decide how stored appearance is interpreted/rendered. It should not become the owner of painter input restrictions or available-color policy.

### Todos

- [ ] Define one shared appearance-resolution seam for engine/runtime use.
- [ ] Define exact responsibilities for:
  - [ ] slot value -> RGB resolution
  - [ ] material tone -> RGB resolution
  - [ ] nearest indexed palette quantization
  - [ ] compatibility fallback order
- [ ] Decide whether quantization is always-on, policy-driven, backend-driven, or context-driven.
- [ ] Ensure the resolver can handle both:
  - [ ] direct `flat_rgb`
  - [ ] semantic `material`
- [ ] Ensure the resolver is reusable by painter preview, game rendering, transfer helpers, and tests.

### Key files / areas

- `src/mono_ui/runtime/material_registry.ts`
- `src/mono_ui/colors.ts`
- likely new shared resolver module in engine/runtime/render area

---

## Phase 3 - Clarify the engine palette system

### Purpose

Make indexed palette behavior explicitly engine-owned and future-friendly.

Under this plan, the palette system has two distinct roles that must stay clear:
- interpretation / quantization / rendering support
- curated available-color source for painter-facing authoring UI

### Todos

- [ ] Identify whether `src/mono_ui/colors.ts` is the long-term palette authority or just the current storage/helper location.
- [ ] Define the engine palette responsibilities clearly:
  - [ ] palette entries
  - [ ] stable palette structure / lookup
  - [ ] nearest-color lookup
  - [ ] quantization helpers
  - [ ] active palette selection
- [ ] Define how palette changes propagate to painter + game live during development.
- [ ] Decide what data belongs to:
  - [ ] engine default palette
  - [ ] game-scoped palette state
  - [ ] future painter document palette override
- [ ] Confirm that direct-color authored cells remain valid even when palette contents change.

### Key files / areas

- `src/mono_ui/colors.ts`
- palette/persistence areas to be identified during implementation

---

## Phase 4 - Convert renderers to consume the shared engine resolver

### Purpose

Renderer code should consume shared appearance decisions, not invent them locally.

### Todos

- [ ] Replace font renderer-local slot/material/rgb resolution with the shared resolver.
- [ ] Replace atlas renderer-local slot-color resolution with the shared resolver where possible.
- [ ] Keep renderer-specific responsibilities limited to backend behavior:
  - [ ] glyph drawing
  - [ ] atlas frame lookup
  - [ ] atlas band tint application
- [ ] Confirm both font and atlas paths interpret the same authored slot values consistently.
- [ ] Confirm `text_*` fallback graphics still render correctly after resolver centralization.

### Key files / areas

- `src/mono_ui/runtime/cell_renderer.ts`
- `src/mono_ui/runtime/atlas_runtime.ts`

---

## Phase 5 - Clean up compatibility bridging in render flow

### Purpose

Make compatibility fields stay compatible without continuing to behave like equal authorities.

### Todos

- [ ] Audit where final cell `rgb` is produced and whether it is treated as authored truth instead of resolved output.
- [ ] Audit where compatibility `materials` are merged, cloned, or persisted as if they were primary truth.
- [ ] Define one consistent bridge rule:
  - [ ] if `appearance_slots` exist, use them
  - [ ] else bridge from `materials`
  - [ ] else bridge from legacy `rgb`
- [ ] Confirm reducer/resolver paths preserve `appearance_slots` through to consumer-facing cells.
- [ ] Confirm no late render stage silently drops slot-authored data.

### Key files / areas

- `src/render_shaders/resolver.ts`
- `src/render_shaders/reducer.ts`
- render payload builder / resolver paths discovered during implementation

---

## Phase 6 - Align painter authoring with the engine contract

### Purpose

Ensure the painter writes and preserves the same appearance model the game should consume.

This phase should preserve valid out-of-palette RGB values when they already exist in files or are sampled from content, even if normal authoring remains palette-guided.

### Todos

- [ ] Audit painter brush application to confirm direct color writes prefer `appearance_slots` with `flat_rgb`.
- [ ] Audit painter material application to confirm semantic surface writes prefer `appearance_slots` with `material`.
- [ ] Audit sample/pick behavior to confirm it round-trips slot-authored data cleanly.
- [ ] Audit erase behavior for slot-aware semantics.
- [ ] Audit text-entry behavior for remaining `rgb`-first or `char`-first assumptions.
- [ ] Audit move/transform helpers for slot preservation.
- [ ] Audit copy/paste/import/export paths for slot preservation.
- [ ] Confirm painter-stored voxels preserve rich authored data without forcing palette-index references.

### Key files / areas

- `src/mono_ui/modules/painter_canvas_module.ts`
- `src/ascii_painter/painter_document.ts`
- painter picker/brush helper paths

---

## Phase 7 - Align painter color/material UI semantics

### Purpose

Make the painter UI clearly write the canonical authored appearance model.

### Todos

- [ ] Confirm color selector semantics for direct-color painting.
- [ ] Confirm material selector semantics for semantic surface painting.
- [ ] Confirm painter swatches are sourced from the engine indexed palette system.
- [ ] Confirm the painter color block also resolves through the same engine palette logic, so it helps guide users toward curated colors instead of arbitrary raw RGB entry.
- [ ] Decide whether indexed palette entries in the painter are:
  - [ ] direct RGB conveniences
  - [ ] quantized preview choices
  - [ ] future palette-editable document controls
- [ ] Decide whether arbitrary RGB picking should be:
  - [ ] hidden entirely at first
  - [ ] available only in an advanced workflow
  - [ ] allowed but clearly separated from normal palette-guided painting
- [ ] Confirm free color picking still produces durable `flat_rgb` authored values.
- [ ] Confirm UI preview cells use the same engine appearance logic as the final renderer when practical.
- [ ] Confirm painter-facing palette UI can stay linked to the shared dev palette for now, while still leaving room for later per-document palette ownership.

### Key files / areas

- `src/mono_ui/modules/color_selector_module.ts`
- `src/mono_ui/modules/color_picker_module.ts`
- `src/mono_ui/runtime/color_picker_models.ts`
- painter app state wiring

---

## Phase 8 - Prepare painter color normalization + selection semantics

### Purpose

Avoid cross-file / cross-palette bugs by giving the painter explicit normalization tools and clear selection semantics for color-based operations.

This is not just polish. Because files can contain out-of-palette sampled colors, imported colors, or near-duplicate RGB drift, normalization and matching policy are core workflow-stability features.

### Todos

- [ ] Define how color-equality tools behave when cells store `flat_rgb` but the UI is palette-guided.
- [ ] Explicitly treat painter color behavior as an input-policy problem, not a storage-format split.
- [ ] Audit likely risk areas such as:
  - [ ] paint bucket selection
  - [ ] magic-wand / fill-style matching if added later
  - [ ] replace-color operations
  - [ ] sampling / compare logic
- [ ] Decide exact matching policy options for painter operations:
  - [ ] exact RGB match
  - [ ] nearest indexed color match
  - [ ] same material match
  - [ ] user-selectable mode later if needed
- [ ] Add a painter command/button to flatten authored direct colors to the active indexed palette.
- [ ] Define what flattening means exactly:
  - [ ] rewrite `flat_rgb` values to nearest indexed RGB values
  - [ ] preserve `material` slots untouched
  - [ ] operate on whole file, layer, or selection depending on scope chosen later
- [ ] Decide whether flattening is a recovery/cleanup tool only or also part of normal workflow.
- [ ] Add diagnostics/test cases around mixed near-color files so painter tools behave predictably.

### Key files / areas

- `src/mono_ui/modules/painter_canvas_module.ts`
- `src/mono_ui/modules/color_selector_module.ts`
- `src/mono_ui/modules/color_picker_module.ts`
- painter tool / fill / selection helper paths

---

## Phase 9 - Prepare painter -> game transfer / sculpting path

### Purpose

Make painter-authored appearance payload useful as a world-sculpting source.

### Todos

- [ ] Define the minimal transfer payload for painter-authored visuals.
- [ ] Prefer transfer payload shape:
  - [ ] `graphic`
  - [ ] `appearance_slots`
  - [ ] `weight_index`
- [ ] Identify where game/world-facing consumers can already accept this shape directly.
- [ ] Identify where conversion is still required.
- [ ] Avoid lossy conversion back through plain `rgb` wherever possible.
- [ ] Decide first transfer target(s):
  - [ ] tile sculpting
  - [ ] prop placement
  - [ ] visual block stamping
  - [ ] imported authored overlays

### Key files / areas

- game render payload builder paths
- place/world visual consumers
- any painter import/export or world placement bridge paths

---

## Phase 10 - Palette scope and storage follow-up

### Purpose

Support current linked-development behavior while leaving room for painter-specific palette ownership later.

Per-document palette ownership should be treated as a document-specific available-color / interpretation context, not a separate document color model.

### Todos

- [ ] Define current "linked for dev" palette authority.
- [ ] Decide where the active shared palette should live right now.
- [ ] Define future scope resolution order:
  1. [ ] painter document palette override
  2. [ ] app/profile/game active palette
  3. [ ] engine default palette
- [ ] Reserve a place in painter document shape for optional palette override later.
- [ ] Reserve a place in game/app settings for game-scoped palette state.
- [ ] Keep painter + game on the same engine implementation even when scopes diverge later.

### Key files / areas

- `src/ascii_painter/painter_document.ts`
- profile/app persistence areas
- game settings / engine persistence areas to be identified

---

## Phase 11 - Regression coverage

### Purpose

Lock down behavior before and during the cleanup so we do not regress payload preservation or split renderer behavior.

### Todos

- [ ] Add tests for shared appearance resolution:
  - [ ] `flat_rgb` direct resolve
  - [ ] `flat_rgb` quantized resolve
  - [ ] `material` resolve through material system
  - [ ] `appearance_slots` over compatibility `materials`
  - [ ] compatibility `materials` over legacy `rgb`
- [ ] Add tests that font and atlas paths resolve equivalent slot-authored cells consistently.
- [ ] Add painter tests for preserving slot-authored cells through:
  - [ ] paint
  - [ ] text entry
  - [ ] move
  - [ ] erase
  - [ ] copy/paste
- [ ] Add transfer/preservation checks for painter-authored cells heading into game-facing consumers.

### Key files / areas

- new shared resolver tests
- `src/mono_ui/modules/painter_canvas_module_text_mode.test.ts`
- `src/mono_ui/modules/painter_canvas_module_move.test.ts`
- other renderer / payload tests found during implementation

---

## Recommended implementation order

1. [ ] Lock shared appearance contract and comments/types.
2. [ ] Create shared engine appearance resolver seam.
3. [ ] Clarify / extract engine palette responsibilities.
4. [ ] Convert font renderer to shared resolver.
5. [ ] Convert atlas renderer to shared resolver.
6. [ ] Clean compatibility fallback order in resolver/reducer flow.
7. [ ] Audit and align painter mutation paths.
8. [ ] Audit and align painter color/material UI semantics.
9. [ ] Prepare painter color normalization + selection semantics.
10. [ ] Prepare painter -> game transfer path.
11. [ ] Add/expand regression coverage.
12. [ ] Reassess whether document palette override support should begin immediately or remain reserved for a later pass.

---

## Open questions to iterate on

- [ ] Should quantization policy be globally configured, renderer-specific, or context-specific?
- [ ] Should font rendering default to direct RGB while atlas rendering defaults to indexed quantization, or should both be policy-driven from one shared layer?
- [ ] How much of current material definition data should stay palette-name based versus moving toward richer engine-owned tone definitions later?
- [ ] Should painter color tools default to exact RGB matching, nearest-index matching, or some hybrid behavior?
- [ ] Is arbitrary RGB input needed in the first painter pass, or should palette-guided picking be the only exposed workflow until the engine model settles more?
- [ ] What is the first concrete painter -> game transfer workflow we want to support during this pass?
- [ ] How soon should painter document palette overrides become real versus staying planned/reserved?

---

## Bottom line

This plan is about turning color/material/render interpretation into one engine concern with:
- durable direct authored color via `flat_rgb`
- durable semantic surface intent via `material`
- dynamic indexed palette behavior owned by the engine
- shared painter/game rendering behavior under one engine hood
- one shared storage model across palette-guided and future freer-color workflows
- palette-guided painter workflows instead of arbitrary-color chaos by default
- a normalization escape hatch (`flatten all colors to indexed`) for recovery and cleanup
- app-specific storage/editing scope layered on top

A useful way to read the implementation is as three layers:
1. shared storage truth
2. shared engine interpretation
3. painter input / available-color policy

It is intentionally structured as a working implementation checklist so it can be refined while coding.

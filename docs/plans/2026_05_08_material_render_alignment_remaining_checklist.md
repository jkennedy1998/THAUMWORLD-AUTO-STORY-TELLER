# Material / Render Alignment Remaining Checklist

Date: 2026-05-08

## Purpose

Capture what still remains on the material/render alignment side now that a large amount of unified visual payload work has landed.

This is a short follow-up checklist, not the full architecture plan.

Related docs:
- `docs/design/painter_game_render_alignment_observations.md`
- `docs/plans/2026_05_07_unified_graphic_payload_source_of_truth_plan.md`
- `docs/plans/2026_05_07_unified_graphic_payload_render_flow_deep_dive_1.md`
- `docs/plans/2026_05_07_unified_graphic_payload_graphic_definition_surface_deep_dive_2.md`
- `docs/plans/2026_05_07_unified_graphic_payload_slot_value_model_deep_dive_3.md`

## Current read

A lot of the hard payload-preservation work is now in place:
- painter-authored storage preserves richer visual payload
- runtime projection preserves `graphic` and `appearance_slots`
- active painter brush/picker flows are much more aligned
- font and atlas backends both understand `appearance_slots`

So the remaining work is mostly **authority cleanup**, **secondary-path cleanup**, and **definition/resolver cleanup**.

## Remaining checklist

### 1. Finish authority cutover to `appearance_slots`

- [ ] Audit remaining places where compatibility `materials` still act like real authority instead of bridge-only data
- [ ] Audit remaining places where legacy `rgb` still acts like authored truth instead of compatibility/fallback data
- [ ] Keep the intended authority order consistent everywhere:
  - `appearance_slots`
  - compatibility `materials`
  - legacy `rgb`
- [ ] Confirm this same ordering holds in painter, game runtime, storage, and command-normalization paths

### 2. Sweep remaining low-traffic painter mutation paths

- [ ] Audit brush helpers for any legacy text-first cell reconstruction
- [ ] Audit erase behavior for slot-aware semantics and graphic-only cells
- [ ] Audit text-entry behavior for remaining `char`-first assumptions
- [ ] Audit paste/import/export helper paths for silent payload loss
- [ ] Audit move/transform helpers for silent payload loss or fallback reconstruction
- [ ] Add or extend regressions for graphic-only and slot-authored cells in these paths

### 3. Demote compatibility `materials` cleanly

- [ ] Keep `materials` as derived/compatibility data, not long-term user-facing authority
- [ ] Audit any UI/editor logic that still treats `materials` as the main editable visual payload
- [ ] Identify any remaining places where `materials` are persisted or cloned without clear compatibility-only intent

### 4. Remove naming-driven backend authority

- [ ] Audit `text_` routing assumptions in render backends
- [ ] Audit atlas family lookup assumptions tied to `tile_`, `item_`, `character_`, or similar prefixes
- [ ] Move toward explicit source-kind / graphic-definition ownership instead of string-prefix ownership

### 5. Consolidate graphic-definition ownership

- [ ] Identify which responsibilities still live in the wrong layer:
  - payload builders
  - graphic resolver
  - connectivity helper
  - atlas runtime
  - backend renderer routing
- [ ] Define the shortest practical path toward one explicit graphic-definition authority surface
- [ ] Keep materials responsible for appearance behavior, not structure/presentation choice

### 6. Unify presentation selector ownership further

- [ ] Confirm facing/view behavior is routed through the intended shared presentation path
- [ ] Decide first-pass neighbor-context scope for the unified resolver surface
- [ ] Decide how breath-driven presentation selection plugs into the same presentation-selection model
- [ ] Avoid duplicating presentation logic between resolver layers and backend-specific runtime code

### 7. Audit remaining payload producers and consumers

- [ ] Sweep low-traffic producers that may still emit old-shape cells/payloads
- [ ] Sweep secondary UI/runtime consumers that may still drop `appearance_slots`
- [ ] Confirm clone/serialization/history/automation paths preserve rich payload consistently

## What no longer appears to be the main blocker

These look much closer than before:
- painter canonical storage of richer payload
- projection/runtime preservation of richer payload
- first-pass slot-targeted painter editing controls
- atlas/font backend consumption of `appearance_slots`

## Bottom line

The material/render alignment work is no longer mainly blocked by missing payload capacity.

The remaining work is mostly:
- finishing source-of-truth cutover
- cleaning up secondary/legacy paths
- removing naming-driven backend assumptions
- consolidating presentation/definition ownership

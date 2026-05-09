# Unified Pan Runtime Pre-Implementation Checklist

Date: 2026-05-08

## Intent

Create a strict file-by-file audit checklist before implementing the unified pan runtime so we do not preserve old pan architecture under new names.

This checklist is meant to be used alongside:

- `docs/plans/2026_05_08_unified_pan_runtime_plan.md`
- `docs/plans/2026_05_08_module_3d_camera_engine_plan.md`

Primary goal:

- know exactly which files own pan today
- know which files should be adapters vs true runtimes
- know which old pan trash must be removed instead of wrapped forever

---

## Locked Audit Rules

### 1. Do not treat every pan field as the same concept

During implementation, classify each pan surface as one of:

- viewport pan
- module pan
- camera pan
- screen-locked compensation
- 1D scroll

### 2. Do not preserve duplicate gesture ownership

If both runtime and module decide `Space + drag` ownership, that is a migration smell.

### 3. Do not leave screen-locked UI dependent on inverse-pan hacks as final architecture

Temporary stabilization is allowed.

Final hot paths must use explicit screen-locked layering.

### 4. Do not let camera-backed views keep a second hidden pan truth forever

Short-term adapters are allowed.

Long-term ownership should be camera/runtime-authored where appropriate.

### 5. Cleanup is mandatory

Every file touched by pan migration must be checked for:

- dead config callbacks
- stale comments
- old sign conventions
- duplicate clamp logic
- leftover compatibility state

---

## Current Pan Ownership Map

### Viewport/global pan

Current owner:

- `src/mono_ui/runtime/canvas_runtime.ts`

Current state:

- `pan_tiles_x`
- `pan_tiles_y`
- `pan_accum_px_x`
- `pan_accum_px_y`
- `global_pan_active`
- `last_pan_client_x`
- `last_pan_client_y`

Current behavior:

- CSS-transform-based mono-canvas movement
- tile snapping
- `Space + drag` routing logic
- publishes `thaumworld_ui_pan`
- pushes `setRuntimePanOffset(...)` into modules
- clamps against screen-locked pan bounds aggregation

### DOM/view-space propagation

Current owner:

- `src/mono_ui/runtime/dom_viewport.ts`
- `src/mono_ui/runtime/ui_metrics.ts`

Current behavior:

- converts module rects to CSS-space viewports using global pan px
- implicitly assumes modules share the same global panned root

### Place/local place-painter pan

Current owner:

- `src/mono_ui/modules/place_module.ts`
- `src/mono_ui/runtime/place_camera_controller.ts`

Current state:

- `view.offset_x`
- `view.offset_y`
- drag-pan state for place painter mode
- key pan state
- persistence in place camera controller

Current behavior:

- local pan in module-owned render/view state
- separate from viewport/global pan
- separate from shared camera runtime semantics
- listens to `thaumworld_ui_pan` for DOM overlay alignment

### Standalone painter local pan

Current owner:

- `src/mono_ui/modules/painter_canvas_module.ts`
- render-facing camera payload from `src/canvas_app/painter_app_state.ts`

Current state:

- local `camera.pan_x`
- local `camera.pan_y`
- local drag pan session
- `global_pan_offset` compatibility storage

Current behavior:

- module-owned local pan logic
- `Space + drag` pan in module
- wheel/key/local coordinate conversion semantics
- mixed with camera-shaped render payload even though shared camera migration is already underway elsewhere

### Screen-locked overlay compensation

Current owner:

- `src/mono_ui/modules/screen_overlay_bar_module.ts`
- `src/mono_ui/modules/program_nav_bar_module.ts`
- runtime pan-bounds aggregation in `src/mono_ui/runtime/canvas_runtime.ts`

Current state:

- `runtime_pan_x`
- `runtime_pan_y`
- rect calculation subtracting/adding runtime pan

Current behavior:

- visually cancels viewport pan instead of living in a separate layout root

### 1D/2D module scroll/pan

Current owner examples:

- `src/mono_ui/modules/window_module.ts`
- `src/mono_ui/modules/character_module.ts`

Current state examples:

- `scroll_y`
- `pan_offset`
- local drag-pan state

Current behavior:

- one-off module logic
- one-off clamp logic
- not participating in a shared pan protocol

---

## File-By-File Checklist

## 1. `src/mono_ui/runtime/canvas_runtime.ts`

### Current role

Primary owner of viewport/global pan and current pan gesture routing.

### Confirmed hot spots

- `global_pan_active`
- `pan_tiles_x` / `pan_tiles_y`
- `setRuntimePanOffset(...)` fanout
- `isScreenLocked` / `getScreenLockedPanBounds` checks
- `thaumworld_ui_pan` event dispatch
- multiple `Space + drag` routing branches
- duplicate or mirrored pointer/mouse drag code paths

### Pre-implementation checklist

- [ ] Inventory every place where `global_pan_active` is set/reset.
- [ ] Inventory every place where `Space + drag` routing branches by module type or mode.
- [ ] Distinguish true viewport-pan logic from generic drag-capture logic.
- [ ] Identify duplicated mouse vs pointer pan-routing code that should collapse into shared router behavior.
- [ ] Confirm what should remain in runtime after router extraction:
  - hit testing
  - capture ownership
  - viewport-pan adapter fallback
- [ ] Mark `setRuntimePanOffset(...)` as transitional for screen-locked compensation only.
- [ ] Audit whether `thaumworld_ui_pan` remains necessary after layered screen-locking or becomes transitional only.
- [ ] Audit whether runtime pan-bounds aggregation should remain a screen-lock compatibility bridge or be replaced entirely.
- [ ] Add a removal list for old debug logs/comments that describe today’s special-case routing.

### High-risk trap

Leaving `canvas_runtime.ts` as the real pan router while also adding a new shared pan router would preserve duplicate architecture.

---

## 2. `src/mono_ui/runtime/dom_viewport.ts`

### Current role

Converts grid/module rects into DOM/CSS viewport rectangles using viewport pan.

### Pre-implementation checklist

- [ ] Confirm whether this file should stay a pure geometry utility.
- [ ] Confirm whether it should remain unaware of screen-locked layering.
- [ ] Audit assumptions that all modules share one globally panned root.
- [ ] Document whether screen-locked overlay DOM consumers need a sibling computation path or a layer-mode-aware path.

### High-risk trap

Baking layer-mode decisions into geometry helpers instead of keeping them in runtime/layout ownership.

---

## 3. `src/mono_ui/modules/screen_overlay_bar_module.ts`

### Current role

Pinned overlay that currently compensates against runtime pan.

### Confirmed hot spots

- `runtime_pan_x`
- `runtime_pan_y`
- rect math that subtracts/adds runtime pan
- `setRuntimePanOffset(...)`

### Pre-implementation checklist

- [ ] Mark this module as target `screen_locked` behavior, not viewport-pannable behavior.
- [ ] Document current inverse-pan math as transitional-only.
- [ ] Identify which runtime-facing hooks become obsolete after real screen-locked layering.
- [ ] Confirm whether this module should eventually expose explicit layer mode instead of accepting pan offsets.
- [ ] Audit all rect math for assumptions tied to the globally panned root.

### High-risk trap

Keeping `setRuntimePanOffset(...)` as permanent architecture for pinned overlays.

---

## 4. `src/mono_ui/modules/program_nav_bar_module.ts`

### Current role

Thin wrapper over `screen_overlay_bar_module.ts`.

### Pre-implementation checklist

- [ ] Treat this as an overlay-layer consumer, not an independent pan system.
- [ ] Confirm that no extra pan logic should live here.
- [ ] Ensure later cleanup removes any stale routing assumptions inherited from overlay-bar behavior.

---

## 5. `src/mono_ui/modules/place_module.ts`

### Current role

Owns local place viewport offsets and place-painter drag/key pan behavior; also consumes global UI pan for DOM layer alignment.

### Confirmed hot spots

- `view.offset_x`
- `view.offset_y`
- `painter_pan_drag_active`
- `painter_pan_start`
- `painter_pan_view_start`
- key pan mutation of `view.offset_x/y`
- `sync_module_camera_anchor_from_view(place)`
- `camera.ensure_loaded_for_place(...)`
- `camera.schedule_save(...)`
- `window.addEventListener('thaumworld_ui_pan', ...)`
- `dom_pan_px`

### Pre-implementation checklist

- [ ] Separate place local pan concerns into:
  - pure module/view offset behavior
  - camera-related semantic detachment/persistence hooks
  - DOM overlay alignment behavior
- [ ] Decide what the first adapter wraps:
  - raw `view.offset_x/y`
  - clamp/save behavior from place camera controller
  - manual-pan notification path via `sync_module_camera_anchor_from_view(place)`
- [ ] Document that current local pan sign convention must be normalized in adapter tests.
- [ ] Confirm whether place gameplay mode and place painter mode should expose the same pan capability or distinct policy presets over one adapter.
- [ ] Audit all `Space + drag` code paths so ownership can move to the shared router.
- [ ] Audit key pan so it eventually uses the same pan-target semantics as drag pan.
- [ ] Mark `window.addEventListener('thaumworld_ui_pan', ...)` and `dom_pan_px` as likely transitional once layer/layout responsibilities are cleaned.
- [ ] Confirm the long-term target:
  - place module consumes camera/view output
  - shared router owns pan gesture choice
  - module no longer decides pan-routing architecture

### High-risk trap

Leaving both module-local `Space + drag` ownership and runtime-level `Space + drag` ownership alive after the new router exists.

---

## 6. `src/mono_ui/runtime/place_camera_controller.ts`

### Current role

Owns local place view persistence/clamp helpers around `view.offset_x/y`.

### Pre-implementation checklist

- [ ] Decide whether this remains a storage/clamp utility behind a pan adapter or gets absorbed later.
- [ ] Separate what is genuinely generic module-pan behavior from what is place-specific persistence policy.
- [ ] Audit whether names like `PlaceCameraController` preserve old architecture if the actual role becomes local module pan storage.
- [ ] Note if this should be renamed later once camera-vs-pan ownership is cleaner.

### High-risk trap

Keeping a legacy “camera controller” name around a flat local pan store indefinitely.

---

## 7. `src/mono_ui/modules/painter_canvas_module.ts`

### Current role

Owns standalone painter local pan gesture logic and local camera-pan fields used by the flat projected canvas.

### Confirmed hot spots

- `global_pan_offset`
- `getTotalPan()`
- `camera.pan_x`
- `camera.pan_y`
- `pan_start`
- `view_start`
- `is_panning`
- `OnDragMove(...)`
- `OnWheel(...)`
- text-mode gating around `Space + drag`

### Pre-implementation checklist

- [ ] Classify each pan-related field as:
  - local module pan truth
  - camera-shaped render payload compatibility
  - dead/compatibility glue
- [ ] Audit `global_pan_offset` and confirm whether it is already obsolete or still needed as a temporary bridge.
- [ ] Audit `getTotalPan()` comments and behavior so the final adapter contract is explicit about coordinate ownership.
- [ ] Separate gesture ownership from actual pan application.
- [ ] Confirm the first adapter should wrap existing `camera.pan_x/y` behavior rather than immediately rewriting every projection path.
- [ ] Document the long-term target that shared camera frame anchor should be the real 3D/world framing truth where appropriate.
- [ ] Audit wheel/key pan and drag pan to ensure they can share one adapter contract later.
- [ ] Check text-mode behavior so the pan router does not break text capture semantics.

### High-risk trap

Reintroducing a second painter camera truth by keeping local `camera.pan_x/y` semantics forever after the shared camera migration already established cleaner framing buckets.

---

## 8. `src/canvas_app/painter_app_state.ts`

### Current role

Already partway through shared camera migration; still emits render-facing camera payload with `pan_x/pan_y = 0` in projection-facing camera tuning paths.

### Confirmed hot spots

- render-facing `painter_camera_state.pan_x = 0`
- render-facing projected camera `pan_x = 0`, `pan_y = 0`
- shared painter camera runtime + projection seam already in place

### Pre-implementation checklist

- [ ] Confirm which `pan_x/pan_y` fields are only render payload defaults and not semantic camera truth anymore.
- [ ] Ensure unified pan work does not accidentally repromote those fields into real authority.
- [ ] Document the intended seam between:
  - shared camera framing state
  - flat painter module pan adapter
  - render-only voxel/camera payload
- [ ] Audit any automation/debug hooks that still imply old camera-target vocabulary for pan.

### High-risk trap

Accidentally undoing the newer camera separation by treating render payload pan fields as real state again.

---

## 9. `src/canvas_app/app_state.ts`

### Current role

Owns THAUMWORLD camera runtime semantics and place module wiring, including manual camera anchor persistence/detachment behavior.

### Pre-implementation checklist

- [ ] Confirm unified pan integration does not reintroduce old app-owned pan-routing behavior.
- [ ] Keep app-state responsibility limited to semantic camera requests and policy, not drag/session mechanics.
- [ ] Audit place-module wiring to ensure the future pan adapter remains a module/runtime concern rather than app-state gesture logic.
- [ ] Note any terminology that should distinguish viewport pan from place camera pan.

---

## 10. `src/mono_ui/modules/window_module.ts`

### Current role

Simple vertical scroll owner with one-off `scroll_y` behavior.

### Confirmed hot spots

- `scroll_y`
- `scroll_by(...)`
- border markers derived from scroll
- possible drag-to-pan note/comment path

### Pre-implementation checklist

- [ ] Classify this as `scroll_1d`, not generic camera pan.
- [ ] Decide whether it should use a vertical-scroll adapter or generic module-pan adapter with Y-only axis.
- [ ] Audit whether wheel/key/drag scroll ownership is currently module-local and should later route through shared pan semantics.
- [ ] Confirm max-scroll clamp logic can stay local but be reached through shared adapter shape.

### High-risk trap

Ignoring 1D scroll modules during pan unification and leaving them as a permanent parallel architecture.

---

## 11. `src/mono_ui/modules/character_module.ts`

### Current role

Owns a separate 2D local pan system for body slots area.

### Confirmed hot spots

- `pan_offset`
- `is_panning`
- `pan_start`
- `pan_start_offset`
- `calculate_pan_bounds()`
- body-slots-area-only hit testing

### Pre-implementation checklist

- [ ] Classify this as `module_2d`, not viewport pan and not world camera pan.
- [ ] Audit whether it should become an early generic module-pan adapter candidate.
- [ ] Document local clamp semantics and visible-content constraints.
- [ ] Check whether any drag/drop interactions compete with local panning and need explicit routing priority.

### High-risk trap

Forgetting 2D non-world modules and letting them keep bespoke pan logic while only place/painter get cleaned.

---

## 12. `src/mono_ui/runtime/automation_interfaces.ts`

### Current role

Defines automation probe names such as painter focus plane and painter camera target.

### Pre-implementation checklist

- [ ] Audit whether any automation names should be clarified once pan semantics are cleaner.
- [ ] Confirm whether `capture_painter_camera_target` still means frame anchor and whether that wording stays acceptable.
- [ ] Ensure unified pan changes do not silently change probe meaning without documenting it.

---

## 13. `src/canvas_app/painter_tool_assisted_inputs_wiring.ts`

### Current role

Wires automation runtime probes including `get_camera_target`.

### Pre-implementation checklist

- [ ] Confirm probe meanings stay stable during pan migration.
- [ ] Audit whether any new pan/runtime probe is needed for debugging viewport pan vs module pan.
- [ ] Avoid introducing stale names if additional probes are added.

---

## 14. `src/mono_ui/runtime/ui_metrics.ts`

### Current role

Provides grid/screen conversion utilities used by DOM viewport math.

### Pre-implementation checklist

- [ ] Confirm this remains pure geometry/math.
- [ ] Avoid leaking screen-locked or router policy into metrics utilities.

---

## 15. `src/mono_ui/modules/place_camera_control_module.ts`

### Current role

Camera UI surface that may expose controls whose meaning needs clearer separation between camera pan and flat module pan.

### Pre-implementation checklist

- [ ] Audit labels and controls for stale terminology.
- [ ] Confirm whether any control currently assumes old local-pan ownership.
- [ ] Ensure user-facing commands continue to map to the correct authority after pan unification.

---

## 16. `src/mono_ui/place_dom_layers.ts`

### Current role

Consumes DOM viewport/pan-related placement for layered place rendering.

### Pre-implementation checklist

- [ ] Confirm this remains a consumer of resolved viewport/layer geometry, not a pan owner.
- [ ] Audit any assumptions that tie DOM layer placement directly to old global-pan event propagation.

---

## Cross-Cutting Cleanup Checklist

### Gesture ownership

- [ ] One shared `Space + drag` router path only.
- [ ] One active pan session owner model only.
- [ ] No duplicate pointer-vs-mouse pan routing architecture left behind.

### Naming cleanup

- [ ] Distinguish viewport pan / module pan / camera pan in code comments and helpers.
- [ ] Remove stale “camera” naming from flat local pan storage where misleading.
- [ ] Remove stale “global pan offset” naming where the value is dead or transitional only.

### Layering cleanup

- [ ] Screen-locked overlays no longer depend on permanent inverse-offset compensation.
- [ ] Runtime/module contracts clearly express layer mode.

### Bounds and sign cleanup

- [ ] Adapter tests define drag direction/sign convention explicitly.
- [ ] Clamp logic is centralized where possible instead of duplicated silently.

### Persistence cleanup

- [ ] Viewport pan persistence, module pan persistence, and camera persistence are clearly separated.
- [ ] Old save/load paths are not left duplicated behind adapters.

### Automation/debug cleanup

- [ ] Probe semantics documented after pan migration.
- [ ] Debug logs/comments from old routing behavior removed or updated.

---

## Recommended First Implementation Slice After This Checklist

1. `src/engine/pan/*` foundation
2. viewport pan adapter for `canvas_runtime.ts`
3. place module pan adapter
4. painter canvas pan adapter
5. central pan router integration in `canvas_runtime.ts`
6. screen-locked layer-mode introduction
7. cleanup/removal pass on old routing branches and compensation hacks

---

## Definition Of Ready

Implementation should not start until the team agrees on these points:

- [ ] which files are true runtime owners vs adapters
- [ ] which current pan systems are transitional only
- [ ] which pinned modules become `screen_locked`
- [ ] which first-slice adapters wrap old storage without promoting it to long-term architecture
- [ ] which cleanup removals are required before the migration is considered done

If any of those are unclear, implementation should pause and resolve them before code spreads the wrong pattern.

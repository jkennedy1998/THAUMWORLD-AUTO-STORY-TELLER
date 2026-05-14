# Place Projection / Renderer Alignment Plan

## Goal

Align the painter/place 3D viewing experience around a single hard projection authority before changing renderer behavior, while also expanding the practical depth window available in the camera UI.

This plan covers two implementation tracks that must be staged together:

1. **Depth window expansion**
   - raise defaults/limits for `render_distance_planes`
   - review any fixed UI/view assumptions that currently cap visible layers
2. **Projection / renderer authority alignment**
   - reduce or remove cases where DOM/CSS transforms act like a second view system on top of the hard projection math

## Why this needs a plan first

The renderer path is large and currently spans multiple layers:

- hard projection math: `src/mono_ui/runtime/place_view_projection.ts`
- painter projection adapter: `src/ascii_painter/painter_view_projection_adapter.ts`
- camera UI / limits: `src/mono_ui/modules/place_camera_control_module.ts`, `src/mono_ui/runtime/camera_limits.ts`
- voxel scene defaults: `src/ascii_painter/voxel_space.ts`
- final DOM presentation: `src/ascii_painter/voxel_dom_renderer.ts`

The current bug report is not just “show more planes.” It is also that rotating to another principal view does **not** feel like a strict reorientation of the same authored volume. That means we must separate:

- **core projection correctness**
- **depth-window tuning**
- **visual enhancement transforms**

## Current observed architecture

### Hard authority that looks correct

`src/mono_ui/runtime/place_view_projection.ts` currently appears to be the main hard view authority for:

- principal view selection
- roll / swing state
- world -> projected `(u, v, plane)` mapping
- projected bounds
- unprojection back to world
- view-basis-driven movement helpers

This is the right place to treat as canonical.

### Consumer adapter that already depends on hard projection

`src/ascii_painter/painter_view_projection_adapter.ts` already uses the hard projection functions to:

- compute visible planes
- map world cells into projected slots
- compute focus slots and projected bounds
- map pointer/grid positions back to world cells

This is the best seam for unification because it already bridges authored voxel data into projected display space.

### Parallel visual transform layer

`src/ascii_painter/voxel_dom_renderer.ts` still applies a second major visual system:

- per-slot CSS `translate3d(...)`
- `scale(...)`
- `rotateX(...)`
- `rotateY(...)`
- `rotateZ(...)`
- depth-based parallax offsets

These transforms are useful for presentation, but they can also create the exact failure mode the user described if they effectively redefine angle/depth relationships after the hard projection has already decided them.

### Depth-window caps currently identified

Current depth caps are small and spread across multiple files:

- `src/ascii_painter/voxel_space.ts`
  - default `render_distance_planes: 2`
- `src/mono_ui/runtime/camera_limits.ts`
  - max `render_distance_planes: 8`
- `src/mono_ui/modules/place_camera_control_module.ts`
  - slider default range also caps at `8`
- `src/canvas_app/painter_app_state.ts`
  - comments / view-rect assumptions currently mention showing only `~17 layers`

So even the depth-only slice needs an audit, not just a one-line constant bump.

## Non-goals

For this pass, do **not**:

- rewrite all camera presentation code from scratch
- introduce arbitrary free-rotation geometry/view math
- remove all visual tilt/parallax polish
- merge every place/world/painter path into one giant renderer abstraction
- change shape semantics/tooling beyond what is required for projection correctness

## Success criteria

### Depth track success

- the camera UI can expose a meaningfully larger `render_distance_planes` range
- defaults are less shallow than today
- no hidden clamps or viewport assumptions silently truncate the new range
- painter/place view remains usable and performant at the new range

### Authority-alignment success

- changing principal view / roll produces a strict hard-projection reorientation of authored content
- DOM/CSS transforms remain presentation-only and do not redefine the principal view mapping
- pointer/world mapping stays consistent with what the user sees
- shape editing feels the same object seen from a different principal view, not a separate distorted mode

## Plan of attack

## Phase 0 — Instrumented audit before behavior change

### Objectives

Document the current authority boundaries and identify exactly which transforms are:

- required for hard correctness
- optional polish
- currently duplicating view logic

### Tasks

1. Trace the painter display pipeline end-to-end:
   - authored world cells
   - `project_painter_display_space(...)`
   - projected slots / bounds
   - DOM slot transforms in `VoxelDOMRenderer`
2. Identify where principal view orientation is expressed more than once.
3. Classify every `VoxelDOMRenderer` transform component as one of:
   - hard alignment
   - depth presentation
   - transition/polish
   - likely duplicate authority
4. Confirm whether place mode and painter mode use the same projection assumptions or only partially overlap.
5. Add only the smallest projection-authority checks needed before large renderer edits.

### Deliverables

- a short in-plan notes update naming the exact transforms to preserve vs retire
- a minimal list of projection-authority checks and visible-plane checks

## Phase 1 — Depth-window expansion as an isolated slice

### Objectives

Increase depth capacity without touching projection authority yet.

### Tasks

1. Raise `render_distance_planes` defaults and limits in the authoritative camera settings path:
   - `src/ascii_painter/voxel_space.ts`
   - `src/mono_ui/runtime/camera_limits.ts`
   - `src/mono_ui/modules/place_camera_control_module.ts` if any local defaults still diverge
2. Audit app-state sanitization and persistence paths to ensure the higher range survives:
   - `src/canvas_app/painter_app_state.ts`
3. Audit UI/window assumptions that currently hard-cap visible layer presentation:
   - layer list heights
   - comments / fixed rects / clipping assumptions
4. Validate that projected slot creation and display still behave for larger ranges.
5. Keep this phase behaviorally narrow: more planes, same authority model.

### Validation

- `npm run typecheck:core`
- any existing projection/view tests
- a manual smoke pass with larger depth values across multiple principal views

### Exit criteria

- we can safely inspect “deeper” scenes
- the original shallow-depth complaint is reduced even before renderer unification
- no new authority changes have been mixed into this slice

## Phase 2 — Lock the projection authority contract

### Objectives

Make explicit that `place_view_projection.ts` owns principal-view orientation, and keep only the minimum contract checks needed to simplify the renderer around it.

### Tasks

1. Define the contract clearly:
   - hard projection decides `(u, v, plane)`
   - unprojection must agree with that authority for projected plane coordinates
   - visible plane ordering comes from hard projection/view axis rules
2. Add only minimal authority tests such as:
   - canonical `project -> unproject` agreement for representative view states
   - basis vectors always map to screen right/up consistently
   - equivalent authored shapes retain expected extents across principal views
3. If needed, add a small documentation note near the projection runtime or README naming it the authority.

### Exit criteria

- we have a stable canonical baseline to compare renderer output against
- future renderer changes can be judged against explicit projection authority rules

## Phase 3 — Renderer authority separation

### Objectives

Refactor `VoxelDOMRenderer` so principal-view orientation comes from projected slots, not from an overlapping visual transform model.

### Key rule

After this phase, CSS transforms may enhance display, but they must **not** act as a second camera orientation system.

### Tasks

1. Review `calculateTransform(...)` in `src/ascii_painter/voxel_dom_renderer.ts` and split transform responsibilities into:
   - alignment / placement
   - transition tilt
   - optional parallax offset
   - optional scale treatment
2. Remove or gate any transform component that changes the effective principal-view orientation already established by the projected slots.
3. Ensure selected/focus slot remains the true reference plane.
4. Verify that non-focus layers differ only by depth presentation, not by a second angle definition.
5. Keep transition/spring effects only if they are strictly visual overlays and do not break pointer-to-world trust.

### Likely direction

The most likely safe direction is:

- projected slot contents and slot ordering continue to come from `painter_view_projection_adapter.ts`
- DOM renderer keeps:
  - placement
  - opacity
  - mild depth offset
  - transient transition tilt
- DOM renderer stops using broad orientation-defining `rotateX/rotateY/rotateZ` as a standing substitute for principal-view projection

This must be confirmed during Phase 0 rather than assumed blindly.

## Phase 4 — Consumer reconciliation and regression checks

### Objectives

Make sure editing, selection, shape preview, and camera behavior all still agree after renderer changes.

### Tasks

1. Validate pointer/grid/world mapping in painter interactions.
2. Validate shape preview/edit behavior across:
   - top/bottom
   - side views
   - roll states
3. Validate camera focus-slot behavior and centering behavior.
4. Validate onion skin / opacity / occlusion toggles still behave sensibly.
5. Check for regressions in place-mode consumers that share camera/view concepts.

## Implementation order

1. Phase 0 audit + invariant test additions
2. Phase 1 depth-window expansion
3. Phase 2 hard projection contract lock
4. Phase 3 renderer authority separation
5. Phase 4 regression validation

## Risks

### Risk: visual regression while fixing correctness

Removing orientation-defining CSS transforms may make the scene feel “flatter” temporarily.

**Mitigation:** keep presentation polish as a second pass only after hard correctness is stable.

### Risk: interaction/view mismatch

If renderer visuals change before pointer mapping is checked, the scene may look right while editing is wrong, or vice versa.

**Mitigation:** treat minimal projection-authority checks and pointer/world mapping as required validation gates.

### Risk: hidden secondary consumers

Some place/painter camera assumptions may exist outside the main files already reviewed.

**Mitigation:** repo search for projection, plane, slot, roll, swing, render-distance, and camera config consumers before Phase 3 edits.

## Recommended first implementation slice

**Start with Phase 0 + Phase 1 only.**

That means the first actual code change should be:

- add only the minimum projection-authority checks where missing
- raise depth defaults/limits/clamps
- audit any shallow-layer UI assumptions
- stop there and re-evaluate before touching `VoxelDOMRenderer` behavior

This keeps the work pointed at a single source of truth instead of layering on a patch refactor.

## Files currently in scope

- `src/mono_ui/runtime/place_view_projection.ts`
- `src/ascii_painter/painter_view_projection_adapter.ts`
- `src/ascii_painter/voxel_dom_renderer.ts`
- `src/ascii_painter/voxel_space.ts`
- `src/mono_ui/runtime/camera_limits.ts`
- `src/mono_ui/modules/place_camera_control_module.ts`
- `src/canvas_app/painter_app_state.ts`
- any directly related tests under `src/tests/` or runtime-specific test files

## Current implementation status

- [x] Minimal projection-authority checks expanded in `src/mono_ui/runtime/place_view_projection.test.ts`
- [x] Depth-window defaults/limits raised through the shared camera settings path
- [x] Painter runtime default depth margin aligned to `DEFAULT_CAMERA_VALUES.render_distance_planes`
- [x] First renderer authority separation slice in `src/ascii_painter/voxel_dom_renderer.ts`
- [ ] Consumer reconciliation after renderer refactor
- [ ] Follow-up decision on whether any persistent non-transition DOM rotation should remain at all

## Source of truth note

For this work, this plan is the active source of truth for both:

- render-depth expansion
- projection / renderer alignment

It should be updated rather than creating a second overlapping plan for the same renderer investigation.
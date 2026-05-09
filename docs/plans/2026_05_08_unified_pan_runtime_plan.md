# Unified Pan Runtime Plan

Date: 2026-05-08

## Intent

Define one shared pan architecture before implementation so global UI pan, local module pan, and 3D camera pan converge cleanly instead of continuing as separate legacy systems.

The goal is:

- one shared engine pan vocabulary
- one shared drag/session model for pan gestures
- one shared routing model for `Space + drag` and similar pan intents
- separate runtime ownership for viewport pan, module pan, and camera pan
- a real screen-locked overlay model
- explicit cleanup of old duplicated pan logic and stale naming

This plan is architecture-first and cleanup-first.

It is intended to cover:

- THAUMWORLD global mono-canvas UI pan
- THAUMWORLD place/local place-painter pan
- standalone ASCII painter pan
- 1D and 2D module scroll/pan behaviors
- screen-locked bars and overlays

---

## Problem Statement

Pan behavior currently exists in multiple overlapping systems with different semantics, coordinate spaces, gesture ownership rules, and persistence paths.

Observed issues:

1. global pan and local pan both exist but are not modeled as separate engine concepts
2. `Space + drag` ownership is partly runtime-specific and partly module-specific
3. place and painter maintain separate local pan systems with different storage and sign conventions
4. some modules implement one-off scroll/pan state instead of sharing a common contract
5. screen-locked UI is not represented as a first-class layout/render layer
6. inverse-pan compensation exists, but pinned UI still depends on the same globally panned render root
7. old pan fields and helpers remain distributed across modules instead of being intentionally categorized

This creates architectural risk:

- new pan features will copy old patterns
- gesture behavior will stay inconsistent between modules
- screen-locked UI will keep fighting global transforms
- local pan and camera pan will continue to overlap incorrectly
- cleanup will get harder the longer compatibility paths remain alive

---

## Architecture Thesis

The unification target is not one shared `pan_x/pan_y` state.

The correct unification target is:

- one shared pan type system
- one shared pan gesture/session protocol
- one shared pan target adapter contract
- one shared pan routing model
- one shared screen-locked layout contract
- separate runtimes for different ownership domains

Those domains are:

- viewport pan runtime
- module pan runtime
- 3D camera runtime

The engine owns pan mechanics.

Programs and modules own meaning.

That means:

- the engine decides how pan gestures start, continue, end, and clamp
- the engine decides how a pointer chooses a pan-capable target
- the engine standardizes axis rules, motion style, bounds, and persistence hooks
- modules decide whether they are a viewport, local pan surface, scroll surface, or camera-driven surface
- programs decide semantics like follow detachment, tool-specific pan policy, and screen-locking intent

---

## Locked Design Decisions

These are locked unless a later plan explicitly revises them.

### 1. Unify protocol, not storage

Global shell pan, 2D module pan, 1D scroll, and 3D camera pan should share one engine protocol family, but they must not be collapsed into one state bucket.

### 2. Three runtime families

Pan behavior is split into three primary runtime families:

- viewport pan
- module pan
- camera pan

Each family may use the same gesture/session and adapter contracts.

### 3. Global UI pan is not camera pan

Global pan moves the app presentation surface.

It should remain distinct from:

- local place/canvas panning
- document/content pan
- world/camera framing

### 4. Local flat pan is not world camera framing

1D/2D module pan is for flat content offsets.

3D or world-aware views should eventually express pan through camera-owned framing state, not through a second hidden camera truth.

### 5. `Space + drag` uses one router

Pan gesture ownership should be resolved through one shared router.

The router chooses the best pan-capable target under the pointer and only falls back to global viewport pan when no more-specific target should own the gesture.

### 6. Screen-locked UI is first-class

Pinned UI such as bottom bars, nav bars, HUD overlays, and similar chrome must be treated as screen-locked at the layout/runtime level.

They should not rely on ad hoc inverse-offset tricks as their final architecture.

### 7. Overlay layering beats compensation hacks

The preferred end state is separate render/layout roots for:

- world-pannable content
- screen-locked overlays

If temporary compensation remains during migration, it is transitional only.

### 8. Axis-limited pans are part of the same family

Vertical scroll, 2D content drag pan, and XY/Z camera movement should all use shared axis/capability concepts.

### 9. Cleanup is part of implementation, not optional follow-up

This migration is not complete until old pan helpers, duplicate gesture paths, stale naming, and legacy storage models are removed from hot paths.

---

## Shared Pan Model

The engine pan family should be split into clear buckets.

### A. Pan semantics

Owns:

- target kind
- axes enabled
- coordinate space
- motion style
- persistence policy
- whether manual pan detaches follow for camera-backed targets

### B. Pan session state

Owns:

- active gesture pointer
- drag start position
- last position
- accumulated delta
- source type
- capture/cancel lifecycle

### C. Pan application state

Owns:

- viewport offsets for viewport pan
- local content offsets for module pan
- frame-anchor/focus-plane changes for camera pan

### D. Pan layout mode

Owns:

- world-pannable vs screen-locked layer membership
- whether a module should visually move under viewport pan
- whether a module participates in pan bounds or ignores them

---

## Shared Pan Interfaces

### 1. Core types

Suggested file:

- `src/engine/pan/pan_types.ts`

Suggested concepts:

```ts
export type PanAxis = 'x' | 'y' | 'z';
export type PanSpace = 'screen_pixels' | 'screen_tiles' | 'module_cells' | 'world';
export type PanInputSource = 'drag' | 'wheel' | 'keyboard' | 'programmatic' | 'automation';
export type PanMotionStyle =
  | { kind: 'snap' }
  | { kind: 'smooth'; lerp: number }
  | { kind: 'inertial'; friction: number };
```

### 2. Gesture/session model

Suggested file:

- `src/engine/pan/pan_session.ts`

Suggested concepts:

- gesture begin
- gesture update
- gesture end
- gesture cancel
- pointer ownership
- session-local accumulated screen delta

### 3. Pan target adapter contract

Suggested file:

- `src/engine/pan/pan_target.ts`

Suggested contract shape:

```ts
export interface IPanTargetAdapter {
  getKind(): 'viewport' | 'module_2d' | 'camera_3d' | 'scroll_1d';
  getCapabilities(): PanCapabilities;
  beginGesture?(): void;
  endGesture?(): void;
  cancelGesture?(): void;
  applyScreenDelta?(dx: number, dy: number): void;
  applyAxisDelta?(delta: Partial<{ x: number; y: number; z: number }>): void;
  clamp?(): void;
  persist?(): void;
}
```

### 4. Pan gesture router

Suggested file:

- `src/engine/pan/pan_gesture_router.ts`

Suggested responsibilities:

- hit-test the module/view under the pointer
- resolve pan-capable target adapters
- prioritize local/module/camera pan before viewport fallback
- maintain capture for active pan session
- route wheel/key pan intents to the active pan session when appropriate

### 5. Screen-locked layout contract

Suggested files:

- `src/engine/layout/layered_module.ts`
- `src/engine/layout/screen_locked.ts`

Suggested concepts:

```ts
export type ModuleLayerMode = 'world_pannable' | 'screen_locked';
```

This can be a direct module capability or a runtime registration property.

---

## Runtime Families

### 1. Viewport pan runtime

Suggested file:

- `src/engine/pan/viewport_pan_runtime.ts`

Owns:

- global shell offset
- tile snapping rules
- viewport pan bounds
- screen-space persistence if desired
- broadcast of runtime pan changes to pannable consumers

This is the clean home for current global mono-canvas pan behavior.

### 2. Module pan runtime

Suggested file:

- `src/engine/pan/module_pan_runtime.ts`

Owns:

- local 1D/2D content offset
- content bounds and clamping
- persistence hooks
- generic axis-limited movement

This is the clean home for flat local pan/scroll surfaces.

### 3. Camera pan runtime

This should use the existing shared camera direction rather than introducing a second camera-pan engine.

For 3D views:

- XY pan moves `frame_anchor_world`
- Z pan changes `focus_plane`
- manual pan may detach follow depending on policy

The pan system should adapt into camera runtime requests instead of duplicating camera state.

---

## Pan Capability Model

Every pan-capable view or module should explicitly describe:

- which axes are enabled
- which coordinate space it uses
- whether it is screen-locked or world-pannable
- whether it supports gesture pan, wheel pan, key pan, or all three
- how it clamps
- how it persists
- whether manual pan has semantic side effects like follow detachment

This keeps behavior explicit instead of hidden in module-local event logic.

---

## Layering Model

### World-pannable root

Contains:

- normal content modules
- place/world panels
- windows or canvases that should visually move with viewport pan

### Screen-locked root

Contains:

- bottom bar
- overlay bar
- nav bar
- HUD-like chrome
- popups or overlays that should remain locked to screen

### Transitional rule

If a screen-locked module still temporarily uses inverse runtime pan compensation, that must be treated as migration glue, not target architecture.

---

## Implementation Status Snapshot

### Phase status

- [~] Phase 0: Naming freeze and behavior map
- [~] Phase 1: Build shared pan engine foundation
- [~] Phase 2: Wrap existing pan systems with adapters
- [~] Phase 3: Centralize pan gesture routing
- [ ] Phase 4: Introduce screen-locked layout mode
- [ ] Phase 5: Converge local pan semantics
- [ ] Phase 6: Remove transitional glue and legacy pan trash
- [ ] Phase 7: Validation and cleanup audit

### What is actually done

- shared pan engine foundation files now exist under `src/engine/pan/`
- runtime viewport pan adapter now exists
- place module pan adapter now exists
- painter canvas pan adapter now exists
- window/text-panel scroll now has a shared vertical scroll adapter seam
- character module body-area pan now has a shared flat module-pan adapter seam
- `floating_panel_module.ts` now exposes a reusable `get_pan_target_adapter` hook for panel-based modules
- `CanvasRuntime` now resolves pan through a shared router path instead of the older hard-coded painter/place/global `Space + drag` branches
- `CanvasRuntime` now treats screen-locked modules through explicit layer-mode-aware hooks instead of generic `setRuntimePanOffset(...)` / `isScreenLocked` naming
- `place_module.ts` now exposes a shared pan adapter over local view offsets
- `painter_canvas_module.ts` now exposes a shared pan adapter over local canvas pan
- place/painter hot paths no longer keep the old module-owned `Space + drag` gesture branches now that runtime pan routing owns them
- place painter keyboard-pan and standalone painter wheel/key pan now also route through shared pan adapter seams instead of separate local update branches
- place painter and standalone painter now share one `camera_3d` pan adapter implementation that converts drag/key pan into world-anchor camera movement
- `window_module.ts` now routes wheel/drag scroll through a shared adapter surface
- `character_module.ts` now routes body-pan clamping through a shared adapter-aligned seam and exposes a pan target to runtime routing
- `screen_overlay_bar_module.ts` now advertises `screen_locked` layer mode and runtime-owned viewport compensation hooks
- a first shared pan router test now exists in `src/engine/pan/pan_gesture_router.test.ts`

### What is still not done

- screen-locked overlays now declare explicit `screen_locked` layer mode and runtime-owned screen-locked viewport compensation hooks
- global viewport pan is now unbound across both programs; screen-locked overlays compensate against pan instead of constraining it
- generic 1D/2D module pan surfaces are only partially migrated onto shared adapters in hot paths
- place and painter still have broader local pan/camera cleanup remaining, but the old duplicated `Space + drag` ownership branches are no longer in hot paths
- screen-locked overlays still use compensation inside the mono-canvas path rather than a true separate render root
- repo-wide old-pan-trash cleanup and stale naming audit are not complete

## Current-to-Target Mapping

### Current global UI pan

Current shape:

- `src/mono_ui/runtime/canvas_runtime.ts`
- CSS transform over mono canvas
- tile-locked offsets
- runtime-specific drag ownership logic

Target shape:

- shared viewport pan runtime
- routed through shared pan gesture router
- only affects world-pannable root
- no direct burden on screen-locked overlays

### Current place/local place-painter pan

Current shape:

- `src/mono_ui/modules/place_module.ts`
- `view.offset_x`
- `view.offset_y`
- local key pan, local drag pan, local persistence

Target shape:

- short term: wrapped by a place module pan adapter
- longer term: place painter and place camera paths should converge toward camera/runtime-authored framing semantics where appropriate
- gesture ownership must come from the shared router, not special-case module/runtime branching

### Current standalone painter pan

Current shape:

- `src/mono_ui/modules/painter_canvas_module.ts`
- local `camera.pan_x/pan_y`
- module-owned drag pan and other local pan paths

Target shape:

- short term: wrapped by a painter pan adapter
- longer term: prefer camera runtime frame-anchor semantics over isolated local pan truth
- use shared router and capability model

### Current 1D/2D module scrolls

Current shape:

- one-off `scroll_y` and similar fields in modules like `window_module.ts`
- custom clamp and input handling

Target shape:

- generic module-pan or scroll adapters
- axis-limited pan capability declarations
- shared gesture/key/wheel routing where relevant

### Current screen-locked bars

Current shape:

- compensation against runtime pan while still effectively coupled to the globally panned render plane

Target shape:

- explicit screen-locked layer mode
- separate render/layout ownership from pannable content
- no dependence on old compensation tricks in final hot path

---

## File and Module Plan

### Shared engine files

Add:

- `src/engine/pan/pan_types.ts`
- `src/engine/pan/pan_session.ts`
- `src/engine/pan/pan_target.ts`
- `src/engine/pan/pan_gesture_router.ts`
- `src/engine/pan/viewport_pan_runtime.ts`
- `src/engine/pan/module_pan_runtime.ts`
- `src/engine/pan/pan_bounds.ts`
- `src/engine/pan/pan_motion.ts`
- `src/engine/layout/layered_module.ts`
- `src/engine/layout/screen_locked.ts`

### Runtime adapter files

Add:

- `src/mono_ui/runtime/adapters/runtime_viewport_pan_adapter.ts`

### Module adapter files

Add:

- `src/mono_ui/modules/adapters/place_module_pan_adapter.ts`
- `src/mono_ui/modules/adapters/painter_canvas_pan_adapter.ts`
- `src/mono_ui/modules/adapters/vertical_scroll_pan_adapter.ts`
- `src/mono_ui/modules/adapters/window_pan_adapter.ts`

### Existing migration hotspots

Primary hotspots:

- `src/mono_ui/runtime/canvas_runtime.ts`
- `src/mono_ui/runtime/dom_viewport.ts`
- `src/mono_ui/modules/place_module.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`
- `src/mono_ui/modules/screen_overlay_bar_module.ts`
- `src/mono_ui/modules/program_nav_bar_module.ts`
- `src/mono_ui/modules/window_module.ts`

Secondary hotspots:

- `src/mono_ui/modules/character_module.ts`
- `src/mono_ui/modules/place_camera_control_module.ts`
- `src/canvas_app/app_state.ts`
- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/runtime/automation_interfaces.ts`
- `src/canvas_app/painter_tool_assisted_inputs_wiring.ts`

---

## Migration Strategy

### Phase 0: Naming freeze and behavior map

Before implementation:

- freeze vocabulary:
  - viewport pan
  - module pan
  - camera pan
  - screen-locked
- inventory all current pan/scroll fields and gesture entry points
- inventory all modules that should be screen-locked vs world-pannable
- identify all duplicated `Space + drag` logic

Required output:

- one current-state table of pan owners and gesture paths
- one cleanup checklist of legacy pan fields/helpers to remove later

### Phase 1: Build shared pan engine foundation

Add:

- shared pan types
- session types
- target adapter contract
- bounds helpers
- motion helpers
- basic viewport and module pan runtime helpers

Do not yet rewrite all modules.

Goal:

- create the shared engine seam first

### Phase 2: Wrap existing pan systems with adapters

Create adapters around current storage models rather than rewriting them immediately.

Expected wrappers:

- viewport/global pan adapter over runtime shell pan
- place module pan adapter over `view.offset_x/y`
- painter canvas pan adapter over current local pan state
- scroll/window adapters over existing 1D/2D scroll fields

Goal:

- get every pan-capable area speaking one contract before changing deep ownership

### Phase 3: Centralize pan gesture routing

Refactor `canvas_runtime.ts` so pan gesture ownership resolves through the shared router.

Move away from scattered rules like:

- special painter branch
- special blank-space branch
- ad hoc module drag checks

Target behavior:

- pan-capable target under pointer wins
- viewport/global pan is fallback
- active pan session owns subsequent drag updates

### Phase 4: Introduce screen-locked layout mode

Add explicit runtime/layout support for:

- `world_pannable`
- `screen_locked`

Then migrate:

- `screen_overlay_bar_module.ts`
- `program_nav_bar_module.ts`
- any other pinned overlays

Goal:

- pinned UI no longer depends on shared panned-root compensation as final architecture

### Phase 5: Converge local pan semantics

After adapters and routing exist, clean up storage semantics.

Expected targets:

- standalone painter local pan should increasingly route through shared camera framing where appropriate
- in-game place painter pan should align with camera/runtime semantics instead of remaining a separate pan island
- one-off module scroll/pan logic should move behind shared module-pan helpers

Goal:

- old per-module pan logic stops being architectural truth

### Phase 6: Remove transitional glue and legacy pan trash

Required removals include any temporary or duplicated systems left from older behavior.

Examples to audit/remove:

- duplicated `Space + drag` ownership branches
- duplicate clamp helpers that only exist because there was no shared pan runtime
- stale `global_pan_offset` compatibility logic that is no longer meaningful
- inverse-offset hacks that were only needed because screen-locked layering was missing
- old module-local pan methods that are now adapter internals or dead
- stale naming like generic `camera target` wording where the real behavior is module pan or viewport pan

This phase is mandatory.

### Phase 7: Validation and cleanup audit

Validate:

- drag pan ownership
- wheel pan/scroll ownership
- key pan ownership
- screen-locked overlay stability during viewport pan
- place and painter local pan correctness
- camera follow detachment on manual pan where intended
- persistence behavior
- automation/debug/runtime probe semantics

Then do a final repo audit for stale pan naming and dead helper paths.

---

## Migration Rules

### Rule 1

Do not introduce a new shared pan system by wrapping old module-specific gesture logic forever.

Temporary adapters are allowed.

Permanent duplicate gesture ownership is not.

### Rule 2

Do not treat screen-locked compensation hacks as the final solution.

They may stabilize migration briefly, but the target architecture is explicit layered ownership.

### Rule 3

Do not overload camera pan and flat content pan into one ambiguous field.

If the target is a 3D/world-aware camera, use camera-owned framing semantics.

If the target is a flat scroller/panner, use module-pan semantics.

### Rule 4

Do not leave per-module sign conventions undocumented.

The shared adapter contract should make movement direction explicit and testable.

### Rule 5

Do not leave automation/debug/persistence surfaces behind on stale names after migration.

Those surfaces are part of the architecture and must be updated too.

---

## Required Cleanup Audit

This migration should explicitly audit for and remove:

- duplicated pan state with overlapping authority
- mixed coordinate-space pan math hidden in modules
- old runtime-to-module pan compensation paths that become dead after layering changes
- stale global-pan assumptions inside local modules
- stale local-pan assumptions inside global runtime
- obsolete screen-locked offset correction code
- dead callback/config fields after router adoption
- old comments that preserve incorrect mental models

This is the "old pan trash" removal phase and should be treated as first-class work.

---

## Required Testing

### Shared engine tests

Add tests for:

- pan bounds clamping
- axis-limited delta application
- session begin/update/end/cancel behavior
- router target priority and fallback behavior

### Viewport/runtime tests

Validate:

- global pan still tile-snaps correctly
- screen-locked modules remain stable while pannable modules move
- blank-space drag falls back to viewport pan only when appropriate

### Module integration tests

Validate:

- place local drag pan
- place local key pan
- painter local drag pan
- 1D scroll modules using shared adapter semantics
- wheel/key/drag ownership consistency

### Camera-adjacent tests

Validate:

- manual painter/place pan detaches follow only where intended
- camera anchor/framing remains correct after pan-router integration

### Cleanup validation

Search for stale terms and old ownership seams after migration.

Examples:

- duplicated `Space + drag` logic
- stale screen-lock compensation hooks
- dead pan config callbacks
- old module-local pan helpers no longer referenced

---

## Anti-Goals

This plan does not intend to:

- collapse all pan systems into one global offset state
- make every module pretend to be a 3D camera
- redesign all input architecture from scratch beyond what pan routing needs
- force immediate full camera-anchor migration for every local pan surface in the first slice
- preserve compatibility glue as permanent architecture

---

## Success Criteria

This plan is successful when:

- global viewport pan, local module pan, and camera pan share one engine vocabulary
- `Space + drag` ownership is resolved through one shared router
- pinned UI is explicitly screen-locked and does not drift/break under viewport pan
- 1D scroll and 2D pan modules can use shared axis/capability contracts
- place and painter no longer depend on duplicated pan ownership logic as architecture
- old pan helpers, stale naming, and dead compatibility paths are removed from hot paths
- new modules have a clear standard for choosing viewport pan, module pan, or camera pan

---

## Recommended Execution Order

1. Write and lock this plan
2. Inventory current pan owners and stale cleanup targets
3. Build shared pan engine foundation
4. Add adapters around current pan systems
5. Centralize gesture routing in runtime
6. Introduce explicit screen-locked layering
7. Converge place/painter/module semantics
8. Remove transitional glue and old pan trash
9. Validate and do repo-wide cleanup audit

---

## Relationship To Existing Camera Plan

This plan complements `docs/plans/2026_05_08_module_3d_camera_engine_plan.md`.

The camera plan defines how 3D/world-aware camera state should be owned.

This pan plan defines how all pan-like movement behaviors should share:

- vocabulary
- gesture sessions
- adapters
- routing
- layering

The two plans should align on a key rule:

- flat module pan is not the same thing as world camera framing
- but both should still participate in one shared engine family for pan mechanics

# Module 3D Camera Engine Plan

Date: 2026-05-08

## Intent

Define and implement one shared 3D camera engine contract for multiple programs and modules without collapsing them into one app-specific camera.

The goal is:

- one engine-level camera architecture
- one clean per-module camera runtime shape
- two programs using that shared engine contract
- no legacy helper layer preserved in hot paths
- no overloaded `camera_target` catch-all model

This plan is backend architecture first.

It is intended to support:

- THAUMWORLD gameplay place view
- THAUMWORLD in-game place painter
- standalone ASCII painter
- future 3D or hybrid modules

---

## Problem Statement

Current camera behavior is split across multiple layers and naming eras.

Observed issues:

1. camera subject selection is app-owned in some places and interaction-owned in others
2. frame centering is partly state-driven and partly render-loop-driven
3. focus plane is not consistently first-class across the systems
4. follow behavior is distributed instead of camera-owned
5. older naming still assumes `actor follow` rather than generalized subject focus
6. some camera state is still stored through overloaded target fields
7. the game place view and painter already have overlapping concepts but do not share one standard camera runtime

This creates backend risk:

- camera ownership is harder to reason about
- new modules may copy the wrong patterns
- behavior changes require touching multiple layers
- app glue can accidentally become permanent architecture
- legacy compatibility state can leak into new systems

---

## Architecture Thesis

The unification target is not one shared `camera_target` variable.

The correct unification target is:

- one shared camera engine contract
- one shared camera state machine
- one shared follow-policy model
- one shared motion-style model
- one shared projection-facing output contract
- one camera instance per 3D module/view
- thin program-specific resolvers and policy presets on top

Programs own meaning.

The camera engine owns camera behavior.

That means:

- programs decide what subject should matter
- programs provide subject resolution logic
- the camera decides how framing, following, detaching, plane control, and motion work

---

## Locked Design Decisions

These are locked unless a later plan explicitly revises them.

### 1. Per-module camera ownership

Every 3D or hybrid render module owns its own camera instance.

Examples:

- THAUMWORLD place view camera
- THAUMWORLD place painter camera
- standalone ASCII painter camera

No app-global camera state should directly drive multiple modules with different semantics.

### 2. Subject is semantic, not framing

A camera subject is the semantic point of interest.

Examples:

- active character
- logged-in actor
- place center
- document center
- text cursor
- tool anchor
- explicit world point

Subject is not the same as the current frame anchor.

### 3. Frame anchor is first-class

The frame anchor is the world-space point the viewport is currently framed around.

It is camera-owned.

It is changed by:

- recentering
- follow enforcement
- manual pan
- direct camera commands

Viewport size affects projection math but does not itself define frame anchor.

### 4. Focus plane is first-class

Focus plane is camera-owned depth state in the current oriented view.

It must not remain hidden inside overloaded target storage.

Subject may imply an initial plane.

Manual depth changes must be allowed without destroying subject.

### 5. Follow is camera-owned

Only the camera runtime may enforce follow behavior.

External systems may request:

- set subject
- recenter on subject
- set follow policy
- set motion style
- set plane

External systems must not implement their own competing follow loops.

### 6. Manual camera input may detach follow without clearing subject

This is a core rule.

The camera should support:

- focus a subject
- let the user pan/depth freely
- preserve the subject for return/recenter/resume-follow later

### 7. Follow policy and motion style are separate

These are different concerns.

- follow policy = when and whether the camera follows
- motion style = how camera movement is animated

Examples:

- `snap_once` + `snap`
- `track` + `smooth`
- `track_until_manual_pan` + `spring`

### 8. Pointer target is not camera subject by default

Hover, selection, interaction targets, and camera subject are separate concepts.

They may interact through explicit policy, not by accidental shared storage.

### 9. No legacy helper preservation as architecture

This implementation should not keep old helper layers alive as permanent glue.

If an older helper only exists to bridge from the old model to the new one, it should be temporary and removed before the migration is considered complete.

The target architecture must be clean in the final state.

---

## Shared Camera Model

The engine camera should be split into clear buckets.

### A. Semantic state

Owns:

- `subject`
- `follow_policy`
- `follow_active`
- `last_resolved_subject_world`

### B. Framing state

Owns:

- `frame_anchor_world`
- `focus_plane`
- `orientation`
- `viewport`

### C. Presentation state

Owns:

- `motion_style`
- `transition_state`
- optional projection tuning

This keeps semantics, framing, and presentation separate.

---

## Shared Camera Interfaces

The implementation should converge on these engine buckets.

### 1. Camera subject types

The camera engine should support semantic subject variants such as:

- none
- entity ref
- explicit world point
- place center
- document center
- tool anchor
- text cursor

Program-specific additions may exist, but the shared shape should remain standardized.

### 2. Subject resolver interface

Programs must provide a subject resolver.

Responsibilities:

- resolve a semantic subject into world coordinates
- optionally provide preferred focus-plane hints
- remain program-specific

Examples:

- THAUMWORLD resolves `actor.*`, `npc.*`, `place_center`
- ASCII painter resolves `text_cursor`, `tool_anchor`, `document_center`

### 3. Camera core interface

The shared camera runtime should own methods for:

- `setSubject(...)`
- `clearSubject()`
- `setFollowPolicy(...)`
- `setMotionStyle(...)`
- `recenterOnSubject(...)`
- `setFrameAnchor(...)`
- `panFrameBy(...)`
- `setFocusPlane(...)`
- `stepFocusPlane(...)`
- `setOrientation(...)`
- `setViewport(...)`
- `notifyManualPan()`
- `notifyManualDepthChange()`
- `notifyManualCameraInput()`
- `tick(...)`
- `getProjectionView()`

### 4. Projection-facing output interface

Render modules should consume camera output through a standard projection view shape.

That output should include:

- `frame_anchor_world`
- `focus_target_world`
- `focus_plane`
- `orientation`
- `motion_style`
- `transition_state`
- `viewport`

This lets modules consume camera results without owning camera behavior.

### 5. Optional persistence adapter

Where persistence is needed, it should sit behind a camera persistence interface.

This adapter may persist:

- frame anchor
- focus plane
- orientation
- motion settings
- subject if appropriate

Persistence must not redefine core camera semantics.

---

## Follow Policy Model

The engine should standardize follow policies like:

- `detached`
- `snap_once`
- `track`
- `track_until_manual_pan`
- `track_until_manual_depth`
- `track_until_any_manual_camera_input`

The camera core must implement detachment behavior internally.

External callers should not reimplement these semantics.

---

## Motion Style Model

The engine should standardize motion styles like:

- `snap`
- `smooth`
- `spring`

The motion style applies whenever the camera chooses to move.

This includes:

- subject recentering
- active follow updates
- explicit camera recenter commands
- view transition handoffs where appropriate

---

## Program Policy Profiles

Programs should not hardcode follow behavior ad hoc.

They should define policy presets using the shared camera engine.

### THAUMWORLD gameplay place view

Required behavior:

- turn start: focus active character, actor or npc
- world sim: focus logged-in actor
- manual pan/depth: detach follow according to policy but preserve subject

Likely presets:

- turn start: `snap_once` + `snap`
- world sim: `track_until_any_manual_camera_input` + `smooth`

### THAUMWORLD in-game place painter

Required behavior:

- on boot or place change: center on current place
- after that: detached/free
- no persistent actor follow
- subject may still exist for future recenter behavior

Likely preset:

- place boot/change: `snap_once` + `snap`
- then `detached`

### Standalone ASCII painter

Required behavior:

- boot: center on document or restored camera state
- text mode may track text cursor if chosen by tool policy
- normal editing may remain detached
- manual depth changes preserve subject

Likely presets:

- boot: `snap_once` + `snap`
- text tool: `track_until_manual_pan` + `smooth`
- ordinary editing: `detached`

---

## Architecture Boundaries

### Engine-owned

The camera engine owns:

- camera state buckets
- follow-policy state machine
- motion-style application
- frame-anchor movement
- manual detach behavior
- focus-plane state
- projection-facing camera output contract

### Program-owned

Programs own:

- semantic subject choice
- subject resolution implementation
- policy preset selection
- persistence wiring
- module-specific recenter commands
- domain-specific hotkeys and tool semantics

### Module-owned

Each render module owns:

- viewport geometry
- projection/build logic consuming camera output
- render details
- module-local UI controls for camera commands

Modules do not own generalized follow logic.

---

## Implementation Status Snapshot

Status as of 2026-05-08 later pass.

### Phase status

- [x] Phase 0: Preparation and naming freeze
- [x] Phase 1: Build the shared camera engine core
- [x] Phase 2: Add subject resolver adapters
- [~] Phase 3: Integrate THAUMWORLD gameplay place camera
- [~] Phase 4: Integrate THAUMWORLD place painter camera
- [~] Phase 5: Integrate standalone ASCII painter camera
- [ ] Phase 6: Remove transitional glue and old camera helpers
- [~] Phase 7: Validation and cleanup

### What is actually done

- Shared engine camera files exist under `src/engine/camera/` and the core test passes.
- THAUMWORLD resolver and policy adapters exist under `src/thaumworld/camera/`.
- ASCII painter resolver and policy adapters exist under `src/ascii_painter/camera/`.
- `src/canvas_app/app_state.ts` now creates a real shared `place_camera` runtime and drives subject/policy through that runtime.
- `src/mono_ui/modules/place_module.ts` now consumes runtime camera anchor state instead of owning the main follow policy loop.
- THAUMWORLD in-game painter boot behavior has been shifted to place-center bootstrap plus detached camera behavior.
- `src/canvas_app/painter_app_state.ts` now creates a real shared painter camera runtime and uses camera-owned frame-anchor and focus-plane state.
- Standalone painter text-cursor camera policy is explicit and now receives movement/change callbacks from `src/mono_ui/modules/painter_canvas_module.ts`.
- Automation `get_camera_target` for the standalone painter now maps to frame anchor semantics.

### What is still not done

- THAUMWORLD gameplay still keeps legacy compatibility state in `ui_state.place.camera_target` and still has legacy helper naming such as `resolve_follow_actor_camera_focus_region(...)` in `src/canvas_app/app_state.ts`.
- Standalone painter still has transitional helper naming in hot paths, especially around `getPainterFallbackTargetWorld()`, `getCurrentFocusWorldPlane()`, and `refreshPainterProjectionPreservingCurrentTarget()`.
- Final removal of old helper layers, old naming, and temporary bridges has not happened yet.
- Integration-test coverage described below is not complete; current validation is still mostly focused on `src/engine/camera/camera_core.test.ts` plus targeted searches/checks.
- Full project typecheck is still blocked by pre-existing unrelated errors.

### Current interpretation

This migration is past the architecture-proof stage and into cleanup/convergence.

The shared engine is real.
The THAUMWORLD place path is mostly migrated but not fully cleaned.
The standalone painter is meaningfully migrated but not yet vocabulary-clean.

So the project is roughly at:

- engine/adapters: complete enough for use
- gameplay/place integration: mostly complete
- in-game painter integration: mostly complete behaviorally
- standalone painter integration: mostly complete structurally, still mid-cleanup
- removal/final audit: not complete

## Implementation Strategy

This is a significant backend change and should be implemented in phases.

The phases below are ordered to reduce churn and avoid preserving the wrong architecture.

### Phase 0: Preparation and naming freeze

Before implementation:

1. freeze the target vocabulary
2. stop introducing new `camera_target`-style helpers
3. stop introducing new actor-specific follow naming
4. identify all camera-entry points in the three target contexts

Deliverables:

- final shared naming list
- migration map from old concepts to new concepts
- implementation checklist tied to modules/files

### Phase 1: Build the shared camera engine core

Create the engine camera bucket with no app-specific knowledge.

Deliverables:

- camera types
- camera state shape
- camera subject request shape
- follow-policy implementation
- motion-style implementation
- camera core runtime
- projection-view output shape

Requirements:

- no THAUMWORLD-specific imports
- no painter-specific imports
- no compatibility shims in the core API

### Phase 2: Add subject resolver adapters

Create resolver adapters per program.

Deliverables:

- THAUMWORLD place resolver
- ASCII painter resolver
- shared tests for resolver contracts where appropriate

Requirements:

- resolvers may depend on program state
- camera core may not depend on program state

### Phase 3: Integrate THAUMWORLD gameplay place camera

Replace current gameplay place follow ownership with the engine camera instance.

Target outcomes:

- active character and logged-in actor become semantic subject requests
- place module consumes camera projection output rather than owning follow behavior
- render loop no longer performs direct follow recenter logic outside camera runtime
- `follow_actor` terminology is removed from the final state

Requirements:

- do not preserve old app-state follow loops as permanent wrappers
- remove replaced helpers after migration
- final place camera path should be engine-first

### Phase 4: Integrate THAUMWORLD place painter camera

Create a distinct camera instance or module-owned camera profile for the in-game painter.

Target outcomes:

- boot/place-change centering comes from place-center subject request
- painter free pan updates frame anchor through camera commands
- focus plane becomes camera-owned rather than inherited accidentally from gameplay paths
- actor-seeded painter boot centering is removed

Requirements:

- painter path must not depend on gameplay follow semantics
- no fallback to old place follow logic in painter mode

### Phase 5: Integrate standalone ASCII painter camera

Migrate standalone painter to the engine camera contract.

Target outcomes:

- explicit camera core owns frame anchor and focus plane
- current good separation between framing anchor and focus-driving target is preserved
- overloaded `painter_camera_target_world` storage is eliminated or split cleanly
- text cursor tracking becomes a tool policy, not ad hoc camera storage coupling

Requirements:

- do not retain legacy compatibility camera state in the final hot path
- the final painter camera state should be readable in the shared camera vocabulary

### Phase 6: Remove transitional glue and old camera helpers

This phase is mandatory.

The migration is not complete until superseded helpers are removed.

Deliverables:

- remove old actor-follow naming helpers
- remove overloaded target-only camera storage where replaced
- remove temporary bridging wrappers
- remove dead persistence bridges
- update call sites to the final interface only

This project explicitly does not want legacy helpers preserved.

### Phase 7: Validation and cleanup

Deliverables:

- tests
- doc updates
- code search audit to confirm old vocabulary is gone where intended
- final ownership audit across modules

---

## Migration Rules

These rules must be followed during implementation.

### Rule 1

Do not create a new permanent compatibility layer that simply renames old fields while preserving old architecture underneath.

### Rule 2

Do not leave both old and new camera runtimes active in the same hot path.

### Rule 3

Temporary adapters are allowed only when they are:

- narrow
- local
- explicitly transitional
- removed before completion

### Rule 4

The shared engine camera should be the only runtime responsible for follow enforcement in migrated paths.

### Rule 5

If a module still needs old camera data during migration, the data should be derived from the new camera runtime, not the other way around, and only temporarily.

---

## File and Module Plan

Exact file names may shift, but the implementation should converge on buckets like these.

### Shared engine

Potential bucket:

- `src/engine/camera/`

Potential files:

- `camera_types.ts`
- `camera_subject.ts`
- `camera_policy.ts`
- `camera_motion.ts`
- `camera_core.ts`
- `camera_projection_contract.ts`
- `camera_persistence.ts`

### THAUMWORLD adapters

Potential bucket:

- `src/thaumworld/camera/`
  or another app-appropriate folder if a different program boundary is preferred

Potential files:

- `place_camera_resolver.ts`
- `place_camera_policy.ts`
- `place_painter_camera_policy.ts`

### ASCII painter adapters

Potential bucket:

- `src/ascii_painter/camera/`
  or another app-appropriate folder if painter runtime camera adapters live elsewhere

Potential files:

- `painter_camera_resolver.ts`
- `painter_camera_policy.ts`

The important point is bucket separation, not the exact folder name.

---

## Current-to-Target Mapping

This mapping should guide implementation.

### Current game place camera

Current concepts:

- `camera_target.mode`
- `camera_target.tile`
- `camera_target.region_pose`
- `follow_actor`
- `world_z_center`
- render-loop centering

Target concepts:

- `subject`
- `follow_policy`
- `frame_anchor_world`
- `focus_plane`
- `orientation`
- camera-core-owned recenter/follow

### Current in-game painter camera

Current concepts:

- free target tile written from viewport center
- painter mode disabling gameplay follow
- inherited current place focus z behavior

Target concepts:

- place-painter camera instance
- place-center bootstrap subject
- detached frame anchor after bootstrap
- camera-owned focus plane

### Current standalone painter camera

Current concepts:

- `painter_camera_target_world`
- `setCurrentFocusWorldPlane(...)`
- `refreshPainterProjectionPreservingCurrentTarget()`
- frame-anchor/target split in projection inputs
- optional center-target behavior for text cursor

Target concepts:

- explicit engine camera framing state
- explicit engine camera focus plane state
- explicit camera subject requests from tool policy
- preserved projection contract with standardized naming

---

## Required Testing

This architecture should not be considered complete without backend tests.

### Shared camera core tests

Must cover:

- subject set and resolve
- snap-once behavior
- continuous track behavior
- detach on manual pan
- detach on manual depth change
- motion-style application
- plane preservation when subject changes under non-forcing policy
- subject preservation after detach

### THAUMWORLD integration tests

Must cover:

- turn start focuses active npc or actor correctly
- world sim focuses logged-in actor correctly
- manual pan detaches follow but preserves subject
- place change respects selected policy
- place painter boot centers on place rather than actor

### Painter integration tests

Must cover:

- boot centering
- depth stepping preserves subject
- text-mode tracking policy behavior
- free pan behavior after detach
- projection output stability across orientation changes

---

## Anti-Goals

This plan does not intend to:

- unify all rendering code into one module
- make game and painter use identical domain logic
- force one camera instance across unrelated modules
- preserve old actor-follow architecture behind renamed wrappers
- keep legacy helpers alive for convenience in final design

---

## Success Criteria

This effort is successful when all of the following are true.

1. camera behavior is understandable through one shared vocabulary
2. follow behavior is owned by the camera engine in migrated paths
3. each 3D module/view owns its own camera instance
4. THAUMWORLD gameplay, THAUMWORLD place painter, and standalone painter all use the same camera contract
5. subject, frame anchor, and focus plane are cleanly separated
6. follow policy and motion style are cleanly separated
7. pointer target and camera subject are not conflated by default
8. old helper layers are removed from final hot paths
9. future 3D modules can adopt the camera engine without copying app glue

---

## Recommended Execution Order

Implementation should proceed in this order:

1. finalize camera vocabulary and core interfaces
2. build shared engine camera core with tests
3. integrate THAUMWORLD gameplay place camera
4. integrate THAUMWORLD place painter camera
5. integrate standalone ASCII painter camera
6. remove temporary adapters and old helpers
7. run final audit for vocabulary, ownership, and dead code

This order ensures the highest-risk backend ownership problem is solved first and that later integrations build on the same engine contract instead of inventing fresh glue.

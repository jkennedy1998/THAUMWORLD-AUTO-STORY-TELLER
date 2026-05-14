# Parametric Shape Tool Plan

Date: 2026-05-12

## Intent

Add a new painter `shape` tool that becomes the main proving ground for the shared geometry seam before wider gameplay adoption.

This tool should let the user place and edit **3D volume primitives** from compact analytic parameters, preview them live, and rasterize them into outline or fill voxel sets.

It should also establish the repo's clean separation between:

- **volume primitives**
- **stroke primitives**
- **analytic shape specs**
- **raster outputs**
- **editor/session state**

## Scope

This plan is specifically for the **ASCII painter / painter UI implementation path first**.

It is a consumer-facing follow-on to:

- `docs/plans/2026_05_12_geometry_encapsulation_plan.md`

That geometry plan remains the canonical shared seam plan.
This document is the canonical **shape tool consumer plan**.

The rollout order is:

1. make the shared shape system fully work in the ASCII painter
2. remove dependence on legacy painter shape flows there
3. only then bring the place painter/game-side editor onto the same shape-session model

The place painter is intentionally **not** the lead consumer for this work.
It should adopt the ASCII-painter-proven system later through unification, not through a parallel implementation.

## Core Decision

The new `shape` tool should own **volume primitive placement and editing**.

It should not try to absorb stroke/vector drawing yet.

### Volume primitives in scope

- `box`
- `sphere`
- `cylinder`
- `cone`

### Stroke primitives explicitly out of scope for this tool slice

- `line`
- future polyline / curve / brush-vector paths

Lines should remain part of a future **stroke/vector** tool family that can later reuse the same raster backends.

## Why

The painter is now the safest place to stress-test the shared geometry seam because it already exercises:

- 2D and 3D rasterization
- projected-to-world mapping
- selection/world conversion
- preview rendering
- property-driven tool behavior

A parametric shape tool will validate whether the new shared geometry direction is good enough before gameplay/perception/LOS start depending on it more heavily.

## Product Goal

The user should be able to:

1. choose `shape`
2. choose a primitive in properties
3. place a live preview in the world
4. adjust primitive parameters after placement
5. nudge / swing / roll while still in shape mode
6. rasterize as outline or fill
7. commit or cancel

This should feel like a minimal text-mode version of Blender's "adjust last operation" workflow, without requiring a full retained procedural-object scene system.

## Non-Goals

This slice should **not**:

- create permanent procedural scene objects
- replace all existing stroke/brush tools
- solve arbitrary freeform curve authoring
- make gameplay LOS depend on unfinished shape APIs yet
- over-design final geometry APIs before first consumer validation
- force place painter/game adoption before ASCII painter shape behavior is complete

## Shape Family Split

The repo should explicitly separate:

### A. Volume primitives

These are closed 3D solids.
They rasterize to:

- fill / volume voxels
- surface / outline voxels

### B. Stroke primitives

These are vector paths.
They rasterize to:

- path voxels
- later brush-stamped paths
- later tube/swept volume variants if desired

This plan covers **A** only.

## Primitive Specs

The new shared volume specs should be analytic and minimal.

### Box

Preferred long-term spec:

```ts
{
  kind: 'box';
  center: Vec3;
  size: Vec3;
  orientation: Basis3;
}
```

Notes:
- if needed, the first implementation may temporarily use an axis/discrete-basis aligned box path
- long-term target is not axis-only boxes

### Sphere

```ts
{
  kind: 'sphere';
  center: Vec3;
  radius: number;
}
```

### Cylinder

```ts
{
  kind: 'cylinder';
  start_center: Vec3;
  end_center: Vec3;
  radius: number;
}
```

### Cone

```ts
{
  kind: 'cone';
  tip: Vec3;
  base_center: Vec3;
  base_radius: number;
}
```

## Render Modes

Volume shapes should support at least:

- `outline`
- `fill`

Semantically:

- `fill` = all occupied voxels
- `outline` = surface voxels / shell voxels

Important: `outline` should be understood as a **3D surface shell**, not just a 2D edge.

## Shape Editing Model

Use a temporary **shape session** instead of immediately baking the operation beyond editability.

### Recommended session shape

```ts
type ActiveShapeSession = {
  primitive: 'box' | 'sphere' | 'cylinder' | 'cone';
  render_mode: 'outline' | 'fill';
  transform: Transform3Like;
  params: ShapeParams;
  editing_state: {
    committed_preview: boolean;
    anchor_mode: 'seeded' | 'centered';
  };
};
```

This is intentionally schematic.
The exact TS contract can be finalized during implementation.

### Key rule

The shape session is **editor state**, not geometry ownership.

- `geometry/` owns shape specs and rasterization
- painter app state owns the active shape session
- painter UI modules own interaction and preview plumbing

## Transform Direction

## Important distinction

The project's current swing/roll/view system already gives a strong **discrete orientation basis**.
That is useful, but it is not the same thing as unrestricted arbitrary 3D rotation.

Current relevant basis/view code lives around:

- `src/mono_ui/runtime/place_view_projection.ts`

### Near-term recommendation

Use the existing swing/roll/nudge controls as the **editing surface** for shape orientation in v1.

### Long-term target

Shapes should eventually support **any position, size, and rotation**, not just axis-aligned or view-snapped placement.

That means the geometry seam should grow a transform layer that is shape-owned rather than view-owned.

Recommended new shared seam:

- `src/shared/geometry/transform3.ts`

Likely owns:

- `Basis3`
- `Transform3`
- local ↔ world conversion helpers
- basis validation / normalization helpers

## Staged Orientation Plan

### Stage 1: snapped/discrete orientation

Use the repo's existing 3x3 basis-style view orientation behavior as the first shape orientation source.

This gives:

- immediate painter usability
- low-risk preview/control reuse
- simpler first raster implementation

### Stage 2: arbitrary shape-local rotation

After the painter proves out the shape session and primitive contracts, add general shape transforms independent of the current camera/view basis.

This unlocks:

- rotated boxes
- arbitrarily oriented cylinders
- arbitrarily oriented cones
- future gameplay geometry and LOS helpers

## Raster Strategy

The shared geometry seam should continue to prefer:

1. analytic spec
2. rasterization mode
3. output form

### Recommended 3D raster pipeline

For each shape:

1. derive conservative world bounds
2. iterate candidate voxel centers
3. transform world sample into shape-local coordinates if needed
4. test occupancy analytically
5. emit either fill voxels or shell voxels

### Fill

Voxel belongs to the occupied interior.

### Outline

Preferred initial implementation:

- compute fill occupancy
- keep voxels that have at least one non-filled 6-neighbor

This gives a robust first surface-shell result for all volume shapes.

## Brush Integration Direction

Yes, shapes should eventually support both:

- normal shape raster drawing
- brush-applied shape raster drawing

But that should be framed as:

- geometry decides **which voxels belong to the shape**
- brush/material logic decides **what payload gets applied to those voxels**

This avoids hard-coding painter brush semantics into the geometry seam.

### Phase order

#### Phase A

Support shape raster outputs as plain world voxel sets.

#### Phase B

Let brush stamping/material application consume those voxel sets.

#### Phase C

If desired later, add dedicated stroke/path systems that sweep brush shapes along vector primitives.

## Proposed Module Work

### Shared geometry

Likely additions/expansions:

- `src/shared/geometry/shape_specs.ts`
  - add `SphereSpec`
  - add `CylinderSpec`
  - add `ConeSpec`
  - evolve `Box3Spec` toward transform-aware ownership
- `src/shared/geometry/transform3.ts`
  - new
- `src/shared/geometry/shape_eval3.ts`
  - new analytic inclusion / bounds helpers
- `src/shared/geometry/shape_rasterize3.ts`
  - add volume primitive rasterizers
  - add shell/outline support where missing

### Painter app state

Primary state owner:

- `src/canvas_app/painter_app_state.ts`

Likely additions:

- active shape session state
- begin/update/commit/cancel helpers
- property mutation helpers for current shape session
- migration path from existing rect tools toward shape presets

### Painter interaction / preview

Primary consumer:

- `src/mono_ui/modules/painter_canvas_module.ts`

Likely additions:

- pointer routing for `shape`
- live preview generation from current shape session
- commit path that writes generated voxels
- possible bridge from current rect flows into `shape: box`

### Properties UI

Primary property surface:

- `src/mono_ui/modules/tool_properties_module.ts`

Likely additions:

- primitive picker
- render mode picker
- primitive-specific parameter editors
- dimension/radius controls
- nudge / swing / roll buttons for active shape session
- commit / cancel actions

### Tool definitions / routing

Likely files:

- `src/ascii_painter/types.ts`
- `src/mono_ui/modules/toolbox_module.ts`
- `src/canvas_app/controls_wiring.ts`
- `src/mono_ui/runtime/painter_controls_profile.ts`

## Primitive-Specific Property Model

### Box

User-facing properties:

- position
- size x
- size y
- size z
- render mode
- orientation controls

### Sphere

User-facing properties:

- center
- radius
- render mode

### Cylinder

User-facing properties:

- end A / start center
- end B / end center
- radius
- render mode

Possible simplified editing variant:

- center
- axis length
- radius
- orientation controls

But the canonical geometry spec should still favor endpoint centers.

### Cone

User-facing properties:

- tip
- base center
- base radius
- render mode

Possible simplified editing variant:

- center
- height
- base radius
- orientation controls

But the canonical geometry spec should still favor tip + base center.

## Box Migration Strategy

Existing painter rect/box behavior should be treated as a **temporary migration bridge**, not a second permanent shape system.

### Recommended migration

- add `shape`
- initial `shape` defaults to:
  - primitive = `box`
  - render = `outline` or `fill`
- use old rect flows only as short-lived comparison/migration scaffolding while `shape` reaches parity
- once parity is proven, retire legacy rect-shape authoring paths rather than supporting two shape authorities indefinitely

### End-state rule

The repo should end with **one source of truth for shape systems**:

- shared geometry owns shape specs and rasterization
- painter app state owns shape sessions
- consumers render/commit the same shape-session outputs
- legacy rect-shape systems do not remain as independent authorities

## First Implementation Slice

### Shape Tool v1

Implement only:

- new `shape` tool
- primitive = `box`
- render = `outline | fill`
- editable properties in the tool-properties module
- live preview session
- commit/cancel path
- nudge/swing/roll integration for the active session

### Why this first

It validates:

- active shape session ownership
- property-driven shape preview
- geometry raster output reuse
- painter tool routing
- future replacement path for rect tools

without taking on all primitive math at once.

## Follow-on Implementation Order

After v1 box shape session works in the ASCII painter:

1. remove or hard-route remaining legacy rect-shape authoring onto the new shape authority once parity is confirmed
2. `sphere`
3. `cylinder`
4. `cone`
5. brush-application modes for shape outputs
6. arbitrary transform support if still discrete-only at that point
7. place painter/game-side editor adoption through the same shared shape-session model

## LOS / Gameplay Relationship

This work should help gameplay later, but LOS authority should remain separate.

### What geometry should provide

- shape specs
- transform helpers
- point-in-shape tests
- raster outputs
- line/ray intersection helpers where useful

### What LOS should continue to own later

- what blocks vision
- what blocks sound
- actor eye/source positions
- perception policy
- cover/partial visibility rules
- wall/material semantics

### Boundary

- `src/shared/math3d.ts` owns traversal substrate
- `src/shared/geometry/` should own shape math and reusable geometric tests
- gameplay/perception systems should own LOS policy

So LOS is **enabled** by this work, but not solved by this plan alone.

## Validation Plan

### Geometry tests

Add focused tests for:

- sphere occupancy / shell
- cylinder occupancy / shell
- cone occupancy / shell
- transform-aware box occupancy / shell
- conservative bounds correctness

### Painter behavior tests

Add or extend tests for:

- shape tool state transitions
- shape property updates
- preview voxel generation
- commit/cancel behavior
- legacy rect compatibility mapping if introduced

### Manual painter checks

Use the ASCII painter to verify:

- property edits update preview live
- nudge updates origin predictably
- swing/roll updates orientation predictably
- box outline/fill match prior rect/volume behavior where expected
- shape session can be committed or canceled cleanly

## Risks

### 1. Mixing view orientation with shape orientation forever

Risk:
- shapes become permanently limited to snapped camera bases

Response:
- treat current swing/roll basis as a v1 editing source, not the final transform model

### 2. Baking painter semantics into geometry

Risk:
- geometry becomes a brush tool helper pile

Response:
- geometry outputs voxel sets; painter decides payload application

### 3. Too many parameters too early

Risk:
- properties UI becomes noisy and hard to use

Response:
- start with box-only shape v1
- primitive-specific controls appear only when relevant

### 4. Overcommitting to final API names too early

Risk:
- unnecessary churn

Response:
- keep public contracts small and evolve from real consumer pressure

## Definition of Done for v1

- a new painter `shape` tool exists
- it supports `box` as a volume primitive
- it supports `outline` and `fill`
- it uses the shared geometry seam for raster output
- it is editable through properties after placement begins
- it supports nudge/swing/roll session manipulation
- it commits/cancels cleanly
- current rect behavior has a clear compatibility path
- tests cover both geometry and painter session behavior

## Implementation TODO Checklist

Track these as the active task list and check them off as implementation progresses.

### Phase 0 — shared contract first

- [x] Add the first editor-facing shared volume contract for ASCII painter box sessions
- [x] Add the first shared box-session → voxel raster helper in `src/shared/geometry/shape_rasterize3.ts`
- [x] Confirm the contract is suitable as the future single authority for painter and later place-painter adoption

### Phase 1 — ASCII painter tool identity

- [x] Add `'shape'` to `src/ascii_painter/types.ts`
- [x] Add `'shape'` persistence/sanitization in `src/ascii_painter/save_system.ts`
- [x] Add controls wiring for `shape`
- [x] Add painter controls profile entry for `shape`
- [x] Expose `shape` in painter toolbar/toolbox UI

### Phase 2 — ASCII painter shape session ownership

- [x] Add active shape session state to `src/canvas_app/painter_app_state.ts`
- [x] Add session lifecycle helpers: begin/update/commit/cancel
- [x] Add shape property mutation helpers: render mode, size, primitive
- [x] Add preview world-cell generation via shared geometry

### Phase 3 — ASCII painter interaction loop

- [x] Add `shape` interaction branch in `src/mono_ui/modules/painter_canvas_module.ts`
- [x] Keep preview editable after pointer release
- [x] Add explicit commit/cancel behavior
- [x] Route preview rendering through the shape session output

### Phase 4 — ASCII painter properties

- [x] Add shape property rows
- [x] Add `outline/fill` controls
- [x] Add size step controls
- [x] Add commit/cancel controls in properties
- [x] Add nudge/swing/roll controls targeting the active shape session

### Phase 5 — unify and retire legacy shape authority

- [ ] Verify `shape: box` reaches parity for the relevant rect/box workflows
- [ ] Hard-route or retire legacy rect-shape authoring paths instead of keeping parallel authorities
- [ ] Update labels/help text to reflect the unified shape workflow

### Phase 6 — expand shape primitive coverage in ASCII painter

- [x] Add `sphere`
- [x] Add `cylinder`
- [x] Add `cone`
- [ ] Validate each primitive in both `outline` and `fill`

### Phase 7 — later adoption after ASCII painter parity

- [ ] Bring place painter/game-side editing onto the same shape-session authority
- [ ] Migrate game/debug consumers onto shared shape contracts where appropriate

## First Best Implementation Step

The best first implementation step is:

- [x] **Introduce the first editor-facing shared box-session contract and shared box-session raster adapter in `src/shared/geometry/shape_specs.ts` and `src/shared/geometry/shape_rasterize3.ts`.**

Why this is first:

- it establishes the future single source of truth before tool/UI work spreads
- it keeps box voxel generation out of painter app state
- it gives the ASCII painter one clean geometry contract to build preview, commit, and later parity migration on top of
- it gives the later place painter adoption the same shared authority rather than a second implementation

Implementation target for this first step:

- [x] add a minimal editor-facing `Box3SessionSpec`-style contract
- [x] add a shared helper such as `rasterize_box3_session_to_voxels(...)`
- [x] keep it snapped/view-basis compatible for v1
- [x] do not broaden into sphere/cylinder/cone yet
- [x] do not add place-painter-specific behavior yet

## File-by-File Implementation Slice

This section translates the plan into the smallest concrete first implementation for the ASCII painter.

### Slice goal

Deliver **Shape Tool v1** in the standalone ASCII painter with:

- new `shape` tool
- primitive = `box`
- render = `outline | fill`
- live editable session
- property-driven size changes
- nudge / swing / roll support
- commit / cancel
- a clear migration path toward retiring legacy rect-shape authoring

### Guiding rule for v1

Do not try to add all primitives at once.
Do not try to solve arbitrary free-rotation in the first slice.
Use current snapped orientation controls first, but keep the internal contracts ready for a later true transform layer.

## Phase 0: Contract-first prep

### `src/shared/geometry/shape_specs.ts`

Add the first volume-oriented contracts needed by the painter shape tool.

Recommended additions:

- `VolumePrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone'`
- `ShapeRenderMode3` stays the 3D output contract for now
- `Box3Spec` review:
  - if current `Box3Spec` is min/max corner oriented, keep compatibility
  - add a parallel parametric/editor-facing box spec if needed instead of breaking current consumers immediately

Suggested near-term editor-facing contract:

```ts
type Box3SessionSpec = {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  orientation_mode: 'view_basis';
  view_state: PlaceViewState;
};
```

This is not the final long-term geometry contract.
It is the minimal bridge for a snapped-orientation painter v1.

### `src/shared/geometry/shape_rasterize3.ts`

Add a painter-facing box session raster helper or equivalent adapter so the painter does not own box voxel math.

Examples:

- `rasterize_box3_session_to_voxels(...)`
- or `rasterize_oriented_box3_to_voxels(...)` if the geometry side is ready

For v1 this helper may internally map snapped-view orientation into the existing box raster path.

### Optional new seam: `src/shared/geometry/transform3.ts`

Do **not** make this mandatory for the first box-only slice if it slows delivery.

But if added now, keep it tiny:

- `Basis3`
- basis-from-view-state helper
- local axis helpers

No heavy API spread yet.

## Phase 1: Add the new painter tool identity

### `src/ascii_painter/types.ts`

Add:

- `'shape'` to `ToolType`

Do not remove legacy rect tools until `shape` reaches parity for the relevant box workflows.

But treat those rect tools as migration scaffolding only, not as the desired permanent end state.

### `src/ascii_painter/save_system.ts`

Update tool validation and persistence sanitization so saved state can round-trip `shape`.

Expected edits:

- add `'shape'` to `VALID_TOOL_TYPES`
- ensure tool property persistence can hold shape-specific values once they are added
- keep legacy migration rules for `selectangle` untouched

### `src/canvas_app/controls_wiring.ts`

Add a tool assignment entry for `shape`.

Recommended first-pass approach:

- add a dedicated shortcut
- do not immediately delete existing rect shortcuts

### `src/mono_ui/runtime/painter_controls_profile.ts`

Add the matching control profile action:

- `painter.tool_assign.shape`

### `src/mono_ui/modules/painter_toolbar_module.ts`
### `src/mono_ui/modules/toolbox_module.ts`

Expose the new tool in painter UI.

Recommended v1 labeling:

- label: `SHAPE`
- icon: simple cube/box glyph if available, otherwise `▣` or `◫`

If `RECT` and `FILL` remain visible in v1, treat them as temporary migration affordances only.
Once `shape` proves parity, they should be removed or hard-routed into the unified shape workflow.

## Phase 2: Add shape session state to ASCII painter app state

### Primary file: `src/canvas_app/painter_app_state.ts`

This should become the owner of the active shape-edit session for the standalone painter.

#### Add new types near painter tool/session state

Recommended minimal state:

```ts
type PainterShapePrimitive = 'box';

type PainterShapeSession = {
  primitive: PainterShapePrimitive;
  render_mode: 'outline' | 'fill';
  origin_world: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  orientation_mode: 'view_basis';
  view_state: PlaceViewState;
  active: boolean;
};
```

Important:
- use `origin_world + size` or `center + size`
- pick one and use it consistently in UI and raster adapters
- for v1, `size` should step in **1 tile increments** only

#### Add state storage

Add to painter UI/session state:

- `active_shape_session: PainterShapeSession | null`

#### Add session helpers

Recommended helper set:

- `begin_shape_session(anchor_world, current_view_state)`
- `update_shape_session_drag(target_world)`
- `set_shape_primitive(...)`
- `set_shape_render_mode(...)`
- `step_shape_size(axis, dir)`
- `nudge_shape_session(delta_world)`
- `step_shape_view_action(action)`
- `commit_shape_session()`
- `cancel_shape_session()`
- `get_shape_session_preview_world_cells()`

#### Why app-state ownership

This keeps:

- painter interaction state in app state
- geometry in `src/shared/geometry/`
- module UI relatively dumb

which matches the repo's current direction.

## Phase 3: Route canvas interaction through the new shape session

### Primary file: `src/mono_ui/modules/painter_canvas_module.ts`

This module already owns most live painter interaction flow and should become the main shape-session consumer.

#### Add `shape` to shape-tool detection only where appropriate

Current logic often groups:

- `line`
- `rect_stroke`
- `rect_fill`

Do **not** blindly lump `shape` into those old 2D/drag helpers.

Instead:

- keep existing line flow intact
- add a separate `shape` branch
- avoid deepening the old rect-specific shape branch any further beyond what is needed for migration

#### Add new options/callbacks to `PainterCanvasOptions`

Likely additions:

- `get_active_shape_session?: () => PainterShapeSession | null`
- `on_shape_session_start?: (world) => void`
- `on_shape_session_update?: (world) => void`
- `on_shape_session_commit?: () => void`
- `on_shape_session_cancel?: () => void`
- `on_shape_session_nudge?: (delta) => void`
- `on_shape_session_view_action?: (action) => void`

Use the existing callback style already common in this module.

#### Pointer behavior for v1

Recommended minimal interaction:

1. first click seeds origin
2. drag sets size
3. release keeps the preview/session alive
4. properties now refine size/mode/orientation
5. explicit commit/cancel finishes

This is important: do **not** auto-bake immediately on mouse-up if the goal is editable post-placement behavior.

#### Preview path

Add a preview branch that renders from app-state-owned shape-session voxel output rather than from old rect preview helpers.

This likely plugs into existing preview change generation or world preview overlays.

## Phase 4: Add property-driven shape controls

### Primary file: `src/mono_ui/modules/tool_properties_module.ts`

The shape tool should be primarily controlled here.

The module already supports generic property rows, which is the right seam.

#### Add shape-specific row generation in the painter app state call site

Prefer to keep most shape-property logic in:

- `src/canvas_app/painter_app_state.ts`

and feed rows into `make_tool_properties_module(...)` through `property_rows`.

Avoid making `tool_properties_module.ts` understand too much domain-specific shape logic.

#### For v1, expose

- primitive info row: `BOX`
- render mode cycle: `OUTLINE` / `FILL`
- size steppers:
  - `SIZE X`
  - `SIZE Y`
  - `SIZE Z`
- origin info row or readout
- orientation info row derived from current session/view
- action rows:
  - `COMMIT`
  - `CANCEL`

#### Optional v1 controls

If cheap to wire, also add:

- anchor mode display
- snap/readout labels for current view basis

#### Important boundary

`tool_properties_module.ts` should stay a generic control renderer.
The actual shape property semantics should stay in painter app state.

## Phase 5: Commit generated voxels through existing painter mutation flow

### Primary files

- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`

The shape tool should commit by converting preview voxels into normal painter cell changes and then reusing the existing commit/history path.

#### Do not create a second mutation pipeline

Reuse existing:

- brush payload resolution
- cell change grouping
- history logging
- active-group/world commit flow

#### Recommended v1 behavior

- `outline` applies brush/material payload to shell voxels
- `fill` applies brush/material payload to all occupied voxels

This lets shape behave like a geometry-driven paint operation rather than a special-case editor object.

## Phase 6: Map current view controls into active shape editing

### Relevant files

- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`
- possibly existing camera/view action helpers already used by paste/move flows

The user specifically wants to use:

- nudge
- swing
- roll

while shape mode is active.

### Recommended v1 behavior

When a shape session is active:

- nudge moves the shape origin
- swing/roll update the session orientation basis source
- size steppers remain explicit property operations

### Important behavior rule

While shape-session-editing is active, these commands should target the **shape session first**, not immediately the camera, if the user is in active shape edit mode.

If that is too invasive for v1, expose dedicated property buttons first and keyboard routing second.

## Phase 7: Compatibility and migration posture

### Keep old tools alive in v1

Do not remove:

- `rect_stroke`
- `rect_fill`

They are still valuable for quick regression comparison.

### Optional preset bridge

Later in the same slice or next slice:

- selecting `rect_stroke` can open `shape` with `primitive=box, render=outline`
- selecting `rect_fill` can open `shape` with `primitive=box, render=fill`

But that should happen only after the new `shape` workflow is stable.

## Phase 8: Test plan for Shape Tool v1

### Code-level tests

#### `src/tests/geometry_shape_rasterize3.test.ts`

Add or extend coverage for:

- box session adapter path if introduced
- snapped-orientation box raster behavior
- shell vs fill correctness

#### New painter-facing tests if practical

Candidate new tests:

- `src/tests/painter_shape_session.test.ts`
- or a smaller focused helper test near app state if the session logic is extractable

Cover:

- begin/update session
- size stepping
- nudge
- commit/cancel
- render mode switching

### Manual painter regression checklist

In ASCII painter:

1. choose `shape`
2. place a box preview
3. drag to define size
4. release and verify preview remains editable
5. change `SIZE X/Y/Z` in properties
6. toggle `OUTLINE/FILL`
7. nudge the shape
8. swing/roll the shape orientation source
9. commit
10. verify history/undo works
11. repeat with cancel
12. compare output against existing rect/box workflows where relevant

## Recommended exact implementation order

1. add tool identity + persistence/control wiring
2. add shape session state in `painter_app_state.ts`
3. add box preview/raster adapter in shared geometry
4. add painter canvas session callbacks and preview usage
5. add property rows and commit/cancel controls
6. wire nudge/swing/roll to the active shape session
7. validate manually in ASCII painter
8. only then begin `sphere`

## What to defer until after v1 works

Defer these on purpose:

- sphere implementation
- cylinder implementation
- cone implementation
- true arbitrary continuous rotation
- replacing line with vector stroke tooling
- retiring old rect tools
- gameplay LOS adoption
- shape-aware brush sweep/stroke semantics beyond simple payload application

## Next Step

Implement **Phase 1 through Phase 4** first, then validate the live preview/edit loop before adding more primitives.

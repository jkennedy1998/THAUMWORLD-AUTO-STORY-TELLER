# Encapsulation Targets

Working map of repo areas that may deserve folder-level encapsulation with colocated documentation.

## What this doc is

This is a living map.

Use it to:
- record candidate encapsulation seams
- capture ownership and non-ownership notes
- track current status
- note where investigation stopped
- point to the standard encapsulation pattern

## Status legend

- `not started`
- `investigating`
- `partially encapsulated`
- `encapsulated`
- `blocked`
- `deferred`

## Standards reference

See:
- `docs/standards/encapsulation_template.md`

## Active findings / current stop point

We confirmed that `target` is a real overloaded family term in this repo.

At least six target-related systems exist:

1. **Resolved interaction targets**
   - transient UI/input hit-testing
   - primary area: `src/mono_ui/runtime/interaction_*target*`

2. **Selected actor target**
   - persistent gameplay-facing selected target
   - primary area: `src/interface_program/target/`, `src/interface_program/target_state.ts`, `src/interface_program/frontend_api.ts`

3. **Painter selection**
   - persistent editor selection of cells/voxels/regions
   - primary area: `src/ascii_painter/selection.js`, `src/ascii_painter/world_selection.js`, `src/mono_ui/modules/painter_canvas_module.ts`

4. **Painter / camera anchor and focus**
   - camera/view/editing reference point and focused plane
   - primary area: `src/mono_ui/runtime/camera_anchor_runtime.ts`, painter and place camera code

5. **Presentation targeting / highlighting**
   - visual hovered/selected/targeted/highlighted state
   - primary area: `src/render_shaders/ui/*`, `src/render_shaders/tags/*`, related highlight code

6. **Action targets / operation destinations**
   - short-lived command-local targets or destinations
   - primary area: scattered through `src/interface_program/main.ts`, `src/mono_ui/modules/place_module.ts`, `src/mono_ui/modules/painter_canvas_module.ts`

We stopped after confirming that the newly encapsulated `src/interface_program/target/` seam covers only one of these six systems: **selected actor target**.

We intentionally did not continue trying to unify the broader target/selection/focus family yet, because that would be a larger and higher-risk conceptual extraction.

We are moving to an easier next encapsulation target instead.

## Candidate inventory

### Candidate: interface_program target
- **Status:** `encapsulated`
- **Primary location:** `src/interface_program/target/`
- **Why it is a candidate:** stable low-risk gameplay-facing seam with a small request/response surface
- **Likely owns:** `/api/target` route adapter, actor target set/clear behavior, interface-facing target selection contract
- **Likely does not own:** world rules, broader action semantics, generic UI interaction targeting
- **Current problems:** still adjacent to related target state and frontend target mirror logic outside the folder
- **Existing seams/files:** `route.ts`, `service.ts`, `README.md`
- **Recommended encapsulation shape:** keep folder-level seam and expand only if related ownership becomes clearer
- **Notes:** first folder-level encapsulated seam under `src/interface_program/`

### Candidate: mono_ui interaction targeting
- **Status:** `investigating`
- **Primary location:** `src/mono_ui/runtime/interaction_*target*`
- **Why it is a candidate:** multiple files already form a coherent target-resolution cluster
- **Likely owns:** resolved targets, target ordering, hover/current target selection, interaction-session target tracking
- **Likely does not own:** actor target persistence, painter world selection, backend gameplay target state
- **Current problems:** naming overlap with other target systems; boundary not yet documented
- **Existing seams/files:** runtime target, selector, builder, resolution, orchestrator files
- **Recommended encapsulation shape:** likely a feature folder or documented sub-boundary under `src/mono_ui/runtime/`
- **Notes:** should be treated as separate from actor target selection

### Candidate: painter selection
- **Status:** `investigating`
- **Primary location:** `src/ascii_painter/selection.js`, `src/ascii_painter/world_selection.js`, `src/mono_ui/modules/painter_canvas_module.ts`
- **Why it is a candidate:** selection is central, stateful, and spans editor behavior and UI integration
- **Likely owns:** selected cells/voxels/regions, selection operations, copy/move/transform source selection
- **Likely does not own:** actor target selection, generic hover target resolution, camera anchoring
- **Current problems:** logic is split across painter state and module behavior
- **Existing seams/files:** selection modules plus painter canvas integration
- **Recommended encapsulation shape:** likely a painter feature folder or a documented selection subsystem
- **Notes:** related to targeting in concept, but likely better named as selection rather than target

### Candidate: camera anchor / focus
- **Status:** `deferred`
- **Primary location:** `src/mono_ui/runtime/camera_anchor_runtime.ts` and related place/painter camera code
- **Why it is a candidate:** repeated anchor/focus concepts appear across painter and place systems
- **Likely owns:** anchor point rules, viewport-relative anchor behavior, focused plane semantics
- **Likely does not own:** selection persistence, gameplay targets, drag/drop target resolution
- **Current problems:** currently conceptually related to targeting, but semantically distinct
- **Existing seams/files:** anchor runtime plus many callbacks/adapters
- **Recommended encapsulation shape:** defer until naming and ownership are clearer
- **Notes:** likely belongs to focus/camera architecture rather than target architecture

### Candidate: presentation highlight state
- **Status:** `deferred`
- **Primary location:** `src/render_shaders/ui/*`, `src/render_shaders/tags/*`
- **Why it is a candidate:** many systems project into visual state flags like hovered/selected/targeted
- **Likely owns:** presentation modifiers only
- **Likely does not own:** authoritative target or selection state
- **Current problems:** mostly consumer-side behavior rather than primary ownership
- **Existing seams/files:** shader modifiers and UI context flags
- **Recommended encapsulation shape:** keep separate from authoritative target systems
- **Notes:** likely a presentation concern, not a first-order target seam

### Candidate: action targets / operation destinations
- **Status:** `deferred`
- **Primary location:** scattered through gameplay and painter/place operation code
- **Why it is a candidate:** the term `target` is heavily used for command-local destinations
- **Likely owns:** individual operation-local intent/destination handling
- **Likely does not own:** persistent selected targets or generalized interaction targeting
- **Current problems:** highly overloaded vocabulary and broad distribution
- **Existing seams/files:** many local variables and route/action handlers
- **Recommended encapsulation shape:** do not unify early; classify first
- **Notes:** likely needs naming cleanup before any meaningful encapsulation

## Priority list

1. easier next extraction outside the broader target/selection/focus family
2. revisit `src/mono_ui/runtime/interaction_*target*` as a distinct documented seam
3. revisit painter selection as its own encapsulation candidate
4. defer focus/anchor and presentation systems until terminology is cleaner

## Completed encapsulations

- `src/interface_program/target/`

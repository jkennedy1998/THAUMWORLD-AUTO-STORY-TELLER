# ASCII Painter Group Architecture Plan

Date: 2026-04-18

## Intent

Replace the painter's legacy `layer = z slice` model with a group-based authored model that supports:

- groups spanning arbitrary XYZ voxels
- overlapping group voxels at the same exact coordinate
- final visible voxel resolution by group order
- multiplayer authoritative document state
- future animation via frame and breath-relative deltas

This file is the source of truth for the architecture pass.

This plan supersedes the remaining layer-architecture assumptions in:

- `docs/plans/3dification_existing_architecture_analysis.md`
- `docs/plans/3dification_implementation_summary.md`
- older painter/layer notes in `docs/plans/archive/`

## Problem Statement

The current painter collapses three different concepts into numeric `z`:

1. world-space depth coordinate
2. authored object identity
3. rendered stacking order

That coupling currently exists across:

- data model in `src/ascii_painter/voxel_space.ts`
- projection in `src/ascii_painter/painter_view_projection_adapter.ts`
- DOM rendering in `src/ascii_painter/voxel_dom_renderer.ts`
- structural history in `src/ascii_painter/history.ts`
- layer palette UI in `src/ascii_painter/layer_palette_module.ts`
- painter state orchestration in `src/canvas_app/painter_app_state.ts`
- multiplayer snapshot persistence in `src/shared/painter_document_store.ts`

The highest-risk example is reorder: the current system rewrites real Z coordinates to change visual order.

## Corrected Group Model

Groups are not just ownership tags for unique voxels.

Groups are authored 3D datasets, and multiple groups may each contain a voxel at the same exact `x,y,z` coordinate.

Rendering rule:

- when two or more visible groups contribute a voxel at the same exact coordinate, the group that is higher in the layers module wins
- when no overlap exists at a coordinate, there is no special group compositing rule to apply there

This means the layers module becomes a group-ordering module for authored 3D datasets.

## Architecture Goals

- One voxel coordinate system: `x/y/z` remains world space only.
- One stable editable workspace: document bounds remain fixed unless explicitly resized.
- One authored ownership model: groups own sparse voxel contributions.
- One explicit group ordering model: order determines the winner only when multiple groups overlap at the same exact coordinate.
- Focus plane remains a camera/editing concept, not a group identifier.
- Multiplayer authoritative state persists authored groups, not resolved slices.
- Animation builds on stable group identity, not plane identity.

## Design Rules

- Never mutate world Z coordinates just to change visual stacking.
- Group identity must be stable across save/load, multiplayer, and history.
- Multiple groups may contain voxels at the same `x,y,z`.
- The active editing target is `active_group_id` plus edit-plane/focus context.
- Authored document state and resolved render state are separate concepts.
- The canonical persisted form is authored group data, not a resolved voxel field.
- Resolution must be deterministic from `groups + group_order + visibility` alone.
- A hidden or deleted top contribution must reveal the next lower contribution without repair work.
- Undo/redo must be scoped per group for authored voxel edits.
- Legacy v2 layer documents must remain importable.
- New multiplayer protocol revisions must preserve a clear migration path from legacy snapshots.

## Core Invariants

- Every group id is globally unique within a document.
- Every id in `group_order` must exist in `groups`.
- Every visible resolved voxel is backed by exactly one authored contribution.
- Resolved voxels are never edited directly; edits always target authored group data.
- Reordering groups never changes authored voxel coordinates.
- Importing a legacy layer document must not flatten or discard overlapping authored data during migration.

## Core Separation

### 1. Authored Group Data

- stores every group's voxel contributions, including overlaps
- hiding or reordering groups does not delete lower groups' voxels
- this is the authoritative save/load/multiplayer form

### 2. Resolved Render Data

- derived from authored group data plus group order and visibility
- at each exact `x,y,z`, choose the topmost visible group contribution
- projection and rendering should operate from this resolved field unless a tool explicitly needs raw authored overlap data

### 3. World Coordinates

- `x/y/z` are immutable spatial meaning
- reorder never changes them
- projection derives visible plane relationships from coordinates, not from authored group ids

### 4. Workspace Bounds vs Occupied Bounds

- the document keeps fixed editable workspace bounds for stable navigation, paste behavior, and multiplayer UX
- authored content also tracks occupied bounds derived from actual stored voxels across all groups
- occupied bounds are used for framing, centering, export logic, culling, and future animation extent work
- occupied bounds never replace the editable workspace as the primary canvas extent

## Target Model

Suggested authored model:

```ts
type PainterDocument = {
  version: 3;
  bounds: {
    width: number;
    height: number;
    depth: number;
    minZ: number;
    maxZ: number;
  };
  occupied_bounds?: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  } | null;
  groups: Record<string, PainterGroup>;
  group_order: string[];
  camera?: CameraConfig;
  metadata?: PainterDocumentMetadata;
};

type PainterGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  voxels: PainterVoxelRecord[];
  frames?: PainterGroupFrame[];
  metadata?: {
    created_at?: string;
    modified_at?: string;
    origin?: { x: number; y: number; z: number };
  };
};

type PainterVoxelRecord = {
  key: string;
  x: number;
  y: number;
  z: number;
  char: string;
  rgb: { r: number; g: number; b: number };
  weight_index: number;
};

type PainterGroupFrame = {
  id: string;
  label: string;
  breath_offset?: number;
  deltas: PainterVoxelDelta[];
};

type PainterVoxelDelta = {
  x: number;
  y: number;
  z: number;
  next: PainterVoxelRecord | null;
};
```

Suggested resolved view:

```ts
type ResolvedPainterVoxel = {
  x: number;
  y: number;
  z: number;
  winning_group_id: string;
  cell: PainterVoxelRecord;
};
```

Notes:

- `groups` are authored ownership.
- `group_order` is the only ordering rule needed for overlap resolution.
- the resolved view is derived and should never replace authored data as the saved source of truth.
- `frames` are reserved for later animation work and should not block the base group refactor.
- `key` should be a stable coordinate key such as `"x:y:z"` to support sparse indexing and fast overwrite within a single group.
- `bounds` are fixed workspace extents.
- `occupied_bounds` are derived from authored content and may be null for an empty document.

## Canonical Indexes

The document should expose explicit indexes instead of forcing every system to rescan all group voxel arrays.

Suggested runtime shape:

```ts
type PainterDocumentRuntime = {
  document: PainterDocument;
  group_voxel_index: Map<string, Map<string, PainterVoxelRecord>>;
  coordinate_group_index: Map<string, string[]>;
  resolved_visible_index: Map<string, ResolvedPainterVoxel>;
};
```

Where:

- `group_voxel_index.get(group_id)` returns that group's voxel map keyed by coordinate key
- `coordinate_group_index.get(coord_key)` returns group ids that currently contribute at that exact coordinate
- `resolved_visible_index.get(coord_key)` returns the currently visible winner at that coordinate

Rules:

- the persisted file can remain array-based for simplicity
- runtime should normalize into indexes immediately after load/bootstrap
- all group write/erase operations must update both indexes
- winner recomputation should be incremental for dirty coordinates rather than full-document recompute on every edit

## Runtime Performance Strategy

- authored storage stays sparse per group
- resolved winners are cached in `resolved_visible_index`
- single-voxel writes only dirty one coordinate key
- fills, pastes, visibility toggles, and reorders may dirty many keys, but should still recompute through indexed contributors rather than full document scans when practical
- full rebuild of resolved winners is allowed as a fallback for correctness during early migration, but the target runtime path is incremental dirty-coordinate resolution

This keeps authored overlap cheap to resolve and avoids accidental regression to dense Z-slice storage.

## Resolution Rules

At any exact `x,y,z` coordinate:

1. collect all group voxel contributions at that coordinate
2. filter out hidden groups
3. sort by `group_order`
4. choose the highest visible group as the rendered winner

Implications:

- deleting or hiding the top group voxel reveals the next lower contribution automatically
- reorder changes visible output without changing authored voxel coordinates
- multiplayer patches must preserve all overlapping authored contributions, not only the current winner

Suggested helper contract:

```ts
type ResolveVoxelWinnerArgs = {
  document: PainterDocumentRuntime;
  coord_key: string;
};

type ResolveVoxelWinnerResult = {
  winning_group_id: string | null;
  cell: PainterVoxelRecord | null;
};
```

Resolution behavior:

- if no visible group contributes at the coordinate, the winner is `null`
- if one visible group contributes, it wins directly
- if many visible groups contribute, walk `group_order` from top to bottom and return the first visible contributor

This should be the only supported winner-selection rule in v1.

## Editing Model

The painter must stop treating `camera.focus_plane` as the authored edit target.

New editing context:

```ts
type PainterEditContext = {
  active_group_id: string | null;
  focus_plane: number;
  focus_world_plane: number | null;
  projection_view: PlaceViewState;
  creation_policy: 'active_group_writes_authored_voxels';
};
```

Rules:

- drawing writes to the active group's authored voxel set
- writing in the active group at a coordinate does not destroy lower groups' overlapping voxels
- erasing in the active group removes that group's authored contribution at that coordinate
- selection and clipboard can initially flatten to the active group, then later preserve per-group overlap if needed
- copy reads authored voxels from the active group only
- paste writes authored voxels into the active group only using copied `x/y/z` offsets

Required write semantics:

- if the active group already has a voxel at a coordinate, drawing overwrites that authored contribution in-place
- if the active group does not have a voxel at a coordinate, drawing creates a new authored contribution for that group only
- erase removes only the active group's contribution at the coordinate
- bucket/fill and paste operate as repeated authored writes into the active group

Non-goal for v1:

- no implicit merge of authored overlap across groups
- no default merged-copy mode across all visible groups

## Projection Model

Current projection creates fake display layers from authored Z layers. That must change.

Target behavior:

- projection resolves visible voxels from authored groups first
- projected output becomes render fragments or projected cells tagged with:
  - `winning_group_id`
  - world coordinate
  - projected plane/slot
- tools that need raw overlap awareness may query authored group data separately
- focus plane still determines edit-plane writeback, but writeback resolves to authored group voxel writes instead of `getOrCreateLayer(z)`

Minimum new seam:

```ts
type ProjectedPainterCell = {
  winning_group_id: string;
  world: { x: number; y: number; z: number };
  projected: { u: number; v: number; plane: number };
  cell: PainterVoxelRecord;
};
```

Required companion seam for tools that need authored overlap awareness:

```ts
type AuthoredVoxelContributors = {
  coord_key: string;
  contributors: Array<{
    group_id: string;
    cell: PainterVoxelRecord;
    visible: boolean;
    locked: boolean;
  }>;
};
```

This lets eyedropper, selection, debug, and future overlap-aware tools inspect raw group contributions without forcing the main renderer to become overlap-aware everywhere.

## Rendering Model

Current DOM rendering is one canvas per Z layer. That is not compatible with authored group overlap.

Target behavior:

- renderer consumes resolved visible voxels, not authored slices
- renderer no longer treats authored Z layers as the compositing unit
- renderer may still rasterize by projected plane slot internally if that remains performant
- group order only matters when authored group voxels collide at the same exact coordinate

Important distinction:

- authored overlap is stored in document data
- rendered output shows only the resolved winner at a coordinate

## Groups Module Meaning

The existing layers module should be replaced by a standard reusable `groups_module`.

The painter is the first consumer, but this module should be general enough to support:

- painter authored groups
- future tile/item/character grouping UI
- multi-tile entity grouping
- future transform/manipulation sets
- other ordered named group collections in THAUMWORLD

This module should not encode layer, z-slice, or painter-only semantics.

Its responsibilities:

- display all groups in caller-provided display order
- allow selecting the active group
- allow renaming, locking, hiding, and deleting groups
- allow reordering groups
- communicate that reordering changes overlap or precedence semantics owned by the caller, not world coordinates

The UI may continue using the word "Layers" temporarily if that reduces churn, but the implementation direction is a native `groups_module` and group-order semantics.

Minimum user-facing semantics to preserve:

- selecting a row sets `active_group_id`
- moving a row changes overlap precedence globally
- hiding a row removes that group from winner resolution without deleting authored voxels
- locking a row blocks writes into that group only

Interaction rules:

- when editing a group, another group's voxel must not become the mutation target implicitly
- resolved rendering may show another group's winning voxel at a coordinate, but tools still write only to the active group
- copy operates on the active group only in v1

### Standard Groups Module Contract

Suggested reusable UI contract:

```ts
type GroupListItem = {
  id: string;
  label: string;
  selected: boolean;
  visible?: boolean;
  locked?: boolean;
  can_delete?: boolean;
  subtitle?: string;
};

type GroupsModuleOptions = {
  id: string;
  rect: Rect;
  title?: string;
  get_groups: () => GroupListItem[];
  on_select_group: (id: string) => void;
  on_toggle_group_visibility?: (id: string) => void;
  on_toggle_group_lock?: (id: string) => void;
  on_rename_group: (id: string, next_label: string) => void;
  on_add_group: () => void;
  on_delete_group?: (id: string) => void;
  on_reorder_groups: (ids_in_display_order: string[]) => void;
};
```

Rules:

- the module does not know about `z`
- the module does not know about `VoxelSpace`
- the module does not sort internally; caller provides display order explicitly
- the module emits reordered ids in that same display order
- any conversion between display order and domain order belongs in the caller, not the UI module
- merge-down or other layer-specific actions are not part of this reusable contract

### Painter As First Consumer

Painter should consume `groups_module` directly from authored runtime state.

Painter-specific row generation should be native and id-based:

- use `group_id` as the stable row identity
- provide rows directly from `painter_document_runtime.document.group_order`
- selection, rename, delete, visibility, lock, and reorder should all be wired by `group_id`
- painter should stop building fake `VoxelLayer` rows or fake `z`-based palette semantics for group UI

This keeps the painter aligned with future group usage elsewhere in the game while removing layer compatibility assumptions from the UI boundary.

## History Model

Current history is partly ready and partly not:

- cell edits already track world coordinates
- structural history is still `add_layer/delete_layer/duplicate_layer` with `z`

Target history changes:

- [ ] replace layer structural actions with group structural actions
- [ ] add reorder action by `group_id`
- [ ] add rename, lock, visibility actions to history
- [ ] ensure cell undo/redo restores authored group contributions, not only the currently visible resolved winner
- [ ] scope cell undo/redo per group
- [ ] reserve frame add/remove/delta actions for animation phase

Suggested shape:

```ts
type PainterStructureAction =
  | { type: 'create_group'; group_id: string }
  | { type: 'delete_group'; group_id: string }
  | { type: 'duplicate_group'; source_group_id: string; target_group_id: string }
  | { type: 'rename_group'; group_id: string; old_name: string; new_name: string }
  | { type: 'set_group_visibility'; group_id: string; old_visible: boolean; new_visible: boolean }
  | { type: 'set_group_locked'; group_id: string; old_locked: boolean; new_locked: boolean }
  | { type: 'reorder_groups'; old_order: string[]; new_order: string[] };
```

Cell-history requirement:

- every cell change entry must include `group_id`
- undo/redo of a cell write must restore the authored contribution in that specific group
- undo/redo must not snapshot only the resolved visible cell at that coordinate
- undo stacks should be tracked per group so that group-local editing history can survive overlap from other groups

Multiplayer undo rule:

- per-group undo is the default multiplayer-safe model
- undoing in group A only affects authored contributions in group A
- undo must not rewind authored changes in other groups

## Multiplayer Model

The multiplayer painter path that is now being built should align with this group model immediately.

Requirements:

- authoritative host stores authored v3 group-based document snapshots
- bootstrap endpoint returns authored groups, not only resolved visible voxels
- command payloads target `group_id`, not implicit selected Z
- patch events include changed group ids and revisions
- clients derive resolved visible voxels locally from authoritative authored group data unless server-side resolution becomes necessary later

Suggested command families:

- [ ] `apply_group_voxels`
- [ ] `erase_group_voxels`
- [ ] `create_group`
- [ ] `delete_group`
- [ ] `duplicate_group`
- [ ] `rename_group`
- [ ] `set_group_visibility`
- [ ] `set_group_locked`
- [ ] `reorder_groups`
- [ ] later `apply_group_frame_deltas`

Suggested payload baseline:

```ts
type ApplyGroupVoxelsCommand = {
  kind: 'apply_group_voxels';
  document_id: string;
  group_id: string;
  base_revision: number;
  command_id: string;
  voxels: PainterVoxelRecord[];
};

type EraseGroupVoxelsCommand = {
  kind: 'erase_group_voxels';
  document_id: string;
  group_id: string;
  base_revision: number;
  command_id: string;
  keys: string[];
};
```

Server-side rules:

- host validates `group_id` exists and is not locked
- host mutates authored group data only
- host increments revision after authored mutation succeeds
- clients recompute resolved winners from authoritative authored state
- per-group undo commands should be supported later without requiring cross-group history rollback

## Persistence and Migration

### Schema Direction

- v2: legacy `VoxelSpaceExport` layer-based
- v3: authored group-based painter document

### Migration Rule

- [ ] every imported v2 layer becomes one v3 group
- [ ] each migrated group keeps the original layer name, visible, locked, opacity
- [ ] all non-empty cells on legacy layer `z` become authored voxels owned by the new group with the same world `z`
- [ ] migrated group order preserves prior visual layer ordering

### Save/Load Rules

- [ ] save only v3 once the model lands
- [ ] keep v2 importer for compatibility
- [ ] multiplayer authoritative store must persist v3 authored snapshots
- [ ] autosave and file export paths must stop assuming `layers[]`
- [ ] resolved visible voxels are derived, not persisted as the primary source of truth
- [ ] fixed workspace bounds and derived occupied bounds are both persisted clearly

Compatibility rule:

- legacy export may remain available temporarily as an explicit compatibility/export tool, but it must be documented as lossy for authored overlap because only one visible winner can survive per coordinate in the old model

## Primary Refactor Targets

### Data Model

- `src/ascii_painter/voxel_space.ts`
- consider splitting this into authored-document storage helpers and resolved-view helpers instead of expanding one file indefinitely
- `src/ascii_painter/index.ts`
- `src/shared/painter_document_store.ts`
- `src/shared/painter_protocol.ts`

### Projection and Rendering

- `src/ascii_painter/painter_view_projection_adapter.ts`
- `src/ascii_painter/voxel_dom_renderer.ts`
- `src/ascii_painter/layer_renderer_module.ts`

### UI and App State

- `src/ascii_painter/layer_palette_module.ts`
- rename toward a group-oriented module after migration
- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`

### History

- `src/ascii_painter/history.ts`

### Save/Load

- `src/ascii_painter/save_system.ts`

### Tests

- `src/ascii_painter/painter_view_projection_adapter.test.ts`
- add new document migration, overlap resolution, and group-order tests

## Phases

## Current Status

Implemented so far:

- [x] Added authored painter document types/helpers in `src/ascii_painter/painter_document.ts`
- [x] Added runtime normalization, overlap indexes, occupied-bounds derivation, and winner resolution in `src/ascii_painter/painter_document_runtime.ts`
- [x] Added focused overlap/occupied-bounds test in `src/ascii_painter/painter_document_runtime.test.ts`
- [x] Added temporary legacy adapter bridge in `src/ascii_painter/painter_document_legacy_adapter.ts`
- [x] Stopped painter palette reorder from mutating real world Z coordinates
- [x] Split active compatibility group tracking from focus-plane tracking in `src/canvas_app/painter_app_state.ts`
- [x] Restricted copy to the active group compatibility path
- [~] Began routing palette structural actions through the painter document runtime, then rebuilding a resolved legacy `VoxelSpace` for rendering
- [~] Began carrying `group_id` through painter cell history payloads
- [x] Switched painter projection rebuilds to use resolved runtime data as the source
- [x] Switched active painter DOM renderer feeds to projection/runtime-derived compatibility spaces instead of raw authored-layer `VoxelSpace`
- [~] Added per-group undo scaffolding and first callable active-group undo/redo path
- [x] Added TAI-log-visible runtime diagnostics for projection and authored group mutation summaries
- [x] Added a painter TAI smoke path for group add/duplicate/reorder/draw/undo-redo validation
- [x] Verified the painter group-runtime smoke TAI passes with runtime-value assertions instead of brittle visible-cell assertions
- [~] Began logging and applying group-native structural history actions in the active painter flow
- [~] Began migrating painter multiplayer bootstrap/store/protocol to authored v3 group documents
- [~] Added multiplayer structural group commands for create/delete/duplicate/rename/visibility/lock/reorder with host-facing authored document mutations
- [~] Added host-side multiplayer per-group undo/redo commands for authored voxel edits
- [x] Added a dedicated multiplayer patch smoke TAI that passes against the local-host authoritative path
- [x] Added a dedicated `navigation_module` for swing/roll and explicit depth stepping, separating navigation depth from group ordering interaction
- [x] Switched active painter projection rebuilds from a temporary projection-source `VoxelSpace` bridge to direct resolved runtime projection
- [x] Replaced file-menu clear with authored active-group clearing instead of visible-layer/grid clearing
- [x] Added a TAI fresh-state reset path that clears local painter state and resets the authoritative host document before smoke tests run
- [x] Updated painter canvas paste/type lock checks to prefer active-group lock semantics over legacy selected-layer semantics
- [x] Verified the fresh-state multiplayer patch smoke TAI passes cleanly from a reset document baseline
- [x] Renamed active DOM renderer debug/output from legacy layer semantics to projected slot semantics and switched content invalidation to `setSlotContentVersion(...)`
- [x] Switched active painter structural add/delete/duplicate flow to group-native runtime mutations and group history actions instead of legacy layer history actions
- [x] Switched active-group world copy generation to authored runtime voxels instead of resolved legacy voxel-space reads
- [x] Switched active 3D paste commits to explicit `paste` history actions while keeping authored writes scoped to the active group
- [x] Removed unused legacy `add_layer/delete_layer/duplicate_layer` action handling from `src/ascii_painter/history.ts`
- [x] Renamed the remaining exported `PainterAppState` structural/control surface from layer-named methods to group-native methods
- [x] Upgraded `layer_palette_module` to support stable layer/group ids and switched the painter palette path to id-native select/rename/lock/visibility/delete/duplicate/reorder callbacks
- [x] Reduced active projection camera-target/bounds math and projection-grid writeback away from legacy `VoxelSpace` dependence; the projected grid now stays view-only while runtime-aware callbacks own authored mutations
- [x] Switched painter autosave/manual save/manual load to authored v3 document serialization with legacy voxel/grid fallback for older files
- [x] Switched reset/new-canvas/authoritative-bootstrap initialization helpers to authored-document-first application instead of starting from legacy `VoxelSpace` state
- [x] Switched painter-facing text/JSON export surfaces to authored runtime/document output instead of serializing the legacy `VoxelSpace` bridge
- [x] Renamed the remaining explicit voxel-space import surface to `import_legacy_voxel_space(...)` so compatibility import is no longer presented as the generic painter document API
- [x] Reduced the camera-control render/settings panel from a full `VoxelSpace` dependency to a camera-provider interface, trimming one more active compat render consumer
- [x] Removed the painter palette's synthesized compat `VoxelSpace`; `layer_palette_module` now supports direct row-provider data and the painter path feeds group rows without rebuilding layer-space state
- [x] Renamed the remaining broad painter-side `VoxelSpace` getter to `get_legacy_voxel_space(...)` so the compatibility bridge is explicitly marked as legacy-only
- [x] Verified `makeLayerRendererModule(...)` is no longer part of the active painter path; removed its dead painter import and relabeled the module as legacy compatibility-only
- [x] Made active cell-history logging group-first: `logCellAction(...)` and batch metadata now accept `group_id`, painter canvas commit payloads include it, and active group edit history no longer uses focus-plane `z` as the primary identity
- [x] Removed the deprecated `pushSnapshot(...)` shim from active painter flow entirely; document/import boundaries now reset history explicitly and edit commits use a dedicated post-commit callback instead of the legacy snapshot placeholder
- [x] Routed active painter keyboard undo/redo through the authored group/runtime history path first, so Ctrl+Z / Ctrl+Y no longer bypass the group-aware undo logic in favor of direct legacy `VoxelSpace` replay
- [x] Removed the remaining generic `undo(history, voxelSpace)` / `redo(history, voxelSpace)` fallback from active painter undo/redo flow; normal painter undo now stops at group structural/runtime history instead of silently dropping into the legacy replay engine
- [x] Tightened active painter cell-history typing so `CellChange.group_id` is required, painter canvas edit commits require an active group id, and shared history logging no longer accepts group-less cell changes in the active path
- [x] Renamed the remaining generic `history.ts` voxel-space replay exports to `undoLegacyHistory(...)` / `redoLegacyHistory(...)` and removed the stale painter import, isolating the old replay engine as explicit compatibility-only API
- [x] Unified active painter undo/redo onto a single main history stack replayed into authored runtime; removed the separate per-group history map/helpers and replaced them with one runtime replay path for both structural and cell actions
- [x] Reduced `make_painter_canvas_module(...)` from a full compat `VoxelSpace` dependency to a narrower camera/world-cell provider interface; the active painter canvas now reads camera pan and world cells from runtime-backed accessors instead of receiving the whole bridge object
- [x] Switched painter document bounds from fixed workspace extents to dynamic authored `x/y/z` extents that update on committed edits/imports, while keeping active strokes from resizing bounds mid-drag

Not done yet:

- [ ] renderer/projection still render from the legacy `VoxelSpace` bridge, not directly from group runtime
- [~] history/undo/redo is unified for active painter flow, but the shared/legacy history surfaces still need final cleanup and clearer separation from the active runtime-first model
- [~] save/load/export is mostly v3 group-document-native in active painter flows; remaining legacy voxel/grid compatibility is now isolated to clearly labeled fallback/import helpers

## Phase 1 Contract Checklist

The following contracts must exist before the broad refactor starts touching rendering and tools.

### Document Contracts

- [x] `PainterDocument.version === 3`
- [x] `PainterDocument.bounds` represents fixed editable workspace bounds only
- [x] `PainterDocument.occupied_bounds` is derived from authored voxel content only
- [x] `PainterDocument.groups` is the authoritative authored source of truth
- [x] `PainterDocument.group_order` is the only overlap precedence list

### Group Contracts

- [x] every group has stable `id`, `name`, `visible`, `locked`, `opacity`
- [x] every group stores sparse authored voxels only
- [x] a group may contribute at any workspace coordinate within bounds
- [x] multiple groups may contribute at the same coordinate

### Runtime Contracts

- [x] runtime normalization builds `group_voxel_index`
- [x] runtime normalization builds `coordinate_group_index`
- [x] runtime normalization builds `resolved_visible_index`
- [x] runtime normalization derives `occupied_bounds`
- [x] winner resolution is deterministic from runtime indexes plus `group_order`

### Editing Contracts

- [~] active group is the only mutation target for write/erase/paste in v1
- [x] focus plane is not a group identifier
- [x] copy reads active-group authored voxels only in v1
- [~] paste writes active-group authored voxels only in v1
- [~] lock blocks mutation of that group only
- [~] hide removes that group from winner resolution only

### History Contracts

- [~] cell history entries include `group_id`
- [~] authored writes undo within the same group only
- [~] per-group undo stacks are supported by the data model
- [~] structural history targets `group_id`, never `z`

### Multiplayer Contracts

- [x] authoritative snapshots contain authored groups, not only resolved winners
- [x] voxel commands target `group_id`
- [x] reorder commands target `group_order`
- [x] clients can derive resolved winners from authoritative authored data

## Replacement `voxel_space` API

The current `voxel_space.ts` mixes authored storage, plane-oriented helpers, and direct layer mutation. The replacement API should separate authored document operations from resolved render helpers.

Suggested replacement surface:

```ts
type CoordKey = string;

function make_painter_coord_key(x: number, y: number, z: number): CoordKey;

function create_painter_document(width: number, height: number, options?: {
  min_z?: number;
  max_z?: number;
  default_group_name?: string;
}): PainterDocument;

function create_painter_group(name?: string): PainterGroup;

function normalize_painter_document_runtime(document: PainterDocument): PainterDocumentRuntime;

function derive_painter_occupied_bounds(runtime: PainterDocumentRuntime): PainterDocument['occupied_bounds'];

function resolve_painter_voxel_winner(runtime: PainterDocumentRuntime, coord_key: CoordKey): ResolveVoxelWinnerResult;

function get_group_voxel(runtime: PainterDocumentRuntime, group_id: string, coord_key: CoordKey): PainterVoxelRecord | null;

function set_group_voxel(runtime: PainterDocumentRuntime, group_id: string, voxel: PainterVoxelRecord): void;

function erase_group_voxel(runtime: PainterDocumentRuntime, group_id: string, coord_key: CoordKey): void;

function reorder_painter_groups(runtime: PainterDocumentRuntime, next_group_order: string[]): void;

function set_group_visibility(runtime: PainterDocumentRuntime, group_id: string, visible: boolean): void;

function set_group_locked(runtime: PainterDocumentRuntime, group_id: string, locked: boolean): void;

function add_painter_group(runtime: PainterDocumentRuntime, group: PainterGroup, opts?: {
  insert_before_group_id?: string;
}): void;

function remove_painter_group(runtime: PainterDocumentRuntime, group_id: string): void;

function export_painter_document(runtime: PainterDocumentRuntime): PainterDocument;

function import_legacy_voxel_space_as_painter_document(legacy: VoxelSpaceExport): PainterDocument;
```

Replacement rules:

- `set_group_voxel` and `erase_group_voxel` must update all indexes and dirty resolved winners incrementally
- `reorder_painter_groups` and `set_group_visibility` may invalidate many resolved winners but must not mutate authored coordinates
- `export_painter_document` serializes array-based authored groups, not runtime maps
- old plane-oriented helpers should be isolated behind compatibility adapters until callers are migrated

Suggested file split:

- `src/ascii_painter/painter_document.ts` for authored document creation/import/export
- `src/ascii_painter/painter_document_runtime.ts` for indexes, occupied bounds, and winner resolution
- keep `src/ascii_painter/voxel_space.ts` temporarily as a compatibility facade while callers migrate

## Smallest Safe First Slice

The first implementation slice should create the new document/runtime helpers without changing painter rendering or tools yet.

### Scope

- [x] add authored painter document types and helpers
- [x] add runtime normalization/index building
- [x] add coordinate-key helper
- [x] add occupied-bounds derivation
- [x] add winner-resolution helper
- [x] add a focused test for overlap resolution and occupied bounds

### Out Of Scope

- [ ] no UI changes
- [ ] no renderer changes
- [ ] no projection changes
- [ ] no history rewiring yet
- [ ] no multiplayer protocol migration yet

### Why this is the right first slice

- it establishes the new data model without destabilizing the current painter
- it gives projection, renderer, and history code a concrete target to migrate onto
- it makes future refactors testable against deterministic winner-resolution behavior

### Files for the first slice

- `src/ascii_painter/painter_document.ts`
- `src/ascii_painter/painter_document_runtime.ts`
- `src/ascii_painter/painter_document_runtime.test.ts`
- optional minimal re-export touches in `src/ascii_painter/index.ts`

### Phase 1: Lock the Contracts

- [x] Define the v3 authored painter document schema.
- [x] Define stable `group_id` and `group_order` semantics.
- [x] Define the authored-data versus resolved-render split.
- [x] Define canonical runtime indexes for authored overlap.
- [~] Define active group vs focus plane app-state split.
- [x] Define fixed workspace bounds plus derived occupied bounds behavior.
- [ ] Define command/event payloads in `painter_protocol.ts` for groups.

Acceptance:

- [x] Architecture types exist on paper and do not rely on numeric Z as identity.
- [x] Winner resolution and authored write semantics are deterministic and explicit.
- [x] Document bounds behavior is explicit; authored `x/y/z` extents now resize from committed content rather than staying fixed, and active strokes do not resize bounds mid-drag.

### Phase 2: Remove Dangerous Reorder Semantics

- [x] Replace palette reorder semantics with explicit group order.
- [x] Remove any code path that renumbers Z coordinates to reorder authored content.
- [~] Split UI selection into `active_group_id` and `focus_plane`.

Acceptance:

- [x] Reordering changes overlap precedence without changing world voxel coordinates.

### Phase 3: Introduce Group Storage Behind Compatibility Adapters

- [x] Build group-based document model in `voxel_space.ts` or a successor module.
- [x] Add compatibility import path from legacy layer snapshots.
- [~] Add compatibility adapters so old painter flows can still read/write during migration.
- [x] Add resolved visible voxel derivation from authored group overlap.
- [x] Add runtime indexes for fast contributor lookup and winner resolution.
- [x] Add occupied-bounds derivation from authored voxel content.

Acceptance:

- [x] Legacy artwork imports into v3 groups without data loss.
- [x] Overlapping authored group voxels resolve correctly.

### Phase 4: Refactor Projection and Rendering

- [~] Replace layer iteration with resolved visible voxels derived from authored groups.
- [ ] Introduce projected painter cell/render fragment model.
- [ ] Refactor DOM renderer away from one-canvas-per-authored-layer assumptions.

Phase 4 additional progress:

- active painter navigation depth is now exposed through a dedicated module instead of relying only on wheel interaction or the layer/group palette
- swing/roll controls and depth stepping are now separated from group ordering semantics in the UI
- active painter projection is now driven directly from `PainterDocumentRuntime` resolved winners instead of first synthesizing a source `VoxelSpace`
- DOM renderer internals and perf/debug output now describe projected display slots more explicitly instead of reinforcing authored-layer semantics

Acceptance:

- [ ] Multi-plane groups render correctly in top and rotated views.
- [ ] Exact-coordinate overlaps honor group order.

### Phase 5: Refactor Editing and Selection

- [~] Introduce edit-target resolution based on active group.
- [~] Update painter canvas locking/visibility checks to group-based semantics.
- [ ] Keep focus plane for navigation and plane-relative editing only.
- [ ] Ensure erase/write operations affect only the active group's authored voxels.
- [ ] Decide default picking mode: resolved winner versus active-group-only edit affordances.
- [x] Implement active-group-only copy/paste behavior with preserved `x/y/z` offsets.

Phase 5 additional progress:

- file-menu clear now clears authored voxels from the active group instead of wiping the currently visible projected grid layer
- user-facing painter status/selection text now leans toward depth/group semantics instead of legacy layer/plane language
- painter canvas paste/type guards now treat active-group lock as the only active-flow edit lock instead of relying on selected-layer lock checks first
- active-group world copy now reads authored voxels directly from runtime group indexes instead of resolved compatibility voxel-space data

Acceptance:

- [ ] Writing to a top group does not destroy lower groups' overlapping authored voxels.

### Phase 6: Refactor History and Multiplayer

- [~] Replace layer history actions with group actions and delete unused layer-structural compatibility paths.
- [x] Update multiplayer persistence/store/protocol to v3 authored document snapshots.
- [x] Update bootstrap and patch event handling to group-aware revisions.
- [~] Introduce per-group undo stacks/commands.

Phase 6 completion note:

- multiplayer bootstrap/store/protocol now operate on authored v3 group documents
- host commands now cover group voxel edits, structural group actions, and group undo/redo
- a dedicated multiplayer patch smoke TAI passes against the authoritative local-host path
- remaining open items are primarily history cleanup and broader save/load/export cleanup rather than core multiplayer architecture

## Next Steps

1. Finish the temporary compatibility bridge.
Line items:
- keep lock/hide fully group-driven even when multiple groups eventually share the same `z`
- trim compatibility wrappers only after each remaining caller has a direct group/runtime-native path

2. Move rendering/projection onto resolved group winners.
Line items:
- replace legacy `VoxelSpace` rebuilds with projection against `resolved_visible_index`
- keep a thin legacy adapter only where modules still require it
- continue moving remaining legacy import helpers off legacy `VoxelSpace` as the source of projection state

3. Convert history from layer-oriented to group-oriented.
Line items:
- make `group_id` mandatory in cell history entries
- keep active painter structural actions on group history only and remove remaining legacy layer-history callers
- start per-group undo stacks

4. Migrate multiplayer storage/protocol.
Line items:
- bootstrap authored v3 group documents
- send `group_id`-targeted commands
- broadcast group-aware patch events

Acceptance:

- [ ] Host-authoritative painter document supports overlapping authored group edits and reordering.

### Phase 7: Prepare Animation Extensions

- [ ] Add reserved frame/delta data model fields to groups.
- [ ] Define breath-relative delta application rules.
- [ ] Keep animation implementation out of the base group migration unless needed for correctness.

Acceptance:

- [ ] Group model cleanly accommodates future frame/breath delta work without redesign.

## Testing Plan

- [ ] Add v2 layer snapshot -> v3 group migration tests.
- [ ] Add reorder tests proving no world Z mutation.
- [x] Add overlap resolution tests proving the topmost group wins at exact coordinate collisions.
- [ ] Add authored-index consistency tests for create/update/erase paths.
- [ ] Add dynamic document-bounds plus occupied-bounds derivation tests.
- [x] Add projection tests for groups spanning multiple Z planes.
- [x] Add history tests for rename/visibility/lock/reorder group actions.
- [x] Add authored-overlap undo/redo tests.
- [ ] Add per-group undo isolation tests.
- [ ] Add active-group-only copy/paste tests with preserved `x/y/z` offsets.
- [ ] Add multiplayer snapshot roundtrip tests for v3 authored documents.

## Risks

### 1. Authored vs Resolved State Confusion

The biggest risk is accidentally treating resolved visible voxels as the authoritative document model.

Mitigation:

- keep authored group data and resolved render data as separate explicit types
- ban direct persistence of resolved winners except for optional debug caches

### 2. Projection Contract Risk

The current projection adapter and canvas editing system are deeply tied to focused plane writeback.

Mitigation:

- introduce explicit projected-cell/edit-target types before large rewrites

### 3. Renderer Surface Risk

The current DOM renderer assumes one canvas per layer.

Mitigation:

- separate authored storage refactor from internal renderer surface strategy

### 4. Migration Risk

Old saved artwork and current multiplayer snapshots use v2 layer storage.

Mitigation:

- keep v2 import and one-way migration until v3 is stable

### 5. Tooling Risk

Many painter tools implicitly depend on `selected_z` and on the visible grid being the only authored truth.

Mitigation:

- add active-group edit context before changing tool semantics

### 6. Legacy Export Risk

Any fallback export to the old layer model will be lossy when overlaps exist.

Mitigation:

- keep legacy export explicit and warn when overlap data would collapse

### 7. Bounds Confusion Risk

If occupied bounds and fixed workspace bounds are mixed up, camera, export, and mutation rules will become unstable.

Mitigation:

- persist both concepts explicitly and use each for only its intended purpose

### 8. UI Abstraction Risk

If the painter keeps pretending groups are layers at the UI boundary, layer-specific assumptions will continue leaking back into runtime behavior and future game systems will inherit the wrong abstraction.

Mitigation:

- build a standard reusable `groups_module`
- make painter the first consumer instead of the defining abstraction
- keep painter/group semantics in app state and runtime, not in the UI module contract

## Open Decisions To Lock Next

- [ ] Confirm that multiple groups may contain voxels at the same exact coordinate.
- [ ] Confirm that the highest visible group in `group_order` wins exact-coordinate overlap resolution.
- [ ] Confirm that hiding/deleting the top group reveals the next lower group's voxel automatically.
- [ ] Confirm whether copy/paste should flatten into the active group in v1 or preserve overlap/group structure.
- [ ] Confirm whether selection defaults to active-group authored voxels or resolved-visible voxels.
- [ ] Confirm whether picking/eyedropper should sample the resolved winner only in v1.
- [ ] Confirm whether `frames` should be stored inline on groups or in a sibling animation structure.

Locked decisions in this revision:

- [x] Fixed workspace bounds remain the primary editable canvas extent.
- [x] Occupied bounds are derived from authored voxel content.
- [x] Copy reads from the active group only in v1.
- [x] Paste writes into the active group only in v1 using copied `x/y/z` offsets.
- [x] Hide removes a group from resolved rendering without deleting authored voxels.
- [x] Lock blocks edits to that group only.
- [x] Per-group undo is the default undo model.
- [x] The long-term UI direction is a reusable `groups_module`, not a painter-only or layer-only palette.

## Recommended Defaults

- [ ] Multiple groups may overlap at the same exact `x,y,z`.
- [ ] The highest visible group in `group_order` wins exact-coordinate rendering.
- [ ] Newly drawn voxels are written into the active group only.
- [ ] Erasing removes authored voxels from the active group only.
- [ ] Reorder edits `group_order` only.
- [ ] Copy/paste should flatten into the active group first, then gain overlap-preserving behavior later if needed.
- [ ] Animation should later use `base state + breath deltas`, not whole-document duplicated frames.

Recommended implementation default for scalability:

- [ ] Store authored voxels sparsely per group.
- [ ] Keep fixed workspace bounds for UX stability.
- [ ] Derive occupied bounds for framing/export/optimization.
- [ ] Cache resolved winners incrementally by dirty coordinate key.
- [ ] Keep edit targeting strictly active-group-only.

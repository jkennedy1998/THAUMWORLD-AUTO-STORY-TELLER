# ASCII Painter Breath Group Animation Architecture Plan

Date: 2026-04-29

## Intent

Define the next stable authored model for ASCII painter animation before implementation hardens in the wrong shape.

This plan establishes a breath-driven painter architecture that supports two animation channels on the same group:

- raster/content animation
- group/property animation

This pass is intentionally narrow. The first implementation target is:

- reshaping the `GROUPS` module into the new authoring layout
- adding a local per-user breath cursor
- adding snapped group location animation
- editing group location through the existing move tool by dragging the active group border

This plan treats the animation work as a schema-era change. Backward compatibility for older painter artwork is not a requirement.

## Relationship To Existing Plans

This plan builds on and partially supersedes:

- `docs/plans/2026_04_18_ascii_painter_group_architecture_plan.md`

The 2026-04-18 group plan remains the source of truth for:

- groups replacing legacy `layer = z slice` identity
- overlap resolution by `group_order`
- authored state vs resolved render state separation
- stable group identity across save/load/runtime/history

This new plan becomes the source of truth for:

- breath-driven painter animation architecture
- time-aware group schema direction
- `content_states` terminology and behavior
- shared auto-key authoring behavior across content and property channels
- group-level breath visibility span
- local painter timeline cursor behavior
- groups module timeline layout direction
- move-tool border interaction for group location editing
- project playback/settings ownership in a canvas settings module

Related architecture context:

- `docs/plans/2026_04_24_camera_target_unification_plan.md`

That plan remains relevant for interaction/session/view ownership, but this plan owns painter-specific breath animation semantics.

## Why This Plan Exists

The current painter has the right group foundation, but not yet the right animation foundation.

Current issues:

- the current `GROUPS` module is too flat and row-based for timeline authoring
- the current group schema is still mostly static-content-first
- the existing `frames` naming is too ambiguous now that `breath` is the real authored time unit
- the current move tool can move content, but not non-destructive group location-by-breath
- the painter has no canonical local per-user breath cursor yet
- raster animation and group/property animation need to coexist without becoming two separate architectures

The hard part is not playback speed or file export. The hard part is defining:

- one authored time unit
- one group schema that can support both content and property animation
- one resolution order for what the user sees at a breath
- one editing model for working on moved content without destructively baking movement into voxels

## Locked Terminology

### Breath

- the canonical authored time unit in the painter
- the discrete step used by the timeline
- the unit that content states and property keys resolve against

### Frames Per Second

- playback/display rate only
- controls the exposure rate of authored content during playback
- not the canonical authored storage/indexing unit

### Group

- an authored 3D content owner with time-aware behavior
- conceptually a 4D authored object: `x/y/z` plus breath-aware state resolution

### Content States

- the raster/content animation channel for a group
- a list of time-aware 3D content states owned by that group
- the preferred term over `frames`
- each content state has `breath_start`
- the active content state is resolved from the current interpolated point in time
- only snap interpolation exists in the first implementation pass, so resolution currently behaves as a held stepped state

### Property Animation

- lightweight keyed changes that affect how a group's content is presented rather than what the voxel content is
- location is the first property channel
- turn/trans/opacity may be added later

### Current Breath

- the local per-user timeline cursor
- changes what the user sees and edits
- is not itself authoritative document state

### Selection

- selection is not resolved by breath
- selection is world-bound rather than group-relative
- selection does not move automatically with group animation or group location changes
- selection remains static through time unless the user explicitly changes the selection itself

### Auto Key

- a shared authoring toggle used by both content edits and property edits
- controls whether edits create new entries at the current breath or snap to the nearest existing editable entry first

### Project Animation Range

- the project-level start breath and end breath
- the looped playback range for the painter session

## Locked Product Decisions

### General

- location is the only property animation implemented first
- keyframes are snapped only for now
- interpolation is out of scope for this pass
- turn/trans are deferred until location feels correct
- raster content editing is deferred until the base architecture is stable
- future interpolation systems may be added later, but this plan only locks snap interpolation behavior

### Key Resolution

- snapped property keys resolve using the latest key at or before breath `N`

### Key Creation

- dragging location at breath `N` creates a location key at `N` if one does not exist
- dragging location at breath `N` updates the location key at `N` if one already exists
- editing content at breath `N` creates a content state at `N` if one does not exist
- editing content at breath `N` updates the content state at `N` if one already exists

### Auto Key Behavior

- `auto key` is a shared toggle in the `GROUPS` module header
- `auto key` applies consistently to:
  - content edits
  - animatable group property edits such as location
- when `auto key` is on:
  - content edits create or update a content state at the current breath
  - property edits create or update the relevant property key at the current breath
- when `auto key` is off:
  - before the interaction is processed, time silently snaps to the nearest editable entry for the active channel
  - the edit is then applied at that snapped breath
  - if no editable entry exists for that channel, the interaction should do nothing rather than creating new data implicitly
- nearest means nearest absolute breath distance
- when equally near on both sides, ties resolve to the earlier breath
- snapping is channel-specific:
  - content edits snap to content states
  - location edits snap to location keys
  - later property channels should snap to their own key lists
- when manual mode snapping occurs, the visible `current_breath` cursor should update immediately so the user sees where the edit landed

### Interaction

- location editing uses the existing move tool
- there is no separate gizmo system for v1 location editing
- the active group border is the move-grab region
- only the active group gets hover/drag border behavior

### Playback Settings

- `frames per second` belongs in a new `canvas settings` module
- the canvas settings module also owns:
  - project animation start breath
  - project animation end breath
  - loop behavior
  - texture shader refresh/exposure controls

### Group Visibility Span

- each group has a `breath_start` and `breath_end`
- this works like After Effects visible start/visible end per layer
- this range is tracked on the group object, not per content state
- groups outside their breath span are hidden/inactive in the canvas
- groups outside their breath span remain available in the `GROUPS` module for management and editing

### New Group Creation

- when a new group is created, its `breath_start` is the creator's current local breath
- the first content state's `breath_start` also begins at that local breath

### Channel Isolation

- creating or updating a key/state only affects the edited channel
- content-state creation affects only the content channel
- location-key creation affects only the location channel
- future property channels such as turn/trans/opacity should follow the same rule

## Non-Goals For This Plan

- interpolation
- bezier/easing handles
- turn animation
- trans animation
- opacity animation UI
- preserving old painter documents/artwork
- migration-heavy legacy support
- final raster editing UX
- optimizing content-state storage beyond what is needed for correctness
- blocking painter work on perfect breath unification with the game engine

This plan also does not attempt to optimize storage by keeping a separate base-content path. The goal is to get one clean content-state architecture working first.

Breaths should stay exposed in the system so engine-side timing manipulation is possible later, but painter implementation should not stall if that game-wide unification is awkward right now.

## Architecture Thesis

The painter should model groups as authored time-aware objects.

Every group owns:

- authored identity and metadata
- a list of raster/content states over breath
- a group-level visible breath range
- lightweight property animation state

Authored content inside `content_states` uses group-local coordinates.

Resolved world placement is produced by combining:

- the active content state for the breath
- the group's resolved property state at that breath, starting with location

This is required so group content can be moved non-destructively.

Raster/content animation and group/property animation must share:

- one group object
- one breath cursor model
- one group timeline UI

But they should not be forced into the same authored storage structure.

The group therefore has two animation channels:

### A. Content Channel

- heavier-weight raster/content evolution over breath
- represented by `content_states`
- this is where the `x/y/z/b` concept lives
- every group always has at least one content state
- there is no separate `content_base` path in this architecture
- content inside each state is stored in group-local coordinates rather than resolved world coordinates

### B. Property Channel

- lighter-weight keyed presentation changes
- location is first
- represented by `location_base` and `location_keys`

This split allows the painter to support both redraw animation and non-destructive motion without creating separate object types for each animation mode.

## Corrected Group Model

Each group should be treated as an authored object containing:

- identity and metadata
- `content_states`
- `breath_start`
- `breath_end`
- `location_base`
- `location_keys`

Rules:

- every group is time-aware even if it only has one content state at first
- every group must have at least one content state
- `content_states` are not separate groups and not separate layers
- content state voxel coordinates are group-local authored coordinates
- the group-level breath range determines when the group is active/visible for animation playback
- content states do not each need their own end range
- each content state has its own `breath_start`
- each content state remains active until the next content state starts
- the group's `breath_end` is the cutoff point for that group's activity
- the first content state's `breath_start` should match the group's `breath_start`

This matches the intended After Effects-style visible start / visible end behavior on the group while keeping content states simple and start-based.

## Planned Schema Direction

This plan introduces a new painter document era. The exact final code shape can be refined during implementation, but the architecture should move in this direction:

```ts
type PainterDocument = {
  version: 4;
  bounds: ...;
  occupied_bounds?: ...;
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
  breath_start: number;
  breath_end: number;
  content_states: PainterGroupContentState[];
  location_base: { x: number; y: number; z: number };
  location_keys: PainterGroupLocationKey[];
  metadata?: {
    created_at?: string;
    modified_at?: string;
    origin?: { x: number; y: number; z: number };
  };
};

type PainterGroupContentState = {
  id: string;
  label: string;
  breath_start: number;
  content: PainterVoxelRecord[];
};

type PainterGroupLocationKey = {
  breath: number;
  offset: { x: number; y: number; z: number };
};
```

Important direction:

- the old `frames` field is no longer the conceptual center
- `content_states` replaces that framing
- there is no separate `content_base` path
- each content state is start-based and holds until the next content state starts
- the group-level `breath_start` / `breath_end` acts as the visible cutoff range
- `location_keys` are exact-key entries resolved by latest key at or before `N`
- new groups are created with one initial empty content state whose `breath_start` equals the group's `breath_start`
- content state voxel records are authored in group-local coordinates

This plan does not yet lock whether later content states should store full sparse 3D content, deltas, or references. It only locks the authored resolution model.

## Resolution Order

At breath `N`, the painter should resolve what the user sees in this order:

1. resolve the local user `current_breath`
2. for each group, check whether `current_breath` is within `group.breath_start <= N <= group.breath_end`
3. resolve the group's active content source:
   - the content state resolved at the current interpolated point in time
   - with snap interpolation in this first pass, that means the latest `content_state` with `breath_start <= N`
4. resolve the group's effective location:
   - `location_base`
   - overridden by the latest location key with `breath <= N`
5. project the resolved group-local content into world/render space using the resolved location
6. resolve visible overlap winners by `group_order` and visibility as defined in the 2026-04-18 group plan

This intentionally separates:

- authored content resolution
- property resolution
- spatial placement
- visible overlap resolution

The runtime should expose explicit helpers for this resolution pipeline before major animation UI work begins.

Authored document bounds should be derived from the union of all group content states across all groups.

Active group world-space borders and hit targets should use the resolved current-breath bounds only.

When a new key or content state is created, it should initialize from the resolved/interpolated value at that breath.

In the first implementation pass, interpolation mode is snap, so this initialization uses the currently held snapped result.

## Project-Level Playback And Canvas Settings

Project playback settings belong to a new `canvas settings` module.

That module should own:

- `frames per second`
- project animation start breath
- project animation end breath
- loop behavior
- texture shader refresh/exposure controls

Clarifications:

- these are project/canvas playback settings, not group-authored animation state
- `frames per second` controls how authored content is exposed during playback
- `breath` remains the canonical authored storage/timeline unit
- breaths should stay visible and available in the broader system so engine-driven timing manipulation is possible later

The painter should grow toward engine-aware breath timing without making that the blocker for the first animation implementation.

## Pre-Implementation Prerequisites

Before the main animation implementation phases, the codebase should be prepared in a few targeted ways so the work does not sprawl.

### 1. Lock The Local-Vs-World Content Seam

- content states are authored in group-local coordinates
- resolved world content is produced from local content plus resolved group location
- inverse-mapped editing must target group-local authored content
- this seam should be represented by explicit helper functions before UI-heavy animation work starts

### 2. Introduce Version 4 Plumbing Early

- save/load/autosave/export paths should recognize the version 4 painter document shape before animation behavior spreads across version 3 assumptions
- this is a clean schema-era break, not a compatibility-first migration exercise

### 3. Define Protocol And History Shapes Early

- explicit command and history shapes should be planned for:
  - content-state creation/update
  - location-key creation/update
  - group breath-range edits
  - later project animation settings if they become authoritative
- the exact implementation can remain phased, but the intended shape should be known before deep UI work

### 4. Add Breath-Aware Runtime Query Helpers

- helper surfaces should exist for:
  - resolving the active content state at a breath
  - resolving the effective property value at a breath
  - finding the nearest editable entry for manual mode
  - resolving current-breath group bounds
- this will reduce repeated ad hoc scans across UI and interaction code

### 5. Normalize Groups Module Ordering Assumptions

- current display-order reversal behavior should be cleaned up or isolated before the groups module is reshaped into timeline sections
- this reduces confusion when group ordering and timeline authoring exist in the same module

## Groups Module Architecture

The existing `GROUPS` module should be reshaped, not replaced.

The first implementation step is a layout refactor so the module becomes a sustainable authoring shell for animation work.

Target layout direction:

- top panel header
- header toggle area for `auto key`
- per-group section/card rather than one flat row per group
- left controls area:
  - parent
  - mask
  - hide
  - order
  - dupe
  - del
- middle property labels:
  - move first
  - turn later
  - trans later
- right timeline area:
  - breath ruler
  - current breath cursor
  - location key markers
- later content/property tracks

Layout/spacing work comes before deep animation behavior because it creates room for sustainable incremental feature growth.

The reshaped module should continue to support group reorder so the animation UI refactor does not regress current authored stacking workflows.

## Timeline Cursor Model

The painter needs a local per-user timeline cursor:

- `current_breath`

Rules:

- `current_breath` is local per user instance
- different users may scrub/play independently
- changing `current_breath` changes what the user sees and edits
- changing `current_breath` does not itself mutate authoritative document state

Required controls:

- click timeline to jump to breath
- keyboard step backward by 1 breath
- keyboard step forward by 1 breath

When `auto key` is off and an edit snaps to the nearest editable entry, `current_breath` should update before the click/drag is processed.

This keeps animation authoring comfortable in multiplayer/shared contexts.

## Move Tool Border Interaction

Location editing should reuse the existing move tool.

Rules:

- if the move tool is active and the pointer grabs the active group border, enter group-location drag mode
- if the move tool is active and the pointer is not on the active group border, fall back to existing move behavior
- active group only gets hover/drag border behavior
- groups outside their visible breath span do not get a world border
- hidden groups do not get a world border
- locked groups do not allow border-drag editing
- if `auto key` is off and there are no location keys to snap to, border drag does nothing

Visual states:

- dim border when the active group is not hovered
- bright border when hovered with the move tool
- vivid border when actively dragging location

This is the least-rewrite path because it builds on the current move tool and bounds visualization instead of introducing a separate gizmo system.

## Editing Semantics

### Group Location Drag

- edits group location keys
- does not rewrite voxel content
- creates a location key at the current breath if one does not exist
- updates the location key at the current breath if it already exists
- when a new location key is created, it initializes from the currently resolved value at that interpolated point in time
- with snap interpolation in this first pass, that means the new key initializes from the currently held snapped value
- location-key edits only affect the location channel

### Content Move

- remains a distinct operation
- rewrites content when the user is not doing group-location border dragging

### Drawing Onto Moved Groups

- when the user draws where they see a moved group, the system must inverse-map from resolved world position into the authored/local content space for the active content source
- location therefore remains non-destructive

### Content State Editing

- content edits target the active content channel entry for the breath being edited
- when `auto key` is on and a new content state is created, it initializes from the currently resolved value at that interpolated point in time
- with snap interpolation in this first pass, that means the new content state initializes from the currently held snapped content
- when `auto key` is off, content editing snaps to the nearest existing content state before the edit is processed
- content-state edits only affect the content channel
- if the group is outside its breath span, canvas content edits miss, emit a debug message, and do not interrupt the user

### Raster Content Editing Later

- future raster content editing should target the resolved active `content_state` at the current breath
- that raster editing workflow is not part of the first implementation pass

The painter must keep these operations distinct:

- content edits
- property edits
- resolved display

### Selection Behavior Across Breath Changes

- changing breath does not retarget or remap the selection
- selection is not rebuilt from the current content state on every breath change
- selection remains spatially unchanged as breath changes
- selection does not move automatically when the group's location animation changes
- this first pass keeps selection behavior intentionally simple and stable

Groups may still be selected and managed through the `GROUPS` module even when they are hidden/inactive in the canvas because of breath span.

## Document Compatibility Strategy

This is a schema-era change.

Rules:

- older painter artwork compatibility is not a blocker
- new painter documents can start cleanly from the new model
- no major planning effort should be spent on preserving old files for this pass

Legacy support may remain import-only or best-effort if convenient, but it is not a source-of-truth requirement for this plan.

Save/load/autosave/export detection for the new document version should be treated as part of the schema pass rather than as a later cleanup.

## Implementation Phases

### Phase 1: Groups Module Layout Refactor

- [~] reshape `GROUPS` into a section-based layout
- [~] create left-control, property-label, and timeline regions
- [~] preserve current controls where practical

Timeline viewport note:

- the top timeline ruler acts as the shared project timeline viewport for the module
- group row content and keyframes should use the same horizontal breath-to-X mapping as that ruler
- the ruler may be panned so longer timelines do not require excessively wide modules

### Phase 0: Prerequisite Architecture Cleanup

- [x] lock helper functions for group-local content <-> resolved world content mapping
- [x] add version 4 schema plumbing across save/load/autosave/export detection
- [x] define intended protocol/history shapes for content-state and location-key edits
- [x] add breath-aware runtime query helper seams
- [x] normalize or isolate current groups-module ordering assumptions
- [x] define debug/log behavior for out-of-span canvas edit attempts without interrupting the user

### Phase 2: Terminology And Schema Pass

- [~] add breath-aware naming in code and docs
- [~] replace conceptual `frames` emphasis with `content_states`
- [~] add group-level `breath_start` / `breath_end`
- [~] remove separate base-content assumptions from the group model
- [~] require at least one initial content state per group
- [~] add `location_base` / `location_keys`
- [~] update save/load/autosave/export detection for the new document version
- [x] create new groups at the creator's current local breath

### Phase 3: Local Breath Cursor

- [~] add local `current_breath`
- [~] add keyboard stepping
- [~] add timeline click navigation

### Phase 4: Location Resolution

- [~] resolve effective group location at breath `N`
- [~] use latest key at or before `N`

### Phase 5: Runtime Integration

- [~] resolve one active content map per group at the current breath before winner resolution
- [~] apply resolved location during runtime/render resolution
- [~] keep authored content canonical and non-destructive
- [~] derive authored document bounds from the union of all content states
- [~] keep content states authored in group-local coordinates

### Phase 6: Border Hover / Hit Detection

- [~] add projected active-group border detection
- [~] add dim/bright/vivid border states

### Phase 7: Move Tool Border Drag

- [~] enter location-edit mode from active-group border dragging
- [~] create/update location key at current breath

### Phase 8: History / Sync

- [~] add history entries for location edits
- [~] add authoritative protocol/store support for location changes

### Phase 9: Content States Later

- [ ] introduce raster/content-state resolution
- [~] later add drawing/editing into `content_states`

## Testing Plan

### Groups Module

- [ ] section layout spacing matches the intended authoring shell
- [ ] left controls and timeline area remain clickable and readable
- [ ] scrolling works with section-based heights

### Breath Cursor

- [ ] keyboard step changes local breath
- [ ] timeline click sets local cursor
- [ ] local cursor changes do not corrupt document state
- [ ] manual-mode edit snapping updates the visible cursor before the interaction resolves

### Auto Key

- [ ] shared auto-key toggle applies consistently to content edits and location edits
- [ ] auto-key off snaps to the nearest absolute-breath editable entry for the active channel
- [ ] ties resolve to the earlier breath
- [ ] missing editable entries do not create data implicitly when auto-key is off

### Location Keys

- [ ] drag creates a key if absent at the active breath
- [ ] drag updates the exact key if it already exists
- [ ] snapped hold behavior uses latest key at or before `N`

### Move Tool Border Interaction

- [ ] hovering the active border changes visual intensity
- [ ] dragging the border edits location rather than voxel content
- [ ] dragging elsewhere still follows existing move logic

### Drawing On Moved Groups

- [ ] drawn content lands where the user expects visually
- [ ] authored content remains non-destructive under location offsets
- [ ] inverse mapping writes back into group-local content coordinates

### Selection

- [ ] selection remains stable across breath changes
- [ ] selection remains world-bound rather than following group movement
- [ ] selection is not rebuilt from content-state changes on every breath step

### Content States

- [ ] every group has at least one initial content state
- [ ] the first content state begins at the group's `breath_start`
- [ ] new content states created by auto-key initialize from the resolved held content at that breath
- [ ] out-of-span content edits miss and log debug information without interrupting the user

### Group Span

- [ ] group is active only within `breath_start` / `breath_end`
- [ ] group is cut off cleanly outside that range
- [ ] groups remain manageable in the `GROUPS` module even when hidden in the canvas by breath span

## Acceptance Criteria

This architecture pass is successful when:

- the `GROUPS` module visually supports per-group timeline authoring layout
- the painter has a local per-user `current_breath`
- shared auto-key behavior is defined and consistent across content and location editing
- active group location resolves by breath using snapped keys
- dragging the active group border with the move tool creates/updates a location key at the current breath
- content editing creates/updates content states according to the same auto-key rules
- content states are authored in group-local coordinates and resolve non-destructively into world space
- selection remains stable across breath changes and stays world-bound
- out-of-span canvas edits miss safely and only emit debug information
- creating/updating a key or state only affects its own channel
- drawing onto a moved group edits authored content correctly through inverse mapping
- project playback settings have a clear owner in the planned `canvas settings` module
- old painter artwork compatibility is not treated as a blocker

## Open Questions / Deferred Decisions

- whether content states eventually store full sparse 3D content, deltas, or references
- later turn/trans/opacity authoring UX
- interpolation handles and inbetween behavior
- final playback controls in `canvas settings` module
- future engine-level breath synchronization details if game integration becomes necessary

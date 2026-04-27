# Engine Interaction Architecture Plan

Date: 2026-04-24

## Intent

Define the engine architecture for input, interaction, view ownership, camera/projection, and module-to-module targeting before implementation details harden in the wrong shape.

This plan is architecture-first.

The goal is to build a reusable engine runtime that can support:

- ASCII painter
- THAUMWORLD place interactions
- inventory and container interactions
- module-to-module drag/drop flows
- future 2D, 3D, and hybrid modules

This plan replaces the earlier idea that one persistent `camera_target_world` should unify everything.

The correct unification target is:

- one input runtime
- one interaction orchestrator
- one view runtime
- one resolved target model
- one interaction session runtime
- one camera/projection runtime
- thin game/app glue on top

## Problem Statement

The current system mixes together concerns that should be separated:

1. input normalization
2. module routing
3. drag/session ownership
4. camera framing
5. focus/depth
6. resolved target typing
7. consumer-specific semantics

Those responsibilities are currently spread across painter, place, and app glue in overlapping ways.

That causes large-scale problems:

1. interaction state is duplicated in multiple consumers
2. camera behavior and interaction targeting can accidentally couple
3. cross-module drags do not share one engine session model
4. resolved targets exist implicitly, but not as one explicit engine contract
5. renderer behavior remains partially app-owned instead of engine-owned
6. legacy focus/camera compatibility state still leaks into hot paths

Concrete symptoms already observed:

- painter preview and release can disagree
- camera framing can accidentally follow stroke targeting
- place and painter both maintain gesture/session logic separately
- drag legality/highlighting infrastructure is harder to generalize than it should be

## Architecture Thesis

The engine should own the general mechanics of interaction.

Consumers should own the meaning of interaction.

That means:

- the engine decides how inputs become normalized interaction events
- the engine decides which module/view owns an interaction session
- the engine resolves pointer positions into typed targets
- the engine owns per-view camera/projection state
- consumers decide what a resolved interaction means for their own domain

Examples:

- the engine knows that a drag started on an `inventory_slot` and is hovering an `equipment_slot`
- the game decides whether that item is legal for that slot
- the engine knows that painter is dragging across resolved `painter_cell` targets in a specific view
- painter decides what that means for line, rect, text, or selection behavior

## Locked UX Decisions

The following UX decisions are locked for this architecture unless a later plan explicitly changes them.

### Drag Ownership

Source capture is the default engine rule.

- the module/view where the interaction starts owns the session
- hovered modules do not take ownership mid-drag by default
- hovered modules may still receive resolved targets, compatibility checks, and highlight updates

This keeps drag continuity safe and predictable across modules.

### Wheel During Active Drag

Wheel behavior is module-defined, but the engine must route wheel events through the active captured session.

Painter default:

- wheel during an active drawing drag affects depth/focus behavior
- wheel does not pan or zoom during that interaction by default

### Cross-Module Highlighting

Compatibility/highlight routing should be globally typed.

- the orchestrator may compute compatible targets across modules
- the engine provides the typed connection between payloads and targets
- consumers provide legality/meaning rules

### Multi-View Interaction Authority

The view under the pointer is authoritative for active interaction resolution.

- the active session resolves against the pointed-at `view_id`
- other linked views may mirror state visually
- mirrored views are not authoritative interaction owners unless a future plan adds linked interaction explicitly

### Keyboard Ownership

Keyboard semantic modes remain consumer-owned.

- the engine normalizes raw key input
- consumers own text modes, edit modes, and domain-specific keyboard semantics
- the shared interaction session should not become a generic text-edit state machine

### Multi-Target Resolution

An interaction may carry multiple simultaneously resolved targets at one pointer position.

- resolved targets should be ranked by priority
- the session should expose a primary target plus ordered secondary targets
- consumers may use lower-priority targets for behaviors like auto-select, hover previews, or layered hit testing

This is important for cases where one pointer position can validly resolve to more than one useful target.

Examples:

- a place view resolving both `place_tile` and `place_item`
- a painter view resolving both a cell target and a broader plane/depth target
- future layered selection behaviors similar to Photoshop-style auto-select

### Hover Uses The Same Resolution Pipeline

Hover should use the same resolved-target pipeline as active interactions.

- hover resolution should produce the same target types and ordering model as drag/down/up interactions
- hover and drag should not diverge into separate target systems
- compatibility and highlight routing should be coordinated across hover and active session updates

The difference is lifecycle, not resolution shape.

- hover may exist without an interaction session
- active interactions use the same resolution pipeline plus session ownership/capture

## Runtime Layers

### 1. Input Runtime

The input runtime owns raw client input normalization.

It should normalize:

- pointer move
- pointer down
- pointer hold/drag
- pointer up
- wheel
- keyboard
- modifier state
- pointer capture/cancel conditions

It should not decide tool behavior.

Its output should be normalized engine input events.

### 2. Interaction Orchestrator

The interaction orchestrator routes normalized input into engine interaction sessions.

It owns:

- which module/view is hit
- which module/view captures continued drag/up events
- how interactions continue safely across hold and release
- how drag payloads move between modules
- how hover and active targets are tracked

It is the layer that turns down/hold/release into one coherent engine interaction.

This is where module-to-module safety should live.

Implementation responsibilities:

- hit-test the current pointer against registered views
- create sessions on pointer down when a module accepts interaction
- maintain source capture through drag/release by default
- route wheel/key input to the active session owner when appropriate
- expose hovered target updates to non-owning modules for highlight/compatibility purposes
- use the same target-resolution pipeline for hover and active interactions

### 3. View Runtime

The engine owns view instances.

A module may expose one or more views.

Examples:

- one painter document shown in two canvases with different views
- multiple world/place panels with different orientations
- future inset, split, mirrored, or inspection views

Each view instance should have:

- `module_id`
- `view_id`
- `space_kind`: `2d`, `3d`, or `hybrid`
- viewport/screen rect
- camera state
- projection state
- view configuration

Views are engine-owned even when their content is consumer-owned.

Implementation requirements:

- views must be registrable/unregistrable at runtime
- views must expose enough geometry for hit-testing and resolution
- multiple views may point at the same underlying content id while keeping distinct camera state
- the engine must not assume one view per module

### 4. Resolution Model

Every interactive module should expose resolution behavior.

Resolution means turning pointer/input state into typed data targets.

Two broad categories exist:

- 2D resolution
- 3D resolution

These are both valid engine concepts.

Examples of 2D resolution:

- inventory slot
- equipment slot
- text character cell
- panel region
- button or surface segment

Examples of 3D resolution:

- painter cell/voxel target
- place tile
- place item/entity hit
- world depth plane target

The engine should treat them as resolved targets, not as one special-case world-only model.

Implementation requirements:

- every interactive module must provide a resolution adapter or explicitly opt out
- adapters may resolve 2D targets, 3D targets, or both
- resolution should be view-relative first, then consumer-specific
- resolved targets must be stable enough to survive drag/update/release comparisons
- hover resolution and active interaction resolution must share the same target model and ranking rules

### 5. Interaction Session Runtime

An interaction session is the shared engine object for a long-lived interaction.

It should represent:

- start
- current
- end
- source
- capture owner
- resolved targets
- payload data when relevant

The session should be generic enough for:

- painter gestures
- place move drags
- place shape drags
- UI inventory drags
- place-to-UI and UI-to-place drags

Implementation requirements:

- sessions must be explicitly created, updated, ended, or canceled
- a session must track both pointer state and resolved target state over time
- a session may optionally carry payload state, but payload state is not required for all interactions
- source capture must be explicit, not implicit in consumer-local booleans

### 6. Camera And Projection Runtime

The engine owns camera and projection per view instance.

This is separate from interaction semantics.

The camera/projection runtime should own:

- framing anchor
- focus target
- focus plane
- orientation/view mode
- transition state
- parallax / soft-rotation response
- projection derivation

This is important because different views may watch the same data with different camera settings at the same time.

Implementation requirements:

- camera state must be keyed by `view_id`
- the engine must support multiple simultaneous 3D-capable views with distinct camera settings
- parallax/soft-rotation behavior must pivot from the owning view's camera state, not shared global mouse state alone
- projection state must be derived from per-view camera state and consumer data, not stored ad hoc in multiple consumers

### 7. Consumer Module Semantics

Consumers own domain meaning.

Examples:

- painter tool semantics
- place mutation semantics
- item legality rules
- text entry behavior
- commit/validation logic

Consumers should not own the general interaction runtime or camera/projection runtime.

## Core Engine Concepts

### Input Event

A normalized engine input event produced by the input runtime.

Examples:

- pointer down
- pointer move
- drag update
- pointer up
- wheel depth step
- key press

Minimum fields should include:

- `pointer_id` when applicable
- `button` or button-state data when applicable
- modifier snapshot
- screen coordinates
- timestamp
- input phase/type

### View Instance

A concrete engine-owned view attached to a module.

Key identity:

- `module_id`
- `view_id`

Recommended fields:

- `space_kind`
- viewport rect
- z-order / hit-test priority
- capability flags
- camera/projection references
- consumer content reference

### Resolved Target

A resolved target is a typed interaction result returned by a module resolution layer.

It should be modeled as a tagged union, not one weak generic object.

Examples:

- `PainterCellTarget`
- `PlaceTileTarget`
- `PlaceItemTarget`
- `InventorySlotTarget`
- `EquipmentSlotTarget`
- `TextCellTarget`
- `UiSurfaceTarget`

Shared fields should include:

- `module_id`
- `view_id`
- `domain`
- `target_type`
- `target_ref`
- `screen_position` when available
- `local_position` when available
- `world_position` when available
- compatibility or highlight metadata when useful

Recommended additional fields:

- `resolution_stage` or adapter source
- consumer data handle or lightweight lookup key
- optional `accepts_payload_kinds`
- optional `highlight_kinds`
- optional `priority`
- optional `resolution_group`

### Interaction Session

The engine interaction session should track:

- `interaction_kind`
- `status`
- `source_module_id`
- `source_view_id`
- `capture_owner`
- `pointer_start`
- `pointer_current`
- `pointer_end`
- `resolved_start_target`
- `resolved_current_target`
- `resolved_end_target`
- `resolved_start_targets`
- `resolved_current_targets`
- `resolved_end_targets`
- optional drag payload
- optional metadata

Recommended additional fields:

- `session_id`
- `pointer_id`
- `started_at`
- `updated_at`
- `ended_at`
- `wheel_policy`
- `cancel_reason` when canceled

World start/current/end is still useful, but only as one kind of resolved data, not the entire abstraction.

Priority rule:

- the session should expose one primary resolved target for common consumers
- the session should also expose the ordered resolved target list for advanced consumers
- the orchestrator should preserve target ordering from the resolution adapters or apply an explicit engine ranking rule

Suggested lifecycle:

1. orchestrator receives normalized pointer-down
2. hit-tested view/module resolves a start target
3. engine creates session and assigns source capture
4. pointer move / drag updates pointer and resolved current target
5. hovered non-owning targets may still receive compatibility/highlight updates
6. pointer up resolves end target and ends session
7. cancel paths explicitly mark the session canceled

Hover rule:

- the orchestrator should be able to resolve ordered hover targets using the same adapters without creating a session
- once an interaction begins, session targets should continue from the same target pipeline

### Drag Payload

Drag payload is separate from the interaction session itself.

Examples:

- item payload
- selection payload
- painter tool payload
- future entity or UI payloads

The engine should route payloads safely.

The consumer should decide the meaning and legality of the payload.

Suggested payload shape:

- `payload_kind`
- `source_module_id`
- `source_view_id`
- typed payload body
- optional compatibility tags
- optional preview metadata

## Camera And View Architecture

### Per-View Ownership

Each view owns its own camera state.

That includes:

- framing anchor
- focus target
- focus plane
- view mode/orientation
- transition settings
- parallax / soft-rotation state

This is engine-owned, not consumer-owned.

### Multiple Views Over The Same Data

The same painter/place/document/runtime may appear in multiple views.

Those views may differ in:

- orientation
- projection
- focus target
- framing anchor
- transition/parallax behavior

The engine must support this explicitly.

### Camera Framing Is Not Interaction Targeting

This is locked.

Interaction targeting must not automatically become the framing anchor.

For painter specifically:

- drawing should not pan the camera in response to pointer motion
- scrolling depth during drawing may affect focus/depth
- the camera pivot/framing remains view-owned

### Projection Contract

Projection inputs should stay explicit.

- `projection_anchor_world` means framing anchor
- `target_world` means focus-driving target

Consumers must not pass the same live pointer world as both by default.

Recommended per-view camera shape:

- `frame_anchor`
- `focus_target`
- `focus_plane`
- `orientation`
- `projection_mode`
- `transition_state`
- `parallax_settings`
- `soft_rotation_settings`

For painter-style draw interactions, the implementation rule is:

- pointer movement updates resolved interaction targets
- camera framing does not follow pointer motion by default
- depth-affecting input may update focus-related camera state

## Module Capability Model

Modules should declare capabilities to the engine.

Examples:

- `resolves_2d_targets`
- `resolves_3d_targets`
- `accepts_drag_payloads`
- `produces_drag_payloads`
- `supports_text_input`
- `supports_wheel_depth`
- `owns_view_instances`

This allows the orchestrator to route interactions intentionally instead of relying on consumer-specific ad hoc assumptions.

Recommended capability contract:

- a module registers one or more views
- each view declares its capabilities
- each capability points to an adapter or handler surface
- missing capabilities mean the orchestrator should not attempt that interaction path

Examples:

- a container surface may resolve 2D slot targets and accept item payloads
- a painter canvas may resolve 2D grid cells and 3D cell/world targets, support wheel depth, and produce selection payloads
- a place view may resolve place tiles/items/entities and accept item payloads

## Compatibility And Highlight Routing

The engine should support typed compatibility routing without owning gameplay legality.

That means the engine can provide the structure for:

- dragged payload type
- hovered target type
- allowed target classes
- highlight channels
- acceptance/rejection state

Examples:

- item payload hovering compatible slot targets
- painter selection payload hovering paste/placement targets
- future entity payloads hovering legal world targets

The engine should support the connection.

The consumer should decide the legality rules.

Implementation rule:

- the orchestrator should be able to ask hovered targets whether they can evaluate a payload kind
- the engine may aggregate compatible hovered targets for highlight purposes
- highlight state should be derived from typed payload/target compatibility, not from ad hoc string matching in one consumer

This is intentionally not a gameplay legality engine.

It is a typed routing and highlight support layer.

## Consumer Patterns

### Painter

Painter should consume:

- engine view instances
- engine interaction sessions
- engine camera/projection runtime
- resolved `painter_cell` or related targets

Painter-specific semantics remain consumer-owned:

- pencil
- eraser
- line
- rect
- selection
- text behavior

### Place / THAUMWORLD

Place interactions should consume:

- engine view instances
- engine interaction sessions
- resolved place tile/item/entity targets

Place-specific semantics remain consumer-owned:

- moving items/entities
- shape tools
- tile painting
- place mutation rules

### Inventory / Container UI

Inventory and container surfaces should consume:

- engine interaction sessions
- resolved slot targets
- typed payload routing

Inventory-specific semantics remain consumer-owned:

- item legality
- equip rules
- transfer rules
- stack/container semantics

## Consumer Integration Contract

Each interactive consumer should integrate with the engine through explicit adapters.

Minimum adapter surfaces:

### View registration adapter

Provides:

- view identity
- viewport geometry
- capability flags
- camera/projection linkage

### Resolution adapter

Provides:

- resolve target from input state
- resolve hover target updates
- optional world/local/screen coordinate mapping

### Session handler adapter

Provides:

- begin interaction callback
- update interaction callback
- end interaction callback
- cancel interaction callback

### Payload compatibility adapter

Provides:

- can this target type consider this payload kind
- what highlight/acceptance state should be exposed to the orchestrator

### Consumer commit adapter

Provides:

- how the consumer applies the final interaction meaning
- validation and mutation behavior

## Migration Cases

The architecture must be validated against these concrete cases before it is considered stable.

### Case 1: Painter line/rect/select drag

- source capture remains with the painter view
- resolved targets update through the active painter view only
- wheel during drag updates painter depth behavior
- preview and release use the same session authority

### Case 2: Place entity/item move drag

- source capture remains with the originating place view
- hovered place targets update legality/highlight state
- commit remains consumer-owned in place logic

### Case 3: Inventory slot to equipment slot drag

- source capture remains with the inventory view/module
- hovered equipment slots receive compatibility/highlight routing
- legality is decided by consumer logic, not engine routing

### Case 4: Place-to-UI and UI-to-place drag

- session remains shared across modules
- source module keeps capture
- target modules receive typed target and payload compatibility checks
- no second drag runtime is created for cross-module cases

### Case 5: Multiple views over same content

- active interaction resolves against the view under the pointer
- non-active linked views may mirror visual state only
- per-view camera state remains independent

## Locked Direction

### 1. One engine interaction runtime

There should not be separate long-term drag/session systems for painter, place, and UI.

### 2. One engine resolved target model

Resolved targets should be typed and explicit across 2D and 3D consumers.

### 3. One engine view runtime

View instances and camera ownership belong to the engine.

### 4. Camera runtime and interaction runtime are separate

Interaction state must not become camera framing state by default.

### 5. Consumers own semantics, not runtime mechanics

Consumers decide meaning, validation, and mutations.

The engine decides routing, targeting, framing, and session continuity.

### 6. Source capture is the default drag rule

Cross-module drags keep source ownership unless a future plan explicitly introduces transfer semantics.

### 7. Keyboard semantic modes stay consumer-owned

The engine normalizes raw input.

Consumers own text/edit mode semantics.

## Major Non-Goals

- no single overloaded `camera_target_world`
- no painter-only interaction runtime becoming the engine abstraction
- no world-only interaction model that ignores 2D slot/surface targets
- no generic legality system inside the engine
- no hidden compatibility focus state remaining as hot-path authority

## Large-Scale Migration Goals

1. establish explicit engine vocabulary for input, views, targets, sessions, and camera state
2. replace consumer-local gesture/session ownership with shared engine session ownership
3. make per-view camera ownership explicit
4. standardize typed resolved targets across painter, place, and inventory surfaces
5. make compatibility/highlight routing engine-supported but consumer-authored
6. reduce legacy focus/camera glue and duplicated drag state
7. encode source capture and per-view authority explicitly so consumers stop reinventing them

## Implementation Layers

Progress status:

- Layer 1: in progress
- Layer 2: in progress
- Layer 3: started
- Layer 4: started
- Layer 5: started
- Layer 6: not started
- Layer 7: not started

### Layer 1: Shared Language

Status: in progress

Define shared types and names for:

- input events
- view instances
- resolved targets
- interaction sessions
- drag payloads
- camera/projection state

This layer should happen before deeper rewrites.

Deliverables:

- shared type definitions
- naming guide for new runtime concepts
- mapping from current painter/place/app-state concepts into the new vocabulary

Completed so far:

- shared type modules added under `src/mono_ui/runtime/`
- `ViewInstance`, `ResolvedTarget`, `InteractionSession`, drag payload, and capability surfaces defined

### Layer 2: Shared Interaction Flow

Status: in progress

Create the engine session model that can represent:

- pointer down/hold/release
- source/target module ownership
- captured interaction continuity
- resolved targets over time
- drag payload state

Deliverables:

- session lifecycle helpers
- capture ownership rules
- cancel/end semantics
- wheel routing hook points
- hover-to-session handoff rules

Completed so far:

- minimal session lifecycle helpers added
- hover/session helper shapes added
- painter canvas now stores shared-style hover/session state instead of only local ad hoc interaction world fields
- app-level drag state now maps into shared `DragPayload` vocabulary for the current cross-module item path
- inventory/container and character drag starts now reuse shared item payload vocabulary for legality-highlighting seams
- payload/target compatibility now has a shared runtime helper path that supports async consumer adapters
- item-payload compatibility adapter construction now lives in shared runtime-facing code instead of only `app_state.ts`
- painter now declares a concrete `InteractionConsumerAdapters` object on top of the shared runtime contracts
- place now exposes a concrete consumer-adapter seam using shared view registration, target resolution, and payload compatibility
- character and inventory UI now expose concrete consumer-adapter seams using shared view registration, target resolution, and payload compatibility
- a minimal interaction registry/orchestrator runtime now exists for adapter registration and shared hover resolution

Testability progress:

- focused executable coverage now exists for interaction registry hover selection, active session updates, and ordered target priority
- focused executable coverage now also exists for cross-consumer hover selection and source-captured active session continuity
- focused executable coverage now also exists for shared resolved-target selector precedence between active session state and hover state

### Layer 3: Shared Views

Status: started

Make view identity and per-view camera state explicit in engine/runtime code.

This must support multiple views over the same underlying content.

Deliverables:

- view registration API
- view identity model
- per-view camera state container
- hit-test ordering rules

Completed so far:

- `ViewInstance` and per-view camera state types added
- painter now has an explicit view identity helper and per-view camera shape helper
- shared view-instance builder now lives in runtime-facing code and is used by active consumers

### Layer 4: Shared Targeting

Status: started

Introduce typed resolved targets across 2D and 3D consumers.

Painter, place, and inventory should all resolve through this model.

Deliverables:

- tagged target union definitions
- adapter interfaces for 2D and 3D resolution
- ordered multi-target resolution support
- shared hover and active-resolution pipeline rules
- migration guide for existing consumer-local target resolution

Completed so far:

- tagged resolved target union added
- ordered multi-target resolution helper added
- hover and active interactions locked to the same target pipeline in the plan
- place drop targets now have a typed resolution seam in the current drag/drop path
- inventory slot and equipment slot highlights now use typed target builders in the current UI drag/hover path
- typed compatibility routing now flows through a shared runtime helper instead of only app-local glue
- place, inventory-slot, and equipment-slot target builders now live in shared runtime-facing code

### Layer 5: Camera Ownership Cleanup

Status: started

Normalize the camera/projection contract around:

- framing anchor
- focus target
- focus plane
- per-view ownership

This is where painter camera-following bugs should be fixed at the correct architectural layer.

Deliverables:

- clarified per-view camera state shape
- projection contract usage rules
- migration notes for existing painter camera/focus code

Completed so far:

- painter live preview no longer uses interaction target as the framing anchor by default
- painter preview now preserves framing while allowing focus/depth updates

### Layer 6: Consumer Adoption

Status: started

Started notes:

- painter is now the first partial adopter of the shared hover/session model
- place and inventory remain validation references until their runtime roles are mapped explicitly
- the current place item-drop path now exposes typed payload and typed target seams without changing consumer-owned legality behavior
- inventory/container and character UI now partially adopt shared target/payload seams for hover and drag-start highlighting
- current legality/highlight routing now begins passing through a shared compatibility adapter seam
- current item legality adapter is now constructed from shared runtime code with app-state callbacks
- current app-state now consumes shared target builders instead of defining those target shapes directly
- painter and the current place seam now consume a shared view-instance builder instead of hand-building view objects inline
- painter is now the first explicit adapter-driven consumer, with shared view registration and target resolution surfaces
- place is now the second explicit adapter-driven consumer, with shared view registration, resolution, and compatibility surfaces
- character and inventory are now explicit adapter-driven consumers with shared registration, resolution, and compatibility surfaces
- app-state now drives a shared hover path through the registered adapter consumers
- place drop handling now prefers orchestrator-owned `place_tile` targets at commit time before falling back to module-local tile coordinates
- place hover/highlight now prefers orchestrator-owned `place_tile` hover targets before falling back to module-local hover item ids
- character and inventory hover/highlight now prefer orchestrator-owned slot targets before falling back to module-local slot callbacks

This is the milestone where consumer extraction becomes engine coordination.

The next step after this is to move active interaction/session ownership into the orchestrator instead of only hover.

Completed so far:

- app-state now begins, updates, and ends orchestrator-owned active interaction sessions from global pointer input
- painter is the first active-session pressure-test path because its consumer adapters and local session model are already the richest
- painter mode now also runs through a shared interaction registry for hover and active session state instead of bypassing the orchestrator hooks entirely
- painter app-state no longer keeps separate adapter-local hover/session mirrors; it now writes adapter updates into the orchestrator-backed read model
- painter canvas module no longer keeps its own parallel hover/session lifecycle mirrors; it now focuses on target resolution and tool behavior
- painter interaction-anchor reads now prefer orchestrator-owned session/hover targets before falling back to local module anchor logic
- painter visual-pivot and anchor-cell reads now also prefer orchestrator-owned interaction anchors before falling back to local module anchor logic
- painter preview/focus preservation now prefers orchestrator-owned resolved targets while keeping framing anchor ownership stable
- place now has its first real behavior read path sourced from orchestrator-owned interaction state for drop targeting
- place now has a second real behavior read path sourced from orchestrator-owned interaction state for hover/highlight targeting
- UI modules now have their first real behavior paths sourced from orchestrator-owned interaction state for slot hover/highlight targeting
- UI modules now have their first real behavior paths sourced from orchestrator-owned interaction state for slot hover/highlight targeting

Move consumers over in phases:

1. painter
2. place interactions
3. inventory/container drags
4. cross-module drag/drop and highlight routing

For each consumer, adoption should include:

- replacing local session ownership with engine session ownership
- wiring view registration and resolution adapters
- moving highlight routing onto typed payload/target compatibility

### Layer 7: Legacy Removal

Status: started

Remove or reduce:

- consumer-local pseudo-engine interaction state
- overloaded camera target concepts
- compatibility focus hot-path authority
- duplicate drag/session models

Exit criteria:

- no consumer is the hidden owner of generalized session mechanics
- no cross-module drag path bypasses the engine session model
- no painter camera framing bug still relies on legacy coupling

Completed so far:

- painter no longer defaults to a generic canvas-module interaction-anchor export when orchestrator-owned interaction state is available
- painter canvas now exposes only a narrow text-cursor anchor fallback instead of a broad generic local interaction anchor for engine reads
- painter and game/UI now share runtime-level resolved-target selectors instead of duplicating current-target precedence logic in app code

### Orchestrator Milestone

Completed so far:

- minimal interaction registry/orchestrator runtime added
- shared hover resolution now works through registered consumer adapters
- painter, place, character, and inventory are all visible to the shared hover path
- orchestrator-owned active session state now exists alongside shared hover state
- consumer registration sync is now a shared registry/runtime behavior instead of app-local clear/register boilerplate
- orchestrator pointer-state construction is now shared runtime behavior instead of duplicated app-mode glue
- orchestrator pointer-move processing now has a shared runtime path instead of duplicated app-mode hover/session update glue
- orchestrator pointer-down/up processing now has a shared runtime path instead of duplicated app-mode session begin/end glue

## File-By-File Focus

### Current Role Mapping Snapshot

Current runtime-role mapping observed in code:

- `src/canvas_app/app_state.ts`
Current role:
cross-module item drag payload ownership, drag ghost state, legality/highlight entry points

- `src/mono_ui/modules/place_module.ts`
Current role:
view-relative world resolution, place drop targeting, place drag initiation and painter-pan interaction

- `src/mono_ui/modules/painter_canvas_module.ts`
Current role:
consumer-local hover/session continuity, painter target resolution, tool-specific interaction semantics

- `src/canvas_app/painter_app_state.ts`
Current role:
per-view painter camera/projection glue, preview application, migration owner for painter-specific runtime adoption

This mapping should be used during migration so responsibilities move intentionally instead of being rewritten blindly.

### `src/mono_ui/runtime/camera_anchor_runtime.ts`

Keep and likely expand.

It already points toward shared runtime support for view-relative camera behavior.

### New shared interaction runtime module

Add a shared runtime module for:

- interaction session types
- orchestrator helpers
- capture ownership
- drag payload typing
- wheel/key routing hooks

Completed so far:

- lifecycle helpers exist
- compatibility helpers exist
- registry/orchestrator hover helpers now exist

### New shared resolved target module

Add a shared tagged-union target model for typed resolved targets.

It should be detailed enough for slot, tile, cell, item, text-cell, and UI-surface targets.

### New shared view runtime module

Add explicit view instance and per-view camera state types.

This should include registration, hit-test identity, and per-view camera ownership.

### `src/ascii_painter/painter_view_projection_adapter.ts`

Keep and refine.

This should consume the clarified view/camera contract, not own consumer semantics.

### `src/canvas_app/painter_app_state.ts`

Migration consumer.

It should lose ownership of generalized runtime mechanics and keep painter-specific glue.

Completed so far:

- painter view instance construction now routes through shared runtime-facing builder code
- painter now exposes a concrete `InteractionConsumerAdapters` object using shared view-registration and resolution contracts
- painter app state now owns a shared interaction registry and exposes orchestrator-owned hover/session state
- painter app state has started collapsing redundant local session authority into the orchestrator-owned session/hover model
- painter canvas module has stopped maintaining redundant local hover/session lifecycle state
- painter now has its first real behavior read path sourced from orchestrator-owned interaction state
- painter now has a second concrete behavior path preferring orchestrator-owned interaction state for camera/pivot and anchor-cell behavior
- painter now has a third concrete behavior path preferring orchestrator-owned interaction state for preview/focus preservation

### `src/mono_ui/modules/painter_canvas_module.ts`

Migration consumer.

It should resolve targets and consume shared interaction/runtime contracts rather than owning the long-term model.

Completed so far:

- internal hover/session state now uses the shared interaction session helper model
- module API now exposes hover/session accessors for migration use

### `src/mono_ui/modules/place_module.ts`

Migration consumer and key reference for multi-view world behavior.

Completed so far:

- place module now exposes a shared-style interaction target resolution surface for adapter consumers

Audit note:

- unlike painter, `place_module` does not maintain a second generic hover/session lifecycle mirror; its remaining local state is still primarily place-specific tool and visual behavior

### `src/mono_ui/modules/character_module.ts`

Migration consumer.

Completed so far:

- character module now exposes a shared-style interaction target resolution surface for adapter consumers

### `src/mono_ui/modules/owner_inventory_module.ts`

Migration consumer.

Completed so far:

- owner inventory module now exposes a shared-style interaction target resolution surface for adapter consumers

### `src/canvas_app/app_state.ts`

Current source of drag/session requirements.

Use it to extract the engine interaction and payload model, then slim it down.

It is also the main reference for current cross-module drag payload and legality/highlight requirements.

Completed so far:

- current item drag state can now be exported as shared `DragPayload` data for migration consumers
- inventory slot and equipment slot highlight paths now route through typed target helper functions
- current item legality/highlight evaluation now routes through a shared compatibility helper interface
- current app-state no longer defines the item compatibility adapter shape directly
- current app-state no longer defines place/inventory/equipment target builder shapes directly
- current place seam now routes through a shared runtime-facing view builder for primary view identity
- app state now exposes concrete painter/place interaction adapters for engine-facing consumers
- app state now exposes concrete character/inventory interaction adapters for engine-facing consumers
- app state now refreshes a shared interaction registry and resolves hover through it on global pointer movement
- app state now builds simple runtime-backed consumer adapters through a shared helper instead of repeating the same place/character/inventory assembly pattern
- app-state and painter-state now both sync registry consumers through a shared runtime helper instead of manual clear/register patterns
- app-state and painter-state now build orchestrator pointer-state through a shared runtime helper instead of duplicated object assembly
- app-state and painter-state now use a shared registry move-flow helper instead of duplicating hover/session update sequencing
- app-state and painter-state now use shared registry down/up helpers instead of duplicating session begin/end sequencing
- app-state and painter-state now keep registry consumer sync stable outside pointer events, refreshing on setup and registry changes instead of rebuilding every move/down/up

## Transitional Rules

- do not preserve pointer-following camera framing during painter drawing
- do not preserve separate long-term interaction runtimes across painter/place/UI
- do not reduce the engine interaction model to world coordinates only
- do not move gameplay legality rules into the engine
- if temporary compatibility fields remain, label them as migration-only
- do not let consumers keep parallel source-capture implementations once the orchestrator exists
- do not let linked secondary views become authoritative unless explicitly designed for it
- do not create a separate long-term hover target system that diverges from interaction target resolution

## Success Criteria

### Architecture Outcomes

- one shared engine interaction session runtime exists
- one shared resolved target model exists
- one shared view runtime exists
- one per-view camera/projection contract exists
- source capture, wheel routing, and multi-view authority are explicit engine behaviors
- hover and active interaction resolution use the same target pipeline

### Painter Outcomes

- drawing does not pan framing from pointer movement
- depth/focus behavior remains intentional
- preview and release agree
- painter no longer owns generalized runtime mechanics

### Game Outcomes

- place move and shape interactions fit the same engine session model
- inventory and container drags fit the same engine session model
- module-to-module legality/highlight routing becomes easier to express safely
- cross-module drag ownership no longer relies on ad hoc app-state booleans
- current place drag/drop seams expose typed payload and typed target data even before full migration

### Code Health Outcomes

- less legacy camera/focus glue
- fewer overlapping sources of truth
- thinner consumer glue
- less duplicated drag/session state

## Renderer Contract Convergence Addendum

The current stabilization work exposed a second convergence problem alongside interaction/runtime ownership:

- painter currently has the strongest interaction flow and runtime feel
- game/world currently has the richer shader/payload/atlas rendering model
- some renderer paths still assume ASCII-first semantics where `char === ' '` means "nothing to draw"

That assumption is no longer safe for the shared engine direction.

The engine should converge toward:

- painter-grade interaction flow
- game-grade shader/render contracts
- one renderer path that supports text-only, graphic-only, and mixed cells

This addendum extends the plan so viewport/camera unification and interaction-runtime cleanup do not leave the renderer contract split between old ASCII assumptions and newer payload-based rendering.

### Renderer Convergence Goals

- a drawable cell is defined by visual payload, not only by text char
- DOM/world renderers must treat `graphic` as a first-class draw signal
- painter should remain the UX benchmark for interaction feel
- game/place shader payloads should remain the rendering benchmark for engine capability
- future shared renderer code should not fork into separate "painter renderer" and "game renderer" contracts

### Immediate Stabilization Track

1. [ ] fix DOM draw eligibility rules so `graphic` cells are not skipped just because `char === ' '`
2. [ ] audit projection/export helpers for the same ASCII-only draw assumption
3. [ ] re-test game place rendering after the DOM draw-eligibility fix
4. [ ] keep painter bootable and interactive while the shared renderer path is corrected

### Near-Term Cleanup Track

1. [ ] define the shared drawable-cell contract in docs and code comments
2. [ ] audit renderer assumptions in `canvas_runtime.ts`, `voxel_dom_renderer.ts`, and projection adapters for places where `char` is incorrectly treated as the only source of visible content
3. [ ] make runtime viewport ownership remain centralized in `main.ts`/runtime coordination, with module-local viewport state kept as fallback only
4. [ ] keep place/painter camera and interaction improvements aligned with the shared runtime roles from this plan

### Longer-Term Convergence Track

1. [ ] make shared DOM/world rendering fully support text-only, graphic-only, and mixed cells without compatibility hacks
2. [ ] keep shader/payload resolution shared between painter and game instead of forking render contracts by mode
3. [ ] let painter adopt richer render contracts without regressing its editing and interaction strengths
4. [ ] continue reducing duplicate viewport/camera authorities so render placement and interaction targeting follow the same runtime ownership model

### Convergence Guardrails

- do not regress game rendering back to pure ASCII assumptions
- do not build a separate long-term renderer contract only for painter
- do not treat this as a migration-only patch; it should move the engine toward one shared drawable-cell model
- do not broaden into unrelated shader/runtime rewrites before the visible-place bug is fixed

## Risks

1. building a shared runtime that is still too painter-shaped
2. making the shared runtime too weak for module-to-module drags
3. leaving per-view camera ownership underdefined
4. preserving old abstractions under new names
5. preserving ASCII-only renderer assumptions inside "shared" engine code

Mitigations:

- keep the engine runtime generic but typed
- keep resolved target unions explicit
- keep legality and domain semantics consumer-owned
- validate the architecture against painter, place, and inventory before hardening it
- validate shared renderer behavior against painter interaction flow and game/place shader payloads before freezing contracts

## Multiplayer Planning Note

The multiplayer planning that previously lived here has been split into its own source-of-truth document:

- `docs/plans/2026_04_27_multiplayer_connection_architecture_plan.md`

This camera-target plan now stays focused on interaction architecture and renderer contract convergence. The standalone multiplayer plan owns:

- direct host connection architecture
- slot-scoped join persistence
- `content_ref`-based preferred join target memory
- future Headscale overlay direction
- later relay-compatible transport evolution

## Recommended First Slice

1. [x] define the shared vocabulary in code and docs
2. [x] sketch shared types for `ViewInstance`, `ResolvedTarget`, `InteractionSession`, and drag payloads
3. [x] separate painter framing from interaction targeting using the clarified per-view camera contract
4. [ ] use painter, place, and inventory drag flows as architecture validation cases before deeper implementation
5. [ ] explicitly map current drag/session ownership code in `app_state.ts`, `place_module.ts`, and `painter_canvas_module.ts` into the new runtime roles before moving code
6. [ ] fix the immediate DOM renderer draw-eligibility mismatch so game/place graphic cells render through the shared world-layer path
7. [ ] document the shared drawable-cell contract so renderer convergence follows the same single-source-of-truth discipline as input/view/runtime work

## Summary

The engine should not be built around one camera target or one world-only interaction concept.

It should be built around:

- normalized input
- interaction orchestration
- engine-owned view instances
- typed resolved targets
- shared interaction sessions
- per-view camera/projection ownership
- consumer-owned semantics

That architecture gives the project a cleaner reusable engine boundary, less legacy glue, and a safer path for painter, THAUMWORLD, and future apps to share the same core interaction system.

# UI Module Standardization Plan

Date: 2026-03-23

## Status

- [ ] not started

## Intent

Standardize the floating UI module/panel system used across the game UI and the ASCII painter so modules can opt into a shared default shell instead of each one reimplementing move/resize/close/toggle/persistence behavior.

This plan is documentation only. It is the execution checklist and design guardrail for future implementation work.

## Problem Statement

The repo already has a strong shared gizmo substrate, shared module registry, and shared canvas runtime, but modules still diverge in a few important ways:

- some modules use shared gizmos but duplicate the same pointer/move/resize plumbing
- some modules toggle by registry visibility while others toggle by register/unregister
- some modules persist rects/visibility while others keep panel state in local booleans only
- some dynamic windows are intentionally ephemeral, but that distinction is not documented as a first-class rule
- some modules are true floating panels while others are fixed bars, invisible handlers, world viewports, or content primitives

The goal is to make the standard path obvious and reusable, while preserving valid one-off behavior where the module is not actually a normal floating panel.

## Source Of Truth / Related Files

- Shared gizmo substrate: `src/mono_ui/module_gizmos.ts`
- Shared module registry: `src/mono_ui/module_registry.ts`
- Shared runtime visibility filtering: `src/canvas_app/main.ts`
- Game app state: `src/canvas_app/app_state.ts`
- ASCII painter app state: `src/canvas_app/painter_app_state.ts`
- Shared text window base: `src/mono_ui/modules/window_module.ts`
- Shared floating panel candidates: `src/mono_ui/modules/`
- Painter-specific floating modules: `src/ascii_painter/`

## Non-Negotiable Invariants

- Do not break existing input behavior for move/resize/close.
- Do not regress panel visibility state during migration.
- Do not leave duplicate toggle systems active after a module is migrated.
- Do not create a second gizmo implementation.
- Do not create a second registry or a parallel runtime module tree.
- Do not force fixed bars, world viewports, or invisible handlers into the floating-panel abstraction when they are not actually floating panels.
- Do not lose persisted panel positions or visibility during migration.
- Any temporary compatibility code introduced during implementation must have an explicit cleanup task in this plan before the work is considered done.

## Definition Of Done

This plan is complete only when all of the following are true:

- there is one documented canonical floating-panel pattern for shared module shells
- reusable helpers exist for shared panel features rather than repeated per-module plumbing
- durable panels use one consistent toggle/visibility model
- rect and visibility persistence follow one shared contract for standardized panels
- dynamic instance windows are explicitly categorized as ephemeral and handled by one documented pattern
- known one-off modules are explicitly kept out of the abstraction on purpose rather than by accident
- old duplicated panel plumbing that became obsolete during migration is removed cleanly

## Current Architecture Snapshot

### What Is Already Strong

- `src/mono_ui/module_gizmos.ts` already centralizes gizmo drawing, mode state, click handling, move mode, and resize mode.
- `src/mono_ui/module_registry.ts` already centralizes registration and visibility.
- `src/canvas_app/main.ts` already renders only visible modules when registry visibility is used.
- many floating modules already share the same visual language and header/gizmo layout.

### What Is Still Split

- game durable panels mostly use registry visibility
- ASCII painter still commonly uses register/unregister plus local booleans
- persistence is split between game-side layout storage and painter-side module position storage
- several modules repeat nearly identical gizmo event plumbing locally
- dynamic container/NPC windows use a presence-based model that is valid, but not yet documented as the official exception path

## Module Inventory

This inventory is the current migration map.

### Group A: Already Close To The Target Standard

These modules already behave like real floating panels and should migrate early with low risk.

#### Game place-painter local wrapper panels

- `place_painter_toolbar` in `src/canvas_app/app_state.ts`
- `place_painter_status` in `src/canvas_app/app_state.ts`
- `place_painter_palette` in `src/canvas_app/app_state.ts`
- `place_painter_tools` in `src/canvas_app/app_state.ts`
- `place_painter_layers` in `src/canvas_app/app_state.ts`

Current state:

- shared gizmos: yes
- move: yes
- resize: yes except where module-specific limits may apply
- close: yes
- toggle model: registry visibility
- rect persistence: yes
- visibility persistence: yes

Standardization goal:

- replace local wrapper duplication with the canonical shared floating-panel helper

#### Debug text window

- `debug` in `src/canvas_app/app_state.ts`

Current state:

- shared gizmos: yes
- move: yes
- resize: yes
- close: yes
- toggle model: registry visibility
- rect persistence: yes
- visibility persistence: yes

Standardization goal:

- use this as one of the reference migrations for shared text-window-backed panels

### Group B: Partly Standardized Floating Panels

These modules already look like floating panels, but they still own too much shell behavior themselves.

#### Shared mono_ui panel candidates

- `src/mono_ui/modules/window_module.ts`
- `src/mono_ui/modules/toolbox_module.ts`
- `src/mono_ui/modules/tool_properties_module.ts`
- `src/mono_ui/modules/color_selector_module.ts`
- `src/mono_ui/modules/character_selector_module.ts`
- `src/mono_ui/modules/weight_selector_module.ts`
- `src/mono_ui/modules/brush_preview_module.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`

Current state:

- shared gizmos: yes
- move: usually yes
- resize: yes for most, no for some small modules
- close: yes for most
- toggle model: caller-managed and inconsistent
- rect persistence: caller-managed and inconsistent
- visibility persistence: caller-managed and inconsistent

Standardization goal:

- keep module-specific content logic inside each module
- move shell behavior into one reusable default panel contract

#### Painter-specific floating panels

- `src/ascii_painter/layer_palette_module.ts`
- `src/ascii_painter/camera_control_module.ts`

Current state:

- shared gizmos: yes
- move: yes
- resize: yes
- close: yes
- toggle model: painter register/unregister pattern
- rect persistence: yes via painter-specific storage
- visibility persistence: effectively local boolean/open state rather than a shared contract

Standardization goal:

- migrate to the same durable-panel visibility model used by the game unless there is a documented reason not to

### Group C: Standardize Shell Only, Keep Content Bespoke

These modules are more complex and should only adopt the shared panel shell, not be forced into simplistic content abstractions.

#### Character module

- `src/mono_ui/modules/character_module.ts`

Current state:

- shared gizmos: yes when configured
- move: yes
- resize: yes for some uses, not all
- close: yes when configured
- toggle model: mixed; player panel is durable, NPC windows are dynamic instance windows
- rect persistence: partly yes
- visibility persistence: partly yes

Special behavior:

- body slot interaction
- equipment rendering
- drag/drop adjacency with container logic
- NPC instances opened dynamically from game state

Standardization goal:

- unify shell/toggle contracts where applicable
- keep specialized interaction logic local to the module

#### Container module

- `src/mono_ui/modules/container_module.ts`

Current state:

- shared gizmos: yes when configured
- move: yes
- resize: yes
- close: yes when configured
- toggle model: mixed; inventory-like durable usage and dynamic open-container windows both exist
- rect persistence: partly yes
- visibility persistence: partly yes

Special behavior:

- slot grid rendering
- nested open-container behavior
- drag/drop validation
- source-specific interaction rules

Standardization goal:

- standardize shell, lifecycle categories, and persistence contract
- do not flatten complex container behavior into a generic content widget system

#### Status and transcript windows

- `status` in `src/canvas_app/app_state.ts`
- `transcript` in `src/canvas_app/app_state.ts`

Current state:

- shared gizmos: optional through `window_module`
- move/resize/close: technically available through the shared base, but not yet normalized like `debug`
- toggle model: not yet treated as first-class standardized durable panels
- persistence: caller-managed and inconsistent relative to `debug`

Standardization goal:

- decide whether these are canonical durable panels or intentionally fixed always-on windows
- document and implement that choice consistently

### Group D: Intentional One-Offs / Not Floating Panels

These should not be forced into the standard floating-panel abstraction unless product direction changes.

#### World/place viewport

- `src/mono_ui/modules/place_module.ts`

Why it is special:

- not a normal floating panel
- owns world viewport logic, DOM-backed layers, place camera behavior, and simulation interaction
- can use shared infrastructure, but should not be reclassified as a standard gizmo panel

#### Fixed bars / menus / simple primitives

- `src/mono_ui/modules/painter_toolbar_module.ts`
- `src/mono_ui/modules/painter_file_menu_module.ts`
- `src/mono_ui/modules/button_module.ts`
- `src/mono_ui/modules/input_module.ts`
- `src/mono_ui/modules/roller_module.ts`
- `src/mono_ui/modules/fill_module.ts`
- `src/ascii_painter/layer_renderer_module.ts`

Why they are special:

- fixed bars, primitives, or purpose-built helpers rather than free-floating panel shells
- should reuse shared visuals where useful, but do not need move/resize/close/toggle defaults

#### Invisible handlers / global control modules

- inline global key handler module in `src/canvas_app/app_state.ts`

Why it is special:

- not a visual panel
- should remain outside panel standardization entirely

### Group E: Dynamic Ephemeral Instance Windows

These are valid exceptions, but they need a documented pattern instead of ad hoc behavior.

#### Dynamic container windows

- opened from `open_container_module(...)` in `src/canvas_app/app_state.ts`

Current state:

- instance-based
- created and destroyed on demand
- visibility represented by presence
- uses shared gizmos and rect persistence in practice

Standardization goal:

- keep them ephemeral if that remains the right product behavior
- give them an explicit standard contract for dynamic-instance windows

#### Dynamic NPC windows

- opened from `open_npc_character_module(...)` in `src/canvas_app/app_state.ts`

Current state:

- instance-based
- created and destroyed on demand
- visibility represented by presence
- uses shared gizmos and rect persistence in practice

Standardization goal:

- same as dynamic container windows: standardize the exception, not force it into the durable-panel model

## Canonical Module Categories

Every module touched by this plan must be classified into one of these categories before migration starts.

### Category 1: Durable Floating Panel

Rules:

- registered once during app/module setup
- shown/hidden via registry visibility
- rect persistence allowed
- visibility persistence allowed
- uses standard floating-panel helper when possible

Examples:

- debug window
- toolbox
- selectors
- tool properties
- camera control
- layer palette

### Category 2: Ephemeral Instance Window

Rules:

- created per entity/container/NPC instance
- close behavior may unregister and destroy the module
- rect persistence may be keyed by stable instance id if useful
- should still use the standard shell helper where practical
- must not pretend to be a durable always-registered panel

Examples:

- opened NPC character windows
- opened container windows

### Category 3: Fixed Surface / Fixed Bar

Rules:

- not free-floating
- no move/resize/close by default
- may still share border/header drawing if useful
- should not be forced into panel persistence rules

Examples:

- file menu
- toolbar
- world viewport overlays

### Category 4: Primitive / Invisible Utility

Rules:

- not a panel
- excluded from panel standardization scope

Examples:

- button/input primitives
- invisible key handlers

## Target Architecture

## A Shared Floating-Panel Shell

Introduce one canonical shared helper for panel shell behavior.

Expected responsibilities:

- shared border/header reservation
- shared gizmo enablement by feature flags
- shared move plumbing
- shared resize plumbing
- shared close plumbing
- shared outside-click mode cancellation
- shared rect ownership/update hooks
- shared optional persistence hooks

Expected non-responsibilities:

- module-specific content drawing
- module-specific click semantics inside the content area
- app-specific business logic
- dynamic entity loading logic

## A Shared Toggle Contract

Default rule:

- durable panels should use registry visibility, not register/unregister

Explicit exception:

- ephemeral instance windows may still use register/unregister, but only as part of the documented dynamic-instance pattern

## A Shared Persistence Contract

Standardized panels should use one persistence shape for:

- rect
- visible state
- optionally other panel shell state if truly shared and justified

Important rule:

- panel content state and panel shell state should remain separate

Examples:

- tool selection belongs to tool state, not panel shell persistence
- panel rect/visible belongs to shell persistence

## A Shared Cleanup Rule

Whenever a module is migrated:

- old duplicated shell code must be removed
- old local toggle booleans that became obsolete must be removed
- dead register/unregister pathways for durable panels must be removed
- duplicate storage keys and stale persistence adapters must be removed or explicitly deprecated in a one-time compatibility phase

This plan is not complete if the new path exists but the old path is still hanging around unused.

## Migration Strategy

### Phase 0: Freeze The Rules Before Refactor

- [ ] confirm the four canonical module categories for every module in scope
- [ ] confirm the default durable-panel rule: registry visibility over register/unregister
- [ ] confirm the default ephemeral-window rule: presence-based lifecycle is allowed only for dynamic instance windows
- [ ] confirm which existing persistence data must be preserved during migration
- [ ] confirm whether `status` and `transcript` are durable floating panels or intentionally fixed windows

Deliverables:

- updated checklist state in this plan
- explicit category assignment for each migrated module

### Phase 1: Build The Shared Inventory And Classification Table

- [ ] create a final implementation-time inventory table of all modules in scope
- [ ] mark each module as durable panel, ephemeral instance window, fixed surface, or primitive/utility
- [ ] mark each module as `move`, `resize`, `close`, `persistRect`, `persistVisible`, `dynamicInstance`, or `oneOff`
- [ ] identify modules that already use `module_gizmos` but still duplicate shell logic
- [ ] identify modules that should never migrate to the shared panel shell

Success criteria:

- no in-scope module is left unclassified
- no one-off remains undocumented

### Phase 2: Define The Canonical Shared Panel API

- [ ] document the exact shared shell API before touching module implementations
- [ ] define feature flags for shell capabilities
- [ ] define durable-panel visibility hooks
- [ ] define ephemeral-instance hooks
- [ ] define persistence hooks and storage-key ownership
- [ ] define how shared shell code hands off content-area pointer events to the module body
- [ ] define migration notes for modules that only support move/close and not resize

Guardrails:

- do not build a second gizmo implementation under a new name
- do not bake app-specific module logic into the shared shell helper
- do not hide lifecycle differences between durable panels and ephemeral instance windows

### Phase 3: Standardize Persistence And State Ownership

- [ ] choose the canonical shell-persistence owner and document it
- [ ] map painter persistence keys to the future shared contract
- [ ] map game persistence keys to the future shared contract
- [ ] define any compatibility read path needed to preserve old saved layouts during migration
- [ ] define the removal point for compatibility logic so it does not become permanent garbage
- [ ] decide whether `module_registry.update_position(...)` needs to be strengthened as part of this work

Success criteria:

- one documented answer exists for who owns rect state, who persists it, and how modules consume it

### Phase 4: Migrate Low-Risk Durable Panels First

- [ ] migrate `debug`
- [ ] migrate game place-painter wrapper panels
- [ ] migrate `toolbox_module`
- [ ] migrate `tool_properties_module`
- [ ] migrate `color_selector_module`
- [ ] migrate `character_selector_module`
- [ ] migrate `weight_selector_module`
- [ ] migrate `brush_preview_module`
- [ ] migrate `layer_palette_module`
- [ ] migrate `camera_control_module`

For each migrated module:

- [ ] replace duplicated shell plumbing with the shared helper
- [ ] preserve move/resize/close behavior exactly
- [ ] preserve rect persistence
- [ ] preserve visibility behavior
- [ ] delete obsolete local shell code

### Phase 5: Normalize Shared Window/Text Panels

- [ ] standardize `window_module` as a first-class base for text-backed floating panels if that remains the chosen direction
- [ ] decide and implement the durable/fixed classification for `status`
- [ ] decide and implement the durable/fixed classification for `transcript`
- [ ] ensure `debug`, `status`, and `transcript` follow one documented rule set rather than three slightly different ones

### Phase 6: Migrate Complex Shells Without Flattening Their Content Logic

- [ ] migrate `character_module` shell behavior where it participates as a floating panel
- [ ] migrate `container_module` shell behavior where it participates as a floating panel
- [ ] keep all specialized content interactions local
- [ ] verify player character durable behavior still differs correctly from dynamic NPC-instance behavior where intended
- [ ] verify inventory/container durable behavior still differs correctly from ephemeral opened-container behavior where intended

Guardrails:

- do not simplify away valid drag/drop behavior
- do not merge durable and ephemeral lifecycles into a confusing hybrid

### Phase 7: Standardize Dynamic Instance Windows As An Explicit Exception Path

- [ ] document the standard ephemeral-instance pattern for NPC windows
- [ ] document the standard ephemeral-instance pattern for container windows
- [ ] align close behavior, rect persistence policy, and instance keying rules
- [ ] remove ad hoc differences that are no longer justified after the pattern is explicit

Success criteria:

- dynamic windows are special on purpose, not special by drift

### Phase 8: Cleanup And Deletion Pass

- [ ] remove dead local toggle booleans that were replaced by shared visibility state
- [ ] remove dead register/unregister logic for durable panels
- [ ] remove dead persistence helpers or duplicate storage keys that no longer serve migrated modules
- [ ] remove duplicated gizmo shell code that became obsolete
- [ ] remove compatibility scaffolding whose removal point was defined earlier in this plan
- [ ] verify no migrated module still carries both old and new shell systems at the same time

This phase is mandatory. The work is not complete if the codebase still contains stale parallel patterns after migration.

## Verification Checklist

These checks should be run for every migrated module category.

### Functional Checks

- [ ] panel opens correctly
- [ ] panel closes correctly
- [ ] panel move works correctly
- [ ] panel resize works correctly where enabled
- [ ] panel does not enter broken gizmo mode after outside click
- [ ] panel content interaction still works after shell migration
- [ ] registry visibility changes still update rendering correctly

### Persistence Checks

- [ ] rect persists across reload when expected
- [ ] visibility persists across reload when expected
- [ ] old saved layouts still restore correctly if compatibility support is part of the migration phase
- [ ] no duplicate save writes occur from old and new persistence paths simultaneously

### Exception Checks

- [ ] dynamic NPC windows still behave as per-instance windows
- [ ] dynamic container windows still behave as per-instance windows
- [ ] fixed bars/menus did not accidentally gain floating-panel behaviors
- [ ] place/world viewport behavior remains untouched unless explicitly scoped later

### Cleanup Checks

- [ ] no dead helper remains after migration
- [ ] no stale module-local shell state remains unused
- [ ] no old toggle path remains reachable for a migrated durable panel

## Risk Register

### Risk 1: Breaking Existing Painter Toggle Flows

Why it matters:

- painter still relies on local boolean/open-state + register/unregister flows in several places

Mitigation:

- migrate low-risk durable panels first
- keep category decisions explicit before implementation
- preserve compatibility reads for persistence when needed

### Risk 2: Mixing Durable And Ephemeral Lifecycles

Why it matters:

- dynamic windows are not the same thing as app-level persistent panels

Mitigation:

- keep two explicit lifecycle categories
- do not hide them behind a vague one-size-fits-all toggle API

### Risk 3: Leaving Garbage Behind

Why it matters:

- panel standardization work can easily leave dead booleans, duplicate handlers, and stale persistence code

Mitigation:

- require a dedicated cleanup phase
- require per-module deletion checklists during migration

### Risk 4: Over-Abstracting Real One-Offs

Why it matters:

- modules like `place_module` are not normal panels and should not be bent into that shape

Mitigation:

- keep category assignment explicit
- document exclusions early and keep them excluded unless product direction changes

## Explicit Non-Goals

- rewriting the world/place viewport architecture
- replacing the module registry with a different UI framework
- replacing `module_gizmos` with a new gizmo/render system
- forcing all modules to become resizable
- forcing fixed toolbars or menus to become draggable windows
- refactoring module content logic just because the shell is being standardized

## Recommended Execution Order

1. classify all modules
2. define the shared shell API and persistence contract
3. migrate low-risk durable panels
4. normalize text/window panels
5. migrate complex shells
6. standardize dynamic-instance exceptions
7. delete dead parallel code

## Working Checklist

Use this section as the top-level progress tracker during implementation.

- [ ] Phase 0 complete
- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete
- [ ] Phase 8 complete

## Final Acceptance

Mark this plan complete only when all of the following are true:

- [ ] one canonical floating-panel shell exists
- [ ] durable-panel visibility is unified
- [ ] shell persistence is unified
- [ ] dynamic-instance windows are explicitly standardized as exceptions
- [ ] fixed bars/primitives remain intentionally outside the abstraction
- [ ] obsolete shell code has been removed
- [ ] no stale parallel toggle/persistence paths remain

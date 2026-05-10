# Named Profile Foundation Plan

Date: 2026-05-05
Status: Read-only architecture plan

## Goal

Define where a shared named-profile system should be slotted into Thaumworld and ASCII Painter before further bottom-bar cleanup or login/start-screen UX cleanup.

The intended outcome is a reusable profile foundation that can eventually group and swap:

- controls
- UI customization
- module layouts
- camera settings
- future player metadata / identity bindings
- future actor/profile linkage

## Why this is needed

Current persistence is split across several slot-scoped stores, but there is no named profile envelope tying them together.

Existing stores at time of writing originally used slot-root / profile-root files, but current implementation has moved these app-owned payloads to app-scoped profile files:

- `src/mono_ui/runtime/controls_profile_store.ts`
  - current authority: `profiles/<profile_id>/apps/<app_id>/controls.json`
- `src/mono_ui/runtime/ui_customization_store.ts`
  - current authority: `profiles/<profile_id>/apps/<app_id>/ui_customization.json`
- `src/mono_ui/runtime/module_layout_store.ts`
  - current authority: `profiles/<profile_id>/apps/<app_id>/module_layouts.json`
- `src/mono_ui/runtime/camera_customization_store.ts`
  - current authority: `profiles/<profile_id>/apps/<app_id>/camera_settings.json`
- `src/mono_ui/runtime/indexed_palette_store.ts`
  - current authority: `profiles/<profile_id>/apps/<app_id>/indexed_palette.json`

Legacy migration sources may still be read once during cutover from older installs, but they are no longer the intended live authority.

This means the codebase can persist preferences, but not yet as a first-class swappable user profile.

## Key exploration findings

### 1. Boot-time preference loading is already centralized

#### Game boot
Primary file:
- `src/canvas_app/app_state.ts`

Current startup loads:
- controls runtime via `create_game_controls_runtime(APP_CONFIG.selected_data_slot)`
- module layout cache + shared store via:
  - `load_cached_module_layout()`
  - `sync_module_layout_from_shared_store()`
- UI customization via:
  - `load_ui_customization_state(APP_CONFIG.selected_data_slot)`
- camera settings via:
  - `load_camera_settings(APP_CONFIG.selected_data_slot, WORLD_CAMERA_APP_ID)`

This is the best game-side insertion point for active-profile resolution.

#### Painter boot
Primary file:
- `src/canvas_app/painter_app_state.ts`

Current startup loads:
- module layout persistence via:
  - `initModuleLayoutPersistence(PAINTER_APP_CONFIG.selected_data_slot, 'thaum_painter')`
- UI customization via:
  - `load_ui_customization_state(PAINTER_APP_CONFIG.selected_data_slot, ...)`
- controls runtime via:
  - `create_painter_controls_runtime(PAINTER_APP_CONFIG.selected_data_slot)`
- camera settings via:
  - `load_camera_settings(PAINTER_APP_CONFIG.selected_data_slot, PAINTER_CAMERA_APP_ID)`

This is the best painter-side insertion point for active-profile resolution.

### 2. Actor claim is the strongest game identity hook

Primary file:
- `src/canvas_app/app_state.ts`

Relevant flow:
- `open_actor_claim_module(...)`
- `claim_selected_actor()`
- `claim_actor(actor_ref)`
- `load_claimed_actor_runtime(actor_id, actor_ref, source)`
- `refresh_controlled_actor_binding(...)`

Current behavior already binds:
- session control
- controlled actor ref
- runtime place/world state

Current behavior does not bind:
- controls profile
- UI customization profile
- layout profile
- camera profile

So `claim_actor(actor_ref)` and binding-restore paths are the best places for future actor/profile linkage.

### 3. Bottom bar remains the best long-term profile UI entry point

Shared nav primitives already exist:
- `src/mono_ui/modules/screen_overlay_bar_module.ts`
- `src/mono_ui/modules/program_nav_bar_module.ts`

Current customization access already exists in both programs, but not yet under a unified named-profile model.

That makes the bottom bar the right eventual home for:
- profile switching
- profile management
- controls editing
- customization editing

World entry / join / actor claim should consume this foundation, not become the primary source of truth for profile architecture.

## Recommended architecture

The main architectural rule for this work is:

- keep profiles as a domain/persistence concern
- keep app-state files as the integration boundary
- avoid deepening hidden global runtime state
- keep rendering modules as consumers, not owners, of profile state

This plan should move the repo toward clearer app/render separation, not toward more implicit singleton-driven coupling.

## Phase 1: Add a profile foundation with two separate pieces

### 1A. Profile registry

Create a shared profile registry responsible for profile metadata and selection records.

Recommended file direction:
- prefer a domain/persistence location such as:
  - `src/user_profiles/named_profile_store.ts`
  - `src/runtime_profiles/named_profile_store.ts`
  - `src/engine_persistence/profiles/named_profile_store.ts`
- acceptable temporary fallback if needed:
  - `src/mono_ui/runtime/named_profile_store.ts`

Responsibilities:
- list profiles
- create / rename / delete profiles
- store profile metadata
- store last-selected or default profile ids
- optionally store lightweight actor-link metadata

Recommended storage location:
- `profiles/index.json`
  - or `profiles/profiles.json`

Suggested metadata shape:
- `profile_id`
- `label`
- `created_at`
- `updated_at`
- optional `linked_actor_id`
- optional `linked_actor_ref`
- optional app scope metadata

### 1B. Profile-scoped persistence facade

Add a separate profile-scoped facade responsible for resolving where controls/theme/layout/camera data should load and save.

This facade should:
- resolve a concrete profile scope from slot + selected profile id + app id
- expose explicit load/save entry points or path helpers for:
  - controls
  - UI customization
  - module layouts
  - camera settings
- keep profile routing logic out of rendering modules
- keep profile routing logic from being duplicated across multiple stores

This split is important:
- registry = metadata and selection
- facade/scope = concrete persistence resolution

That is a better fit for a repo that wants contained concepts and clearer integration seams.

## Phase 2: Adapt existing stores behind the profile-scoped facade

Prefer a low-risk adapter path instead of immediately rewriting all runtime consumers.

Keep current call patterns stable where possible:
- `load_controls_profile(...)`
- `load_ui_customization_state(...)`
- `load_module_layouts(...)`
- `load_camera_settings(...)`

But do not scatter hidden active-profile lookups across every store.

Instead:
- resolve profile scope explicitly in the app integration layer
- use the profile-scoped facade to route load/save behavior
- let existing stores evolve behind that seam

This preserves most runtime code while avoiding more implicit singleton-style coupling.

### Candidate files for adapter evolution

- `src/mono_ui/runtime/controls_profile_store.ts`
- `src/mono_ui/runtime/ui_customization_store.ts`
- `src/mono_ui/runtime/module_layout_store.ts`
- `src/mono_ui/runtime/camera_customization_store.ts`
- `src/engine_persistence/slot_json_store.ts` (only if shared path helpers become useful)

## Phase 3: Resolve profile scope before normal preference boot

### Game
Primary integration file:
- `src/canvas_app/app_state.ts`

Active-profile resolution should happen before:
- `void game_controls.load()`
- `load_cached_module_layout()` / `sync_module_layout_from_shared_store()`
- `load_ui_customization_state(...)`
- `load_camera_settings(...)`

### Painter
Primary integration file:
- `src/canvas_app/painter_app_state.ts`

Active-profile resolution should happen before:
- `initModuleLayoutPersistence(...)`
- `create_painter_controls_runtime(...)`
- `load_ui_customization_state(...)`
- `load_camera_settings(...)`

This creates one shared boot phase for both programs:
1. resolve selected profile id
2. create an explicit profile scope / profile facade for this boot
3. load profile-scoped controls/theme/layout/camera through that scope
4. continue normal app startup

This should be explicit integration behavior, not just hidden mutation of a global active-profile singleton.

## Phase 4: Bind profiles to actor identity in game mode through app integration

Primary integration file:
- `src/canvas_app/app_state.ts`

Best claim-time hook:
- `claim_actor(actor_ref)`

Best restore-time hook:
- `refresh_controlled_actor_binding(...)`

Future behavior should be able to:
- resolve actor id / actor ref
- find linked named profile if one exists
- switch or confirm the selected profile in the game app layer
- rebuild or reapply the appropriate profile scope
- then continue loading runtime world state

Important boundary:
- actor identity is a game/app concept
- named profiles are a shared persistence/domain concept
- actor-claim-driven switching logic should stay in `src/canvas_app/app_state.ts`, not become core ownership of the profile registry itself

This preserves the desired model where a player or claimed actor can carry preferred controls/theme/layout defaults without over-coupling the profile foundation to game-specific claim flow.

## Phase 5: Add profile UI from the shared bottom bar first

Primary UI direction:
- bottom bar `SYSTEM` area becomes the shared profile access surface

Expected future actions:
- `PROFILE`
- `CUSTOM`
- `CONTROLS`
- possibly `CAMERA`

This should be done before trying to heavily redesign:
- `src/mono_ui/modules/world_entry_module.ts`
- `src/mono_ui/modules/world_join_module.ts`
- `src/mono_ui/modules/actor_claim_module.ts`

Those flows should eventually display and consume profile state, but not own the architecture.

## File-by-file slot-in map

### New foundation
- profile registry:
  - prefer a domain/persistence location such as:
    - `src/user_profiles/named_profile_store.ts`
    - `src/runtime_profiles/named_profile_store.ts`
    - `src/engine_persistence/profiles/named_profile_store.ts`
  - acceptable temporary fallback if needed:
    - `src/mono_ui/runtime/named_profile_store.ts`
- profile-scoped facade / scope:
  - likely colocated with the registry layer or persistence helpers
  - responsible for explicit scoped load/save routing

### Existing persistence stores to adapt
- `src/mono_ui/runtime/controls_profile_store.ts`
- `src/mono_ui/runtime/ui_customization_store.ts`
- `src/mono_ui/runtime/module_layout_store.ts`
- `src/mono_ui/runtime/camera_customization_store.ts`

### Game boot integration
- `src/canvas_app/app_state.ts`
  - resolve active profile before controls/theme/layout/camera loads
  - later react to actor claim by switching/confirming profile

### Painter boot integration
- `src/canvas_app/painter_app_state.ts`
  - resolve active profile before painter preference loads

### Shared nav / profile access surface
- `src/mono_ui/modules/screen_overlay_bar_module.ts`
- `src/mono_ui/modules/program_nav_bar_module.ts`
- game-side bar wiring in `src/canvas_app/app_state.ts`
- painter-side bar/menu wiring in `src/canvas_app/painter_app_state.ts` and `src/mono_ui/modules/painter_file_menu_module.ts`

### Identity-bound future UI consumers
- `src/mono_ui/modules/actor_claim_module.ts`
- `src/mono_ui/modules/world_entry_module.ts`
- `src/mono_ui/modules/world_join_module.ts`

## Recommended migration order

1. Add the profile registry/store
2. Add the profile-scoped facade / scope layer
3. Define profile selection and resolution rules
4. Make controls/theme/layout/camera stores profile-aware via adapters behind that scope
5. Wire explicit profile-scope resolution into game boot and painter boot
6. Add profile switching/management entry points to the shared bottom-bar UX
7. Add optional actor/profile linkage during claim and controlled-actor restore in the game app layer
8. Only after that, clean up login/start/claim surfaces to present profile-aware UX

## Design constraints

- Preserve current runtime behavior while profile plumbing is introduced.
- Avoid rewriting all consumers at once.
- Prefer adapter/wrapper changes first.
- Keep bottom bar as the primary shared access surface.
- Treat actor claim as a binding hook, not the only place profiles can exist.
- Do not make world entry/join screens the architectural source of truth.
- Do not deepen hidden global singleton state if an explicit scoped integration seam can be used instead.
- Keep rendering modules and UI panels as consumers of profile-backed state, not owners of profile resolution.
- Keep profile foundations app-agnostic where possible, with game-specific identity switching left in app integration code.

## Main conclusion

The best place to slot a named profile system is:

1. a new shared profile registry/store
2. a separate explicit profile-scoped facade for persistence routing
3. boot-time profile-scope resolution in both app states
4. claim-time / restore-time identity binding on the game side through app integration
5. shared bottom-bar access for editing and switching

This is the right direction for the repo as long as profile selection stays an explicit integration-layer concern instead of becoming more hidden global runtime state.

This should be completed before broader login/start-screen UX cleanup so profile behavior is grounded in a stable shared foundation instead of being embedded ad hoc into early shell screens.

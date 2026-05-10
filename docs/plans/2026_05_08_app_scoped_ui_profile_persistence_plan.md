# App-Scoped UI Profile Persistence Plan

Date: 2026-05-08  
Status: Implemented

## Context

We want to keep the UI color/customization system engine-owned and shared in code, while stopping `thaum_world` and `thaum_painter` from accidentally sharing the same live persisted UI profile file.

Originally both apps could resolve to the same profile id (for example `default`) and land on the same file:

- `profiles/<profile_id>/ui_customization.json`

That was too coupled for the intended direction. Current live authority is now app-scoped.

The target direction is:

- one engine-owned semantic UI color system
- separate persisted app configs per profile
- future game actor → world-profile binding
- future painter user → painter-profile binding
- optional explicit copy/sync flows later, not accidental shared live authority

## Goal

Change profile-scoped persistence so UI customization is app-scoped, while preserving the shared engine runtime/model/API.

Near-term practical outcome:

- `thaum_world` and `thaum_painter` no longer read/write the same `ui_customization.json`
- both still use the same engine `UiCustomizationState` / semantic role system
- future app-specific profile switching has a clean persistence seam

## Non-goals

- Do not split the engine color system into separate app-specific implementations
- Do not add full actor/profile auto-switching yet
- Do not add full painter-user profile UX yet
- Do not add cross-app sync/import UX yet
- Do not redesign semantic roles or color meaning here

## Desired architecture

### Engine-owned

Keep shared ownership in engine/runtime code for:

- `UiSemanticColorRole`
- `UiCustomizationState`
- default semantic role colors
- sanitization/validation
- load/save helpers
- change-event emission
- runtime `get_ui_semantic_rgb(...)` consumption

### App-owned

Move authority for persistence selection to the app/profile layer:

- active `thaum_world` profile selection
- active `thaum_painter` profile selection
- app-specific file path resolution
- future actor linkage behavior on world side
- future painter-user profile behavior on painter side

## Target persistence shape

Instead of:

- `profiles/<profile_id>/ui_customization.json`

Use app-scoped paths, conceptually:

- `profiles/<profile_id>/apps/thaum_world/ui_customization.json`
- `profiles/<profile_id>/apps/thaum_painter/ui_customization.json`

This same shape should likely become the standard for other app-owned profile payloads too:

- `controls.json`
- `camera_settings.json`
- `module_layouts.json`

Painter-only stores can still live in the same app-scoped subtree, for example:

- `profiles/<profile_id>/apps/thaum_painter/indexed_palette.json`

## Why this is the cleanest fit

This preserves:

- one engine hood
- one shared semantic color model
- one profile registry
- separate app configs
- clear future actor/user identity binding

It also avoids a bad middle state where world and painter seem separate in concept but still overwrite the same live file when both are on `default`.

## Current gap summary

### Original state

- `ProfileScope.files.ui_customization` resolved to `profiles/<profile_id>/ui_customization.json`
- `thaum_world` and `thaum_painter` could both select `default`
- both then shared one persisted UI customization file

### Current implemented state

- `ProfileScope.files.ui_customization` now resolves to `profiles/<profile_id>/apps/<app_id>/ui_customization.json`
- adjacent app-owned stores now also resolve under `profiles/<profile_id>/apps/<app_id>/...`
- legacy shared/profile-root files are migration sources, not intended live authority

### Still missing

- actor-bound game profile switching
- painter-user profile switching UX
- any explicit cross-app sync/copy UX

## Implementation phases

## Phase 1: Introduce app-scoped profile file paths

### Goal

Make profile-scoped file resolution app-aware.

### Primary file

- `src/user_profiles/profile_scope.ts`

### Tasks

- [x] Redefine `ProfileScope.base_dir` / `files.*` so app-owned payloads live under an app-specific subtree
- [x] Add an app-scoped path family such as:
  - `profiles/<profile_id>/apps/<app_id>/ui_customization.json`
  - `profiles/<profile_id>/apps/<app_id>/controls.json`
  - `profiles/<profile_id>/apps/<app_id>/camera_settings.json`
  - `profiles/<profile_id>/apps/<app_id>/module_layouts.json`
- [ ] Decide whether to keep profile-global files alongside app-scoped files for future shared metadata cleanup
- [x] Preserve the profile registry/index location at `profiles/index.json`

### Notes

This is the key architectural cut. Once `ProfileScope` is corrected, the engine stores can stay mostly the same while the path authority becomes correct.

## Phase 2: Classify profile-backed stores by ownership

### Goal

Make explicit which stores should be app-owned, shared, world-only, or painter-only.

### Candidate stores

- `src/mono_ui/runtime/ui_customization_store.ts`
- `src/mono_ui/runtime/controls_profile_store.ts`
- `src/mono_ui/runtime/camera_customization_store.ts`
- `src/mono_ui/runtime/module_layout_store.ts`
- `src/mono_ui/runtime/indexed_palette_store.ts`

### Proposed classification

#### App-owned

- [x] UI customization
- [x] controls
- [x] camera settings
- [x] module layouts

#### Painter-only / painter-owned

- [x] indexed palette

#### Shared profile metadata only

- [ ] profile registry / selected profile ids / future actor link metadata

### Notes

This prevents future accidental sharing from creeping back in store-by-store.

## Phase 3: Migrate UI customization persistence first

### Goal

Do the smallest useful cut first: fix UI colors before broader profile-store migration.

### Primary files

- `src/mono_ui/runtime/ui_customization_store.ts`
- `src/canvas_app/app_state.ts`
- `src/canvas_app/painter_app_state.ts`
- `src/canvas_app/main.ts` (only if preload/load ordering needs adjustment)

### Tasks

- [x] Make `load_ui_customization_state(...)` read/write the new app-scoped file via `profile_scope.files.ui_customization`
- [x] Remove effective cross-app sharing when both apps use the same profile id
- [x] Confirm runtime color events still work after app-scoped loading
- [x] Confirm both apps still consume the same semantic roles through shared engine APIs

### Migration behavior

- [x] Choose a minimal migration policy for existing `profiles/<profile_id>/ui_customization.json`
- [x] Implement policy:
  - if app-scoped file exists, use it
  - else seed app-scoped file once from legacy shared profile file or older root fallback if needed
  - then stop using the legacy shared file as live authority
- [x] After migration, make app-scoped files authoritative

### Notes

This migration should be one-way in spirit. The goal is little-to-no long-term support for the legacy shared path.

## Phase 4: Extend the same app-scoped rule to adjacent profile stores

### Goal

Bring the rest of the profile-backed app config stores in line.

### Tasks

- [x] Move controls to app-scoped profile files
- [x] Move camera settings to app-scoped profile files
- [x] Confirm module layouts remain app-scoped in both semantics and pathing
- [x] Move indexed palette to explicit painter app scope

### Notes

UI customization is the first cut because the accidental sharing is already visible there. But the same persistence rule should be applied consistently.

## Phase 5: Define game actor → world-profile binding

### Goal

Prepare the world app to bind a claimed actor to a world-side named profile without affecting painter state.

### Primary file

- `src/canvas_app/app_state.ts`

### Planned hook points

- `claim_actor(actor_ref)`
- restore/binding refresh paths already identified in the named-profile plan

### Tasks

- [ ] Define how actor metadata links to a named profile id
- [ ] Define when world should auto-switch to the linked world profile
- [ ] Ensure switching applies only to `thaum_world`
- [ ] Ensure painter profile selection is untouched by actor claim behavior

### Notes

This should remain app integration behavior, not hidden inside the shared store.

## Phase 6: Define painter user → painter-profile binding

### Goal

Prepare painter to choose and persist its own user/profile identity independently of game actor identity.

### Primary file direction

- `src/canvas_app/painter_app_state.ts`
- future profile UI entry points

### Tasks

- [ ] Define painter-selected profile behavior independent of world claim state
- [ ] Ensure painter loads its own app-scoped UI customization/config files
- [ ] Decide how painter profile selection is exposed in UX later

### Notes

Painter identity should not be inferred from the claimed world actor.

## Phase 7: Add optional explicit bridge flows later

### Goal

Allow harmony between apps without shared live persistence authority.

### Future-only examples

- [ ] copy world theme to painter
- [ ] copy painter theme to world
- [ ] apply shared theme preset to both
- [ ] import/export semantic theme set

### Rule

These should be explicit actions, not hidden shared file behavior.

## Validation checklist

### Persistence validation

- [ ] With both apps on profile id `default`, confirm they now write different UI customization files
- [ ] Confirm changing world UI colors does not change painter UI colors
- [ ] Confirm changing painter UI colors does not change world UI colors
- [ ] Confirm both still boot with valid defaults if their app-scoped file is missing

### Runtime validation

- [ ] Confirm `get_ui_semantic_rgb(...)` behavior remains unchanged for consumers
- [ ] Confirm document/CSS background sync still updates correctly in each app
- [ ] Confirm semantic-role customization UI still saves/loads correctly in each app

### Migration validation

- [ ] Confirm legacy shared profile file is no longer the ongoing live authority after first migration
- [ ] Confirm old installs seed cleanly into app-scoped files without losing user customization

## Recommended implementation order

1. `ProfileScope` path redesign
2. UI customization migration/cutover
3. validate world/painter separation live
4. move adjacent app-owned stores to the same path model
5. later add actor-bound world switching
6. later add painter-user profile switching
7. later add explicit copy/sync tools if desired

## Decision summary

The intended model should be:

- shared engine color system
- separate per-app profile config files
- world actor identity can later choose a world profile
- painter user identity can later choose a painter profile
- any cross-app matching should be explicit, not accidental

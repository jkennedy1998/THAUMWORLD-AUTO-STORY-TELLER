# Perception, Awareness, And Witness Runtime Unification Plan

Date: 2026-05-12

## Intent

Unify THAUMWORLD perception, awareness, LOS, sound propagation, witness reactions, and debug broadcast visualization under one modern authoritative runtime model.

This is not a greenfield redesign. It is a repair-and-unify plan based on what is actually live in the repo today.

The current system already has strong pieces in place:

- structured awareness state
- a live awareness runtime
- authoritative movement perception events
- sense MAG based detection bands
- witness reaction handling
- place-graph-aware observer collection

The main problem is not absence. The main problem is split authority.

Older 2D-era LOS/sound/broadcast logic still exists, but current gameplay often bypasses it. Newer runtime paths exist, but they are not yet consistently used for all actions, all observers, all awareness updates, or all debug visualization.

This plan defines how to consolidate those paths into one modern usage pattern.

## Status

Current state is partially unified, partially split:

- `src/interface_program/main.ts` is the live authority for movement-side perception emission.
- `src/shared/movement_perception_runtime.ts` is the strongest existing modern perception event builder.
- `src/shared/broadcast_observers.ts` is the strongest existing modern observer discovery path.
- `src/shared/sense_mag.ts` is the strongest existing modern runtime detection band evaluator.
- `src/action_system/perception.ts` is live for non-movement action perception, but uses a different observer collection model.
- `src/shared/awareness_runtime.ts` is the canonical structured awareness mutation layer.
- `src/npc_ai/witness_handler.ts` is the canonical witness reaction layer, but it often trusts event verdicts instead of re-running older LOS/hearing checks.
- `src/npc_ai/cone_of_vision.ts` still exists and still matters conceptually, but it is not the current authoritative source of truth.
- renderer/debug broadcast visualization still uses non-authoritative spatial assumptions, including non-canonical z handling.
- dormant or compatibility paths still exist and should be retired after parity is restored.

## Core Problem Statement

The repo currently has three overlapping perception-era layers:

1. **Canonical runtime detection layer**
   - `src/shared/sense_mag.ts`
   - used by `src/shared/movement_perception_runtime.ts`
   - used by `src/action_system/perception.ts`

2. **Legacy/fallback directional witness layer**
   - `src/npc_ai/witness_handler.ts`
   - `src/npc_ai/cone_of_vision.ts`

3. **Renderer/debug visualization layer**
   - `src/action_system/sense_broadcast.ts`
   - `src/mono_ui/modules/place_module.ts`
   - `src/mono_ui/vision_debugger.ts`

These layers are not fully aligned on:

- observer discovery
- action vs movement coverage
- LOS / directional checks
- wall / occlusion semantics
- cross-place sound propagation
- awareness mutation
- debug z/world-space truth

## Core Decisions

### 1. One perception authority

Perception event production should become authoritative in one shared runtime path used by both movement and non-movement actions.

Target authority center:

- `src/shared/broadcast_observers.ts`
- `src/shared/sense_mag.ts`
- shared perception event building helpers adjacent to `src/shared/movement_perception_runtime.ts`

This does **not** require movement and action execution to share the same file. It **does** require them to share the same observer discovery, detection rules, and event semantics.

### 2. One awareness mutation path

Structured awareness should be updated from canonical perception events through `src/shared/awareness_runtime.ts`.

Direct awareness tag/effect application may still exist for explicit scripted effects, but ordinary perception-driven awareness should not depend on alternate adapter-only hooks or duplicate effect paths.

### 3. Witness layer consumes, not decides

`src/npc_ai/witness_handler.ts` should primarily consume canonical perception verdicts and react.

It should not remain a shadow perception authority.

Older cone/hearing helpers may survive as reusable subroutines, but only if they are called by the canonical detection layer or explicitly documented as fallback/debug-only.

### 4. Debug visualization consumes canonical spatial data

Broadcast/vision debug rendering should use authoritative event payloads with real world-space and z data.

Renderer-local guessed particles may remain as temporary UX feedback, but they must not be mistaken for gameplay truth.

## Architectural Goals

- One observer discovery model for movement and actions.
- One runtime detection policy for `light` and `pressure`.
- One canonical way to represent perception verdicts in `PerceptionEvent`.
- One awareness mutation path for ordinary perception.
- One witness reaction entrypoint consuming canonical events.
- One debug visualization path based on canonical spatial payloads.
- No live gameplay dependency on renderer-authored perception batches.
- No hidden fallback path that silently changes LOS/sound rules by subsystem.

## Non-Goals

- Do not redesign senses, awareness, or NPC behavior from scratch.
- Do not remove useful helper math just because it is old.
- Do not optimize first.
- Do not preserve duplicate perception authorities indefinitely.
- Do not force explicit scripted `SYSTEM.SET_AWARENESS` effects to disappear if they still serve non-perception use cases.

## Current Authority Map

### Live modern authority

- movement perception event production:
  - `src/interface_program/main.ts`
  - `src/shared/movement_perception_runtime.ts`
- observer discovery for movement:
  - `src/shared/broadcast_observers.ts`
- runtime range/detail detection:
  - `src/shared/sense_mag.ts`
- awareness mutation:
  - `src/shared/awareness_runtime.ts`
- witness reactions:
  - `src/npc_ai/witness_handler.ts`

### Live but inconsistent / partially modernized

- non-movement action perception:
  - `src/action_system/perception.ts`
  - `src/interface_program/action_integration.ts`
- current action observer collection:
  - `src/action_system/target_resolution.ts`
  - same-place target gathering rather than place-graph-aware broadcast discovery

### Older / fallback / compatibility / likely retirement candidates

- `src/npc_ai/cone_of_vision.ts`
- `src/npc_ai/movement_perception.ts`
- `movement_perception_batch` inbox handling in `src/interface_program/main.ts`
- `perception_event_batch` compatibility handling in `src/interface_program/main.ts` if no live producer remains
- `src/integration/action_system_adapter.ts`
- `src/integration/action_system_integration.ts`
- any LOS validator path not used by the live action/movement runtime

## Fault Lines To Repair

### 1. Observer discovery mismatch

Movement currently uses:

- `src/shared/broadcast_observers.ts`

Actions currently use:

- `src/action_system/perception.ts` via `getCharactersInRange(...)`
- live dependency implementation in `src/interface_program/action_integration.ts`
- `src/action_system/target_resolution.ts`

This likely causes cross-place sound/broadcast inconsistencies.

### 2. Directional LOS authority mismatch

Current canonical event production generally uses range/detail sensing but not unified directional LOS enforcement.

Older directional checks still live in:

- `src/npc_ai/cone_of_vision.ts`

But witness handling often bypasses them because canonical events already carry `detectable`.

### 3. Wall/occlusion policy mismatch

`src/action_system/sense_broadcast.ts` describes properties like:

- `directional`
- `penetrates_walls`

But current canonical runtime detection does not centrally enforce full occlusion / wall policy from those fields.

### 4. Awareness hookup mismatch

Movement updates awareness directly through canonical runtime handling.

Non-movement action perception is live, but awareness mutation is not yet equivalently unified on the same authoritative path.

### 5. Debug spatial truth mismatch

UI/debug sense broadcast events currently can lose canonical z/world truth, causing 3D/plane mismatch between gameplay and visualization.

## Target End State

### A. Shared perception runtime helpers

Create or extract shared helpers so both movement and non-movement actions use the same pipeline for:

- observer candidate discovery
- sense profile lookup
- directional rule evaluation
- occlusion / penetration policy
- runtime detection verdict creation
- canonical `PerceptionEvent` construction

### B. Action perception adopts modern observer discovery

Non-movement action broadcasts should use the same observer discovery model as movement, based on:

- place graph adjacency
- place bounds/world-space distances
- observer sense envelope constraints

### C. LOS and sound rules become canonical

The canonical runtime detection layer should become the place where rules such as the following are enforced:

- `light` is directional and visibility-limited
- `pressure` is omnidirectional but range/occlusion constrained
- `penetrates_walls` behavior is real, not descriptive-only
- world z / place adjacency are honored consistently

### D. Witness handler becomes reaction-focused

`src/npc_ai/witness_handler.ts` should react to canonical results instead of carrying separate gameplay-important detection policy.

### E. Awareness updates become event-driven across action types

Movement and non-movement actions should both update awareness from the same canonical event semantics.

### F. Debug visuals consume canonical events

Broadcast and perception debug rendering should render from canonical world/z payloads, not from renderer-local guesses.

## Implementation Phases

## Phase 0 - Inventory, logging, and guardrails

- [ ] Confirm current live producers/consumers for `perception_event_batch`.
- [ ] Confirm `src/npc_ai/movement_perception.ts` has no live authoritative callers.
- [ ] Add focused structured logs around canonical perception event production for both movement and actions.
- [ ] Add focused structured logs around awareness updates from action perception.
- [ ] Add focused structured logs around witness acceptance/rejection reasons.
- [ ] Capture at least one baseline repro per fault line using current logs.

## Phase 1 - Define canonical shared perception builder surface

- [~] Introduce or extract a shared helper layer for canonical perception event building.
- [ ] Factor shared event-building concerns out of `src/shared/movement_perception_runtime.ts` and/or `src/action_system/perception.ts` without creating a second runtime authority.
- [~] Standardize the canonical meaning of:
  - [~] `detectable`
  - [~] `bestSense`
  - [~] `detections`
  - [~] `observerPositionWorld`
  - [~] `actorPositionWorld`
  - [ ] `actorVisibility`
  - [ ] `identityKnown`
  - [ ] `locationKnown`
- [ ] Document how action subtype and movement subtype feed sense profile lookup.

## Phase 2 - Unify observer discovery

- [x] Replace non-movement action perception candidate gathering with the same observer discovery model used by movement.
- [x] Reuse `src/shared/broadcast_observers.ts` or shared helpers extracted from it.
- [ ] Ensure action broadcasts can reach valid observers across adjacent places when sense/range rules allow.
- [ ] Preserve self-exclusion and actor/npc handling semantics.
- [ ] Add targeted logs comparing old candidate counts vs new candidate counts during rollout.

## Phase 3 - Canonical LOS / directional / sound policy

- [ ] Decide whether `src/npc_ai/cone_of_vision.ts` becomes:
  - [ ] a helper called by canonical detection, or
  - [ ] debug/fallback-only code
- [ ] Make `light` directional rules canonical in the shared detection path.
- [ ] Add canonical support for wall / occlusion policy for `light`.
- [ ] Add canonical support for wall / occlusion / muffling policy for `pressure`.
- [ ] Ensure `directional` and `penetrates_walls` from sense profiles are enforced by runtime logic, not treated as descriptive only.
- [ ] Ensure world z / place transitions are respected consistently by those checks.

## Phase 4 - Unify awareness mutation from canonical action perception

- [x] Route non-movement action perception awareness updates through `src/shared/awareness_runtime.ts`.
- [ ] Avoid adapter-only awareness hooks as the only path.
- [ ] Review whether `src/state_applier/apply.ts` duplicate-skip behavior is acceptable for explicit scripted awareness effects.
- [ ] Separate explicit scripted awareness effects from ordinary sensory awareness updates in docs and implementation.

## Phase 5 - Simplify witness authority

- [ ] Keep `src/npc_ai/witness_handler.ts` as the reaction layer.
- [ ] Remove or reduce gameplay-significant fallback detection logic there once canonical detection is complete.
- [ ] Keep only the minimum necessary compatibility behavior for incomplete/legacy events during migration.
- [ ] Add explicit logs when witness handling is using fallback detection rather than canonical event verdicts.

## Phase 6 - Canonical debug / visualization path

- [~] Change debug sense broadcast rendering to consume authoritative world/z origins.
- [~] Remove `z: NaN` style fallback payloads from canonical debug events.
- [ ] Ensure renderer particles for broadcasts/vision reflect the same event semantics gameplay uses.
- [ ] Keep optional local-only UX particles clearly separate from authoritative debug visualization.

## Phase 7 - Retirement and cleanup

- [ ] Retire `src/npc_ai/movement_perception.ts` if no longer needed.
- [ ] Remove ignored legacy `movement_perception_batch` handling once safe.
- [ ] Remove `perception_event_batch` compatibility handling if no live producers remain.
- [ ] Retire dormant duplicate integration layers if they remain unused.
- [ ] Update stale docs that still describe awareness primarily as tags-only state.

## Validation Strategy

### Logs first

Use the structured log system as source of truth during rollout.

Primary checks:

- movement perception event emitted
- action perception event emitted
- observer candidate counts
- accepted vs rejected detections and reasons
- awareness mutation applied
- witness reaction triggered
- debug visualization payload emitted with real z/world data

## Regression / smoke targets

Prefer focused TAI or test coverage for the following:

- [ ] normal `COMMUNICATE` heard by nearby NPC in same place
- [ ] `COMMUNICATE.SHOUT` heard across adjacent connected places when expected
- [ ] `COMMUNICATE.WHISPER` does not over-propagate
- [ ] movement `WALK` produces awareness and witness reaction
- [ ] movement `SNEAK` reduces pressure-based detectability
- [ ] action `USE.IMPACT_SINGLE` and/or `USE.PROJECTILE_SINGLE` produces expected witnesses
- [ ] directional visual detection fails from blind spot when only `light` should apply
- [ ] pressure-only detection succeeds without line-of-sight when policy allows it
- [ ] wall/occlusion blocks `light` when expected
- [ ] debug overlays align with canonical z/world-space event origin

## Likely File Targets

Primary likely work areas:

- `src/shared/movement_perception_runtime.ts`
- `src/shared/broadcast_observers.ts`
- `src/shared/sense_mag.ts`
- `src/shared/awareness_runtime.ts`
- `src/action_system/perception.ts`
- `src/interface_program/action_integration.ts`
- `src/npc_ai/witness_handler.ts`
- `src/npc_ai/cone_of_vision.ts`
- `src/action_system/sense_broadcast.ts`
- `src/mono_ui/modules/place_module.ts`
- `src/mono_ui/vision_debugger.ts`
- `src/interface_program/main.ts`

Secondary likely cleanup targets:

- `src/npc_ai/movement_perception.ts`
- `src/integration/action_system_adapter.ts`
- `src/integration/action_system_integration.ts`
- `docs/guides/TROUBLESHOOTING.md`

## LOS Audit And First Implementation Slice

### Current audit result

#### Keep as policy/config only

- `src/npc_ai/vision_presets.ts`
  - preset names
  - `angle_degrees`
  - `range_tiles`
- hearing ratio policy currently expressed in `src/npc_ai/cone_of_vision.ts`
- sense-range/detail policy in `src/shared/sense_mag.ts`

These should survive only as tuning inputs, not as final LOS authority.

#### Retire as LOS authority

`src/npc_ai/cone_of_vision.ts` is not canonical 3D LOS.

It currently provides:

- yaw-only cone checks in XY
- 3D distance
- no shared voxel occlusion trace
- ad hoc debug helpers like `get_cone_tiles(...)` / `get_hearing_tiles(...)`

Live gameplay witness checks still depend on this here:

- `src/npc_ai/witness_handler.ts`
  - `can_see(...)`
  - `can_hear(...)`

This is the main remaining split-authority path.

#### Existing stronger building blocks

- geometry candidate generation:
  - `src/shared/geometry/shape3d.ts`
  - `project_vision_cone_to_planes(...)`
- shared voxel tracing:
  - `src/shared/math3d.ts`
  - `trace_voxel_ray_3d(...)`
- current blocker authority candidate:
  - `src/place_storage/occupancy_index.ts`
  - `place_voxel_blocks_los(...)`

These are closer to the desired final architecture, but are currently mixed into debug-only usage and renderer-specific call sites.

### Clean target

One visual detection authority:

1. policy/presets define range/FOV defaults
2. shared LOS runtime evaluates candidate visibility
3. world blocker adapter answers `blocks_los_at(x, y, z)`
4. witness/debug/awareness consumers all use that same result

### Exact smallest first implementation slice

#### Slice 1 goal

Create a shared LOS evaluator seam without changing all consumers at once.

#### Slice 1 file targets

New shared files:

- `src/shared/perception_los.ts` or equivalent nearby shared runtime file

Likely touched existing files:

- `src/npc_ai/witness_handler.ts`
- `src/mono_ui/vision_debugger.ts`
- `src/shared/geometry/shape3d.ts`
- `src/npc_ai/cone_of_vision.ts`
- `src/npc_ai/vision_presets.ts`

#### Slice 1 scope

Add a minimal shared evaluator that can answer:

- is target voxel/point visible from observer?
- optionally: what cone candidate cells are visible under one blocker callback?

The evaluator should own:

- yaw/FOV directional gating
- 3D voxel ray occlusion tracing
- blocker-callback usage

The evaluator should not own:

- tile loading
- renderer particles
- witness reactions
- awareness mutation

#### Slice 1 migration use

First consumer migration should be:

- `src/npc_ai/witness_handler.ts`
  - replace old `can_see(...)` authority with shared LOS evaluator

Do not yet broaden to full hearing refactor or all debug consumers in the same first slice.

That gives the first meaningful cleanup with the smallest gameplay-facing surface:

- witness/gameplay visual detection stops using old cone authority
- debug can continue temporarily as a consumer of the same lower-level tracing pieces

#### Slice 1 non-goals

- no broad sound-policy rewrite yet
- no full cross-place pressure muffling model yet
- no forced move of all geometry code out of `shape3d.ts` in one pass
- no renderer-side blocker authority redesign in the same edit

### Follow-up slices after Slice 1

#### Slice 2

Move debug cone evaluation to consume the same shared LOS evaluator rather than carrying a parallel trace path.

#### Slice 3

Demote `src/npc_ai/cone_of_vision.ts` to policy/debug helpers only, or retire it after presets are fully extracted.

#### Slice 4

Introduce canonical pressure/hearing occlusion policy using the same blocker seam.

## Open Questions To Refine Before Implementation

- Should canonical LOS/occlusion live inside `src/shared/sense_mag.ts`, beside it, or above it in a richer shared perception runtime module?
- Should `src/npc_ai/cone_of_vision.ts` be reduced to preset/policy-only helpers, or retired completely after migration?
- What is the intended final policy for cross-place sound propagation through doors/walls/seams?
- What is the intended first-pass muffling model for `pressure`?
- Which explicit awareness effects should remain legal outside ordinary perception events?
- Should action perception become fully authoritative in `src/interface_program/main.ts`, or remain pipeline-owned but use the shared canonical builder?
- What canonical debug event shape should the renderer consume?

## Definition Of Done

This project is complete only when all of the following are true:

- movement and non-movement actions use one observer discovery model
- movement and non-movement actions use one canonical perception verdict model
- LOS / directional / sound rules are enforced in the canonical runtime, not only in fallback helpers
- ordinary perception-driven awareness updates flow through the canonical awareness runtime
- witness handling is reaction-focused rather than a shadow detection authority
- debug visualization uses canonical spatial payloads with correct z/world origin
- legacy renderer-authored perception batch paths are retired or clearly non-authoritative
- duplicate integration layers no longer create gameplay rule drift

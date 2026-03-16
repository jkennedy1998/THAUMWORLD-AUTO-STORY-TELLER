# Unified Movement System Implementation Plan

Date: 2026-03-13

## Status

- [~] in progress

## Intent

Implement the unified movement system described in `docs/plans/2026_03_13_unified_movement_system_design.md` as the long-term canonical movement + physics substrate.

This plan is focused on integrating into the existing pre-alpha codebase cleanly:

- reuse strong foundations already present (server breath loop, shared legality)
- migrate away from split authorities and legacy stepping
- keep scalability and determinism as first-class constraints

End-state requirement:

- At the end of this plan, THAUMWORLD has one working movement system that matches `docs/plans/2026_03_13_unified_movement_system_design.md` in runtime behavior, data model, authority boundaries, and verification.
- Legacy movement systems may be used as migration scaffolding temporarily, but they must not remain authoritative after cutover.

## Source Of Truth / Dependencies

- Design goal: `docs/plans/2026_03_13_unified_movement_system_design.md`
- Legality + pathfinding single source: `docs/plans/2026_03_11_movement_unification_plan.md`
- Place persistence consolidation: `docs/plans/2026_03_16_place_persistence_consolidation_plan.md`
- Current server breath + movement controller: `src/interface_program/main.ts`
- Legality oracle: `src/place_storage/movement_legality.ts` (`can_place_volume(...)`)

## Invariants (Non-Negotiable)

- Breath is canonical: server advances global place breath and simulates free time on breaths.
- One entity produces at most one grid step per physics breath.
- One step changes exactly one axis group: `(dx,dy,0)` OR `(0,0,dz)`.
- Server is authoritative for final positions and breath index.
- Movement legality is single source of truth (`can_place_volume(...)`); no new parallel walkability logic.
- Collision only occurs in physics when no legal step can be produced for the entity that breath.
- Input/action may choose movement subtypes using legality, but must not mutate occupancy or emit collision.
- Renderer and NPC subsystems must not retain long-term stepping authority after cutover.

## Definition Of Done

This plan is complete only when all of the following are true:

- Player held movement, click-to-move, and NPC movement all use the same server-authoritative movement/physics substrate.
- The runtime behavior matches the unified design doc for:
  - breath-driven action + physics ordering
  - MOVE as acceleration/braking into velocity
  - one-step-per-breath resolution
  - stuck-only collision
  - move budget + move debt
  - gravity / friction hooks
  - `move.walk.incline`
- No legacy renderer-side or npc-ai-side movement stepper remains authoritative.
- Persistence is migrated cleanly enough that old saves load safely and new saves store the canonical movement state.
- Acceptance tests in this plan pass and are marked complete.

## Implementation Principles

- Prefer replacement over adapter pyramids.
- Reuse legality/pathfinding helpers where they are already correct.
- Keep authority boundaries simple: renderer captures intent, server simulates, renderer reconciles.
- Minimize long-lived dual-write / dual-authority windows.
- Add migration scaffolding only when it shortens the path to deletion.
- Any temporary compatibility layer added by this plan must have an explicit removal phase.
- Runtime augmentation and persistence must remain separate concerns: saved place/entity data stays canonical, while renderer/debug/runtime physics augmentation remains reproducible runtime state.

## Current System (Historical Starting Point)

Server breath + stepping:

- `src/interface_program/main.ts` runs `BREATH_MS = 33` place breaths for active places.
- Per-entity movement still uses `move_ctl` as the high-level controller shell, but live movement spend is now primarily driven by `movement_physics.move_budget` / `move_debt` and velocity state.
- Held intent comes from `POST /api/movement/intent`.
- Click-to-move comes from `POST /api/movement/move_to` and shared pathfinding.
- Actors/NPCs now resolve movement through explicit action + physics phases in `main.ts`, with gravity applied as velocity acceleration during physics.
- Loose items still use a dedicated active-place gravity pass; that pass is acceptable only as a temporary host while matching the same support/gravity semantics as actors/NPCs.

Renderer input:

- `src/mono_ui/runtime/input_actions.ts` provides last-press-wins cardinal intent.
- `src/mono_ui/modules/place_module.ts` polls intent each frame and POSTs `/api/movement/intent`.

Legacy / split authorities still present:

- Renderer movement engine: `src/shared/movement_engine.ts` (legacy authority + interpolation + breath gating)
- Renderer NPC command execution: `src/mono_ui/modules/movement_command_handler.ts`
- NPC command protocol: `src/shared/movement_commands.ts`
- Legacy NPC movement loop: `src/npc_ai/movement_loop.ts`

Current migration verification notes:

- Connected place data for the active zoo route has been inspected (`eden_crossroads_tavern` <-> `eden_crossroads_square`).
- NPC save files in connected places already carry `movement_schedule`, `movement_physics`, `breath_index`, and `breath_last_processed` fields in the expected migration format.
- `eden_crossroads_square` has been corrected to include a full `tiles_z0` support floor so travel from the tavern and NPC wandering are testable under the unified movement system.
- Current blocker is no longer data format; it is remaining runtime authority cleanup for NPC-side movement systems.
- Before Phase 6 verification is considered trustworthy, NPC location data must be consistent across the NPC save, connected-place snapshots, and `place_entity_index`; partial moves like the current Gunther tavern test setup must not leave split authority/debug state behind.
- Click-to-move now performs immediate server-side path planning on goal queue instead of waiting for the lower-frequency think phase, reducing initial click latency.
- Intended visible-place behavior is a steady realtime pulse (one breath per scheduled interval) while offscreen places retain catch-up behavior.
- Recent `dev:logs` runs show visible interval pulses reaching the intended `ticks: 1` cadence more reliably; the remaining convergence focus is now authority cleanup, NPC migration, and keeping renderer reconciliation passive.
- Recent place save/refresh regressions show that place persistence hardening is now a prerequisite for safe tile/item/entity runtime mutation and for the upcoming place painter; movement work must not rely on in-place save sanitization mutating live active place state.

## Immediate Alignment Priorities (March 2026)

These priorities are the next implementation focus so the runtime moves back toward the design doc while keeping latency low enough for live testing.

### Priority 1: Restore visible-place realtime pacing

- In `src/interface_program/main.ts`, visible places must execute at most one breath per scheduled interval tick.
- Offscreen places may continue to use bounded catch-up.
- Immediate visible pulses for `intent` / `move_to` remain allowed, but they must not create later visible burst repayment.
- Development target: visible-place logs should continue to show `ticks <= 1` for ordinary interval pulses, and any regression back to burst repayment blocks later migration work.

### Priority 2: Re-establish per-breath authoritative freshness

- Every breath must read the authoritative entity position/state produced by the previous breath before action-phase legality or physics-phase resolution runs again.
- The action phase and physics phase in `src/interface_program/main.ts` must not reuse stale snapshots across visible multi-step processing.
- Development target: no repeated `physics resolved step` entries that keep resolving the same destination from the same source across successive breaths unless an entity is intentionally blocked.

### Priority 3: Stop hiding visible step cadence from the renderer

- Visible-place movement updates must preserve ordered per-breath player steps instead of coalescing everything to the final position of a burst.
- Offscreen catch-up may still coalesce if needed for efficiency.
- Development target: local-player renderer logs should continue to track server breath cadence instead of long gaps followed by snaps, and renderer movement code should not reintroduce its own gameplay cadence.

### Priority 4: Retune acceleration for debuggability

- The current action-phase MOVE spending is too aggressive for validation; velocity grows too quickly to reason about cadence and resolver behavior.
- Keep the design-doc MOVE -> velocity model, but lower/tighten the practical tuning while verification is in progress.
- Development target: per-breath acceleration, budget spend, and resulting velocity should stay readable enough that one-step-per-breath behavior can be inspected directly in logs.

### Priority 5: Validate incline and dominant-axis interaction

- Incline selection should remain an action-phase choice, but the resulting velocity and resolver candidate ordering must still produce believable per-breath movement.
- The physics resolver must continue to attempt at most one successful step per breath while respecting deterministic axis selection and fallback rules from the design doc.
- Development target: incline-up/down tests produce understandable step sequences without unrelated stored velocity causing confusing sideways movement.

### Priority 6: Harden persistence and place-local pause boundaries

- Place save paths must not sanitize or downgrade the live active place object in place during runtime mutation.
- Runtime augmentation for tiles/structures/entities must remain reproducible and must not leak into canonical saved place JSON.
- Reuse the existing place-local pause path (`time_scale` + `pause_sources` + `/api/place/pause`) and harden it so it fully stops breath-driven simulation for the edited place, including movement, tile physics, item gravity, and time-driven updates.
- Development target: live runtime place edits (items, tiles, actors, NPCs, structures) persist across reboot without causing raw `?` tiles or stale active-place drift.

## Architecture Mapping (Current -> Target)

### Canonical systems to keep and evolve

- `src/interface_program/main.ts`
  - keep as the server breath loop host and movement authority entrypoint
  - evolve from cadence stepping to action-phase + physics-phase movement simulation
- `src/place_storage/movement_legality.ts`
  - keep as the legality oracle
  - extend only when required by the design doc
- `src/shared/pathfinding.ts`
  - keep as advisory pathfinding only
  - continue to depend on legality rather than embedding movement rules
- `src/place_storage/store.ts` + `src/shared/defs_deltas_sanitize.ts`
  - keep as the canonical place persistence boundary
  - harden so canonical saved place data and runtime-augmented place data remain distinct
- existing place pause plumbing in `src/interface_program/main.ts` + `src/canvas_app/app_state.ts`
  - keep as the place-local simulation pause authority
  - verify and harden rather than rebuilding pause semantics in a second system

### Transitional systems to reduce and then remove

- `src/shared/movement_engine.ts`
  - current role: renderer/legacy stepping + interpolation
  - target role: presentation helper only, or delete if server update interpolation is implemented elsewhere
- `src/mono_ui/modules/movement_command_handler.ts`
  - current role: renderer-side NPC movement execution
  - target role: no movement authority; retain only non-movement UI/facing helpers if still useful
- `src/shared/movement_commands.ts`
  - current role: renderer-facing NPC movement command protocol
  - target role: deprecate for movement execution; keep only unrelated UI command payloads if still needed
- `src/npc_ai/movement_loop.ts`
  - current role: legacy NPC stepping/path loop
  - target role: delete or hard-disable once NPCs write goals/intents into the canonical server movement system

### Current build snapshot (March 2026)

- `apply_movement_action_phase_one_breath(...)`, `apply_server_movement_one_breath(...)`, `apply_server_thinking_one_breath(...)`, and `apply_server_brain_one_breath(...)` are already present in `src/interface_program/main.ts` and should be treated as the canonical host for continued migration.
- The narrow velocity resolver, gravity-on-`vz`, incline injection, and move budget/debt accounting are already partially implemented and tested for actors.
- Loose-item gravity is behaving closer to spec, but it still runs in `apply_gravity_to_place_ground(...)` rather than through the same active entity runtime host as actors/NPCs.
- NPC migration is the main remaining authority split: server-side NPC goal/path hooks exist, but renderer/NPC legacy movement systems are still present and must not survive Phase 6/7.
- Gravity-tagged tiles/objects are not yet part of the canonical runtime path; per the design spec, they should enter through an explicit tile-physics host that reuses shared gravity/support helpers rather than being treated as normal actor/NPC movers.
- Place persistence/runtime augmentation boundaries are not hardened enough yet for heavy live-authoring workflows; this is now shared prerequisite work for movement-backed runtime tile mutation and place painter mode.
- Place pause already has meaningful implementation coverage; remaining work is to ensure every breath-driven phase and persistence/sync path respects that existing pause authority cleanly.

### Current authoritative state to replace

- `move_ctl` in `src/interface_program/main.ts`
  - historical model: `intent` + `goal/path` + `move_accum` + `breaths_per_step`
  - current migration state: still carries intent/goal/path ownership, but live movement spend gating has moved to `movement_physics.move_budget/move_debt`
  - target model: movement/physics component with velocity, intent, budget, debt, and minimal verb-selection state

## Target Architecture (What We Are Building)

### A) Server-only movement/physics authority

The server maintains per-entity movement state as a component:

- `velocity: (vx,vy,vz)` 3D integer vector
- `latest_intent` (cardinal input direction + modality + modifiers)
- `move_budget[modality]` and `move_debt[modality]` (free-time throttle + overspend)
- any minimal verb/subtype selection state (e.g. selecting incline)

Canonical runtime state (initial target):

```ts
type MovementPhysicsRuntimeState = {
  entity_ref: string;
  entity_type: 'actor' | 'npc';
  place_id: string;

  velocity: { vx: number; vy: number; vz: number };

  latest_intent: {
    dx: -1 | 0 | 1;
    dy: -1 | 0 | 1;
    modality: 'walk' | 'climb' | 'swim' | 'fly';
    mode: string; // existing movement mode naming can map here during migration
    updated_breath: number;
  } | null;

  move_budget: { walk: number; climb: number; swim: number; fly: number };
  move_debt: { walk: number; climb: number; swim: number; fly: number };

  goal: { x: number; y: number; z?: number } | null;
  advisory_path: Array<{ x: number; y: number; z?: number }> | null;
  advisory_path_index: number;

  transient_selection: {
    movement_verb: 'move' | null;
    movement_subtype: string | null;
    modality: 'walk' | 'climb' | 'swim' | 'fly' | null;
  } | null;

  last_breath_processed: number;
};
```

Runtime state rules:

- This is the canonical in-memory state for free-time movement simulation.
- Persisted data should be a minimal subset of this state; advisory/transient fields do not need to be written unless they become necessary for recovery.
- Runtime state should replace `move_ctl` responsibility rather than wrapping `move_ctl` forever.

The server breath loop applies the unified pipeline per breath:

1) Action phase (intent -> MOVE acceleration)
2) Physics phase (gravity accel -> velocity resolver -> friction -> collision)
3) Other breathing tags (growth, decay, etc.)

The renderer only:

- captures input
- sends intent/goal updates
- animates/interpolates
- reconciles to server position updates

### B) Legality as a pure oracle

All step attempts (both intent selection and physics execution-time legality) call the same helper:

- `src/place_storage/movement_legality.ts:can_place_volume(...)`

Action/intent phase may consult legality to choose a movement subtype (e.g. incline), but it must not mutate occupancy or emit collision.

### C) Velocity-based stepping

Replace cadence stepping (`move_accum`, `breaths_per_step`) with:

- MOVE as acceleration to the integer velocity vector (supports braking)
- a deterministic velocity-to-step resolver each physics breath
- gravity as acceleration on `vz`
- friction/drag as pluggable velocity decay
- collision only when stuck (no legal step on any non-zero axis)

### D) Incline (walk subtype)

Implement `move.walk.incline` selection in action phase:

- forward direction is the input direction `d`
- incline-up vs incline-down is mutually exclusive, determined by why forward step failed:
  - blocked/occupied => try incline-up
  - void/unsupported => try incline-down
- on initiating breath spend 2 walk MOVE units (overspend allowed -> debt)
- apply `vz += +/-1` and `vx/vy += +/-1` (based on input)
- do not force axis selection; physics resolves normally

## Data Model / Persistence

### New persisted fields (actors + NPCs)

Add a movement/physics state section to actor/NPC JSON:

- `movement_physics.velocity: { vx, vy, vz }`
- `movement_physics.move_budget: { walk, climb, swim, fly }` (numbers)
- `movement_physics.move_debt: { walk, climb, swim, fly }` (ints)
- `movement_physics.last_intent: { dx, dy, modality, mode }` (optional)
- keep existing `breath_index` + `breath_last_processed` fields for catch-up

Recommended shape (initial):

```ts
movement_physics: {
  velocity: { vx: 0, vy: 0, vz: 0 },
  move_budget: { walk: 0, climb: 0, swim: 0, fly: 0 },
  move_debt: { walk: 0, climb: 0, swim: 0, fly: 0 },
  last_intent: {
    dx: 0,
    dy: 0,
    modality: 'walk',
    mode: 'WALK',
  },
  last_breath_processed: 0,
}
```

Notes:

- Use lowercase modality keys in persisted data unless an existing schema convention requires otherwise.
- `last_intent` is persisted primarily for clean recovery/debugging; if that proves too noisy, it can become cache-only later.
- Keep the persisted shape minimal; do not persist derived resolver scratch state unless absolutely necessary.

### Deprecation

- `movement_schedule` (breaths_per_step/next_breath) becomes legacy/diagnostic and will be removed once velocity stepping is canonical.

### Save Migration Policy

- Existing saves must load without manual migration steps.
- Missing `movement_physics` fields are initialized on load with safe defaults.
- During migration, legacy movement fields may be preserved for compatibility/inspection, but new runtime logic must not depend on them once cutover is complete.

Persistence boundary rule:

- Persist only canonical long-lived state needed for recovery/catch-up.
- Do not persist advisory path progress, transient movement subtype selection, or resolver scratch data unless later implementation proves it is necessary.

## Persistence Migration Matrix

### Fields to keep

- `breath_index`
  - keep as canonical timing metadata on actors/NPCs
- `breath_last_processed`
  - keep for catch-up / offline simulation bookkeeping
- facing fields already present on entities
  - keep; still used by presentation / body-model-aware systems

### Fields to replace

- `movement_schedule.walk/climb/swim/fly.breaths_per_step`
  - current meaning: cadence delay per modality
  - replacement: `movement_physics.move_budget[modality]`, `movement_physics.move_debt[modality]`, and velocity-driven physics
- `movement_schedule.walk/climb/swim/fly.next_breath`
  - current meaning: cadence scheduling marker
  - replacement: no direct equivalent; authoritative cadence is replaced by budget/debt and per-breath action processing

### New canonical fields

- `movement_physics.velocity`
- `movement_physics.move_budget`
- `movement_physics.move_debt`
- `movement_physics.last_intent` (if persisted)

### Migration rule

- Do not attempt a semantic conversion from `breaths_per_step` into velocity state.
- Initialize the new movement physics state from safe defaults and current entity stats, then let runtime simulation build real values from live play.
- Treat old scheduling fields as deprecated compatibility data, not as source data for the new movement model.

## Migration Strategy (Do Not Preserve Legacy Long Term)

Primary goals:

- keep server as the single movement authority
- remove renderer/NPC local stepping authority
- avoid a long-lived hybrid (cadence + velocity) model

Approach:

- introduce the new movement component in parallel with current `move_ctl`
- gate behavior behind a feature flag per place or per entity
- once the velocity stepper is stable, delete cadence stepping and legacy movement authority paths

Cutover rule:

- For any entity/breath, exactly one movement authority path may be active.
- Do not allow cadence stepping and velocity stepping to both mutate authoritative position for the same entity.

Recommended rollout shape:

- Stage 1: add new data model + feature flag with no behavior change
- Stage 2: player held movement on velocity stepper
- Stage 3: click-to-move on velocity stepper
- Stage 4: NPCs on velocity stepper
- Stage 5: remove old authority paths

## Risk Areas / Watchpoints

- Dual authority during migration causing rubberbanding or state drift
- Save migration bugs causing actors/NPCs to load without usable movement state
- Gravity behavior changing unexpectedly when moved from settle-pass to velocity acceleration
- Incline selection causing surprising motion if legality reason handling is inconsistent
- Input/debt behavior feeling unresponsive if accounting order is implemented incorrectly
- Pathfinding assumptions becoming invalid when execution is velocity-based and physics may choose non-path axes first

Mitigation approach:

- keep logs explicit at phase boundaries (intent selection, budget/debt spend, gravity accel, resolver result, collision result)
- land the migration in authority-safe slices (player intent, click pathing, NPCs) rather than swapping every path at once
- prefer deterministic fallback behavior over smart-but-hard-to-debug heuristics

## Feature Flags / Rollout Controls

- Add one explicit feature flag for the unified velocity movement system.
- Support enabling by scope in this order:
  - development-only global toggle
  - per-place toggle
  - per-entity-type toggle (actor / npc)

Requirements:

- The flag must choose one authoritative path only.
- Logs must clearly show which movement authority path is active for a given entity.
- Remove the flag after cutover is complete and stable.

Flag discipline:

- Feature flags may gate which authority path is active.
- Feature flags must not introduce mixed behavior inside a single authority path (e.g. cadence movement with velocity collision rules).

## Systems To Reuse (Keep)

- Breath loop and active place lifecycle: `src/interface_program/main.ts`
- Movement legality oracle: `src/place_storage/movement_legality.ts`
- Shared pathfinding: `src/shared/pathfinding.ts`
- Renderer input intent: `src/mono_ui/runtime/input_actions.ts`
- Server movement endpoints shape: `/api/movement/intent`, `/api/movement/move_to`

## Systems To Deprecate (Remove Authority)

- `src/shared/movement_engine.ts` as authoritative stepping (keep only as optional renderer animation helper if still needed)
- `src/mono_ui/modules/movement_command_handler.ts` movement execution authority
- `src/shared/movement_commands.ts` as a long-term movement authority protocol
- `src/npc_ai/movement_loop.ts` legacy stepping logic
- `move_ctl` cadence (`move_accum`, `breaths_per_step`) once velocity is canonical

## Module Work Map

### Server runtime

- `src/interface_program/main.ts`
  - add/host canonical movement state access
  - replace cadence stepping with action + physics phases
  - keep breath loop host responsibility

Recommended extraction targets inside `src/interface_program/main.ts`:

- `build_place_contents_for_legality(...)`
  - keep, but treat as a shared place-snapshot prep step used by both action and physics phases
- `apply_server_movement_one_breath(...)`
  - split and replace with:
    - `apply_movement_action_phase_one_breath(...)`
    - `apply_movement_physics_phase_one_breath(...)`
- `apply_server_thinking_one_breath(...)`
  - keep as advisory path planning / non-physics thinking
  - ensure it writes goals/intent only, not movement outcomes
- `apply_server_brain_one_breath(...)`
  - keep as higher-level NPC decision layer
  - ensure it writes goals/intent only, not movement outcomes
- gravity helpers
  - replace current gravity settle-style helpers with a unified per-entity gravity acceleration pass invoked by physics

Recommended new helper/module boundaries (whether extracted immediately or introduced in-place first):

- `get_or_init_movement_physics_state(entity)`
- `refill_move_budget_and_apply_debt(entity, modality, breath_index)`
- `select_movement_verb_from_intent(entity, place)`
- `apply_move_acceleration(entity, selected_verb)`
- `apply_gravity_acceleration(entity, place)`
- `resolve_velocity_step(entity, place, breath_index)`
- `apply_friction(entity, place, moved_axis)`
- `resolve_stuck_collision(entity, blocked_axes)`
- `persist_entity_movement_state(entity, breath_index)`

Extraction principle:

- Keep the breath loop itself in `main.ts`, but move movement-specific logic behind named helpers so the implementation can be tested and deleted cleanly.

### Persistence

- `src/actor_storage/store.ts`
  - initialize and save actor movement physics defaults
- `src/npc_storage/store.ts`
  - initialize and save NPC movement physics defaults

### Legality + pathing

- `src/place_storage/movement_legality.ts`
  - continue as single legality oracle
- `src/shared/pathfinding.ts`
  - remain advisory and legality-backed

Legality contract additions needed for unified movement:

- Step legality must continue returning a reasoned result, not a boolean-only result.
- Action-phase subtype selection and physics-phase resolver must both be able to distinguish at minimum:
  - `blocked`
  - `no_support`
  - `out_of_bounds`
  - `reserved`
- `blocked` detail must stay rich enough to debug why a step failed (tile vs occupant, owner info when available).
- The resolver should use legality as an oracle, not reimplement occupancy/support reasoning locally.

### Renderer input / presentation

- `src/mono_ui/runtime/input_actions.ts`
  - keep input intent generation
- `src/mono_ui/modules/place_module.ts`
  - continue sending server intent/goal updates
  - do not gain new movement rules
- `src/shared/movement_engine.ts`
  - strip or isolate any remaining gameplay authority

### NPC integration

- `src/npc_ai/*`
  - movement decisions should resolve to server goals/intents, not local stepping

## Per-Breath Data Flow Contract

This section is here to keep the implementation behaviorally aligned while code is being migrated.

### Inputs visible at the start of a breath

- current authoritative place snapshot
- current entity position + elevation
- entity `movement_physics` state
- latest intent / current goal/path state
- current `breath_index`

### Action phase inputs -> outputs

Inputs:

- latest input intent
- advisory legality queries via `can_place_volume(...)`
- current `move_budget[modality]` and `move_debt[modality]`

Outputs:

- updated facing/intent state
- updated `move_budget` / `move_debt`
- velocity changes from MOVE / incline / other movement verbs
- any selected transient movement subtype for logging/debugging

Must not output:

- position changes
- occupancy mutations
- collision events

### Physics phase inputs -> outputs

Inputs:

- authoritative entity position/elevation
- updated velocity after action phase
- gravity applicability / weight
- authoritative legality checks via `can_place_volume(...)`

Outputs:

- at most one position/elevation step
- velocity mutation from gravity, friction, and collision response
- movement update event payload if a step occurred
- persisted `breath_last_processed` / movement state updates

Physics resolver contract:

- The resolver consumes only authoritative state from the end of the action phase.
- It attempts at most one legal step per entity per breath.
- It may try multiple candidate axes internally, but only one successful step may be emitted.
- If no legal step exists for any non-zero axis component, it emits a stuck-collision outcome and applies the design-doc collision response.
- It must not invent alternate movement verbs or subtype changes; verb selection belongs to the action phase.

Legality freshness rule:

- Every legality check performed during the physics phase must be against authoritative current place state at the time of the check.
- If action-phase advisory legality becomes stale before physics resolves, physics wins.

### Thinking / pathing contract

- Brain/think/path systems may set or update goals and advisory path data.
- They must not write final positions, force steps, bypass debt/budget, or bypass the physics resolver.
- Pathfinding remains advisory even after migration.

## NPC Integration Contract

NPC systems need an explicit contract so movement authority does not split again.

Allowed NPC outputs:

- desired movement intent
- movement mode/modality preference
- click-to-move style goal positions
- advisory paths / repath requests
- high-level behavior state that influences movement choice

Disallowed NPC outputs:

- direct authoritative position updates
- renderer movement commands that imply stepping authority
- bypassing action phase / physics phase / legality checks
- local NPC-only movement cadence systems

NPC migration rule:

- NPC brain/think may decide *what they want to do*, but only the canonical server movement system decides *how and when they move*.

## Main.ts Migration Map

This section exists to keep the implementation from becoming another monolith.

### Current `main.ts` responsibilities that should remain there

- place breath scheduling / active place lifecycle
- API endpoints for movement intent / move-to
- event bridge emission of authoritative movement updates
- orchestration of breath phases in deterministic order

### Current `main.ts` responsibilities that should be split into movement helpers

- cadence accounting (`move_accum`, `breaths_per_step`)
- step attempt logic
- gravity settle logic for movement-capable entities
- movement state mutation and persistence details
- subtype selection logic like incline

### Target breath flow inside `main.ts`

Per active place breath:

1) prepare legality-visible place snapshot
2) brain phase (low-frequency NPC goal generation)
3) think phase (advisory path planning)
4) movement action phase (intent -> MOVE acceleration / subtype selection / budget + debt)
5) movement physics phase (gravity -> resolver -> friction -> collision)
6) other breathing systems
7) batch authoritative movement updates to renderer

### Refactor sequencing recommendation

- First split current movement stepping into named helpers while preserving behavior.
- Then replace helper internals phase-by-phase:
  - budget/debt
  - MOVE acceleration
  - velocity resolver
  - gravity acceleration
  - friction/collision
- Only after the new helpers are authoritative should the old cadence logic be deleted.

Development safety rule:

- Each replacement step should preserve a runnable game state.
- Avoid giant one-shot rewrites of movement in `main.ts`; land authority-preserving slices.

## Resolver Development Contract

To reduce implementation drift, the first resolver version should stay intentionally narrow.

Initial resolver scope:

- one entity at a time
- deterministic axis ordering from velocity magnitude + `(entityId, breath_index)` tie-break
- legality checks via `can_place_volume(...)`
- stuck-only collision
- friction hook after resolver outcome
- no momentum transfer / pushing / bounce
- no simultaneous multi-entity resolution

Initial resolver non-goals:

- clever repathing inside physics
- predictive collision avoidance
- mixed-authority movement corrections
- advanced collision responses beyond the design doc

Implementation guidance:

- Get the narrow resolver correct and debuggable first.
- Add more advanced responses only after the core acceptance tests are passing.

## Development Sequence (Recommended)

This is the recommended implementation order for the best chance of reaching the design goal cleanly.

1) Land runtime state + persistence plumbing with no behavior change.
2) Extract `main.ts` movement helpers while preserving current behavior.
3) Replace cadence accounting with budget/debt accounting.
4) Replace step target movement with MOVE -> velocity writes in action phase.
5) Add the first narrow velocity resolver (without advanced extras).
6) Move gravity into the physics phase as acceleration.
7) Add friction and stuck-only collision behavior.
8) Add incline selection/injection.
9) Migrate NPCs fully onto the canonical movement system.
10) Remove renderer/legacy authority paths.

Current read on sequencing status:

- Steps 1-8 are materially underway or largely landed in the current build, though some acceptance checks remain open.
- The highest-value remaining work is now: finish NPC single-authority migration, finish renderer authority cleanup, then unify shared gravity/support helpers enough that later gravity-tile work does not fork behavior.

Success criterion for sequencing:

- Do not advance to the next major behavior change until the previous one is stable enough to keep the dev place playable and debuggable.

## Current Remediation Sequence

This is the recommended near-term order for fixing the observed movement weirdness while converging on the design doc.

1) Split visible-place pacing from offscreen catch-up in `src/interface_program/main.ts`.
2) Verify that each breath re-reads authoritative current state before action/physics processing.
3) Disable visible-place movement coalescing so ordered local-player steps are emitted to the renderer.
4) Retune walk acceleration and MOVE budget spending for inspectable, test-friendly values.
5) Re-verify axis resolver and incline transient behavior under the lower-velocity tuning.
6) Keep renderer-side systems passive and focused on telemetry/reconciliation only.

Near-term success criteria:

- visible interval pulses never execute `ticks > 1`
- one successful visible player step maps to one server breath
- local-player visible updates are not collapsed into burst-end snaps
- no duplicate same-position move batches are emitted for visible realtime stepping
- click-to-first-step latency remains low without sacrificing steady follow-up cadence

## Vertical Motion Unification Plan

This is the next major convergence target. Vertical movement must stop behaving like several special-case systems and instead run through one coherent physics path.

### Current problem summary

- Incline up/down now behave much closer to spec from a player-feel perspective, but they still rely on committed transition helpers instead of a fully unified vertical-velocity path.
- Loose-item gravity is now working better, but it is still implemented as a direct active-place sweep instead of sharing a unified active-physics path with actors/NPCs.
- Actor vertical debug impulses currently reveal that vertical velocity can exist in state without being advanced as a clean standalone physics mode.
- This causes confusing behavior where vertical motion appears only when other controller activity keeps the movement loop hot.

### Design rule we are converging on

- Vertical motion is just motion: it must advance breath-by-breath from the same canonical velocity state used by the rest of the movement system.
- The physics phase must continue while `vz != 0`, even when there is no fresh input/path/goal.
- When vertical motion is active, vertical resolution must preempt horizontal resolution unless a more explicit committed transition rule says otherwise.
- Incline-up, incline-down, actor falling, and loose-item falling should all be explainable as variants of the same vertical-resolution contract rather than separate bespoke systems.

### Development sequence

1) Keep incline transitions playable while removing accidental dependencies.

- Preserve the current committed incline-up/down behavior until the unified vertical-motion path is proven.
- Do not regress the current two-breath incline feel while vertical unification is in flight.

2) Make actor vertical motion first-class.

- If an actor/NPC has non-zero `vz`, physics must continue processing even with no input/path/goal.
- Add an explicit actor vertical-motion state so debug ascend, gravity fall, and airborne continuation do not depend on controller activity.
- Vertical attempts should be logged and resolved as a primary physics concern, not a side-effect of horizontal intent handling.

3) Enforce vertical-preempts-horizontal while vertical motion is active.

- When `abs(vz) > 0`, the resolver should try `z` first before `x/y`, except where a committed incline followthrough explicitly dictates the second half of a transition.
- Horizontal air control remains allowed, but only after vertical resolution has had priority for that breath.

4) Unify support/resting semantics.

- Actors, NPCs, and loose items must agree on what support means and what resting above support means.
- For loose items, the resting z is one layer above the supporting surface.
- For actors/NPCs, stance origin must remain consistent with the same support surface model, even if body models differ.

5) Fold loose-item gravity into the same vertical-motion mental model.

- Loose items may remain in a direct active-place pass for now, but the rules must mirror the actor/NPC vertical rules:
  - one z step per breath
  - settles above support
  - gravity acceleration is place-level
- If the direct sweep remains, treat it as a temporary implementation choice, not a different physics model.

6) Verify post-incline gravity resumption.

- Gravity suppression during committed incline transitions is acceptable only for the committed breaths.
- As soon as the incline transition is complete, normal vertical physics must resume.
- The actor should then fall, remain supported, or continue airborne according to the same canonical rules as any other vertical motion.

7) Introduce shared gravity/support helpers before full runtime unification.

- Use the same support-state and gravity-delta helpers for actors/NPCs and loose items wherever possible.
- This does not fully unify runtime storage yet, but it prevents logic drift between entity gravity and loose-item gravity.
- Tiles/objects with `GRAVITY` should eventually plug into the same helper contract instead of inventing a separate gravity rule.
- This tile/object follow-up is intentionally after NPC single-authority migration; do not mix tile-physics hosting work into the Phase 6 NPC cutover.

Tile-physics alignment note:

- This does not mean tiles should be forced through the actor/NPC controller shell.
- It means the eventual tile-physics pass should reuse the same support/resting/gravity-step semantics while remaining an explicit tile-physics system, matching the design doc's tile semantics.
- Current pushable-tile rule: a pushable tile may move only into an empty destination tile cell. It must not overwrite authored tiles, must not chain-push by default, and occupants still block destination legality unless a later explicit push-transaction phase expands that behavior.

### Acceptance checks for this phase

- `MOVE_UNIFY_TEST PASS actor vertical step resolved from vz`
- `MOVE_UNIFY_TEST PASS actor gravity fall settles to support`
- `MOVE_UNIFY_TEST PASS vertical preempts horizontal while vz active`
- `MOVE_UNIFY_TEST PASS incline transition resumes normal gravity after commitment`
- `MOVE_UNIFY_TEST PASS loose item gravity settles above support surface`
- `MOVE_UNIFY_TEST PASS loose item and actor support semantics agree on support layer`

### Temporary exceptions allowed during migration

- Committed incline-up/down transients may remain until the unified vertical path proves it can replace them without harming feel.
- Loose-item gravity may remain in a dedicated active-place pass temporarily, provided its support/fall semantics match the canonical vertical rules.

### What not to do

- Do not paper over vertical-motion bugs with hard-coded z offsets or world-height hacks.
- Do not let debug vertical impulses rely on fresh input to continue simulating.
- Do not reintroduce visible catch-up bursts or renderer-authoritative vertical stepping while refining this phase.

## Verification / Acceptance Tests

Add new devlog markers for the velocity system (example): `MOVE_VEL_TEST`.

Minimum acceptance checks (run via `npm run dev:logs`):

- `MOVE_VEL_TEST PASS velocity written by MOVE input` (braking works)
- `MOVE_VEL_TEST PASS one-step-per-breath invariant preserved`
- `MOVE_VEL_TEST PASS collision only when stuck (no legal step)`
- `MOVE_VEL_TEST PASS gravity is acceleration (vz -= 1 for weight>0)`
- `MOVE_VEL_TEST PASS friction decays moved axis only; moved_axis=none => no decay`
- `MOVE_VEL_TEST PASS move_debt suppresses MOVE spending but facing/intent still updates`
- `MOVE_VEL_TEST PASS incline injects vz+forward and resolves over time without forcing axis`

Additional acceptance checks for the current remediation pass:

- `MOVE_VEL_TEST PASS visible interval pulse never exceeds one breath`
- `MOVE_VEL_TEST PASS visible player updates preserve ordered per-breath steps`
- `MOVE_VEL_TEST PASS no repeated same-source same-target step across successive breaths`
- `MOVE_VEL_TEST PASS no duplicate same-position local move batch during visible realtime stepping`
- `MOVE_VEL_TEST PASS click-to-first-step latency remains low without bursty follow-up movement`

## Development Test World Plan

Use the current development place as the primary movement verification scene.

Planned scene adjustments:

- Expand the playable z range from the current authored depth (currently about 4 layers) to 8 layers.
- Preserve the place as a practical mixed-use dev scene rather than building a throwaway movement-only map.

Why this scene:

- it already exists in active development
- it exercises real game content rather than synthetic-only fixtures
- it can validate incline, falling, blocked movement, unsupported movement, gravity, and multi-entity occupancy interactions in one place

Planned verification affordances for that scene:

- clear blocked walls for incline-up tests
- clear ledges/voids for incline-down and gravity tests
- stacked vertical space for z movement verification across 8 layers
- known actor/NPC placements for deterministic occupancy/collision tests
- connected-place NPC placements kept synchronized across entity save, place contents, and place index so square <-> tavern travel tests are deterministic

Constraint:

- Scene changes used for movement verification must support the unified movement implementation and not become one-off debug geometry that the real game never uses.

## Legacy Authority Deletion Matrix

This matrix is here so old systems do not linger indefinitely.

### `src/interface_program/main.ts` cadence fields (`move_accum`, `breaths_per_step`)

- Current role: server-authoritative cadence stepping
- Temporary migration role: compatibility bridge while velocity state is introduced
- Authority ends in: Phase 8
- Final state: deleted or fully replaced by budget/debt + velocity resolver

### `src/shared/movement_engine.ts`

- Current role: renderer/legacy stepping + interpolation + old authority assumptions
- Temporary migration role: optional interpolation/presentation helper only
- Authority ends in: Phase 7
- Final state: presentation-only helper or deleted

### `src/mono_ui/modules/movement_command_handler.ts`

- Current role: renderer-side NPC movement execution authority
- Temporary migration role: retain only non-movement UI/facing helpers if needed
- Authority ends in: Phase 7
- Final state: movement execution removed; keep only unrelated helpers if justified

### `src/shared/movement_commands.ts`

- Current role: NPC movement command protocol feeding renderer-side movement execution
- Temporary migration role: bridge for non-movement UI commands only
- Authority ends in: Phase 6
- Final state: movement command authority removed; payloads trimmed or deprecated

### `src/npc_ai/movement_loop.ts`

- Current role: legacy NPC stepping/path loop
- Temporary migration role: none preferred; quarantine quickly
- Authority ends in: Phase 6
- Final state: delete or hard-disable

### `movement_schedule` persisted fields

- Current role: old cadence-oriented persisted movement scheduling
- Temporary migration role: diagnostics / back-compat inspection only
- Authority ends in: Phase 8
- Final state: removed from authoritative runtime logic; optionally deleted from saves in later cleanup

Deletion rule:

- No legacy movement subsystem should remain in a "temporary" authority role beyond the phase listed above without a plan amendment that explains why.

## Phases / Checklist

Legend:

- [ ] not implemented
- [~] implemented
- [x] implemented + tested via `npm run dev:logs`

### Phase 0: Inventory + Boundaries

- [x] Document current movement authorities and callsites (server vs renderer vs npc_ai)
- [x] Add `MOVE_VEL_TEST` devlog marker helper usage in server movement loop
- [ ] Define the feature flag(s) for velocity stepper enablement (per place/entity)
- [x] Document exact cutover rule: one entity/breath uses exactly one authority path
- [x] Write down the `main.ts` extraction targets before changing movement behavior
- [x] Write down the legacy authority deletion matrix and target removal phases

### Phase 1: Data Model + Migration Plumbing

- [x] Add new persisted movement physics fields to actor JSON load/save defaults (`src/actor_storage/store.ts`)
- [x] Add new persisted movement physics fields to NPC JSON load/save defaults (`src/npc_storage/store.ts`)
- [x] Ensure existing saves without these fields migrate safely on load
- [x] Decide which movement fields remain persisted vs runtime-only scratch state
- [ ] Write the persistence migration matrix into the implementation work notes/code comments where needed

### Phase 2: Server Movement Component (State)

- [x] Define a server-side movement state object for actors/NPCs (velocity, budgets, debt, last intent)
- [x] Replace `EntityMoveController.move_accum` cadence with budget/debt accounting
- [x] Keep `/api/movement/intent` and `/api/movement/move_to` endpoints stable while migrating internals
- [x] Define deterministic ordering for action phase and physics phase processing within a place
- [x] Split current movement stepping in `main.ts` into named helpers before full behavioral replacement
- [~] Document and implement the per-breath data flow contract at helper boundaries
- [x] Define the canonical runtime movement state shape and ensure it is the only long-term in-memory authority target

### Phase 3: Action Phase (Intent -> MOVE acceleration)

- [x] Implement MOVE acceleration application per breath (supports braking)
- [x] Implement per-modality `move_budget` refill and `move_debt` suppression
- [x] Ensure intent/facing updates still happen while in debt
- [x] Implement incline subtype selection using legality reason (blocked vs unsupported)
- [x] Implement incline velocity injection + 2-unit spend (overspend allowed -> debt)
- [x] Ensure action-phase legality uses `can_place_volume(...)` only and does not emit collision
- [x] Keep action-phase outputs limited to intent/facing/budget/debt/velocity mutations only
- [~] Replace legacy cadence-shaped walk pacing with a direct acceleration-per-breath model aligned to the design doc

### Phase 4: Physics Phase (Velocity -> Step)

- [x] Implement gravity as acceleration on `vz` (based on weight)
- [x] Implement deterministic axis resolver (magnitude + tie-breaking `(entityId, breath_index)`)
- [x] Enforce 1 step per entity per breath
- [x] Implement collision (stuck only): cancel non-zero components when no legal step exists
- [x] Implement friction/drag (moved-axis decay; none => no decay; slippery hook)
- [x] Ensure physics legality is authoritative even if intent-phase subtype choice becomes stale mid-breath
- [x] Keep the first resolver version intentionally narrow (no pushing/bounce/simultaneous resolution)
- [x] Ensure legality result details are preserved in logs for blocked/stuck outcomes

### Phase 5: Replace Legacy Gravity Passes

- [x] Deprecate/disable server post-step gravity settle functions in favor of velocity-based gravity
- [~] Ensure loose items / actors / NPCs gravity eligibility matches the design doc
- [x] Verify gravity integration does not reintroduce a second physics authority path

Current Phase 5 note:

- Actor/NPC gravity now lives in the canonical physics path, but loose items still have a dedicated host pass. Keep refining semantics here without reopening a second authority path.

### Phase 6: NPC Migration (Single Authority)

- [ ] Fix NPC test-world placement consistency before validating migration logs (`npc` save, source place, destination place, and `place_entity_index` must agree)
- [~] Route NPC movement decisions to server intent/goal state (no renderer-executed NPC stepping)
- [ ] Ensure NPC brain writes only goal/intent/repath state on gated breaths; no NPC system writes final movement outcomes
- [ ] Deprecate NPC outbox movement commands for movement execution
- [ ] Delete or hard-disable `src/npc_ai/movement_loop.ts` movement stepping once redundant
- [x] Ensure NPC path planning remains advisory and does not bypass velocity/action/physics phases
- [ ] Enforce the NPC integration contract at API/helper boundaries
- [ ] Verify NPC action/physics ordering matches actors exactly (same gravity helpers, same resolver order, same friction/collision path)

Current NPC migration notes:

- NPC wander goal selection in `src/interface_program/main.ts` now uses shared z-aware pathfinding for reachability checks, so NPCs can choose goals that require incline traversal and are less likely to become trapped in pits/holes.
- Dedicated NPC renderer/legacy movement systems still exist in the repo, but the current dev path is to validate canonical server-side NPC goal/plan/step flow under `npm run dev:logs` before deleting those paths.
- The intended NPC cadence split is: low-frequency brain for goal selection, lower-frequency think for path/repath, and every-breath action/physics for actual movement/gravity resolution.
- NPCs should use the same click-to-move style goal -> advisory path -> action/physics flow as actors; NPC-specific pathfinding systems should not remain as a second execution model.

### Phase 7: Renderer Cleanup

- [ ] Ensure renderer never advances authoritative positions (only applies server batches)
- [ ] Remove/reduce `src/shared/movement_engine.ts` to presentation-only usage
- [ ] Remove reliance on `src/mono_ui/modules/movement_command_handler.ts` for movement stepping
- [ ] Keep renderer interpolation/reconcile behavior isolated from gameplay rules
- [ ] Confirm all renderer movement code still present is presentation-only and marked as such

Current Phase 7 note:

- `src/canvas_app/app_state.ts` still wires in legacy NPC movement and movement-command handler startup paths; treat those entrypoints as part of renderer authority cleanup, not as harmless leftovers.

### Phase 8: Delete Cadence Stepper (`move_ctl`)

- [x] Remove `move_accum`/`breaths_per_step` cadence stepping from server
- [ ] Remove or migrate any remaining uses of `movement_schedule` as authority
- [~] Confirm all movement (actor + NPC) flows through velocity/budget/debt
- [ ] Delete or clearly quarantine legacy movement codepaths that are no longer authoritative
- [ ] Verify legacy authority deletion matrix items are actually removed or downgraded as planned

Current Phase 8 note:

- `move_ctl` still exists as the controller shell for intent/goal/path ownership. That is acceptable during migration, but the plan target remains: no cadence authority, no duplicate movement authority, and no hidden fallback stepping logic.

### Phase 9: Acceptance Testing

- [x] `MOVE_VEL_TEST PASS velocity written by MOVE input` (braking works)
- [x] `MOVE_VEL_TEST PASS one-step-per-breath invariant preserved`
- [x] `MOVE_VEL_TEST PASS collision only when stuck (no legal step)`
- [~] `MOVE_VEL_TEST PASS gravity is acceleration (vz -= 1 for weight>0)`
- [x] `MOVE_VEL_TEST PASS friction decays moved axis only; moved_axis=none => no decay`
- [x] `MOVE_VEL_TEST PASS move_debt suppresses MOVE spending but facing/intent still updates`
- [x] `MOVE_VEL_TEST PASS incline injects vz+forward and resolves over time without forcing axis`
- [x] `MOVE_VEL_TEST PASS current dev place expanded to 8 z layers supports movement verification cases`
- [ ] `MOVE_VEL_TEST PASS NPC movement decisions only affect goals/intents; final stepping remains canonical server physics`
- [ ] `MOVE_VEL_TEST PASS NPC brain/think cadence is gated while action/physics still run every breath`
- [ ] `MOVE_VEL_TEST PASS square <-> tavern NPC test placement stays consistent across save, place contents, and entity index`
- [x] `MOVE_VEL_TEST PASS resolver legality logs distinguish blocked vs no_support vs out_of_bounds`

## Documentation Followups

- [ ] Update `docs/plans/2026_03_10_realtime_movement_plan.md` to reference this implementation plan for the velocity substrate
- [ ] Update legacy docs that imply renderer/NPC-authoritative movement to reference server velocity stepping

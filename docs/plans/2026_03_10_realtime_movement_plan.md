# Realtime Movement Plan

Date: 2026-03-10

## Amendment (2026-03-12): Platformer-Style Single-Axis Steps

New invariant for realtime movement:

- A single step changes exactly one axis group:
  - Horizontal: cardinal `(dx,dy,0)` (no diagonal XY)
  - Vertical: `(0,0,dz)` where `dz` is `+1` (jump) or `-1` (fall)
- No step changes `(x,y)` and `z` at the same time.
- Per entity per breath: attempt at most one step. Vertical preempts horizontal.
- Jump uses the same cadence/breath pacing as normal movement (for now).
- Air control exists: horizontal movement while airborne is allowed but is half speed.

## Intent

Define a realtime, tile-based movement model that remains deterministic, voxel-aware, and compatible with future turn/action rules.

This plan is explicitly separated from Place module 3Dification. 3Dification defines world layering and 3D math/queries; this plan defines how players/NPCs *move* through that world.

Dependency note:

- Multi-voxel bodies and multi-tile structures are specified in `docs/plans/2026_03_10_multi_tile_rendering_plan.md`.
  Realtime movement should treat those footprints as authoritative for traversal and collision.

- Movement legality + pathfinding unification (single source of truth) is specified in:
  - `docs/plans/2026_03_11_movement_unification_plan.md`
  Realtime movement should build on that legality API rather than introducing new tile-walkable logic.

Authority note:

- Server is the authority for breath ticks, stepping, physics, and final positions.
- Only active places run a breath loop. Inactive places are aged/caught-up on load.

## Guiding Principles

- Single source of truth for movement rules (collision + support + allowances + speed).
- Renderer may interpolate/animate, but must not invent legality rules.
- Keyboard realtime step and click-to-move must use the same stepper and the same speed model.
- Collision checks must consider other actors/NPCs, but must exclude the moving entity's own occupied voxels.
  (Large entities must be able to move within their own volume without self-blocking.)

## Terminology

- **Voxel**: one cell in `(x,y,z)`.
- **Body model / voxel volume**: the set of voxels occupied by an owner (not necessarily rectangular).
  This is the same concept used by the multi-tile / body-model plan.
- **Stance origin voxel**: the placement origin voxel representing where the entity stands for movement legality.
  (This is not necessarily the camera anchor; anchor voxel is a separate concept.)
- **Headspace**: additional voxels above stance origin occupied by the body model (e.g. 2-tall character has `dz=0` body + `dz=+1` head).
- **Support**: a rule that requires solid voxels below the footprint plane.
- **Allowance**: how many tiles a character can move before spending an action to refresh (e.g. `walk = 6`).
- **Speed**: how fast steps animate in realtime (e.g. tiles/minute).

## Goals

- Realtime inputs (keyboard) feel responsive while staying on the tile grid.
- Click-to-move remains available as a higher-level command that executes the same step rules.
- Movement rules use voxel semantics (OCCUPIES/support/headspace) rather than UI hacks.
- Vertical movement uses world-z directly (no extra "height" concept).
- Movement allowances (walk/swim/climb/fly) decrement deterministically and integrate with the action pipeline.
- A full action can refresh all movement allowances back to max.

## Non-Goals (Initial)

- No free-flying controls.
- No continuous physics simulation.
- No complex parkour system.
- No global pause system until action pipeline/turns are wired.

## Movement Modes

- **Realtime step** (WASD / arrows): repeatedly attempt a single-tile step as time allows.
- **Command move** (click-to-move): compute a path and execute the same step attempts.
- **Jump intent** (Space): produce vertical-only `dz=+1` steps over multiple breaths.
  Horizontal motion during/after jump uses air control (cardinal, half speed).

Stealth variant (no sprint)

- Remove sprint/running as a player-facing mode.
- Keep sneaking as the single modifier state.
- Sneaking exists per locomotion mode via action subtype naming:
  - `MOVE.WALK` / `MOVE.SNEAKWALK`
  - `MOVE.SWIM` / `MOVE.SNEAKSWIM`
  - `MOVE.CLIMB` / `MOVE.SNEAKCLIMB`
  - `MOVE.FLY` / `MOVE.SNEAKFLY`

## Single Source Of Truth (What Owns What)

Authoritative (rules + accounting)

- Action pipeline owns movement allowance accounting and turn integration.
- Movement legality is defined by the voxel occupancy rules (tiles + entity body models) and must be shared.

Renderer responsibilities (authoritative input state + optional prediction)

- Capture realtime input state as stable action-state (no reliance on OS key repeat).
- Send intent/goal updates to the server (do not advance authoritative tile positions).
- Optional: predict only the local player actor for responsiveness.
- Strict reconcile: server position always wins; snap on mismatch.
- Animate/interpolate between discrete positions (prediction or server updates).

Important constraint

- Keyboard realtime step and click-to-move must share:
  - the same speed model (breaths_per_step derived from sheet stats)
  - the same legality checks (unified can_place_volume)
  - the same server-side stepper cadence (breath-gated)

  Pathfinding changes *which steps*, not *how fast* steps execute.

## Existing Systems To Reuse (Do Not Rebuild)

- Time-based stepping + interpolation already exist in `src/shared/movement_engine.ts`.
  Realtime keyboard stepping must drive this engine (or a thin extension of it), not a parallel loop.
- Renderer keyboard event plumbing already exists in `src/mono_ui/runtime/canvas_runtime.ts`.
  Add key-state tracking there (or in PlaceModule) rather than introducing a second input system.
- Place occupancy cache already exists in `src/place_storage/occupancy_index.ts`.
  Prefer extending it for voxel occupants/tags and fast queries, but keep movement legality rules in the unified legality helper (see dependency plan).
- Tile tag semantics (defs+deltas safe) already exist in `src/place_storage/tiles.ts` (`tile_blocks_movement` via tag resolver).
  Collision legality must call into this path, not read legacy inline `tile.tags` directly.
- A world-z tile adapter already exists in `src/place_storage/voxel_grid3.ts`.
  Prefer extending/fixing that contract instead of inventing a new `is_tile_blocked(place,x,y,z)` family.
  Note: `src/place_storage/voxel_grid3.ts` expects `place_voxel_blocks_movement/los` exports; ensure `src/place_storage/occupancy_index.ts` provides them.
- Shared pathfinding already exists in `src/shared/pathfinding.ts`.
  Upgrade/extend it to call the unified legality helper and remove per-module BFS copies.
- PlaceModule already wires click-to-move into `start_entity_movement(...)` and has move-mode toggles.
  Keyboard stepping should use the same speed/mode model (WALK/SNEAK) and the same engine entrypoints.
- Renderer-side position tracking helpers already exist in `src/mono_ui/modules/movement_command_handler.ts`.
  Player realtime stepping should keep using `update_actor_position_in_place(...)` / `set_npc_tracked_position(...)` so facing + conversation visuals stay correct.

## Movement Accounting (Allowances)

Characters have per-refresh movement allowances (tiles):

- `walk = 6` (example)
- optional additional pools: `swim`, `climb`, `fly`

Rules:

- Each successful movement step consumes 1 from the locomotion mode used.
- Sneaking costs double:
  - `MOVE.SNEAK*` consumes 2 allowance per 1 tile step.
  - If the pool has only 1 point remaining, the step is not allowed.
- When a character uses walk movement, it also ticks down other movement pools that are currently > 0.
  (This keeps movement as a single resource across modes while preserving per-mode maxima.)
- Sneak steps apply the same cross-pool tick-down rule, but with the same multiplier (2) where applicable.
- A full action can refresh movement: reset all pools to their max.
- During non-timed/free movement tests, movement accounting can be disabled or set to infinite.
  The plumbing must still route through the same interfaces so turns can be enabled later without redesign.

Integration note (avoid new verbs):

- The action system already defines `ActionVerb = "MOVE"` in `src/shared/constants.ts`.
  Do not add new verbs like `MOVE_STEP` / `MOVE_REFRESH`.
  Use the existing verb+subtype shape already used by USE/COMMUNICATE:
  - verb: `MOVE`
  - subtype: `WALK` | `SNEAKWALK` | `SWIM` | `SNEAKSWIM` | `CLIMB` | `SNEAKCLIMB` | `FLY` | `SNEAKFLY` | `REFRESH`

  Minimal parameters remain:
  - `parameters.step = { dx, dy, dz? }` for realtime stepping
  - `parameters.target = { x,y,z }` (or place-tile ref) for click-to-move

  Use `actionCost = "FREE"` (step/path step) vs `"FULL"` (refresh) as needed.

Subtype parsing (single source of truth)

- Add one shared helper that derives movement properties from the MOVE subtype:
  - `MOVE.SNEAKWALK` => `{ locomotion: "WALK", stealth: true }`
  - `MOVE.WALK` => `{ locomotion: "WALK", stealth: false }`
- Use this helper everywhere:
  - allowance pool selection + multipliers
  - speed (TPM) derivation
  - sound/sense broadcast selection

Sound/sense integration note

- The repo already has sense profiles keyed as `MOVE.WALK` / `MOVE.SNEAK` / `MOVE.SPRINT` in `src/action_system/sense_broadcast.ts`.
  With the new subtype scheme, map `MOVE.SNEAK*` to the existing `MOVE.SNEAK` profile (do not duplicate per-locomotion profiles).
  Stop emitting/using `MOVE.SPRINT` from player controls.

## Speed Model (Time-Based)

Speed controls animation/step pacing and must be shared:

- Express speed as `tiles_per_minute` (TPM), consistent with `src/shared/movement_engine.ts`.
- Convert to step pacing: `ms_per_tile = (60_000 / TPM)`.

Sneak pacing rule:

- Sneaking is exactly 2x time per tile (half speed):
  - `TPM_sneak = floor(TPM_walk / 2)` (or compute via `ms_per_tile * 2` and clamp).
- This must be applied identically for realtime stepping and click-to-move.

Consistency requirement:

- Manual WASD stepping and click-to-move both use the same TPM for the same entity and mode.
- Pathfinding cost/weights do not change step pacing; they only choose a step sequence.

Air control pacing rule:

- While airborne, horizontal cadence is half speed:
  - `breaths_per_step_xy_air = breaths_per_step_xy_ground * 2`

## World Scale (Tiles -> Feet)

Establish a shared constant for any UI text, tuning, and sense-range conversions:

- `1 tile = 2.5 ft` (width/height/depth)

Movement simulation stays in tiles/voxels; only convert for display.

## Collision + Support (Voxel Volume)

All legality checks operate on the entity's occupied voxel set (body model / voxel volume), which may be non-rectangular.

Core helper shape (conceptual; see `docs/plans/2026_03_11_movement_unification_plan.md` for the authoritative API):

```ts
type VoxelPos = { x: number; y: number; z: number };

type MoveCheck = {
  ok: boolean;
  reason?: 'out_of_bounds' | 'blocked' | 'no_support' | 'reserved';
  blocked_voxel?: VoxelPos;
};

// Returns all occupied voxels for an owner at a candidate stance origin voxel.
// Must reflect the multitile/body-model system (not a parallel shape system).
get_occupied_voxels(owner_ref, stance_origin: VoxelPos): VoxelPos[];

// Movement legality MUST remain reasoned (not boolean-only), and MUST separate collision vs support.
// Pathfinding and realtime stepping both call into the same legality helper.
can_place_volume(place, owner_ref, stance_origin: VoxelPos, movement_mode: string, opts?): MoveCheck;
```

Self-exclusion rule:

- `can_place_volume` must ignore occupancy belonging to `owner_ref` (the mover).
  This avoids large bodies colliding with themselves when stepping.

Support rule (current 3dification semantics)

- A step is legal only if:
  - all occupied voxels are not `OCCUPIES`, and
  - WALK has support under ANY footprint voxel.

Entity support note:

- An entity that `OCCUPIES` blocks entering its voxels, but may provide support when it is below the mover.

Integration note:

- `src/place_storage/occupancy_index.ts` should provide voxel occupants and tile tag lookups.
  Movement legality (collision/support/mode) lives in the unified legality helper from `docs/plans/2026_03_11_movement_unification_plan.md`.

Facing note:

- Movement execution updates facing in place state so legality/rendering/interaction can consult it as a normal part of entity data.

## Realtime Input Integration (Tick-Based Step Requests)

We do not rely on OS key-repeat. Instead:

- Track action-state (move_left/right/up/down, jump), plus last-pressed priority.
- Input changes produce an intent stream (dx,dy) that the server samples on breath.

Server authority note (current target)

- The server is the only system that advances authoritative positions.
- Held intent wins over click-to-move.
- If intent becomes active while a click goal exists, discard the goal.
- Client prediction may advance the local actor visually, but must strictly reconcile.

Breath scheduling note:

- Under server authority, realtime input is an intent stream sampled each breath.
  Entities only attempt a substep when scheduled (`next_breath <= place.breath_index`).

This creates Hollow Knight-style responsiveness while remaining deterministic.

Controller behavior:

- Buffer 1 next direction while a step is in progress (tight, forgiving feel).
- Priority: newest pressed direction wins.
- If blocked, keep the buffered direction for a short time window (e.g. 100-150ms) so cornering feels good.

Step selection priority (authoritative):

- Each entity attempts at most one step per breath.
- If a vertical step is pending/required, it preempts horizontal:
  1) Jump: if `jump_steps_remaining > 0`, attempt `parameters.step = { dx:0, dy:0, dz:+1 }`
  2) Gravity: if unsupported and has `GRAVITY`, attempt `parameters.step = { dx:0, dy:0, dz:-1 }`
  3) Horizontal: if `desired_dir` exists and cadence allows, attempt `parameters.step = { dx, dy, dz:0 }`

Support requirement by locomotion context:

- Grounded horizontal steps require support at destination.
- Airborne horizontal steps do not require support at destination (collision only).

Integration note (current duplication):

- `src/mono_ui/modules/place_module.ts` currently uses WASD for camera pan and also contains local walkability + BFS helpers.
  As part of realtime movement integration:
  - move WASD to player movement (or gate camera pan behind a modifier), and
  - route walkability/pathing through shared helpers (`src/shared/pathfinding.ts` + unified legality).

## Pathfinding (3D + Voxel-Aware)

Pathfinding operates on candidate stance origin voxels `{x,y,z}` but uses volume legality:

- A node is traversable iff the unified legality check succeeds for the movement mode.
- Neighbors:
  - cardinal: `{x±1,y,z}`, `{x,y±1,z}`
  - later: step up/down and vault sequences (see Jump/Vault)

Important:

- Pathfinding must call the same legality helper used by realtime stepping.
  Do not duplicate "walkable" checks in separate modules.

Execution-time rule:

- Pathfinding is advisory; step execution re-validates legality each step and stops on first failure (reason logged).

## Repo Touchpoints (Where This Lands)

- Stepping + interpolation: `src/shared/movement_engine.ts`
- Shared legality helpers (new): `src/place_storage/movement_legality.ts` (see `docs/plans/2026_03_11_movement_unification_plan.md`)
- Occupancy data: `src/place_storage/occupancy_index.ts` (voxel occupants + tile tags)
- Pathfinding: `src/shared/pathfinding.ts` (calls unified legality)
- Place input bindings + player movement wiring: `src/mono_ui/modules/place_module.ts`
- Keyboard event plumbing + focus gating: `src/mono_ui/runtime/canvas_runtime.ts`
- Action pipeline (allowances + turn integration target): `src/action_system/pipeline.ts`, `src/action_system/registry.ts`

## Incremental Integration Strategy (Free Movement First)

- First milestone runs fully in unpaused realtime and focuses on feel + collision correctness.
- Movement allowances are wired as an interface but can be configured to infinite for testing.
- Once action pipeline is connected for movement, flip the accounting source-of-truth to the pipeline without changing input/stepper code.

## Jump/Vault (Intent-Gated Step Sequences)

Jump/vault is not free-fly; it is a deterministic sequence of legal placements.

Physics note:

- Falling is physics (gravity), not a movement verb.
  Gravity applies after controller substeps each breath.

Example vault over a 1-voxel obstacle:

- If forward stance-origin voxel is blocked but `up` and `up+forward` are legal and supported appropriately,
  allow the sequence: `up -> forward -> down`.

All intermediate steps must pass `can_place_volume` and `has_support` (and obey self-exclusion).

## Testing Targets

- Vault/"up over" a 1-voxel wall: path becomes `up -> over -> down`.
- Ensure actor never ends in an invalid voxel after path execution.
- Ensure perception debug (3D LOS/hearing) remains correct while moving through z.
- Ensure manual stepping and click-to-move traverse at the same TPM.
- Ensure 2-tall body is blocked by low ceilings (headspace collisions).
- Ensure self-exclusion works for large body models.

## Status Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested in `npm run dev:logs`

### Phase 0: Unify Legality Helpers (No New Movement Yet)

- [ ] Complete `docs/plans/2026_03_11_movement_unification_plan.md` (legality + pathfinding single source).
- [ ] Add shared legality helpers that operate on occupied voxels (tiles + entities) and accept `exclude_owner_ref`.
- [ ] Ensure all movement checks call the unified helper (no duplicate walkable checks).

### Phase 1: Use Body Models For Collision (2-Tall First)

- [ ] Consume body models from `docs/plans/2026_03_10_multi_tile_rendering_plan.md` implementation.
- [ ] For the player actor, use a 2-voxel vertical volume (body+head) as the physical model.
- [ ] Collision checks iterate all occupied voxels (non-rectangular shapes supported).
- [ ] Exclude the moving owner from collision queries.

### Phase 2: Realtime Step Controller (Renderer)

- [~] Implement action-state input tracking independent of OS key repeat (`src/mono_ui/runtime/input_actions.ts`).
- [~] Last-pressed direction priority (cardinal only).
- [~] Remove WASD camera-pan binding in PlaceModule; keep pan as Space+drag.
- [~] Renderer-driven stepping was prototyped but is no longer the authority.

### Phase 2.5: Intent Stream (Renderer -> Server)

- [ ] Send `POST /api/movement/intent` only on intent change (down/up / direction change).
- [ ] On blur/reset, send intent clear (prevents stuck intent).
- [ ] MOVE_UNIFY_TEST PASS intent stream stable under key repeat (no spam).

### Phase 3: Server-Authoritative Stepping (Breath)

- [ ] Implement per-entity movement controller state on the server (intent, mode, next_breath, breaths_per_step).
- [ ] Implement click-to-move goal/path on the server; discard goal when intent becomes active.
- [ ] Attempt at most 1 step per entity per breath (vertical preempts horizontal).
- [ ] Broadcast authoritative movement updates to renderer (EventBridge).
- [ ] MOVE_UNIFY_TEST PASS server stepper advances actor on breath.
- [ ] MOVE_UNIFY_TEST PASS held intent overrides click (goal discarded).

### Phase 3.5: Client Prediction + Strict Reconcile

- [ ] Predict only local actor positions (optional; start with none if simpler).
- [ ] Strict reconcile on server movement event: snap on mismatch.
- [ ] MOVE_UNIFY_TEST PASS strict reconcile snaps to server.

### Phase 3.8: Retire Renderer Steppers (Client -> Server)

- [ ] Remove renderer-authoritative stepping for both click-to-move and WASD.
- [ ] Click-to-move sends `POST /api/movement/move_to` (server computes path + steps).
- [ ] WASD sends `POST /api/movement/intent` (server steps on breath).
- [ ] Ensure both paths use the same `breaths_per_step` (derived from sheet `movement.walk` + mode).
- [ ] Ensure both paths use unified legality at step-time (`can_place_volume`).

### Phase 4: Server Breath Scheduling

- [x] Implement per-active-place breath loop (`breath_index`, `breath_last_processed`, websocket tick stream)
- [~] Implement entity scheduling (`breaths_per_step`, `next_breath`) for movement (gravity uses it; movement stepping pending)
- [x] Add coarse catch-up on load (aging/effects + capped settle)

### Phase 5: Movement Accounting Plumbing (Action Pipeline Ready)

- [ ] Route movement accounting through the existing `MOVE` verb + subtype (`WALK`/`SNEAKWALK`/etc, `REFRESH`).
- [ ] Route successful steps through action pipeline accounting (decrement pools).
- [ ] Implement the rule: walk consumption also ticks down other pools that are > 0.
- [ ] Implement full-action refresh: reset all movement pools to max.

Testing mode note:

- [ ] In unpaused/free movement tests, allow a feature flag to bypass accounting (infinite movement) while keeping the call sites intact.

### Phase 6: 3D Pathfinding Over Stance Origins (Volume-Aware)

- [ ] Implement A*/Dijkstra over `{x,y,z}` nodes using unified legality helper.
- [ ] Weighted edges for vertical sequences (vault/jump) without implying flight.
- [ ] Add small deterministic test scenes.

### Phase 7: Jump/Vault Sequences

- [ ] Implement intent-gated sequences (`up -> over -> down`) with legality checks at each intermediate step.
- [ ] Add rejection reasons to logs for tuning.

### Phase 8: Tuning + Feel

- [ ] Establish a single speed tuning source for all movers and modes (walk/sneak).
- [ ] Ensure consistent acceleration feel via buffering, corner forgiveness, and step pacing.
- [ ] Add debug overlay: occupied voxels, blocked voxel reason, and current movement pools.

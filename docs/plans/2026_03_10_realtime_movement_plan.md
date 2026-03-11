# Realtime Movement Plan

Date: 2026-03-10

## Intent

Define a realtime, tile-based movement model that remains deterministic, voxel-aware, and compatible with future turn/action rules.

This plan is explicitly separated from Place module 3Dification. 3Dification defines world layering and 3D math/queries; this plan defines how players/NPCs *move* through that world.

Dependency note:

- Multi-voxel bodies and multi-tile structures are specified in `docs/plans/2026_03_10_multi_tile_rendering_plan.md`.
  Realtime movement should treat those footprints as authoritative for traversal and collision.

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
- **Feet voxel**: the anchor voxel representing where the entity stands (usually at `entity.elevation`).
- **Headspace**: additional voxels above feet occupied by the body model (e.g. 2-tall character has `dz=0` body + `dz=+1` head).
- **Support**: a rule that requires solid voxels below the feet plane (e.g. z0 must support walking on z1).
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
- **Jump/Vault intent** (Space): allow small step sequences (`up -> over -> down`) gated by voxel legality.

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

Renderer responsibilities

- Capture realtime input state (WASD).
- Request/drive step attempts on a fixed tick cadence.
- Animate/interpolate between discrete legal positions.

Important constraint

- Realtime step and click-to-move must call the same stepping function so they stay speed-consistent.
  (Pathfinding changes *which steps*, not *how fast* steps execute.)

## Existing Systems To Reuse (Do Not Rebuild)

- Time-based stepping + interpolation already exist in `src/shared/movement_engine.ts`.
  Realtime keyboard stepping must drive this engine (or a thin extension of it), not a parallel loop.
- Renderer keyboard event plumbing already exists in `src/mono_ui/runtime/canvas_runtime.ts`.
  Add key-state tracking there (or in PlaceModule) rather than introducing a second input system.
- Tile support + movement blocking cache already exist in `src/place_storage/occupancy_index.ts`.
  Extend it to cover world-z queries and entity volumes; do not create a separate collision cache.
- Tile tag semantics (defs+deltas safe) already exist in `src/place_storage/tiles.ts` (`tile_blocks_movement` via tag resolver).
  Collision legality must call into this path, not read legacy inline `tile.tags` directly.
- A world-z tile adapter already exists in `src/place_storage/voxel_grid3.ts`.
  Prefer extending/fixing that contract instead of inventing a new `is_tile_blocked(place,x,y,z)` family.
  Note: `src/place_storage/voxel_grid3.ts` expects `place_voxel_blocks_movement/los` exports; ensure `src/place_storage/occupancy_index.ts` provides them.
- Shared 2D pathfinding already exists in `src/shared/pathfinding.ts`.
  Upgrade/extend it to 3D + volume legality; remove/avoid per-module BFS copies.
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

## World Scale (Tiles -> Feet)

Establish a shared constant for any UI text, tuning, and sense-range conversions:

- `1 tile = 2.5 ft` (width/height/depth)

Movement simulation stays in tiles/voxels; only convert for display.

## Collision + Support (Voxel Volume)

All legality checks operate on the entity's occupied voxel set (body model / voxel volume), which may be non-rectangular.

Core helper shape (conceptual):

```ts
type VoxelPos = { x: number; y: number; z: number };

type MoveCheck = {
  ok: boolean;
  reason?: 'out_of_bounds' | 'blocked_by_tile' | 'blocked_by_entity' | 'no_support';
  blocked_voxel?: VoxelPos;
};

// Returns all occupied voxels for an owner at a candidate feet voxel.
// Must reflect the multitile/body-model system (not a parallel shape system).
get_occupied_voxels(owner_ref, feet: VoxelPos): VoxelPos[];

// Tile-only helper remains useful, but must accept world-z.
is_tile_blocked(place, x, y, z): boolean;

// Full volume check (tiles + entities) with self-exclusion.
can_place_volume(place, owner_ref, occupied_voxels: VoxelPos[]): MoveCheck;

// Support: for each footprint voxel at feet plane, require solid support under it.
has_support(place, occupied_voxels: VoxelPos[]): boolean;
```

Self-exclusion rule:

- `can_place_volume` must ignore occupancy belonging to `owner_ref` (the mover).
  This avoids large bodies colliding with themselves when stepping.

Support rule (current 3dification semantics)

- Walking plane is `z=base_z` (structure plane).
- Support plane is `z=base_z-1` (z0).
- A step is legal only if:
  - all occupied voxels on the walking/headspace planes are not `OCCUPIES`, and
  - every feet-plane footprint voxel has support below.

Integration note (avoid duplicating tile semantics):

- The current repo already has the tile-only support rule encapsulated in `src/place_storage/occupancy_index.ts`.
  Prefer implementing world-z tile semantics as `place_voxel_blocks_movement(place,x,y,world_z)` and
  `place_voxel_blocks_los(place,x,y,world_z)` to match `src/place_storage/voxel_grid3.ts`.
  Keep `place_tile_blocks_movement(place,x,y)` as the fast-path for the walking plane.

## Realtime Input Integration (Tick-Based Step Requests)

We do not rely on OS key-repeat. Instead:

- Track key state (W/A/S/D down/up, and optional last-pressed direction).
- On each movement tick, decide at most one step intent.
- If the mover is ready for a new step (based on `ms_per_tile`), attempt the step.

This creates Hollow Knight-style responsiveness while remaining deterministic.

Controller behavior:

- Buffer 1 next direction while a step is in progress (tight, forgiving feel).
- Priority: newest pressed direction wins.
- If blocked, keep the buffered direction for a short time window (e.g. 100-150ms) so cornering feels good.

Integration note (current duplication):

- `src/mono_ui/modules/place_module.ts` currently uses WASD for camera pan and also contains local walkability + BFS helpers.
  As part of realtime movement integration:
  - move WASD to player movement (or gate camera pan behind a modifier), and
  - route walkability/pathing through shared helpers (`src/shared/pathfinding.ts` + unified legality).

## Pathfinding (3D + Voxel-Aware)

Pathfinding operates on candidate feet voxels `{x,y,zFeet}` but uses volume legality:

- A node is traversable iff `can_place_volume(...)` and `has_support(...)` succeed.
- Neighbors:
  - cardinal: `{x±1,y,z}`, `{x,y±1,z}`
  - later: step up/down and vault sequences (see Jump/Vault)

Important:

- Pathfinding must call the same legality helper used by realtime stepping.
  Do not duplicate "walkable" checks in separate modules.

## Repo Touchpoints (Where This Lands)

- Stepping + interpolation: `src/shared/movement_engine.ts`
- Shared legality helpers (new/extended): `src/place_storage/occupancy_index.ts` + body-model occupancy from `docs/plans/2026_03_10_multi_tile_rendering_plan.md`
- Pathfinding: `src/shared/pathfinding.ts` (replace/extend to call unified legality)
- Place input bindings + player movement wiring: `src/mono_ui/modules/place_module.ts`
- Keyboard event plumbing + focus gating: `src/mono_ui/runtime/canvas_runtime.ts`
- Action pipeline (allowances + turn integration target): `src/action_system/pipeline.ts`, `src/action_system/registry.ts`

## Incremental Integration Strategy (Free Movement First)

- First milestone runs fully in unpaused realtime and focuses on feel + collision correctness.
- Movement allowances are wired as an interface but can be configured to infinite for testing.
- Once action pipeline is connected for movement, flip the accounting source-of-truth to the pipeline without changing input/stepper code.

## Jump/Vault (Intent-Gated Step Sequences)

Jump/vault is not free-fly; it is a deterministic sequence of legal placements.

Example vault over a 1-voxel obstacle:

- If forward feet voxel is blocked but `up` and `up+forward` are legal and supported appropriately,
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

- [ ] Add shared legality helpers that operate on occupied voxels (tiles + entities) and accept `exclude_owner_ref`.
- [ ] Keep `is_tile_blocked` as a tile-only helper but make it world-z aware.
- [ ] Ensure all movement checks call the unified helper (no duplicate walkable checks).

### Phase 1: Use Body Models For Collision (2-Tall First)

- [ ] Consume body models from `docs/plans/2026_03_10_multi_tile_rendering_plan.md` implementation.
- [ ] For the player actor, use a 2-voxel vertical volume (body+head) as the physical model.
- [ ] Collision checks iterate all occupied voxels (non-rectangular shapes supported).
- [ ] Exclude the moving owner from collision queries.

### Phase 2: Realtime Step Controller (Renderer)

- [ ] Implement key state tracking (W/A/S/D and/or arrows) independent of OS key repeat.
- [ ] On each movement tick, request at most one step based on `ms_per_tile`.
- [ ] Add 1-step buffer and last-pressed direction priority.
- [ ] Remove/replace current WASD camera-pan binding in PlaceModule; keep arrows or modifiers for camera.

### Phase 3: Make Click-To-Move Use The Same Stepper

- [ ] Ensure click-to-move and realtime stepping call the same step execution path and use the same `speed_tpm`.
- [ ] Remove remaining ad-hoc pathing walkable checks that diverge from voxel legality.

### Phase 4: Movement Accounting Plumbing (Action Pipeline Ready)

- [ ] Define an action-pipeline verb (conceptual): `MOVE_STEP` and `MOVE_REFRESH`.
- [ ] Route successful steps through action pipeline accounting (decrement pools).
- [ ] Implement the rule: walk consumption also ticks down other pools that are > 0.
- [ ] Implement full-action refresh: reset all movement pools to max.

Testing mode note:

- [ ] In unpaused/free movement tests, allow a feature flag to bypass accounting (infinite movement) while keeping the call sites intact.

### Phase 5: 3D Pathfinding Over Feet Voxels (Volume-Aware)

- [ ] Implement A*/Dijkstra over `{x,y,zFeet}` nodes using unified legality helper.
- [ ] Weighted edges for vertical sequences (vault/jump) without implying flight.
- [ ] Add small deterministic test scenes.

### Phase 6: Jump/Vault Sequences

- [ ] Implement intent-gated sequences (`up -> over -> down`) with legality checks at each intermediate step.
- [ ] Add rejection reasons to logs for tuning.

### Phase 7: Tuning + Feel

- [ ] Establish a single speed tuning source for all movers and modes (walk/sneak).
- [ ] Ensure consistent acceleration feel via buffering, corner forgiveness, and step pacing.
- [ ] Add debug overlay: occupied voxels, blocked voxel reason, and current movement pools.

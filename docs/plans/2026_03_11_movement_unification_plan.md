\# Movement Unification Plan (Legality + Pathfinding Single Source)

Date: 2026-03-11

## Amendment (2026-03-12): Single-Axis Step Platformer Model

We are pivoting away from `WALK.UP/WALK.DOWN` sequences that change `(x,y,z)` within a single step.

New invariant (authoritative for this plan and all dependent plans):

- A single movement step changes exactly one axis group:
  - Horizontal step: cardinal `(dx,dy,0)` (no diagonal XY)
  - Vertical step: `(0,0,dz)` where `dz` is `+1` (jump) or `-1` (fall)
- Jump and gravity are *step producers* that emit vertical steps over time; they are not special movement verbs.
- Support remains an `OCCUPIES`-based concept; the controller decides when support is required:
  - Grounded horizontal steps require support at destination.
  - Airborne horizontal steps (air control) do not require support at destination, but still require collision-free occupancy.
- Per-breath stepping is deterministic and interruptible. Step legality is always enforced at step-time.

## Intent

Unify movement legality and pathfinding across the repo under one shared system so collision/support semantics are consistent for:

- renderer click-to-move
- renderer realtime stepping (later; action pipeline throttling)
- NPC wandering/movement
- server travel/move-within-place

This plan intentionally modernizes away legacy movement systems. Stability and cleanliness over backward compatibility.

## Guiding Principles

- Single source of truth for movement legality (collision + support + movement-mode constraints).
- Pathfinding is separate from legality; pathfinding only calls legality as a predicate.
- World-z is first-class; do not reintroduce legacy "walking plane" abstractions.
- Clicking an occupied tile to move-to is rejected (traceability + determinism).
- Entities can be stood on (support) but cannot be moved into (collision).
- Obstacle features do not affect movement legality; use tags/occupancy (OCCUPIES) + optional reservations.
- Future: step execution plugs into the action pipeline for timed/throttled movement; legality/pathfinding remain pure.

Important constraint:

- Pathfinding is advisory; legality is enforced at step-time. A path can become invalid mid-execution.

Authority note:

- Server is the authority for breath, stepping, physics, and final positions.
- Only active places run a breath loop; inactive places are aged/caught-up on load.

Control note (2026-03-12+)

- Renderer owns input collection and (optional) prediction only.
- Server owns movement stepping for both click-to-move and held intent.
- Held intent overrides click-to-move; click goal is discarded when intent becomes active.
- Strict reconcile: server position always wins.

## Terminology

- Voxel: one cell in (x,y,z).
- Stance origin voxel: the placement origin {x,y,z} used to evaluate the mover's physical body model.
  (This replaces "feet voxel" as the long-term concept.)
- Anchor voxel: canonical focus point for camera/selection. Not necessarily the stance origin.
- Physical occupied voxels: body-model-derived voxels relative to stance origin.
- Footprint voxels: subset of occupied voxels at the lowest dz plane.
  Default rule (until explicit FOOTPRINT tags exist):
  - min_dz = min(physical.dz)
  - footprint = voxels where dz == min_dz

Default stance origin z (initial):

- Stance origin z defaults to the entity's current elevation when present; otherwise to the place base elevation (`place.coordinates.elevation`).
- Only vertical steps (jump/fall) change stance origin z.

Stance origin key format:

- Use `x_y_z` where x/y/z are `Math.floor`ed ints in place coordinates.
  - x/y are tile coordinates on the place grid at height z.

## Authoritative Semantics

### Collision (entering space)

A candidate placement is blocked if ANY occupied voxel overlaps an OCCUPIES voxel from:

- tiles (effective tags)
- other owners (actors/npcs/structures/items contributing OCCUPIES)

Self-exclusion: ignore voxels owned by the mover itself.

### Support (standing)

For WALK:

- require support under ANY footprint voxel (future-friendly for bridging bodies like snakes)
- support exists if the voxel below has OCCUPIES from tiles OR occupants (excluding self)

Other modes (SWIM/CLIMB/FLY) will have different requirements; the legality API must accept movement mode now.

### Vertical transitions (jump/fall)

Vertical motion is expressed as discrete vertical steps that change only z:

- Jump: a controller-produced sequence of one or more `dz=+1` steps over multiple breaths.
- Fall: a physics-produced sequence of `dz=-1` steps over multiple breaths while unsupported.

Horizontal motion remains cardinal and changes only `(x,y)`.

### Gravity (physics step)

Falling is not a movement verb. It is physics.

- Entities (actors/npcs/items/projectiles later) with a `GRAVITY` tag are pulled down when unsupported.
- Gravity is applied after controller movement each breath.
- Gravity attempts at most 1 fall substep (`z-1`) per breath for now.
- Falling uses collision checks; support is used only to decide whether to continue falling.
- Pushable/exception tiles/owners block falling for now (no push resolution during fall).

Container rule (initial):

- Items inside containers ignore `GRAVITY`.
  (Advanced item-grid physics planned separately.)

### Reservations (optional)

Reservations are an explicit extra constraint that blocks stance origins only (for now) and must not be baked into base collision rules.

## Current Duplications To Remove

- Renderer local BFS + walkability in `src/mono_ui/modules/place_module.ts`
- Shared BFS in `src/shared/pathfinding.ts` (becomes canonical pathfinder)
- Node NPC BFS in `src/npc_ai/pathfinding_node.ts`
- Server travel BFS + blockers in `src/travel/movement.ts` (`is_tile_blocked`, `find_path_for_npc`)

## Target Architecture

### A) Legality module (new; single source of truth)

Recommended location: `src/place_storage/movement_legality.ts`

Conceptual API:

```ts
type OwnerRef = { kind: 'actor' | 'npc' | 'structure' | 'item'; id: string };
type MovementMode = 'WALK' | 'SWIM' | 'CLIMB' | 'FLY';
type SupportPolicy = 'any_footprint' | 'all_footprint';

type LegalityContext = {
  exclude_owner?: OwnerRef;
  reserved_stance_origins?: Set<string>; // key "x_y_z" for stance origin
  support_policy?: SupportPolicy; // default: any_footprint
};

type Voxel = { x: number; y: number; z: number };

type MoveCheck =
  | { ok: true }
  | { ok: false; reason: 'out_of_bounds' | 'blocked' | 'no_support' | 'reserved'; detail?: any };

function can_place_volume(place: Place, owner: OwnerRef, stance_origin: Voxel, mode: MovementMode, ctx?: LegalityContext): MoveCheck;
```

Implementation requirements:

- Evaluate physical body model voxels (facing-aware) at stance origin.
- Collision: any occupied voxel with OCCUPIES blocks, excluding ctx.exclude_owner.
- Support (WALK): compute footprint voxels and require support under any footprint voxel at z-1.
- Do not consult `PlaceFeature.is_obstacle`.

Facing requirement (authoritative):

- Facing used for body-model evaluation comes from the entity snapshot in the place data (actors/npcs) and from structure instances (structures already store facing).
- Movement execution must update facing when stepping so legality/rendering/interaction can consult it via place state.

MoveCheck detail requirements (debuggable tabletop semantics):

- For any `{ ok: false }`, `detail` should include:
  - `stance_origin: {x,y,z}`
  - `mode`
- When `reason` is `blocked`, `detail` should include:
  - `blocked_voxel: {x,y,z}`
  - `blocked_by: 'tile' | 'occupant'`
  - when `blocked_by` is `occupant`: `blocked_owner: { owner_kind, owner_id, part? }`
- When `reason` is `reserved`, `detail` should include:
  - `reserved_key` (stance origin key) and who reserved it when available
- When `reason` is `no_support`, `detail` should include:
  - `footprint_voxels` and which voxel(s) were considered supported

### Occupancy freshness (correctness over caching)

Correctness requirement:

- Occupancy queries used by legality must reflect current place state (actors/npcs/structures).

Implementation policy (initial):

- Prefer direct checks for legality-critical queries:
  - Tiles: consult effective tags (defs+deltas safe) for the OCCUPIES tag via the unified tile tag/occupancy checker.
  - Occupants: consult current place entity/structure snapshots directly (no stale cache).

Optimization plan (later):

- After correctness is proven, introduce a per-place 3D collision bitmap (or equivalent) that can be:
  - rebuilt on room entry, and
  - incrementally updated on each movement/rotation/state change.
- Any cached representation must be revisioned and explicitly invalidated on mutations that affect occupancy.

### B) Canonical pathfinding (shared)

Keep BFS in `src/shared/pathfinding.ts` as the only pathfinder for now. Refactor it to:

- operate over stance-origin nodes {x,y,z}
- accept a traversability predicate that calls legality
- reject blocked goal nodes (no "target exception")

Execution-time rule:

- Step execution validates legality per step and stops immediately on failure (no auto-repath yet).

Click-to-move behavior:

- if clicked goal is occupied / not traversable: reject and log reason

### C) Caller migration

- Renderer click-to-move: use `src/shared/pathfinding.ts` (remove PlaceModule BFS)
- Node NPC: `src/npc_ai/movement_loop.ts` uses `src/shared/pathfinding.ts` (remove `pathfinding_node.ts`)
- Server travel: replace local BFS with shared pathfinding + optional reservations in ctx

### D) Breath loop + execution order (server)

Per active place, on each breath:

1) `place.breath_index++`
2) For each scheduled mover: attempt at most 1 step with vertical preemption:
   - If a vertical step is pending/required (jump steps remaining OR unsupported+GRAVITY): attempt the vertical step.
   - Else attempt one horizontal step from the current controller/path intent.
3) Aging/effects: growth, tag dispersal, cooldown ticks, projectile lifetimes (batched)
4) Persist: `place.breath_last_processed = place.breath_index`

Catch-up on load (inactive -> active):

- Apply coarse aging/effects for `delta_breaths`.
- Apply capped settle steps for gravity/projectiles; if still unresolved, continue in live breaths.

## Phases / Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] implemented + tested via `npm run dev:logs`

### Phase 0: Inventory

- [ ] List all callsites of `find_path`/`is_tile_walkable`/`is_tile_blocked`
- [ ] Add devlog markers for unification tests (`MOVE_UNIFY_TEST`)

### Phase 1: Legality primitives

- [~] Add `src/place_storage/movement_legality.ts` (collision + support split)
- [~] Support policy default: `any_footprint`
- [~] Self-exclusion supported end-to-end
- [~] Stand on entities allowed (support from occupant OCCUPIES at z-1)
- [~] Fix occupancy-index character facing usage (currently actors/npcs eval with facing=null)
- [~] Ensure legality occupancy queries are not stale under in-place Place mutation (correctness over caching)

### Phase 1.5: Gravity physics (server)

- [~] Implement per-active-place breath loop (`breath_index`, `breath_last_processed`, `breath_last_processed_ms`) with persist + catch-up cap
- [~] Define `GRAVITY` tag semantics for actors/npcs/items (items in containers ignore gravity)
- [~] Implement gravity step: unsupported -> attempt `z-1` (collision blocks; pushables block for now)
- [~] Add catch-up settle: capped `z-1` steps on load

- [~] Apply gravity settle to actors/npcs during catch-up activation (items in containers ignore gravity)

### Phase 1.6: Server-Authoritative Movement Stepping (intent + path)

- [ ] Maintain per-entity movement controller state in memory (intent, mode, breaths_per_step, next_breath).
- [ ] Add server endpoints:
  - `POST /api/movement/intent` (set/clear held intent)
  - `POST /api/movement/move_to` (set click-to-move goal/path)
  - Discard click goal when intent becomes active (held intent wins).
- [ ] On each active place breath, attempt at most 1 step per entity:
  - Vertical preempts horizontal
  - Step-time legality via `can_place_volume`
  - Persist entity location via debounced caches (no per-step disk IO)
- [ ] Broadcast authoritative movement updates to renderer over EventBridge (e.g. `ENTITY_MOVED`).
- [ ] MOVE_UNIFY_TEST PASS server stepper advances actor on breath.
- [ ] MOVE_UNIFY_TEST PASS held intent overrides click (goal discarded).
- [ ] MOVE_UNIFY_TEST PASS strict reconcile snaps to server.

### Phase 2: Refactor shared pathfinding to use legality

- [~] Refactor `src/shared/pathfinding.ts` to call legality predicate
- [~] Remove manual actor/npc occupancy loops and legacy tile checks
- [~] Reject blocked goals (no exceptions)

### Phase 2.5: Enforce step-time legality (movement engine)

- [~] Movement engine validates each step with legality and stops on first failure
- [~] Mid-path block produces deterministic stop (no auto-repath)
- [~] Stop reason logged with MoveCheck detail (blocked voxel + owner when available)

### Phase 3: Migrate callers + delete duplicates

- [~] Replace PlaceModule local BFS with shared
- [~] Switch `src/npc_ai/movement_loop.ts` away from `src/npc_ai/pathfinding_node.ts`
- [~] Replace server travel BFS (`find_path_for_npc`) with shared
- [~] Delete or shim-reexport `src/npc_ai/pathfinding_node.ts` (then delete)

### Phase 4.5: Persist Scheduling State

- [~] Persist actor facing + breath fields on position saves
- [~] Persist NPC facing + breath fields on npc_position_update

Note: movement schedule authority is moving to the server stepper.
Any persisted schedule fields should be treated as diagnostics/back-compat until server stepping is fully migrated.

### Phase 4.6: Use Stored Scheduling as Authority

- [ ] Rework: server stepper is the authority for scheduling.
- [ ] Renderer stepping should not be authoritative once server stepping is enabled.

### Phase 4: Reservations integration

- [~] Reservations expressed as stance-origin blocks via ctx
- [~] Travel uses reservations; renderer does not by default

### Phase 5: Verification (dev:logs)


- [ ] `MOVE_UNIFY_TEST PASS click occupied tile rejected` (reason logged)
- [ ] `MOVE_UNIFY_TEST PASS head voxel blocks movement` (volume collision)
- [ ] `MOVE_UNIFY_TEST PASS stand on entity allowed` (support from occupant)
- [ ] `MOVE_UNIFY_TEST PASS self exclusion for large bodies` (no self-block)
- [ ] `MOVE_UNIFY_TEST PASS shared pathing used everywhere` (single module)

- [ ] `MOVE_UNIFY_TEST PASS mid-path step blocked stops (reason logged)`
- [ ] `MOVE_UNIFY_TEST PASS gravity fall settles to support` (1 z step per breath)

- [ ] `MOVE_UNIFY_TEST PASS airborne horizontal allowed (no_support ignored)`
- [ ] `MOVE_UNIFY_TEST PASS air control half speed` (horizontal cadence doubled while airborne)
- [ ] `MOVE_UNIFY_TEST PASS vertical preempts horizontal` (no same-breath mixed axis)
- [ ] `MOVE_UNIFY_TEST PASS jump short=1z long=2z` (press duration)

- [x] `MOVE_UNIFY_TEST PASS breath tick increments for active place`
- [ ] `MOVE_UNIFY_TEST PASS click-to-move steps occur (engine sees breath advancing)`

- [x] `MOVE_UNIFY_TEST PASS breath stream over websocket updates renderer place.breath_index`

### Phase 6: Action pipeline integration hook

- [ ] Define interface boundary: step attempt -> action pipeline (throttle/account)
- [ ] Keep legality/pathfinding pure (no pipeline imports)

## Documentation Followups

- [ ] Update legacy docs referencing `is_tile_blocked`/`pathfinding_node`/PlaceModule BFS to reference unified legality+pathfinding.
- [ ] Update `docs/plans/2026_03_10_realtime_movement_plan.md` Phase 0 to depend on this plan.

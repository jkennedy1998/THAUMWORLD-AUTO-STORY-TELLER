\# Movement Unification Plan (Legality + Pathfinding Single Source)

Date: 2026-03-11

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

- For WALK on the authored structure plane, stance_origin.z defaults to the place base elevation (`place.coordinates.elevation`).
- Only explicit movement sequences (e.g. WALK.UP/WALK.DOWN) change stance_origin.z.

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

### WALK vertical transitions (sequences)

WALK will support deterministic micro-sequences for vertical transitions:

- `WALK.UP` and `WALK.DOWN` are preplanned, non-interruptible sequences.
- They reserve control until completion (no mid-sequence interactions).
- Timing: total duration equals 2 cardinal steps for the same mover (avoids "flying" feel).
- Each substep is still validated by legality at execution time.

Sequence-capable note:

- `WALK.UP` / `WALK.DOWN` may change x/y as well as z as part of the sequence.
  This supports walking up/down inclines made of voxel blocks while staying on the grid.

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

## Phases / Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] implemented + tested via `npm run dev:logs`

### Phase 0: Inventory

- [ ] List all callsites of `find_path`/`is_tile_walkable`/`is_tile_blocked`
- [ ] Add devlog markers for unification tests (`MOVE_UNIFY_TEST`)

### Phase 1: Legality primitives

- [ ] Add `src/place_storage/movement_legality.ts` (collision + support split)
- [ ] Support policy default: `any_footprint`
- [ ] Self-exclusion supported end-to-end
- [ ] Stand on entities allowed (support from occupant OCCUPIES at z-1)
- [ ] Fix occupancy-index character facing usage (currently actors/npcs eval with facing=null)
- [ ] Ensure legality occupancy queries are not stale under in-place Place mutation (correctness over caching)

### Phase 2: Refactor shared pathfinding to use legality

- [ ] Refactor `src/shared/pathfinding.ts` to call legality predicate
- [ ] Remove manual actor/npc occupancy loops and legacy tile checks
- [ ] Reject blocked goals (no exceptions)

### Phase 2.5: Enforce step-time legality (movement engine)

- [ ] Movement engine validates each step with legality and stops on first failure
- [ ] Mid-path block produces deterministic stop (no auto-repath)
- [ ] Stop reason logged with MoveCheck detail (blocked voxel + owner when available)

### Phase 3: Migrate callers + delete duplicates

- [ ] Replace PlaceModule local BFS with shared
- [ ] Switch `src/npc_ai/movement_loop.ts` away from `src/npc_ai/pathfinding_node.ts`
- [ ] Replace server travel BFS (`find_path_for_npc`) with shared
- [ ] Delete or shim-reexport `src/npc_ai/pathfinding_node.ts` (then delete)

### Phase 4: Reservations integration

- [ ] Reservations expressed as stance-origin blocks via ctx
- [ ] Travel uses reservations; renderer does not by default

### Phase 5: Verification (dev:logs)

- [ ] `MOVE_UNIFY_TEST PASS click occupied tile rejected` (reason logged)
- [ ] `MOVE_UNIFY_TEST PASS head voxel blocks movement` (volume collision)
- [ ] `MOVE_UNIFY_TEST PASS stand on entity allowed` (support from occupant)
- [ ] `MOVE_UNIFY_TEST PASS self exclusion for large bodies` (no self-block)
- [ ] `MOVE_UNIFY_TEST PASS shared pathing used everywhere` (single module)
- [ ] `MOVE_UNIFY_TEST PASS mid-path step blocked stops (reason logged)`

### Phase 6: Action pipeline integration hook

- [ ] Define interface boundary: step attempt -> action pipeline (throttle/account)
- [ ] Keep legality/pathfinding pure (no pipeline imports)

## Documentation Followups

- [ ] Update legacy docs referencing `is_tile_blocked`/`pathfinding_node`/PlaceModule BFS to reference unified legality+pathfinding.
- [ ] Update `docs/plans/2026_03_10_realtime_movement_plan.md` Phase 0 to depend on this plan.

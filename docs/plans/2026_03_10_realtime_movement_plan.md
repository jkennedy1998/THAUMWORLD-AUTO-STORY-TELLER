# Realtime Movement Plan

Date: 2026-03-10

## Intent

Define a realtime, tile-based movement model that remains deterministic and voxel-aware.

This plan is explicitly separated from Place module 3Dification. 3Dification defines world layering and 3D math/queries; this plan defines how players/NPCs *move* through that world.

Dependency note:

- Multi-voxel bodies and multi-tile structures are specified in `docs/plans/2026_03_10_multi_tile_rendering_plan.md`.
  Realtime movement should treat those footprints as authoritative for traversal and collision.

## Goals

- Realtime inputs (keyboard) feel responsive while staying on the tile grid.
- Click-to-move remains available as a slower, higher-level command.
- Movement rules use voxel semantics (OCCUPIES/support/blocks movement) rather than UI hacks.
- Vertical movement uses world-z directly (no extra "height" concept).

## Non-Goals (Initial)

- No free-flying controls.
- No continuous physics simulation.
- No complex parkour system.

## Movement Modes (Proposed)

- **Realtime step** (WASD): attempt a single-step move each tick / key repeat.
- **Command move** (click-to-move): compute a path and execute steps.
- **Jump/Vault intent** (Space): allow step sequences that temporarily move to higher z and then back down.

## Voxel-Based Traversal (Core Rule)

Model movement as shortest-path on nodes `{x,y,z}` with weighted edges.

- A voxel is traversable if it is not `OCCUPIES` and (optionally) has valid support below.
- Edges:
  - cardinal: `{x±1,y,z}`, `{x,y±1,z}`
  - optional diagonal: `{x±1,y±1,z}` (with corner-cut rules)
  - step up/down: `{x,y,z±1}` only when allowed by intent (jump/vault) and voxel semantics
- Costs:
  - horizontal = 1
  - vertical = 2 ("up over" naturally costs ~2x without implying flight)
  - diagonal = ~1.4 (or 2 for strict pacing)

## Testing Targets

- Vault/"up over" a 1-voxel wall: path becomes `up -> over -> down`.
- Ensure actor never ends in an invalid voxel after path execution.
- Ensure perception debug (3D LOS/hearing) remains correct while moving through z.

## Status Checklist

Legend:

- [ ] incomplete
- [~] implemented
- [x] tested in `npm run dev:logs`

- [ ] Define movement graph rules (traversable voxels, costs, intent gates)
- [ ] Implement 3D pathfinding (A*/Dijkstra) over `{x,y,z}`
- [ ] Add realtime keyboard input plumbing (renderer)
- [ ] Integrate "jump/vault" sequences without implying flight
- [ ] Add test scenes (wall-top item, low wall vault, multi-z movement)

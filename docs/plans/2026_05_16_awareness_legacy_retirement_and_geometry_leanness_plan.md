# Awareness Legacy Retirement And Geometry Leanness Plan

Date: 2026-05-16

## Intent

Retire legacy awareness/perception formats and collapse the system onto one newer canonical path that is easier to optimize, test, and extend.

This is a consolidation plan, not a redesign.
The goal is to keep the leanest possible set of owners while ensuring the new path is the only gameplay-authoritative path.

This plan follows the current awareness/runtime work and aligns with the existing shared geometry seam.

## Current State

The repo already has the right building blocks:

- structured awareness state exists
- awareness mutation already flows through `src/shared/awareness_runtime.ts`
- shared LOS exists in `src/shared/perception_los.ts`
- witness handling is partly consuming canonical perception verdicts
- witness hearing now routes through the canonical sense-MAG runtime instead of the old cone helper
- `src/npc_ai/cone_of_vision.ts` has been retired from `src/` and only survives in historical docs/archive references
- debug overlays now expose a generic entity debug highlight seam with canonical world-space payloads
- shared geometry code is being centralized under `src/shared/geometry/`

The remaining problem is split authority:

- legacy perception/witness helpers still exist as compatibility shims
- some compatibility formats are still accepted
- debug and gameplay have not fully converged on the same truth source
- geometry ownership is improving, but still needs leaner boundaries and colocated docs

## Core Decision

There should be **one canonical awareness/perception path** for gameplay.

That path should own:

- observer discovery
- sense evaluation
- LOS / occlusion / directional policy
- canonical perception verdict construction
- awareness mutation
- witness reaction consumption

Everything else should be either:

- a thin consumer of that path, or
- retired compatibility code during migration

## Ownership Model

### Canonical gameplay authority

- `src/shared/awareness_runtime.ts`
- `src/shared/perception_los.ts`
- `src/shared/sense_mag.ts`
- shared perception builders near movement/action perception runtime
- `src/shared/broadcast_observers.ts`

### Reaction-only consumers

- `src/npc_ai/witness_handler.ts`
- debug visualization modules

### Geometry seam

- `src/shared/geometry/`

Geometry should stay pure and reusable:

- projection
- slicing
- rasterization
- bounds / cell generation
- shape helper math

Geometry should **not** own gameplay policy.

## Guiding Principle

Keep the repo lean by separating:

1. **policy** — what should be seen/heard/known
2. **geometry** — how shapes/cells/rays/slices are computed
3. **consumers** — how gameplay, witness, and UI react

## What To Retire

Once parity is proven, retire or demote:

- `src/npc_ai/cone_of_vision.ts` as gameplay authority
- old fallback perception batch handling
- adapter-only awareness hooks as primary flow
- duplicate LOS logic outside `src/shared/perception_los.ts`
- legacy renderer-authored debug truth
- duplicate shape/raster helpers outside `src/shared/geometry/`

## Geometry Leanness Rules

### Keep

- a small set of pure geometry modules
- colocated README docs per seam
- one shared vocabulary for shapes, slices, rasters, and projections
- thin helper layers with obvious ownership

### Avoid

- multiple parallel shape authorities
- consumer-specific geometry forks
- policy hidden inside geometry helpers
- broad utility blobs that mix math, gameplay, and rendering

## Documentation Rule

Each owned seam should have colocated docs near the code it describes.

Required/expected docs:

- `src/shared/geometry/README.md`
- small module-level comments where needed
- update plan docs when ownership changes

Docs should explain:

- what the module owns
- what it does not own
- who should call it
- what is legacy/compat only

## Implementation Phases

### Phase 0 — Inventory and baselines

- [ ] confirm all live perception producers/consumers
- [ ] confirm all legacy awareness formats still accepted in runtime
- [ ] identify every remaining non-canonical witness/LOS path
- [ ] capture baseline logs for movement and action perception
- [ ] confirm geometry modules currently in active use

### Phase 1 — Lock canonical contracts

- [ ] finalize canonical perception event shape
- [ ] finalize canonical meaning of identity/location/detectable/bestSense
- [ ] finalize canonical LOS / occlusion / directional policy entrypoint
- [ ] document the canonical path in colocated docs

### Phase 2 — Collapse consumers onto the canonical path

- [ ] make witness handling reaction-only
- [ ] make debug overlays consume canonical payloads only
- [ ] remove gameplay dependence on fallback perception helpers
- [ ] ensure movement and action perception share the same discovery and verdict logic

### Phase 3 — Retire legacy formats

- [ ] remove ignored legacy perception batch handling
- [ ] remove duplicate adapter-only awareness write paths
- [x] retire `cone_of_vision` as gameplay authority
- [ ] keep only explicit compatibility bridges that are still required

### Phase 4 — Finish geometry encapsulation

- [ ] keep shape/raster helpers under `src/shared/geometry/`
- [ ] split pure geometry from consumer policy
- [ ] keep geometry docs colocated and current
- [ ] remove duplicate geometry owners where possible
- [ ] preserve thin compatibility exports only while migration is active

### Phase 5 — Optimize after consolidation

- [ ] profile the canonical path
- [ ] optimize the single runtime path instead of multiple copies
- [ ] simplify data shapes for hot loops
- [ ] add focused tests for performance-sensitive geometry/perception cases

## Validation Strategy

Use logs and tests as source of truth.

Primary checks:

- movement perception emits canonical events
- action perception emits canonical events
- awareness updates apply once through the runtime
- witness reacts without re-deciding gameplay truth
- debug overlays match canonical positions/z
- geometry helpers produce consistent outputs across consumers

## Minimum Done Criteria

This work is complete when:

- one canonical perception/awareness path remains for gameplay
- legacy perception formats are retired or explicitly non-authoritative
- witness handling is reaction-focused
- debug visualization uses canonical spatial truth
- geometry is encapsulated, documented, and lean
- duplicate shape/LOS helpers no longer create rule drift

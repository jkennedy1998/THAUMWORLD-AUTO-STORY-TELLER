# Scalable Region Place Topology Plan

Date: 2026-03-23

## Status

- [ ] planned

## Intent

Make same-region place topology scale to thousands of places per region/world tile without changing the gameplay model.

The gameplay direction stays the same:

- same-region adjacency is derived from touching `region_bounds`
- scene visibility is culled by connected-distance hops
- server remains authoritative for movement and place transitions
- renderer remains a consumer of scene topology and place payloads

This plan replaces request-time region scans and request-time all-pairs adjacency building with derived topology data on disk plus in-memory caches.

## Why This Plan Exists

The current seam-based direction is correct, but the current implementation path does not scale.

Current bottlenecks:

- `list_places_in_region(...)` scans all place files and loads them to filter by `region_id`
- region adjacency is rebuilt from loaded place files on demand
- adjacency derivation currently does all-pairs face checks across the region
- scene building discovers the whole graph first and only then applies hop culling
- travel helpers and editor validation repeat similar whole-region scans

That works for the tavern cluster, but it will break down once world generation can place thousands of places into one region/world tile.

## Source Of Truth / Dependencies

- Seam adjacency direction: `docs/plans/2026_03_20_seam_based_place_adjacency_plan.md`
- Unified movement implementation: `docs/plans/2026_03_13_unified_movement_system_implementation_plan.md`
- Place persistence hardening: `docs/plans/archive/2026_03_16_place_persistence_consolidation_plan.md`
- Current region scene host: `src/interface_program/main.ts`
- Current place storage host: `src/place_storage/store.ts`
- Current seam geometry helpers: `src/shared/place_adjacency.ts`
- Existing rebuildable derived-index pattern: `src/place_storage/entity_index.ts`

## Non-Negotiable Invariants

- Canonical place content still lives in place JSON.
- Region/place topology indexes are derived data, not canonical authored data.
- Derived topology data must be safe to delete and rebuild.
- Same-region adjacency remains derived from touching `region_bounds`, not connector objects.
- Connected-distance culling remains the visibility rule.
- Scene loading must scale with visible scene size, not total region place count.
- Movement/place transitions must not wait on full-region graph rebuilds.
- Normal tile/item/entity mutations inside a place must not invalidate region adjacency.

## Product Direction

We want generated worlds with many small places per region while preserving the local feel of seam-based movement.

That means:

- a player standing in one place should only pay for nearby connected places
- a seam crossing should update the visible scene immediately
- editor operations should update topology incrementally
- topology data should be inspectable and rebuildable for debugging

## Architecture Direction

### 1. Keep canonical place data separate from derived topology data

Canonical place JSON continues to store:

- `region_id`
- `region_bounds`
- tiles, items, actors, NPCs, structures, and other place content

Derived topology data stores:

- region membership
- lightweight place bounds records
- adjacency neighbor lists
- optional cached scene-expansion results

### 2. Use derived-on-disk plus in-memory cache

Recommended pattern:

- persisted derived index files per slot
- one in-memory cache per slot for fast runtime reads
- explicit invalidation + rebuild hooks
- safe deletion/rebuild at any time

This follows the same operational model already used by `place_entity_index`.

### 3. Split topology from payload

Topology answers:

- which region the place belongs to
- which places are adjacent
- which place ids are visible within `N` hops

Payload answers:

- what each visible place currently contains
- what renderable/collision-relevant runtime state is active now

The topology layer should not clone full place payloads unless the caller explicitly asks for them.

## Proposed Derived Data

### A. Region Place Index

Recommended file family:

- `local_data/data_slot_<N>/region_place_index.jsonc`

Recommended shape:

```ts
type RegionPlaceIndex = {
  schema_version: number;
  generated_at: string;
  regions: Record<string, {
    place_ids: string[];
    places: Record<string, {
      place_id: string;
      region_id: string;
      bounds: PlaceRegionBounds;
      updated_at: string;
      bounds_revision: number;
    }>;
  }>;
};
```

Purpose:

- replace `list_places_in_region(...)` full scans
- provide lightweight bounds data for validation and topology work
- support editor conflict checks without loading every place JSON

### B. Region Adjacency Index

Recommended file family:

- `local_data/data_slot_<N>/region_place_graph.jsonc`

Recommended shape:

```ts
type RegionPlaceGraph = {
  schema_version: number;
  generated_at: string;
  regions: Record<string, {
    graph_version: number;
    neighbors: Record<string, string[]>;
  }>;
};
```

Purpose:

- answer `place_id -> neighbor_place_ids` quickly
- power connected-hop BFS without scanning the whole region at request time
- unify scene culling, seam travel lookup, and place-tool neighbor discovery

### C. Optional Scene Expansion Cache

Recommended initial stance:

- in-memory only
- keyed by `(slot, region_id, seed_place_ids, hops_visible, graph_version)`

Purpose:

- avoid repeating BFS work for the same visible scene request patterns
- stay invalidation-safe by tying cache entries to `graph_version`

This is optional for phase 1 and can be added later.

## Index Build Strategy

## Full rebuild

Full rebuild should:

1. enumerate all places once
2. load each place once
3. write region membership records
4. derive adjacency from bounds
5. write adjacency graph

This path is the recovery/debug path and must be deterministic.

## Incremental update

Incremental update should happen when a place is:

- created
- deleted
- moved to a different region
- resized / `region_bounds` changed

Incremental rule:

- update only the touched region membership entries
- recompute only the affected place's adjacency edges and any neighboring impacted edges
- bump the touched region's `graph_version`

Normal content mutations that do not change `region_bounds` should not touch the topology graph.

## Adjacency Derivation Strategy

### Initial implementation

The first scalable version does not need to be perfect-optimal.

Safe first step:

- full rebuild per region may still compute adjacency from all region place bounds
- but runtime requests must read the prebuilt graph instead of rebuilding it

This already removes request-time `O(n^2)` behavior from the hot path.

### Follow-up optimization

Once the derived graph is in place, optimize rebuild cost with candidate filtering:

- bucket places by region face planes
- or bucket bounds into spatial bins/chunks
- only run `get_places_face_adjacency(...)` against plausible candidates

Important rule:

- continue using the existing seam geometry helpers as the final authority for adjacency validation
- do not introduce a second geometry rule set

## API Direction

### Topology API

Keep `/api/region/scene`, but change its internals so it reads the topology indexes.

Recommended response direction:

- `actor_current_place_id`
- `selected_place_id`
- `region_id`
- lightweight visible place summaries
- `visible_place_ids`
- `graph_version`

This endpoint should not need to load every place in the region.

### Payload API

Visible place payload loading should hydrate only the visible place ids returned by topology.

Recommended direction:

- keep existing `/api/place` for single-place load and fallback
- add a batch scene place payload endpoint only if needed
- avoid cloning entire place objects for non-visible places

### Transition API / Event Direction

Scene handoff during movement should become event-driven.

Recommended direction:

- when seam crossing changes the actor's place, emit a place-transition event immediately
- renderer updates actor-current-place and visible scene from topology immediately
- heavier payload refreshes may follow as reconciliation

This keeps the scene handoff fast without removing culling.

## Invalidations

### Must invalidate region membership and graph

- create place
- delete place
- change `region_id`
- change `region_bounds`

### Must invalidate payload/cache only

- tile edits within existing bounds
- item movement within a place
- actor/NPC movement within a place
- runtime breath/item/physics updates

### Optional cache invalidations

- scene BFS cache on `graph_version` change
- loaded visible-scene summaries on payload refresh boundaries

## Current -> Target Mapping

### Replace hot-path scans

- `src/place_storage/store.ts:list_places_in_region(...)`
  - current: enumerate all places and load each file
  - target: read the derived region membership index

- `src/interface_program/main.ts:build_region_place_adjacency(...)`
  - current: load region places and rebuild graph every time
  - target: read adjacency graph from cache/index

- `src/interface_program/main.ts:build_connected_region_place_ids(...)`
  - current: BFS over a freshly rebuilt graph
  - target: BFS over cached graph neighbors

- `src/travel/movement.ts:get_adjacent_place_ids(...)`
  - current: scan region places and run adjacency checks
  - target: read neighbor ids from the adjacency graph

- `src/place_storage/store.ts:region_bounds_conflict(...)`
  - current: load region place records through place scans
  - target: read region membership bounds records directly

### Keep and reuse

- `src/shared/place_adjacency.ts`
  - keep as the geometry oracle for seam adjacency

- `src/place_storage/entity_index.ts`
  - reuse as the pattern for rebuildable derived data + in-memory cache

- `src/interface_program/main.ts`
  - keep as the scene topology and movement authority host

## Implementation Phases

Legend:

- [ ] incomplete
- [~] in progress
- [x] implemented + verified

### Phase 0: Inventory and devlog scaffolding

- [ ] list all runtime callers that currently scan region places or rebuild adjacency
- [ ] add topology-specific devlog markers for region graph reads, rebuilds, and invalidations
- [ ] define index schema versions and rebuild commands

### Phase 1: Region membership index

- [x] add `region_place_index` derived storage and in-memory cache
- [x] implement full rebuild from place JSON
- [x] replace `list_places_in_region(...)` with index-backed reads
- [x] replace lightweight region bounds record reads with the new index
- [x] add safe cache invalidation helpers

### Phase 2: Region adjacency graph

- [x] add `region_place_graph` derived storage and in-memory cache
- [x] implement full adjacency rebuild from region membership bounds
- [x] keep `get_places_face_adjacency(...)` as the final adjacency oracle
- [x] replace runtime region graph rebuilds with graph reads
- [x] replace travel/editor neighbor scans with graph reads

### Phase 3: Scene topology path

- [x] switch `/api/region/scene` to index-backed BFS over cached neighbors
- [x] include `graph_version` in topology responses
- [~] ensure visible scene cost scales with visible place count, not region size
- [x] remove redundant renderer-side adjacency rebuilding when server topology is available

Current note:

- [x] topology-only region scene endpoint exists and app state hydrates visible place payloads by `visible_place_ids`
- [~] scene refresh still uses per-place payload fetches; batch hydration/finer stale detection remains follow-up work

### Phase 4: Movement handoff during zone loading

- [x] emit explicit actor place-transition events when seam crossing changes place ownership
- [x] update renderer scene handoff to react immediately to topology change
- [x] ensure movement updates can apply to any loaded visible place, not only the current selected place
- [x] make heavy payload refreshes reconcile after the scene handoff instead of blocking it

Hardening notes:

- [x] transition devlogs exist for server emit, topology fetch, hydration, and scene handoff timing
- [x] scene handoff has a fast-path when `graph_version`, actor place, and `visible_place_ids` are unchanged
- [x] handoff hydration fetches only missing visible place payloads
- [x] client performs immediate local handoff to an already-loaded destination scene place before topology reconciliation finishes

### Phase 5: Incremental invalidation

- [ ] update create/delete/resize/place-move flows to refresh affected topology indexes incrementally
- [ ] bump per-region `graph_version` on topology changes only
- [ ] ensure normal place content edits do not thrash topology indexes
- [ ] add rebuild commands for manual recovery/debugging

### Phase 6: Rebuild-cost optimization

- [ ] profile full rebuild cost on synthetic large regions
- [ ] add candidate filtering for adjacency rebuilds if needed
- [ ] add optional in-memory scene BFS caching keyed by `graph_version`
- [ ] keep correctness identical to the simpler rebuild path

## Verification / Regression Checklist

### Functional topology checks

- [x] `list_places_in_region(...)` returns the same place ids as the old scan path on existing data
- [x] derived graph neighbors match direct `get_places_face_adjacency(...)` results on controlled regression fixtures
- [ ] overlap detection still rejects interior overlap and allows face-touching adjacency
- [x] edge-only and corner-only touching still do not create neighbors

### Scene loading checks

- [~] `/api/region/scene` for the tavern cluster returns the same visible ids as before
- [ ] visible ids remain stable when selected place differs from actor current place
- [~] scene responses do not perform full-region adjacency rebuilds during ordinary requests

### Movement/transition checks

- [x] seam crossing updates actor place without waiting on poll-based discovery
- [~] moving into a newly visible adjacent place does not stall until a full place reload completes
- [~] ordered visible movement updates remain preserved for visible places
- [ ] crossing between adjacent places still respects destination legality checks

### Editor/update checks

- [ ] create-place updates indexes correctly
- [ ] resize updates adjacency correctly
- [ ] delete-place removes graph edges correctly
- [ ] ordinary tile/item/entity edits do not trigger topology invalidation

### Scale checks

- [ ] synthetic region with large place count can rebuild indexes successfully
- [ ] topology requests remain bounded by visible scene size after indexes are warm
- [ ] cache invalidations stay localized to affected regions

## Recommended Test Coverage

### Unit tests

- add tests for region membership index build/rebuild behavior
- add tests for adjacency graph correctness from `region_bounds`
- add tests for local invalidation when one place is resized or deleted
- add tests for BFS visible-id expansion by hops
- add tests proving corner-touch and edge-touch do not count as adjacency

### Integration tests

- add a test fixture region with a small multi-place seam graph
- add API-level tests for `/api/region/scene` visible ids at hop 0/1/2
- add integration tests for travel helper neighbor lookup through the new graph
- add editor-flow tests for create/resize/delete affecting topology indexes

### Runtime/devlog tests

- add devlog markers for `region_place_index rebuild`, `region_place_graph rebuild`, and `scene topology read`
- [~] verify ordinary movement across a seam does not log whole-region graph rebuilds
- verify a place resize bumps `graph_version` for only the affected region

### Synthetic scale tests

- add a script or test helper that generates a large synthetic region topology
- verify rebuild correctness and capture rough timing for 100 / 1000 / 5000 places
- ensure ordinary visible-scene lookup after warm cache does not grow with total region size in the same way

## Initial File Targets

Primary additions:

- `src/place_storage/region_place_index.ts`
- `src/place_storage/region_place_graph.ts`
- optional scale-test/helper file under `src/tools/` or test helpers

Primary integrations:

- `src/place_storage/store.ts`
- `src/interface_program/main.ts`
- `src/travel/movement.ts`
- `src/canvas_app/app_state.ts`
- `src/mono_ui/modules/place_module.ts`

## Risks / Tradeoffs

- Derived indexes add another consistency surface, so rebuildability and narrow invalidation rules matter.
- Full rebuild may still be expensive on huge regions, but that is acceptable if it is off the hot path.
- Incremental adjacency maintenance is easy to get subtly wrong, so phase 2 should keep a trusted full-rebuild path for verification.
- Renderer/server scene responsibilities must stay clean; topology should move server-side, not split again.

## Definition Of Done

- Region membership no longer requires scanning/loading every place file on ordinary reads.
- Same-region adjacency no longer rebuilds on ordinary scene/travel requests.
- Connected-hop visibility still works, but now runs on indexed adjacency data.
- `/api/region/scene` cost is dominated by visible place count rather than total region place count.
- Seam crossing into a newly visible place updates scene ownership without the current poll-driven hitch.
- Create/delete/resize operations update derived topology data correctly.
- Derived topology files are safe to delete and rebuild.
- Regression and scale tests exist so future movement/place work does not silently reintroduce region-wide scans.

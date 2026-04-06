# Movement Runtime Unification Plan

Date: 2026-04-04

## Intent

Unify THAUMWORLD movement under one authoritative runtime so player movement, NPC movement, click-to-move, held-direction movement, physics, place transitions, movement broadcasts, and awareness all resolve from the same step pipeline.

This plan is a runtime unification plan, not a fresh movement design from scratch. It starts from what is actually live in the repo today and consolidates that into a single architecture.

This plan is also a cleanup plan. Unification is not complete until duplicate runtime ownership is removed for mechanics that are still represented in the game. We are not trying to preserve parallel movement implementations indefinitely.

Implementation priority for this plan:

1. establish runtime authority and remove live bypasses
2. centralize side effects on the authoritative path
3. centralize non-step mutations on the same authoritative output path
4. only then clean up helpers and optimize

If an implementation task conflicts with this priority order, follow the priority order.

## Status

Current state is split and inconsistent:

- `src/interface_program/main.ts` is the live server-authoritative movement + physics runtime seen in gameplay logs.
- `src/shared/movement_engine.ts` is a second movement runtime used by renderer/NPC code paths and currently contains the new movement-awareness bridge.
- `src/mono_ui/modules/place_module.ts` still drives movement intent through shared movement-engine entrypoints.
- `src/npc_ai/movement_loop.ts` still exists as legacy/secondary movement code and must be explicitly verified as live or retired during inventory; do not assume it is the primary current NPC movement owner without tracing callsites.
- connector interaction still has legacy bypasses:
  - `src/mono_ui/modules/place_module.ts` can still use renderer `start_entity_movement(...)` for connector approach movement
  - `src/canvas_app/app_state.ts` still uses `/api/place/travel` for connector travel
- non-step movement mutations still exist outside the step resolver, including editor/debug reposition paths such as place-painter relocation and debug vertical impulse endpoints
- Action-pipeline perception works for verbs like `COMMUNICATE`, but movement broadcasts are not reaching the same awareness path in live gameplay.

This plan supersedes older assumptions that realtime movement should primarily build on `src/shared/movement_engine.ts` as the main live runtime.

## Relationship To Existing Plans

This plan builds on and updates earlier movement documents:

- `docs/plans/2026_03_10_realtime_movement_plan.md`
- `docs/plans/2026_03_11_movement_unification_plan.md`
- `docs/plans/2026_03_13_unified_movement_system_design.md`

Those plans still contain useful movement semantics and invariants, especially:

- single-axis step model
- server authority
- shared legality rules
- shared speed model

But this document is the source of truth for runtime ownership and migration.

## Core Decision

`src/interface_program/main.ts` becomes the only authoritative runtime for movement stepping.

That means:

- keyboard movement and click-to-move must resolve through the same server-side step resolver
- NPC wandering must resolve through the same server-side step resolver
- movement legality, incline/step-up resolution, support checks, seam transitions, movement broadcasts, and awareness updates must happen at the same authoritative step boundary
- renderer movement code may submit intent and render feedback, but it must not own authoritative step execution

Corollary:

- no new movement runtime may be introduced outside the authoritative server movement runtime
- no movement side-effect system may attach to a non-authoritative stepper
- any reusable movement code extracted during this work must be pure helper code, not a second runtime

## Architectural Goals

- One runtime owns actual movement stepping.
- One legality model determines collision/support/incline/step-up.
- One step resolver handles both click-to-move and held intent with different intent sources.
- One movement-side-effect path emits:
  - movement broadcasts
  - witness events
  - awareness updates
  - SFX/particles/hooks
- Physical tags, support rules, and step-up semantics come from one canonical physics/surface model.
- Non-step movement mutations still reuse the same authoritative persistence + refresh + side-effect publication path even when they do not use locomotion stepping.

## Success Criteria

The unification is successful only when all of the following are true:

- player held movement and click-to-move reach the same authoritative step resolver
- NPC movement also reaches that same authoritative step resolver
- successful movement steps emit side effects from one authoritative hook only
- awareness and witness movement reactions depend on the authoritative hook only
- there is no second live runtime that can step entities independently
- renderer movement code can no longer create authoritative movement outcomes by itself
- step-up/platform semantics are derived from the canonical physics/surface model, not a special-case movement tag
- connector travel no longer uses renderer stepping or a separate coarse travel path for normal gameplay movement
- teleport/reposition/admin movement mutations publish refreshes and state updates through the same authoritative output path as stepped movement

## Non-Goals

- Do not optimize first.
- Do not redesign pathfinding, physics, or action economy from scratch in this pass.
- Do not add new movement verbs for the sake of unification.
- Do not preserve dual runtimes indefinitely for backward compatibility.
- Do not keep dead movement branches around "just in case" if the represented mechanic still exists elsewhere in the unified system.

## Mutation And Teleportation Policy

Not every real position change is a locomotion step.

Examples:

- editor/place-painter reposition
- debug/admin teleport or impulse helpers
- scripted relocation
- connector/travel relocation that intentionally skips per-tile walking

Rule:

- these operations should become authoritative movement mutations, not ad hoc position rewrites

That means:

- they do not need to pretend to be walk steps
- they do need to reuse the same authoritative persistence, refresh emission, move-seq/state sync, and post-move hook publication path
- they must be classified distinctly from stepped locomotion so movement rules, perception, and SFX can choose appropriate behavior

Recommended categories:

- `step` for normal resolved locomotion
- `transition` for connector/place seam relocation
- `teleport` for instant relocation/admin/scripted moves
- `impulse` for velocity-only mutation such as debug vertical impulse

Architectural constraint:

- raw position rewrites should be isolated behind one authoritative movement-mutation API so refreshes and downstream state stay consistent
- editor/debug mutations may remain privileged exceptions to gameplay legality, but they should still publish through the same authoritative state/output layer

Implementation rule:

- do not try to force teleports, editor moves, or debug impulses through the walk stepper
- do route them through the same authoritative mutation commit/output layer used by movement so refreshes, move sequence updates, and downstream sync stay consistent

## Cleanup Policy

Cleanup is part of the project, not optional follow-up.

Rules:

- If two live codepaths can still produce the same gameplay movement outcome, one of them must be removed or demoted to a pure helper by the end of the project.
- If a mechanic is still represented in the game, it must have one authoritative owner.
- If a piece of code only exists to support an older movement runtime, it should be removed once the new authoritative path covers that behavior.
- If a piece of code is still useful but should no longer own runtime state, extract the pure logic and retire the runtime wrapper.

Examples of things that should not survive as parallel authorities:

- second step schedulers
- second movement-state stores
- second legality evaluators
- second movement broadcast emitters
- second awareness hooks for the same movement step

Examples of things that may survive as helpers:

- path-building helpers
- body-volume evaluation helpers
- pure legality helpers
- debug/trace helpers

## Current Live Systems

### 1. Server-authoritative movement runtime

Live path observed in logs:

- `MOVE_VEL_TEST ...`
- `TIMED_EVENT_MOVE ...`

Primary owner:

- `src/interface_program/main.ts`

Responsibilities already present there:

- breath loop
- realtime visible-place pulses
- movement intent gating during timed events
- physics resolution
- legality checks
- incline handling
- place transitions
- persistence
- active-place simulation profiling

Target end-state responsibilities:

- canonical movement intent state ingestion
- canonical step scheduling
- canonical movement legality application
- canonical post-step side effects
- canonical movement persistence

### 2. Shared movement engine

Secondary runtime currently used by renderer/NPC code:

- `src/shared/movement_engine.ts`

Current responsibilities there:

- entity movement state map
- path stepping / realtime intent stepping
- place registration
- some NPC movement scheduling support
- movement witness/perception bridge logic added recently

This engine is not reliably visible in live gameplay logs for player movement, which strongly suggests it is not the effective authoritative runtime for the player walking path.

Planned outcome:

- it must stop being a runtime authority
- it may survive only as pure helper code or a temporary migration shim
- if it continues to own step scheduling or movement state after unification, the project is not complete

### 3. Renderer/UI movement initiation

- `src/mono_ui/modules/place_module.ts`

Current behavior:

- starts movement through shared engine entrypoints
- tracks local movement-facing UX
- mixes input, movement initiation, and some movement debug concerns

Target end-state:

- owns input collection and presentation only
- submits canonical movement intent to the server runtime
- may predict locally later, but prediction must be clearly non-authoritative and removable without changing movement rules

### 4. NPC movement loop

- `src/npc_ai/movement_loop.ts`

Current behavior:

- initializes shared movement engine
- registers places
- starts wandering goals

Target end-state:

- chooses goals and movement intent only
- does not own a separate stepping runtime
- does not bypass the canonical server-side movement stepper

## Target Runtime Architecture

### A. Intent Layer

Intent sources remain separate:

- held directional input
- click-to-move target
- NPC movement goal
- scripted movement goal

But all intent sources feed the same canonical server-side movement queue/state.

Constraint:

- intent must be serializable and inspectable as data
- intent may differ by source, but not by execution semantics

Intent owns:

- desired direction or target
- priority / cancellation rules
- locomotion mode selection

Intent does not own:

- actual stepping
- legality
- movement persistence
- awareness side effects

### B. Planning Layer

Planning is shared but optional per intent type:

- held input may produce a trivial next-step target
- click-to-move produces a path/next step sequence
- NPC wandering produces goals and paths

Planning chooses candidate steps.
Planning does not authorize them.

Constraint:

- pathfinding/path planning must not embed a separate movement legality truth
- planned steps are only proposals until the authoritative resolver accepts them

### C. Resolution Layer (Authoritative)

Owned only by `src/interface_program/main.ts` runtime.

Every successful movement step must resolve here.

Resolution owns:

- legality check
- incline/step-up behavior
- support/gravity interaction
- collision/blocking
- place seam transition handling
- movement resource accounting
- final entity position/facing persistence

Constraint:

- this layer is the only place allowed to turn a candidate step into a real step
- if another codepath can change entity position without passing through this layer, that is a bug or leftover architecture debt

### D. Side Effects Layer

Triggered only from authoritative successful resolution.

Side effects include:

- movement perception broadcasts
- witness movement handling
- awareness updates
- footstep SFX
- particles / debug visuals
- future stealth accounting

This layer must not have a second non-authoritative version.

Constraint:

- side effects must consume authoritative step facts, not recompute movement truth from renderer-local state
- if a side effect needs movement data, the authoritative resolver must publish it once
- non-step authoritative movement mutations must also publish canonical movement facts, tagged by mutation kind, so refresh/sync code does not fork into separate ad hoc paths

## Single Step Resolver Requirement

Keyboard movement and click-to-move must use the same step resolver.

The only difference should be the intent source:

- held input = repeated short-horizon desired movement
- click-to-move = precomputed target/path intent

Everything after intent selection must be shared.

This includes:

- legality
- collision
- support checks
- incline/step-up interpretation
- movement accounting
- place transition rules
- movement broadcasts
- awareness updates
- witness movement handling

If any of the above still differs by input source, unification is incomplete.

## Canonical Module Boundaries

These are the target boundaries after unification.

### Authoritative runtime

- `src/interface_program/main.ts`

Owns:

- place breath stepping
- movement step scheduling
- movement resolution order
- application of pure legality helpers
- final post-step event emission
- final non-step movement-mutation commit and emission

### Pure legality / movement helpers

- `src/place_storage/movement_legality.ts`
- `src/shared/physics_tags.ts`
- other extracted pure movement helpers as needed

Own:

- collision/support/surface semantics
- incline/step-up derivation
- movement legality checks

Do not own:

- timers
- movement state maps
- breath loops
- persistence

### Intent/planning adapters

- renderer input modules
- NPC goal/planning modules
- click-to-move planners

Own:

- choosing desired movement goals
- converting source-specific input into canonical movement intent

Do not own:

- authoritative movement progression
- legality truth
- side-effect truth

### Authoritative movement-mutation layer

- initially inside `src/interface_program/main.ts`
- may later be extracted to a pure server-side module if helpful

Owns:

- teleport / reposition / transition / impulse commit helpers
- move-seq updates for non-step movement mutations
- bridge refresh emission for non-step movement mutations
- publication of canonical mutation facts to downstream systems

Do not own:

- renderer-local prediction
- path planning
- legality truth beyond calling shared helpers when appropriate

## Movement Unification Phases

Legend:

- [ ] not started
- [~] partially true today
- [x] complete and verified

Execution rule for coding agents:

- complete phases in order unless a later phase is strictly required to unblock the current one
- do not start broad helper extraction or optimization work before the live authority and side-effect phases are complete
- when a phase says "remove" or "retire", that means delete the live ownership path, not merely stop using it in one caller

### Phase 0. Inventory And Runtime Trace

- [x] List all live movement entrypoints for:
  - held input
  - click-to-move
  - NPC wandering
  - timed-event movement
- [x] List all live position-mutating entrypoints for:
  - connector approach movement
  - connector/place travel
  - seam transitions
  - editor/place-painter relocation
  - debug/admin teleport or impulse endpoints
  - any direct travel helper that mutates entity position without going through step resolution
- [x] Mark which codepath currently owns final positions for each entrypoint.
- [x] Identify all side effects triggered on successful step.
- [~] Identify all side effects triggered on non-step movement mutations.
- [x] Identify all remaining callers of shared movement-engine stepping APIs.
- [x] Mark, for each caller, whether it will be:
  - migrated to intent-only
  - extracted to pure helper use
  - deleted
- [~] Produce a mutator matrix for every live movement or reposition path with columns:
  - entrypoint
  - caller
  - authoritative position writer
  - emitted side effects
  - gameplay vs editor/debug
  - planned disposition

### Phase 1. Declare Server Runtime As Authority

- [x] Add a runtime ownership note to movement code/docs.
- [x] Treat `interface_program/main.ts` movement resolution as the only source of truth.
- [x] Stop adding new gameplay side effects to `src/shared/movement_engine.ts`.
- [x] Add a migration rule that any new movement feature must attach to the authoritative server resolver, not to renderer/shared runtime code.
- [x] Mark known legacy paths as migration targets only; do not extend them during development.

### Phase 2. Unify Intent Submission

- [~] Define canonical movement intent types shared by player/NPC/UI/server.
- [x] Route held-direction input into canonical server movement intent.
- [x] Route click-to-move into canonical server movement intent.
- [x] Route NPC wandering/pathing into canonical server movement intent.
- [x] Keep renderer prediction optional and non-authoritative.
- [~] Define cancellation/precedence rules so click goals, held intent, and NPC goals cannot create divergent execution semantics.
- [x] Remove or demote renderer-side APIs that imply authoritative stepping once replacement intent APIs exist.

Exit condition for Phase 2:

- held input, click-to-move, and live NPC goal submission all enter `interface_program/main.ts` as intent/goal data only
- no gameplay caller outside the server runtime can authoritatively advance an entity one tile at a time

### Phase 3. Move Broadcasts And Awareness To Authoritative Step Resolution

- [x] Remove reliance on `src/shared/movement_engine.ts` for live movement broadcasts.
- [~] Emit movement broadcasts from the authoritative successful step boundary in `interface_program/main.ts`.
- [x] Use the same light/pressure MAG evaluation path as action broadcasts.
- [x] Update awareness immediately from successful movement perception.
- [x] Run witness reactions after awareness updates.
- [x] Delete or disable duplicate movement broadcast emitters once the authoritative hook is live.
- [x] Add an authoritative movement-perception publication hook at the step commit boundary in `interface_program/main.ts`.
- [x] Treat renderer `movement_perception_batch` as temporary migration glue only.
- [x] Remove renderer-owned movement perception emission once the authoritative hook is live.
- [~] Ensure non-step movement mutations can publish canonical movement facts when refresh/awareness logic needs them, without pretending they were walk steps.

Exit condition for Phase 3:

- authoritative movement step commit in `interface_program/main.ts` is the only gameplay source of movement perception, awareness updates, and witness movement reactions
- renderer receipt of movement updates may render/debug them but may not originate gameplay awareness changes

### Phase 3.5. Connector And Travel Unification

- [x] Remove renderer-owned connector approach stepping from `src/mono_ui/modules/place_module.ts`.
- [x] Route connector approach movement through canonical movement intent / authoritative step resolution.
- [x] Decide whether connector arrival triggers:
  - continued authoritative step-based seam resolution, or
  - an authoritative movement mutation of kind `transition`
- [~] Retire normal gameplay dependence on `/api/place/travel` for connector traversal once the unified connector path exists.
- [~] Keep any remaining coarse travel helpers scoped to explicit non-step travel/mutation semantics, not overlapping local walking.
- [x] Verify connector travel uses the same refresh/sync path as other authoritative movement outcomes.

Exit condition for Phase 3.5:

- normal connector interaction no longer depends on renderer stepping or coarse local travel helpers
- connector approach and connector transition both publish through authoritative movement outputs

### Phase 3.6. Seamless Cross-Place Movement

Goal:

- connected places should behave like one continuous movement space for supported mover types
- valid movement across a connected place seam should resolve as movement into the adjacent place, not as a dead-end `out_of_bounds` response
- actors and pushables should use the same seam resolution and transfer framework, with mover-policy differences only where necessary

Scope for this phase:

- actor walk movement
- pushable tile movement
- connector/seam destination validation
- push fallback ordering when a push fails

Non-goals for this phase:

- do not redesign climb/swim/fly yet
- do not redesign gravity except where pushable seam transfer requires shared commit behavior
- do not move topology logic into `src/place_storage/movement_legality.ts`

Architectural rules:

- `src/place_storage/movement_legality.ts` stays place-local and topology-agnostic
- multi-place target resolution stays in the authoritative runtime
- there must be one seam transfer framework, not separate actor and pushable seam systems
- pushables should search alternate valid connector entry voxels when exact mapped transfer is illegal, using the same helper family as actors

Implementation slices:

- [ ] Extract a shared world-target resolver in `src/interface_program/main.ts` that resolves:
  - same-place target
  - connected-place target
  - true no-connected-place miss
- [ ] Refactor current seam scan logic into that shared resolver instead of keeping it actor-only blocked-step glue.
- [ ] Extract a shared seam-entry validation helper that:
  - validates the preferred mapped entry voxel
  - supports vertical snap when allowed by mover policy
  - searches alternate valid entry voxels when the preferred voxel is illegal
  - fails cleanly with one authoritative rule when no legal entry exists
- [ ] Introduce seam mover policies for at least:
  - `actor`
  - `npc`
  - `pushable_tile`
- [ ] Extract a shared cross-place transfer commit helper that can move:
  - actors/NPCs
  - pushable tiles
- [ ] Reuse the same persistence and refresh flow for cross-place transfer:
  - persist source and destination place state
  - refresh active runtime state
  - publish bridge updates/events appropriate to mover kind
- [ ] Migrate actor seam handling to the shared resolver/helper stack before hard collision.
- [ ] Migrate pushable tile movement to the shared resolver/helper stack so pushed tiles can cross seams.
- [ ] Update fallback ordering for actor horizontal movement against pushables:
  - try push
  - if push succeeds, retry movement
  - if push fails, continue fallback resolution
  - evaluate walk step-up
  - evaluate seam transfer
  - otherwise collide
- [ ] Ensure pushables do not become automatic step-up surfaces; failed push only means "continue fallback resolution".

Exit condition for Phase 3.6:

- actor walk movement can cross connected places without depending on a separate coarse travel path
- pushable tiles can cross connected places through the same seam transfer framework
- valid connected-place movement is resolved before returning hard `out_of_bounds`
- connector destination occupancy either resolves through alternate-entry search or fails cleanly with one authoritative rule

### Phase 4. Consolidate Legality And Surface Semantics

- [x] Audit all movement legality/occupancy/support helpers in live path.
- [~] Ensure all movement modes use the same legality helpers.
- [x] Move incline/step-up/surface interpretation behind canonical derived flags.
- [~] Eliminate duplicate movement legality branches where possible.
- [~] Make all surviving movement legality code call the same pure helper API.
- [x] Remove branches that exist only to preserve superseded movement runtimes.

### Phase 5. Demote Or Retire Shared Movement Engine Runtime

- [x] Decide whether `src/shared/movement_engine.ts` becomes:
  - pure helper library, or
  - temporary shim, or
  - removed entirely
- [x] Remove authoritative stepping responsibilities from the shared engine.
- [x] Keep only reusable pure helpers if still valuable.
- [x] Remove movement-state ownership from the shared engine if server runtime already owns it.
- [x] Remove movement side-effect ownership from the shared engine.
- [x] Delete obsolete shared-engine APIs after migration, not merely stop calling them.

### Phase 5.5. Centralize Authoritative Movement Mutations

- [~] Introduce one authoritative movement-mutation API for non-step position/velocity changes.
- [x] Route editor/place-painter relocation through that API.
- [~] Route debug/admin teleport or impulse helpers through that API.
- [x] Reuse the same persistence, move-seq update, bridge refresh emission, and post-move publication path.
- [x] Keep mutation kind explicit so gameplay side effects can distinguish `step`, `transition`, `teleport`, and `impulse`.
- [~] Remove direct ad hoc position rewrites once equivalent mutation helpers exist.

Exit condition for Phase 5.5:

- direct position rewrites for actor/NPC gameplay-adjacent mutations are gone from callers
- callers request an authoritative mutation, and the mutation layer owns commit + publish

## Seamless Cross-Place Subplan

This is the implementation order for Phase 3.6.

1. Shared World Target Resolver

- Add one helper in `src/interface_program/main.ts` that resolves an attempted local voxel into:
  - same-place resolved target
  - connected-place resolved target
  - no connected place
- Reuse current region-voxel seam scan logic rather than duplicating it.
- Keep this helper topology-aware and legality-agnostic.

2. Shared Seam Entry Helper

- Generalize current connector entry resolution into one helper family.
- Inputs should include mover policy rather than assuming actor-only behavior.
- Resolution order:
  - preferred mapped entry voxel
  - vertical snap if allowed by policy
  - alternate entry search within connector/interior band
  - fail cleanly if no legal destination exists

3. Shared Cross-Place Commit Helper

- Build one authoritative commit helper for cross-place movement.
- It should support mover kinds:
  - actor
  - npc
  - pushable_tile
- It should own:
  - source removal
  - destination insertion
  - place persistence
  - active runtime refresh
  - movement/tile update publication
  - transition event publication when appropriate

4. Actor Migration

- Switch actor seam handling to use the shared world-target resolver and seam-entry helper before falling back to hard collision.
- Keep actor movement semantics unchanged except for improved continuity and cleaner occupancy handling.

5. Pushable Migration

- Replace pushable single-place target checks with shared world-target resolution.
- When a pushed tile targets a connected place, validate and commit through the same seam helper/commit path.
- Preserve exact mapped transfer first, but allow alternate valid entry voxel search when preferred transfer is illegal.

6. Push Fallback Ordering Cleanup

- Make failed push continue normal fallback resolution instead of terminating the blocked-step path.
- Order for walk into pushable:
  - push attempt
  - retry forward move if push succeeds
  - walk step-up legality
  - seam transfer legality
  - hard collision

7. Regression Coverage

- Add or extend focused tests for:
  - actor cross-place walk
  - actor alternate-entry connector success
  - actor connector failure when destination has no legal entry
  - pushable cross-place transfer
  - failed push falling through into legal walk step-up
  - failed push falling through into collision when no legal fallback exists

Implementation note:

- this subplan is explicitly about cleanliness and continuity first; optimization remains later

### Phase 6. Clean Inputs And UX

- [~] Simplify held-input code now that it no longer owns a second movement runtime.
- [~] Remove stale debug-era workarounds from renderer movement initiation.
- [x] Keep click-to-move and held movement behavior consistent under the same step resolver.
- [~] Remove UX codepaths that directly imply alternative stepping semantics.

### Phase 7. Optimize After Correctness

- [ ] Profile step-resolution hot spots after unification.
- [ ] Profile movement broadcasts after authoritative hookup.
- [ ] Reduce redundant place/entity reloads.
- [ ] Add culling/coalescing only after behavior is correct.

## Step-Up / Platform Tag Consolidation

This is a smaller but important correctness fix and should happen early.

### Problem

Current legality code derives step-up from a separate tag:

- `src/place_storage/movement_legality.ts:231`
- `can_step_up: has_tag_name(tags, 'STEP_UP') && !flags.pushable`

That is wrong for the desired tag model.

The same physical/surface semantics that make something a wall/platform/supporting obstacle should also determine whether it can be stepped onto.

### Goal

Remove `STEP_UP` as a separate movement-only semantic.

Instead, derive step-up from canonical physical/surface semantics shared with:

- blocking
- support
- wall/platform meaning
- climbability

### Target Direction

Extend `src/shared/physics_tags.ts` beyond raw flags like:

- `occupies`
- `container`
- `gravity`
- `pushable`

Add or derive canonical movement-surface semantics, for example:

- `blocks_body`
- `supports_weight`
- `step_up_surface`
- `climb_surface`

The exact naming can be refined later, but the key architectural rule is:

- step-up is derived from canonical surface semantics
- not from a separate `STEP_UP` escape-hatch tag

Additional rule:

- if a wall/platform/support surface is represented in the physics model, movement must infer step-up from that same representation
- do not add another movement-only tag to replace `STEP_UP`

### Early Task

- [x] Audit current authored tags/tiles/structures using `STEP_UP`.
- [x] Determine which canonical tag combination should imply step-up.
- [x] Replace direct `STEP_UP` checks in legality with derived surface semantics.
- [~] Verify common walls/platforms still behave correctly.
- [x] Delete or retire `STEP_UP`-specific branching for represented platform/wall behavior once replacement semantics exist.

## Integration Targets

These areas must agree by the end of unification:

- `src/interface_program/main.ts`
- `src/shared/movement_engine.ts`
- `src/mono_ui/modules/place_module.ts`
- `src/npc_ai/movement_loop.ts`
- `src/canvas_app/app_state.ts`
- `src/travel/movement.ts`
- `src/place_storage/movement_legality.ts`
- `src/shared/physics_tags.ts`
- `src/action_system/sense_broadcast.ts`
- awareness/witness runtime modules

These targets must converge on the same architecture, not merely interoperate loosely.

## Migration Rules

- Prefer extracting pure helpers over preserving dual runtimes.
- Do not move optimization ahead of authority cleanup.
- Keep step semantics deterministic while refactoring.
- Keep successful-step side effects sourced from only one authoritative point.
- Keep existing action-pipeline movement verb semantics compatible where practical.
- When a mechanic remains represented in the game, do not keep two owners for it.
- Remove obsolete runtime code as part of the migration phase that replaces it.
- If deletion is temporarily unsafe, isolate the code behind a clearly temporary shim and schedule explicit removal.
- Do not broaden scope into new movement design unless required to remove a live ownership conflict.
- Prefer introducing one narrow authoritative commit helper over adding several new abstractions at once.
- Treat stale-seeming legacy modules as guilty until traced: verify whether they are live before spending time refactoring them.

## Anti-Distraction Notes

To keep implementation focused:

- do not redesign pathfinding during runtime unification unless a specific path planner is directly causing dual authority
- do not redesign turn economy during runtime unification
- do not try to solve every physics-tag cleanup before authority cleanup lands
- do not preserve renderer-side movement code for sentimentality; if it still owns gameplay outcomes, migrate or remove it
- do not treat editor/debug mutation support as a reason to delay gameplay authority cleanup; route those mutations through the new authoritative mutation path after the authority boundary is clear
- do not spend large amounts of time on `src/npc_ai/movement_loop.ts` until Phase 0 confirms it is part of the live runtime you are replacing
- do not fork seam logic by mover type; extend shared seam helpers with mover policies instead

## Testing Strategy (Planned, Not Yet Final)

Testing will be refined after the runtime ownership cleanup is agreed.

Expected coverage areas:

- held-input walk uses the same step resolver as click-to-move
- NPC wandering uses the same step resolver as player walking
- successful movement step emits movement broadcast once
- movement awareness updates on step perception
- movement awareness drops when out of range and not detected this cycle
- seam transition still works under unified runtime
- valid cross-place movement resolves before hard `out_of_bounds`
- connector click when far away no longer uses renderer stepping
- connector click when adjacent no longer depends on separate coarse local travel semantics
- actor connector entry blocked cases resolve through alternate-entry search or fail cleanly
- pushable tiles can cross seams through the shared transfer framework
- incline/step-up still works under canonical surface semantics
- walls/platforms no longer rely on separate `STEP_UP`
- no alternate runtime can move the same entity without going through the authoritative step resolver
- teleport/reposition mutations use the same authoritative refresh/sync path as stepped movement
- renderer movement perception emission no longer changes gameplay awareness state

Testing policy during migration:

- each migration phase should add tests for the newly centralized authority boundary
- cleanup should be verified by proving the old codepath no longer changes gameplay state

## Open Questions For Refinement

- Should shared movement engine survive as a pure helper/shim, or should all meaningful movement APIs migrate directly into the interface runtime?
- Which current legality branches in `interface_program/main.ts` should be extracted first into shared pure helpers?
- What exact canonical tag combination should imply `step_up_surface`?
- Which movement-side effects belong in the core authoritative step path vs optional subscribers?
- Which mutation kinds should publish awareness/perception events, and which should only publish refresh/sync events?

These questions must not block Phases 1 through 3.5.

Default implementation guidance if unanswered:

- keep legality extraction minimal
- keep side effects in the authoritative runtime first
- publish refresh/sync for all mutation kinds
- publish awareness/perception only for mutation kinds that represent observable gameplay movement

Questions that are intentionally no longer open:

- Should held input and click-to-move use the same step resolver? Yes.
- Should movement awareness depend on communication specifically? No.
- Should we preserve two live movement runtimes long-term? No.

## Immediate Next Planning Work

- [x] Trace the exact held-input path from renderer input to authoritative step resolution.
- [x] Trace the exact click-to-move path from click target to authoritative step resolution.
- [x] Trace the exact NPC wandering path from goal selection to authoritative step resolution.
- [x] Trace the exact connector interaction path from click -> approach -> transition -> refresh.
- [~] Trace all remaining direct position mutation helpers and classify them as `step`, `transition`, `teleport`, or `impulse`.
- [x] Identify the best single authoritative hook for movement broadcasts inside `interface_program/main.ts`.
- [x] Write a follow-up subplan for step-up/platform tag consolidation once the canonical surface model is chosen.
- [~] Produce a removal matrix listing which movement-engine responsibilities are:
  - kept in server runtime
  - extracted as pure helpers
  - deleted

Recommended implementation order after this planning pass:

1. Phase 0 inventory with explicit mutator matrix
2. Phase 1 authority declaration and freeze on legacy runtime changes
3. Phase 2 intent/goal submission cleanup
4. Phase 3 authoritative movement perception + awareness hookup
5. Phase 3.5 connector/travel unification
6. Phase 3.6 seamless cross-place movement
7. Phase 5 shared-engine retirement
8. Phase 5.5 authoritative mutation API for teleport/reposition/impulse
9. Phase 4 and step-up cleanup where still needed
10. Phase 6 UX cleanup
11. Phase 7 optimization

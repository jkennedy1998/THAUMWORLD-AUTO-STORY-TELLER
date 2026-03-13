# Unified Movement System Design (Breath + Acceleration + Integer Velocity)

Date: 2026-03-13

## Intent

Specify the target movement + physics model for THAUMWORLD using:

- a single canonical global time unit: **breath**
- discrete 1-tile cardinal grid steps (3D)
- **MOVE as acceleration** (not immediate translation)
- a 3D integer **velocity vector** on entities
- simple, pluggable **gravity** and **friction/drag**
- deterministic per-breath resolution (debuggable; replayable)

This is a design goal document (not current implementation).

## Relationship To Existing Movement Plans

This design is compatible with the repo's single-axis step invariant (see `docs/plans/2026_03_11_movement_unification_plan.md`):

- One physics breath produces at most **one** step for an entity.
- A step changes exactly one axis group: `(dx,dy,0)` or `(0,0,dz)`.

This design is intentionally about *free time* simulation and the physics substrate that turn-based events can reuse.

## Core Concepts

### Grid + Step

- World is a 3D voxel/tile grid with integer coordinates `(x,y,z)`.
- All movement is discrete and cardinal:
  - XY step: `(±1,0,0)` or `(0,±1,0)`
  - Z step: `(0,0,±1)`
- No diagonal XY.
- No same-step combined `(x/y)` + `z`.

### Breath

- Breath is a global, monotonically increasing integer tick `B`.
- In **free time**, simulation advances exactly one breath at a time.
- In **timed events** (turn-based), an entity's turn may advance a local number of breaths for that entity using the same rules.

### Velocity Vector (Stored Per Entity)

- Each physics-simulated entity stores `v = (vx, vy, vz)` as 3D integers.
- `v` represents the entity's current momentum/velocity intent.
- `v == (0,0,0)` means no movement step is produced by velocity that breath.

Facing note:

- "Facing" is derived from the latest intent and other game systems (presentation/interaction), not from physics step selection.
- Some 3D-form-specific rules may consult facing, but the default grid physics resolver operates on `(vx,vy,vz)` and legality only.

### MOVE Action = Acceleration

- The action `MOVE` modifies velocity; it does not directly translate the entity.
- `MOVE` adds `+1` or `-1` to exactly one component of `v`.
- `MOVE` applies acceleration toward the current input direction and may reduce opposing velocity ("braking"):
  - If `vx` is positive and input is `-x`, applying `MOVE(-x)` reduces `vx` by 1 toward 0.
  - If input continues after reaching 0, subsequent MOVE applications will reverse direction (e.g. `vx` becomes negative).

Modality note:

- Which axis/components MOVE is allowed to affect depends on movement modality (walk/climb/fly/swim) and subtypes (e.g. incline/jump).

Important: character-sheet "movement speed" is treated as an **acceleration budget** (how many MOVE accelerations can be applied in a time window), not a cap on how far velocity can carry.

Terminology note (recommended):

- In free time, treat these as per-breath acceleration rates, e.g. `walk_accel_per_breath`, `climb_accel_per_breath`, `swim_accel_per_breath`, `fly_accel_per_breath`.
- In turn-based events, "movement speed" is typically consumed as a per-turn step allowance (tiles per turn), and the engine can simulate the equivalent number of breaths for that entity during the turn.

## Time Modes

### Free Time (Breath-Driven)

- Every breath, loaded entities with time-based tags ("breathing") advance.
- Actors/NPCs may enqueue/execute actions that cost breaths.
- Physics then resolves at most 1 step per physics-simulated entity.

Free-time movement rate rule:

- An actor/NPC may apply at most its modality-specific MOVE accelerations per breath.
  Example: a character with `walk_accel_per_breath = 4` can change its velocity 4 times as fast as one with `walk_accel_per_breath = 2` over the same number of breaths.

Input throttle clarification:

- Input/intent evaluation happens every breath for loaded actors/NPCs.
- "Throttle" means MOVE (acceleration) application is rate-limited by an acceleration budget; it does not mean the entity "skips" breaths.
- Intent is not queued: only the latest current intent is used when spending MOVE budget (last intent wins).

MOVE overspend (debt) model:

- Some movement verbs may spend more than 1 MOVE unit on a single breath (e.g. `move.walk.incline` spends 2 walk MOVE units on the initiating breath).
- If an entity spends more MOVE units than it had available for a modality on that breath, it incurs `move_debt[modality] += overspent_units`.
- While `move_debt[modality] > 0`, the entity skips movement input/MOVE spending for that modality for that breath, then decrements `move_debt[modality]` by 1.
  - Physics still runs normally every breath; debt only throttles movement input/acceleration.
  - Movement budget may still accumulate while in debt; debt only suppresses spending.
  - Intent/facing still updates from the latest input while in debt; only MOVE spending/acceleration is suppressed.

### Timed Events (Turn-Based)

- Each active actor/NPC gets a turn.
- During a turn, the actor/NPC may:
  - spend actions/partial actions
  - consume its movement allowance (e.g. "walk 6 tiles")

Turn-based movement uses the same substrate:

- movement allowance is realized as repeated MOVE accelerations and/or repeated physics breaths simulated during the turn slice.
- the same legality, collision, gravity, and friction rules apply.

Accounting note:

- Multi-unit movement verbs consume multiple units of per-turn movement allowance as well (e.g. incline counts as 2 movement inputs).

Turn-based consistency target:

- The same step legality and collision outcomes apply in both modes.
- The difference between modes is scheduling/accounting (turn budget vs breath pacing), not physics rules.

## Breathing System

### Breathing Metatag

- Any tag that requires time progression is marked with metatag `breathing`.
- New tag: `ALIVE` has metatag `breathing`.
- All actors and NPCs have the `ALIVE` tag.

### Who Receives Breath (Free Time)

Loaded scope:

- Loaded places: breath advances tiles/items/entities in that place that are cached as needing breath.
- Loaded actors/NPCs: breath advances the entity and any cached carried items that need breath.

Caches exist to avoid scanning all tiles/items each breath.

Initial eligibility rules (explicit):

- Actors: receive breath when loaded.
- NPCs: receive breath when loaded.
- Loose items: receive breath when present in a loaded place.
- Carried/contained items: receive breath only if the container owner is loaded and the item is cached as breathing.
- Tiles: only tiles explicitly participating in tile-physics/time systems receive breath (see Tile Physics below).

## Place/Entity Data Needed

Minimum per physics-simulated entity:

- `position: (x,y,z)` (stance origin / canonical grid position)
- `velocity: (vx,vy,vz)` integer
- `weight: int` (plan to add to actors/NPCs/tiles; items already have weight)
- `tags` (e.g. `SLIPPERY`, `ALIVE`, etc.)
- `last_breath_processed: int` for catch-up (offline aging)

Weight note:

- Today, items have weight; actors/NPCs may derive effective weight from inventories but still need their own base weight field for gravity semantics.
- Nothing needs negative/zero weight initially, but the model permits it.

## Per-Breath Pipeline (Free Time)

For each global breath `B`, in each loaded place:

Deterministic ordering:

- Within a place, process phases in a stable order.
- In the action phase, process actors/NPCs in a stable order (e.g. by entity id). Each intent/legality check sees the authoritative current state, including any earlier actions applied this breath.
- In the physics phase, process physics-simulated entities in a stable order (e.g. by entity id), using the authoritative current state at the time of each step attempt.

1) Action phase (actors/NPCs)
   - Evaluate player/NPC intent every breath (direction/modality/desired movement).
   - Intent evaluation may consult step legality to choose a movement verb/subtype (e.g. `move.walk` vs `move.walk.incline`), but it must not trigger collision or modify occupancy.
   - Single source of truth: all legality checks use the same `is_legal_step(...)` helper against authoritative current occupancy/state.
   - Intent-phase legality is advisory; physics-phase legality is final. If the world changes between intent and physics, physics resolves normally.
   - Collision is only produced during physics when no legal step can be produced.
   - Apply breath-costing actions/partial actions.
   - Apply immediate effects that modify state, including MOVE (acceleration) updates to velocity.
   - MOVE rate limiting: each modality provides an acceleration budget per breath; spend that budget to apply MOVE one or more times.
   - Only the latest intent is used when spending budget (do not queue older intents).

2) Physics phase (per physics-simulated entity)
   - Apply gravity acceleration (place-level gravity).
   - Resolve at most one 1-tile step from velocity using the axis resolver.
   - Apply friction/drag (pluggable).

3) Other breathing tags
   - growth, decay, timers, etc.

Note: friction is applied as part of the standard pipeline even when collision resolution cancels velocity components (0 stays 0).

## Gravity (Simple Acceleration)

Gravity is place-level:

- If the place has `GRAVITY` enabled, gravity applies to relevant entities/items in that place.

Tile semantics:

- Gravity affecting entities/items is not driven by a tile tag.
- Tiles do not "fall"; tile updates are handled by explicit tile-physics systems.

Simple rule (initial):

- if `weight > 0`: `vz -= 1` per breath
- if `weight == 0`: no change
- if `weight < 0`: `vz += 1` per breath

Future: magnitude brackets may increase acceleration beyond 1.

## Friction / Drag (Pluggable)

Friction/drag is a function invoked during physics to decide whether velocity components decay.

Initial simplified behavior:

- Velocity decay is per-axis and integer:
  - `vx -= sign(vx)` when x-decay applies
  - `vy -= sign(vy)` when y-decay applies
  - `vz -= sign(vz)` when z-decay applies

When decay applies:

- Default: apply decay to the axis that produced a successful step.
- `SLIPPERY` on the destination tile OR mover disables decay for that step (or selectively disables, by axis).

If `moved_axis = none`:

- Apply no friction decay for that breath.

Friction/drag must be a distinct method so it can later incorporate:

- airborne vs grounded rules
- liquids
- different materials/tiles
- entity traits/items

## Velocity -> Step Resolution

### High-Level Rule

During physics, if `v != (0,0,0)`:

- Choose exactly one axis to attempt a 1-tile step.
- Prefer the axis with the highest absolute magnitude.
- When tied, use a deterministic rotating priority based on `(entityId, B)`.
- Attempt the first legal step among tied axes based on that rotated priority.

Resolver behavior:

- The resolver deterministically tries candidate axes until it finds a legal 1-tile step.
- Only if **no** legal step exists for any non-zero axis component does a collision event occur for that breath.

Resolver requirement:

- If the preferred axis step is illegal, the resolver must deterministically try alternate axes (first among tied max-magnitude axes, then among any remaining non-zero axes) before declaring collision.

### Deterministic Rotating Priority

Tie-breaking must be deterministic, not random.

Example concept:

- Base axis order: `[x, y, z]`
- Rotate by `r = (hash(entityId) + B) % 3`
- Try axes in that rotated order, but only among those tied for max magnitude.

This yields "noise" (variety) but remains replayable/debuggable.

### Pseudocode (Conceptual)

```txt
physics_step(entity, place, B):
  apply_gravity(entity, place)

  if v == (0,0,0):
    apply_friction(entity, place, moved_axis = none, B)
    return

  mags = { x: abs(vx), y: abs(vy), z: abs(vz) }
  maxMag = max(mags where > 0)
  tiedAxes = [axes where mags[axis] == maxMag]

  axisOrder = rotate([x,y,z], (hash(entityId) + B) % 3)
  for axis in axisOrder:
    if axis not in tiedAxes: continue
    step = unit_step_for(axis, sign(v[axis]))
    if is_legal_step(entity, place, step):
      apply_step(entity, step)
      apply_friction(entity, place, moved_axis = axis, B)
      return

  // No legal axis among the tied axes; optionally try non-tied axes too.
  // This design chooses: try all non-zero axes (still deterministic) before declaring collision.
  for axis in axisOrder:
    if mags[axis] == 0: continue
    step = unit_step_for(axis, sign(v[axis]))
    if is_legal_step(entity, place, step):
      apply_step(entity, step)
      apply_friction(entity, place, moved_axis = axis, B)
      return

  // No legal step exists for any non-zero axis component this breath.
  resolve_collision(entity, place, blocked_axes = [axes where mags[axis] > 0])
  apply_friction(entity, place, moved_axis = none, B)
```

Collision resolution (conceptual): if no legal step exists this breath, cancel the axis components that were attempting movement by setting `v[axis] = 0` for each `axis` in `blocked_axes`.

## Legality, Occupancy, and Collision

### Step Legality

`is_legal_step(...)` must consult the unified movement legality system (voxel occupancy + support + mode).

This design doc does not redefine collision/support; it depends on the shared legality rules in:

- `docs/plans/2026_03_11_movement_unification_plan.md`

### Collision Resolution (Initial)

Collision is only produced during the physics phase, and only when no legal 1-tile step can be produced for the entity that breath. Input/intent alone never causes collision.

Initial rule (stuck collision, axis-local effects):

- If no legal step exists for any non-zero axis component, cancel the mover's non-zero velocity components (set `vx`, `vy`, and/or `vz` to 0 as applicable).
- Blockers are not modified in the initial model (no momentum transfer/pushing yet).

Example: if `vx = +5` (being pushed right), pressing left into a wall does not trigger collision; collision only occurs if the physics step attempt is actually blocked (no legal axis can resolve).

Later: momentum transfer, bounce, damage, pushing, etc.

## Tile Physics (Breathing Tiles)

Tiles may receive breath only if they participate in explicit tile-physics/time systems.

Initial convention:

- A tile tag like `GRAVITY` (tile-level) indicates the tile participates in tile-physics processing.
- This is separate from place-level gravity that accelerates entities/items.

This separation keeps "gravity as a force" off of items/tiles as tags, while still allowing tiles to opt into tile simulation.

## Movement-Related Verbs / Helpers

### move.walk.incline (Incline Acceleration)

`move.walk.incline` is a subtype of walking chosen during the action/intent phase when the user is pressing into an XY direction that is not directly traversable at the current z, but a 2-step incline path exists.

Cost + pacing:

- Initiating incline spends 2 walk MOVE units on the initiating breath (one for vertical, one for forward).
- Physics still performs at most 1 step per breath. Incline therefore resolves over time (typically "up/down this breath" then "forward next breath").
- If the 2 units are not available, incline may still be initiated by overspending, which creates `move_debt[walk]` via the overspend model.

Incline selection (action/intent phase):

- Given desired forward XY direction `d`, if `is_legal_step(forward d at current z)` is false, determine why:
  - If forward is blocked/occupied (a wall/solid tile), test incline-up:
    - `is_legal_step(z+1)` and `is_legal_step(forward d at z+1)`
  - If forward is void/unsupported (a ledge/gap), test incline-down:
    - `is_legal_step(z-1)` and `is_legal_step(forward d at z-1)`

Incline-up and incline-down are treated as mutually exclusive by construction: the system chooses which test to run based on whether the forward step failed due to blocking vs support/void.

Incline execution:

- On the initiating breath, apply both velocity updates:
  - vertical: `vz += +1` for incline-up, or `vz += -1` for incline-down
  - forward: add `+1` to the XY velocity component for the input direction `d` ("forward" == input direction):
    - if `d = +x`: `vx += 1`
    - if `d = -x`: `vx -= 1`
    - if `d = +y`: `vy += 1`
    - if `d = -y`: `vy -= 1`

Then allow the normal velocity resolver to produce exactly one step for the breath:

- If forward at the current z is illegal (the condition that triggered incline), the resolver will not be able to step forward this breath and will deterministically attempt alternate axes.
- If the vertical step is legal, the resolver will typically step vertically this breath.
- On later breaths, the remaining forward component can resolve as a forward step at the new z (assuming it remains legal).

Notes:

- Incline does not override the physics resolver's 1-step-per-breath rule; it only adds velocity components.
- Incline does not force axis selection. If other velocity components have higher magnitude, the resolver may choose to step on those instead.
- If the vertical step becomes illegal at execution time (world changed mid-breath), the resolver will fall back to any other legal axis step (or collide if none exist).

If the forward destination becomes blocked after stepping up:

- the forward component may fail to resolve; the resolver will fall back to any other legal axis step (or collide if none exist).

### walk.jump (Placeholder)

If the tile directly above is free, apply:

- `vz += 3`

If the entity hits a ceiling during subsequent breaths, upward steps will be illegal; the resolver falls back to normal velocity resolution. A collision event only occurs if no legal step exists at all.

## Multiple Entities / Ordering

Initial model is server-authoritative, sequential processing.

- All results must be deterministic given the same ordered inputs and breath index.
- When ordering matters (two movers competing), define a stable order (e.g. by entity id) within a place per breath.

Collision expectation (initial):

- The system does not attempt simultaneous proposal/commit resolution yet.
- Most collisions are expected to come from step-time legality failures (mid-breath world changes, stepping into occupied/blocked space), not from true simultaneity.

This avoids simultaneous resolution complexity for now.

## Offline Catch-Up (Aging)

Any breathing entity stores `last_breath_processed`.

When an entity/place becomes active again:

- compute `delta = B_current - last_breath_processed`
- advance by `delta` breaths using the same pipeline

This prevents unloaded places from becoming permanent stasis.

## Non-Goals (Initial)

- Continuous physics (sub-breath integration)
- Momentum transfer between entities
- Complex fluid dynamics
- Perfect simultaneity
- Advanced constraints like joints/ropes

## Open Questions / Refinement Targets

- Exact scope of "physics-simulated tiles" vs place-level gravity processing.
- Whether to preempt vertical when unsupported (platformer-like) or allow velocity magnitude to decide.
- Exact definition of MOVE acceleration budgets in free time vs in-turn spending.

## Appendix: Acceleration Budget (Conceptual)

This is a conceptual scheduling model for "throttle" in free time.

- Each entity tracks `move_budget[modality]`.
- Each entity also tracks `move_debt[modality]` for free-time overspend throttling.
- Each breath, `move_budget[modality] += accel_rate[modality]`.
- Applying one `MOVE` costs `1` budget and adds `+/-1` to one velocity component.
- On a breath, apply MOVE while budget remains and while the latest intent requests it, subject to verb-specific caps.

Notes:

- If `accel_rate` is an integer (e.g. 4), this reduces to "up to 4 MOVE applications per breath".
- If `accel_rate` is fractional (future), represent budget in fixed-point; the same "last intent wins" rule applies.
- Some movement verbs require multiple MOVE units to initiate (e.g. `move.walk.incline` spends 2 walk MOVE units on its initiating breath) while still respecting the 1-step-per-breath physics rule.

Deterministic accounting order (recommended):

- At the start of the entity's movement-input processing for a breath:
  - Increment `move_budget[modality]` by `accel_rate[modality]`.
  - If `move_debt[modality] > 0`, decrement it by 1 and skip MOVE spending for that modality on this breath.
- When spending MOVE units for a modality, subtract from `move_budget[modality]`.
- If spending causes `move_budget[modality]` to go below 0, compute `overspent_units = -move_budget[modality]`, add `overspent_units` to `move_debt[modality]`, and clamp `move_budget[modality]` back to 0.

This keeps budgets non-negative while still allowing multi-unit verbs in free time by converting overspend into future skipped movement-input breaths.

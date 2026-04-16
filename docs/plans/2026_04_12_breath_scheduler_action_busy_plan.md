# Breath Scheduler And Action Busy Plan

Date: 2026-04-12

## Intent

Re-center THAUMWORLD movement and action timing around one stoppable canonical breath scheduler.

This plan replaces the current visible-player fast-path split with a simpler model:

- renderer collects input state only
- server consumes input only when an entity is allowed to start a new action
- action start happens before physics on the same breath
- physics advances only on canonical breaths
- pause remains exact because all cooldowns and followthrough are breath-based

This is not just a movement-feel tuning pass. It is a runtime ownership correction plan.

## Relationship To Existing Plans

This plan builds on and updates:

- `docs/plans/2026_03_10_realtime_movement_plan.md`
- `docs/plans/2026_03_11_movement_unification_plan.md`
- `docs/plans/2026_03_13_unified_movement_system_design.md`
- `docs/plans/2026_03_13_unified_movement_system_implementation_plan.md`
- `docs/plans/2026_03_23_action_pipeline_refinement_plan.md`
- `docs/plans/2026_04_04_movement_runtime_unification_plan.md`

Source-of-truth update:

- `2026_04_04_movement_runtime_unification_plan.md` remains the source of truth for removing duplicate movement runtime ownership.
- This document becomes the source of truth for breath scheduling, input consumption timing, busy/cooldown semantics, and movement-vs-physics ordering.

If there is a conflict between older movement timing notes and this document, follow this document.

## Problem Statement

Current live behavior has drifted away from the intended THAUMWORLD timing model.

Observed architectural problems:

- visible controlled movement can advance through input-driven entity-only pulses
- visible full simulation and gravity have been split onto slower cadences than player movement
- first press and held movement do not share the same authoritative timing path
- gravity can feel slower than walking because actor movement and world gravity are not advancing under one simple rule
- input arrival is participating in movement advancement when it should only update input state

This breaks the design goal that the scheduler can be stopped at any time and the world state remains exact.

## Core Decisions

### 1. One canonical breath host

There is one authoritative host for simulation advancement per place/timed-event context.

- no input-driven authoritative movement pulses
- no special visible-player partial simulation path
- no separate movement-vs-gravity cadence for controlled actors

Renderer input may update server-side input state immediately, but it must not cause movement authority to run outside the canonical scheduler.

### 2. Input state is separate from action opportunity

Renderer and server are intentionally decoupled.

Renderer responsibility:

- track key/button state
- send held/queued input state updates
- render feedback

Server responsibility:

- store latest input state per entity
- decide when that entity is allowed to consume a new input
- start actions only on authoritative breaths
- run physics only on authoritative breaths

Input is observed continuously but consumed discretely.

### 3. One general busy cooldown per entity

Each actor/NPC gets one general action gate, not separate cooldown systems per verb family.

Recommended authoritative fields:

- `next_input_breath`
- `busy_kind`

Meaning:

- if `current_breath < next_input_breath`, the entity is busy and may not start a new input/action
- if `current_breath >= next_input_breath`, the entity may consume one new input/action on that breath if rules allow it

Cooldown duration still depends on the action that started.

Examples:

- walk uses walk-speed-derived cooldown
- fly uses fly-speed-derived cooldown
- incline followthrough can occupy multiple breaths
- `USE`, `INSPECT`, `COMMUNICATE` use `1 breath` for now, but the system must support longer durations from day one

### 4. Action start happens before physics on the same breath

This is the central timing rule.

When an entity is eligible to consume input on a breath:

1. read current held/queued input
2. choose one action to start
3. if the action can start successfully, apply its immediate impulse/state change now
4. set busy state from that successful action
5. run physics afterward on the same breath

This allows tight inputs to land on the exact breath they become available.

Corollary:

- a movement action can begin and fully resolve on that same breath
- residual motion/followthrough only remains when the action or physics state actually requires it

### 5. Successful-start semantics

Cooldown is applied only when an action successfully starts.

Movement start rule:

- movement successfully starts if it successfully produces an impulse or transient movement state
- movement does not need to produce net displacement on that same breath to count as a successful start

Non-movement start rule:

- a non-movement action successfully starts if it is valid enough to execute, broadcast, and produce world effects
- an unfavorable roll result still counts as a successful start if the action executed normally
- out-of-range failures, invalid target failures, and engine-technical rejections do not count as successful starts

Blocked movement rule:

- blocked movement does not set cooldown
- blocked movement may be retried on later legal action-consumption opportunities
- do not preserve complex blocker-specific retry suppression unless the simplified scheduler proves it necessary later

Action priority rule:

- non-movement actions are checked before movement actions during action selection for a breath

### 6. Physics and action gating are different questions

An entity may be unable to start a new action and still require physics.

Examples:

- falling while busy
- incline followthrough while busy
- residual vertical motion while busy

Busy blocks action start. Busy does not automatically block physics.

### 7. Timed-event turns gate breath exposure

Timed-event behavior is stricter than free roam.

Rules agreed for this plan:

- timed events control which entities receive authoritative breaths
- an entity only processes action start and physics on breaths actually granted to it by initiative/timed-event scheduling
- unresolved motion only advances on those granted breaths
- it is valid for an entity to remain airborne or mid-followthrough between granted breaths
- actors with higher-than-baseline speed may receive additional physics breaths during their turn window in battle
- this may make very fast actors move slightly faster in timed events than baseline actors, which is acceptable
- entities outside the timed event may later receive world-sim breaths separately, but that is not the primary concern of this plan

This means timed events use the same action/busy model, but initiative controls per-entity breath exposure rather than letting unrestricted place physics run for everyone.

## Target Runtime Model

### A. Input layer

Input endpoints become state storage only.

- held directional input updates latest movement intent
- explicit actions may be queued into the entity's general action queue
- no endpoint directly advances movement or physics

Important rule:

- server accepts input updates at any time
- server consumes them only on the next eligible authoritative breath for that entity

### B. Action gate layer

Each processed entity answers two questions each breath:

1. is this entity allowed to start actions in the current rules context?
2. is this entity currently free rather than busy?

Only if both are true may the server read and consume the current input/action state.

General queue direction:

- use one general queued-action system rather than a special queue only for non-movement verbs
- the queue should be capable of representing player-issued actions, click-to-move generated direction/action steps, NPC-planned actions, and future authored sequences
- held movement intent remains a live input source, but queued actions may take priority when present and legal
- actors and NPCs should use the same underlying planner/action-queue model

Immediate-vs-queued rule:

- the runtime should support both immediate actions and queued actions
- a new live player input may override that player's queued action flow
- the same helper shape should support multi-step gameplay like incline/step-up continuation, `walk to -> use`, and future NPC-authored action chains

Recommended conceptual helpers:

```ts
function is_entity_allowed_to_start_action(slot: number, entity_ref: string, state: PlaceBreathState): boolean;
function is_entity_busy(runtime: EntityActionRuntime, breath_index: number): boolean;
function try_start_entity_action(...): StartedAction | null;
```

### C. Physics layer

Physics runs after action start on the same breath.

Physics should process only entities that need it.

Examples:

- unsupported
- moving vertically
- carrying residual movement impulse
- in incline/jump/followthrough transient state

Physics remains discrete and breath-based.

Gravity rule for now:

- gravity may apply an impulse once per canonical breath when relevant
- this is intentionally in line with walking-scale timing rather than a separate faster or slower gravity clock

### D. Resolver rule

Per entity, per breath:

- at most one new action start
- then physics resolution
- physics may resolve at most one movement step for now

Timed-event speed note:

- extra breaths granted to high-speed entities in timed events are extra physics breaths, not extra input-consumption breaths

This preserves determinism and pause safety.

## Action Source Priority And Cancellation

When an entity is eligible to start one new action on a breath, action sources should be considered in this priority order:

1. legal queued non-movement action
2. live non-movement input/action request
3. legal queued movement action
4. live held movement input
5. advisory path-derived direction

This preserves the rule that non-movement actions win over movement when both are legal on the same input-read breath.

Player override rule:

- for player-controlled entities, new live input may override queued actions
- this override should exist for responsiveness and must not require clearing the entire action system

First-pass override policy:

- live player input clears queued movement actions for that player
- live player input does not automatically clear queued non-movement actions unless a later explicit rule invalidates them

### Cancellation rules

- live keyboard movement input cancels click-to-move path following
- click-to-move path remains advisory only and must never become a second movement runtime
- queued actions and intents may persist across timed-event end back into free roam
- if an encounter ends while an entity was going to keep walking, it should continue walking under free-roam scheduling

### Queue and path behavior

- pathfinding should remain advisory and each legal movement-read breath should derive the next desired direction fresh from the current path
- do not pre-convert the whole path into authoritative movement execution
- queued actions may fail and remain meaningful planning nodes for future chained behavior
- the queue should be able to support chains like `move closer -> equip item -> throw item`
- `INSPECT` and `COMMUNICATE` should route through this same scheduler-owned action system via the action pipeline rather than bypassing it

First-pass queue policy:

- use simple FIFO queue order first
- queued actions remain in order by default rather than being automatically reordered

### Queue failure behavior

- queued actions may fail on a given breath without invalidating the overall planning direction
- failed actions that are out of range, blocked by state, or otherwise currently invalid should be allowed to fail visibly without consuming cooldown
- this behavior is intentional because future planners may insert prerequisite actions later rather than discarding the original intent
- if a queued action cannot be processed successfully within 3 turns, it should fail out
- for current planning purposes, 1 turn = 6 ticks, so queued action timeout is 18 ticks unless a later explicit rule changes it

First-pass blocking rule:

- an invalid queued action stays at the front of the queue while it remains within the timeout window
- later queued actions do not automatically skip past it or reorder around it in the first pass

### Interruption rule

- movement continuation states such as incline followthrough are not unbreakable scripts
- if a new legal movement action is selected on a later eligible input breath, it may interrupt the next intended continuation
- in practice, pressing a direction while airborne should become the next desired step, but only when input is legally read again

## Canonical Per-Breath Order

Within the canonical scheduler, the intended order is:

1. advance authoritative breath index
2. collect entities scheduled for this breath
3. for each scheduled entity, check action-start eligibility
4. if eligible, check queued non-movement or higher-priority actions first
5. if no higher-priority action starts, evaluate queued movement/path actions and then live movement input
6. if an action starts successfully, apply immediate impulse/state change and set busy cooldown
7. run physics for scheduled entities that need physics
8. resolve movement/gravity/collision/followthrough results
9. run slower maintenance phases that are due
10. persist and emit outputs

Important invariant:

- input consumption is before physics
- movement authority still only exists inside the scheduler

## Shared Breath Ownership

The canonical breath substrate should own more than locomotion.

It should also own:

- NPC reasoning
- planning cadence
- slower world-maintenance phases
- action cooldown progression
- followthrough progression

These systems may run at different due frequencies, but they must still be owned by the same stoppable breath substrate so pause/resume semantics remain exact.

Important rule:

- no wall-clock-only reasoning or AI cadence should remain authoritative once this migration is complete

## Busy/Cooldown Semantics

### General rule

One general busy gate controls whether an entity may start a new action.

Suggested runtime fields:

```ts
type EntityActionRuntime = {
  next_input_breath: number;
  busy_kind: string | null;
  queued_actions?: any[];
};
```

### Duration model

Duration derives from action type and actor capability.

Examples:

- `move.walk`: `breaths_per_walk_step(entity, mode)`
- `move.fly`: `breaths_per_fly_step(entity, mode)`
- `move.walk.incline_up`: fixed 2 breaths initially
- `communicate`: 1 breath initially
- `inspect`: 1 breath initially
- `use`: 1 breath initially

### Start-only consumption

Cooldown is applied only when an action successfully starts.

That means:

- blocked movement does not set cooldown
- impossible or rejected actions do not set cooldown
- successful starts do set cooldown even if later physics followthrough spans multiple breaths

### Followthrough note

Some actions, especially movement transitions like inclines, may create transient followthrough that keeps physics active across additional breaths while the entity is busy.

That is expected and should be represented explicitly rather than hidden in a second scheduler.

Important modeling note:

- `busy_kind` is not a replacement for movement transient state
- richer transient state for incline/followthrough should be preserved explicitly
- queued actions and transient followthrough may coexist, but followthrough is still authoritative movement state rather than just a future wish

## Free Roam Vs Timed Event

### Free roam

- all active loaded entities may be considered by the place scheduler
- action start eligibility depends on busy state and local rules
- physics may run for any entity that needs it

### Timed event

- initiative controls which entities receive breaths and how many they receive during the turn window
- baseline turn behavior is six physics/action breaths distributed according to movement permission and speed rules
- unresolved motion only advances on those granted breaths
- actors with greater-than-baseline speed may receive additional breaths in timed events
- extra breaths for high-speed entities are physics-only breaths unless a later explicit rule says otherwise
- the same general busy/cooldown model still applies when an entity does receive its scheduled breaths
- timed-event rules gate breath exposure first, then busy gates action starts inside that processing

This keeps turn logic orthogonal to the action/physics model.

### Transition back to free roam

When a timed event ends:

- timed-event breath exposure ends
- free-roam breath scheduling becomes authoritative again
- entities return to free-roam processing under the same underlying breath-owned action and physics model

The transition should not invent a second catch-up runtime. It should be a handoff between scheduling regimes that share the same underlying simulation semantics.

## Mapping To Current Runtime

Primary live file:

- `src/interface_program/main.ts`

Current runtime pieces that need to change:

### Remove as authoritative movement paths

- `run_entity_only_visible_place_pulse(...)`
- `run_timed_event_entity_pulse(...)`
- input-triggered movement advancement for visible actors
- separate visible full/gravity cadence logic as movement authority

These are the main causes of the current split-brain timing behavior.

### Keep, but retarget semantically

- canonical place/timed-event breath loops
- server-side controller state storage
- movement legality and physics helpers
- diagnostics and timing traces

### Rework around busy gating

- current movement action phase should become an action-start gate rather than a visible-player responsiveness hack
- current movement speed/budget logic should be simplified or wrapped so that busy cooldown ownership is explicit
- movement input endpoint should become purely stateful
- immediate and queued action requests should both route through the same scheduler-owned action-start path

### Current field migration guidance

- `next_control_breath`: strong candidate to fold into or be replaced by `next_input_breath`
- `move_budget`: transitional pacing state that should likely be removed once the busy model is authoritative
- `move_debt`: transitional pacing state that should likely be removed with `move_budget`
- `transient_selection`: preserve and retarget; it carries movement-in-progress state needed for incline/followthrough and pause-safe resume
- `blocked_hold`: do not preserve by default; only revive a simpler retry-suppression mechanism if the cleaned scheduler proves it necessary
- timed-event movement budgets/costs: preserve as separate turn-economy state, not as locomotion cooldown state

Planning note:

- queued actions and advisory path direction should be layered on top of this runtime without creating a second movement authority path

## Implementation Strategy

Priority order:

1. remove runtime ownership violations
2. establish explicit busy/cooldown state
3. enforce action-start-before-physics ordering
4. align timed-event processing with the same model
5. then retune movement/gravity values

### Phase 1: Remove input-driven authority bypasses

- [x] inventory every place where input arrival can directly advance authoritative movement
- [x] demote `run_entity_only_visible_place_pulse(...)` from movement authority
- [x] remove visible-player-only authoritative movement advancement
- [x] make `/api/movement/intent` update state only
- [x] remove input-endpoint-triggered immediate place/entity movement pulses for `intent` and `move_to`
- [x] remove `run_timed_event_entity_pulse(...)` from live authoritative movement flow

Exit condition:

- no input endpoint can cause an authoritative movement step outside the canonical scheduler

### Phase 2: Add explicit general busy runtime

- [x] add per-entity `next_input_breath`
- [x] add per-entity `busy_kind`
- [x] define shared action-duration helpers for movement and non-movement verbs for current walk cadence wiring
- [x] introduce the first-pass general action queue shape without overbuilding authored sequencing yet
- [x] define action-source priority and cancellation rules in runtime terms for queued non-movement vs live movement and player override of queued movement
- [x] define queued-action timeout handling in breath terms (`3 turns = 18 ticks` in the current rules)
- [ ] ensure the model supports `>1 breath` durations even if non-movement actions currently use `1`

Exit condition:

- one explicit busy gate determines whether an entity may start a new action

### Phase 3: Reorder canonical breath execution

- [x] make action-start eligibility happen before physics in the canonical breath path
- [x] check non-movement verbs before movement verbs during action selection
- [x] route `INSPECT` and `COMMUNICATE` through the same scheduler-owned action-start path
- [x] ensure live keyboard movement overrides advisory path-follow on the next legal input breath
- [ ] ensure path-follow derives desired direction fresh each legal breath rather than owning movement execution
- [x] only successful action starts set busy cooldown for queued non-movement actions and blocked movement rollback in the current transitional movement runtime
- [ ] keep physics running after action start on that same breath

Exit condition:

- a tight input can start on the exact eligible breath and affect that breath's physics resolution

### Phase 4: Separate busy from physics-needed

- [x] introduce or clarify `needs_physics` checks
- [x] keep physics active for busy entities that still require it
- [x] keep gravity on the canonical breath cadence rather than a separate visible cadence
- [x] ensure incline/followthrough states continue under physics without reopening input early in the current scheduler-owned runtime

Exit condition:

- entities may be busy and still processed by physics without any special scheduler path

### Phase 5: Timed-event integration

- [x] map the same busy model onto initiative-controlled breaths for current movement and queued non-movement starts
- [x] define per-turn breath exposure rules in runtime terms so active-turn canonical breaths are granted only to the active actor's place/state in the current first pass
- [x] ensure unresolved motion only advances on breaths granted by the timed-event scheduler in the current first pass
- [ ] ensure extra high-speed breaths are treated as physics-only breaths in first pass
- [x] ensure active scheduled entities can still do action-start-before-physics on their breaths
- [x] define the handoff from timed event back to free roam without introducing hidden extra simulation paths
- [ ] verify turn-window behavior stays deterministic under pause/resume

Exit condition:

- timed-event processing uses the same action/busy model while preserving initiative ownership of breath exposure

### Phase 6: Tune and simplify

- [ ] retune walk/fly cooldown derivation against actual feel and THAUMWORLD expectations
- [ ] retune gravity impulse only after architecture is clean
- [ ] simplify or remove speed/budget logic that no longer reflects the canonical model
- [ ] keep diagnostics focused on breath eligibility, action starts, busy cooldowns, and visible resolution latency

### Phase 7: Breath-own reasoning and scheduling cleanup

- [ ] ensure NPC reasoning and planning cadence are fully breath-owned rather than wall-clock-owned
- [ ] preserve slower think/brain cadences as due-based breath work rather than special schedulers
- [ ] verify pause/resume freezes and resumes NPC reasoning exactly with movement/physics

Exit condition:

- movement, action timing, and NPC reasoning all share the same stoppable breath substrate

Exit condition:

- behavior feels correct without relying on special visible-player runtime exceptions

## Data Model Draft

Planning draft only. Names may change during implementation.

```ts
type EntityActionRuntime = {
  next_input_breath: number;
  busy_kind: string | null;
  queued_actions: Array<{
    verb: 'MOVE' | 'USE' | 'INSPECT' | 'COMMUNICATE';
    payload?: any;
    queued_at_breath?: number;
  }>;
};

type EntityInputRuntime = {
  held_move_intent: null | { dx: number; dy: number };
  input_seq: number;
  updated_at_ms: number;
};

type EntityPhysicsRuntime = {
  velocity: { vx: number; vy: number; vz: number };
  transient_selection: any | null;
  last_breath_processed: number;
};
```

Important separation:

- input runtime stores what the player is asking for
- action runtime stores whether the entity is busy, when it may start again, and what queued actions it intends to take later
- physics runtime stores actual motion/followthrough state

Queue design note:

- this queue is intended to scale toward NPC planning, authored motion sequences, and future chained interactions
- first implementation should stay minimal and not overbuild full Sims/RimWorld-style behavior on day one
- queued actions should support timeout/expiry rules in breath terms rather than wall-clock terms
- click-to-move should use this system only to provide proposed future movement directions/actions, not to create a second movement runtime

## Testing Strategy

### Primary invariants to test

- [ ] pressing movement does not directly trigger authoritative movement outside the scheduler
- [ ] first eligible movement press and held repeat use the same authoritative path
- [ ] action start happens before physics on the same breath
- [ ] blocked movement does not consume cooldown
- [ ] non-movement actions are checked before movement actions
- [ ] incline transitions can occupy multiple breaths through general busy state
- [ ] gravity remains breath-based and pause-safe
- [ ] pausing freezes cooldowns, followthrough, and physics exactly
- [ ] timed-event unresolved motion advances only on initiative-granted breaths
- [ ] timed-event high-speed entities can receive extra breaths when rules allow it
- [ ] extra timed-event breaths do not create extra input-consumption opportunities in first pass
- [ ] live keyboard movement cancels advisory path-follow
- [ ] queued actions can fail without consuming cooldown and still remain useful planning nodes
- [ ] queued actions time out in breath terms after 18 ticks if still not processable
- [ ] live player input can override queued actions without bypassing the scheduler
- [ ] NPC reasoning and planning stop and resume exactly with the breath scheduler

### Concrete manual tests

- [ ] hold a direction just before eligibility and verify movement resolves on that exact eligible breath
- [ ] hold into a blocker and verify no cooldown is consumed
- [ ] begin a 2-breath incline and verify no new input opens during followthrough
- [ ] start falling while busy and verify physics continues in free roam
- [ ] start click-to-move, then press keyboard movement and verify path-follow is canceled on the next legal input breath
- [ ] verify path-follow derives direction fresh each legal breath rather than replaying pre-baked movement steps
- [ ] queue an action that is currently invalid, verify it fails without consuming cooldown, and verify it can still remain part of a later action chain
- [ ] leave an invalid queued action unprocessable for 18 ticks and verify it fails out
- [ ] queue a movement-related action sequence, then give new live player input and verify the queue is overridden through the normal scheduler path
- [ ] verify live player input clears queued movement actions but does not automatically clear queued non-movement actions
- [ ] verify FIFO queued actions do not reorder themselves around an invalid front action during the timeout window
- [ ] pause mid-fall and resume with no wall-clock drift
- [ ] pause during incline followthrough and resume exactly
- [ ] in timed event, verify breath exposure matches initiative ownership and unresolved motion only advances on granted breaths
- [ ] in timed event, verify high-speed actors can receive extra breaths without introducing a second runtime
- [ ] in timed event, verify extra high-speed breaths do not allow extra input starts in first pass
- [ ] end a timed event and verify free-roam scheduling resumes without a hidden extra movement path
- [ ] end a timed event while an entity intended to keep walking and verify walking continues in free roam
- [ ] pause with NPCs mid-reasoning cadence and verify no reasoning advances until breaths resume
- [ ] trigger `INSPECT` and `COMMUNICATE` while movement is also available and verify they still route through the same action-start scheduler path
- [ ] verify `USE`/`INSPECT`/`COMMUNICATE` consume 1 breath now but use the same busy system

### Diagnostics to emphasize

- action-start accepted/rejected reason
- `next_input_breath`
- `busy_kind`
- whether the entity was processed for physics this breath
- whether movement resolved on the same breath as input consumption
- timed-event processing owner for the current breath
- active scheduling regime for the current breath

## Non-Goals For This Plan

- do not redesign all verbs or action economy in one pass
- do not invent a second scheduler for responsiveness
- do not preserve input-driven movement pulses for visible actors
- do not tune gravity first and hope architecture problems disappear
- do not rely on wall-clock cooldowns

## Immediate Build Order

1. strip out input-driven authoritative movement advancement
2. make movement intent endpoint state-only
3. add explicit general busy cooldown state
4. reorder canonical breath execution to consume input before physics
5. make blocked movement non-consuming
6. wire timed-event processing to the same model
7. retune walk/fly/gravity values only after the above is stable

## Notes For Refinement

Questions still worth refining during implementation:

- whether current movement budget/debt code should be simplified into a more explicit cooldown model or temporarily adapted under the new gate
- whether free-roam physics should scan all loaded entities each breath or maintain an explicit `needs_physics` set
- what the first minimal queued-action policy should be before expanding toward richer NPC/authored sequencing

These are implementation refinement questions, not reasons to keep the current split runtime.

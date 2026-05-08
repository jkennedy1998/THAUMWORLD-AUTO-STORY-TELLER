# Timed Event Runtime Cleanup Plan

Date: 2026-05-06

## Status

- [~] in progress

## Intent

Clean up the timed-event runtime so it matches the intended THAUMWORLD timed-event structure with minimal regression and minimal legacy carry-forward.

This remains the working cleanup plan until the implementation is clean enough that a smaller maintenance doc can replace it.

## How To Use This Plan

- Keep the **Semantics Written From Dev** section stable unless design intent actually changes.
- Keep the **Current State** section updated as implementation progresses.
- Check items off only when the behavior is true in code and validated in runtime.
- Prefer deleting stale paths over preserving weak compatibility layers.
- If another doc conflicts with this plan for timed-event runtime behavior, this plan wins until it is completed or replaced.

## Semantics Written From Dev

### Timed event loop

A timed event is:

- `start -> initiative -> repeated actor turn loop -> world sim interstitial -> next round -> end`

More explicitly:

- a round is not complete until all initiative participants have taken their turn
- after that, world sim runs last for that round
- world sim advances exactly **6 breaths**
- then the next round begins

### Turn and round definitions

- a **turn** is when one character can take actions and movement
- a **round** is all active initiative actors taking one turn each, plus the 6-breath world sim interstitial at the end
- action and movement refresh every turn for the active character
- world sim is part of the round, not a separate unrelated scheduler lane
- turn position inside a round should be derived from the initiative-sorted `initiative_order` plus `active_actor_index`
- `current_turn` should not remain an authoritative semantic field

### Initiative

- initiative is rolled once when the timed event starts
- initiative is kept for the whole timed event
- initiative is rerolled only when a new timed event starts
- initiative is high-to-low like D&D
- actors do not lose their initiative slot when cycled
- visually they may move to the back / wait for next turn, but that is presentation, not a different authority model

### Participants

- only characters should appear in the initiative module
- objects, tiles, items, and other non-character world systems belong in world sim, not the initiative roster
- near-term participant filtering to valid characters in the active place is acceptable
- keep this area simple; do not overbuild semantic end/start logic yet
- actors already participating in the timed event must be ignored as normal responders during world sim interstitial breaths

### Turn refresh and action economy

- actions are per-character
- partial actions are real when supported by the action type
- movement is per-character
- movement fully refreshes every turn
- action and movement refresh should happen at turn start
- a full-action move can replenish movement in combat right now
- explicit `END TURN` exists only on the user's own turn and may be used early

### Shared action system

- timed events must continue using the same overall action system across combat, conversation, and exploration
- do not split those modes into separate action engines more than absolutely necessary
- shared systems like sensing, broadcasting, future perks, and generic action semantics must remain unified
- event types may differ in allowed actions or consequences, but not in the core action architecture unless truly required

### Breath semantics

- `breath` is a real canonical time unit, not an implementation accident
- world simulation should occur as its own phase at end of round for tiles/items/noncombat/breath-driven systems
- combat/timed-event participants should not take their normal initiative responses during world sim
- timed events should reuse the same canonical breath-simulation implementation used outside timed events
- timed events should not create a second competing breath-advancement truth

### Timeout behavior

- timeout behavior should do nothing authoritative
- turn progression should not be driven by turn-window expiry
- explicit end-turn and explicit runtime progression rules should drive advancement instead

### Timed event ending

- near-term timed event end can remain explicit/debug/manual
- automatic semantic ending such as "no hostiles left" is later work
- keep ending logic simple for now

## Current State

Update this section as implementation progresses.

### Repo/runtime state at plan start

- timed-event durable state currently lives primarily in `src/world_storage/store.ts`
- live progression authority has historically been split across:
  - `src/world_storage/store.ts`
  - `src/interface_program/main.ts`
  - `src/turn_manager/main.ts`
- the UI mirror/command layer lives mainly in:
  - `src/canvas_app/app_state.ts`
  - `src/mono_ui/modules/initiative_module.ts`
- `src/turn_manager/state_machine.ts` appears to describe a richer but currently unwired or stale alternate model

### Current implementation progress

- canonical timed-event turn advancement now flows through `src/timed_events/runtime.ts`
- explicit actor end-turn, NPC turn completion, forced NPC timed-event completion, and budget-exhaustion auto-end now use the same runtime advancement path
- timeout no longer marks actors done or advances turns
- `src/turn_manager/main.ts` no longer polls for `done` actors and no longer owns generic turn advancement
- debug timed-event start and normal timed-event start now share the canonical startup path
- active-turn place-breath progression has been cut out of the live code path in `src/interface_program/main.ts`
- initiative-turn countdown bookkeeping was removed from the durable timed-event path; initiative turns are intended to be frozen from a world-breath perspective
- `current_turn` has now been removed from the live timed-event durable state and from the main timed-event API/UI/runtime advancement contracts
- logs, API payloads, and UI state now mostly describe turn position using `current_round + initiative_order + active_actor_index` and a derived `turn_position_in_round`
- the world sim interstitial count is now wired to an explicit 6-breath constant instead of the stale old turn-window constant
- world sim interstitial is live as the round-end place where breath advancement should occur
- post-edit runtime validation of the breath cutover is still pending

### Confirmed remaining truth gaps

- `src/world_storage/store.ts` still contains more turn-semantic behavior than a clean durable state layer should own
- stale compatibility traces may still exist outside the main timed-event path, but the primary world-sim interstitial constant/helper naming has been cleaned up
- `src/turn_manager/main.ts` still contains significant helper behavior and needs a firmer boundary so it cannot become shadow authority again
- participant derivation is still broader and fuzzier than desired in some start paths
- initiative UI still needs standard interactive control treatment for `END TURN`
- some metadata fields such as `created_turn` / `turn_number` now carry derived actor-position meaning in live timed-event paths and should be cleaned up or renamed later
- the older `docs/specs/TIMED_EVENTS.md` used to be stale and misleading; it has now been replaced, but other older plan/docs may still contain outdated assumptions
- fresh runtime logs validating the new interstitial-only breath behavior are still needed

### Guiding cleanup stance

- prefer one canonical runtime path
- prefer one durable state owner for persistence
- prefer one semantic owner for progression
- prefer deletion over compatibility shims when practical
- keep regressions low by moving in phases and validating each phase before widening scope

## Source Of Truth / Active Code Areas

### Primary runtime areas

- `src/timed_events/runtime.ts`
- `src/world_storage/store.ts`
- `src/interface_program/main.ts`
- `src/turn_manager/main.ts`

### UI and command surfaces

- `src/canvas_app/app_state.ts`
- `src/mono_ui/modules/initiative_module.ts`
- `src/mono_ui/ux/plain_text_controls.ts`
- `src/mono_ui/ux/plain_text_interactables.ts`

### Existing docs to update or supersede later

- `docs/specs/TIMED_EVENTS.md`
- `docs/plans/2026_04_12_breath_scheduler_action_busy_plan.md`
- `docs/plans/2026_03_23_action_pipeline_refinement_plan.md`

## Non-Negotiable Invariants

- Do not preserve timeout-driven turn progression.
- Do not leave multiple progression owners active once the new path is in place.
- Do not create a second competing breath-simulation truth for timed events.
- Do not regress controlled-actor action validation during timed events.
- Do not regress the ability to manually/debug start and end a timed event while cleanup is in progress.
- Do not put world-sim-only entities into the initiative UI roster.
- Do not let the initiative UI become a hidden source of turn logic.
- Do not split action architectures by event type more than truly necessary.
- Any temporary bridge code introduced during migration must have an explicit removal checkbox in this plan.

## Target Ownership Model

### Durable state owner

`src/world_storage/store.ts` should own durable timed-event state and small atomic state mutations, not high-level orchestration.

It should persist things like:

- whether a timed event exists
- event type / event id / trigger context
- current phase
- initiative order
- active actor index
- round tracking
- per-actor action and movement budgets
- world-sim phase counters
- pending communication opportunity state that must survive process boundaries

It may still expose small helpers such as:

- spend action budget
- spend movement budget
- refresh one actor's turn budget
- mark actor left region
- persist world-sim breath counters

But the meaning of **when** those transitions happen should not live here.

### Runtime progression owner

One runtime owner should orchestrate progression.

Chosen owner:

- `src/timed_events/runtime.ts`

This runtime should own decisions such as:

- when a timed event starts in canonical form
- when initiative advances to the next actor
- when a cycle of actor turns is complete
- when world sim interstitial starts
- when world sim interstitial finalizes into the next round
- when auto-end due to true resource exhaustion is allowed

### Coordinator role

`src/interface_program/main.ts` may coordinate canonical breath advancement and explicit API requests, but it should not remain a second rules owner.

### Turn/NPC helper role

`src/turn_manager/main.ts` should eventually be limited to things like:

- trigger-based event start
- initiative roll setup if still kept there
- NPC turn execution if still kept there
- conversation queue / pending communication helpers

It should not remain a second general progression authority.

### UI role

UI should:

- render timed-event state
- expose explicit commands
- use shared interactive controls that preserve user UX colors and standards
- never own turn progression semantics locally

## Recommended Durable State Shape

Near-term clean target:

- `timed_event_active`
- `timed_event_id`
- `timed_event_type`
- `timed_event_trigger`
- `timed_event_phase`
- `current_round`
- `active_actor_index`
- `initiative_order`
- `timed_event_world_breath_index`
- `world_sim_interstitial_breaths` or a clearer renamed equivalent like `world_sim_interstitial_breaths_remaining`
- `event_region`
- `timed_effects_queue`
- `pending_communication_opportunities`

Guidance:

- prefer `current_round + initiative_order + active_actor_index` as the authoritative round/turn position model
- remove `current_turn`, or keep it only as temporary compatibility/debug data during migration
- prefer deriving active actor ref from `initiative_order + active_actor_index`
- prefer not storing multiple overlapping counters that imply different truths about turn position

## Phased Checklist

## Phase 0 - Freeze semantics and map removal targets

- [x] Cross-check this plan against current live code paths in `store.ts`, `interface_program/main.ts`, `turn_manager/main.ts`, and `initiative_module.ts`
- [x] Confirm the exact intended meanings of round and turn
- [x] Decide the fate of `current_turn`: it should no longer be authoritative; prefer removal, otherwise keep only as temporary compatibility/debug data
- [x] Identify every live caller that depends on turn-window / timeout helpers
- [x] Identify whether any live code still depends on `src/turn_manager/state_machine.ts`
  - no live `src` imports/callers were found; remaining references are doc/archive only
- [x] Mark concrete deletion or de-authorization targets before phase 1 edits begin

## Phase 1 - Remove timeout authority

Goal: timeout stops ending turns.

- [x] Disable timeout-driven `mark_actor_done(...)` behavior from the live timed-event loop
- [x] Remove or de-authorize `process_timed_event_turn_window(...)` as a progression rule
- [x] Decide whether turn-window breath fields remain as informational UI/debug state or are removed entirely
  - removed as actor-turn authority; initiative turns are now intended to be frozen from world-breath perspective
- [x] Remove runtime assumptions that a turn naturally expires after `TIMED_EVENT_TURN_WINDOW_BREATHS`
- [x] Verify that turn advancement now happens only through explicit progression rules, not expiry
- [ ] Test player turn remains active indefinitely until ended or otherwise legally advanced

## Phase 2 - Establish one progression owner

Goal: one place drives advancement.

- [x] Choose the canonical progression owner and document the choice in this file
- [x] Remove duplicate ownership split between `interface_program/main.ts` and `turn_manager/main.ts`
- [~] Ensure `world_storage/store.ts` becomes durable state + atomic mutation support, not semantic progression owner
- [x] Make explicit turn advancement flow readable end-to-end
- [x] Ensure NPC auto-processing uses the same canonical progression path rather than side paths
- [~] Remove temporary bridge code once the single-owner path is stable
  - main live bridge leftovers are naming/compat helpers around world-sim breath counters and some legacy-ish metadata fields

## Phase 3 - Clean round structure and phase semantics

Goal: the runtime model matches `initiative participants -> 6-breath world sim -> next round`.

- [x] Make round completion mean: all initiative participants have completed their turn
- [x] Keep world sim as a separate explicit phase that runs after the initiative cycle
- [ ] Ensure actors already in initiative are ignored during world sim turn-taking / breath responses
- [x] Clean up logs, APIs, and UI so round/turn semantics come from `current_round + initiative_order + active_actor_index`, not `current_turn`
  - remaining cleanup is mostly naming and legacy metadata, not primary authority
- [x] Remove active-turn place/environment breath advancement during `initiative_turn`
- [x] Remove initiative-turn countdown bookkeeping from the durable timed-event state path
- [ ] Validate in fresh runtime logs that no active-turn place breath entries occur during `initiative_turn`
- [ ] Validate in play that environment/grass remains visually frozen during `initiative_turn` and only advances during `world_sim_interstitial`
- [ ] Verify world sim interstitial advances exactly 6 breaths
- [ ] Verify initiative ordering persists across rounds without reroll
- [ ] Verify the first actor of the next round is the top initiative actor again

## Phase 4 - Clean participant ownership

Goal: initiative roster contains the right things.

- [ ] Introduce or centralize one canonical participant-selection helper for timed-event start
- [ ] Narrow debug start participant selection to valid character participants in the active place
- [ ] Keep world-sim participants conceptually separate from initiative participants
- [ ] Prevent known non-character / inert entries from appearing in the initiative UI roster
- [ ] Keep timed-event start/end criteria simple for now rather than overbuilding semantic detection
- [ ] Verify trigger-based timed-event creation follows the same participant rules or has an explicit documented exception

## Phase 5 - Clean turn resource semantics

Goal: refresh and spend rules match the intended action economy.

- [ ] Verify action refresh happens at turn start
- [ ] Verify partial-action refresh happens at turn start
- [ ] Verify movement refresh happens at turn start
- [ ] Implement or cleanly document the full-action move that replenishes movement in combat
- [ ] Verify budget exhaustion auto-end, if kept, only happens when resources are actually exhausted and never via timeout
- [ ] Verify the controlled actor cannot spend resources outside their turn

## Phase 6 - Clean UI command affordances

Goal: initiative UI becomes a clean command surface, not a misleading debug oddity.

- [ ] Replace or standardize the initiative `END TURN` affordance with the newer shared inline interactive control semantics
- [ ] Preserve user UX colors through the shared control path
- [ ] Show `END TURN` only on the controlled actor's active turn
- [ ] Keep non-active states visibly non-clickable without implying hidden toggle state
- [ ] Ensure initiative visibility behavior is intentional and easy to reason about during active timed events
- [ ] Verify the initiative module remains a render/command layer only

## Phase 7 - Remove stale model support

Goal: stop carrying alternate systems.

- [x] Delete the stale alternate `src/turn_manager/state_machine.ts` and `src/turn_manager/reactions.ts` files now that no live runtime depends on them
- [x] Reduce direct non-runtime ownership by routing world-sim interstitial finalization through `src/timed_events/runtime.ts`
- [ ] Remove dead timed-event helpers and fields that no longer belong to the final model
- [ ] Remove temporary compatibility code introduced during cleanup
- [x] Update or replace outdated timed-event docs so old behavior is not accidentally treated as authoritative
- [ ] Archive superseded plan/docs once this plan fully replaces them

## Phase 8 - Validation and regression pass

- [ ] Manual debug start works with cleaned participant filtering
- [ ] Initiative ordering is stable across multiple rounds
- [ ] Explicit `END TURN` advances correctly
- [ ] World sim runs only after all initiative actors are done
- [ ] No timeout-driven advancement occurs during long idle player turns
- [ ] NPC turns still progress through the canonical path
- [ ] Manual/debug end still works
- [ ] Fresh post-cutover timed-event logs show no active-turn breath application during `initiative_turn`
- [ ] Fresh post-cutover timed-event logs show world/interstitial breath progression only during `world_sim_interstitial`
- [ ] Latest logs show one readable progression path rather than split ownership symptoms

## Cleanup Candidates To Track During Implementation

### Likely de-authorize or remove

- [ ] semantic turn progression from `src/world_storage/store.ts`
- [ ] stale or duplicate turn-window helpers that no longer drive runtime behavior
- [ ] broad participant derivation in `/api/timed_event/debug/start`
- [x] stale alternate model support removed by deleting the unused `src/turn_manager/state_machine.ts` / `src/turn_manager/reactions.ts` files
- [~] authoritative use of `current_turn`
  - removed from live timed-event state/contracts; stale helper names and non-live alternate model files still remain

### Likely keep but simplify

- [ ] durable timed-event state in `src/world_storage/store.ts`
- [ ] UI polling / rendering path in `src/canvas_app/app_state.ts`
- [ ] initiative module as a pure render + command surface
- [ ] canonical breath advancement path shared with non-timed-event world sim

## Definition Of Done

This plan is complete only when all of the following are true:

- timed-event progression has one readable authority path
- timeout no longer ends turns
- initiative roster membership matches intended semantics
- round and world-sim cadence match the dev-written semantics above
- `current_round + initiative_order + active_actor_index` are the authoritative round/turn position model
- `current_turn` is removed or clearly non-authoritative
- timed events reuse one canonical breath-simulation truth
- action/movement refresh semantics match the intended model
- UI is a command/view layer only
- stale or duplicate timed-event runtime paths are removed rather than kept indefinitely
- updated docs clearly reflect the cleaned implementation

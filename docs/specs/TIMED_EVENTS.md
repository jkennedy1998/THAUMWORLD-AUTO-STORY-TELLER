# THAUMWORLD Timed Events

## Status

Active working spec for the current timed-event model.

This replaces older assumptions that timed events were timeout-driven, that world breath advanced during actor turns, or that turn ownership was spread across multiple authorities.

## Core Model

THAUMWORLD has two play modes:

- **freemode**
- **timed event mode**

Timed event mode is not a separate action game. It uses the same action system and the same breath-driven world simulation model, but with stricter orchestration over who may act and when.

## Timed Event Loop

A timed event follows this structure:

- `start -> initiative -> actor turns -> world sim interstitial -> next round -> ... -> end`

More explicitly:

1. A timed event starts.
2. Initiative is rolled once for all initiative participants.
3. Participants take turns in initiative order.
4. After all initiative participants have taken a turn, the round enters **world sim interstitial**.
5. World sim interstitial advances the world by **6 breaths**.
6. After those 6 breaths complete, the next round begins.
7. The event continues until it is explicitly ended or later semantic end rules say otherwise.

## Definitions

### Turn

A **turn** is when one initiative participant may take actions and movement.

During a turn:

- the active participant may spend actions
- the active participant may spend movement
- action and movement budgets refresh for that participant at turn start
- the participant may end the turn early with explicit `END TURN`
- the turn may also end automatically when that participant has truly exhausted legal resources

### Round

A **round** is:

- every active initiative participant taking one turn
- followed by one **world sim interstitial** of **6 breaths**

The round is not complete until both of those parts are done.

### World Sim Interstitial

World sim interstitial exists for things that are present in the world but are **not initiative participants**.

Examples:

- timers
- plant growth
- grass animation / breath-forward visual state
- other breath-driven world systems

Important rule:

- initiative participants do **not** get normal initiative responses during these interstitial breaths

This keeps one canonical breath-simulation implementation for both freemode and timed events while preventing initiative actors from effectively getting extra turns.

## Initiative

### Initiative order

- initiative is rolled once when the timed event starts
- initiative persists for the whole timed event
- initiative is high-to-low
- ties may be broken by dexterity, then fallback tie-break logic
- initiative is not rerolled every round

### Initiative membership

Only valid characters should appear in initiative.

Initiative should not contain:

- inert objects
- tiles
- items
- generic world systems
- other non-character world participants

Those belong to world sim interstitial, not the initiative roster.

Near-term simplicity is preferred over overbuilding this area.

## Actions

Timed events must continue using the shared action system.

Do **not** split combat actions, conversation actions, and exploration actions into isolated action engines unless absolutely necessary. They must stay on the same system so shared behavior can remain unified, including things like:

- broadcast senses
- shared costs
- future perks / modifiers
- future cross-mode action semantics

Different timed-event types may have different rules or available actions, but they should still pass through the same overall action architecture.

## Action and Movement Rules

Per turn, for the active participant:

- actions refresh at turn start
- partial actions refresh at turn start when supported
- movement refreshes at turn start
- movement and action spending are tracked per participant
- a full-action move that replenishes movement may exist where currently supported

## Breath Semantics

`breath` is a real canonical time unit.

Rules:

- actor turns do **not** advance normal place/world breath
- world breath advances during world sim interstitial
- world sim interstitial advances exactly **6 breaths per round**
- the same canonical breath simulation should be used in and out of timed events
- timed events should not create a second incompatible breath advancement implementation

## Authority Model

### Single progression owner

One authority should own timed-event progression semantics.

Current intended owner:

- `src/timed_events/runtime.ts`

That owner is responsible for transitions like:

- whose turn it is
- when a turn advances
- when initiative is complete for the round
- when world sim interstitial starts
- when the next round begins

### Durable state owner

`src/world_storage/store.ts` should be the durable state layer, not the final semantic authority.

It should persist and expose timed-event state such as:

- timed event active / inactive
- event type and id
- initiative order
- active actor index / ref
- round number
- current phase
- per-actor budgets
- world sim interstitial breath counters

It may still provide atomic mutation helpers, but the semantic orchestration should live in the runtime owner.

### Turn manager role

`src/turn_manager/main.ts` should support timed events, not compete with them.

Good responsibilities there include:

- trigger-based timed-event start
- NPC turn execution
- conversation queue bridging
- helper behavior around timed events

It should **not** remain a second general turn-progression authority.

### UI role

UI should:

- render current timed-event truth
- expose explicit commands like `END TURN`
- use standardized interactive controls
- never become a hidden turn-rules owner

## Timeout Behavior

Timeout is not turn authority.

Rules:

- turn progression should not happen because a turn window expired
- idle time does not automatically consume the actor's turn
- turn advancement should happen only through explicit progression rules

## Event Ending

Near-term rule:

- timed events may end explicitly / manually / debug-driven

Later work may add semantic ending such as:

- no valid hostiles remain
- no active participants remain
- conversation resolution conditions are met

But near-term, keep this simple.

## Implementation Notes

### Naming cleanup needed

`current_turn` is historically muddy and should no longer be treated as authoritative.

Preferred semantic model going forward:

- **round** = full initiative cycle + 6-breath world sim interstitial
- **turn** = one participant activation
- authoritative position inside the round = `initiative_order` sorted by initiative + `active_actor_index`

Preferred implementation direction:

- keep `current_round`
- keep `initiative_order`
- keep `active_actor_index`
- remove `current_turn`, or keep it only as a clearly non-authoritative debug/legacy field during migration

Logs, UI, and APIs should describe turn position from initiative order plus active actor index, not from a misleading global `current_turn` counter.

### Recommended durable state shape

A clean state model should center on:

- `timed_event_active`
- `timed_event_id`
- `timed_event_type`
- `timed_event_phase`
- `current_round`
- `initiative_order`
- `active_actor_index`
- `timed_event_world_breath_index`
- `world_sim_interstitial_breaths_remaining`
- per-entry action / partial / movement budgets

If `current_turn` remains temporarily, it should be treated as a migration-only compatibility/debug field and not as authority.

## Non-Negotiable Invariants

- one readable progression authority
- one canonical breath simulation implementation
- no timeout-driven turn advancement
- no non-character noise in initiative UI
- no hidden UI ownership of turn rules
- no unnecessary split between action systems for different timed-event types

## Current Near-Term Priorities

1. make the docs match the real intended model
2. reduce timed-event progression to one authority path
3. clean the durable state shape so it reflects round/turn truth clearly
4. keep participant selection simple and correct
5. standardize UI controls for `END TURN`
6. validate the world sim interstitial behavior in fresh runtime logs

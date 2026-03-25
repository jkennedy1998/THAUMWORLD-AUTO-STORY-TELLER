---
title: Advanced NPC Interactions - Communication and Action Scheduler
date: 2026-02-13
status: draft
scope: architecture -> implementation
---

# Advanced NPC Interactions - Communication and Action Scheduler

## Goal

Make NPCs feel alive inside a tabletop-RPG simulation by treating speech as an in-world event that:
- broadcasts to nearby listeners,
- supports direct and indirect targets,
- allows multiple responders to queue without speaking over each other,
- lets each responder re-evaluate when their turn to speak actually arrives,
- works in both free-roam and timed-event play,
- uses LLM generation as the phrasing layer rather than the full decision layer,
- removes legacy timer/side-effect reply systems as the new path becomes authoritative.

This document is the communication-side companion plan for `MOVE`, `INSPECT`, `USE`, and timed-event action ownership.
It should be read alongside `docs/plans/2026_03_23_action_pipeline_refinement_plan.md`.

## Design Goals Reaffirmed

- The player speaks into a living world, not into a chatbot.
- Speech is broadcast to those nearby and may have one or more intended targets.
- Targets are conversation participants, but nearby listeners may decide to join if the speech matters to them.
- NPCs should not respond to everything; relevance should depend on current goal, role, behavior, and relationship.
- NPCs should never be given canned phrases to say. They should be given personality, current goals, context, and prompt frameworks.
- Free-roam conversation should stay free-roam unless social contention or stakes make turn ownership necessary.
- Timed-event conversation should use the same communication model as free roam, with turn ownership only changing who is allowed to speak now.
- LLM latency is acceptable and can represent thinking time, as long as the NPC controller owns the pending speech action while waiting.

## Core Direction

- Communication is a first-class simulation event.
- Listener evaluation decides who wants to speak.
- A stable speaking queue prevents pile-on and talking over each other.
- Queue entries represent intent to speak, not pre-generated text.
- When a queued speaker reaches the front, they receive the conversation as it exists at that moment and re-decide whether and how to speak.
- LLM generation happens only after a speaker actually has the floor.
- Timed events gate speech permission; they do not create a second communication architecture.

## Canonical Owners

- Breath timing and simulation cadence
  - owner: `src/interface_program/main.ts`
- Action approval / observer broadcasting
  - owner: `src/action_system/pipeline.ts`
- Timed-event turn permission / initiative state
  - owner: `src/world_storage/store.ts`, `src/turn_manager/main.ts`, and `src/turn_manager/state_machine.ts`
- Conversation session state / queue / participant list
  - future owner: NPC/conversation-owned state such as `src/npc_ai/conversation_state.ts` (or a new communication coordinator module), with timed-event references only where needed
- Listener evaluation and social joining/leaving rules
  - owner: `src/npc_ai/witness_handler.ts` and behavior resolvers
- NPC speech decision + prompt framework assembly
  - owner: `src/npc_ai/main.ts` and `src/npc_ai/prompts.ts`

## Current Problem Statement

- Player `COMMUNICATE` already enters through the action pipeline.
- Timed-event turn ownership, NPC auto-turn processing, and world-sim interstitial flow are now substantially more stable than before.
- NPC replies still come from a legacy message-polling / side-effect response path.
- Reply ownership, witness eligibility, response dedupe, conversation state, and timed-event deferral are still spread across too many systems.
- The system currently decides too early that an NPC has "responded" before a valid speech action is actually completed.
- Timed-event communication is currently bridged through hard-rooted pending communication handling in turn code instead of a clean conversation/session architecture.
- Legacy timer behavior and older conversation/wandering coupling still leak into current behavior.

## Turn-System Baseline (Current Assumptions)

- Initiative ownership is store-backed and no longer needs to be redesigned as part of communication work.
- NPC turns are auto-processed by the turn manager.
- World simulation now has an explicit interstitial phase at end-of-round.
- Communication should plug into the existing turn lifecycle as another action family.
- Communication correctness should not depend on the current movement cadence implementation details.
- If turn internals evolve again later, communication should depend only on stable permission/action hooks, not on movement-specific timing logic.

## Target Model

### Communication Event

Each player or NPC utterance creates one canonical `CommunicationEvent` that contains:
- `speaker_ref`
- `text`
- `volume`
- `direct_target_refs`
- `place_id`
- `conversation_id`
- `breath_index`
- optional `timed_event_id`

This event is world-facing simulation data, not an NPC reply request.

Further contract decisions:
- `event_id` should be a canonical communication-event id, not merely a raw outbox message id.
- `CommunicationEvent` should be immutable once created; later systems may attach derived evaluation records, but should not rewrite the original speech payload.
- `heard_by_refs` and `eligible_speaker_refs` should be derived fields, not primary authored fields.
- A communication event is complete only after listener evaluation and any resulting queue/session updates have been recorded.

### Listener Evaluation

Each nearby actor or NPC evaluates the event and decides one of:
- ignore
- observe only
- join conversation
- queue to speak
- request interruption later if the system ever supports it
- leave conversation

This decision depends on:
- direct targeting
- whether they were directly addressed recently in this same session
- whether they heard/perceived the speech
- relationship to the speaker
- current behavior (`idle_wander`, `guard`, `shopkeep`, etc.)
- current goal / what they are doing
- whether the content is relevant to them
- whether they are already engaged in the conversation

Address recency should be breath-owned rather than wall-clock-owned.

### Conversation Session

Conversation state should track:
- participants
- current speaker
- queued speakers
- transcript so far
- rolling summary of older turns
- mode: `free` or `timed`
- active location / place context
- engagement and leave conditions

The conversation session is the shared social state, not the LLM session by itself.

Further contract decisions:
- `ConversationSession` should be keyed by `conversation_id` globally, not stored as one independent NPC-owned conversation per NPC.
- Session membership must distinguish at least: participant, observer, queued speaker, current speaker, left.
- A new speech event should either extend an existing session or create a new one through an explicit resolver function, not ad hoc caller decisions.
- `transcript_recent` is shared session truth for recent exchanges.
- `transcript_summary` is a shared neutral reduction of the conversation so far.
- `memory_factoids` are not the same as `transcript_summary`; they are per-NPC subjective remembered points derived later from the session.
- Session closure needs explicit rules for `active`, `cooling`, and `closed`, including the case where all queued speakers decline.
- Session state should stay conversation-owned, with timed-event state holding references only when needed.
- Participant/activity recency should use breath counts rather than separate wall-clock timers.
- Observers may still gain weighting from recent address recency without needing a separate observer-specific timer system.

### Speaking Queue

- Multiple responders may queue in order.
- Once queued, order stays stable.
- Queue entries store desire/reason to speak, not final generated text.
- When the front speaker gets the floor, they receive the updated conversation context and may:
  - still speak,
  - say something different than first expected,
  - decide not to speak,
  - leave the conversation.

This re-evaluation rule is mandatory.

Further contract decisions:
- Queue entries must store typed reasons to speak, not only freeform text.
- Queue admission should happen through listener evaluation or explicit follow-up requeue logic, not arbitrary direct writes.
- Queue entries should expire or be removed through explicit rules when the participant leaves, loses relevance, or declines at turn arrival.
- Queue entries should not reserve action cost ahead of time; affordability is checked again when the speaker actually gets the floor.
- Initial queue admission should use a deterministic weighted sort, then freeze order once admitted.

### LLM Role

The LLM does not decide whether the NPC gets to speak.
The simulation does that first.

The LLM is responsible for how the NPC phrases their speech after the NPC controller has determined that:
- the NPC wants to speak,
- the NPC is allowed to speak now,
- enough current context has been assembled.

Further contract decisions:
- LLM generation should happen only after turn-arrival re-evaluation passes.
- While waiting on the LLM, the NPC should be in an explicit `thinking` state owned by the communication/speech controller.
- LLM failure should not permanently mark the NPC as having responded; failure must lead to retry/decline/leave logic explicitly.

## Free Roam vs Timed Events

### Free Roam

- Use the communication event + listener evaluation + queue model.
- If only one responder meaningfully wants to speak, the conversation can remain in `free` mode.
- If multiple responders queue up, the system may still process them sequentially without escalating into a full combat-style timed event.
- Free-roam timing should be breath-owned rather than `Date.now()`-owned.

### Timed Events

- Use the same communication event and conversation session model.
- If an NPC wants to speak but it is not their turn, they queue their desire to speak.
- When their turn arrives, the system rebuilds context and re-decides.
- Speech should be emitted as a real action owned by the NPC controller on that turn.
- Speech should consume action/input resources the same way other turn actions do.
- The existing `pending_communication_opportunities` bridge is transitional and should be replaced by the conversation/session queue once the new architecture is ready.

### Escalation / De-escalation

- A conversation may stay in free mode if no contention requires hard turn ownership.
- A conversation may enter timed-event mode if multiple participants need ordered speaking rights or if broader event stakes demand it.
- A conversation may also exist inside a larger timed event such as combat.

Further contract decisions:
- Free -> timed escalation should happen when more than one speaker is queued with meaningful intent, when a broader timed event already owns the place, or when urgency/stakes explicitly demand strict turn ownership.
- Timed -> free de-escalation should happen when only one meaningful speaker remains and no larger timed event requires turn ownership.
- A conversation inside combat/exploration timed events should remain turn-owned even if social contention drops, because the parent event still owns action permission.

## Prompting Direction

This system should follow the same general spirit as `INSPECT`: structured context first, generation second.

LLM prompts should be built from:
- NPC identity and personality
- current goal / behavior / role
- relationship stance toward the speaker
- place and region context
- recent conversation transcript
- summary of older conversation turns
- selected relevant memories / journals
- social role in this turn:
  - direct reply
  - answer to question
  - interjection
  - refusal
  - farewell response
  - clarification

We should prefer prompt frameworks that shape content rather than feeding raw user text alone into the model.

## Clean-System Principles

- One canonical communication event model.
- One canonical conversation session model.
- One stable speaking queue.
- No global "already responded" state that survives independently of the communication event/session.
- No NPC should be considered to have responded until a valid speech action has actually been produced or explicitly abandoned.
- Timed-event deferral should be a delivery/permission concern, not a separate communication architecture.
- Legacy systems should be removed, not preserved indefinitely behind more shims.

## Status Legend
- not_started: `[ ]`
- implemented: `[~]`
- tested: `[x]`

## Phases (Chronological)

### Phase 0 - Preserve Working Intent, Audit Legacy Paths
- [ ] Trace every current `COMMUNICATE` entry, response path, witness path, and timed-event deferral hook
- [ ] Mark which parts become canonical, transitional, or deleted
- [ ] Identify every legacy timer-driven conversation side effect that must be removed
- [ ] Preserve current good behavior examples before refactor (direct greeting, direct question, goodbye, bystander hearing, timed-event deferral)
- [ ] Audit current hard-rooted timed communication bridge in `src/turn_manager/main.ts`
- [ ] Audit current pending communication store shape in `src/world_storage/store.ts`
- [ ] Audit any remaining interface-side turn-window assumptions that speech must not depend on

### Phase 1 - Define Canonical CommunicationEvent Contract
- [ ] Define canonical `CommunicationEvent` shape
- [ ] Define how direct targets and broadcast listeners are represented
- [ ] Include breath-owned creation metadata
- [ ] Define how communication events link to conversation sessions and timed events
- [ ] Define immutable-vs-derived fields (`speaker_ref`/`text` vs `heard_by_refs`/eligibility)
- [ ] Define canonical event completion semantics
- [ ] Define the session-extension resolver inputs used when a new speech event arrives

### Phase 2 - Define ConversationSession Contract
- [ ] Define `ConversationSession` state: participants, transcript, summary, queue, mode, location context
- [ ] Define participant states: engaged, queued, speaking, thinking, observing, left
- [ ] Define leave/close semantics (goodbye, disengage, distance, timed-event exit, death)
- [ ] Define when a new speech event extends an existing session vs creates a new one
- [ ] Define `active` vs `cooling` vs `closed`
- [ ] Define `transcript_recent` retention window and rollover into `transcript_summary`
- [ ] Define session-owned shared summary vs per-NPC remembered memory factoids
- [ ] Define observer -> participant promotion rules
- [ ] Define `last_addressed_breath`, `last_spoke_breath`, and `last_active_breath` semantics for session members
- [ ] Define breath-based decay thresholds for recent address/activity weighting

### Phase 3 - Listener Evaluation Architecture
- [ ] Define the listener evaluation result contract: ignore / observe / join / queue / leave
- [ ] Weight response desire by direct target, relevance, relationship, role, current task, and current goal
- [ ] Keep role/behavior hooks centralized and reusable
- [ ] Ensure `guard`, `idle_wander`, `shopkeep`, `follow`, and future behaviors can evaluate differently
- [ ] Define a typed `ListenerDecision` result with reason, social role, and queue-admission metadata
- [ ] Include breath-based address recency and participant recency in listener weighting

### Phase 4 - Stable Speaking Queue
- [ ] Implement stable queue ordering once speakers are queued
- [ ] Queue entries store intent-to-speak, not generated text
- [ ] Define queue priorities for initial admission only (direct target, urgency, relevance, engagement)
- [ ] Do not reorder once queued unless a future explicit interruption rule is added
- [ ] Define queue-entry expiry/removal rules
- [ ] Define what happens when a queued speaker declines at front-of-queue time
- [ ] Define the exact deterministic queue admission weighting formula and stable tie-breaks

### Phase 5 - Turn-Arrival Re-evaluation
- [ ] When a speaker reaches the front, rebuild current conversation context
- [ ] Re-evaluate whether they still want to speak
- [ ] Allow outcomes: speak / stay silent / leave / no longer relevant
- [ ] Ensure re-evaluation is required in both free-roam sequential speaking and timed-event speaking
- [ ] Define the exact `SpeechTurnContext` bundle provided at re-evaluation time
- [ ] Define whether a declined speaker may requeue later in the same session

### Phase 6 - Prompt Framework Refactor
- [ ] Treat the LLM as the phrasing layer, not the reply-ownership layer
- [ ] Refactor prompt assembly to use structured communication context similar to inspect context building
- [ ] Define speech prompt frameworks for direct replies, questions, farewells, objections, clarifications, and overheard relevant joins
- [ ] Keep scripted/template fast-paths only as optional output strategies behind the same decision contract
- [ ] Define the `GeneratedSpeechAction` contract emitted after successful generation
- [ ] Define explicit `thinking`/generation failure behavior

### Phase 7 - Timed-Event Integration
- [ ] Speech inside timed events must become a real turn-owned action
- [ ] If it is not the NPC's turn, preserve queued speak intent rather than generating immediate text
- [ ] On the NPC's turn, re-evaluate current conversation state before speaking
- [ ] Ensure speech action cost/input ownership aligns with the broader timed-event action model
- [ ] Replace the current `pending_communication_opportunities -> turn_manager replayed applied_COMMUNICATE` bridge with conversation-session-owned queued speech intent
- [ ] Keep the current initiative / world-interstitial system as-is while swapping communication ownership underneath it

### Phase 8 - Free-Roam Conversation Timing
- [ ] Replace remaining `Date.now()`-owned conversation timing with breath-aware timing where possible
- [ ] Allow low-contention conversations to proceed in free mode without forcing a timed event
- [ ] Keep free-roam conversation responsive while still sequential when multiple speakers queue up

### Phase 9 - Legacy Removal
- [ ] Remove global response dedupe patterns that are no longer valid (`responded_npcs`-style logic)
- [ ] Remove direct outbox-poll side-effect reply emission
- [ ] Remove duplicate communication ownership split across witness, NPC AI, and timed-event queues
- [ ] Collapse old wandering/timer conversation hooks that bypass the new queue/session model
- [ ] Remove turn-manager hard-rooted communication replay once queued speech actions become canonical
- [ ] Remove or shrink `pending_communication_opportunities` if conversation/session-owned queue state supersedes it

### Phase 10 - Observability + Debugging
- [ ] Add logs for communication event creation, listener evaluation, queue admission, queue order, re-evaluation result, generation start/end, and delivery
- [ ] Add debug view for active conversation sessions and queued speakers
- [ ] Add explicit logs for "wanted to speak but declined at turn arrival" cases

### Phase 11 - Verification Checklist
- [ ] Directly addressed NPC reliably answers when appropriate
- [ ] Unimportant chatter can be ignored by relevant NPCs
- [ ] Nearby NPCs may join if the content matters to them
- [ ] Multiple queued speakers do not talk over each other
- [ ] Queue order stays stable once speakers are queued
- [ ] Queued speakers re-evaluate against updated transcript/context when their turn arrives
- [ ] Timed-event NPC speech never bypasses turn ownership
- [ ] Free-roam conversation remains natural without forcing full turn mode unnecessarily
- [ ] Goodbye/disengage/leave-place cleanly end or update the conversation

---

## Notes / Working Area

### Current Architectural Mismatch

- Communication intent creation is already structured enough to stay.
- Witness logic already understands hearing, direct address, engagement, and farewells.
- The main problem is response ownership and lifecycle: too much of it lives in `src/npc_ai/main.ts` polling behavior, legacy dedupe state, and the transitional turn-manager communication bridge.

### Immediate Architecture Decisions Already Chosen

- Multiple responders may queue up in order.
- Once queued, order stays stable.
- When a speaker reaches the front, they must receive the conversation as it exists then and re-decide whether/how to speak.
- Timed events keep a fixed world-sim batch, but actor/NPC speech ownership remains part of the same communication architecture.
- LLM latency is acceptable and can function as thinking time.
- Conversation/session state should remain NPC/conversation-owned rather than expanding `world_storage` into the long-term owner of all communication state.
- Long conversations should eventually be reduced/summarized into remembered factoids by LLM-assisted memory compression, since the player only has raw history in logs and NPC memory should be selective rather than transcript-perfect.
- Initial queue admission should sort by: direct target bonus, current participant bonus, urgency/relevance score, relationship/behavior modifiers, then stable join order.
- Once a speaker is admitted to the queue, order stays frozen unless a future explicit interruption system is added.
- Observers should auto-promote to participants when they are directly addressed or when they successfully join the speaking queue; passive overhearers otherwise remain observers.
- A new communication event should extend an existing session only if it shares place/social continuity with the current session (same conversation id, same direct participants, or recent active exchange within the same local conversation cluster); otherwise it starts a new session.
- Free conversation should escalate to timed conversation when more than one meaningful speaker is queued; otherwise it stays free.
- Recent address and recent participation should decay by breath count, not by wall-clock timers.
- We should avoid introducing multiple parallel timers when breath-based recency fields can express the same logic.

### Candidate Canonical Data Shapes

#### CommunicationEvent
- `event_id`
- `speaker_ref`
- `text`
- `volume`
- `direct_target_refs`
- `heard_by_refs`
- `eligible_speaker_refs`
- `place_id`
- `conversation_id`
- `created_breath_index`
- `timed_event_id?`
- `source_action_id?`
- `status` (`created` | `evaluated` | `closed`)

#### ConversationSession
- `conversation_id`
- `mode` (`free` | `timed`)
- `participants`
- `active_participants`
- `observers`
- `queued_speakers`
- `current_speaker_ref?`
- `transcript_recent`
- `transcript_summary`
- `memory_factoids_by_participant`
- `place_id`
- `last_activity_breath`
- `status` (`active` | `cooling` | `closed`)
- `timed_event_id?`

#### ParticipantSessionState
- `participant_ref`
- `status` (`active` | `observing` | `queued` | `thinking` | `left`)
- `joined_breath`
- `last_addressed_breath`
- `last_spoke_breath`
- `last_active_breath`
- `recent_address_decay_breaths`

#### ListenerDecision
- `listener_ref`
- `disposition` (`ignore` | `observe` | `join_session` | `queue_to_speak` | `leave_session`)
- `reason`
- `social_role`
- `priority_score`
- `priority_breakdown`
- `address_recency` (`direct_now` | `direct_recent` | `participant_recent` | `not_addressed`)
- `target_refs`
- `creates_queue_entry`

#### Queue Entry
- `queue_entry_id`
- `participant_ref`
- `reason_to_speak`
- `joined_from_event_id`
- `joined_breath_index`
- `social_role` (`direct_reply` | `follow_up` | `interjection` | `farewell_response` | etc.)
- `status` (`queued` | `thinking` | `spoken` | `declined` | `expired` | `cancelled`)
- `target_refs`
- `admission_priority_score`
- `stable_order`

#### SpeechTurnContext
- `conversation_id`
- `participant_ref`
- `current_mode`
- `current_place_id`
- `current_timed_event_id?`
- `transcript_recent`
- `transcript_summary`
- `memory_factoids_for_participant`
- `participants`
- `current_speaker_ref?`
- `prior_queue_entries`

#### GeneratedSpeechAction
- `speaker_ref`
- `conversation_id`
- `response_to_event_id`
- `social_role`
- `target_refs`
- `generated_text`
- `action_cost`
- `timed_event_id?`

### Legacy Cleanup Targets

- `responded_npcs`-style dedupe that marks success before a reply is actually produced
- direct NPC reply generation as an outbox polling side effect
- wall-clock timeout ownership for core conversation state
- split reply ownership between witness handling, NPC main polling, and timed-event special cases
- turn-manager replay of communication text as a temporary bridge instead of canonical speech action ownership

### Prompting Direction To Preserve

- Continue using structured prompt builders like `src/npc_ai/prompts.ts`
- Borrow the inspect-style habit of selecting relevant context instead of dumping raw world state
- Keep memories summarized and relevance-filtered
- Give the model behavior/goal/social-role framing rather than raw text-only prompts
- Later, add LLM-assisted conversation reduction so NPC memory stores what matters in-character instead of preserving the full raw transcript forever

### Shared Summary vs Subjective Memory

- `transcript_summary` should be a shared neutral summary of what happened in the session.
- `memory_factoids_by_participant` should be per-NPC subjective remembered points derived from the session later.
- The shared summary is for queue re-evaluation and prompt context continuity.
- Subjective memory factoids are for future recall, personality filtering, and long-term world continuity.
- The player may have raw logs, but NPC memory should remain selective and in-character rather than transcript-perfect.

### Queue Admission Defaults

- Suggested first-pass weighting order:
  1. direct target bonus
  2. recent direct-address bonus
  3. already-active participant bonus
  4. urgency/relevance score from listener evaluation
  5. relationship / behavior modifier
  6. recency penalty if they just spoke
  7. stable join order tie-break
- This weighting applies only when admitting speakers into the queue; after admission, queue order freezes.

### Session Extension Defaults

- Suggested first-pass rule: extend an existing session when the new communication event shares the same place and at least one of:
  - explicit `conversation_id`
  - same direct target/speaker pair
  - existing participant overlap plus recent activity inside a short breath-owned window
- Otherwise, create a new session.

### Observer Promotion Defaults

- Passive listeners remain observers.
- Directly addressed observers should promote to participants immediately.
- Observers who choose `queue_to_speak` should promote to participants when the queue entry is admitted.
- Bystander joiners may contribute as side participants, but should not rewrite the direct-target chain by default.
- Observers may still receive a temporary weighting bonus from recent address recency, using the same breath-owned recency fields as participants.

### Escalation Defaults

- Free conversation remains free when zero or one meaningful speaker is queued.
- Free conversation escalates to timed conversation when two or more meaningful speakers are queued.
- Any larger parent timed event keeps speech turn-owned regardless of local social contention.

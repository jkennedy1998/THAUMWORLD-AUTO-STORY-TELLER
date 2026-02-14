---
title: Advanced NPC Interactions - Action Scheduler
date: 2026-02-13
status: draft
scope: architecture -> implementation
---

# Advanced NPC Interactions - Action Scheduler

## Goal
Make multi-NPC interactions feel sequential and intentional by introducing a single scheduling layer that:
- orders NPC responses deterministically (no race conditions / pile-on),
- scales beyond COMMUNICATE to other witnessed actions,
- remains consistent with the "everything is an action" model.

This plan is intentionally high-level; the phased TODO list is the source of truth.

## Status Legend
- not_started: `[ ]`
- implemented: `[~]`
- tested: `[x]`

## Phases (Chronological)

### Phase 0 - Carryover From Witness System Plan
These items were left open in `docs/archive/2026_02_07_npc_witness_reaction_system_IMPLEMENTED.md` and are tracked here going forward.

- [ ] Verify vision/LOS correctness in play (vision cones + occlusion feel right)
- [ ] Verify stealth feels real (behind-NPC positioning changes detectability)
- [ ] Verify hearing 360 behavior under pressure sense (range + walls expectations)
- [ ] Run load test with 50+ NPCs witnessing actions (no major tick/frame regressions)
- [ ] Manual perf check: debug particles + broadcasts do not tank performance
- [ ] Replace "role"-based behavior expectations with archetype/personality hooks (see `docs/plans/2026_02_12_npc_archetypes_and_interaction_phases.md`)

Carryover from Communication/Conversation plan:
- [ ] Edge case: NPC dies mid-conversation
- [ ] Edge case: player disconnects while engaged
- [ ] Edge case: multiple players talk to same NPC
- [ ] Edge case: NPC moves out of range while typing
- [ ] Edge case: sweep + fix bugs discovered during play

- [ ] Performance: cache interest scores (avoid recompute spam)
- [ ] Performance: test with 50 NPCs in one place
- [ ] Performance: multiple simultaneous conversations
- [ ] Performance: memory usage profiling
- [ ] Performance: optimize if needed

- [ ] Renderer: entities should visibly step tile-to-tile (actor/NPC glyph updates each step; render order)

### Phase 1 - Define Scheduler Contract
- [ ] Define `ActionScheduler` responsibility and boundaries (what it schedules, what it does not)
- [ ] Define scheduler inputs: `intent`, `action_result`, `witness/perception events`, `scene state`
- [ ] Define scheduler outputs: ordered `response intents` + timing metadata
- [ ] Decide storage: in-memory (interface_program) + minimal persisted scene presence (if needed)
- [ ] Define integration points (ActionPipeline stage hook + NPC_AI response generation hook)
- [ ] Use shared classifiers (no duplicates): `resolve_npc_archetype()` + `classify_interaction_phase()` from `docs/plans/2026_02_12_npc_archetypes_and_interaction_phases.md`

### Phase 2 - Conversation Scene + Reply Windows
- [ ] Define `ConversationScene` state model (participants, cursor, cooldowns, last speaker)
- [ ] Create a "reply window" per COMMUNICATE (collect eligible responders for a short beat; uses `interaction_phase`)
- [ ] Deterministic ordering for replies (target bonus, participant role, recency penalty, stable tie-break)
- [ ] Enforce sequential emission (queue; one NPC response at a time)
- [ ] Add minimal throttles (max responders per window, cooldown per NPC)

### Phase 3 - Target-Aware Speaking Rights
- [ ] Targeted COMMUNICATE: default "primary reply right" for target
- [ ] Non-targeted COMMUNICATE: allow multiple responders based on weight system
- [ ] Define "interjection" policy (higher threshold for non-target participants)
- [ ] Goodbye/close: allow orderly exit replies for current participants
- [ ] Add tests for example flows (Grenda/Mira: hello -> question -> hi Mira -> goodbye)

### Phase 4 - Generalize to Action/Turn Scheduling (Not Just COMMUNICATE)
- [ ] Rename concept from "communication scheduler" to generalized `Turn/ActionScheduler`
- [ ] Define witness-triggered follow-up actions (e.g. observe DAMAGE to NPC triggers HELP/FLEE/ALERT)
- [ ] Define action classes that can open a "response window" (COMMUNICATE, DAMAGE-to-entity, THREAT, etc.)
- [ ] Ensure mundane actions (e.g. DAMAGE to wooden target) do not automatically open a social window
- [ ] Add archetype/personality hooks to weight system for witnessed actions (via `resolve_npc_archetype()`; do not invent new tags)

### Phase 5 - Initiative Without Global Pause
- [ ] Define when to create a stable initiative order for a scene (multi-party + urgency + repeated windows)
- [ ] Ensure world simulation continues (no hard pause); initiative is ordering only
- [ ] Tie initiative into the scheduler ordering (used as a tie-breaker / baseline order)
- [ ] Define reshuffle triggers (participant joins/leaves; scene escalates)
- [ ] Add regression tests to ensure stealth/awareness does not force initiative creation

### Phase 6 - Observability + Debugging
- [ ] Log scheduler decisions (eligible responders, ordering, reasons)
- [ ] Add a debug overlay hook to show "reply queue" (optional)
- [ ] Add eval script(s) to simulate multi-party talk and validate ordering determinism

### Phase 7 - Manual Verification Checklist
- [ ] Multi-NPC conversation feels sequential (no simultaneous replies)
- [ ] Targeted speech does not cause bystander pile-on
- [ ] Untargeted speech allows natural join, but remains readable
- [ ] Witnessed violence triggers archetype-appropriate reactions (no forced chat)

---

## Notes / Working Area (Populate Later)
This section is reserved for concrete mechanics, code sketches, and data contracts.

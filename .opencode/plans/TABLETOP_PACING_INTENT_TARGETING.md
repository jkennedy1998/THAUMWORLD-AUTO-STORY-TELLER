# Tabletop Pacing, Intent, and Targeting - Design Plan
**Version:** 1.0
**Date:** February 2, 2026
**Status:** Draft (Approved Direction)

---

## Problem Statement

The current message pipeline can feel "too fast" and "self-talking" because:

1) **One user input can spawn multiple interpretations** (refinement retries, fallback variants), which then flow into rules/state/renderer and produce multiple narrations.
2) **UI targeting tokens (`@Name`) can reach the machine-text parser**, triggering parse errors and rapid retry loops.
3) **NPC responses can fire multiple times** when multiple applied messages exist for one player utterance.

This breaks tabletop pacing where a single player utterance is treated as a single action declaration with a single resolution.

---

## Desired Tabletop Behavior

### Non-timed play (default)
- One player message = one action packet.
- At most:
  - one narration output (renderer), and
  - one response per directly targeted NPC (and optionally one nearby "interruption" NPC if design calls for it).
- If unclear, the game asks for clarification and does not speculate.

### Timed events (initiative mode)
- Multiple NPC outputs are expected between player turns.
- Order matters (initiative order).
- NPCs can react to:
  - actions targeting them,
  - actions within their awareness radius (nearby),
  - actions affecting shared state (combat, alarm, etc).

---

## Core Rules (Confirmed)

1) **Mentions are UI targeting.** `@Name` is not literal text; it selects a target.
2) **No cross-region targeting.** If `@Name` doesn’t match a loaded/nearby target, warn and ask the player to choose.
3) **One intent per message.** Player can override intent with UI buttons.
4) **Action cost override.** Player can choose `FREE`, `PARTIAL`, `FULL`, `EXTENDED`.
5) **Clarify loop.** If intent/target unclear, ask the player and pause.

---

## UI Design

### Modules

1) **Log window**: narrative + NPC messages + user messages.
2) **Status window**: pipeline/system states.
3) **Controls window**:
   - Shows suggested intent (local matcher), selected overrides.
4) **Targets window**:
   - Lists nearby targets (NPCs in region, self, region).
   - Provides simple commands:
     - `@name <message>` for per-message target
     - `/target <name>` persistent target
     - `/target` clear

### One-time warning behavior
When the user sends a message with no intent hint and no override:
- Status window flashes:
  - `your message does not contain an action type hint`
- then returns to:
  - `waiting for actor response`

---

## Backend APIs

### GET /api/targets
Returns targets available to the player in their current region.

Response format:
```json
{
  "ok": true,
  "region": "Eden Crossroads",
  "targets": [
    { "ref": "actor.henry_actor", "label": "Henry", "type": "actor" },
    { "ref": "region_tile.0.0.0.0", "label": "Eden Crossroads", "type": "region" },
    { "ref": "npc.gunther", "label": "Gunther", "type": "npc" }
  ]
}
```

---

## Pipeline Design: Action Packets

### Action Packet ID
- `action_packet_id` = inbound user message id
- propagated across stages:
  - interpreted
  - brokered
  - ruling
  - applied
  - rendered
  - npc_response

### Non-timed play gating
- Only one "final" applied message is allowed to render and trigger NPC responses.
- All other applied messages for the same action packet are marked `superseded`.

### Timed event gating
- Multiple actor/NPC outputs allowed but constrained by:
  - initiative order
  - idempotency per packet (each NPC responds at most once per action packet)

---

## Clarification Workflow

When intent is unknown or required target missing:
1) emit a `hint` message that asks one question
2) do not generate alternate actions
3) user reply becomes the next action packet

Examples:
- "what are your goals?" (no target)
  - hint: "Who are you asking? Try `@gunther what are your goals?` or `/target gunther`."
- "attack" (no target)
  - hint: "Who are you attacking? Pick a target from the targets list."

---

## Metrics / Observability

Log fields to include per message:
- `action_packet_id`
- `intent_source`: inferred | user_override
- `target_source`: mention | persistent_target | none
- `clarify_requested`: boolean
- `superseded`: boolean

---

## Implementation Order (Suggested)

1) UI mention parsing (strip @Name, set target_ref)
2) Targets endpoint + Targets window
3) Intent override + action cost override
4) Verb detection tokenization + logging (done)
5) Action packet propagation + supersede behavior
6) Clarify loop

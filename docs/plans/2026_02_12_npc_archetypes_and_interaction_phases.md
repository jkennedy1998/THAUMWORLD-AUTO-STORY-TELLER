---
title: NPC Archetypes + Interaction Phases
date: 2026-02-12
status: draft
scope: architecture
---

# NPC Archetypes + Interaction Phases

## Goal
Standardize NPC interaction behavior around a single concept: `archetype`.

This provides consistent defaults for:
- witness reactions to observed events (including COMMUNICATE entering view/hearing),
- communication lifecycle (hello / mid-conversation / goodbye),
- future trade flows (inventory UI + pricing),
- and cleaner prompt conditioning for LLM-backed dialogue.

Non-goals (for now):
- implementing trade UI,
- anti-repetition logic for canned lines (defer until canned response content is validated).

## Status Legend
- not_started: `[ ]`
- implemented: `[~]`
- tested: `[x]`

## Shared Truths (Avoid Duplicate Systems)
This plan owns:
- the canonical `archetype` concept (and removing `role`),
- the archetype resolver (`resolve_npc_archetype()`),
- and COMMUNICATE phase classification (`interaction_phase`).

Other plans (notably `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`) must consume these outputs rather than defining their own parallel versions.

## Phases (Chronological)

### Phase 1 - Archetype Foundation
- [ ] Define canonical NPC `archetype` schema on character sheets
- [ ] Remove the `role` concept as a behavior selector (use `archetype` only)
- [ ] Implement `resolve_npc_archetype()` (single source; used by witness + response selection + scheduler)
- [ ] Missing archetype => log error once per NPC load + fallback to `inhabitant`
- [ ] Seed archetypes for key NPCs (Gunther, Grenda)

### Phase 2 - Interaction Phase Classification (COMMUNICATE)
- [ ] Implement a single `classify_interaction_phase()` for COMMUNICATE (`open/turn/close/trade`)
- [ ] Ensure `interaction_phase` is available to canned responses, prompting, and the ActionScheduler
- [ ] Define non-LLM phase routing hooks (e.g. future `trade` UI affordance)

### Phase 3 - Archetype-Driven Canned Defaults
- [ ] Create canned response packs keyed by `archetype_id` x `interaction_phase`
- [ ] Route greeting/hello and goodbye through canned packs first
- [ ] Defer anti-repeat suppression until after baseline content evaluation

### Phase 4 - Witness Reactions + Modes
- [ ] Add archetype + mode knobs to witness join/eavesdrop/ignore heuristics
- [ ] Define `interaction_mode` (`working/idle/traveling/sleeping/engaged`) for use in reactions and greetings

### Phase 5 - Inhabitants Travel + Scaling (Performance Architecture)
- [ ] Define what it means for `inhabitant` NPCs to move between places
- [ ] Add a scalable processing boundary (only simulate NPCs in current region + connected places)
- [ ] Define a schedule abstraction (deferred implementation, but lock the interface)

### Phase 6 - Trade Data Model (Deferred)
- [ ] Define multi-currency value bundles for items
- [ ] Define archetype valuation rules based on item tags
- [ ] Define trade delta computation + settlement contract

## Key Rules

### 1) `role` is removed
We remove `role` as an interaction behavior concept.
- The behavior selector is `archetype`.
- Missing archetype is an error; fall back to `inhabitant` so NPCs still function.

### 2) Shopkeepers sell; laborers do not
- `shopkeeper` runs a counter and is trade-capable (later).
- `laborer` does tasks in a place and does not sell items.
  - For now, `laborer` behavior is just place-local wandering.
  - Future: `laborer` schedules + task graphs.

## Data Model

### NPC sheet fields (source of truth)
Add (or standardize) a minimal archetype block on NPC character sheets:

```json
{
  "archetype": {
    "id": "shopkeeper" ,
    "mode": "working",
    "work_context": {
      "kind": "shop_counter",
      "shop_place_id": "eden_crossroads_grendas_shop"
    }
  }
}
```

Notes:
- `archetype.id` is required for consistent behavior.
- `archetype.mode` is a lightweight state hint. It is allowed to be inferred by the runtime later.
- `work_context` is optional and may be omitted for most NPCs.

### Archetype semantics (initial)
- `shopkeeper`: anchored to a shop place; can greet in a commerce-forward tone; future trade-capable.
- `laborer`: anchored to a place; performs place-local movement; future schedules.
- `inhabitant`: general population/fallback; should be allowed to travel between places over time.

### Archetype IDs (initial)
Start with a small, explicit set:
- `shopkeeper`
- `laborer`
- `inhabitant` (fallback)

## Runtime Resolution

### Archetype resolver (single source)
Implement a resolver used by witness + communication response selection:

Inputs:
- NPC sheet
- current place + tile
- current activity state if available (busy/present + goal + movement state)

Outputs:
- `archetype_id` (string)
- `interaction_mode` (working/idle/traveling/sleeping/engaged)
- optional `work_context`

Failure behavior:
- if `archetype_id` missing: emit a single-line error log containing `npc_ref`, then return `inhabitant`.

## Interaction Phases (COMMUNICATE)

The communication pipeline should classify each COMMUNICATE into an interaction phase.
This classification is used to:
- select canned/scripted responses by archetype,
- decide whether to route to LLM,
- and (later) offer non-LLM interaction affordances (e.g. Trade UI).

### Phase taxonomy
- `communicate_open` (first message that starts/joins a conversation)
- `communicate_turn` (mid-conversation)
- `communicate_close` (farewell/goodbye)
- `communicate_trade` (trade intent; not implemented yet)

How to classify:
- `communicate_close`: keyword/intent match (goodbye/bye/farewell/leave)
- `communicate_open`: conversation did not exist for npc+actor within a short window OR NPC was not a participant yet
- else: `communicate_turn`

## Inhabitants: Travel + Scaling (Concept)

### Desired behavior
`inhabitant` NPCs should be able to move between places (not just wander within one place).

### Constraint
We cannot simulate every NPC in the world at all times.

### Scaling approach (initial)
Define an "active simulation set":
- always include the player's current place
- include places within the player's current region
- optionally include places connected by explicit place graph edges (doors/roads), even if outside the region

Only NPCs in the active set get movement/schedule ticks.

### Scheduling (deferred)
We need schedules, but do not implement yet. Lock the interface shape first:
- schedule is a list of time windows -> desired place/task
- runtime picks a current intent (travel, work, idle)

## Witness Reactions (Observed Events)

Witness processing already decides join/eavesdrop/ignore.
Archetypes should bias these decisions.

Example policy knobs (not content):
- `shopkeeper` while `working`: likely to join if directly addressed; less likely to join random nearby chatter.
- `laborer`: may ignore most chatter while `working`; may eavesdrop while `idle`.
- `inhabitant`: mid propensity to eavesdrop/join depending on personality.

## Canned Responses (Archetype-driven)

We want canned/scripted responses per archetype AND per phase.

Structure:
- `archetype_id` -> `phase` -> response pack

Response pack fields (architecture, not content):
- `lines: string[]`
- `when: { mode?: string[]; requires_direct_target?: boolean; ... }`
- `next_action?: "open_trade" | "ask_clarifying" | ...` (future)

Important:
- Do not add anti-repeat suppression yet; we want to observe baseline repetition first.

## Migration Strategy

Short-term:
- Add `archetype.id` to a few key NPCs (Gunther, Grenda) to validate behavior packs.
- If missing: log error and use `inhabitant`.

Medium-term:
- Batch update NPC sheets across content.

## Acceptance Criteria (Architecture)
- Archetype is the only behavior selector for canned/scripted defaults.
- Witness decisions can reference archetype + mode.
- COMMUNICATE is classified into phases and this classification is available to response selection.
- Missing archetype logs an error and falls back to `inhabitant`.

## Trade System (Future) - Data + Feel (Defer Until Content Exists)

Trade depends on richer item tagging and place content. Define the data contract now, implement later.

### Desired feel
Target inspiration: RimWorld/Skyrim style barter with clear deltas and category preferences.

Player experience goals:
- Simple: drag items between two inventories.
- Transparent: show a running "delta" of value transfer.
- Flexible: multiple currencies supported.
- Characterful: archetype-specific valuations and restrictions.

### UI concept (not implemented)
Two inventory panes:
- Player inventory (left)
- NPC inventory (right)

Interaction:
- Drag item stacks between panes
- UI computes `delta_value` (player -> npc increases delta; npc -> player decreases delta)
- Confirm trade if delta is settled (by currency transfer and/or additional items)

### Pricing model (data)

#### Base item value
Each item has a base value expressed in a currency bundle.

Example:
```json
{
  "value": {
    "coin_copper": 20
  },
  "tags": ["food", "meat"]
}
```

#### Multi-currency bundles
Represent value as a map of currency ids to integer amounts.

Arithmetic:
- `bundle_add(a,b)` and `bundle_sub(a,b)`
- normalize display using a preferred ordering (e.g. gold/silver/copper) but keep computation exact.

#### Archetype valuation rules
NPCs value items via multipliers and allow/deny lists based on item tags.

Example rule concept:
```json
{
  "trade": {
    "accept_tags_any": ["food", "drink"],
    "reject_tags_any": ["alchemy", "weapon"],
    "tag_multipliers": {
      "food": 1.1,
      "meat": 1.2,
      "vegetable": 1.05
    },
    "default_multiplier": 0.6
  }
}
```

Meaning:
- Tavern shopkeeper pays more for food/drink, less for everything else.
- Potion shopkeeper would invert these preferences.

Pricing direction:
- Buying from NPC: NPC asks higher than base (markup).
- Selling to NPC: NPC offers lower than base (markdown).
These are also archetype-configurable and can be tag-sensitive.

#### Delta and settlement
Define delta as "what the NPC owes the player" in a currency bundle:
- Dragging a player item to NPC inventory decreases delta (NPC owes less / player owes more).
- Dragging an NPC item to player inventory increases delta.

Settlement options (future):
- Currency transfer (if both sides have currency items or wallet entries)
- Add/remove items until delta reaches zero (or within an allowed tolerance)

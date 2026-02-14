# Legacy Interpreter Pipeline Reference (Archived)

**Date:** 2026-02-13
**Status:** Archived reference

This document preserves the legacy interpreter-driven message pipeline documentation that used to live inline in the design docs.

Current build note: `interpreter_ai` is archived. Core actions are created/executed in-process via the ActionPipeline (in `interface_program`).

---

## Legacy Architecture: Stage Pipeline Handoff Points

This section describes the older interpreted_1/brokered_1/ruling_1/applied_1/rendered_1 stage pipeline.

### 1. interface_program -> interpreter_ai

**Location:** `inbox.jsonc` (written by interface, read by Breath)

**Trigger:** User submits input via HTTP or CLI

**Message Format:**
```jsonc
{
  "sender": "henry_actor",
  "content": "attack the goblin",
  "type": "user_input",
  "status": "sent"
}
```

### 2. Breath() -> interpreter_ai

**Location:** `outbox.jsonc` (written by router)

**Trigger:** Message routed to interpreter stage

**Message Format:**
```jsonc
{
  "sender": "henry_actor",
  "content": "attack the goblin",
  "stage": "interpreter_ai",
  "status": "sent"
}
```

### 3. interpreter_ai -> data_broker

**Location:** `inbox.jsonc` -> `outbox.jsonc` (via router)

**Trigger:** Interpreter generates machine text

**Message Format:**
```jsonc
{
  "sender": "interpreter_ai",
  "content": "actor.henry_actor.ATTACK(target=npc.goblin, tool=actor.henry_actor.sword)",
  "stage": "interpreted_1",
  "status": "sent",
  "meta": {
    "machine_text": "actor.henry_actor.ATTACK(...)" ,
    "original_text": "attack the goblin"
  }
}
```

### 4. data_broker -> rules_lawyer

**Location:** `outbox.jsonc`

**Trigger:** References resolved, commands parsed

**Message Format:**
```jsonc
{
  "sender": "data_broker",
  "content": "brokered data ready",
  "stage": "brokered_1",
  "status": "sent",
  "meta": {
    "commands": [...],
    "resolved": {...}
  }
}
```

### 5. rules_lawyer -> state_applier

**Location:** `outbox.jsonc`

**Trigger:** Rules applied, effects generated

**Message Format:**
```jsonc
{
  "sender": "rules_lawyer",
  "content": "rule effects ready",
  "stage": "ruling_1",
  "status": "pending_state_apply",
  "meta": {
    "events": ["actor.henry_actor.ATTACK(...)"],
    "effects": ["SYSTEM.APPLY_DAMAGE(target=npc.goblin, amount=5)"]
  }
}
```

### 6. state_applier -> renderer_ai

**Location:** `outbox.jsonc`

**Trigger:** Effects applied to game state

**Message Format:**
```jsonc
{
  "sender": "state_applier",
  "content": "state applied",
  "stage": "applied_1",
  "status": "sent",
  "meta": {
    "effects_applied": 2
  }
}
```

### 7. renderer_ai -> User Display

**Location:** `inbox.jsonc` (read by canvas app)

**Trigger:** Narrative generated

**Message Format:**
```jsonc
{
  "sender": "renderer_ai",
  "content": "You swing your sword at the goblin, dealing 5 damage!",
  "stage": "rendered_1",
  "status": "sent"
}
```

---

## Legacy Service: interpreter_ai (Archived)

**Purpose:** (Legacy) Convert natural language player input into machine-readable system commands using an LLM.

**Location:** `archive/interpreter_ai/` (not launched in `npm run dev`)

### System Prompt Key Points (Historical)

```
You are the Interpreter AI for THAUMWORLD tabletop RPG.
Convert human input into strict machine-readable system text.
Output ONLY machine text. One command per line. No prose.
Syntax: <subject>.<VERB>(key=value, ...)
Subjects are refs (actor, npc, item, tile). Verbs are UPPERCASE.
Action verbs: USE, ATTACK, HELP, DEFEND, GRAPPLE, INSPECT, COMMUNICATE, DODGE, CRAFT, SLEEP, REPAIR, MOVE, WORK, GUARD, HOLD
System verbs: SYSTEM.APPLY_TAG, SYSTEM.REMOVE_TAG, SYSTEM.ADJUST_RESOURCE, etc.
```

---

## Legacy Stages: interpreter_ai and interpreted_*

These stage labels are preserved here as reference for older logs/data.

- `interpreter_ai` (legacy stage label): natural language user input queued for interpretation
- `interpreted_*`: machine text produced for data_broker (`interpreted_1`, `interpreted_2`, ...)

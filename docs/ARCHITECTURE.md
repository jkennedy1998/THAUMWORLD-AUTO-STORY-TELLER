# THAUMWORLD AUTO STORY TELLER - System Architecture

## Overview

This system implements the THAUMWORLD tabletop RPG rules as an automated story teller. It uses a file-based message pipeline where services communicate by reading and writing JSONC files.

**Reference:** [THAUMWORLD Rules Index](https://www.thaumworld.xyz/rules-index/)

## Core Philosophy

- **Rule-based storytelling**: Every player action is parsed, validated against RPG rules, and resolved
- **Water-tight system**: Explicit contracts between services, no silent failures
- **AI-powered narration**: LLMs interpret rules and generate narrative responses
- **Sandbox environment**: Players can attempt any action; system determines outcomes

## System Architecture (ASCII Diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THAUMWORLD PIPELINE                                │
└─────────────────────────────────────────────────────────────────────────────┘

USER INPUT FLOW
===============

  Player types: "attack the goblin"
           │
           ▼
┌─────────────────────┐
│  interface_program  │  HTTP server + CLI bridge
│  (main.ts:1-1000)   │  - Accepts user input
│                     │  - Routes to inbox
└──────────┬──────────┘
           │ writes to
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│   inbox.jsonc       │     │   outbox.jsonc      │
│   (user messages)   │     │   (service outputs) │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           ▲
           │ reads                     │ writes
           ▼                           │
┌─────────────────────┐                │
│      Breath()       │  Polls every 2s│
│  (main.ts:950-1100) │                │
│  - Drains inbox     │                │
│  - Routes messages  │                │
└──────────┬──────────┘                │
           │ routes to                 │
           ▼                           │
┌─────────────────────┐                │
│   interpreter_ai    │  LLM: Natural → Machine│
│   (main.ts:1-900)   │                │
│  - Parses intent    │                │
│  - Generates        │                │
│    machine text     │                │
│    (e.g., COMMUNICATE)│              │
└──────────┬──────────┘                │
           │ writes                    │
           │ stage: interpreted_1      │
           ▼                           │
┌─────────────────────┐                │
│    data_broker      │  Resolves refs │
│   (main.ts:1-400)   │                │
│  - Parses commands  │                │
│  - Resolves         │                │
│    actor/npc/tile   │                │
│    references       │                │
│  - Creates missing  │                │
│    entities         │                │
└──────────┬──────────┘                │
           │ writes                    │
           │ stage: brokered_1         │
           ▼                           │
┌─────────────────────┐                │
│    rules_lawyer     │  Applies RPG   │
│   (main.ts:1-300)   │    rules       │
│  - Validates        │                │
│    commands         │                │
│  - Applies          │                │
│    THAUMWORLD       │                │
│    rules            │                │
│  - Generates        │                │
│    effects/events   │                │
│  - Handles dice     │                │
│    rolls            │                │
└──────────┬──────────┘                │
           │ writes                    │
           │ stage: ruling_1           │
           │ status: pending_state_apply│
           ▼                           │
┌─────────────────────┐                │
│   state_applier     │  Modifies game │
│   (main.ts:1-450)   │    state       │
│  - Applies effects  │                │
│    to actor/npc     │                │
│    files            │                │
│  - Updates health,  │                │
│    inventory,       │                │
│    position, etc.   │                │
└──────────┬──────────┘                │
           │ writes                    │
           │ stage: applied_1          │
           ▼                           │
┌─────────────────────┐                │
│    renderer_ai      │  LLM: System → │
│   (main.ts:1-300)   │    Narrative   │
│  - Converts         │                │
│    effects/events   │                │
│  - Generates        │                │
│    readable story   │                │
└──────────┬──────────┘                │
           │ writes to                 │
           │ inbox.jsonc               │
           ▼                           │
┌─────────────────────┐                │
│   Canvas Display    │  Electron app  │
│   (main.ts:1-50)    │  - Shows log   │
│                     │  - Input box   │
└─────────────────────┘                │
                                       │
NPC RESPONSE FLOW (Optional)           │
============================           │
                                       │
┌─────────────────────┐                │
│      npc_ai         │  LLM: NPC      │
│   (main.ts:1-450)   │    Personality │
│  - Detects player   │                │
│    communication    │                │
│  - Loads NPC        │                │
│    character sheet  │                │
│  - Generates        │                │
│    contextual       │                │
│    response         │                │
└──────────┬──────────┘                │
           │ writes to ────────────────┘
           │ inbox.jsonc
           ▼
```

## Data Storage Architecture

```
local_data/
├── data_slot_1/                    # Player's game instance
│   ├── actors/
│   │   ├── henry_actor.jsonc       # Player character
│   │   ├── default_actor.jsonc     # Template
│   │   └── hands.jsonc             # Body part
│   ├── npcs/
│   │   ├── shopkeep.jsonc          # NPC with personality
│   │   └── default_npc.jsonc       # Template
│   ├── items/                      # Item definitions
│   ├── world/
│   │   └── world.jsonc             # World state
│   ├── inbox.jsonc                 # Service inputs
│   ├── outbox.jsonc                # Service outputs
│   ├── log.jsonc                   # Audit trail
│   ├── status.jsonc                # Current status line
│   ├── roller_status.jsonc         # Dice roll state
│   ├── metrics/                    # Performance metrics
│   │   ├── interpreter_ai.jsonc
│   │   ├── renderer_ai.jsonc
│   │   └── npc_ai.jsonc
│   └── ai_io_logs/                 # AI prompt/response logs
│       ├── interpreter_io.jsonc
│       └── renderer_io.jsonc
└── data_slot_default/              # Templates
    ├── actors/
    ├── npcs/
    ├── items/
    ├── kind_definitions.jsonc      # Character creation
    ├── language_definitions.jsonc  # Languages
    └── perk_trees.jsonc            # Perk system
```

## Service Handoff Points

### 1. interface_program → interpreter_ai
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

### 2. Breath() → interpreter_ai
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

### 3. interpreter_ai → data_broker
**Location:** `inbox.jsonc` → `outbox.jsonc` (via router)
**Trigger:** Interpreter generates machine text
**Message Format:**
```jsonc
{
  "sender": "interpreter_ai",
  "content": "actor.henry_actor.ATTACK(target=npc.goblin, tool=actor.henry_actor.sword)",
  "stage": "interpreted_1",
  "status": "sent",
  "meta": {
    "machine_text": "actor.henry_actor.ATTACK(...)",
    "original_text": "attack the goblin"
  }
}
```

### 4. data_broker → rules_lawyer
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

### 5. rules_lawyer → state_applier
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

### 6. state_applier → renderer_ai
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

### 7. renderer_ai → User Display
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

## Key Design Patterns

### 1. File-Based Message Queue
- **Why:** Durability (survives crashes), debuggability (inspect files), simplicity
- **Trade-off:** Slower than in-memory, but acceptable for turn-based RPG

### 2. Status State Machine
```
queued → sent → processing → done
                ↓
              error
                ↓
          awaiting_roll_1 → processing → done
```

### 3. Stage-Based Routing
- Each service looks for specific `stage` patterns
- Allows multiple iterations (interpreted_1, interpreted_2, etc.)
- Clear handoff contracts

### 4. Meta Field Contracts
- `meta.machine_text`: System commands
- `meta.events`: What happened
- `meta.effects`: State changes to apply
- `meta.original_text`: User's natural language

## THAUMWORLD RPG Integration

This system implements the THAUMWORLD rules programmatically:

**Core Systems Implemented:**
- [Stats and Bonuses](https://www.thaumworld.xyz/stats-n-bonuses/)
- [Magnitude](https://www.thaumworld.xyz/magnitude/) (scaling system)
- [Dice Rolls](https://www.thaumworld.xyz/dice-rolls-n-nat/) (D20 based)
- [Character](https://www.thaumworld.xyz/character/) (MAG system)
- [Actions](https://www.thaumworld.xyz/actions/)
- [Awareness](https://www.thaumworld.xyz/awareness/) (senses system)
- [Proficiency](https://www.thaumworld.xyz/proficiency/) (21 profs)
- [Perks](https://www.thaumworld.xyz/perks/)
- [Damage](https://www.thaumworld.xyz/damage/) and [Health](https://www.thaumworld.xyz/health/)
- [Vigor](https://www.thaumworld.xyz/vigor/)
- [Tags](https://www.thaumworld.xyz/tags/) and [Conditions](https://www.thaumworld.xyz/conditions/)

**Story Teller Systems:**
- [Story Beats](https://www.thaumworld.xyz/story-beat-n-archetype/)
- [Dissonance and Harmony](https://www.thaumworld.xyz/dissonance-n-harmony/)
- [Story Flow](https://www.thaumworld.xyz/story-flow/)

## Debugging the System

### Enable Full Logging
```bash
set DEBUG_LEVEL=4
npm run dev
```

### Inspect Message Flow
```bash
# Watch outbox in real-time
tail -f local_data/data_slot_1/outbox.jsonc

# Check specific message
cat local_data/data_slot_1/log.jsonc | grep "message_id"
```

### Common Debug Commands
- `DEBUG_LEVEL=1`: Errors only
- `DEBUG_LEVEL=2`: Warnings + errors
- `DEBUG_LEVEL=3`: Service flow + info
- `DEBUG_LEVEL=4`: Full message content

## Next Steps

See:
- [SERVICES.md](./SERVICES.md) - Detailed service documentation
- [STAGES.md](./STAGES.md) - Stage definitions and transitions
- [EFFECTS.md](./EFFECTS.md) - THAUMWORLD effect system
- [examples/](./examples/) - Working code examples
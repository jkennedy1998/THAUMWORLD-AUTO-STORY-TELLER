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

## Phase 2-5 Architecture Additions

### Phase 2: Working Memory System

**New Components:**
- **Context Manager** (`src/context_manager/`)
  - `index.ts`: Working memory builder and cache
  - `relevance.ts`: Action-based filtering
  - Stores: `working_memory.jsonc`

**Integration:**
- Turn Manager builds memory on event start
- State Applier records events
- NPC AI retrieves filtered context

### Phase 3: NPC AI Enhancement

**New Components:**
- **Decision Tree** (`src/npc_ai/decision_tree.ts`)
  - Scripted responses for emergencies, combat, social
  - Priority-based matching
  
- **Template Database** (`src/npc_ai/template_db.ts`)
  - Archetype-specific responses
  - 25+ templates (shopkeeper, guard, villager, noble, innkeeper)
  
- **Action Selector** (`src/npc_ai/action_selector.ts`)
  - 15 action verbs with requirements
  - Role and personality modifiers
  
- **Sway System** (`src/npc_ai/sway_system.ts`)
  - 8 influence types (intimidation, persuasion, bribes, etc.)
  - Personality resistance/susceptibility

**Decision Flow:**
```
NPC Turn
  ↓
Get Available Actions
  ↓
Apply Sway
  ↓
Check Scripted (Priority 7-10)
  ↓
Check Templates (Priority 5-6)
  ↓
Call AI (if needed)
  ↓
Generate Response
```

### Phase 4: Conversation Memory

**New Components:**
- **Conversation Archive** (`src/conversation_manager/archive.ts`)
  - Full conversation storage
  - Participant tracking
  - Topic extraction
  - Agreement/conflict detection
  
- **Retrieval** (`src/conversation_manager/retrieval.ts`)
  - Multi-criteria search
  - Relevance scoring
  - Timeline view
  
- **Formatter** (`src/conversation_manager/formatter.ts`)
  - 60-80% token reduction
  - Greeting compression
  - Significance filtering
  
- **Summarizer** (`src/conversation_manager/summarizer.ts`)
  - AI-powered summarization
  - Importance scoring (1-10)
  - Emotional context
  
- **NPC Memory** (`src/npc_storage/memory.ts`)
  - Categorized memories (recent, important, relationship)
  - Entity indexing
  - Relationship tracking

**Storage:**
- `conversations/[id].jsonc` - Active conversations
- `conversations/conversation_archive.jsonc` - Archived
- `conversation_summaries/[id].jsonc` - Summaries
- `npc_memories/[npc_ref]_memory.jsonc` - NPC memories

### Phase 5: Turn Manager Enhancement

**New Components:**
- **State Machine** (`src/turn_manager/state_machine.ts`)
  - 7 turn phases
  - Initiative management
  - Turn timer (60s limit)
  - Held actions
  - Reaction queue
  
- **Validator** (`src/turn_manager/validator.ts`)
  - Action cost validation (FULL/PARTIAL/EXTENDED/FREE)
  - Health requirements
  - Status effects
  - Range and line-of-sight
  
- **Reactions** (`src/turn_manager/reactions.ts`)
  - 7 reaction types
  - Priority-based processing
  - Trigger conditions
  - Interrupt capabilities

**Turn Flow:**
```
INITIATIVE_ROLL
  ↓
TURN_START
  ↓
ACTION_SELECTION
  ↓
ACTION_RESOLUTION
  ↓
TURN_END (check reactions)
  ↓
EVENT_END_CHECK
  ↓
(EVENT_END or loop to TURN_START)
```

## Complete System Architecture

### All Services

**Core Pipeline:**
1. interface_program
2. interpreter_ai
3. data_broker
4. rules_lawyer
5. state_applier
6. renderer_ai

**Phase 2-5 Additions:**
7. context_manager (Working Memory)
8. turn_manager_enhanced (State Machine)
9. npc_ai_enhanced (Decision Hierarchy)
10. conversation_manager (Archive & Summarize)

**Support Services:**
- roller (Dice rolling)
- npc_ai (NPC responses)

### Complete Data Storage

```
local_data/data_slot_1/
├── actors/                 # Player characters
├── npcs/                   # NPCs with memories
├── items/                  # Item definitions
├── world/                  # World state
├── conversations/          # Conversation archives
│   ├── [id].jsonc         # Active conversations
│   └── conversation_archive.jsonc
├── conversation_summaries/ # AI summaries
├── npc_memories/          # Long-term NPC memories
├── working_memory.jsonc   # Active event context
├── inbox.jsonc            # Service inputs
├── outbox.jsonc           # Service outputs
├── log.jsonc              # Audit trail
└── metrics/               # Performance data
```

## Performance Characteristics

### Phase 3-5 Optimizations

**AI Cost Reduction:**
- Phase 3: 75% reduction via decision hierarchy
- Phase 4: 80% token reduction via formatting
- Phase 4: 95% reduction via summarization

**Response Times:**
- Scripted response: ~2ms
- Template response: ~3ms
- AI response: ~3000ms
- Action validation: ~0.5ms
- Turn phase transition: ~0.1ms

**Storage:**
- Working memory: ~5KB per event
- Conversation: ~5KB per 10 messages
- Summary: ~1KB per conversation
- NPC memory: ~10KB per NPC

## Integration Points

### Service Interconnections

```
Context Manager
  ├─ Turn Manager (builds memory on event start)
  ├─ State Applier (records events)
  └─ NPC AI (retrieves context)

Turn Manager
  ├─ State Machine (phase management)
  ├─ Validator (action validation)
  ├─ Reactions (held actions)
  └─ NPC AI (triggers NPC turns)

NPC AI
  ├─ Decision Tree (scripted responses)
  ├─ Template DB (archetype responses)
  ├─ Action Selector (available actions)
  ├─ Sway System (influence)
  ├─ Context Manager (working memory)
  ├─ Conversation Manager (archives)
  └─ NPC Memory (long-term storage)

Conversation Manager
  ├─ Archive (storage)
  ├─ Formatter (compression)
  ├─ Summarizer (AI processing)
  └─ NPC Memory (stores summaries)
```

## Error Handling & Recovery

### Graceful Degradation

**AI Service Down:**
- Scripted responses (Phase 3)
- Template database (Phase 3)
- Queue for retry

**Working Memory Failure:**
- Fall back to basic context
- Rebuild from world state

**Conversation System Failure:**
- Continue without archiving
- Log error

**Turn System Failure:**
- Fall back to legacy turn advancement
- Log error

### Recovery Mechanisms

**Auto-Retry:**
- 3 attempts for AI calls
- Exponential backoff

**State Recovery:**
- Save every 5 turns
- Restore from disk
- Rebuild corrupted data

## Monitoring & Debugging

### Metrics Collected

**Phase 3-5 Additions:**
- Decision type (scripted/template/AI)
- Action validation results
- Turn phase transitions
- Conversation statistics
- Memory usage
- Reaction triggers

### Debug Commands

**View Working Memory:**
```bash
cat local_data/data_slot_1/working_memory.jsonc
```

**View Active Conversations:**
```bash
ls local_data/data_slot_1/conversations/*.jsonc
```

**View NPC Memories:**
```bash
cat local_data/data_slot_1/npc_memories/npc_grenda_memory.jsonc
```

**View Turn State:**
```bash
# In logs
grep "TurnManager" local_data/data_slot_1/log.jsonc
```

## Version History

### Phase 1: Foundation ✅
- Message pipeline
- Basic services
- THAUMWORLD rules

### Phase 2: Working Memory ✅
- Context manager
- Relevance filtering
- Regional awareness

### Phase 3: NPC AI Enhancement ✅
- Decision hierarchy
- Template database
- Action selection
- Sway system

### Phase 4: Conversation Memory ✅
- Conversation archive
- Pre-AI formatting
- AI summarization
- NPC memory storage

### Phase 5: Turn Manager Enhancement ✅
- State machine
- Action validation
- Reaction system

### Phase 6: Integration & Documentation ✅
- Service integration
- Performance optimization
- Comprehensive documentation

## References

- [SERVICES.md](./SERVICES.md) - Detailed service documentation
- [STAGES.md](./STAGES.md) - Stage definitions and transitions
- [EFFECTS.md](./EFFECTS.md) - THAUMWORLD effect system
- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - How to extend
- [AI_PROMPTS.md](./AI_PROMPTS.md) - AI prompt patterns
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Debug guide
- [examples/](./examples/) - Working code examples
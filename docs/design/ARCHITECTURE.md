# THAUMWORLD AUTO STORY TELLER - System Architecture

## Overview

This system implements the THAUMWORLD tabletop RPG rules as an automated story teller. The current build is hybrid: core player/NPC actions run in-process via the ActionPipeline (in `interface_program`), and cross-process coordination uses a file-backed message bus (inbox/outbox JSONC).

Current build note (2026-02-13): `interpreter_ai` is archived. The `interface_program` creates action intents directly (COMMUNICATE/MOVE/USE/INSPECT) and runs the ActionPipeline for validation + perception + witness reactions.

**Reference:** [THAUMWORLD Rules Index](https://www.thaumworld.xyz/rules-index/)

## Core Philosophy

- **Rule-based storytelling**: Every player action is parsed, validated against RPG rules, and resolved
- **Water-tight system**: Explicit contracts between services, no silent failures
- **AI-powered narration**: LLMs interpret rules and generate narrative responses
- **Sandbox environment**: Players can attempt any action; system determines outcomes

## System Architecture (Current Build)

Player/NPC actions (COMMUNICATE/MOVE/USE/INSPECT) are created in `interface_program` and executed in-process via the ActionPipeline. The file-backed message bus remains for coordination (renderer commands, NPC movement authority, perception bridging, narration).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         THAUMWORLD (CURRENT BUILD)                            │
└─────────────────────────────────────────────────────────────────────────────┘

Player input (UI)
    │
    ▼
┌────────────────────────┐
│ interface_program       │  HTTP server + Breath loop
│ - create action intents │  (COMMUNICATE/MOVE/USE/INSPECT)
│ - run ActionPipeline    │  validate + apply + witness
└───────────┬────────────┘
            │ writes/updates
            ▼
 local_data/data_slot_1/
 - outbox.jsonc     (messages to npc_ai, renderer, renderer_ai)
 - inbox.jsonc      (messages from renderer -> backend bridges)
 - actors/, npcs/, places/, world/ ... (state files)

┌────────────────────────┐         ┌────────────────────────┐
│ npc_ai                  │         │ UI renderer (Electron) │
│ - conversation replies   │  cmds   │ - draws place/entities │
│ - movement authority     ├────────►│ - executes movement    │
└────────────────────────┘         └───────────┬────────────┘
                                               │ writes
                                               ▼
                                      inbox.jsonc
                                      - perception_event_batch
                                        (movement hearing -> witness)
```

Legacy note: `interpreter_ai` (Natural -> Machine text) is archived in this build. The older stage pipeline diagrams are historical.

## Data Storage Architecture

```
local_data/
├── data_slot_1/                    # Player's game instance
│   ├── actors/
│   ├── npcs/
│   ├── items/                      # Item definitions
│   ├── places/                     # Place definitions
│   ├── regions/                    # Region definitions
│   ├── world/                      # World state
│   ├── npc_memories/               # NPC memory files
│   ├── ephemeral/                  # Cross-process scratch state
│   ├── logs/                       # Per-service logs
│   ├── inbox.jsonc                 # Service inputs
│   ├── outbox.jsonc                # Service outputs
│   ├── outbox_backup.jsonc          # Backup snapshots
│   ├── log.jsonc                   # Audit trail
│   ├── status.jsonc                # Current status line
│   ├── roller_status.jsonc         # Dice roll state
│   ├── game_time.jsonc             # Time state
│   ├── working_memory.jsonc        # Context cache
│   ├── metrics/                    # Performance metrics
│   │   ├── interpreter_ai.jsonc
│   │   ├── renderer_ai.jsonc
│   │   └── npc_ai.jsonc
│   └── place_entity_index.jsonc    # Place contents index
└── data_slot_default/              # Templates
    ├── actors/
    ├── npcs/
    ├── items/
    ├── kind_definitions.jsonc      # Character creation
    ├── language_definitions.jsonc  # Languages
    └── perk_trees.jsonc            # Perk system
```

## Current Build Handoff Points

### 1. UI → interface_program
**Trigger:** Player submits input via UI (HTTP/IPC).
**Notes:** The current build creates action intents in `interface_program` and executes them via the ActionPipeline.

### 2. npc_ai → renderer (movement_command)
**Trigger:** NPC movement/face/status changes, plus certain UI/debug effects.
**Location:** `outbox.jsonc`
**Message Format (envelope):**
```jsonc
{
  "type": "movement_command",
  "sender": "npc_ai",
  "recipient": "renderer",
  "status": "sent",
  "created_at": "2026-02-13T12:00:00.000Z",
  "content": "{ ... MovementCommandMessage ... }"
}
```

### 3. renderer → interface_program (perception_event_batch)
**Trigger:** Renderer emits perception events back into witness processing (ex: hearing footsteps).
**Location:** `inbox.jsonc`
**Message Format (envelope):**
```jsonc
{
  "type": "perception_event_batch",
  "sender": "renderer",
  "recipient": "interface_program",
  "status": "sent",
  "created_at": "2026-02-13T12:00:00.000Z",
  "content": "{ \"type\": \"perception_event_batch\", \"events\": [ ... ] }"
}
```

For message envelope details, see `docs/contracts/message_bus.md`.

## Legacy Interpreter Pipeline (Archived)

The older interpreter-driven stage pipeline docs are archived here:

- `docs/archive/2026_02_13_legacy_interpreter_pipeline_reference.md`

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

**Processes (launched by `npm run dev`):**
1. interface_program
2. data_broker
3. rules_lawyer
4. state_applier
5. renderer_ai
6. roller
7. npc_ai
8. turn_manager
9. UI (vite + electron)

**Archived process:**
- interpreter_ai (archived; not launched)

**In-process subsystems (selected):**
- ActionPipeline (`src/action_system/`)
- Context/working memory (`src/context_manager/`, `working_memory.jsonc`)
- Conversation/presence helpers (`src/conversation_manager/`, `src/shared/conversation_presence_store.ts`)

### Complete Data Storage

```
local_data/data_slot_1/
├── actors/                  # Player characters
├── npcs/                    # NPC files
├── items/                   # Item definitions
├── places/                  # Places
├── regions/                 # Regions
├── world/                   # World state
├── npc_memories/            # NPC memories
├── ephemeral/               # Scratch state (ex: conversation presence)
├── logs/                    # Per-service logs
├── working_memory.jsonc     # Active event context
├── inbox.jsonc              # Service inputs
├── outbox.jsonc             # Service outputs
├── outbox_backup.jsonc      # Cleanup snapshots
├── log.jsonc                # Audit trail
└── metrics/                 # Performance data
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

**View Conversation Presence (cross-process):**
```bash
cat local_data/data_slot_1/ephemeral/conversation_presence.json
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
- [EFFECTS.md](../specs/EFFECTS.md) - THAUMWORLD effect system
- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - How to extend
- [AI_PROMPTS.md](./AI_PROMPTS.md) - AI prompt patterns
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Debug guide
- [examples/](./examples/) - Working code examples

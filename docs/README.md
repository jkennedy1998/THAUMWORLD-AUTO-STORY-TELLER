# THAUMWORLD AUTO STORY TELLER - Documentation

Complete documentation for the THAUMWORLD automated RPG system.

**Game Reference:** [THAUMWORLD Rules](https://www.thaumworld.xyz/)

## Quick Start for AI Agents

If you're an AI agent working on this system, start here:

1. **Read [INDEX.md](./INDEX.md)** - Master documentation index and navigation
2. **Read [ARCHITECTURE.md](./ARCHITECTURE.md)** - System overview with ASCII diagrams
3. **Read [SERVICES.md](./SERVICES.md)** - All 8 services documented
4. **Read [STAGES.md](./STAGES.md)** - Message flow and contracts
5. **See [CHANGELOG.md](./CHANGELOG.md)** - Recent changes and fixes
6. **See [examples/](./examples/)** - Working code samples

## Documentation Structure

```
docs/
├── INDEX.md                 # Master documentation index and navigation
├── CHANGELOG.md             # Recent changes and fixes
├── README.md                # This file - project overview
├── ARCHITECTURE.md          # System overview, data flow, ASCII diagrams
├── SERVICES.md              # All services: purpose, contracts, handoffs
├── STAGES.md                # Stage definitions, status transitions
├── DEVELOPER_GUIDE.md       # Complete developer guide
├── AI_AGENT_GUIDE.md        # Quick reference for AI agents
├── MACHINE_TEXT_SYNTAX.md   # Command syntax specification
├── EFFECTS.md               # THAUMWORLD RPG effect system
├── TIMED_EVENTS.md          # Timed event system
├── ERROR_HANDLING.md        # Error handling standards
├── TROUBLESHOOTING.md       # Common issues and solutions
├── AI_PROMPTS.md            # AI prompt templates
├── CLEANUP_SUMMARY.md       # Documentation cleanup record
├── examples/
│   └── README.md            # Working code examples
└── archive/
    └── README.md            # Historical phase summaries
```

## System Overview

**THAUMWORLD AUTO STORY TELLER** implements the [THAUMWORLD tabletop RPG](https://www.thaumworld.xyz/) as an automated system.

### Core Philosophy
- **Rule-based storytelling**: Every action parsed, validated, resolved
- **Water-tight system**: Explicit contracts, no silent failures
- **AI-powered narration**: LLMs interpret rules and generate narrative
- **Sandbox environment**: Players can attempt any action

### Architecture Pattern
```
File-based message pipeline with 8 services:

Player Input → Interpreter → Data Broker → Rules Lawyer → State Applier → Renderer → Display
                                    ↓
                              NPC AI (for dialogue)
```

### Technology Stack
- **Runtime:** Node.js + TypeScript
- **AI Models:** Ollama (llama3.2:latest)
- **Storage:** JSONC files
- **Frontend:** Electron + Canvas rendering
- **Process Management:** Concurrently

## Key Concepts

### Services
Independent processes that communicate via file-based messages:
- **interface_program**: HTTP/CLI bridge
- **interpreter_ai**: Natural language → Machine commands
- **data_broker**: Reference resolution
- **rules_lawyer**: THAUMWORLD RPG rule application
- **state_applier**: Game state modification
- **renderer_ai**: System → Narrative
- **npc_ai**: NPC dialogue generation
- **roller**: Dice rolling

### Stages
Processing phases in the pipeline:
- `interpreter_ai` → `interpreted_1` → `brokered_1` → `ruling_1` → `applied_1` → `rendered_1`
- Special: `npc_response`, `awaiting_roll_1`

### Status State Machine
```
queued → sent → processing → done
                ↓
          pending_state_apply (for state applier)
                ↓
          awaiting_roll_1 (for dice)
                ↓
              error
```

### Handoff Points
Each service reads from `outbox.jsonc` and writes to `inbox.jsonc` or `outbox.jsonc`:
- **interface** writes to inbox (user input)
- **interpreter** reads interpreter_ai, writes interpreted_1
- **data_broker** reads interpreted_*, writes brokered_1
- **rules_lawyer** reads brokered_*, writes ruling_1 (pending_state_apply)
- **state_applier** reads ruling_* (pending_state_apply), writes applied_1
- **renderer** reads applied_*, writes rendered_1
- **npc_ai** reads applied_* (COMMUNICATE), writes npc_response

## THAUMWORLD RPG Integration

This system implements these THAUMWORLD rules:

**Core Systems:**
- [Stats and Bonuses](https://www.thaumworld.xyz/stats-n-bonuses/)
- [Magnitude](https://www.thaumworld.xyz/magnitude/) (scaling)
- [Dice Rolls](https://www.thaumworld.xyz/dice-rolls-n-nat/) (D20)
- [Character](https://www.thaumworld.xyz/character/) (MAG system)
- [Actions](https://www.thaumworld.xyz/actions/)
- [Awareness](https://www.thaumworld.xyz/awareness/)
- [Proficiency](https://www.thaumworld.xyz/proficiency/) (21 profs)
- [Perks](https://www.thaumworld.xyz/perks/)
- [Damage](https://www.thaumworld.xyz/damage/) & [Health](https://www.thaumworld.xyz/health/)
- [Tags](https://www.thaumworld.xyz/tags/) & [Conditions](https://www.thaumworld.xyz/conditions/)

**Story Systems:**
- [Story Beats](https://www.thaumworld.xyz/story-beat-n-archetype/)
- [Dissonance & Harmony](https://www.thaumworld.xyz/dissonance-n-harmony/)
- [Story Flow](https://www.thaumworld.xyz/story-flow/)

## Development

### Running the System
```bash
# Development mode with all services
npm run dev

# Individual service
npm run npc_ai_dev
npm run interpreter_dev
# etc.
```

### Debug Levels
```bash
# Level 1: Errors only
set DEBUG_LEVEL=1 && npm run dev

# Level 2: Warnings + errors
set DEBUG_LEVEL=2 && npm run dev

# Level 3: Service flow (recommended)
set DEBUG_LEVEL=3 && npm run dev

# Level 4: Full message content
set DEBUG_LEVEL=4 && npm run dev
```

### Project Structure
```
src/
├── interface_program/     # HTTP bridge, CLI, Breath coordinator
├── interpreter_ai/        # Natural language → Machine text
├── data_broker/          # Reference resolution
├── rules_lawyer/         # RPG rule application
│   └── effects.ts        # Effect implementations
├── state_applier/        # Game state modification
│   └── apply.ts          # Effect application
├── renderer_ai/          # System → Narrative
├── npc_ai/               # NPC dialogue generation
├── npc_storage/          # NPC file operations
├── actor_storage/        # Actor file operations
├── engine/               # Core infrastructure
│   ├── types.ts          # TypeScript types
│   ├── message.ts        # Message operations
│   ├── router.ts         # Message routing
│   ├── log_store.ts      # Log file operations
│   ├── inbox_store.ts    # Inbox operations
│   ├── outbox_store.ts   # Outbox operations
│   └── metrics_store.ts  # Performance metrics
├── system_syntax/        # Machine text parser
├── reference_resolver/   # Reference resolution
├── shared/               # Shared utilities
│   └── debug.ts          # Debug logging
└── canvas_app/           # Frontend display

docs/                     # Documentation
local_data/
├── data_slot_1/          # Player's game instance
│   ├── actors/           # Actor files
│   ├── npcs/             # NPC files
│   ├── items/            # Item files
│   ├── world/            # World state
│   ├── inbox.jsonc       # Service inputs
│   ├── outbox.jsonc      # Service outputs
│   └── log.jsonc         # Audit trail
└── data_slot_default/    # Templates
```

## Common Tasks

### Adding a New Effect
See [examples/README.md](./examples/README.md) Example 1

### Creating a New Service
See [examples/README.md](./examples/README.md) Example 2

### Modifying NPC Behavior
See [examples/README.md](./examples/README.md) Example 3

### Debugging Message Flow
```bash
# Watch outbox in real-time
tail -f local_data/data_slot_1/outbox.jsonc

# Find stuck messages
grep "pending_state_apply" local_data/data_slot_1/outbox.jsonc

# Check service logs with DEBUG_LEVEL=3
```

## Contributing

### Documentation Standards
- Use ASCII diagrams for architecture
- Include code examples for all concepts
- Reference THAUMWORLD rules where applicable
- Document handoff points explicitly

### Code Standards
- Follow existing service patterns
- Use TypeScript types from `engine/types.ts`
- Add debug logging at DEBUG_LEVEL >= 3
- Handle errors with `debug_error()`

## Support

**For AI Agents:**
- Read [AI_AGENT_GUIDE.md](./AI_AGENT_GUIDE.md) (TODO)
- Check [examples/](./examples/) for patterns
- Use DEBUG_LEVEL=4 to see full message flow

**For Humans:**
- Visit [THAUMWORLD](https://www.thaumworld.xyz/) for game rules
- Check docs/ for system documentation
- Run with DEBUG_LEVEL=3 to see service activity

## License

ISC License - See package.json

## Credits

Created by J. Kennedy
THAUMWORLD tabletop RPG system
AI-assisted development
# THAUMWORLD Services Documentation

Complete reference for all system services, their contracts, and handoff points.

**System Reference:** [THAUMWORLD Rules](https://www.thaumworld.xyz/rules-index/)

## Service Overview

| Service | Purpose | Poll Rate | Input Stage | Output Stage |
|---------|---------|-----------|-------------|--------------|
| interface_program | HTTP bridge + CLI | 2000ms (Breath) | HTTP/CLI | inbox |
| interpreter_ai | Natural → Machine | 800ms | interpreter_ai | interpreted_1 |
| data_broker | Resolve references | 800ms | interpreted_* | brokered_1 |
| rules_lawyer | Apply RPG rules | 800ms | brokered_* | ruling_1 (pending_state_apply) |
| state_applier | Modify game state | 800ms | ruling_* (pending_state_apply) | applied_1 |
| renderer_ai | System → Narrative | 800ms | applied_* | rendered_1 |
| npc_ai | NPC responses | 800ms | applied_* (COMMUNICATE) | npc_response |
| roller | Dice rolling | 800ms | awaiting_roll_* | - |

---

## interface_program

**Purpose:** Bridge between user and system. Accepts HTTP requests and CLI input, routes messages through pipeline.

**Location:** `src/interface_program/main.ts`

### Input
- **Source:** HTTP POST to `/api/input` or CLI
- **Format:** Raw user text
- **Example:**
  ```jsonc
  POST /api/input
  {
    "text": "attack the goblin",
    "actor_id": "henry_actor"
  }
  ```

### Processing
1. Receives user input
2. Creates message with `type: "user_input"`
3. Appends to `inbox.jsonc`
4. Breath() polls and routes to `interpreter_ai` stage

### Output
- **Location:** `inbox.jsonc` → `outbox.jsonc` (via router)
- **Stage:** `interpreter_ai`
- **Status:** `sent`
- **Example:**
  ```jsonc
  {
    "sender": "henry_actor",
    "content": "attack the goblin",
    "type": "user_input",
    "stage": "interpreter_ai",
    "status": "sent"
  }
  ```

### Handoff
**To:** interpreter_ai (via Breath router)

### Data Files
- `local_data/data_slot_1/inbox.jsonc` - User inputs
- `local_data/data_slot_1/outbox.jsonc` - Routed messages
- `local_data/data_slot_1/status.jsonc` - Current status line

### HTTP Endpoints
- `POST /api/input` - Submit user action
- `GET /api/log?slot=1` - Read message log
- `GET /api/status?slot=1` - Read current status
- `GET /api/health` - Service health check

### Debug Logging
```
[0] Breath: inbox message routed { id, sender, stage }
[0] Breath: outbox queued { id, stage, status }
```

---

## interpreter_ai

**Purpose:** Convert natural language player input into machine-readable system commands using LLM.

**Location:** `src/interpreter_ai/main.ts`

**Reference:** [THAUMWORLD Actions](https://www.thaumworld.xyz/actions/)

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `interpreter_ai`
- **Status:** `sent`
- **Required Fields:**
  - `content`: User's natural language text
  - `sender`: Actor ID (e.g., "henry_actor")

### Processing
1. Loads actor context (stats, inventory, location)
2. Builds prompt with system instructions + actor context
3. Sends to LLM (ollama_chat)
4. Parses response into machine text
5. Sanitizes output (removes markdown, normalizes syntax)
6. Stores conversation history (session-based)

### System Prompt Key Points
```
You are the Interpreter AI for THAUMWORLD tabletop RPG.
Convert human input into strict machine-readable system text.
Output ONLY machine text. One command per line. No prose.
Syntax: <subject>.<VERB>(key=value, ...)
Subjects are refs (actor, npc, item, tile). Verbs are UPPERCASE.
Action verbs: USE, ATTACK, HELP, DEFEND, GRAPPLE, INSPECT, COMMUNICATE, DODGE, CRAFT, SLEEP, REPAIR, MOVE, WORK, GUARD, HOLD
System verbs: SYSTEM.APPLY_TAG, SYSTEM.REMOVE_TAG, SYSTEM.ADJUST_RESOURCE, etc.
```

### Output
- **Location:** `inbox.jsonc` (via router)
- **Stage:** `interpreted_1`
- **Status:** `sent`
- **Meta Fields:**
  - `machine_text`: Generated system command(s)
  - `original_text`: User's input (preserved)
  - `error_reason`: If parsing failed
  - `error_iteration`: Retry count

**Example Output:**
```jsonc
{
  "sender": "interpreter_ai",
  "content": "actor.henry_actor.ATTACK(target=npc.goblin, tool=actor.henry_actor.sword)",
  "stage": "interpreted_1",
  "status": "sent",
  "meta": {
    "machine_text": "actor.henry_actor.ATTACK(target=npc.goblin, tool=actor.henry_actor.sword)",
    "original_text": "attack the goblin with my sword"
  }
}
```

### Error Handling
- Empty response → Retry with refinement prompt
- Parse errors → Retry up to 5 iterations
- After 5 failures → "band_aid" mode (best effort)

### Handoff
**To:** data_broker (via router)

### Configuration
```typescript
const INTERPRETER_MODEL = "llama3.2:latest";
const INTERPRETER_TIMEOUT_MS = 600_000; // 10 minutes
const INTERPRETER_TEMPERATURE = 0.2; // Low creativity for precision
const INTERPRETER_HISTORY_LIMIT = 12; // Session memory
```

### Debug Logging
```
[1] InterpreterAI: request { model, session, refinement, history }
[1] InterpreterAI: response { model, session, duration_ms, chars }
[1] Interpreter Out <machine_text>
[1] Interpreter: sent response { reply_to, id }
```

---

## data_broker

**Purpose:** Parse machine text into structured commands and resolve all references to actual file paths.

**Location:** `src/data_broker/main.ts`

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `interpreted_*` (interpreted_1, interpreted_2, etc.)
- **Status:** `sent`
- **Required Meta:**
  - `machine_text`: System commands to parse

### Processing
1. Parses machine text into CommandNode array
2. For each command:
   - Extracts subject, verb, arguments
   - Resolves references (e.g., `actor.henry_actor` → file path)
   - Validates target existence
   - Creates missing entities if `should_create_data: true`
3. Handles errors and retries

### Reference Resolution
**Resolves:**
- `actor.<id>` → `local_data/data_slot_1/actors/<id>.jsonc`
- `npc.<id>` → `local_data/data_slot_1/npcs/<id>.jsonc`
- `item.<id>` → `local_data/data_slot_1/items/<id>.jsonc`
- `tile.<x>.<y>` → World tile reference
- `region_tile.<x>.<y>` → Region reference

### Output
- **Location:** `outbox.jsonc`
- **Stage:** `brokered_1` (or brokered_2, brokered_3, etc.)
- **Status:** `sent` or `error`
- **Meta Fields:**
  - `commands`: Parsed CommandNode[]
  - `resolved`: Map of refs to file paths
  - `machine_text`: Original text
  - `errors`: Any resolution errors

**Example Output:**
```jsonc
{
  "sender": "data_broker",
  "content": "brokered data ready",
  "stage": "brokered_1",
  "status": "sent",
  "meta": {
    "commands": [
      {
        "subject": "actor.henry_actor",
        "verb": "ATTACK",
        "args": {
          "target": { "type": "identifier", "value": "npc.goblin" },
          "tool": { "type": "identifier", "value": "actor.henry_actor.sword" }
        }
      }
    ],
    "resolved": {
      "actor.henry_actor": { "path": ".../actors/henry_actor.jsonc" },
      "npc.goblin": { "path": ".../npcs/goblin.jsonc" }
    }
  }
}
```

### Error Handling
- Missing references → Create if allowed, or error
- Parse errors → Return with error list
- Up to 5 retry iterations

### Handoff
**To:** rules_lawyer

### Debug Logging
```
[2] DataBroker: candidates { count: 1 }
[2] DataBroker: received { id, status, stage }
[2] DataBroker: resolve start { id, iteration }
[2] DataBroker: resolve ok { id, warnings }
[2] Broker Out <machine_text>
```

---

## rules_lawyer

**Purpose:** Apply THAUMWORLD RPG rules to commands, validate actions, compute outcomes, generate effects.

**Location:** `src/rules_lawyer/main.ts`

**Reference:** [THAUMWORLD Rules Index](https://www.thaumworld.xyz/rules-index/)

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `brokered_*`
- **Status:** `sent`
- **Required Meta:**
  - `commands`: CommandNode[]
  - `resolved`: Reference map

### Processing
1. Validates each command against RPG rules
2. Handles dice rolls (requests rolls from roller service)
3. Computes outcomes based on:
   - Character stats (STR, DEX, etc.)
   - Proficiencies
   - Perks
   - Tool bonuses
   - Tag modifications
4. Generates events (what happened)
5. Generates effects (state changes)

### Rule Systems Implemented
- [Stats](https://www.thaumworld.xyz/stats-n-bonuses/) - Stat bonuses to rolls
- [Magnitude](https://www.thaumworld.xyz/magnitude/) - Scaling system
- [Dice](https://www.thaumworld.xyz/dice-rolls-n-nat/) - D20 rolls with NAT 1/20
- [Proficiency](https://www.thaumworld.xyz/proficiency/) - 21 profs
- [Awareness](https://www.thaumworld.xyz/awareness/) - Sense-based perception
- [Damage](https://www.thaumworld.xyz/damage/) - Health/vigor damage
- [Tags](https://www.thaumworld.xyz/tags/) - Special rule modifications

### Output
- **Location:** `outbox.jsonc`
- **Stage:** `ruling_1` (or ruling_2, ruling_3, etc.)
- **Status:** `pending_state_apply`
- **Meta Fields:**
  - `events`: String array (what happened narratively)
  - `effects`: String array (system commands to apply)
  - `original_text`: User input
  - `machine_text`: Command that was ruled

**Example Output:**
```jsonc
{
  "sender": "rules_lawyer",
  "content": "rule effects ready",
  "stage": "ruling_1",
  "status": "pending_state_apply",
  "meta": {
    "events": [
      "actor.henry_actor.ATTACK(tool=actor.henry_actor.sword, target=npc.goblin, roll=15, hit=true)"
    ],
    "effects": [
      "SYSTEM.APPLY_DAMAGE(target=npc.goblin, amount=8, type=slashing)",
      "SYSTEM.ADJUST_RESOURCE(target=actor.henry_actor.sword, resource=durability, delta=-1)"
    ],
    "original_text": "attack goblin with sword",
    "machine_text": "actor.henry_actor.ATTACK(...)"
  }
}
```

### Special Handling: COMMUNICATE
For player communication to NPCs:
- Checks if NPC can perceive player (awareness)
- Sets `SYSTEM.SET_AWARENESS` effects
- Does NOT generate NPC response (handled by npc_ai service)

### Handoff
**To:** state_applier

### Debug Logging
```
[3] RulesLawyer: candidates { count: 1 }
[3] RulesLawyer: received { id, status, stage }
[3] RulesLawyer: created ruling message with pending_state_apply { id, stage }
[3] RulesLawyer: marked brokered message as done { id }
```

---

## state_applier

**Purpose:** Apply effects generated by rules_lawyer to the actual game state (actor/npc files).

**Location:** `src/state_applier/main.ts`

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `ruling_*`
- **Status:** `pending_state_apply`
- **Required Meta:**
  - `effects`: String array of system commands

### Processing
1. Filters for messages with `status: "pending_state_apply"`
2. Transitions status: `pending_state_apply` → `processing`
3. For each effect:
   - Parses effect command
   - Resolves target references
   - Loads target file (actor/npc/item)
   - Applies modification
   - Saves file
4. Tracks applied effects (prevents duplicates)
5. Creates `applied_1` message (only if effects were applied)
6. Marks ruling message as `done`

### Effects Applied
- `SYSTEM.APPLY_DAMAGE` - Reduce health.current
- `SYSTEM.APPLY_HEAL` - Increase health.current
- `SYSTEM.ADJUST_INVENTORY` - Add/remove items
- `SYSTEM.SET_AWARENESS` - Set perception state
- `SYSTEM.ADJUST_RESOURCE` - Modify any resource
- `SYSTEM.APPLY_TAG` / `SYSTEM.REMOVE_TAG` - Add/remove tags
- `SYSTEM.SET_OCCUPANCY` - Claim/release tiles

### Output
- **Location:** `outbox.jsonc` (if effects applied)
- **Stage:** `applied_1`
- **Status:** `sent`
- **Meta Fields:**
  - `effects_applied`: Count of applied effects

**Example Output:**
```jsonc
{
  "sender": "state_applier",
  "content": "state applied",
  "stage": "applied_1",
  "status": "sent",
  "reply_to": "ruling_message_id",
  "meta": {
    "effects_applied": 2
  }
}
```

### Handoff
**To:** renderer_ai (or npc_ai for COMMUNICATE events)

### Debug Logging
```
[6] [StateApplier] POLL - 10 messages in outbox { byStage, byStatus }
[6] [StateApplier] FOUND 1 CANDIDATES for processing { ids, stages }
[6] [StateApplier] >>> PROCESSING <id> { stage, status, effectsCount }
[6] [StateApplier]   [1/4] Status: pending_state_apply -> processing
[6] [StateApplier]   [2/4] APPLIED 2 effects
[6] [StateApplier]   [3/4] Created applied_1 message
[6] [StateApplier]   [4/4] COMPLETED - Status: processing -> done
```

---

## renderer_ai

**Purpose:** Convert system effects and events into readable narrative for the player.

**Location:** `src/renderer_ai/main.ts`

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `applied_*`
- **Status:** `sent` or `done`
- **Required Meta:**
  - `events`: What happened
  - `effects`: State changes
  - `original_text`: User's input

### Processing
1. Loads events and effects from meta
2. Loads actor/NPC context (names, descriptions)
3. Builds narrative prompt with:
   - System instructions
   - Events list
   - Effects list
   - Recent conversation history
4. Sends to LLM
5. Generates readable narrative
6. Creates `rendered_1` message

### System Prompt
```
You are the Renderer AI.
Convert system effects and events into readable narrative.
Output narrative only. No system syntax.
Use provided effects/events and context.
Infer minimally, stay consistent.
If awareness obscured, describe presence only.
Keep concise and clear.
```

### Output
- **Location:** `inbox.jsonc`
- **Stage:** `rendered_1`
- **Status:** `sent`
- **Content:** Narrative text

**Example Output:**
```jsonc
{
  "sender": "renderer_ai",
  "content": "You swing your sword at the goblin, landing a solid blow! The creature snarls and staggers back, clutching its wound.",
  "stage": "rendered_1",
  "status": "sent"
}
```

### Handoff
**To:** User display (canvas app reads inbox)

### Debug Logging
```
[4] RendererAI: request { model, session, history }
[4] RendererAI: response { model, session, duration_ms, chars }
[4] Renderer: output sent to inbox and log
```

---

## npc_ai

**Purpose:** Generate contextual NPC responses when player communicates with them.

**Location:** `src/npc_ai/main.ts`

**Reference:** [THAUMWORLD Character](https://www.thaumworld.xyz/character/), [Senses](https://www.thaumworld.xyz/senses/)

### Input
- **Location:** `outbox.jsonc`
- **Stage:** `applied_*`
- **Trigger:** Message contains COMMUNICATE events
- **Detection:** Looks for `meta.events` with COMMUNICATE

### Processing
1. Finds COMMUNICATE events in applied messages
2. Identifies target NPCs from communication
3. For each NPC:
   - Checks if in same region as player (proximity)
   - Checks awareness (can NPC perceive player?)
   - Loads NPC character sheet
   - Builds personality-based prompt
   - Generates response via LLM
   - Creates response message
4. Tracks which NPCs responded (prevents duplicate responses)

### NPC Prompt Building
Uses NPC character sheet fields:
- `name`, `title` - Identity
- `personality.story_goal` - Role/motivation
- `personality.fear`, `flaw`, `passion`, `hobby` - Traits
- `personality.happy_triggers`, `angry_triggers`, `sad_triggers` - Reactions
- `appearance.distinguishing_features` - Visual description
- `lore.backstory` - History

### Output
- **Location:** `inbox.jsonc`
- **Stage:** `npc_response`
- **Status:** `sent`
- **Sender:** `npc.<npc_id>`
- **Meta Fields:**
  - `npc_id`: Responding NPC
  - `npc_name`: NPC name
  - `target_actor`: Player actor ID
  - `is_direct_response`: Whether directly addressed

**Example Output:**
```jsonc
{
  "sender": "npc.shopkeep",
  "content": "Greetings, traveler! Looking for potions or perhaps some enchanted gear?",
  "stage": "npc_response",
  "status": "sent",
  "meta": {
    "npc_id": "shopkeep",
    "npc_name": "shopkeep",
    "target_actor": "henry_actor",
    "is_direct_response": true
  }
}
```

### Multi-NPC Conversations
- Multiple NPCs can respond to same player communication
- Directly addressed NPCs always respond
- Other NPCs may respond based on personality (30% chance if passionate/hobby-focused)
- Response tracking prevents duplicates within same "round"

### Handoff
**To:** User display (via router)

### Debug Logging
```
[NPC_AI] Found 2 NPCs in region { region, npcs }
[NPC_AI] Generating response for shopkeep { clarity }
[NPC_AI] Created response from shopkeep { response_preview }
```

---

## roller

**Purpose:** Handle dice rolling requests from rules_lawyer.

**Location:** `src/roller/main.ts`

**Reference:** [THAUMWORLD Dice Rolls](https://www.thaumworld.xyz/dice-rolls-n-nat/)

### Input
- **Location:** `outbox.jsonc`
- **Stage:** Messages with `status: "awaiting_roll_1"`
- **Trigger:** Rules lawyer needs dice roll

### Processing
1. Detects awaiting_roll status
2. Performs D20 roll
3. Computes result with modifiers
4. Updates message status back to `processing`

### Output
- Updates original message
- Status: `awaiting_roll_1` → `processing`
- Meta includes roll result

### Handoff
**To:** Back to rules_lawyer (same message, updated status)

---

## Common Patterns

### Service Boot Pattern
All services follow this pattern:
```typescript
// 1. Constants
const data_slot_number = 1;
const POLL_MS = 800;

// 2. Initialize
function initialize() {
    ensure_dir_exists(...);
    ensure_log_exists(...);
    return { outbox_path, inbox_path, log_path };
}

// 3. Boot
const { outbox_path, inbox_path, log_path } = initialize();
debug_log("Service: booted");

// 4. Poll loop
setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);
```

### Message Processing Pattern
```typescript
async function tick(outbox_path, inbox_path, log_path) {
    const outbox = read_outbox(outbox_path);
    
    // Filter candidates
    const candidates = outbox.messages.filter(m => {
        return m.stage?.startsWith("expected_stage") &&
               m.status === "expected_status";
    });
    
    // Process each
    for (const msg of candidates) {
        await process_message(outbox_path, inbox_path, log_path, msg);
    }
}
```

### Status Transition Pattern
```typescript
// 1. Transition to processing
const processing = try_set_message_status(msg, "processing");
if (!processing.ok) return;
update_outbox_message(outbox_path, processing.message);

// 2. Do work...

// 3. Transition to done
const done = try_set_message_status(processing.message, "done");
if (done.ok) {
    update_outbox_message(outbox_path, done.message);
}
```

---

## Data Flow Summary

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Player    │───▶│  interface  │───▶│ interpreter │
└─────────────┘    └─────────────┘    └─────────────┘
                                              │
┌─────────────┐    ┌─────────────┐    ┌─────▼───────┐
│   Display   │◀───│   renderer  │◀───│    state    │
└─────────────┘    └─────────────┘    └─────────────┘
       ▲                                     │
       │         ┌─────────────┐    ┌─────▼───────┐
       └─────────│   npc_ai    │◀───│    rules    │
                 └─────────────┘    └─────────────┘
                                            │
                                     ┌─────▼───────┐
                                     │   broker    │
                                     └─────────────┘
```

---

## Next Steps

- See [STAGES.md](./STAGES.md) for detailed stage documentation
- See [EFFECTS.md](./EFFECTS.md) for THAUMWORLD effect system
- See [examples/](./examples/) for working code samples
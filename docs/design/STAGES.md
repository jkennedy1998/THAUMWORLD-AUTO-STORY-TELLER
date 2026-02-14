# THAUMWORLD Stage Documentation

Complete reference for all message stages, their transitions, and contracts.

Current build note (2026-02-13): `interpreter_ai` service is archived. Action intents (COMMUNICATE/MOVE/USE/INSPECT) are created and validated via the ActionPipeline in `interface_program`. The stage-based pipeline below remains relevant for non-ActionPipeline messages and historical context.

**System Reference:** [THAUMWORLD Rules](https://www.thaumworld.xyz/rules-index/)

## Stage Overview

Stages represent processing phases in the pipeline. Each stage has:
- **Creator**: Which service creates messages in this stage
- **Consumer**: Which service processes messages in this stage  
- **Status Flow**: How status transitions through this stage
- **Contract**: Required and optional fields

## Stage Flow Diagram (Non-ActionPipeline)

The current build executes core actions via the ActionPipeline. Stage routing is still used for some file-backed flows.

```
brokered_*  -> ruling_* (pending_state_apply) -> applied_* -> rendered_*
                                    \
                                     -> npc_response
```

Legacy interpreter stages (`interpreter_ai`, `interpreted_*`) are archived here:

- `docs/archive/2026_02_13_legacy_interpreter_pipeline_reference.md`

---

## Stage: brokered_1

**Purpose:** Contains parsed commands with resolved references

### Creator
- **Service:** data_broker
- **Trigger:** Successfully resolved all references

### Consumer
- **Service:** rules_lawyer
- **Poll Location:** outbox.jsonc
- **Filter:** `stage.startsWith("brokered_") && status === "sent"`

### Status Flow
```
sent → processing → done
```

### Contract

**Required Fields:**
```typescript
{
  sender: "data_broker";
  content: "brokered data ready";
  stage: "brokered_1";         // Or brokered_2, brokered_3, etc.
  status: "sent";
  meta: {
    commands: CommandNode[];    // Parsed command tree
    resolved: {                 // Reference → file path map
      [ref: string]: {
        path: string;           // e.g., ".../actors/henry_actor.jsonc"
        id: string;
        type: string;
      };
    };
    machine_text: string;       // Original machine text
    original_text: string;      // User's original input
  };
}
```

**Optional Fields:**
```typescript
{
  meta: {
    warnings?: string[];        // Non-fatal issues
    should_create_data?: boolean; // Whether new entities were created
  };
}
```

### CommandNode Structure
```typescript
{
  subject: string;              // e.g., "actor.henry_actor"
  verb: string;                 // e.g., "ATTACK", "COMMUNICATE"
  args: {
    [key: string]: ValueNode;   // Named arguments
  };
  line: number;                 // Line number in source
}
```

### Example
```jsonc
{
  "id": "2026-01-31T12:00:02.000Z : 000001 : GHI789",
  "sender": "data_broker",
  "content": "brokered data ready",
  "stage": "brokered_1",
  "status": "sent",
  "reply_to": "2026-01-31T12:00:01.000Z : 000001 : DEF456",
  "meta": {
    "commands": [
      {
        "subject": "actor.henry_actor",
        "verb": "ATTACK",
        "args": {
          "target": { "type": "identifier", "value": "npc.goblin" },
          "tool": { "type": "identifier", "value": "actor.henry_actor.sword" }
        },
        "line": 1
      }
    ],
    "resolved": {
      "actor.henry_actor": {
        "path": "C:/.../actors/henry_actor.jsonc",
        "id": "henry_actor",
        "type": "actor"
      },
      "npc.goblin": {
        "path": "C:/.../npcs/goblin.jsonc",
        "id": "goblin",
        "type": "npc"
      }
    },
    "machine_text": "actor.henry_actor.ATTACK(...)",
    "original_text": "attack the goblin"
  }
}
```

### Handoff
**To:** ruling_1 (created by rules_lawyer)

---

## Stage: ruling_1

**Purpose:** Contains RPG rule outcomes - events and effects

### Creator
- **Service:** rules_lawyer
- **Trigger:** Successfully applied THAUMWORLD rules

### Consumer
- **Service:** state_applier
- **Poll Location:** outbox.jsonc
- **Filter:** `stage.startsWith("ruling_") && status === "pending_state_apply"`

### Status Flow
```
pending_state_apply → processing → done
```

**Special Status:** `pending_state_apply`
- Signals that state changes need to be applied
- Distinct from "sent" to prevent premature processing
- StateApplier specifically looks for this status

### Contract

**Required Fields:**
```typescript
{
  sender: "rules_lawyer";
  content: "rule effects ready";
  stage: "ruling_1";            // Or ruling_2, ruling_3, etc.
  status: "pending_state_apply"; // NOT "sent" - special status
  meta: {
    events: string[];           // What happened (narrative events)
    effects: string[];          // System commands to apply
    original_text: string;      // User's original input
    machine_text: string;       // Command that was ruled
  };
}
```

**Event Format:**
```
actor.<id>.<VERB>(arg=value, ...)
```

**Effect Format:**
```
SYSTEM.<EFFECT>(target=<ref>, ...)
```

### Example
```jsonc
{
  "id": "2026-01-31T12:00:03.000Z : 000001 : JKL012",
  "sender": "rules_lawyer",
  "content": "rule effects ready",
  "stage": "ruling_1",
  "status": "pending_state_apply",
  "reply_to": "2026-01-31T12:00:02.000Z : 000001 : GHI789",
  "meta": {
    "events": [
      "actor.henry_actor.ATTACK(tool=actor.henry_actor.sword, target=npc.goblin, roll=15, hit=true, damage=8)"
    ],
    "effects": [
      "SYSTEM.APPLY_DAMAGE(target=npc.goblin, amount=8, type=slashing)",
      "SYSTEM.ADJUST_RESOURCE(target=actor.henry_actor.sword, resource=durability, delta=-1)"
    ],
    "original_text": "attack the goblin",
    "machine_text": "actor.henry_actor.ATTACK(target=npc.goblin, tool=actor.henry_actor.sword)"
  }
}
```

### Handoff
**To:** applied_1 (created by state_applier, only if effects applied)

**Note:** If no effects (e.g., pure communication), may not create applied_1.

---

## Stage: applied_1

**Purpose:** Signals that effects have been applied to game state

### Creator
- **Service:** state_applier
- **Trigger:** Successfully applied one or more effects

### Consumer
- **Primary:** renderer_ai (for narrative)
- **Secondary:** npc_ai (for COMMUNICATE events)
- **Poll Location:** outbox.jsonc
- **Filter:** `stage.startsWith("applied_") && (status === "sent" || status === "done")`

### Status Flow
```
sent → processing → done
```

### Contract

**Required Fields:**
```typescript
{
  sender: "state_applier";
  content: "state applied";
  stage: "applied_1";
  status: "sent";
  reply_to: string;             // ID of ruling message
  meta: {
    effects_applied: number;    // Count of applied effects
  };
}
```

**Optional Fields:**
```typescript
{
  correlation_id?: string;      // Preserved from ruling
}
```

### Example
```jsonc
{
  "id": "2026-01-31T12:00:04.000Z : 000001 : MNO345",
  "sender": "state_applier",
  "content": "state applied",
  "stage": "applied_1",
  "status": "sent",
  "reply_to": "2026-01-31T12:00:03.000Z : 000001 : JKL012",
  "correlation_id": "2026-01-31T12:00:00.000Z : 000001 : XYZ789",
  "meta": {
    "effects_applied": 2
  }
}
```

### Handoff
**To:** 
- rendered_1 (created by renderer_ai)
- npc_response (created by npc_ai for COMMUNICATE)

---

## Stage: rendered_1

**Purpose:** Contains narrative text for player display

### Creator
- **Service:** renderer_ai
- **Trigger:** Successfully generated narrative from events/effects

### Consumer
- **Service:** User display (canvas app)
- **Poll Location:** inbox.jsonc (read by frontend)
- **Filter:** `stage.startsWith("rendered_")`

### Status Flow
```
sent (no processing needed - final stage)
```

### Contract

**Required Fields:**
```typescript
{
  sender: "renderer_ai";
  content: string;              // Narrative text
  stage: "rendered_1";
  status: "sent";
}
```

**Content Format:**
- Plain text narrative
- 1-3 sentences typically
- Describes what happened from player's perspective

### Example
```jsonc
{
  "id": "2026-01-31T12:00:05.000Z : 000001 : PQR678",
  "sender": "renderer_ai",
  "content": "You swing your sword at the goblin, landing a solid blow! The creature snarls and staggers back, clutching its wound.",
  "stage": "rendered_1",
  "status": "sent",
  "reply_to": "2026-01-31T12:00:04.000Z : 000001 : MNO345",
  "correlation_id": "2026-01-31T12:00:00.000Z : 000001 : XYZ789"
}
```

### Handoff
**To:** User Display (canvas app renders this)

---

## Stage: npc_response

**Purpose:** Contains NPC dialogue responses to player communication

### Creator
- **Service:** npc_ai
- **Trigger:** Player communicates with NPC

### Consumer
- **Service:** User display (canvas app)
- **Poll Location:** inbox.jsonc
- **Filter:** `stage.startsWith("npc_response")`

### Status Flow
```
sent (no processing needed - final stage)
```

### Contract

**Required Fields:**
```typescript
{
  sender: "npc.<npc_id>";       // e.g., "npc.shopkeep"
  content: string;              // NPC dialogue
  stage: "npc_response";
  status: "sent";
  meta: {
    npc_id: string;             // NPC identifier
    npc_name: string;           // Display name
    target_actor: string;       // Player actor ID
    is_direct_response: boolean; // Whether directly addressed
    perception_clarity: string;  // "clear", "obscured", or "none"
  };
}
```

### Example
```jsonc
{
  "id": "2026-01-31T12:00:06.000Z : 000001 : STU901",
  "sender": "npc.shopkeep",
  "content": "Greetings, traveler! Looking for potions or perhaps some enchanted gear?",
  "stage": "npc_response",
  "status": "sent",
  "reply_to": "2026-01-31T12:00:04.000Z : 000001 : MNO345",
  "correlation_id": "2026-01-31T12:00:00.000Z : 000001 : XYZ789",
  "meta": {
    "npc_id": "shopkeep",
    "npc_name": "shopkeep",
    "target_actor": "henry_actor",
    "is_direct_response": true,
    "perception_clarity": "clear"
  }
}
```

### Display Format
Rendered as:
```
Shopkeep: "Greetings, traveler! Looking for potions or perhaps some enchanted gear?"
```

### Handoff
**To:** User Display

---

## Special Stages

### awaiting_roll_1, awaiting_roll_2, etc.

**Purpose:** Pause pipeline for dice roll

**Status:** `awaiting_roll_1`

**Flow:**
```
processing → awaiting_roll_1 → processing → done
```

**Created by:** rules_lawyer (when dice needed)
**Processed by:** roller service
**Resumed by:** rules_lawyer (after roll complete)

---

## Status State Machine

### Valid Status Values
```typescript
type MessageStatus = 
  | 'queued'      // Waiting to be sent
  | 'sent'        // Ready for processing
  | 'processing'  // Currently being processed
  | 'pending_state_apply'  // Special: waiting for state applier
  | 'done'        // Processing complete
  | 'error'       // Processing failed
  | `awaiting_roll_${number}`;  // Waiting for dice roll
```

### Status Transitions

| From | To | Valid? | Notes |
|------|-----|--------|-------|
| undefined | queued | ✓ | New message |
| undefined | sent | ✓ | Direct send |
| queued | sent | ✓ | Release to pipeline |
| queued | processing | ✓ | Immediate process |
| sent | processing | ✓ | Service picks up |
| sent | error | ✓ | Pre-process error |
| processing | done | ✓ | Success |
| processing | pending_state_apply | ✓ | Rules lawyer handoff |
| processing | awaiting_roll_1 | ✓ | Need dice |
| processing | error | ✓ | Process failed |
| pending_state_apply | processing | ✓ | State applier pickup |
| awaiting_roll_1 | processing | ✓ | Roll complete |
| awaiting_roll_1 | done | ✓ | Roll + process done |
| error | sent | ✓ | Retry (with iteration) |
| done | * | ✗ | Terminal state |

### Status Transition Function
```typescript
function can_transition_status(from: MessageStatus | undefined, to: MessageStatus): boolean {
    if (from === undefined) return to === 'sent' || to === 'queued';
    if (from === 'queued') return to === 'sent' || to === 'processing' || to === 'error';
    if (from === 'sent') return to === 'processing' || to === 'error';
    if (from === 'processing') return to === 'done' || to === 'pending_state_apply' || to === 'error' || is_awaiting_roll(to);
    if (is_awaiting_roll(from)) return to === 'processing' || to === 'done' || to === 'error';
    if (from === 'pending_state_apply') return to === 'processing' || to === 'error';
    return false;
}
```

---

## Stage Patterns

### Iteration Pattern
When a service fails and needs retry:
```
brokered_1 (error) → brokered_2 (error) → brokered_3 → ... → brokered_5
```

Each iteration preserves:
- `correlation_id` (same pipeline run)
- `reply_to` (original message chain)
- `meta.error_iteration` (retry count)

### Branching Pattern
One message can spawn multiple:
```
applied_1 → rendered_1 (narrative)
         → npc_response (NPC dialogue)
         → npc_response (second NPC)
```

All share `correlation_id` for grouping.

### Correlation Chain
```
User Input (correlation_id: ABC)
  ↓
Interpreted (correlation_id: ABC, reply_to: User Input)
  ↓
Brokered (correlation_id: ABC, reply_to: Interpreted)
  ↓
Ruling (correlation_id: ABC, reply_to: Brokered)
  ↓
Applied (correlation_id: ABC, reply_to: Ruling)
  ↓
Rendered (correlation_id: ABC, reply_to: Applied)
```

---

## Debugging Stages

### Check Current Stages
```bash
# See all stages in outbox
cat local_data/data_slot_1/outbox.jsonc | grep "stage"

# Count by stage
cat local_data/data_slot_1/outbox.jsonc | grep "stage" | sort | uniq -c

# Find stuck messages
cat local_data/data_slot_1/outbox.jsonc | grep -A5 "pending_state_apply"
```

### Debug Logging
```
[Service] POLL - 10 messages in outbox { byStage: {...}, byStatus: {...} }
[Service] FOUND 2 CANDIDATES for processing { ids: [...], stages: [...] }
[Service] Processing message { id, stage, status }
```

---

## Next Steps

- See [SERVICES.md](./SERVICES.md) for service details
- See [EFFECTS.md](../specs/EFFECTS.md) for effect system
- See [examples/](./examples/) for working code

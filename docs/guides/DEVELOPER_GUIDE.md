# Developer Guide

## Extending THAUMWORLD

This guide covers how to extend the THAUMWORLD Auto Story Teller system with new features, actions, NPCs, and services.

## Table of Contents

1. [Adding New Actions](#adding-new-actions)
2. [Adding New NPC Archetypes](#adding-new-npc-archetypes)
3. [Adding New Services](#adding-new-services)
4. [Modifying AI Prompts](#modifying-ai-prompts)
5. [Adding New Reaction Types](#adding-new-reaction-types)
6. [Extending Working Memory](#extending-working-memory)
7. [Best Practices](#best-practices)

---

## Adding New Actions

### Step 1: Add Action Verb

Add to `src/shared/constants.ts`:

```typescript
export const ACTION_VERBS = {
    // ... existing actions
    "NEW_ACTION": "NEW_ACTION"
} as const;

export type ActionVerb = keyof typeof ACTION_VERBS;
```

### Step 2: Add Relevance Rules

Add to `src/context_manager/relevance.ts`:

```typescript
"NEW_ACTION": {
    load_participant_fields: ["name", "visible_equipment", "current_status"],
    load_recent_events: true,
    event_lookback_turns: 5,
    ignore_if_not_visible: false,
    special_context: ["relevant_info_1", "relevant_info_2"]
}
```

### Step 3: Add Action Definition

Add to `src/npc_ai/action_selector.ts`:

```typescript
"NEW_ACTION": {
    base_priority: 5,
    requirements: {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed"],
        equipment_needed: ["required_item"]
    },
    target_types: ["target_type"]
}
```

### Step 4: Add Validation Rules

Add to `src/turn_manager/validator.ts`:

```typescript
"NEW_ACTION": {
    min_health: 20,
    forbidden_statuses: ["stunned", "paralyzed"],
    required_equipment: ["required_item"],
    range: 5,
    line_of_sight: true
}
```

### Step 5: Add Scripted Responses (Optional)

Add to `src/npc_ai/decision_tree.ts`:

```typescript
// In appropriate category (emergency, social, combat)
{
    condition: (ctx) => ctx.action_verb === "NEW_ACTION" && ctx.is_combat,
    response: (ctx) => ({
        matched: true,
        action: "NEW_ACTION",
        dialogue: "Appropriate response",
        reasoning: "Why this response",
        priority: 6
    }),
    priority: 6
}
```

### Step 6: Add Templates (Optional)

Add to `src/npc_ai/template_db.ts`:

```typescript
const newArchetypeTemplates: NPCTemplate[] = [
    {
        id: "archetype_new_action",
        archetype: "new_archetype",
        situation: "new_situation",
        action: "NEW_ACTION",
        responses: ["Response 1", "Response 2"],
        conditions: { requires_peace: true },
        priority: 5
    }
];
```

### Step 7: Test

1. Test action validation
2. Test NPC action selection
3. Test working memory integration
4. Test turn manager integration

---

## Adding New NPC Archetypes

### Step 1: Define Archetype

Add to `src/npc_ai/template_db.ts`:

```typescript
const myArchetypeTemplates: NPCTemplate[] = [
    {
        id: "my_archetype_greeting",
        archetype: "my_archetype",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Welcome, traveler!",
            "Greetings! What brings you here?"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "my_archetype_question",
        archetype: "my_archetype",
        situation: "question",
        action: "COMMUNICATE",
        responses: [
            "I might know something about that...",
            "What do you wish to learn?"
        ],
        conditions: { requires_peace: true },
        priority: 5
    }
];
```

### Step 2: Add to Template Database

Add to the `allTemplates` array:

```typescript
const allTemplates: NPCTemplate[] = [
    ...shopkeeperTemplates,
    ...guardTemplates,
    ...myArchetypeTemplates, // Add here
];
```

### Step 3: Create NPC Definition

Create NPC file `local_data/data_slot_1/npcs/my_npc.jsonc`:

```jsonc
{
    "id": "my_npc",
    "name": "My NPC",
    "role": "my_archetype",
    "personality": {
        "story_goal": "Protect the ancient knowledge",
        "fear": "Losing the sacred texts",
        "flaw": "Overly suspicious of strangers"
    },
    "stats": {
        "health": { "current": 100, "max": 100 },
        "str": 50,
        "dex": 60,
        "con": 55,
        "int": 70,
        "wis": 65,
        "cha": 50
    }
}
```

### Step 4: Test

Test various interactions:
- Greeting
- Questions
- Combat (if applicable)
- Special situations

---

## Adding New Services

### Step 1: Create Service Directory

```bash
mkdir src/my_service
touch src/my_service/main.ts
```

### Step 2: Implement Service Structure

```typescript
// src/my_service/main.ts
import { get_data_slot_dir, get_inbox_path, get_outbox_path, get_log_path } from "../engine/paths.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox } from "../engine/outbox_store.js";
import { ensure_log_exists, append_log_message } from "../engine/log_store.js";
import { create_message } from "../engine/message.js";
import { debug_log, log_service_error } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.MY_SERVICE || 1000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function process_messages(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        for (const msg of outbox.messages) {
            if (msg.status !== "sent") continue;
            if (msg.stage !== "my_service_input") continue;
            
            // Process message
            const result = await process_my_service(msg);
            
            // Create response
            const response = create_message({
                sender: "my_service",
                content: result,
                stage: "my_service_output",
                status: "sent",
                reply_to: msg.id
            });
            
            append_inbox_message(inbox_path, response);
        }
    } catch (err) {
        log_service_error("my_service", "process_messages", {}, err);
    }
}

async function process_my_service(msg: any): Promise<string> {
    // Your service logic here
    return "processed";
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    await process_messages(outbox_path, inbox_path, log_path);
}

function initialize() {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    
    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("MyService: booted");

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

void tick(outbox_path, inbox_path, log_path);
```

### Step 3: Add to Package.json

```json
{
    "scripts": {
        "my_service_dev": "tsx src/my_service/main.ts"
    }
}
```

### Step 4: Add Polling Config

Add to `src/shared/constants.ts`:

```typescript
POLL_MS: {
    // ... existing
    MY_SERVICE: 1000
}
```

### Step 5: Integrate with Pipeline

Modify preceding service to route to your service:

```typescript
// In previous service
const output = create_message({
    sender: "previous_service",
    content: "data",
    stage: "my_service_input", // Routes to your service
    status: "sent"
});
```

---

## Modifying AI Prompts

### NPC AI Prompt

Modify `src/npc_ai/main.ts` in `build_npc_prompt()`:

```typescript
function build_npc_prompt(npc: any, player_text: string, can_perceive: boolean, clarity: string, memory_context?: string): string {
    let prompt_parts: string[] = [];
    
    // Add your custom sections
    prompt_parts.push(`You are ${npc.name}.`);
    
    // Add custom context
    if (memory_context) {
        prompt_parts.push(`\nContext: ${memory_context}`);
    }
    
    // Add your custom instructions
    prompt_parts.push(`\nCustom instruction: Your specific guidance here`);
    
    prompt_parts.push(`\nPlayer says: "${player_text}"`);
    prompt_parts.push(`Respond as ${npc.name} would.`);
    
    return prompt_parts.join("\n");
}
```

### Interpreter AI Prompt

Note: `interpreter_ai` is archived in this build.

Current build: there is no Interpreter-LLM prompt to modify. Player/NPC actions are created and executed via the ActionPipeline in `src/interface_program/`.

Practical edit points:
- `src/interface_program/communication_input.ts` (COMMUNICATE intent creation)
- `src/interface_program/main.ts` (ActionPipeline integration, message emission)
- `src/npc_ai/main.ts` (NPC dialogue prompting)

### Renderer AI Prompt

Modify prompt in `src/renderer_ai/main.ts`:

```typescript
const system_prompt = `You are a fantasy RPG narrator.

NEW INSTRUCTION: Add your custom narration style here.

Generate engaging narrative...`;
```

---

## Adding New Reaction Types

### Step 1: Define Reaction Type

Add to `src/turn_manager/reactions.ts`:

```typescript
export type ReactionType = 
    | "OPPORTUNITY_ATTACK"
    | "DEFEND_ALLY"
    // ... existing
    | "MY_REACTION"; // Add new
```

### Step 2: Set Priority

```typescript
const REACTION_PRIORITIES: Record<ReactionType, number> = {
    // ... existing
    "MY_REACTION": 7 // Set appropriate priority
};
```

### Step 3: Add Trigger Logic

```typescript
function matches_trigger(
    trigger: ReactionTrigger,
    event: string,
    context: any
): boolean {
    switch (trigger.type) {
        // ... existing cases
        
        case "MY_REACTION":
            return event_lower.includes("trigger_condition");
    }
}
```

### Step 4: Add Default Condition

```typescript
const default_conditions: Record<ReactionType, string> = {
    // ... existing
    "MY_REACTION": "custom trigger condition"
};
```

### Step 5: Test

Test with various scenarios to ensure trigger works correctly.

---

## Extending Working Memory

### Adding New Memory Fields

Modify `src/context_manager/index.ts`:

```typescript
export type WorkingMemory = {
    // ... existing fields
    
    // Add new field
    custom_field: CustomType;
};
```

### Adding New Participant Data

```typescript
export type ParticipantMemory = {
    // ... existing fields
    
    // Add new field
    custom_trait: string;
};
```

### Custom Memory Builder

```typescript
async function build_participant_memory(slot: number, ref: string): Promise<ParticipantMemory | null> {
    // ... existing code
    
    return {
        // ... existing fields
        custom_trait: extract_custom_trait(entity)
    };
}

function extract_custom_trait(entity: Record<string, unknown>): string {
    // Your extraction logic
    return "trait_value";
}
```

---

## Best Practices

### 1. Code Organization

- Keep services focused on single responsibility
- Use clear naming conventions
- Document public APIs
- Add debug logging

### 2. Error Handling

```typescript
try {
    // Your code
} catch (err) {
    debug_error("MyService", "Operation failed", err);
    // Graceful fallback
}
```

### 3. Testing

- Test edge cases
- Test with multiple NPCs
- Test error conditions
- Test performance with large data

### 4. Documentation

- Update ARCHITECTURE.md
- Add to SERVICES.md
- Document new actions in STAGES.md
- Update this guide

### 5. Backward Compatibility

- Don't break existing message formats
- Provide fallbacks for new features
- Gradual migration paths
- Version your changes

### 6. Performance

- Cache frequently accessed data
- Lazy load large datasets
- Batch operations where possible
- Profile before optimizing

---

## Common Patterns

### Pattern 1: Service Communication

```typescript
// Service A sends message
const msg = create_message({
    sender: "service_a",
    content: "data",
    stage: "service_b_input",
    status: "sent"
});
append_inbox_message(inbox_path, msg);

// Service B processes
for (const msg of inbox.messages) {
    if (msg.stage === "service_b_input") {
        // Process
    }
}
```

### Pattern 2: State Machine Integration

```typescript
// In your service
const turn_state = get_turn_state(event_id);
if (turn_state && turn_state.phase === "ACTION_SELECTION") {
    // Do something during action selection
}
```

### Pattern 3: Working Memory Access

```typescript
const memory = get_working_memory(slot, event_id);
if (memory) {
    // Access memory data
    const participants = memory.participants;
    const events = memory.recent_events;
}
```

### Pattern 4: NPC Memory Access

```typescript
const memories = get_memories_about(slot, npc_ref, player_ref);
for (const memory of memories) {
    // Use memory in decision making
}
```

---

## Debugging Extensions

### Enable Debug Logging

```typescript
import { debug_log, debug_pipeline } from "../shared/debug.js";

debug_log("MyExtension", "Operation started", { data });
debug_pipeline("MyExtension", "Processing message", { msg_id: msg.id });
```

### Check Service Status

```bash
# Check if service is running
ps aux | grep my_service

# Check logs
tail -f local_data/data_slot_1/log.jsonc | grep my_service

# Check outbox
cat local_data/data_slot_1/outbox.jsonc | grep my_service
```

### Test Integration

```bash
# Run type checking
npx tsc --noEmit

# Test service individually
npm run my_service_dev

# Test full pipeline
npm run dev
```

---

## Examples

### Example 1: Adding a "Barter" Action

See full implementation in [examples/adding_action.md](./examples/adding_action.md)

### Example 2: Creating a Merchant NPC

See full implementation in [examples/creating_npc.md](./examples/creating_npc.md)

### Example 3: Adding a Custom Service

See full implementation in [examples/custom_service.md](./examples/custom_service.md)

---

## Resources

- [Architecture Overview](../design/ARCHITECTURE.md)
- [Service APIs](../design/SERVICES.md)
- [AI Prompts](./AI_PROMPTS.md)
- [Runtime Contracts](../contracts/message_bus.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Support

For questions or issues:
- Check existing documentation
- Review examples
- Check logs for errors
- Test incrementally

# THAUMWORLD AI Agent Guide

Quick reference for AI agents working on the THAUMWORLD Auto Story Teller system.

**For comprehensive docs, see:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System overview
- [SERVICES.md](./SERVICES.md) - Service details
- [STAGES.md](./STAGES.md) - Message flow
- [EFFECTS.md](./EFFECTS.md) - RPG effects
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error standards

## Quick Start (5 Minutes)

### 1. System Pattern (Memorize This)
```
File-based message pipeline:
- Services read from outbox.jsonc
- Services write to inbox.jsonc or outbox.jsonc
- Messages have stage and status fields
- Router in Breath() coordinates flow
```

### 2. Message Flow (Always Follows This)
```
User Input → interface → inbox
  ↓
Breath() routes to interpreter_ai stage in outbox
  ↓
interpreter_ai reads outbox → writes interpreted_1 to inbox
  ↓
Router moves to outbox as interpreted_1
  ↓
data_broker reads → writes brokered_1
  ↓
rules_lawyer reads → writes ruling_1 (pending_state_apply)
  ↓
state_applier reads → writes applied_1
  ↓
renderer_ai reads → writes rendered_1 to inbox
  ↓
Canvas displays rendered_1
```

### 3. Key File Locations
```
Code: src/SERVICE_NAME/main.ts
Data: local_data/data_slot_1/
  - inbox.jsonc (inputs)
  - outbox.jsonc (outputs)
  - log.jsonc (audit trail)
  - actors/ (character files)
  - npcs/ (NPC files)
```

## Common Tasks (Copy-Paste Patterns)

### Task 1: Add New Effect

**Files to modify:**
1. `docs/EFFECTS.md` - Document the effect
2. `src/rules_lawyer/effects.ts` - Add handler (parser auto-handles SYSTEM.*)
3. `src/state_applier/apply.ts` - Add implementation

**Template for rules_lawyer:**
```typescript
function handleNewEffect(
    command: CommandNode,
    slot: number,
    event_lines: string[],
    effect_lines: string[]
): void {
    const target = resolveArg(command.args.target);
    const amount = resolveArg(command.args.amount);
    
    if (!target) {
        event_lines.push(`NOTE.INVALID_TARGET(verb=NEW_EFFECT)`);
        return;
    }
    
    effect_lines.push(`SYSTEM.NEW_EFFECT(target=${target}, amount=${amount})`);
    event_lines.push(`${command.subject}.NEW_EFFECT(target=${target}, amount=${amount})`);
}
```

**Template for state_applier:**
```typescript
function applyNewEffect(
    command: CommandNode,
    target_paths: Record<string, string>,
    applied_effect_ids: Set<string>
): ApplyResult {
    const diffs: AppliedDiff[] = [];
    const warnings: string[] = [];
    
    const target_ref = resolveArg(command.args.target);
    const amount = Number(resolveArg(command.args.amount));
    
    const target_path = target_paths[target_ref];
    if (!target_path) {
        warnings.push(`Target not resolved: ${target_ref}`);
        return { diffs, warnings };
    }
    
    // Deduplication
    const effect_id = `new_effect:${target_ref}:${amount}`;
    if (applied_effect_ids.has(effect_id)) {
        return { diffs, warnings };
    }
    applied_effect_ids.add(effect_id);
    
    // Load, modify, save
    const target_data = read_jsonc(target_path);
    
    // ... apply changes ...
    
    write_jsonc(target_path, target_data);
    
    diffs.push({
        effect_id,
        target: target_ref,
        field: "field_name",
        delta: amount,
        reason: "New effect applied"
    });
    
    return { diffs, warnings };
}
```

### Task 2: Create New Service

**Step 1:** Create `src/my_service/main.ts`:
```typescript
import { get_data_slot_dir, get_log_path, get_outbox_path, get_inbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, append_outbox_message } from "../engine/outbox_store.js";
import { create_message } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_error, log_service_error } from "../shared/debug.js";

const data_slot_number = 1;
const POLL_MS = 800;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function process_message(
    outbox_path: string,
    inbox_path: string,
    log_path: string,
    msg: MessageEnvelope
): Promise<void> {
    // Your processing logic here
    
    // Create output
    const output: MessageInput = {
        sender: "my_service",
        content: "processing complete",
        stage: "my_stage",
        status: "sent",
        reply_to: msg.id,
        correlation_id: msg.correlation_id
    };
    
    append_outbox_message(outbox_path, create_message(output));
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        const candidates = outbox.messages.filter((m) => {
            return m.stage?.startsWith("expected_stage") && m.status === "sent";
        });
        
        for (const msg of candidates) {
            try {
                await process_message(outbox_path, inbox_path, log_path, msg);
            } catch (err) {
                log_service_error(
                    "my_service",
                    "process_message",
                    { message_id: msg.id, correlation_id: msg.correlation_id },
                    err
                );
            }
        }
    } catch (err) {
        log_service_error("my_service", "tick", {}, err);
    }
}

function initialize() {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
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
```

**Step 2:** Add to `package.json`:
```json
"dev": "concurrently ... \"tsx src/my_service/main.ts\" ..."
```

**Step 3:** Add router handling in `src/engine/router.ts`:
```typescript
} else if (stage.startsWith("my_stage")) {
    result = {
        log: message,
        outbox: { ...message, status: "sent" }
    };
}
```

### Task 3: Debug Message Flow

**Check if service is processing:**
```bash
# Run with debug
set DEBUG_LEVEL=3
npm run dev

# Watch for your service name in output
# [MyService] POLL - X messages
# [MyService] FOUND Y CANDIDATES
```

**Check outbox for your stage:**
```bash
cat local_data/data_slot_1/outbox.jsonc | grep "my_stage"
```

**Check if messages have correct status:**
```bash
cat local_data/data_slot_1/outbox.jsonc | jq '.messages | map(select(.stage | contains("my_stage"))) | map({id, status})'
```

### Task 4: Add Error Handling

**Always use this pattern:**
```typescript
import { log_service_error } from "../shared/debug.js";

try {
    await risky_operation();
} catch (err) {
    log_service_error(
        "service_name",
        "operation_name",
        { 
            message_id: msg.id,
            correlation_id: msg.correlation_id,
            context: "additional info"
        },
        err,
        'error'  // or 'warning' or 'critical'
    );
    // Continue or return based on severity
}
```

## Critical Rules (Never Break These)

### 1. Always Check Status Before Processing
```typescript
// CORRECT:
const candidates = outbox.messages.filter((m) => {
    return m.stage?.startsWith("my_stage") && m.status === "sent";
});

// WRONG (will process same message multiple times):
const candidates = outbox.messages.filter((m) => {
    return m.stage?.startsWith("my_stage");  // Missing status check!
});
```

### 2. Always Transition Status
```typescript
// CORRECT:
const processing = try_set_message_status(msg, "processing");
if (!processing.ok) return;
update_outbox_message(outbox_path, processing.message);

// ... do work ...

const done = try_set_message_status(processing.message, "done");
if (done.ok) {
    update_outbox_message(outbox_path, done.message);
}

// WRONG (message stays in "sent", will be reprocessed):
await do_work();
// Forgot to mark as done!
```

### 3. Always Use Correlation ID
```typescript
// CORRECT:
const output: MessageInput = {
    sender: "my_service",
    content: "result",
    stage: "my_stage",
    status: "sent",
    reply_to: msg.id,
    correlation_id: msg.correlation_id  // Preserve it!
};

// WRONG (breaks pipeline tracing):
const output: MessageInput = {
    // ...
    // Missing correlation_id!
};
```

### 4. Always Handle Errors
```typescript
// CORRECT:
for (const msg of candidates) {
    try {
        await process(msg);
    } catch (err) {
        log_service_error("my_service", "process", { msg_id: msg.id }, err);
        // Continue with next message
    }
}

// WRONG (one error stops all processing):
for (const msg of candidates) {
    await process(msg);  // If this throws, loop breaks!
}
```

## Quick Reference Tables

### Stages and Their Purposes

| Stage | Creator | Consumer | Purpose |
|-------|---------|----------|---------|
| interpreter_ai | interface | interpreter_ai | Queue for interpretation |
| interpreted_1 | interpreter | data_broker | Machine text ready |
| brokered_1 | data_broker | rules_lawyer | References resolved |
| ruling_1 | rules_lawyer | state_applier | Rules applied, effects ready |
| applied_1 | state_applier | renderer | State modified |
| rendered_1 | renderer | Display | Narrative ready |
| npc_response | npc_ai | Display | NPC dialogue |

### Status Values and Meanings

| Status | Meaning | Who Sets It |
|--------|---------|-------------|
| queued | Waiting to be sent | interface |
| sent | Ready for processing | Service that creates message |
| processing | Currently being processed | Consumer service |
| pending_state_apply | Waiting for state applier | rules_lawyer |
| done | Processing complete | Consumer service |
| error | Processing failed | Consumer service |
| awaiting_roll_1 | Waiting for dice roll | rules_lawyer |

### Common File Operations

```typescript
// Read outbox
import { read_outbox } from "../engine/outbox_store.js";
const outbox = read_outbox(outbox_path);

// Write to outbox
import { append_outbox_message } from "../engine/outbox_store.js";
import { create_message } from "../engine/message.js";
const msg = create_message({ sender, content, stage, status });
append_outbox_message(outbox_path, msg);

// Read actor
import { load_actor } from "../actor_storage/store.js";
const result = load_actor(slot, actor_id);
if (result.ok) { const actor = result.actor; }

// Read NPC
import { load_npc } from "../npc_storage/store.js";
const result = load_npc(slot, npc_id);
if (result.ok) { const npc = result.npc; }

// Log message
import { append_log_message } from "../engine/log_store.js";
append_log_message(log_path, "sender", "message text");
```

### Debug Levels

| Level | Shows | Use When |
|-------|-------|----------|
| 1 | Errors only | Production |
| 2 | Warnings + errors | Testing |
| 3 | Service flow + info | Development |
| 4 | Full messages + stacks | Deep debugging |

## Troubleshooting

### Problem: Service not processing messages

**Check:**
1. Is service in `package.json` dev command?
2. Is service booting? (Look for "[Service] booted" in logs)
3. Is filter correct? (stage and status)
4. Are messages reaching outbox? (Check with `cat outbox.jsonc | grep stage_name`)

### Problem: Message processed multiple times

**Check:**
1. Are you transitioning status to "done"?
2. Is status filter specific enough?
3. Are you using atomic file operations?

### Problem: Pipeline breaks at my service

**Check:**
1. Are you preserving correlation_id?
2. Are you setting correct stage on output?
3. Are you routing through router.ts?
4. Check error_log.jsonc for errors

### Problem: Can't find actor/NPC data

**Check:**
1. Is slot number correct? (usually 1)
2. Does file exist in local_data/data_slot_1/actors/ or npcs/?
3. Is ID correct? (check for typos)
4. Use load_actor/load_npc result.ok check

## Testing Your Changes

### 1. Build
```bash
npm run build
```

### 2. Run with Debug
```bash
set DEBUG_LEVEL=3
npm run dev
```

### 3. Trigger Action
Use game interface to trigger your code path.

### 4. Check Logs
```bash
# Console shows service activity
# Check error_log.jsonc for errors
cat local_data/data_slot_1/logs/error_log.jsonc
```

### 5. Verify Output
```bash
# Check outbox for your stage
cat local_data/data_slot_1/outbox.jsonc | jq '.messages | map(select(.stage | contains("your_stage")))'
```

## Resources

- **THAUMWORLD Rules:** https://www.thaumworld.xyz/rules-index/
- **Examples:** See docs/examples/README.md
- **Architecture:** See docs/ARCHITECTURE.md
- **Services:** See docs/SERVICES.md

## Remember

1. **Read before you write** - Check existing code patterns
2. **Test with DEBUG_LEVEL=3** - See what's happening
3. **Use error logging** - Never silently fail
4. **Preserve correlation_id** - Maintain pipeline traceability
5. **Check status transitions** - Prevent reprocessing

**When in doubt, look at an existing service and copy the pattern.**
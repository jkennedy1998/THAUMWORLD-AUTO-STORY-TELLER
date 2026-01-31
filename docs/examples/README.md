# THAUMWORLD Examples

Working code examples for common modifications and tasks.

## Example 1: Adding a New Effect

**Goal:** Add `SYSTEM.APPLY_POISON` effect that deals damage over time

### Step 1: Document the Effect

Add to `docs/EFFECTS.md`:
```markdown
### SYSTEM.APPLY_POISON
Apply poison damage over time to target.

**Syntax:**
```
SYSTEM.APPLY_POISON(
    target=actor|npc.<id>,
    amount=<number>,
    duration=<number>,
    type=<damage_type>
)
```

**Example:**
```
SYSTEM.APPLY_POISON(target=npc.goblin, amount=2, duration=5, type=poison)
```

**Implementation:**
- Reduces health.current by `amount` each turn
- Lasts for `duration` turns
- Creates POISONED tag on target
```

### Step 2: Add Parser Support

Edit `src/system_syntax/index.ts`:
```typescript
// In parse_machine_text, ensure POISON is recognized as valid effect
const VALID_EFFECTS = [
    'SYSTEM.APPLY_DAMAGE',
    'SYSTEM.APPLY_HEAL',
    'SYSTEM.APPLY_POISON',  // Add this
    // ... other effects
];
```

### Step 3: Add Rules Lawyer Handler

Edit `src/rules_lawyer/effects.ts`:
```typescript
function handlePoisonEffect(
    command: CommandNode,
    slot: number,
    event_lines: string[],
    effect_lines: string[]
): void {
    const target = resolveArg(command.args.target);
    const amount = resolveArg(command.args.amount);
    const duration = resolveArg(command.args.duration);
    
    // Validate target
    if (!target) {
        event_lines.push(`NOTE.INVALID_TARGET(verb=APPLY_POISON)`);
        return;
    }
    
    // Add effect
    effect_lines.push(`SYSTEM.APPLY_POISON(target=${target}, amount=${amount}, duration=${duration})`);
    
    // Add event
    event_lines.push(`${command.subject}.POISON(target=${target}, amount=${amount}, duration=${duration})`);
}

// In main effect switch:
if (command.verb === 'APPLY_POISON') {
    handlePoisonEffect(command, slot, event_lines, effect_lines);
}
```

### Step 4: Add State Applier Implementation

Edit `src/state_applier/apply.ts`:
```typescript
function applyPoison(
    command: CommandNode,
    target_paths: Record<string, string>,
    applied_effect_ids: Set<string>
): ApplyResult {
    const diffs: AppliedDiff[] = [];
    const warnings: string[] = [];
    
    const target_ref = resolveArg(command.args.target);
    const amount = Number(resolveArg(command.args.amount));
    const duration = Number(resolveArg(command.args.duration));
    
    const target_path = target_paths[target_ref];
    if (!target_path) {
        warnings.push(`Target not resolved: ${target_ref}`);
        return { diffs, warnings };
    }
    
    // Generate effect ID for deduplication
    const effect_id = `poison:${target_ref}:${amount}:${duration}`;
    if (applied_effect_ids.has(effect_id)) {
        return { diffs, warnings };
    }
    applied_effect_ids.add(effect_id);
    
    // Load target
    const target_data = read_jsonc(target_path);
    
    // Apply immediate damage
    const current_health = target_data.resources?.health?.current ?? 0;
    const new_health = Math.max(0, current_health - amount);
    
    // Add POISONED tag
    if (!target_data.tags) target_data.tags = [];
    if (!target_data.tags.includes('POISONED')) {
        target_data.tags.push('POISONED');
    }
    
    // Store poison data for duration tracking
    if (!target_data.active_effects) target_data.active_effects = [];
    target_data.active_effects.push({
        type: 'POISON',
        amount,
        duration,
        remaining: duration
    });
    
    // Save
    target_data.resources.health.current = new_health;
    write_jsonc(target_path, target_data);
    
    // Record diff
    diffs.push({
        effect_id,
        target: target_ref,
        field: 'health.current',
        delta: -amount,
        reason: `Poison damage (${duration} turns remaining)`
    });
    
    return { diffs, warnings };
}

// In main apply switch:
if (command.verb === 'APPLY_POISON') {
    return applyPoison(command, target_paths, applied_effect_ids);
}
```

### Step 5: Test

```bash
npm run dev
```

In game:
```
Player: "cast poison on goblin"
System: Should parse, apply poison effect, show damage
```

---

## Example 2: Adding a New Service

**Goal:** Create a weather service that periodically updates weather

### Step 1: Create Service File

Create `src/weather/main.ts`:
```typescript
import { get_data_slot_dir, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message } from "../engine/log_store.js";
import { ensure_outbox_exists, read_outbox, append_outbox_message } from "../engine/outbox_store.js";
import { create_message } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { debug_log } from "../shared/debug.js";
import * as fs from "node:fs";
import * as path from "node:path";

const data_slot_number = 1;
const POLL_MS = 30_000; // Every 30 seconds

const WEATHER_TYPES = ['clear', 'rain', 'fog', 'storm'];

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function get_weather_path(slot: number): string {
    return path.join(process.cwd(), 'local_data', `data_slot_${slot}`, 'weather.jsonc');
}

function read_weather(pathname: string): { current: string; last_change: string } {
    if (!fs.existsSync(pathname)) {
        return { current: 'clear', last_change: new Date().toISOString() };
    }
    try {
        return JSON.parse(fs.readFileSync(pathname, 'utf-8'));
    } catch {
        return { current: 'clear', last_change: new Date().toISOString() };
    }
}

function write_weather(pathname: string, weather: { current: string; last_change: string }): void {
    fs.writeFileSync(pathname, JSON.stringify(weather, null, 2), 'utf-8');
}

async function tick(outbox_path: string, log_path: string): Promise<void> {
    const weather_path = get_weather_path(data_slot_number);
    const weather = read_weather(weather_path);
    
    // Check if should change (every 5 minutes)
    const last_change = new Date(weather.last_change);
    const now = new Date();
    const minutes_since_change = (now.getTime() - last_change.getTime()) / 1000 / 60;
    
    if (minutes_since_change >= 5) {
        // Pick new weather
        const new_weather = WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)];
        
        if (new_weather !== weather.current) {
            // Update weather
            weather.current = new_weather;
            weather.last_change = now.toISOString();
            write_weather(weather_path, weather);
            
            // Create message
            const output: MessageInput = {
                sender: "weather_service",
                content: `Weather changed to ${new_weather}`,
                stage: "weather_event",
                status: "sent",
                meta: {
                    weather_type: new_weather,
                    previous: weather.current
                }
            };
            
            append_outbox_message(outbox_path, create_message(output));
            append_log_message(log_path, "weather", `Weather changed: ${new_weather}`);
            
            debug_log("Weather: changed", { from: weather.current, to: new_weather });
        }
    }
    
    await sleep(0);
}

function initialize(): { outbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, log_path };
}

const { outbox_path, log_path } = initialize();
debug_log("Weather: booted");

setInterval(() => {
    void tick(outbox_path, log_path);
}, POLL_MS);
```

### Step 2: Add to Package.json

Edit `package.json`:
```json
"dev": "concurrently \"tsx src/interface_program/main.ts\" \"tsx src/interpreter_ai/main.ts\" \"tsx src/data_broker/main.ts\" \"tsx src/rules_lawyer/main.ts\" \"tsx src/renderer_ai/main.ts\" \"tsx src/roller/main.ts\" \"tsx src/state_applier/main.ts\" \"tsx src/npc_ai/main.ts\" \"tsx src/weather/main.ts\" \"vite\" \"wait-on http://localhost:5173 && electron .\""
```

### Step 3: Update Router

Edit `src/engine/router.ts`:
```typescript
} else if (stage.startsWith("weather_event")) {
    result = {
        log: message,
        outbox: {
            ...message,
            status: "sent"
        }
    };
}
```

### Step 4: Update Renderer

Edit `src/renderer_ai/main.ts`:
Add weather event handling to prompt builder.

---

## Example 3: Modifying NPC Response Logic

**Goal:** Make NPCs respond differently based on time of day

### Step 1: Modify NPC AI Service

Edit `src/npc_ai/main.ts`:

Add time check to prompt building:
```typescript
function build_npc_prompt(npc: any, player_text: string, can_perceive: boolean, clarity: string): string {
    // ... existing code ...
    
    // Add time context
    const hour = new Date().getHours();
    let time_context = '';
    if (hour >= 5 && hour < 12) time_context = 'Morning';
    else if (hour >= 12 && hour < 17) time_context = 'Afternoon';
    else if (hour >= 17 && hour < 21) time_context = 'Evening';
    else time_context = 'Night';
    
    // Add to prompt
    prompt_parts.push(`\nTIME: It is currently ${time_context}.`);
    
    // Add time-based behavior hints
    const personality = npc.personality || {};
    if (time_context === 'Night' && personality.fear?.includes('dark')) {
        prompt_parts.push('You are nervous because it is dark.');
    }
    if (time_context === 'Morning' && personality.hobby?.includes('breakfast')) {
        prompt_parts.push('You are enjoying your morning routine.');
    }
    
    // ... rest of prompt building ...
}
```

### Step 2: Test

Run game at different times, NPCs should reference time in responses.

---

## Example 4: Adding Debug Command

**Goal:** Create `/debug` command to dump system state

### Step 1: Add to Interface Program

Edit `src/interface_program/main.ts`:

In HTTP handler:
```typescript
if (url.pathname === "/api/debug") {
    const debug_info = {
        outbox: read_outbox(outbox_path),
        inbox: read_inbox(inbox_path),
        status: read_status(status_path),
        timestamp: new Date().toISOString()
    };
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(debug_info, null, 2));
    return;
}
```

### Step 2: Use

```bash
curl http://localhost:8787/api/debug
```

---

## Example 5: Custom Character Creation Step

**Goal:** Add "alignment" selection to character creation

### Step 1: Update Creation Flow

Edit `src/interface_program/main.ts`:

Add to `CreationState`:
```typescript
type CreationState = {
    // ... existing fields ...
    step: "kind" | "name" | "stats" | "background" | "profs" | "alignment" | "gifts" | "confirm";
    data: {
        // ... existing fields ...
        alignment?: string;
    };
};
```

Add alignment options:
```typescript
const ALIGNMENTS = ["lawful-good", "neutral-good", "chaotic-good", "lawful-neutral", "true-neutral", "chaotic-neutral", "lawful-evil", "neutral-evil", "chaotic-evil"];
```

### Step 2: Add Step Handler

In `handle_creation_input`:
```typescript
if (step === "profs") {
    // ... existing prof handling ...
    
    state.step = "alignment";
    state.data = data;
    write_creation_state(creation_path, state);
    append_log_message(log_path, "system", "Choose your alignment:\n" + ALIGNMENTS.map(a => `- ${a}`).join("\n"));
    append_log_message(log_path, "hint", "Example: lawful-good");
    return { user_message_id: user_msg.id };
}

if (step === "alignment") {
    const alignment = text.trim().toLowerCase();
    if (!ALIGNMENTS.includes(alignment)) {
        append_log_message(log_path, "system", `Invalid alignment. Choose from: ${ALIGNMENTS.join(", ")}`);
        return { user_message_id: user_msg.id };
    }
    data.alignment = alignment;
    state.step = "gifts";  // or whatever is next
    // ... continue flow ...
}
```

### Step 3: Save to Actor

In `create_actor_from_kind`:
```typescript
const actor = {
    // ... existing fields ...
    alignment: data.alignment || "true-neutral",
    // ...
};
```

---

## Common Patterns

### Reading Files
```typescript
import { read_jsonc } from "../engine/jsonc.js";
const data = read_jsonc(path);
```

### Writing Files
```typescript
import { write_jsonc } from "../engine/jsonc.js";
write_jsonc(path, data);
```

### Appending to Log
```typescript
import { append_log_message } from "../engine/log_store.js";
append_log_message(log_path, "sender_name", "message content");
```

### Creating Messages
```typescript
import { create_message } from "../engine/message.js";
import { append_outbox_message } from "../engine/outbox_store.js";

const msg = create_message({
    sender: "my_service",
    content: "message text",
    stage: "my_stage",
    status: "sent"
});
append_outbox_message(outbox_path, msg);
```

### Debug Logging
```typescript
import { debug_log, debug_error } from "../shared/debug.js";
debug_log("Service: message", { data });
debug_error("Service", "error description", error);
```

---

## Testing Changes

### 1. Build
```bash
npm run build
```

### 2. Run with Debug
```bash
set DEBUG_LEVEL=3
npm run dev
```

### 3. Monitor Logs
Watch terminal for service logs.

### 4. Check Files
```bash
# Watch outbox
cat local_data/data_slot_1/outbox.jsonc

# Check specific service
npm run service_dev  # e.g., npc_ai_dev
```

---

## Next Steps

- See [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview
- See [SERVICES.md](./SERVICES.md) for service details
- See [STAGES.md](./STAGES.md) for stage documentation
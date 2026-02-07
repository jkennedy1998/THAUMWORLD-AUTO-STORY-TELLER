# Critical Issues Fix Plan
**Date:** February 2, 2026  
**Priority:** CRITICAL  
**Estimated Time:** 4-6 hours  
**Risk Level:** Medium (requires careful testing)

---

## Executive Summary

Three critical issues are breaking the tabletop RPG experience:
1. **Working Memory Empty** - Events not recorded (root cause: ID mismatch)
2. **Message Duplication** - 40% of messages are duplicates causing duplicate processing
3. **Conversation Fragmentation** - Multiple conversation IDs per interaction

This plan provides a systematic approach to fix all three issues with minimal risk.

---

## Phase 1: Working Memory System Fix (CRITICAL)

### Problem Analysis

**Current Flow:**
1. Turn manager creates working memory with `event_id` from timed event store
2. Messages get `correlation_id` set to session/message chain ID (different from event_id)
3. State applier looks for working memory by `correlation_id` 
4. **FAIL:** No memory found because IDs don't match
5. Events never recorded to working memory

**Root Cause:** `src/state_applier/main.ts:349-389` checks `get_working_memory(data_slot_number, correlation_id)` but working memory was created with `event_id` from timed event.

### Solution

**Option A: Use Event ID as Correlation ID (Recommended)**
- When timed event is active, set message `correlation_id` to `event_id`
- State applier will find working memory correctly
- Minimal code changes, maintains existing architecture

**Option B: Create Working Memory on Demand**
- If working memory not found by correlation_id, create it
- More complex, requires knowing region and participants
- Risk of creating orphaned memory entries

**Decision: Implement Option A**

### Implementation Steps

#### Step 1.1: Modify Message Creation in Interface Program
**File:** `src/interface_program/main.ts`  
**Lines:** ~520-580 (where user input messages are created)

**Current Code:**
```typescript
const message_input: MessageInput = {
    sender: "henry_actor",
    content: user_input,
    type: "user_input",
    stage: "interpreter_ai",
    status: "sent",
    correlation_id: generate_id(), // Random ID
    // ...
};
```

**New Code:**
```typescript
// Check if timed event is active and use event_id as correlation_id
const timed_event = get_timed_event_state(data_slot_number);
const correlation_id = timed_event?.event_id || generate_id();

const message_input: MessageInput = {
    sender: "henry_actor",
    content: user_input,
    type: "user_input",
    stage: "interpreter_ai",
    status: "sent",
    correlation_id: correlation_id, // Now matches working memory
    // ...
};
```

#### Step 1.2: Ensure Working Memory Exists Before State Application
**File:** `src/state_applier/main.ts`  
**Lines:** 348-389

**Current Code:**
```typescript
const correlation_id = msg.correlation_id;
if (correlation_id && events && events.length > 0) {
    const memory = get_working_memory(data_slot_number, correlation_id);
    if (memory) {
        // ... add event
    }
}
```

**New Code:**
```typescript
const correlation_id = msg.correlation_id;
if (correlation_id && events && events.length > 0) {
    let memory = get_working_memory(data_slot_number, correlation_id);
    
    // If no memory exists but we have a timed event, create working memory
    if (!memory) {
        const timed_event = get_timed_event_state(data_slot_number);
        if (timed_event?.event_id === correlation_id) {
            // Build working memory from current state
            const region_id = timed_event.region_id || get_current_region(data_slot_number);
            const participants = extract_participants_from_events(events);
            
            memory = await build_working_memory(
                data_slot_number,
                correlation_id,
                detect_event_type(events),
                region_id,
                participants
            );
        }
    }
    
    if (memory) {
        // ... add event (existing code)
    }
}
```

#### Step 1.3: Add Helper Functions
**File:** `src/state_applier/main.ts`  
**Add after imports:**

```typescript
function detect_event_type(events: string[]): "combat" | "conversation" | "exploration" {
    const event_text = events.join(" ");
    if (event_text.includes("ATTACK") || event_text.includes("DEFEND")) return "combat";
    if (event_text.includes("COMMUNICATE")) return "conversation";
    return "exploration";
}

function extract_participants_from_events(events: string[]): string[] {
    const participants = new Set<string>();
    for (const event of events) {
        // Extract actor
        const actor_match = event.match(/^(actor|npc)\.([^\.]+)/);
        if (actor_match) {
            participants.add(`${actor_match[1]}.${actor_match[2]}`);
        }
        // Extract target
        const target_match = event.match(/target=(actor|npc)\.([^,)]+)/);
        if (target_match) {
            participants.add(`${target_match[1]}.${target_match[2]}`);
        }
    }
    return Array.from(participants);
}

function get_current_region(slot: number): string {
    // Get region from player location
    const player_result = load_actor(slot, "henry_actor");
    if (player_result.ok && player_result.actor.location?.region_tile) {
        const loc = player_result.actor.location;
        return `region.${loc.world_tile?.x}_${loc.world_tile?.y}_${loc.region_tile?.x}_${loc.region_tile?.y}`;
    }
    return "region.0_0_0_0"; // Default fallback
}
```

#### Step 1.4: Update Context Manager Exports
**File:** `src/context_manager/index.ts`  
**Lines:** Add to exports

```typescript
export { build_working_memory, get_working_memory, add_event_to_memory };
export type { WorkingMemory, RecentEvent };
```

### Testing Strategy

1. **Unit Test:** Create timed event, send message, verify working memory populated
2. **Integration Test:** Full pipeline test with 3-4 player actions
3. **Verification:** Check `working_memory.jsonc` has entries after each action

### Success Criteria
- [ ] `working_memory.jsonc` contains events after player actions
- [ ] Each event has: turn, actor, action, target, outcome, emotional_tone
- [ ] NPCs can access working memory for context-aware responses

---

## Phase 2: Message Deduplication (HIGH PRIORITY)

### Problem Analysis

**Current Flow:**
1. State applier creates "applied_1" message for EVERY ruling
2. Messages appended to outbox with `append_outbox_message()`
3. If multiple rulings for same action, multiple messages created
4. NPC AI processes all messages, causing duplicate responses
5. **Result:** 40% message duplication, duplicate NPC responses

**Root Causes:**
- `src/state_applier/main.ts:391-430` creates new message without checking for existing
- Services use `append_outbox_message()` instead of `update_outbox_message()`
- No deduplication logic in outbox store

### Solution

Implement three-layer deduplication:
1. **Prevention:** Don't create duplicate messages
2. **Detection:** Check for existing messages before appending
3. **Cleanup:** Remove duplicates on read

### Implementation Steps

#### Step 2.1: Add Message Deduplication to Outbox Store
**File:** `src/engine/outbox_store.ts`  
**Lines:** Add new function after `update_outbox_message`

```typescript
export function append_outbox_message_deduped(
    outbox_path: string, 
    message: MessageEnvelope
): MessageEnvelope {
    const outbox = read_outbox(outbox_path);
    
    // Check for existing message with same ID
    const existing_index = outbox.messages.findIndex(m => m.id === message.id);
    if (existing_index >= 0) {
        // Update existing message instead of adding duplicate
        outbox.messages[existing_index] = { ...outbox.messages[existing_index], ...message };
        write_outbox(outbox_path, outbox);
        return message;
    }
    
    // No duplicate found, append as normal
    outbox.messages.unshift(message);
    const pruned = prune_outbox_messages(outbox, 10);
    write_outbox(outbox_path, pruned);
    return message;
}

export function remove_duplicate_messages(outbox_path: string): void {
    const outbox = read_outbox(outbox_path);
    const seen_ids = new Set<string>();
    const unique_messages: MessageEnvelope[] = [];
    
    for (const msg of outbox.messages) {
        if (!seen_ids.has(msg.id)) {
            seen_ids.add(msg.id);
            unique_messages.push(msg);
        }
        // If duplicate found, keep the one with higher priority status
        // (done > processing > sent > queued)
    }
    
    outbox.messages = unique_messages;
    write_outbox(outbox_path, outbox);
}
```

#### Step 2.2: Update State Applier to Use Deduplicated Append
**File:** `src/state_applier/main.ts`  
**Lines:** 391-430 (message creation section)

**Current Code:**
```typescript
// Step 4: ALWAYS create applied_1 message for every ruling
const output: MessageInput = {
    sender: "state_applier",
    content: "state applied",
    stage: "applied_1",
    status: "sent",
    reply_to: msg.id,
    correlation_id: msg.correlation_id,
    meta: { /* ... */ }
};

const applied_msg = create_message(output);
append_outbox_message(outbox_path, applied_msg);
```

**New Code:**
```typescript
// Step 4: Create applied_1 message with deduplication
// Use deterministic ID based on reply_to to prevent duplicates
const output: MessageInput = {
    id: `${msg.id}_applied`, // Deterministic ID
    sender: "state_applier",
    content: "state applied",
    stage: "applied_1",
    status: "sent",
    reply_to: msg.id,
    correlation_id: msg.correlation_id,
    meta: { /* ... */ }
};

const applied_msg = create_message(output);
append_outbox_message_deduped(outbox_path, applied_msg);
```

#### Step 2.3: Add Deduplication to Service Polling
**File:** `src/npc_ai/main.ts`  
**Lines:** 740-788 (tick function)

**Current Code:**
```typescript
const candidates = messages.filter(msg => {
    // ... filtering logic
});

for (const msg of candidates) {
    // Process each message
}
```

**New Code:**
```typescript
const candidates = messages.filter(msg => {
    // ... existing filtering logic
});

// Deduplicate by ID before processing
const unique_candidates = candidates.filter((msg, index, self) => 
    index === self.findIndex(m => m.id === msg.id)
);

if (unique_candidates.length < candidates.length) {
    debug_log("NPC_AI", `Filtered ${candidates.length - unique_candidates.length} duplicate messages`);
}

for (const msg of unique_candidates) {
    // Process each unique message
}
```

#### Step 2.4: Clean Outbox on Startup
**File:** `src/npc_ai/main.ts`  
**Lines:** 790-802 (initialize function)

**Add after outbox initialization:**
```typescript
function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    // ... existing initialization
    
    // Clean up any duplicate messages from previous sessions
    remove_duplicate_messages(outbox_path);
    debug_log("NPC_AI", "Cleaned outbox duplicates on startup");
    
    return { outbox_path, inbox_path, log_path };
}
```

### Testing Strategy

1. **Unit Test:** Send same message twice, verify only one in outbox
2. **Integration Test:** Process action with multiple rulings, verify single applied message
3. **Load Test:** Send 50 messages rapidly, verify no duplicates

### Success Criteria
- [ ] Outbox contains <5% duplicate messages
- [ ] NPC AI processes each message exactly once
- [ ] State applier creates only one applied message per ruling
- [ ] Startup cleanup removes existing duplicates

---

## Phase 3: Conversation Threading Fix (HIGH PRIORITY)

### Problem Analysis

**Current Flow:**
1. Player sends message in region with NPCs
2. Interpreter AI generates random `conversation_id` for each interpretation
3. NPC AI creates new conversation for each response
4. **Result:** 5+ conversation IDs for single interaction

**Root Cause:** `src/conversation_manager/index.ts:45` uses random ID generation:
```typescript
const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
```

No logic exists to:
- Check for existing active conversation in region
- Reuse conversation ID across related messages
- Link conversation to session/region

### Solution

Implement consistent conversation ID generation based on:
- Session ID (groups messages from same play session)
- Region ID (groups messages in same location)
- Primary NPC (groups messages with same NPC)

### Implementation Steps

#### Step 3.1: Create Conversation ID Generator
**File:** `src/conversation_manager/index.ts`  
**Lines:** Add after imports

```typescript
// Generate consistent conversation ID based on context
export function generate_conversation_id(
    session_id: string,
    region_id: string,
    primary_participant?: string
): string {
    // Create deterministic ID from session + region + primary participant
    const base = primary_participant 
        ? `${session_id}:${region_id}:${primary_participant}`
        : `${session_id}:${region_id}`;
    
    // Hash to create manageable ID while maintaining uniqueness
    const hash = Buffer.from(base).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
    return `conv_${hash}`;
}

// Find or create conversation for context
export function find_or_create_conversation(
    slot: number,
    session_id: string,
    region_id: string,
    initiator: string,
    participants: string[] = []
): string {
    // Find primary participant (first non-initiator)
    const primary = participants.find(p => p !== initiator) || initiator;
    const conversation_id = generate_conversation_id(session_id, region_id, primary);
    
    // Check if conversation already exists
    const data = read_conversations(slot);
    const existing = data.conversations.find(c => c.id === conversation_id);
    
    if (existing && existing.status === "active") {
        debug_log("ConversationManager", "Reusing existing conversation", { conversation_id });
        return conversation_id;
    }
    
    // Create new conversation with deterministic ID
    return start_conversation_with_id(slot, conversation_id, region_id, initiator, participants);
}

// Start conversation with specific ID
function start_conversation_with_id(
    slot: number,
    conversation_id: string,
    region_id: string,
    initiator: string,
    participants: string[] = []
): string {
    const now = new Date().toISOString();
    
    const conversation: Conversation = {
        id: conversation_id,
        schema_version: 1,
        started_at: now,
        region_id,
        participants: [
            {
                ref: initiator,
                name: initiator.split(".")[1] || initiator,
                joined_at: now,
                role: "active"
            },
            ...participants.map(p => ({
                ref: p,
                name: p.split(".")[1] || p,
                joined_at: now,
                role: "passive" as const
            }))
        ],
        messages: [],
        topics_discussed: [],
        unresolved_points: [],
        agreements_reached: [],
        conflicts_raised: [],
        status: "active",
        last_activity: now
    };
    
    const data = read_conversations(slot);
    data.conversations.push(conversation);
    write_conversations(slot, data);
    
    debug_log("ConversationManager", "Started conversation with ID", { conversation_id, region_id, initiator });
    return conversation_id;
}
```

#### Step 3.2: Update Interpreter AI to Use Consistent IDs
**File:** `src/interpreter_ai/main.ts`  
**Lines:** ~300-350 (where conversation_id is assigned)

**Current Code:**
```typescript
const interpreted: MessageInput = {
    // ...
    conversation_id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    // ...
};
```

**New Code:**
```typescript
import { generate_conversation_id } from "../conversation_manager/index.js";

// Extract session_id from incoming message or generate
const session_id = msg.meta?.session_id as string || `session_${Date.now()}`;
const region_id = extract_region_from_context(context); // Helper function needed
const primary_npc = extract_npc_from_command(interpreted_command); // Helper function needed

const conversation_id = generate_conversation_id(session_id, region_id, primary_npc);

const interpreted: MessageInput = {
    // ...
    conversation_id: conversation_id,
    // ...
};
```

#### Step 3.3: Update NPC AI to Reuse Conversation IDs
**File:** `src/npc_ai/main.ts`  
**Lines:** ~350-380 (where conversation is started)

**Current Code:**
```typescript
if (!conversation && conversation_id) {
    // Conversation ID exists but conversation not found, create new
    const player_loc = player_location as { world_tile?: { x: number; y: number }; region_tile?: { x: number; y: number } };
    const region_id = `region.${player_loc.world_tile?.x ?? 0}_${player_loc.world_tile?.y ?? 0}_${player_loc.region_tile?.x ?? 0}_${player_loc.region_tile?.y ?? 0}`;
    const initial_participants = [player_ref];
    conversation = start_conversation(data_slot_number, conversation_id, region_id, initial_participants, undefined);
}
```

**New Code:**
```typescript
import { find_or_create_conversation } from "../conversation_manager/index.js";

if (!conversation) {
    // Use find_or_create to get consistent conversation
    const session_id = msg.meta?.session_id as string || `session_${Date.now()}`;
    const region_id = extract_region_from_location(player_location);
    const participants = [player_ref, `npc.${npc_id}`];
    
    conversation_id = find_or_create_conversation(
        data_slot_number,
        session_id,
        region_id,
        player_ref,
        participants
    );
    
    conversation = get_conversation(data_slot_number, conversation_id);
}
```

### Testing Strategy

1. **Unit Test:** Generate conversation ID twice with same params, verify same ID
2. **Integration Test:** Send 3 messages to same NPC, verify single conversation
3. **Multi-NPC Test:** Send message in room with 2 NPCs, verify conversation includes both

### Success Criteria
- [ ] Single conversation ID per session/region/NPC combination
- [ ] All related messages linked to same conversation
- [ ] NPCs can access full conversation history
- [ ] Conversation persists across multiple player inputs

---

## Phase 4: Integration & Testing

### Step 4.1: Update Service Startup Sequence
**File:** `src/npc_ai/main.ts`, `src/turn_manager/main.ts`  
**Add initialization checks:**

```typescript
// Verify working memory system on startup
const test_memory = get_working_memory(data_slot_number, "test");
if (!test_memory) {
    debug_log("NPC_AI", "Working memory system ready");
}

// Clean up any existing issues
remove_duplicate_messages(outbox_path);
```

### Step 4.2: Add Health Check Endpoint
**File:** Create `src/debug/health_check.ts`

```typescript
export function run_health_check(slot: number): HealthReport {
    const report: HealthReport = {
        timestamp: new Date().toISOString(),
        issues: [],
        status: "healthy"
    };
    
    // Check working memory
    const working_memory = load_working_memory(slot);
    if (working_memory.memories.length === 0) {
        report.issues.push({
            severity: "warning",
            component: "working_memory",
            message: "Working memory is empty - events may not be recording"
        });
    }
    
    // Check for duplicates
    const outbox = read_outbox(get_outbox_path(slot));
    const ids = outbox.messages.map(m => m.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
        report.issues.push({
            severity: "error",
            component: "outbox",
            message: `${duplicates.length} duplicate messages found`
        });
        report.status = "degraded";
    }
    
    // Check conversation fragmentation
    const conversations = read_conversations(slot);
    const active_conversations = conversations.conversations.filter(c => c.status === "active");
    if (active_conversations.length > 10) {
        report.issues.push({
            severity: "warning",
            component: "conversations",
            message: `${active_conversations.length} active conversations - possible fragmentation`
        });
    }
    
    return report;
}
```

### Step 4.3: End-to-End Test Script
**File:** Create `tests/critical_fixes_test.ts`

```typescript
async function test_working_memory(): Promise<boolean> {
    // 1. Start timed event
    // 2. Send player action
    // 3. Verify working memory has entry
    // 4. Send another action
    // 5. Verify both events in memory
}

async function test_message_deduplication(): Promise<boolean> {
    // 1. Send message
    // 2. Check outbox has 1 entry
    // 3. Wait for processing
    // 4. Verify still 1 entry (not duplicated)
}

async function test_conversation_threading(): Promise<boolean> {
    // 1. Send 3 messages to same NPC
    // 2. Verify single conversation ID
    // 3. Verify all 3 messages in conversation
}

async function run_all_tests(): Promise<void> {
    console.log("Testing working memory...");
    const wm_ok = await test_working_memory();
    console.log(wm_ok ? "✓ PASS" : "✗ FAIL");
    
    console.log("Testing message deduplication...");
    const dedup_ok = await test_message_deduplication();
    console.log(dedup_ok ? "✓ PASS" : "✗ FAIL");
    
    console.log("Testing conversation threading...");
    const conv_ok = await test_conversation_threading();
    console.log(conv_ok ? "✓ PASS" : "✗ FAIL");
}
```

---

## Implementation Schedule

| Phase | Task | Time | Dependencies |
|-------|------|------|--------------|
| **Phase 1** | Working Memory Fix | 2 hours | None |
| 1.1 | Modify interface program | 30 min | - |
| 1.2 | Update state applier | 45 min | 1.1 |
| 1.3 | Add helper functions | 30 min | 1.2 |
| 1.4 | Test working memory | 15 min | 1.3 |
| **Phase 2** | Message Deduplication | 1.5 hours | None |
| 2.1 | Add dedup functions | 30 min | - |
| 2.2 | Update state applier | 20 min | 2.1 |
| 2.3 | Update NPC AI | 20 min | 2.2 |
| 2.4 | Test deduplication | 20 min | 2.3 |
| **Phase 3** | Conversation Threading | 1.5 hours | None |
| 3.1 | Create ID generator | 30 min | - |
| 3.2 | Update interpreter | 30 min | 3.1 |
| 3.3 | Update NPC AI | 30 min | 3.2 |
| **Phase 4** | Integration | 1 hour | Phases 1-3 |
| 4.1 | Health checks | 30 min | - |
| 4.2 | End-to-end tests | 30 min | 4.1 |
| **Total** | | **6 hours** | |

---

## Risk Mitigation

### Risk 1: Breaking Existing Functionality
**Mitigation:** 
- Create feature branches for each phase
- Run existing tests before and after changes
- Implement gradual rollout with feature flags

### Risk 2: Data Migration Issues
**Mitigation:**
- Don't delete existing conversations (mark as legacy)
- Create migration script to consolidate fragmented conversations
- Backup data before deployment

### Risk 3: Performance Regression
**Mitigation:**
- Benchmark before/after response times
- Add caching for working memory lookups
- Monitor AI call latency

---

## Rollback Plan

If critical issues arise:

1. **Immediate:** Stop services, restore from backup
2. **Short-term:** Revert to previous commit
3. **Long-term:** Fix forward with patches

**Backup Strategy:**
- Backup `local_data/` before deployment
- Tag git commit before changes
- Document exact rollback commands

---

## Success Metrics

After implementation:

| Metric | Before | Target | Measurement |
|--------|--------|--------|-------------|
| Working Memory Events | 0 | >0 per action | Check `working_memory.jsonc` |
| Message Duplication Rate | 40% | <5% | Count duplicate IDs in outbox |
| Conversation IDs per Session | 5+ | 1-2 | Count active conversations |
| NPC Response Time | 1.8s avg | <2s | Metrics file |
| System Uptime | N/A | 99% | Health check |

---

## Questions for User

Before implementation, please clarify:

1. **Priority:** Should I fix all three issues at once or one at a time?
2. **Testing:** Do you have existing test data/save files I should preserve?
3. **Deployment:** Should I create feature flags or implement directly?
4. **Backup:** Should I backup current data before starting?
5. **Rollback:** How comfortable are you with git revert if needed?

---

**Plan Status:** READY FOR REVIEW  
**Next Step:** User approval → Begin Phase 1 implementation

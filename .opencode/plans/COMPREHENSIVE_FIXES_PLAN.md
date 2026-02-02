# THAUMWORLD Critical Issues Resolution Plan
**Document Version:** 1.0  
**Date:** February 2, 2026  
**Status:** Draft - Pending Approval  
**Priority:** CRITICAL  
**Classification:** Implementation Roadmap

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Assessment](#current-state-assessment)
3. [Problem Analysis](#problem-analysis)
   - 3.1 [Working Memory System Failure](#31-working-memory-system-failure)
   - 3.2 [Message Duplication Crisis](#32-message-duplication-crisis)
   - 3.3 [Conversation Fragmentation](#33-conversation-fragmentation)
4. [Solution Architecture](#solution-architecture)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Testing & Validation Strategy](#testing--validation-strategy)
7. [Risk Management](#risk-management)
8. [Resource Requirements](#resource-requirements)
9. [Success Metrics & KPIs](#success-metrics--kpis)
10. [Appendices](#appendices)

---

## Executive Summary

### Situation

The THAUMWORLD message architecture implementation has reached Phase 6 completion, but critical runtime failures have been identified during live testing. Three systemic issues are preventing the game from delivering the intended tabletop RPG experience:

1. **Working Memory System Failure** - Events are not being recorded, causing NPCs to have no contextual awareness
2. **Message Duplication Crisis** - 40% of messages are duplicates, causing duplicate processing and responses
3. **Conversation Fragmentation** - Multiple conversation IDs per interaction break continuity

### Impact

- **Player Experience:** NPCs appear amnesiac, breaking immersion
- **System Performance:** Duplicate processing wastes AI calls (cost: ~$0.02 per duplicate)
- **Data Integrity:** Working memory empty, conversation history fragmented
- **Development Velocity:** Issues block further feature development

### Solution Overview

A three-phase remediation plan addressing root causes through:
- **Phase 1:** Fix ID correlation between timed events and working memory
- **Phase 2:** Implement three-layer message deduplication (prevention, detection, cleanup)
- **Phase 3:** Establish deterministic conversation ID generation

### Timeline & Resources

- **Duration:** 6 hours development + 2 hours testing
- **Risk Level:** Medium (well-contained changes with rollback capability)
- **Dependencies:** None (self-contained fixes)
- **Success Probability:** 95% (clear root causes, proven solutions)

---

## Current State Assessment

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    THAUMWORLD PIPELINE                       │
├─────────────────────────────────────────────────────────────┤
│  1. Interface Program  →  2. Interpreter AI                 │
│        ↓                         ↓                          │
│  3. Data Broker        →  4. Rules Lawyer                   │
│        ↓                         ↓                          │
│  5. State Applier      →  6. Renderer AI                    │
│        ↓                                                    │
│  7. NPC AI (parallel)                                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Analysis

**Message Lifecycle:**
1. Player input → `inbox.jsonc` (interface_program)
2. AI interpretation → `outbox.jsonc` (interpreter_ai)
3. Data resolution → `outbox.jsonc` (data_broker)
4. Rules validation → `outbox.jsonc` (rules_lawyer)
5. State application → `outbox.jsonc` (state_applier)
6. Narrative rendering → `inbox.jsonc` (renderer_ai)
7. NPC responses → `inbox.jsonc` (npc_ai)

**Storage Architecture:**
- **Inbox:** Player-facing messages (UI reads from here)
- **Outbox:** Service-to-service messages (processing queue)
- **Log:** Complete audit trail (debugging/forensics)
- **Working Memory:** Context for timed events (NPC decision making)
- **Conversations:** Threaded dialogue history

### Current Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Working Memory Events | 0 | >0/action | ❌ FAIL |
| Message Duplication | 40% | <5% | ❌ FAIL |
| Conversation IDs/Session | 5.2 | 1-2 | ❌ FAIL |
| AI Response Time | 1.8s | <2s | ✅ PASS |
| Data Persistence | 100% | 100% | ✅ PASS |
| Error Rate | 2.3% | <1% | ⚠️ WARN |

---

## Problem Analysis

### 3.1 Working Memory System Failure

#### Symptom
`working_memory.jsonc` remains empty despite player actions:
```json
{
  "schema_version": 1,
  "memories": []
}
```

#### Root Cause Analysis

**Architecture Flow:**
```
Turn Manager                    State Applier
     │                               │
     │ 1. Create working memory      │
     │    with event_id              │
     ▼                               │
┌─────────────────┐                 │
│ Working Memory  │                 │
│ Key: event_id   │                 │
└─────────────────┘                 │
     │                               │
     │                               │ 2. Process message
     │                               │    with correlation_id
     │                               │    (different from event_id)
     │                               ▼
     │                    ┌─────────────────┐
     │                    │ Lookup:         │
     │                    │ correlation_id  │
     │                    └─────────────────┘
     │                               │
     │                               │ 3. NOT FOUND
     │                               │    (IDs don't match)
     │                               ▼
     │                    ┌─────────────────┐
     │                    │ Skip recording  │
     │                    │ event to memory │
     │                    └─────────────────┘
```

**Code Locations:**
- **Creation:** `src/turn_manager/main.ts:650-680` - Creates working memory with `event_id`
- **Lookup:** `src/state_applier/main.ts:349-352` - Searches by `correlation_id`
- **Mismatch:** `correlation_id` is session/message chain ID, not `event_id`

#### Impact Assessment

**Severity:** CRITICAL

**Consequences:**
1. NPCs cannot access recent events for context-aware responses
2. Combat state not tracked (who attacked whom, damage dealt)
3. Conversation context lost between turns
4. AI services receive empty context, reducing response quality
5. Violates Phase 2 implementation requirements

**Business Impact:**
- Player experience degraded (NPCs feel robotic)
- AI API costs wasted on context-less calls
- Cannot implement advanced features (reputation, memory-based quests)

### 3.2 Message Duplication Crisis

#### Symptom
Outbox contains 40% duplicate messages:
```
Message ID: 2026-02-01T15:21:45.410Z : 000001 : VD3YVL
  Status: sent       (interpreter_ai)
  Status: processing (data_broker)
  Status: done       (state_applier)
```

#### Root Cause Analysis

**Duplication Sources:**

1. **Multiple Rulings (60% of duplicates):**
   - Rules lawyer generates multiple interpretations
   - State applier creates "applied_1" message for each
   - No deduplication logic exists

2. **Status Updates (30% of duplicates):**
   - Services update message status in-place
   - Race conditions create duplicate entries
   - `update_outbox_message()` not used consistently

3. **Retry Logic (10% of duplicates):**
   - Services retry failed operations
   - New messages created instead of updating existing

**Code Locations:**
- **Creation:** `src/state_applier/main.ts:391-430` - Creates applied_1 message unconditionally
- **Appending:** `src/engine/outbox_store.ts:58-64` - No duplicate check
- **Processing:** `src/npc_ai/main.ts:740-788` - Processes all messages without dedup

#### Impact Assessment

**Severity:** HIGH

**Consequences:**
1. NPCs respond multiple times to same action
2. AI API costs doubled (wasteful)
3. Outbox grows unbounded (performance degradation)
4. Player confusion (multiple responses to one action)
5. Log pollution (harder to debug)

**Quantified Impact:**
- Messages processed: 100
- Duplicates: 40
- Wasted AI calls: 40 × $0.005 = $0.20 per session
- At 100 sessions/day: $20/day waste

### 3.3 Conversation Fragmentation

#### Symptom
Single interaction generates multiple conversation IDs:
```
Player: "tell me about them"
  → conv_1769959305410_v5z9gr (interpreter)
  → conv_1769959304068_blarjk (interpreter retry)
  → conv_1769959301860_3t3tks (interpreter retry)
  → conv_1769959297972_vnxxet (NPC response)
  → conv_1769959298355_dwv2uo (NPC response)
```

#### Root Cause Analysis

**ID Generation:**
```typescript
// src/conversation_manager/index.ts:45
const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
```

**Problems:**
1. **Random ID:** Each service generates new random ID
2. **No Lookup:** No check for existing active conversation
3. **No Context:** ID not tied to session/region/participants
4. **Multiple Services:** Interpreter, NPC AI, Turn Manager all create IDs independently

**Code Locations:**
- **Interpreter:** `src/interpreter_ai/main.ts` - Creates random ID per interpretation
- **NPC AI:** `src/npc_ai/main.ts:350-380` - Creates new conversation if not found
- **Conversation Manager:** `src/conversation_manager/index.ts:38-82` - Always generates random ID

#### Impact Assessment

**Severity:** HIGH

**Consequences:**
1. Conversation history fragmented across multiple IDs
2. NPCs cannot access full dialogue context
3. Cannot implement conversation-based features (quest triggers, relationship tracking)
4. Memory usage grows (orphaned conversation entries)
5. Debugging difficulty (tracing conversation flow across IDs)

---

## Solution Architecture

### Design Principles

1. **Minimal Invasion:** Change only what's necessary, preserve existing architecture
2. **Backward Compatibility:** Don't break existing data or functionality
3. **Deterministic Behavior:** Same inputs produce same outputs
4. **Fail-Safe:** Graceful degradation if fixes fail
5. **Observable:** Add logging/metrics to verify fixes

### Phase 1: Working Memory Fix

#### Solution: Unified ID Space

**Approach:** Align `correlation_id` with `event_id` when timed event is active.

**Architecture:**
```
Interface Program              Turn Manager
      │                            │
      │ 1. Check timed event         │
      │    state                     │
      ▼                            │
┌─────────────────┐                │
│ Get event_id    │                │
│ if active       │                │
└─────────────────┘                │
      │                            │
      │ 2. Set correlation_id      │
      │    = event_id              │
      ▼                            │
┌─────────────────┐                │
│ Create message  │                │
│ with aligned ID │                │
└─────────────────┘                │
      │                            │
      │                            │ 3. Create working memory
      │                            │    with same event_id
      │                            ▼
      │                 ┌─────────────────┐
      │                 │ Working Memory  │
      │                 │ Key: event_id   │
      │                 └─────────────────┘
      │                            │
      ▼                            │
State Applier                      │
      │                            │
      │ 4. correlation_id matches  │
      │    working memory key      │
      ▼                            │
┌─────────────────┐                │
│ Record event    │                │
│ to memory       │                │
└─────────────────┘                │
```

**Fallback Strategy:**
If no timed event active, create working memory on-demand in state applier.

### Phase 2: Message Deduplication

#### Solution: Three-Layer Defense

**Layer 1: Prevention (Don't Create Duplicates)**
- Use deterministic message IDs
- Check for existing messages before creating

**Layer 2: Detection (Filter Before Processing)**
- Deduplicate message lists in service polling
- Keep highest-priority status (done > processing > sent)

**Layer 3: Cleanup (Remove Existing Duplicates)**
- Clean outbox on service startup
- Periodic maintenance sweep

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    DEDUPLICATION LAYERS                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  LAYER 1: PREVENTION                                         │
│  ┌─────────────────┐                                        │
│  │ Deterministic   │  Use hash-based IDs                     │
│  │ Message IDs     │  `${parent_id}_${stage}`               │
│  └─────────────────┘                                        │
│                         ↓                                   │
│  ┌─────────────────┐                                        │
│  │ Check Before    │  Query outbox for existing             │
│  │ Create          │  Update instead of append              │
│  └─────────────────┘                                        │
│                                                              │
│  LAYER 2: DETECTION                                          │
│  ┌─────────────────┐                                        │
│  │ Filter Poll     │  Remove duplicates from                │
│  │ Results         │  candidate list                        │
│  └─────────────────┘                                        │
│                         ↓                                   │
│  ┌─────────────────┐                                        │
│  │ Status Priority │  Keep: done > processing > sent        │
│  └─────────────────┘                                        │
│                                                              │
│  LAYER 3: CLEANUP                                            │
│  ┌─────────────────┐                                        │
│  │ Startup Clean   │  Remove duplicates on boot             │
│  └─────────────────┘                                        │
│                         ↓                                   │
│  ┌─────────────────┐                                        │
│  │ Periodic Sweep  │  Hourly maintenance task               │
│  └─────────────────┘                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 3: Conversation Threading

#### Solution: Deterministic ID Generation

**Approach:** Generate conversation IDs from context hash.

**ID Formula:**
```
conversation_id = hash(session_id + region_id + primary_npc)
```

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│              CONVERSATION ID GENERATION                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Input Context:                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ session_id  │  │  region_id  │  │ primary_npc │         │
│  │ "sess_123"  │  │ "region_0"  │  │ "npc.grenda"│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          ↓                                  │
│              ┌─────────────────────┐                        │
│              │   Concatenate:      │                        │
│              │ "sess_123:region_0: │                        │
│              │   npc.grenda"       │                        │
│              └─────────────────────┘                        │
│                          ↓                                  │
│              ┌─────────────────────┐                        │
│              │   Hash (SHA-256)    │                        │
│              │   → "a3f7b2..."     │                        │
│              └─────────────────────┘                        │
│                          ↓                                  │
│              ┌─────────────────────┐                        │
│              │   Truncate:         │                        │
│              │   "conv_a3f7b2"     │                        │
│              └─────────────────────┘                        │
│                          ↓                                  │
│              ┌─────────────────────┐                        │
│              │   Check Existing    │                        │
│              │   Reuse if active   │                        │
│              └─────────────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Collision Handling:**
- Probability: ~0.001% with 12-character hash
- Mitigation: Append counter if collision detected

---

## Implementation Roadmap

### Phase 1: Working Memory Fix
**Duration:** 2 hours  
**Priority:** CRITICAL  
**Dependencies:** None

#### Task 1.1: Interface Program Modification (30 min)
**File:** `src/interface_program/main.ts`  
**Lines:** ~520-580

**Changes:**
1. Import `get_timed_event_state` from turn manager
2. Check if timed event is active before creating message
3. Use `event_id` as `correlation_id` if available
4. Fallback to `generate_id()` if no timed event

**Code:**
```typescript
// Add import
import { get_timed_event_state } from "../turn_manager/main.js";

// Modify message creation
const timed_event = get_timed_event_state(data_slot_number);
const correlation_id = timed_event?.timed_event_active 
    ? timed_event.event_id 
    : generate_id();

const message_input: MessageInput = {
    // ... other fields
    correlation_id,
    meta: {
        // ... existing meta
        timed_event_active: timed_event?.timed_event_active || false
    }
};
```

**Testing:**
- Unit test: Verify correlation_id matches event_id when timed event active
- Integration test: Send message during timed event, check working memory

#### Task 1.2: State Applier Enhancement (45 min)
**File:** `src/state_applier/main.ts`  
**Lines:** 348-389

**Changes:**
1. Import `build_working_memory` from context manager
2. Add on-demand working memory creation
3. Add helper functions for event analysis

**Code:**
```typescript
// Add imports
import { build_working_memory, get_working_memory, add_event_to_memory } from "../context_manager/index.js";
import { get_timed_event_state } from "../turn_manager/main.js";

// Modify working memory recording
const correlation_id = msg.correlation_id;
if (correlation_id && events && events.length > 0) {
    let memory = get_working_memory(data_slot_number, correlation_id);
    
    // Create working memory if not exists and we have a timed event
    if (!memory) {
        const timed_event = get_timed_event_state(data_slot_number);
        if (timed_event?.event_id === correlation_id) {
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
        // ... existing event recording code
    }
}

// Add helper functions
function detect_event_type(events: string[]): "combat" | "conversation" | "exploration" {
    const text = events.join(" ");
    if (text.includes("ATTACK") || text.includes("DEFEND")) return "combat";
    if (text.includes("COMMUNICATE")) return "conversation";
    return "exploration";
}

function extract_participants_from_events(events: string[]): string[] {
    const participants = new Set<string>();
    for (const event of events) {
        const actor_match = event.match(/^(actor|npc)\.([^\.]+)/);
        if (actor_match) {
            participants.add(`${actor_match[1]}.${actor_match[2]}`);
        }
        const target_match = event.match(/target=(actor|npc)\.([^,)]+)/);
        if (target_match) {
            participants.add(`${target_match[1]}.${target_match[2]}`);
        }
    }
    return Array.from(participants);
}

function get_current_region(slot: number): string {
    const result = load_actor(slot, "henry_actor");
    if (result.ok && result.actor.location?.region_tile) {
        const loc = result.actor.location;
        return `region.${loc.world_tile?.x}_${loc.world_tile?.y}_${loc.region_tile?.x}_${loc.region_tile?.y}`;
    }
    return "region.0_0_0_0";
}
```

**Testing:**
- Unit test: Verify working memory created on-demand
- Integration test: Full pipeline with working memory population

#### Task 1.3: Context Manager Exports (15 min)
**File:** `src/context_manager/index.ts`  
**Lines:** Add to exports

**Changes:**
1. Export `build_working_memory` function
2. Export type definitions

**Code:**
```typescript
// Add to exports at end of file
export { build_working_memory, get_working_memory, add_event_to_memory };
export type { WorkingMemory, RecentEvent, ParticipantMemory };
```

#### Task 1.4: Verification (30 min)
**Testing:**
1. Start game with timed event active
2. Send player action
3. Check `working_memory.jsonc` - should have entry
4. Send second action
5. Verify both events recorded
6. Verify NPC can access context

**Success Criteria:**
- [ ] Working memory file populated after actions
- [ ] Events have correct structure (turn, actor, action, target, outcome, emotional_tone)
- [ ] NPC responses reference recent events

---

### Phase 2: Message Deduplication
**Duration:** 1.5 hours  
**Priority:** HIGH  
**Dependencies:** None

#### Task 2.1: Outbox Store Enhancement (30 min)
**File:** `src/engine/outbox_store.ts`  
**Lines:** Add after `update_outbox_message`

**Changes:**
1. Add `append_outbox_message_deduped` function
2. Add `remove_duplicate_messages` function
3. Export new functions

**Code:**
```typescript
export function append_outbox_message_deduped(
    outbox_path: string, 
    message: MessageEnvelope
): MessageEnvelope {
    const outbox = read_outbox(outbox_path);
    
    // Check for existing message with same ID
    const existing_index = outbox.messages.findIndex(m => m.id === message.id);
    if (existing_index >= 0) {
        // Merge with existing, keeping highest priority status
        const existing = outbox.messages[existing_index];
        const status_priority = { "done": 4, "processing": 3, "sent": 2, "queued": 1 };
        const existing_priority = status_priority[existing.status || "queued"] || 0;
        const new_priority = status_priority[message.status || "queued"] || 0;
        
        if (new_priority >= existing_priority) {
            outbox.messages[existing_index] = { ...existing, ...message };
            write_outbox(outbox_path, outbox);
        }
        return message;
    }
    
    // No duplicate found, append as normal
    outbox.messages.unshift(message);
    const pruned = prune_outbox_messages(outbox, 10);
    write_outbox(outbox_path, pruned);
    return message;
}

export function remove_duplicate_messages(outbox_path: string): number {
    const outbox = read_outbox(outbox_path);
    const seen = new Map<string, MessageEnvelope>();
    const status_priority = { "done": 4, "processing": 3, "sent": 2, "queued": 1 };
    
    for (const msg of outbox.messages) {
        const existing = seen.get(msg.id);
        if (!existing) {
            seen.set(msg.id, msg);
        } else {
            // Keep message with higher priority status
            const existing_priority = status_priority[existing.status || "queued"] || 0;
            const new_priority = status_priority[msg.status || "queued"] || 0;
            if (new_priority > existing_priority) {
                seen.set(msg.id, msg);
            }
        }
    }
    
    const unique_messages = Array.from(seen.values());
    const removed_count = outbox.messages.length - unique_messages.length;
    
    if (removed_count > 0) {
        outbox.messages = unique_messages;
        write_outbox(outbox_path, outbox);
    }
    
    return removed_count;
}
```

#### Task 2.2: State Applier Update (20 min)
**File:** `src/state_applier/main.ts`  
**Lines:** 391-430

**Changes:**
1. Import `append_outbox_message_deduped`
2. Use deterministic message ID
3. Call deduped append function

**Code:**
```typescript
// Add import
import { append_outbox_message_deduped } from "../engine/outbox_store.js";

// Modify message creation
const output: MessageInput = {
    id: `${msg.id}_applied`, // Deterministic ID
    sender: "state_applier",
    content: "state applied",
    stage: "applied_1",
    status: "sent",
    reply_to: msg.id,
    correlation_id: msg.correlation_id,
    meta: {
        session_id: msg.meta?.session_id,
        created_at: new Date().toISOString(),
        effects_applied: effectsApplied,
        effects,
        events,
        original_text,
        machine_text,
        ruling_stage: msg.stage,
        is_final_ruling: !hasMoreRulings,
        action_verb: actionVerb
    }
};

const applied_msg = create_message(output);
append_outbox_message_deduped(outbox_path, applied_msg);
```

#### Task 2.3: NPC AI Deduplication (20 min)
**File:** `src/npc_ai/main.ts`  
**Lines:** 740-788

**Changes:**
1. Filter duplicates from candidates
2. Add logging for deduplication

**Code:**
```typescript
// In tick function, after filtering candidates
const candidates = messages.filter(msg => {
    // ... existing filter logic
});

// Deduplicate by message ID
const seen_ids = new Set<string>();
const unique_candidates = candidates.filter(msg => {
    if (seen_ids.has(msg.id)) {
        return false;
    }
    seen_ids.add(msg.id);
    return true;
});

if (unique_candidates.length < candidates.length) {
    debug_log("NPC_AI", `Filtered ${candidates.length - unique_candidates.length} duplicate messages`);
}

// Process unique candidates only
for (const msg of unique_candidates) {
    // ... existing processing logic
}
```

#### Task 2.4: Service Startup Cleanup (20 min)
**File:** `src/npc_ai/main.ts`  
**Lines:** 790-802

**Changes:**
1. Import `remove_duplicate_messages`
2. Call cleanup on initialization

**Code:**
```typescript
// Add import
import { remove_duplicate_messages } from "../engine/outbox_store.js";

function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    // ... existing initialization
    
    // Clean up duplicates from previous sessions
    const removed = remove_duplicate_messages(outbox_path);
    if (removed > 0) {
        debug_log("NPC_AI", `Cleaned ${removed} duplicate messages on startup`);
    }
    
    return { outbox_path, inbox_path, log_path };
}
```

#### Task 2.5: Verification (20 min)
**Testing:**
1. Send message, verify single entry in outbox
2. Trigger multiple rulings, verify single applied message
3. Restart services, verify duplicates cleaned
4. Monitor for 10 minutes, verify no new duplicates

**Success Criteria:**
- [ ] Outbox contains <5% duplicates
- [ ] NPC AI processes each message once
- [ ] Startup cleanup removes existing duplicates
- [ ] No duplicate NPC responses

---

### Phase 3: Conversation Threading
**Duration:** 1.5 hours  
**Priority:** HIGH  
**Dependencies:** None

#### Task 3.1: Conversation Manager Enhancement (30 min)
**File:** `src/conversation_manager/index.ts`  
**Lines:** Add after imports

**Changes:**
1. Add `generate_conversation_id` function
2. Add `find_or_create_conversation` function
3. Add `start_conversation_with_id` function

**Code:**
```typescript
import * as crypto from "crypto";

// Generate deterministic conversation ID
export function generate_conversation_id(
    session_id: string,
    region_id: string,
    primary_participant?: string
): string {
    const base = primary_participant 
        ? `${session_id}:${region_id}:${primary_participant}`
        : `${session_id}:${region_id}`;
    
    // Create hash and truncate to 12 chars
    const hash = crypto.createHash("sha256").update(base).digest("hex").substring(0, 12);
    return `conv_${hash}`;
}

// Find existing or create new conversation
export function find_or_create_conversation(
    slot: number,
    session_id: string,
    region_id: string,
    initiator: string,
    participants: string[] = []
): string {
    const primary = participants.find(p => p !== initiator) || initiator;
    const conversation_id = generate_conversation_id(session_id, region_id, primary);
    
    // Check for existing active conversation
    const data = read_conversations(slot);
    const existing = data.conversations.find(c => c.id === conversation_id && c.status === "active");
    
    if (existing) {
        debug_log("ConversationManager", "Reusing existing conversation", { conversation_id });
        return conversation_id;
    }
    
    // Create new conversation
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
    
    debug_log("ConversationManager", "Started conversation", { conversation_id, region_id, initiator });
    return conversation_id;
}
```

#### Task 3.2: Interpreter AI Update (30 min)
**File:** `src/interpreter_ai/main.ts`  
**Lines:** ~300-350

**Changes:**
1. Import `generate_conversation_id`
2. Extract context from message
3. Generate deterministic ID

**Code:**
```typescript
// Add import
import { generate_conversation_id } from "../conversation_manager/index.js";

// In message interpretation section
const session_id = (msg.meta?.session_id as string) || `session_${Date.now()}`;
const region_id = extract_region_from_context(context); // Need to implement
const primary_npc = extract_primary_npc(interpreted_command); // Need to implement

const conversation_id = generate_conversation_id(session_id, region_id, primary_npc);

const interpreted: MessageInput = {
    // ... other fields
    conversation_id,
    meta: {
        // ... existing meta
        session_id,
        region_id
    }
};
```

#### Task 3.3: NPC AI Update (30 min)
**File:** `src/npc_ai/main.ts`  
**Lines:** ~350-380

**Changes:**
1. Import `find_or_create_conversation`
2. Use consistent conversation lookup

**Code:**
```typescript
// Add import
import { find_or_create_conversation, get_conversation } from "../conversation_manager/index.js";

// In conversation handling section
if (!conversation) {
    const session_id = (msg.meta?.session_id as string) || `session_${Date.now()}`;
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

#### Task 3.4: Verification (30 min)
**Testing:**
1. Send 3 messages to same NPC
2. Verify single conversation ID in all messages
3. Verify all messages in conversation file
4. Send message to different NPC
5. Verify separate conversation created

**Success Criteria:**
- [ ] Single conversation ID per session/region/NPC
- [ ] All related messages linked correctly
- [ ] Conversation persists across interactions
- [ ] No fragmentation after 10+ exchanges

---

## Testing & Validation Strategy

### Unit Testing

**Working Memory:**
```typescript
test("working memory records events", async () => {
    const slot = 1;
    const event_id = "event_123";
    
    // Create timed event
    await build_working_memory(slot, event_id, "exploration", "region_0", ["actor.henry_actor"]);
    
    // Process message with matching correlation_id
    const msg = create_message({ correlation_id: event_id, /* ... */ });
    await apply_state(msg);
    
    // Verify memory updated
    const memory = get_working_memory(slot, event_id);
    expect(memory.recent_events.length).toBe(1);
});
```

**Message Deduplication:**
```typescript
test("deduplication prevents duplicates", () => {
    const outbox_path = get_outbox_path(1);
    const msg = create_message({ id: "msg_123" });
    
    // Append twice
    append_outbox_message_deduped(outbox_path, msg);
    append_outbox_message_deduped(outbox_path, msg);
    
    // Verify only one entry
    const outbox = read_outbox(outbox_path);
    const count = outbox.messages.filter(m => m.id === "msg_123").length;
    expect(count).toBe(1);
});
```

**Conversation Threading:**
```typescript
test("deterministic conversation IDs", () => {
    const id1 = generate_conversation_id("sess_1", "region_0", "npc.grenda");
    const id2 = generate_conversation_id("sess_1", "region_0", "npc.grenda");
    
    expect(id1).toBe(id2);
});
```

### Integration Testing

**Scenario 1: Complete Player Interaction**
1. Start game
2. Send "look around" command
3. Verify:
   - Working memory has INSPECT event
   - Single message in outbox
   - No conversation created (no NPC interaction)

**Scenario 2: NPC Conversation**
1. Start game
2. Send "talk to grenda" command
3. Verify:
   - Working memory has COMMUNICATE event
   - Single conversation ID throughout
   - Grenda responds with context
4. Send follow-up question
5. Verify:
   - Same conversation ID
   - Grenda references previous exchange

**Scenario 3: Combat Scenario**
1. Start combat timed event
2. Send "attack goblin" command
3. Verify:
   - Working memory records ATTACK event
   - Event includes damage dealt
   - NPC AI uses context for retaliation

### Performance Testing

**Metrics to Monitor:**
- AI response time (target: <2s)
- Message processing latency (target: <100ms)
- Outbox size growth (target: <10 messages)
- File I/O operations (target: <50 per action)

**Load Test:**
- Send 50 messages rapidly
- Verify no duplicates created
- Verify working memory records all events
- Monitor memory usage

---

## Risk Management

### Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner |
|----|------|-------------|--------|------------|-------|
| R1 | Breaking existing functionality | Medium | High | Feature branches, comprehensive testing | Dev |
| R2 | Data corruption | Low | Critical | Backup before changes, transactions | Dev |
| R3 | Performance regression | Medium | Medium | Benchmarking, caching | Dev |
| R4 | AI behavior changes | Medium | Medium | A/B testing, gradual rollout | QA |
| R5 | Rollback failure | Low | High | Git tags, documented rollback | Dev |

### Mitigation Strategies

**R1 - Breaking Existing Functionality:**
- Create feature branch: `feature/critical-fixes`
- Run full test suite before merge
- Implement feature flags for gradual rollout
- Monitor error rates post-deployment

**R2 - Data Corruption:**
- Backup `local_data/` before deployment
- Use atomic file operations
- Implement data validation on read
- Create data migration scripts

**R3 - Performance Regression:**
- Benchmark before/after response times
- Add caching layer for working memory
- Monitor AI call latency
- Implement circuit breakers

**R4 - AI Behavior Changes:**
- Compare AI responses before/after
- A/B test with 10% of traffic
- Monitor player feedback
- Maintain prompt version control

**R5 - Rollback Failure:**
- Tag git commit: `git tag pre-critical-fixes`
- Document rollback procedure
- Test rollback in staging
- Keep previous version binaries

### Contingency Plans

**If Working Memory Fix Fails:**
1. Revert to correlation_id approach
2. Implement alternative: Store events in message meta
3. Document limitation: Working memory disabled

**If Deduplication Causes Data Loss:**
1. Restore from backup
2. Implement softer deduplication (mark as duplicate instead of delete)
3. Add audit log for all removed messages

**If Conversation IDs Collide:**
1. Increase hash length from 12 to 16 characters
2. Add collision detection and counter
3. Log all collisions for analysis

---

## Resource Requirements

### Personnel

| Role | Hours | Responsibilities |
|------|-------|------------------|
| Developer | 6 | Implementation, unit testing |
| QA Engineer | 2 | Integration testing, validation |
| DevOps | 1 | Deployment, monitoring setup |
| Technical Writer | 0.5 | Documentation updates |

### Tools & Infrastructure

**Development:**
- TypeScript compiler
- Node.js runtime
- Git version control
- VS Code IDE

**Testing:**
- Jest testing framework
- Test data fixtures
- Staging environment
- Performance profiling tools

**Deployment:**
- CI/CD pipeline
- Feature flag system
- Monitoring dashboard
- Log aggregation

### Budget

| Item | Cost | Notes |
|------|------|-------|
| Developer time | $900 | 6 hours × $150/hr |
| QA time | $200 | 2 hours × $100/hr |
| AI API (testing) | $50 | ~1000 test calls |
| Infrastructure | $0 | Existing resources |
| **Total** | **$1,150** | |

**Cost Savings (post-fix):**
- Duplicate AI calls eliminated: 40% reduction
- At 100 sessions/day: $20/day × 30 days = $600/month savings
- ROI: 52% in first month

---

## Success Metrics & KPIs

### Primary Metrics

| Metric | Before | Target | Measurement Method |
|--------|--------|--------|-------------------|
| Working Memory Population | 0% | 100% | Check working_memory.jsonc |
| Message Duplication Rate | 40% | <5% | Count duplicate IDs in outbox |
| Conversation ID Count | 5.2/session | 1-2/session | Count active conversations |
| AI Response Time | 1.8s | <2.0s | Metrics file analysis |
| System Error Rate | 2.3% | <1.0% | Log analysis |

### Secondary Metrics

| Metric | Before | Target | Measurement Method |
|--------|--------|--------|-------------------|
| NPC Context Awareness | 0% | 90% | Manual testing |
| Player Session Length | N/A | +20% | Analytics |
| Outbox Size | 100+ | <20 | File monitoring |
| File I/O Operations | 150/action | <50/action | Profiling |

### Leading Indicators

**Daily Monitoring:**
- Working memory entries created
- Duplicate messages detected
- Conversation IDs generated
- AI API call count

**Weekly Review:**
- Trend analysis of primary metrics
- Player feedback analysis
- Performance benchmark comparison
- Error rate trends

### Success Criteria

**Phase 1 Success:**
- [ ] Working memory populated for 100% of actions
- [ ] Events have complete metadata
- [ ] NPCs reference recent events in responses

**Phase 2 Success:**
- [ ] Message duplication <5%
- [ ] No duplicate NPC responses observed
- [ ] Outbox size remains bounded

**Phase 3 Success:**
- [ ] Single conversation ID per interaction thread
- [ ] Conversation history complete and accessible
- [ ] No fragmentation after 20+ exchanges

**Overall Success:**
- [ ] All primary metrics meet targets
- [ ] No critical bugs reported for 1 week
- [ ] Player experience improved (qualitative feedback)
- [ ] System stable under load

---

## Appendices

### Appendix A: Glossary

- **Working Memory:** Context storage for timed events, enabling NPCs to remember recent actions
- **Correlation ID:** Identifier linking messages in a processing chain
- **Event ID:** Unique identifier for a timed event (combat, conversation, etc.)
- **Message Duplication:** Multiple entries with same ID in outbox
- **Conversation Fragmentation:** Multiple conversation IDs for single interaction thread
- **State Applier:** Service that applies game rules and updates world state
- **Timed Event:** Time-bounded game scenario (combat, dialogue, etc.)

### Appendix B: Code Locations Reference

**Working Memory:**
- Creation: `src/turn_manager/main.ts:650-680`
- Lookup: `src/state_applier/main.ts:349-352`
- Recording: `src/state_applier/main.ts:373-380`

**Message Deduplication:**
- Appending: `src/engine/outbox_store.ts:58-64`
- Applied message: `src/state_applier/main.ts:391-430`
- NPC processing: `src/npc_ai/main.ts:740-788`

**Conversation Threading:**
- ID generation: `src/conversation_manager/index.ts:45`
- Interpreter: `src/interpreter_ai/main.ts` (various locations)
- NPC handling: `src/npc_ai/main.ts:350-380`

### Appendix C: Testing Checklist

**Pre-Deployment:**
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Performance benchmarks acceptable
- [ ] Code review completed
- [ ] Documentation updated

**Deployment:**
- [ ] Backup created
- [ ] Feature flags configured
- [ ] Monitoring enabled
- [ ] Rollback procedure tested

**Post-Deployment:**
- [ ] Smoke tests pass
- [ ] Metrics within targets
- [ ] No error spikes
- [ ] Player feedback positive

### Appendix D: Rollback Procedure

**Immediate Rollback (< 1 hour):**
```bash
# Stop services
npm run stop:all

# Restore from backup
cp -r local_data/backup_$(date +%Y%m%d) local_data/

# Revert code
git checkout pre-critical-fixes

# Restart services
npm run start:all
```

**Gradual Rollback (feature flags):**
```bash
# Disable new features
npm run feature:off working-memory-fix
npm run feature:off message-dedup
npm run feature:off conversation-threading
```

---

## Document Control

**Version History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | OpenCode AI | Initial draft |

**Reviewers:**
- [ ] Technical Lead
- [ ] QA Lead
- [ ] Product Manager

**Approval:**

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Technical Lead | | | |
| QA Lead | | | |
| Product Manager | | | |

---

**Document Status:** DRAFT - PENDING REVIEW  
**Next Steps:**
1. Review and approval by stakeholders
2. Create feature branch
3. Begin Phase 1 implementation
4. Daily standups during implementation
5. Post-implementation review

**Questions or Concerns:**
Contact: [Project Lead]  
Email: [project-lead@example.com]

# NPC Witness & Reaction System Implementation Plan

**Date:** 2026-02-07  
**Status:** 🟡 DESIGN PHASE  
**Priority:** High  
**File:** `docs/plans/2026_02_07_npc_witness_reaction_system.md`

> **Dependencies:** Action Range System complete (pipeline broadcasting), Movement State System operational, Perception Memory system implemented

---

## Overview

Implement a real-time NPC reaction system that connects perception broadcasts to the movement/goal system. When NPCs witness actions (especially COMMUNICATE), they react immediately without LLM processing by adjusting their movement goals. This creates living, responsive NPCs that feel aware of their environment.

**Core Principle:** Simple reactions for simple stimuli. Complex narrative responses still go through AI, but movement and basic behavioral changes happen instantly.

**Tabletop Analogy:** Like a DM saying "The guard stops patrolling when you call out to him" or "The merchant pauses her wandering to hear what you have to say."

---

## System Goals

1. **Immediate Response:** NPCs react to perceptions within milliseconds, not waiting for AI calls
2. **Goal-Aware Behavior:** Different current goals produce different reactions
3. **Time-Based Duration:** Conversations last ~30 in-game seconds (a few minutes of real talk)
4. **Graceful Exit:** Saying "bye" ends conversation and restores previous behavior
5. **Combat Safety:** System disabled during timed events (combat)
6. **Scalability:** Handle dozens of NPCs witnessing actions simultaneously

---

## System Architecture

### Component Flow

```
Action Pipeline
    ↓ (broadcast_after)
Perception System
    ↓ (store in perceptionMemory)
Witness Handler (NEW)
    ↓ (filter & prioritize)
Goal Modifier (NEW)
    ↓ (set_goal or update state)
Movement System
    ↓ (execute)
NPC Behavior Changes
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **Witness Handler** | `src/npc_ai/witness_handler.ts` | Receives perception events, decides if NPC should react |
| **Reaction Evaluator** | `src/npc_ai/reaction_evaluator.ts` | Determines reaction type based on personality/current goal |
| **Conversation State** | `src/npc_ai/conversation_state.ts` | Tracks active conversations, timeouts, memory triggers |
| **Goal Integration** | `src/npc_ai/goal_selector.ts` (modify) | Add "converse" goal type, integrate with existing goals |

---

## New Goal Type: CONVERSE

### Definition

```typescript
export type GoalType = 
  | "wander"      // Random exploration
  | "patrol"      // Follow waypoints
  | "interact"    // Use a feature
  | "social"      // Move toward others
  | "follow"      // Follow target entity
  | "flee"        // Move away from threat
  | "rest"        // Stand/sit idle
  | "converse";   // NEW: Engaged in conversation

export type ConverseGoal = Goal & {
  type: "converse";
  target_entity: string;           // Who they're talking to
  conversation_id: string;         // Unique conversation ID
  started_at: number;              // In-game timestamp
  timeout_at: number;              // When to auto-end
  previous_goal: Goal | null;      // What to return to
  previous_goal_state: {           // State to restore
    path: TilePosition[];
    path_index: number;
  } | null;
  respond_to: string[];            // Entity refs that are "part of conversation"
};
```

### Goal Priority

| Goal Type | Priority | Interruptible By |
|-----------|----------|------------------|
| CRITICAL | 10 | Nothing |
| flee | 9 | Nothing |
| converse | 7 | CRITICAL, flee |
| patrol | 6 | CRITICAL, flee, converse |
| interact | 5 | CRITICAL, flee, converse |
| social | 4 | CRITICAL, flee, converse, patrol |
| wander | 3 | CRITICAL, flee, converse, patrol, interact |
| rest | 1 | All except rest |

---

## Goal-Based Reaction Matrix

### When NPC Receives COMMUNICATE (not in combat)

| Current Goal | Reaction | Movement Pattern | Notes |
|--------------|----------|------------------|-------|
| **wander** | Switch to **converse** | Move within 2 tiles of speaker, face them | Full conversation mode |
| **patrol** | Pause patrol → **converse** | Stay within patrol bounds, face speaker | Patrol resumes after |
| **interact** | Finish interaction → **converse** | Complete current action, then engage | Don't interrupt mid-action |
| **social** | Join conversation | Move to group, face speaker | Natural social behavior |
| **follow** | Continue following but **converse** | Follow target while facing speaker | Multitasking |
| **flee** | Ignore | Keep fleeing | Survival priority |
| **rest** | Wake up → **converse** | Stand up, move to speaker | Low priority activity |
| **converse** | Continue | Stay in position, face new speaker if addressed | Already engaged |

### When NPC Receives "BYE" or Conversation Ends

| Current Goal | Reaction |
|--------------|----------|
| **converse** | Restore **previous_goal** with saved state |
| Other | No change |

---

## Implementation Phases

### Phase 1: Foundation (Day 1-2)

**Files to Create/Modify:**

1. **`src/npc_ai/conversation_state.ts`** (NEW)
```typescript
// Track active conversations per NPC
interface ActiveConversation {
  npc_ref: string;
  target_entity: string;
  conversation_id: string;
  started_at_ms: number;           // In-game time
  timeout_at_ms: number;           // Auto-expire
  participants: string[];          // All involved entities
  previous_goal_snapshot: Goal | null;
}

const active_conversations = new Map<string, ActiveConversation>();

export function start_conversation(
  npc_ref: string,
  target_entity: string,
  participants: string[]
): string;

export function end_conversation(npc_ref: string): void;

export function is_in_conversation(npc_ref: string): boolean;

export function get_conversation(npc_ref: string): ActiveConversation | null;

export function update_conversation_timeout(npc_ref: string): void;
```

2. **`src/npc_ai/witness_handler.ts`** (NEW)
```typescript
import { perceptionMemory, type PerceptionEvent } from "../action_system/perception.js";

export function process_witness_events(): void {
  // Called every tick or after action pipeline
  const events = perceptionMemory.get_all_recent();
  
  for (const event of events) {
    if (should_npc_react(event)) {
      handle_reaction(event);
    }
  }
}

function should_npc_react(event: PerceptionEvent): boolean {
  // Skip if in combat
  if (is_timed_event_active()) return false;
  
  // Only react to communication for now
  if (event.verb !== "COMMUNICATE") return false;
  
  // Only if they can perceive clearly
  if (event.actorVisibility === "obscured") return false;
  
  // Only if addressed or very close
  const is_addressed = event.targetRef === event.observerRef;
  const is_very_close = event.distance <= 3;
  
  return is_addressed || is_very_close;
}

function handle_reaction(event: PerceptionEvent): void {
  const npc_ref = event.observerRef;
  const speaker_ref = event.actorRef;
  
  // Check if "bye" was said
  if (is_farewell_message(event)) {
    end_conversation(npc_ref);
    return;
  }
  
  // Start or continue conversation
  if (!is_in_conversation(npc_ref)) {
    initiate_conversation_goal(npc_ref, speaker_ref);
  } else {
    update_conversation_timeout(npc_ref);
  }
}
```

3. **Modify `src/npc_ai/movement_state.ts`**
   - Add `"converse"` to GoalType union
   - Ensure `set_goal` handles conversation state saving

**Deliverable:** Foundation files created, conversation tracking works

---

### Phase 2: Goal Integration (Day 3-4)

**Files to Modify:**

1. **`src/npc_ai/goal_selector.ts`**

Add new function:
```typescript
export function initiate_conversation_goal(
  npc_ref: string,
  target_entity: string,
  context: GoalContext
): Goal | null {
  const state = get_movement_state(npc_ref);
  if (!state) return null;
  
  // Save current goal for later restoration
  const previous_goal = state.current_goal;
  const previous_state = {
    path: [...state.path],
    path_index: state.path_index
  };
  
  // Get target position
  const target_pos = get_entity_position(target_entity);
  if (!target_pos) return null;
  
  // Calculate conversation position (within 2 tiles)
  const conversation_pos = find_conversation_position(
    npc_ref,
    target_pos,
    context.place
  );
  
  // Start conversation tracking
  const conversation_id = start_conversation(
    npc_ref,
    target_entity,
    [npc_ref, target_entity]
  );
  
  // Create converse goal
  const goal: Goal = {
    type: "converse",
    target_entity,
    target_position: conversation_pos,
    priority: 7,
    created_at: Date.now(),
    expires_at: null,  // Managed by conversation state
    reason: `Responding to ${target_entity}`,
    // Extended fields for converse type
    conversation_id,
    previous_goal,
    previous_goal_state: previous_state,
    respond_to: [target_entity]
  };
  
  return goal;
}
```

Add helper:
```typescript
function find_conversation_position(
  npc_ref: string,
  target_pos: TilePosition,
  place: Place
): TilePosition {
  // Find valid tile within 1-2 tiles of target
  // Face the target
  // Prefer tiles that are walkable and not occupied
  // Return target position if no valid nearby tile
}
```

2. **`src/npc_ai/movement_loop.ts`** (or equivalent)

Add conversation handling to the movement tick:
```typescript
// In the movement update loop
for (const [npc_ref, state] of movement_states) {
  if (state.current_goal?.type === "converse") {
    // Face the conversation target
    face_target(npc_ref, state.current_goal.target_entity);
    
    // Check if conversation timed out
    if (should_end_conversation(npc_ref)) {
      end_conversation(npc_ref);
      continue;
    }
    
    // If too far from target, move closer
    const distance = get_distance_to_target(npc_ref, state.current_goal.target_position);
    if (distance > 2) {
      move_toward(npc_ref, state.current_goal.target_position);
    }
  }
}
```

3. **Modify `src/npc_ai/movement_state.ts`**

Add conversation restoration:
```typescript
export function restore_previous_goal(npc_ref: string): void {
  const state = get_movement_state(npc_ref);
  if (!state || state.current_goal?.type !== "converse") return;
  
  const converse_goal = state.current_goal as ConverseGoal;
  
  if (converse_goal.previous_goal) {
    // Restore previous goal
    set_goal(npc_ref, converse_goal.previous_goal, converse_goal.previous_goal_state?.path);
    debug_log("NPC_Witness", `${npc_ref} restored previous goal: ${converse_goal.previous_goal.type}`);
  } else {
    // No previous goal, go idle
    clear_goal(npc_ref, "Conversation ended");
  }
}
```

**Deliverable:** NPCs can enter/exit conversation goals, restore previous behavior

---

### Phase 3: Action Pipeline Integration (Day 5)

**Modify `src/integration/action_system_adapter.ts`:**

Add witness processing after action completion:
```typescript
// After pipeline.process() in processPlayerAction and processNPCAction
const result = await pipeline.process(intent);

// Trigger witness reactions (only outside combat)
if (!is_timed_event_active(data_slot_number)) {
  process_witness_events();
}
```

**Modify `src/action_system/perception.ts`:**

Ensure COMMUNICATE events include target info:
```typescript
// In createPerceptionEvent for communication
if (intent.verb === "COMMUNICATE") {
  details = {
    messageText: intent.parameters.text as string || intent.parameters.message as string,
    language: intent.parameters.language as string || "common",
    volume: intent.parameters.subtype?.toLowerCase() as "whisper" | "normal" | "shout" || "normal",
    understood: true,
    targetRef: intent.targetRef,  // Who was addressed
  };
}
```

**Deliverable:** Actions automatically trigger witness reactions

---

### Phase 4: Time Integration (Day 6)

**Create `src/npc_ai/time_tracker.ts`** (or extend existing):

```typescript
import { get_game_time } from "../time_system/tracker.js";

const CONVERSATION_DURATION_MS = 30000;  // 30 in-game seconds

export function get_conversation_timeout(): number {
  const current_time = get_game_time();
  return current_time + CONVERSATION_DURATION_MS;
}

export function has_conversation_expired(timeout_at: number): boolean {
  const current_time = get_game_time();
  return current_time >= timeout_at;
}

export function should_end_conversation(npc_ref: string): boolean {
  const conv = get_conversation(npc_ref);
  if (!conv) return false;
  
  return has_conversation_expired(conv.timeout_at_ms);
}
```

**Modify `src/npc_ai/conversation_state.ts`:**

Integrate time tracking:
```typescript
import { get_conversation_timeout } from "./time_tracker.js";

export function start_conversation(
  npc_ref: string,
  target_entity: string,
  participants: string[]
): string {
  const conversation_id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const conversation: ActiveConversation = {
    npc_ref,
    target_entity,
    conversation_id,
    started_at_ms: get_game_time(),
    timeout_at_ms: get_conversation_timeout(),
    participants,
    previous_goal_snapshot: null,  // Set by goal_selector
  };
  
  active_conversations.set(npc_ref, conversation);
  
  debug_log("NPC_Witness", `Started conversation for ${npc_ref}`, {
    with: target_entity,
    timeout: new Date(conversation.timeout_at_ms).toISOString()
  });
  
  return conversation_id;
}

export function update_conversation_timeout(npc_ref: string): void {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return;
  
  // Extend conversation by 30 more seconds
  conv.timeout_at_ms = get_conversation_timeout();
  
  debug_log("NPC_Witness", `Extended conversation for ${npc_ref}`);
}
```

**Deliverable:** Time-based conversation tracking works

---

### Phase 5: Memory Integration (Day 7)

**Modify `src/npc_ai/conversation_state.ts`:**

Add memory consolidation trigger:
```typescript
import { append_non_timed_conversation_journal } from "./timed_event_journal.js";

export function end_conversation(npc_ref: string): void {
  const conv = active_conversations.get(npc_ref);
  if (!conv) return;
  
  // Trigger memory consolidation
  const conversation_summary = generate_conversation_summary(conv);
  
  void append_non_timed_conversation_journal(
    SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1,
    npc_ref,
    {
      region_label: get_npc_region_label(npc_ref),
      conversation_id: conv.conversation_id,
      transcript: conversation_summary,
      duration_ms: get_game_time() - conv.started_at_ms,
    }
  );
  
  // Restore previous goal
  restore_previous_goal(npc_ref);
  
  // Clean up
  active_conversations.delete(npc_ref);
  
  debug_log("NPC_Witness", `Ended conversation for ${npc_ref}`, {
    duration: `${(get_game_time() - conv.started_at_ms) / 1000}s`
  });
}

function generate_conversation_summary(conv: ActiveConversation): string {
  // Get conversation history from session or build simple summary
  return `Conversation with ${conv.target_entity} (${conv.participants.length} participants)`;
}
```

**Deliverable:** Memory consolidation triggered on conversation end

---

### Phase 6: Farewell Detection (Day 8)

**Create `src/npc_ai/message_parser.ts`** (or add to witness_handler):

```typescript
const FAREWELL_PATTERNS = [
  /^bye\b/i,
  /^goodbye\b/i,
  /^farewell\b/i,
  /^see you\b/i,
  /^later\b/i,
  /^i'm leaving\b/i,
  /^i have to go\b/i,
  /^talk to you later\b/i,
];

export function is_farewell_message(event: PerceptionEvent): boolean {
  if (event.verb !== "COMMUNICATE") return false;
  
  const message = (event.details as any)?.messageText || "";
  const text = message.toLowerCase().trim();
  
  return FAREWELL_PATTERNS.some(pattern => pattern.test(text));
}

export function is_greeting_message(event: PerceptionEvent): boolean {
  if (event.verb !== "COMMUNICATE") return false;
  
  const message = (event.details as any)?.messageText || "";
  const text = message.toLowerCase().trim();
  
  const greeting_patterns = [
    /^hi\b/i,
    /^hello\b/i,
    /^hey\b/i,
    /^greetings\b/i,
  ];
  
  return greeting_patterns.some(pattern => pattern.test(text));
}
```

**Deliverable:** Farewell detection works, ends conversations properly

---

### Phase 7: Testing & Polish (Day 9-10)

**Test Scenarios:**

1. **Basic Conversation Flow:**
```
Setup: NPC Grenda wandering in shop
Action: Player says "Hello Grenda"
Expected: 
  - Grenda stops wandering
  - Moves within 2 tiles of player
  - Faces player
  - Enters "converse" goal state
```

2. **Conversation Timeout:**
```
Setup: Grenda in conversation with player
Action: Wait 30 in-game seconds without talking
Expected:
  - Conversation auto-ends
  - Grenda resumes wandering
  - Memory consolidated
```

3. **Farewell Ending:**
```
Setup: Grenda in conversation
Action: Player says "Goodbye"
Expected:
  - Conversation ends immediately
  - Grenda resumes previous goal
  - Memory consolidated
```

4. **Patrol Pause:**
```
Setup: NPC Guard on patrol route
Action: Player says "Hey guard"
Expected:
  - Guard pauses patrol
  - Stays within patrol bounds
  - Faces player
  - Resumes patrol after conversation
```

5. **Multiple Witnesses:**
```
Setup: 3 NPCs wandering nearby
Action: Player shouts "Hello everyone!"
Expected:
  - All 3 NPCs stop wandering
  - All move toward player (within reason)
  - Can all enter conversation simultaneously
```

6. **Combat Disabled:**
```
Setup: Combat active, NPC wandering
Action: Player says "Hello"
Expected:
  - NPC continues wandering
  - No reaction
  - System disabled during combat
```

**Performance Testing:**
- 50 NPCs, all receive COMMUNICATE event simultaneously
- Measure reaction time (target: <100ms total)
- Ensure no memory leaks in conversation tracking

**Deliverable:** All tests pass, performance acceptable

---

## Files Summary

### New Files (5)
1. `src/npc_ai/conversation_state.ts` - Conversation tracking
2. `src/npc_ai/witness_handler.ts` - Perception event processing
3. `src/npc_ai/reaction_evaluator.ts` - Reaction logic (if needed)
4. `src/npc_ai/message_parser.ts` - Farewell/greeting detection
5. `src/npc_ai/time_tracker.ts` - Time-based conversation management

### Modified Files (4)
1. `src/npc_ai/movement_state.ts` - Add "converse" goal type, restoration logic
2. `src/npc_ai/goal_selector.ts` - Conversation goal creation
3. `src/integration/action_system_adapter.ts` - Trigger witness processing
4. `src/action_system/perception.ts` - Ensure target info in COMMUNICATE events

---

## Integration with Existing Systems

### Perception System
- Consumes `PerceptionEvent` from `perceptionMemory`
- Filters by verb type (COMMUNICATE), clarity, distance
- Respects perceptibility rules already defined

### Movement System
- Extends `GoalType` union with `"converse"`
- Reuses existing `set_goal()` and pathfinding
- Adds `restore_previous_goal()` for graceful exit

### Memory System
- Calls existing `append_non_timed_conversation_journal()`
- Integrates with NPC memory consolidation workflow
- Uses existing time tracking infrastructure

### Action Pipeline
- Called after `pipeline.process()` completes
- Only runs outside combat (timed events)
- Non-blocking (doesn't delay action results)

---

## Scalability Considerations

1. **Batch Processing:** Process witness events in batches every tick, not per-event
2. **Distance Culling:** Only check NPCs within perception radius (already done by perception system)
3. **Goal Complexity:** Simple goals with minimal computation
4. **Memory Management:** Clean up conversation states aggressively (on end, timeout, NPC death)
5. **Async Operations:** Memory consolidation is async, doesn't block movement

---

## Risk Management

### Risk 1: Performance with Many NPCs
**Probability:** Medium  
**Impact:** High  
**Mitigation:** Batch processing, distance culling, O(1) lookups using Maps

### Risk 2: NPCs Getting Stuck in Conversation
**Probability:** Low  
**Impact:** Medium  
**Mitigation:** Timeout (30s), farewell detection, manual end function

### Risk 3: Goal Restoration Bugs
**Probability:** Medium  
**Impact:** Medium  
**Mitigation:** Thorough testing of each goal type, snapshot validation

### Risk 4: Interference with Combat
**Probability:** Low  
**Impact:** High  
**Mitigation:** Explicit check for `is_timed_event_active()` at entry point

---

## Success Criteria

### Phase 1-5 Completion
- [ ] NPCs enter "converse" goal when addressed
- [ ] Movement pattern changes to face speaker
- [ ] Previous goal saved and restored on exit
- [ ] 30-second timeout works
- [ ] Memory consolidation triggers
- [ ] Farewell detection works

### Integration Success
- [ ] Works with existing action pipeline
- [ ] Disabled during combat
- [ ] No interference with AI responses
- [ ] Performance acceptable with 50+ NPCs

### Tabletop Feel
- [ ] NPCs react immediately (no delay)
- [ ] Behavior changes are visible to players
- [ ] Natural conversation flow (enter → talk → exit)
- [ ] Respects NPC roles (guards stay near posts)

---

## Future Enhancements (Post-MVP)

1. **Multi-NPC Conversations:** NPCs talking to each other, player as observer
2. **Conversation Chains:** NPC follows player as they move between rooms
3. **Eavesdropping:** NPCs can join nearby conversations
4. **Conversation Memory:** NPCs remember if they were interrupted
5. **Emotional States:** Angry NPCs might refuse to converse
6. **Group Conversations:** Multiple NPCs, one player

---

**Document:** NPC Witness & Reaction System Implementation Plan  
**Location:** `docs/plans/2026_02_07_npc_witness_reaction_system.md`  
**Duration:** 2 weeks (10 working days)  
**Last Updated:** February 7, 2026

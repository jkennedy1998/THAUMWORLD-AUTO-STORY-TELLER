# Communication & Conversation System
## Unified Implementation Plan

**Date:** 2026-02-09  
**Status:** ✅ Implemented; ready to archive (remaining items moved)  
**Priority:** High  
**Approach:** Option B - Archive old system, build new from scratch  
**Philosophy:** *"Communication is an ACTION, not a system"* (Tabletop RPG Model)

**Task States:** `[ ]` Not Started | `[~]` Implemented | `[x]` Tested

**Last Updated:** 2026-02-13

**⚠️ NOTE:** Multi-party sequential reply scheduling is deferred to `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`.
Edge cases + performance items from this plan are also tracked there now.

---

## 🎯 Goal

Implement a clean, tabletop RPG-style communication system where **COMMUNICATE is a first-class action** flowing through the ActionPipeline. All communication triggers witness reactions, engagement states, and memory formation.

### Non-Negotiable Rule (Single Pipeline)
There is exactly **one** authority for whether an NPC is "in the conversation" and therefore allowed to respond:
- **Witness-driven conversation state** (the system built around Grenda) is the default.
- If an NPC *perceives* a COMMUNICATE and *wants to join*, they are added as a participant (visual `O`, following/face behavior) and are allowed to respond.
- If an NPC perceives a COMMUNICATE but does *not* join, they do **not** respond.

**End State:**
- ✅ Left-click to select target, type to communicate
- ✅ Volume selection supported (frontend-dependent; defaults to NORMAL)
- ✅ All text = COMMUNICATE action through ActionPipeline
- ✅ NPCs react with engagement, facing, and responses
- ✅ Bystanders overhear based on personality
- ✅ Debug indicator shows conversation state (`o/O` when `\\` debug is enabled)
- ✅ Memories stored with personality filtering

---

## 🎲 Tabletop RPG Philosophy

### Core Insight
In tabletop games, talking to an NPC is an **action** like attacking or moving. It has:
- **Range** (how far can they hear you?)
- **Volume** (whisper vs shout)
- **Perception** (can they see/hear you?)
- **Reaction** (do they care enough to respond?)

### The Digital Translation

| Tabletop Concept | Digital Implementation |
|------------------|------------------------|
| "DM checks if NPC can hear" | Perception broadcast with sense checks |
| "Player says 'hello [npc_name]'" | Type text + click [NORMAL] button |
| "NPC stops to talk" | Engagement state + stop movement |
| "Others nearby might overhear" | Bystander social checks |
| "NPC gets bored after a while" | 30-second timeout |

---

## 🏗️ Architecture Overview

### Input System: "Click to Target, Type to Talk"

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT CONTROLS                          │
├─────────────────────────────────────────────────────────────────┤
│ LEFT CLICK  → Select target (NPC, enemy, item)                  │
│ RIGHT CLICK → Move / Use terrain / Go through doors             │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Design:**
- **Zero text parsing** - Target from click, not from "hello grenda" text
- **Visual clarity** - UI shows "Talking to: Grenda"
- **Consistent** - Same target system for attack, use, inspect
- **Fast** - No regex, no ambiguity

### The Action Pipeline Flow

```
Player Action:
1. LEFT CLICK on Grenda (selects target)
2. Type: "Do you have any quests?"
3. Click [NORMAL] volume button
    ↓
ActionPipeline Stage 0: Create Intent
    • Verb: COMMUNICATE
    • Target: npc.grenda (from click state)
    • Message: "Do you have any quests?"
    • Volume: NORMAL (from UI button)
    • Tool: actor.voice (body slot)
    ↓
Stage 1: Target Resolution
    • Confirm Grenda exists in place
    • Get her position: (7, 4)
    ↓
Stage 2: Validation
    • Distance: 4.5 tiles
    • NORMAL (pressure) range: 5 tiles ✓
    • Tool check: Has voice slot ✓
    • Line of sight: Not required for NORMAL
    ↓
Stage 3: Cost Check
    • COMMUNICATE cost: FREE ✓
    ↓
Stage 4: Rules Check
    • In combat? No ✓
    • Can speak? Yes ✓
    ↓
Stage 5: Broadcast Perception
    • For each NPC in range:
        • Check senses (pressure/light/thaumic/aroma)
        • Check vision cones (for light sense)
        • Check distance vs sense range
    • Create PerceptionEvent for each observer
    ↓
Stage 6: Execute
    • Log: "Henry says 'Do you have any quests?'"
    • Store in conversation archive
    • Generate AI response
    • Update actor facing to target
    ↓
Stage 7: Witness Reactions
    • For each PerceptionEvent:
        
        TARGET (Grenda):
        • Enters ENGAGED state
        • Stop current action (send NPC_STOP)
        • Face speaker (send NPC_FACE)
        • Emit `NPC_STATUS: busy` (conversation visual sync)
        • Debug overlay shows `O` (uppercase)
        • Generate response
        
         BYSTANDERS (e.g., Blacksmith):
         • Social check: Interest = f(personality, distance, content)
         • Interest ≥ 70: Join as participant
         • Interest 40-69: Eavesdrop (store memory)
         • Interest < 40: Ignore (continue current action)
        
        NO PERCEPTION (e.g., Guard 50 tiles away):
        • Continue patrol
        • No reaction
    ↓
Response Phase:
    • Grenda generates response using:
        - Conversation context
        - Personality traits
        - Memories of player
        - Current engagement state
    • Response: "I need someone to clear the rats from my basement..."
    • Render to player
    ↓
Memory Consolidation (on conversation end):
    • Grenda (participant): Full memory + emotional context
    • Blacksmith (bystander): Summary based on interest
    • Store in npc_storage/memory.ts
    • Update relationship status
```

---

## 🔁 Plan Addendum: Single Communication Pipeline (Fix Split Responses)

### Problem (Observed Bug)
Some NPCs can currently generate replies via `process_communication()` without entering witness-driven conversation state.
This creates inconsistent behavior (e.g., NPC replies but does not show conversation `O`, does not follow/face like Grenda).

### Desired Contract
For ActionPipeline-driven COMMUNICATE:
- **Perceived + Joins** => enters conversation state (`NPC_STATUS: busy`) and may respond.
- **Perceived + Does Not Join** => may store memory (eavesdrop) but must not respond.
- **Not Perceived** => no response.

### Implementation Plan (Fits Current Readability Rework)

1) Make witness processing produce a responder eligibility set
- Key by `actionId` (from `PerceptionEvent.actionId`).
- Only add an NPC to this set when witness decides they are a **participant**.
- Expose a small exported accessor from `src/npc_ai/witness_handler.ts` (e.g. `get_response_eligible_npcs(action_id)`), with TTL cleanup.

2) Promote "join" bystanders into full conversation state
- In `src/npc_ai/witness_handler.ts`, when social checks return `response_type: "join"`, call the same conversation start path used for direct targets:
  - stop movement (`NPC_STOP`), face (`NPC_FACE`), set goal, set conversation tracking, emit `NPC_STATUS: busy`.
- Ensure joiners are real participants (not just engagement-only).

3) Thread the eligibility set into the outbox message used for LLM response generation
- In `src/interface_program/main.ts` where the outbox message is created after ActionPipeline success, add:
  - `meta.response_eligible_by` (array of `npc.<id>` refs)
- Keep `meta.observed_by` as the broader perception list (useful for debugging).

4) Gate NPC replies strictly on witness eligibility
- In `src/npc_ai/main.ts` `process_communication()`:
  - for `meta.processed_by_action_pipeline === true`, only allow response generation for NPCs listed in `meta.response_eligible_by`.
  - remove/disable the legacy "direct target always responds" shortcut when pipeline-driven.

### Acceptance Tests
- Direct target in range => target shows `O` and responds.
- Bystander hears and joins => bystander shows `O` and responds.
- Bystander hears but eavesdrops => no response (may store memory).
- Out of hearing => no response.
- Door travel ends conversations (no stuck `O`).

---

## 📋 Current System Inventory

### ✅ What Already Exists (Don't Rebuild)

| System | File | Purpose | Status |
|--------|------|---------|--------|
| **Conversation Archive** | `conversation_manager/archive.ts` | Stores full conversation history | ✅ Use as-is |
| **Conversation Summarizer** | `conversation_manager/summarizer.ts` | NPC-perspective summaries | ✅ Use as-is |
| **NPC Memory Storage** | `npc_storage/memory.ts` | Long-term memory with importance | ✅ Use as-is |
| **Working Memory** | `context_manager/index.ts` | Short-term AI context | ✅ Use as-is |
| **Personality Filtering** | `context_manager/relevance.ts` | Filter memories by relevance | ✅ Use as-is |
| **Action Pipeline** | `action_system/pipeline.ts` | Execute actions, broadcast | ✅ Extend |
| **Sense Broadcasting** | `action_system/sense_broadcast.ts` | Action detectability | ✅ Extend |

### ⚠️ What Needs Modification

| Component | Current State | Needed Changes |
|-----------|---------------|----------------|
| **Input Routing** | Complex parsing, multiple paths | Simplify to click+type only |
| **Target Selection** | Parsed from text | Click-to-target state |
| **Volume Control** | Parsed from text | UI buttons |
| **Witness Handler** | Partially integrated | Complete integration |
| **Conversation State** | Basic tracking | Engagement system |
| **Debug Logging** | Minimal | Comprehensive |

### 🗑️ What to Remove

| Component | Why Remove | Replacement |
|-----------|------------|-------------|
| **Interpreter AI** | Unnecessary middleman | Direct ActionPipeline flow |
| **shouldUseActionPipeline()** | Not needed | All text = COMMUNICATE |
| **Complex regex parsing** | Fragile | Click-to-target |
| **Text-based volume parsing** | Ambiguous | UI buttons |

---

## 🔧 Implementation Details

### 1. Click-to-Target System

```typescript
// File: src/interface_program/target_state.ts

interface ActorTargetState {
  actor_ref: string;
  target_ref?: string;
  target_type?: "npc" | "actor" | "item" | "terrain";
  selected_at: number;
  is_valid: boolean;
}

const actor_targets = new Map<string, ActorTargetState>();

// Called on left click
export function handleLeftClick(
  clicked_entity: Entity, 
  actor_ref: string
): void {
  if (clicked_entity.type === "npc" || clicked_entity.type === "actor") {
    // Set as target
    actor_targets.set(actor_ref, {
      actor_ref,
      target_ref: clicked_entity.ref,
      target_type: clicked_entity.type,
      selected_at: Date.now(),
      is_valid: true
    });
    
    // Visual feedback
    highlightEntity(clicked_entity.ref);
    updateTargetUI(clicked_entity.name);
  }
}

// Called on right click
export function handleRightClick(
  clicked: Position | Entity,
  actor_ref: string
): void {
  if (clicked.type === "position") {
    // Move to location
    createMoveIntent(actor_ref, clicked.position);
  } else if (clicked.type === "door") {
    // Use door
    createUseIntent(actor_ref, clicked.ref);
  }
}

// Validate target before use
export function validateTarget(actor_ref: string): boolean {
  const state = actor_targets.get(actor_ref);
  if (!state?.target_ref) return false;
  
  const target = load_entity(state.target_ref);
  if (!target) {
    state.is_valid = false;
    return false;
  }
  
  // Check distance
  const distance = calculateDistance(actor_ref, state.target_ref);
  return distance <= MAX_TARGET_RANGE;
}
```

### 2. Communication Input Module

```typescript
// File: src/mono_ui/modules/communication_input.ts

interface CommunicationInputState {
  selected_volume: "WHISPER" | "NORMAL" | "SHOUT";
  text: string;
  current_target?: string;
}

// UI Layout:
// ┌─────────────────────────────────────────────┐
// │  Target: [Grenda] ✕                        │
// │                                             │
// │  📝 [Text Input]    [-] [=] [#]             │
// │                     Whs  Nrm  Sht           │
// └─────────────────────────────────────────────┘

function handleCommunicationSubmit(): void {
  const actor_ref = "actor.henry_actor";
  const target_state = actor_targets.get(actor_ref);
  const volume = getSelectedVolume(); // From button state
  const text = getInputText();
  
  const intent = createIntent(actor_ref, "COMMUNICATE", "player_input", {
    message: text,
    volume: volume,
    target_hint: target_state?.target_ref,
    tool: "actor.voice",
    parameters: {
      subtype: volume,
      message: text,
      targets: target_state?.target_ref ? [target_state.target_ref] : []
    }
  });
  
  actionPipeline.process(intent);
}

// Volume button click handlers
function onWhisperClick(): void {
  setSelectedVolume("WHISPER");
  updateVolumeUI("WHISPER"); // Highlight button
}

function onNormalClick(): void {
  setSelectedVolume("NORMAL");
  updateVolumeUI("NORMAL");
}

function onShoutClick(): void {
  setSelectedVolume("SHOUT");
  updateVolumeUI("SHOUT");
}
```

### 3. Action: COMMUNICATE

```typescript
// File: src/action_system/registry.ts

COMMUNICATE: {
  verb: "COMMUNICATE",
  category: "social",
  
  // Tool requirement (simplified for Phase 1)
  requiresTool: true,
  defaultToolSlot: "voice",  // Body slot - hardcoded for now
  validToolTypes: ["sense"],
  
  // TODO: Future - Full body slot system
  // Body slots include senses:
  // - voice (pressure, for speaking)
  // - eyes (light, for seeing)
  // - ears (pressure, for hearing)
  // Senses on character sheet = MAX of all body slots
  
  subtypes: {
    WHISPER: {
      range_tiles: 3,
      senses: ["pressure"],
      description: "Only audible to nearby targets"
    },
    NORMAL: {
      range_tiles: 5,
      senses: ["pressure", "light"],
      description: "Normal conversation range"
    },
    SHOUT: {
      range_tiles: 30,
      senses: ["pressure", "light"],
      description: "Loud, attracts attention"
    }
  },
  
  cost: "FREE"
}
```

### 4. Engagement System

```typescript
// File: src/npc_ai/engagement_service.ts

type EngagementType = "participant" | "bystander";
type EngagementState = "idle" | "engaged" | "distracted";

interface Engagement {
  npc_ref: string;
  engaged_with: string[];
  type: EngagementType;
  state: EngagementState;
  
  // Tabletop: "NPC stops what they're doing"
  interrupted_action?: ActionIntent;
  
  // Tabletop: "They'll listen for a while"
  attention_span_ms: number;
  last_interaction_at: number;
  
  // Tabletop: "If you walk away..."
  max_distance_tiles: number;
}

const engagements = new Map<string, Engagement>();

export function enterEngagement(
  npc_ref: string,
  target_ref: string,
  type: EngagementType
): void {
  const npc = load_npc(npc_ref);
  
  // Save current action
  const interrupted = getCurrentAction(npc_ref);
  
  // Stop current action
  if (interrupted) {
    stopAction(npc_ref);
    sendNpcStopCommand(npc_ref);
  }
  
  // Face speaker
  faceTarget(npc_ref, target_ref);
  sendNpcFaceCommand(npc_ref, target_ref);
  
  // Visual indicator
  updateNpcStatus(npc_ref, "busy");
  spawnConversationIndicator(npc.position, true, npc_ref);
  
  // Store engagement
  engagements.set(npc_ref, {
    npc_ref,
    engaged_with: [target_ref],
    type,
    state: "engaged",
    interrupted_action: interrupted,
    attention_span_ms: 30000, // 30 seconds
    last_interaction_at: Date.now(),
    max_distance_tiles: type === "participant" ? 3 : 10
  });
  
  log("[ENGAGEMENT]", `${npc_ref} entered ${type} engagement with ${target_ref}`);
}

export function updateEngagement(npc_ref: string): void {
  const engagement = engagements.get(npc_ref);
  if (!engagement) return;
  
  const now = Date.now();
  const idle_time = now - engagement.last_interaction_at;
  
  // Check timeout
  if (idle_time > engagement.attention_span_ms) {
    endEngagement(npc_ref, "timeout");
    return;
  }
  
  // Check distance
  const distance = calculateDistance(npc_ref, engagement.engaged_with[0]);
  if (distance > engagement.max_distance_tiles) {
    endEngagement(npc_ref, "out_of_range");
    return;
  }
  
  // Update state
  if (idle_time > engagement.attention_span_ms * 0.7) {
    engagement.state = "distracted";
    log("[ENGAGEMENT]", `${npc_ref} is getting distracted...`);
  }
}

export function endEngagement(npc_ref: string, reason: string): void {
  const engagement = engagements.get(npc_ref);
  if (!engagement) return;
  
  log("[ENGAGEMENT]", `${npc_ref} leaving engagement (${reason})`);
  
  // Clear visual indicator
  updateNpcStatus(npc_ref, "present");
  
  // Restore previous action
  if (engagement.interrupted_action) {
    resumeAction(npc_ref, engagement.interrupted_action);
  }
  
  // Clean up
  engagements.delete(npc_ref);
}
```

### 5. Bystander Social Checks

```typescript
// File: src/npc_ai/social_checks.ts

interface SocialCheckResult {
  responds: boolean;
  interest_level: number;
  response_type: "join" | "eavesdrop" | "ignore";
}

export function calculateSocialResponse(
  npc: NPC,
  event: CommunicationEvent
): SocialCheckResult {
  const personality = npc.personality;
  let interest = 0;
  
  // 1. Base Curiosity (0-30 points)
  interest += (personality.curiosity || 5) * 3;
  
  // 2. Distance Factor (0-20 points)
  const max_range = getVolumeRange(event.volume);
  const distance_factor = Math.max(0, 1 - (event.distance / max_range));
  interest += distance_factor * 20;
  
  // 3. Content Relevance (0-40 points)
  const message = event.message.toLowerCase();
  if (personality.interests) {
    for (const interest_keyword of personality.interests) {
      if (message.includes(interest_keyword.toLowerCase())) {
        interest += 20;
      }
    }
  }
  
  // 4. Relationship Bonus (-20 to +20 points)
  const relationship = getRelationship(npc.ref, event.speaker);
  interest += (relationship?.fondness || 0) * 2;
  
  // 5. Gossip Factor (0-15 points)
  if ((personality.gossip_tendency || 5) > 5) {
    if (message.includes("secret") || message.includes("heard")) {
      interest += 15;
    }
  }
  
  // 6. Suspiciousness (0-15 points)
  if (personality.suspicious && event.volume === "WHISPER") {
    interest += 15;
  }
  
  // Decision thresholds
  if (interest >= 70) {
    return { responds: true, interest_level: interest, response_type: "join" };
  } else if (interest >= 40) {
    return { responds: true, interest_level: interest, response_type: "eavesdrop" };
  } else {
    return { responds: false, interest_level: interest, response_type: "ignore" };
  }
}
```

---

## 🎮 UI/UX Design

### Communication Interface

```
┌──────────────────────────────────────────────────────────────┐
│                         GAME SCREEN                          │
│                                                              │
│  [Map/Place View - Left click target, Right click move]     │
│                                                              │
│  NPCs in view:                                               │
│  • Grenda [L-click to talk]                                  │
│  • Blacksmith [L-click to talk]                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [Conversation History]                                      │
│  Grenda: "What do you need?"                                 │
│  Henry: "Do you have any quests?"                           │
├──────────────────────────────────────────────────────────────┤
│  Target: [Grenda] ✕                                          │
│  [________________] [🔇 Whisper] [🗣️ Normal] [📢 Shout]     │
└──────────────────────────────────────────────────────────────┘

Visual Indicators:
- Selected target: Highlighted in world + name in UI
- Debug `o/O` below NPC (when `\\` enabled): `o` idle, `O` conversing
- Facing arrows: Direction NPC is looking
```

### Visual Feedback

| State | Visual Cue | Meaning |
|-------|------------|---------|
| **Target Selected** | Highlighted name + "Talking to: X" | You will communicate to this target |
| **NPC Conversing (Debug)** | `O` below NPC | NPC is in conversation (`NPC_STATUS: busy`) |
| **NPC Facing** | Arrow showing direction | NPC is looking at speaker |
| **Volume Selected** | Highlighted button | Whisper(3)/Normal(5)/Shout(30) tiles |
| **Timeout Warning** | (optional) Yellow `O` | NPC getting bored, will leave soon |

---

## 🗑️ Cleanup Checklist

### Files to Remove/Archive

- [~] **`src/interpreter_ai/`** - Entire directory (no longer needed) - Implemented
  - [x] Move to `archive/interpreter_ai/` - Tested
  - [x] Remove from service startup scripts - Tested
  
- [~] **`src/interface_program/action_integration.ts:173-193`** - `shouldUseActionPipeline()` - Implemented
  - [x] Delete function entirely - Tested
  - [x] All text goes directly to COMMUNICATE - Tested
  
- [~] **`src/interface_program/main.ts:1781-1880`** - Old parsing logic - Implemented
  - [x] Remove complex regex patterns - Tested
  - [x] Keep only simple text → intent conversion - Tested

### Files to Create

- [x] **`src/interface_program/target_state.ts`** - Click-to-target system - Tested (63 lines)
- [x] **`src/npc_ai/engagement_service.ts`** - Engagement state management - Tested (234 lines)
- [x] **`src/npc_ai/social_checks.ts`** - Bystander interest calculations - Tested (174 lines)
- [~] **`src/shared/debug_logger.ts`** - Outdated (using `src/shared/debug.ts` + structured service logs instead)

### Files to Modify

- [~] **`src/action_system/registry.ts`** - Update COMMUNICATE definition - Implemented
- [~] **`src/interface_program/main.ts`** - Simplify input routing - Implemented
- [~] **`src/action_system/pipeline.ts`** - Add debug logging at each stage - Implemented
- [~] **`src/npc_ai/witness_handler.ts`** - Complete integration - Implemented
- [~] **`src/mono_ui/modules/input_module.ts`** - Outdated path (volume state exists; mono_ui needs bindings if desired)

---

## ✅ Implementation Timeline

### Week 1: Foundation & Cleanup

**Day 1-2: Archive Old Systems (Option B)** ✅
- [x] Archive `src/interpreter_ai/` to `archive/` - Tested
- [x] Remove all Interpreter AI imports - Tested
- [x] Remove `shouldUseActionPipeline()` function - Tested
- [x] Strip complex regex from input parsing - Tested
- [x] Verify game still compiles and runs - Tested
- [x] **DO NOT DEBUG** - Just archive and remove - Tested

**Day 3: Click-to-Target System** ✅
- [x] Create `target_state.ts` - Tested
- [x] Implement left/right click handlers - Tested
- [x] Add target validation (distance check) - Tested
- [x] Visual feedback commands (HIGHLIGHT, TARGET) - Backend Tested
- [x] Visual feedback sender functions - Backend Tested
- [x] Frontend: Handle HIGHLIGHT commands - Implemented (target highlight handled in `src/mono_ui/modules/place_module.ts`)
- [x] Frontend: Handle TARGET commands - Implemented (target state handled in `src/mono_ui/modules/place_module.ts`)
- [x] Frontend: Render "Talking to: Grenda" display - Tested (implemented in `src/mono_ui/modules/place_module.ts`)

**Day 4: Communication Input Module** ✅
- [x] Build new input module (don't fix old one) - Tested
- [~] Volume buttons (🔇🗣️📢) - Logic Implemented (UI bindings vary by frontend)
- [x] Text input field - Logic Implemented
- [~] Target display with clear button - Implemented (display + clear API exist; UI button/keybind may vary)
- [~] Test: UI elements render correctly - Implemented (minor rendering-order bug tracked in advanced plan)

**Day 5: Integration & First Test** ✅
- [x] Wire input module → ActionPipeline - Tested
- [x] Create COMMUNICATE intent with volume + target - Tested
- [x] Add basic debug logging - Tested
- [x] Test: Click Grenda + type + send → ActionPipeline receives intent - Tested (slot 1 manual + logs)

**Day 6-7: Debug Buffer**
- [x] Fix integration issue: NPC messages not displaying - Tested (displayMessageToUser now writes to log with correct sender)
- [x] Use existing conversation system - Tested (removed duplicate conversation events, using existing process_communication with build_npc_prompt)
- [x] Fix communication flow for ActionPipeline - Tested (NPC_AI now processes "sent" messages with COMMUNICATE intent from ActionPipeline)
- [x] Fix intent_verb defaulting - Tested (API now defaults to COMMUNICATE when target_ref exists but no explicit intent)
- [x] Fix duplicate message processing - Tested (Breath now uses continue after processing COMMUNICATE to avoid double-processing)
- [x] Fix position updates being treated as user input - Tested (Breath now excludes npc_position_update type messages from isUserInput check)
- [x] Fix message not written to outbox - Tested (Breath now writes COMMUNICATE messages to outbox after ActionPipeline success for NPC_AI to process)
- [x] NPC responds to messages - Working (Grenda responds with LLM-generated content)
- [x] Fix message ordering in window_module - Fixed (messages now sorted by timestamp chronologically)
- [x] Remove duplicate messages - Fixed (removed direct log write in NPC_AI, added content-based deduplication in frontend)
- [x] Debug `o/O` indicator appears - Implemented + tested

### Week 2: Engagement System

**Day 8-9: State Machine** ✅
- [x] Create `engagement_service.ts` - Tested
- [x] IDLE ↔ ENGAGED transitions - Tested
- [x] Interrupt/restore actions - Implemented
- [x] Face speaker on engage - Implemented
- [x] Test: NPC stops and faces when communicated to - Tested (slot 1 manual + logs)

**Day 10-11: Visual Feedback**
- [x] Stop movement on engagement - Implemented (send_stop_command in witness_handler)
- [x] Update status to "busy" - Implemented (status commands working)
- [x] Spawn debug `o/O` indicator - Implemented via `src/mono_ui/vision_debugger.ts`
- [x] Facing updates - Implemented (send_face_command in witness_handler)
- [x] Test: Visual indicators work - Tested (slot 1 manual; `O` busy indicator)

**Day 12-14: Timeouts & Polish**
- [x] 30-second attention span - Implemented
- [x] Distance breaks engagement - Implemented
- [x] Resume interrupted actions - Implemented (restore previous goal on conversation end)
- [x] Farewell detection - Implemented (witness handler + archive analysis)
- [~] Debug and fix edge cases - Moved to `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`
- [x] Performance: Only check engaged NPCs (not all) - Implemented

### Week 3: Social Simulation & Memory

**Day 15-16: Social Checks** ✅
- [x] Create `social_checks.ts` - Tested
- [x] Interest calculation algorithm - Tested
- [x] Personality integration - Tested
- [~] Cache interest scores (performance) - Moved to `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`
- [x] Debug: Log interest scores - Tested

**Day 17-18: Bystander Reactions**
- [x] Join vs eavesdrop vs ignore - Implemented
- [x] Threshold-based decisions - Implemented
- [x] Test with multiple NPCs - Tested (Grenda + Mira in same place)

**Day 19-21: Memory System**
- [x] Participant memories (full detail) - Implemented (conversation_summarizer -> npc_storage/memory)
- [x] Bystander memories (filtered) - Implemented (witness_handler eavesdrop/join -> npc_storage/memory)
- [x] Memory importance scoring - Implemented
- [x] Store to npc_storage/memory.ts - Implemented
- [~] Test: Memories persist and retrieve - Moved (requires inspection/retrieval UI)

### Week 4: Polish, Testing & Documentation

**Day 22-25: Edge Cases + Performance**
- [~] Moved to `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`

**Day 26-28: Documentation**
- [x] Architecture documentation - Tested (see this plan + `docs/guides/NPC_WITNESS_SYSTEM.md`)
- [x] Testing guide - Tested (see `docs/testing/COMMUNICATION_TEST_CASES.md` and logs)
- [x] Update README - Tested (`docs/plans/README.md` formatting + cross-plan references)
- [x] Final review - Tested (core flow + multi-NPC test run)

Deferred:
- Code comments (JSDoc) is hygiene work; not required to archive the plan.

---

## 📝 Documentation Standards

**Every code change must include:**
1. **JSDoc comments** for all new functions
2. **Debug logging** with standardized prefixes
3. **Brief description** of what was changed and why

**Debug Log Prefixes:**
- `[PIPELINE]` - ActionPipeline stages
- `[WITNESS]` - Witness event processing
- `[ENGAGE]` - Engagement state changes
- `[SOCIAL]` - Social checks
- `[TARGET]` - Target selection
- `[MEMORY]` - Memory storage/retrieval

---

## 🔍 Debug Logging Standards

### Required Log Prefixes

Note: `src/shared/debug_logger.ts` was not created; the codebase uses `src/shared/debug.ts` (and structured service logs). The snippet below is illustrative only.

```typescript
// File: src/shared/debug_logger.ts

export const LogPrefix = {
  PIPELINE: '[PIPELINE]',
  WITNESS: '[WITNESS]',
  ENGAGEMENT: '[ENGAGE]',
  SOCIAL: '[SOCIAL]',
  MEMORY: '[MEMORY]',
  TARGET: '[TARGET]',
  INPUT: '[INPUT]'
} as const;

export function log(prefix: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${prefix} ${message}`, data || '');
}

// Usage:
log(LogPrefix.TARGET, `Selected: ${npc_ref}`);
log(LogPrefix.SOCIAL, `${npc_ref} interest: ${interest}/100`);
log(LogPrefix.ENGAGEMENT, `${npc_ref} entered conversation`);
```

### Log Analysis Commands

```bash
# Filter for specific systems
grep "\[TARGET\]" local_data/data_slot_1/logs/latest.log
grep "\[WITNESS\]" local_data/data_slot_1/logs/latest.log
grep "\[ENGAGE\]" local_data/data_slot_1/logs/latest.log
grep "\[SOCIAL\]" local_data/data_slot_1/logs/latest.log

# Combined filter for conversation flow
grep -E "\[TARGET\]|\[WITNESS\]|\[ENGAGE\]|\[SOCIAL\]" local_data/data_slot_1/logs/latest.log
```

---

## 🎮 Testing Scenarios

### Test 1: Basic Communication Flow
```
Setup: Player near Grenda (2 tiles)
Actions:
  1. LEFT CLICK on Grenda
  2. UI shows: "Target: Grenda"
  3. Type: "hello"
  4. Click [NORMAL]
Expected:
  - [TARGET] Selected: npc.grenda
  - [PIPELINE] Stage 1-7 complete
  - [WITNESS] Grenda can perceive: true
  - [ENGAGE] Grenda entered participant engagement
  - `O` appears below Grenda (debug mode)
  - Grenda responds
```

### Test 2: Bystander Overhears
```
Setup: Player(0,0), Grenda(2,0), Blacksmith(8,0)
Actions:
  1. LEFT CLICK on Grenda
  2. Click [NORMAL]
  3. Type: "secret plans"
Expected:
  - [SOCIAL] Blacksmith interest: 72/100 (high curiosity + "secret")
  - [ENGAGE] Blacksmith entered bystander engagement
  - Blacksmith stores memory
  - Guard at (20,0): No perception
```

### Test 3: Whisper Range
```
Setup: Player(0,0), Grenda(4,0)
Actions:
  1. LEFT CLICK on Grenda
  2. Click [WHISPER]
  3. Type: "secret"
Expected:
  - [PIPELINE] Stage 2: Validation failed
  - "You're too far to whisper"
  - Suggestion: "Move closer or shout"
```

### Test 4: Engagement Timeout
```
Setup: Player in conversation with Grenda
Action: Wait 30 seconds without typing
Expected:
  - [ENGAGE] Grenda is getting distracted...
  - [ENGAGE] Grenda leaving engagement (timeout)
  - `o` returns (debug mode)
  - Grenda resumes previous action
```

---

## 🏗️ Future Architecture (TODOs)

### TODO: Full Body Slot System

**Status:** Not Phase 1

**Architecture:**
```typescript
// Body slots include senses as innate abilities
interface BodySlot {
  slot_id: string;
  slot_type: "sense" | "tool" | "weapon" | "armor";
  sense_type?: SenseType;
  sense_value?: number;
  status: "healthy" | "damaged" | "missing";
}

// Senses on NPC sheet = MAX of body slots
function calculateSenses(npc: NPC): Record<SenseType, number> {
  const senses = { pressure: 0, light: 0, aroma: 0, thaumic: 0 };
  for (const slot of npc.body_slots) {
    if (slot.slot_type === "sense" && slot.sense_type) {
      senses[slot.sense_type] = Math.max(
        senses[slot.sense_type],
        slot.sense_value || 0
      );
    }
  }
  return senses;
}

// Future: Body mods, severing parts, augments
```

### TODO: Multiple Languages

**Status:** Not Phase 1

**Architecture:**
```typescript
// Species-based languages with sense requirements
type Language = {
  id: string;
  name: string;
  required_sense: SenseType;
  species: string[];
};

const LANGUAGES = [
  { id: "lang.common", sense: "pressure", species: ["human", "elf"] },
  { id: "lang.chitter", sense: "aroma", species: ["insectoid"] },
  { id: "lang.resonance", sense: "pressure", species: ["golem"] }
];

// COMMUNICATE action includes language
interface CommunicateParams {
  message: string;
  volume: Volume;
  language: string;  // Default: "lang.common"
  tool: string;
}
```

---

## 📊 Current Progress

**Last Updated:** 2026-02-13  
**Status:** Core flow working; remaining items are UI polish, perf, and edge cases

### ✅ Completed

| Week | Task | Status | Notes |
|------|------|--------|-------|
| W1D1-2 | Archive old systems | [x] | interpreter_ai/ moved, old parsing removed |
| W1D3 | Click-to-target | [x] | target_state.ts created (63 lines) |
| W1D4 | Communication input | [x] | communication_input.ts created (139 lines) |
| W1D5 | Integration | [x] | Wired to ActionPipeline, click handlers exported |
| W2D8-9 | Engagement service | [x] | engagement_service.ts created (234 lines) |
| W2D10-11 | Social checks | [x] | social_checks.ts created (174 lines) |
| W3D15-16 | Interest algorithm | [x] | 0-100 scoring with personality |

### 🚧 In Progress / TODO

| Week | Task | Status | Notes |
|------|------|--------|-------|
| W1 | Frontend UI | [~] | Target display implemented; volume UI depends on frontend |
| W1 | Visual feedback | [~] | Highlight selected NPC - Implemented (backend ready, frontend in place_module) |
| W2 | Integration testing | [x] | Wire engagement to witness handler - Tested (working) |
| W2 | Debug `o/O` indicator | [x] | Visual conversation state (debug mode) |
| W3 | Memory storage | [~] | Stored (participant + bystander); retrieval UI/tests pending |
| W4 | Edge cases | [ ] | Death, disconnect, etc. - Not Started |

### 📈 Statistics

- **Lines Added:** ~620 (new systems + visual indicator + display fix + ordering fix)
- **Lines Removed:** ~255 (old parsing + duplicate conversation event system + duplicate log writes)
- **Net Change:** +365 lines
- **Files Created:** 4
- **Build Status:** ✅ Compiles (no new errors)
- **Progress:** ~92% complete

---

## ✅ Success Criteria

**From Tabletop Perspective:**

- [~] **"It feels like a DM is running NPCs"** - Implemented (sequencing improvements deferred)
  - [x] NPCs respond to range and volume - Tested
  - [x] Personality affects who responds - Tested
  - [x] Visual feedback matches narrative - Tested

- [x] **"Communication has tactical considerations"** - Tested
  - [x] Whisper vs shout matters - Tested
  - [x] Distance matters - Tested
  - [x] Who can hear matters - Tested

- [~] **"NPCs feel alive"** - Implemented (content iteration ongoing)
  - [x] Stop what they're doing to talk - Tested
  - [x] Get bored and leave - Tested
  - [~] Remember past conversations - Implemented (storage), retrieval still pending

- [~] **"The system is debuggable"** - Implemented
  - [~] Logs read like a DM's notes - Implemented (could be cleaned up further)
  - [x] Clear cause-and-effect chains - Tested (ActionPipeline + witness logs)
  - [x] Easy to see why an NPC did/didn't respond - Tested (interest + eligibility gating)

**Technical Criteria:**

- [x] All text input flows through ActionPipeline - Tested
- [x] Click-to-target works (no text parsing) - Tested
- [~] Volume buttons work (not text parsing) - Implemented (UI bindings vary by frontend)
- [x] Debug `o/O` indicator appears reliably - Tested (uses renderer-synced `NPC_STATUS`)
- [x] Engagement system (stop, face, timeout) - Tested
- [x] Bystanders react based on personality - Tested
- [x] NPC responses use existing system - Tested (process_communication with build_npc_prompt, decision hierarchy, memory context, location awareness)
- [~] Memories stored and retrieved - Stored (participant + bystander); retrieval/testing still pending
- [~] Comprehensive debug logging - Implemented (debug_log used throughout)
- [x] Old systems removed/cleaned up - Tested

---

**Status Update:** Backend systems complete, visual feedback working, message ordering fixed, duplicates removed (92%). Using existing process_communication() flow with your build_npc_prompt() system. Messages now display chronologically without duplicates.

### Immediate Next Steps:
1. [x] Wire `engagement_service.ts` to `witness_handler.ts` - Tested
2. [x] Add debug `o/O` indicator spawning - Implemented
3. [x] Fix NPC message display - Tested
4. [x] Use existing conversation system - Tested (process_communication with build_npc_prompt, decision hierarchy, memory context)
5. [x] Fix message ordering - Tested (sorted by timestamp chronologically)
6. [x] Remove duplicate messages - Tested (content-based deduplication)
7. [x] Test: Full conversation flow end-to-end

### Outdated / Moved To Newer Plans
- Multi-party sequential reply ordering and anti-pile-on: `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`
- Archetype-driven defaults and interaction phases: `docs/plans/2026_02_12_npc_archetypes_and_interaction_phases.md`

### Blockers:
- None. All backend systems compile and are ready for integration.

### Deferred Notes:
- ActionPipeline CR math looks wrong for melee (`USE.IMPACT_SINGLE` showing CR=50 at distance=1 in eval logs). Defer until USE/ATTACK rules are implemented fully.

---

**Ready to continue?** Current focus: Integration testing and visual feedback.

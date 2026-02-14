# NPC Movement Dual-Authority Bug (Historical)

**Date:** 2026-02-12 (inferred)
**Status:** Retrospective

This note is preserved for context. The core fix is already implemented (renderer-visible `NPC_STATUS` sync), but the writeup is still useful when debugging movement authority issues.

## Overview

This document explains the confusing dual-system architecture that causes NPCs to continue wandering during conversations, and provides ideas for fixing it.

## The Problem

**Symptom:** NPCs continue to move/wander while in conversation, despite the "converse" goal being set.

**Root Cause:** There are **TWO separate movement systems** that don't properly coordinate:

1. **NPC_AI Backend** (`src/npc_ai/`)
2. **Renderer Frontend** (`src/mono_ui/modules/place_module.ts` or similar)

---

## System Architecture

### 1. NPC_AI Backend (Node.js Process)

**Files:**
- `src/npc_ai/movement_loop.ts` - Controls wandering logic
- `src/npc_ai/witness_handler.ts` - Handles conversation start/end
- `src/npc_ai/conversation_state.ts` - Tracks conversation state

**Responsibilities:**
- Decides WHEN NPCs should move (goal setting)
- Tracks conversation state (in-memory)
- Calls `stop_entity_movement()` when conversation starts
- Checks `is_in_conversation()` before allowing new wandering

**Communication:**
- Runs in separate Node.js process
- Communicates via `outbox.jsonc` / `inbox.jsonc`
- Sends movement commands to renderer via messages

### 2. Renderer Frontend (Electron/Chromium Process)

**Files:**
- `src/mono_ui/modules/place_module.ts` - Place rendering & entity updates
- Movement visualization and execution
- `NPC_Movement` and `MovementEngine` classes (referenced in logs)

**Responsibilities:**
- Renders NPCs on screen
- Executes actual movement animation
- Has its own `NPC_Movement` system that can initiate wandering

**Communication:**
- Receives state updates from backend
- Can independently decide to start movement
- Does NOT have access to backend's `is_in_conversation()` state

---

## The Bug Flow

```
1. Player says "hello grenda"
   ↓
2. NPC_AI witness_handler detects communication
   ↓
3. NPC_AI calls:
      - start_conversation() ✓
      - set_goal("converse") ✓
      - stop_entity_movement() ✓
      - cancel_npc_wandering() ✓
   ↓
4. NPC AI correctly stops movement (backend)
   ↓
5. Renderer receives place update/refresh
   ↓
6. Renderer's NPC_Movement system sees NPC with no active movement
   ↓
7. Renderer decides: "This NPC should be wandering!"
   ↓
8. Renderer starts new wandering sequence ❌
   ↓
9. NPC moves on screen despite being in conversation
```

**Key Issue:** The renderer's movement/visual systems operate independently and can't read backend in-memory conversation state.

**Fix (implemented):** Sync a lightweight conversation *visual* state via messages:
- Backend emits `NPC_STATUS busy/present`.
- Renderer maintains a stable per-NPC status map and uses it for debug `o/O` and conversation-facing.

---

## Log Evidence

**Backend (NPC_AI) - Correct Behavior:**
```
[npc_ai] [INFO] [Witness] Starting conversation for npc.grenda
[npc_ai] [INFO] NPC_Movement Set goal for npc.grenda { type: 'converse', ... }
[npc_ai] [INFO] [Witness] npc.grenda entered conversation with actor.henry_actor
```

**Frontend (Renderer) - Incorrect Behavior:**
```
[electron] [INFO] [Renderer log] NPC_Movement Initialized movement state
[electron] [INFO] [Renderer log] NPC_Movement Set goal for npc.grenda
[electron] [INFO] [Renderer log] MovementEngine npc.grenda started moving
[electron] [INFO] [Renderer log] NPC_Movement npc.grenda started wandering to (2, 7) ❌
```

Notice: The renderer's `NPC_Movement` is starting wandering AFTER the backend set the "converse" goal.

---

## Why Previous Fixes Didn't Work

### Fix Attempt 1: Add `stop_entity_movement()`
- **Location:** `witness_handler.ts`
- **Result:** Backend stops movement, but renderer restarts it
- **Why it failed:** Only affected backend process

### Fix Attempt 2: Add conversation check in `init_place_movement()`
- **Location:** `movement_loop.ts`
- **Result:** Backend skips wandering, but renderer doesn't
- **Why it failed:** Backend check doesn't affect renderer's independent decisions

---

## Potential Solutions

### Solution 1: Shared State (Recommended for MVP)

**Approach:** Store conversation state in shared storage that both systems can read.

**Implementation:**
1. Add conversation state to NPC storage (`npc_storage/store.ts`)
2. When conversation starts, save `is_in_conversation: true` to NPC data
3. Renderer checks this flag before starting any movement
4. When conversation ends, set `is_in_conversation: false`

**Pros:**
- Relatively simple to implement
- Both systems use existing storage infrastructure

**Cons:**
- File I/O overhead (reading/writing JSON)
- Slight delay in state propagation

**Files to modify:**
- `src/npc_storage/store.ts` - Add conversation state field
- `src/npc_ai/conversation_state.ts` - Save/load from storage
- `src/mono_ui/modules/place_module.ts` - Check state before moving

---

### Solution 2: Message-Based Coordination

**Approach:** Send explicit "stop movement" message from backend to renderer.

**Implementation:**
1. Create new message type: `STOP_NPC_MOVEMENT`
2. Backend sends message when conversation starts
3. Renderer receives message and halts movement
4. Renderer sends acknowledgment

**Pros:**
- Direct communication
- Immediate effect
- No polling needed

**Cons:**
- More complex message routing
- Need to handle race conditions
- Renderer might still auto-restart movement

**Files to modify:**
- `src/shared/message_types.ts` - Add new message type
- `src/npc_ai/witness_handler.ts` - Send stop message
- `src/mono_ui/message_handler.ts` - Handle stop message

---

### Solution 3: Unified Movement Authority

**Approach:** Make NPC_AI the **sole authority** for all movement decisions.

**Implementation:**
1. Renderer NEVER initiates movement on its own
2. Renderer only VISUALIZES movement commanded by NPC_AI
3. NPC_AI sends explicit movement commands via messages
4. Renderer executes but doesn't decide

**Pros:**
- Single source of truth
- Eliminates race conditions
- Cleaner architecture

**Cons:**
- Major refactoring required
- Need to move all movement logic to backend
- More message traffic

**Files to modify:**
- `src/npc_ai/movement_loop.ts` - Become sole movement authority
- `src/mono_ui/modules/place_module.ts` - Remove movement initiation
- `src/shared/movement_engine.ts` - Backend-only execution

---

### Solution 4: Goal-Based Sync (Current Design, Needs Fix)

**Approach:** The renderer should respect the "converse" goal set by NPC_AI.

**Implementation:**
1. Ensure "converse" goal is properly synced to renderer
2. Renderer's movement system checks goal type before wandering
3. If goal is "converse", don't start new wandering

**Current Gap:** The renderer's `NPC_Movement` system doesn't check the goal type before deciding to wander.

**Pros:**
- Minimal changes
- Uses existing goal system

**Cons:**
- Requires renderer to be goal-aware
- Still has potential race conditions

**Files to modify:**
- `src/mono_ui/modules/place_module.ts` - Check goal before moving
- `src/shared/movement_engine.ts` - Respect goal priority

---

## Debugging Checklist

When investigating movement bugs, check:

- [ ] **Backend logs:** Is `set_goal("converse")` called?
- [ ] **Backend logs:** Is `stop_entity_movement()` called?
- [ ] **Backend logs:** Is `is_in_conversation()` returning true?
- [ ] **Frontend logs:** Is the renderer receiving the goal update?
- [ ] **Frontend logs:** Is `NPC_Movement` checking conversation state?
- [ ] **State sync:** Is conversation state in shared storage?
- [ ] **Timing:** Is there a race condition between backend stop and frontend start?

---

## Immediate Debugging Steps

1. **Add logging in renderer:**
   ```typescript
   // In renderer's movement initialization
   console.log(`[Renderer] Checking conversation state for ${npc_ref}:`, is_in_conversation);
   if (is_in_conversation) {
     console.log(`[Renderer] Skipping wander - in conversation`);
     return;
   }
   ```

2. **Verify state sync:**
   - Check if conversation state is being saved to NPC storage
   - Check if renderer is reading from same storage

3. **Check message flow:**
   - Verify renderer receives goal updates from backend
   - Check if renderer processes goal updates before deciding to move

---

## Architecture Improvement Recommendations

### Short-term (MVP):
- Implement **Solution 1** (Shared State) for stability
- Add comprehensive logging to both systems

### Long-term (Post-MVP):
- Implement **Solution 3** (Unified Authority) for cleaner architecture
- Consider moving all AI/behavior logic to backend
- Renderer becomes pure visualization layer

---

## Related Files

**Backend:**
- `src/npc_ai/witness_handler.ts`
- `src/npc_ai/witness_integration.ts`
- `src/npc_ai/conversation_state.ts`
- `src/npc_ai/movement_loop.ts`
- `src/shared/movement_engine.ts`

**Frontend/Renderer:**
- `src/mono_ui/modules/place_module.ts`
- `src/mono_ui/modules/entity_renderer.ts` (if exists)
- `src/shared/movement_engine.ts` (shared but executed in renderer)

**Storage:**
- `src/npc_storage/store.ts`
- `local_data/data_slot_1/outbox.jsonc`
- `local_data/data_slot_1/inbox.jsonc`

---

## Conclusion

The wandering-during-conversation bug stems from having **two independent movement systems** that don't share state properly. The NPC_AI backend correctly tracks conversations and tries to stop movement, but the renderer frontend independently decides to start wandering based on its own logic.

**The fix requires either:**
1. Sharing conversation state between systems (Shared State approach)
2. Giving one system sole authority over movement (Unified Authority approach)
3. Better coordination via messages (Message-Based approach)

Without one of these architectural fixes, the bug will persist because the renderer will continue making independent movement decisions.

---

**Last Updated:** February 8, 2026  
**Status:** Bug identified, solutions documented, implementation pending

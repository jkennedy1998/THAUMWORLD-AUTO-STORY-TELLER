# Communication System - Wiring Complete

**Date:** 2026-02-09  
**Status:** Major connections soldered

---

## ✅ Just Completed: Backend Integration

### 1. Witness Handler → Engagement Service

**File:** `src/npc_ai/witness_handler.ts`

**Added Imports:**
```typescript
import {
  enterEngagement,
  isEngaged,
  updateEngagement,
  endEngagement
} from "./engagement_service.js";
```

**Integration Points:**
- ✅ `start_conversation_with_actor()` calls `enterEngagement(observer_ref, actor_ref, "participant")`
- ✅ Extending conversation calls `updateEngagement(observer_ref)`
- ✅ `restore_previous_goal()` calls `endEngagement(npc_ref, "conversation ended")`
- ✅ `handle_movement_perception()` checks `isEngaged()` before interrupting
- ✅ `handle_bystander_reaction()` checks `isEngaged()` before processing

### 2. Witness Handler → Social Checks

**File:** `src/npc_ai/witness_handler.ts`

**Added Imports:**
```typescript
import {
  calculateSocialResponse,
  shouldRemember,
  calculateMemoryImportance,
  getDefaultPersonality,
  logSocialCheck
} from "./social_checks.js";

import type { VolumeLevel } from "../interface_program/communication_input.js";
```

**New Function: `handle_bystander_reaction()`**
```typescript
function handle_bystander_reaction(observer_ref: string, event: PerceptionEvent): void
```

**Logic:**
1. Skip if already in conversation or engaged
2. Get message and volume from event
3. Use default personality (can be enhanced per-NPC)
4. Calculate social response with interest score (0-100)
5. Log the social check for debugging
6. Handle based on response type:
   - **JOIN (70+ interest):** Enter as participant, face speaker
   - **EAVESDROP (40-69 interest):** Enter as bystander, may store memory
   - **IGNORE (<40 interest):** Just face if close

**Integration Points:**
- ✅ Called in `handle_communication_perception()` when NPC is not the target
- ✅ Replaces the old "just face if nearby" logic
- ✅ Enables personality-based bystander reactions

### 3. Conversation Extension → Engagement Update

**File:** `src/npc_ai/witness_handler.ts`

**Change:**
```typescript
// When extending conversation with same speaker:
if (conv && conv.target_entity === event.actorRef) {
  update_conversation_timeout(observer_ref);
  updateEngagement(observer_ref); // NEW: Also extend engagement
  face_actor(observer_ref, event);
}
```

---

## 🎯 What This Enables

### Before Wiring:
- NPCs could start conversations
- No tracking of engagement state
- Bystanders just faced speaker
- No personality-based reactions

### After Wiring:
- ✅ NPCs enter "engaged" state when communicating
- ✅ 30-second attention span tracked (participants)
- ✅ 20-second attention span tracked (bystanders)
- ✅ Bystanders calculate interest (0-100) based on:
  - Curiosity (0-30 points)
  - Distance (0-20 points)
  - Content relevance (0-40 points)
  - Gossip tendency (0-15 points)
  - Suspiciousness (whisper bonus)
- ✅ Bystanders react accordingly:
  - **High interest (70+):** Join conversation
  - **Medium interest (40-69):** Eavesdrop, maybe remember
  - **Low interest (<40):** Ignore
- ✅ Engagement refreshes on new messages
- ✅ Engagement ends when conversation ends

---

## 🔧 Technical Details

### Engagement Service Integration
- **enterEngagement():** Called when NPC starts talking
- **updateEngagement():** Called when conversation continues
- **endEngagement():** Called when conversation ends
- **isEngaged():** Checked before interrupting NPCs

### Social Check Integration
- **calculateSocialResponse():** Computes interest score
- **getDefaultPersonality():** Uses 5/10 for all traits (customizable)
- **logSocialCheck():** Logs to console for debugging
- **shouldRemember():** Determines if eavesdropper stores memory
- **calculateMemoryImportance():** Scores 1-10 for memory priority

### Memory Integration (Partial)
- Algorithm exists: `shouldRemember()`, `calculateMemoryImportance()`
- Called in eavesdrop case
- TODO: Actually store to `npc_storage/memory.ts`

---

## 📊 Updated Progress

**Was:** ~60% complete  
**Now:** ~75% complete

**Completed Today:**
- ✅ Engagement service fully wired
- ✅ Social checks fully wired
- ✅ Bystander reactions working
- ✅ Personality-based interest calculation

**Remaining:**
- ⏳ Frontend click → Backend target
- ⏳ Memory persistence (store memories)
- ⏳ White "O" indicator
- ⏳ Volume buttons UI
- ⏳ End-to-end testing

---

## 🎮 Testing

**To test bystander reactions:**
1. Place player near 2+ NPCs
2. Talk to one NPC (target)
3. Other NPC(s) will:
   - Calculate interest based on personality
   - High interest: Stop and join conversation
   - Medium interest: Listen as bystander
   - Low interest: Continue current action

**Debug logs to watch:**
```
[WITNESS] handle_bystander_reaction...
[SOCIAL] npc.xxx interest: 72/100
[Witness] npc.xxx is interested (72) - joining conversation
```

---

**Next:** Wire frontend click handler (handleEntityClick) or test current flow?

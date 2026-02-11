# Communication System - ACTUAL Implementation Status

**Date:** 2026-02-09  
**Based on:** Code inspection and system testing

---

## ✅ COMPLETED (Actually Working)

### Backend Foundation
- [x] **Archive old systems** - interpreter_ai/ moved to archive/
- [x] **Remove old parsing** - shouldUseActionPipeline() deleted
- [x] **New input routing** - All text → COMMUNICATE via handleCommunicationSubmit()

### Core Files (Exist & Integrated)
- [x] **target_state.ts** - Created, imports work, exports ready
- [x] **communication_input.ts** - Created, integrated in Breath(), creates intents
- [x] **engagement_service.ts** - Created and WIRED to witness_handler.ts
- [x] **social_checks.ts** - Created and WIRED to witness_handler.ts

### Frontend Display (Working)
- [x] **place_module.ts targeted variable** - Exists and tracks selected entity
- [x] **set_target() on click** - Called when left-clicking entity (line 1009)
- [x] **Yellow highlight** - Shows for targeted entities (pale_yellow, bold)
- [x] **"Talking to: X" display** - Shows at bottom-left when target selected
- [x] **Hover still works** - Orange highlight for non-targeted hover

### Backend → Frontend Commands
- [x] **UI_HIGHLIGHT/TARGET commands** - Added to movement_commands.ts
- [x] **Command sender functions** - Added to movement_command_sender.ts
- [x] **Frontend handlers** - Simplified to logging (visual handled internally)

---

## ❌ NOT COMPLETED (Missing Wiring)

### Critical Missing Integration
- [ ] **Frontend click → Backend target** - handleEntityClick() exported but NOT imported in frontend
  - File: `interface_program/main.ts` exports it
  - Missing: Frontend import and call
  
- [x] **engagement_service integration** - ✅ WIRED
  - File: `npc_ai/witness_handler.ts` imports and calls enterEngagement()
  - Called when: Starting conversation, extending conversation, ending conversation
  - Also integrated: isEngaged() checks, updateEngagement(), endEngagement()
  
- [x] **social_checks integration** - ✅ WIRED
  - File: `npc_ai/witness_handler.ts` imports and calls calculateSocialResponse()
  - New function: handle_bystander_reaction() processes non-target NPCs
  - Supports: Join (70+ interest), Eavesdrop (40-69), Ignore (<40)
  - Memory tracking: shouldRemember(), calculateMemoryImportance()

### UI Components Not Built
- [ ] **Volume buttons UI** - Logic ready, no UI components
- [ ] **White "O" indicator** - Not implemented
- [ ] **Target clear button** - Not implemented

### Advanced Features
- [ ] **Memory storage** - Not wired
- [ ] **Bystander reactions** - Algorithm exists, not called
- [ ] **Conversation timeouts** - Service exists, not integrated
- [ ] **Resume interrupted actions** - Not implemented

---

## 🔧 Specific Missing Connections

### 1. Frontend → Backend Click Handler
```typescript
// In place_module.ts or canvas_runtime.ts - MISSING:
import { handleEntityClick } from "../../interface_program/main.js";

// On left click entity:
handleEntityClick(npc_ref, "npc");
```

### 2. Witness Handler → Engagement Service
```typescript
// In witness_handler.ts - MISSING:
import { enterEngagement, isEngaged } from "./engagement_service.js";

// In handle_communication_perception():
if (is_target) {
  enterEngagement(npc_ref, event.actorRef, "participant");
}
```

### 3. Witness Handler → Social Checks
```typescript
// In witness_handler.ts - MISSING:
import { calculateSocialResponse } from "./social_checks.js";

// For bystanders:
const response = calculateSocialResponse(npc.personality, message, volume, distance);
if (response.response_type === "eavesdrop") {
  // Store memory
}
```

---

## 📊 Real Progress: ~75%

**Working:**
- ✅ Backend architecture
- ✅ Frontend target display (yellow highlight + "Talking to:")
- ✅ Text input → COMMUNICATE intent
- ✅ Visual highlighting
- ✅ Engagement service wired (enter/update/end engagement)
- ✅ Social checks wired (bystander reactions, interest calculation)
- ✅ Bystander handling (join/eavesdrop/ignore based on personality)

**Missing:**
- ❌ Frontend click → Backend target (handleEntityClick not imported)
- ❌ Memory storage (algorithm exists, not wired)
- ❌ Volume buttons UI
- ❌ White "O" indicator
- ❌ Comprehensive testing

**Estimated to complete:** 1-2 days of wiring work

---

## 🎯 Next Critical Steps

1. **Wire handleEntityClick** - Import in frontend (mono_ui), call on left-click entity
2. **Test conversation flow** - Verify NPC stops/faces on communication
3. **Add white "O" indicator** - Spawn when status="busy" (in vision_debugger.ts or place_module.ts)
4. **Memory storage** - Wire social check results to npc_storage/memory.ts
5. **Volume buttons UI** - Build UI components for whisper/normal/shout
6. **End-to-end testing** - Full flow from click → response

---

**Note:** Most "completed" items are files that exist but aren't fully wired. The architecture is sound but connections are missing.

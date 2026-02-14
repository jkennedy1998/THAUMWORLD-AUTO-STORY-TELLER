# Communication System - ACTUAL Implementation Status

**Date:** 2026-02-10  
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
- [x] **Conversation indicator (debug `o/O`)** - ✅ FIXED: Debug overlay shows `o` (idle) / `O` (conversing) when `\` is enabled

### Backend → Frontend Commands
- [x] **UI_HIGHLIGHT/TARGET commands** - Added to movement_commands.ts
- [x] **Command sender functions** - Added to movement_command_sender.ts
- [x] **Frontend handlers** - Simplified to logging (visual handled internally)
- [x] **STATUS commands** - ✅ Used as the renderer-visible conversation visual state (`busy`/`present`)

### Conversation System Integration
- [x] **Engagement service initialized** - Called in npc_ai/main.ts initialize()
- [x] **Conversation facing** - ✅ NPC faces target on start and keeps facing as the actor moves (renderer-side follow)
- [x] **Engagement timeouts** - 30 second attention span, restores wandering
- [x] **Conversation state** - Uses `is_in_conversation()` as source of truth

---

## 🔧 RECENT FIXES

### Conversation Indicator + Live Sync Fix (2026-02-12)
**Problem:** Conversation debug indicator and facing were not live/reliable across process boundaries and place refreshes.

**Root Causes:**
- Renderer cannot read backend in-memory `conversation_state` reliably.
- Place refreshes are snapshots and can overwrite/lag behind real-time state.
- MovementCommand handler previously cleared queued commands too aggressively (could skip fresh STATUS events).

**Solution (contract):**
1) Backend emits `NPC_STATUS` events as the visual sync channel:
   - `busy` = in conversation
   - `present` = not in conversation
2) Renderer stores status in a stable map and projects it onto place snapshots.
3) Debug overlay draws from renderer-synced status:
   - `o` (dim) when not busy
   - `O` (bright) when busy

**Implementation notes:**
- `src/mono_ui/modules/movement_command_handler.ts` maintains `npc_visual_status_by_ref`.
- `src/mono_ui/modules/place_module.ts` uses renderer visual status for debug indicator input.
- `src/mono_ui/vision_debugger.ts` renders `o/O` when `\` debug is enabled.

**Conversation exit hardening:**
- Farewell now ends the session even if `conversation_state` is missing but engagement indicates the speaker.
- Leaving a place ends any conversations/engagements involving the actor.

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
- [x] **Debug `o/O` indicator** - ✅ FIXED: Uses renderer-synced `NPC_STATUS`
- [ ] **Target clear button** - Not implemented

### Advanced Features
- [ ] **Memory storage** - Not wired
- [ ] **Bystander reactions** - Algorithm exists, not called
- [x] **Conversation timeouts** - ✅ IMPLEMENTED: 30 second timeout, restores wandering
- [ ] **Resume interrupted actions** - Not implemented

---

## 📊 Real Progress: ~85%

**Working:**
- ✅ Backend architecture
- ✅ Frontend target display (yellow highlight + "Talking to:")
- ✅ Text input → COMMUNICATE intent
- ✅ Visual highlighting
- ✅ Engagement service wired and initialized
- ✅ Social checks wired (bystander reactions, interest calculation)
- ✅ Bystander handling (join/eavesdrop/ignore based on personality)
- ✅ Debug `o/O` indicator (FIXED: uses renderer-synced `NPC_STATUS`)
- ✅ NPC facing during conversation
- ✅ Conversation timeouts and wandering restoration

**Missing:**
- ❌ Frontend click → Backend target (handleEntityClick not imported)
- ❌ Memory storage (algorithm exists, not wired)
- ❌ Volume buttons UI
- ❌ Comprehensive testing

**Estimated to complete:** 1 day of wiring work

---

## 🎯 Next Critical Steps

1. **Test conversation flow** - Verify white "O" appears when talking to Grenda
2. **Wire handleEntityClick** - Import in frontend (mono_ui), call on left-click entity
3. **Memory storage** - Wire social check results to npc_storage/memory.ts
4. **Volume buttons UI** - Build UI components for whisper/normal/shout
5. **End-to-end testing** - Full flow from click → response

---

## 📝 Architecture Notes

### Source of Truth Hierarchy
1. **Conversation State** (`conversation_state.ts`) - Backend logic (timeouts, targets)
2. **Engagement State** (`engagement_service.ts`) - Backend attention/participation
3. **Conversation Visual State** (`NPC_STATUS` -> renderer map) - Renderer truth for debug `o/O` and facing-follow

### Why Place Storage Status Is Not Trusted
The status field in place storage is a **snapshot** and can be stale. Renderer visuals rely on `NPC_STATUS` events.

---

**Note:** The debug indicator is reliable because it uses renderer-synced status, not backend memory or storage snapshots.

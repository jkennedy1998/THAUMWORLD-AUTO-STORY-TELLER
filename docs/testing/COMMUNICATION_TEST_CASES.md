# Communication System - Test Cases

**Date:** 2026-02-09  
**Status:** Ready for Testing  
**Test Environment:** Local development build

---

## 🎯 Test Overview

These test cases verify the complete communication flow from frontend click to NPC response.

---

## ✅ Test Case 1: Basic Target Selection

### Objective
Verify that clicking an NPC sets it as the target and displays "Talking to: X"

### Prerequisites
- Game running with at least one NPC in current place
- NPC within visible range

### Steps
1. Start game and load a place with NPCs
2. Left-click on an NPC (e.g., Grenda)
3. Observe visual feedback
4. Check bottom-left text display

### Expected Results
- ✅ NPC gets yellow highlight (pale_yellow, bold weight)
- ✅ Bottom-left shows "Talking to: grenda"
- ✅ Console log: `[PlaceModule] Target selected: npc.grenda`
- ✅ Console log: `[AppState] Wired target to backend: npc.grenda`
- ✅ Backend receives target via handleEntityClick()

### Debug Commands
```bash
# Check logs
grep "Target selected" local_data/data_slot_1/logs/latest.log
grep "Wired target" local_data/data_slot_1/logs/latest.log
```

---

## ✅ Test Case 2: Communication Intent Creation

### Objective
Verify that typing a message creates a COMMUNICATE intent with correct parameters

### Prerequisites
- Target selected (Test Case 1 passed)
- Input module visible and focused

### Steps
1. Select target NPC (Test Case 1)
2. Type "hello" in input field
3. Press Enter (or click Send)
4. Observe console logs

### Expected Results
- ✅ Console: `[INPUT] Creating COMMUNICATE intent`
- ✅ Intent includes:
  - `verb: "COMMUNICATE"`
  - `targetRef: "npc.grenda"` (or selected NPC)
  - `message: "hello"`
  - `volume: "NORMAL"` (default)
- ✅ Backend processes through ActionPipeline
- ✅ Console: `[Breath] Created COMMUNICATE intent: {target, volume, message}`

### Debug Commands
```bash
# Check ActionPipeline processing
grep "COMMUNICATE intent" local_data/data_slot_1/logs/latest.log
grep "ActionPipeline completed" local_data/data_slot_1/logs/latest.log
```

---

## ✅ Test Case 3: NPC Reaction - Targeted Response

### Objective
Verify that targeted NPC stops, faces player, and enters conversation state

### Prerequisites
- Target selected (Test Case 1)
- Message sent (Test Case 2)
- NPC was previously moving or idle

### Steps
1. Select NPC as target
2. Send "hello" message
3. Observe NPC behavior
4. Check NPC status

### Expected Results
- ✅ NPC stops current movement
- ✅ Console: `[MovementCommandHandler] npc.grenda stopped`
- ✅ NPC faces player
- ✅ Console: `[MovementCommandHandler] Executing NPC_FACE for npc.grenda`
- ✅ NPC status changes to "busy"
- ✅ Console: `[MovementCommandHandler] npc.grenda status updated to busy`
- ✅ White "O" indicator appears below NPC (if debug mode enabled)

### Debug Commands
```bash
# Check witness handling
grep "WITNESS.*process_witness_event" local_data/data_slot_1/logs/latest.log
grep "Starting conversation" local_data/data_slot_1/logs/latest.log
```

---

## ✅ Test Case 4: Bystander Reaction - Interest Calculation

### Objective
Verify that nearby NPCs (not targeted) calculate interest and react accordingly

### Prerequisites
- 2+ NPCs in same place
- Player targets only one NPC
- Other NPCs within communication range (10 tiles for NORMAL)

### Steps
1. Ensure 2+ NPCs are present (e.g., Grenda and Blacksmith)
2. Target only Grenda
3. Send "secret plans" message
4. Observe both NPCs

### Expected Results
- ✅ Targeted NPC (Grenda): Enters conversation, stops, faces player
- ✅ Bystander NPC (Blacksmith): Calculates interest
- ✅ Console: `[SOCIAL] npc.blacksmith interest: XX/100`
- ✅ Based on interest:
  - **70+ (High):** Joins conversation - `[Witness] npc.blacksmith is interested (XX) - joining conversation`
  - **40-69 (Medium):** Eavesdrops - `[Witness] npc.blacksmith is curious (XX) - eavesdropping`
  - **<40 (Low):** Ignores - `[Witness] npc.blacksmith not interested (XX) - ignoring`

### Debug Commands
```bash
# Check social calculations
grep "SOCIAL.*interest" local_data/data_slot_1/logs/latest.log
grep "bystander" local_data/data_slot_1/logs/latest.log -i
```

---

## ✅ Test Case 5: Volume-Based Range

### Objective
Verify that WHISPER, NORMAL, and SHOUT have different ranges

### Prerequisites
- NPC at various distances
- Ability to select volume (UI or default)

### Steps

#### Sub-test 5a: Whisper (1 tile range)
1. Stand 1 tile away from NPC
2. Set volume to WHISPER
3. Send message
4. **Expected:** NPC hears and responds
5. Move to 2 tiles away
6. Send message
7. **Expected:** NPC does NOT hear (out of range)

#### Sub-test 5b: Normal (10 tile range)
1. Stand 5 tiles away from NPC
2. Set volume to NORMAL
3. Send message
4. **Expected:** NPC hears and responds
5. Move to 15 tiles away
6. Send message
7. **Expected:** NPC does NOT hear (out of range)

#### Sub-test 5c: Shout (30 tile range)
1. Stand 20 tiles away from NPC
2. Set volume to SHOUT
3. Send message
4. **Expected:** NPC hears and responds
5. Move to 35 tiles away
6. Send message
7. **Expected:** NPC does NOT hear (out of range)

### Debug Commands
```bash
# Check perception
grep "can_npc_perceive" local_data/data_slot_1/logs/latest.log
grep "distance" local_data/data_slot_1/logs/latest.log | grep -i "witness\|perception"
```

---

## ✅ Test Case 6: Conversation Timeout

### Objective
Verify that NPC leaves conversation after timeout (30 seconds)

### Prerequisites
- NPC in conversation with player
- Player does NOT send any messages

### Steps
1. Start conversation with NPC (send "hello")
2. Wait without sending any messages
3. Observe NPC behavior at 20 seconds (warning)
4. Observe NPC behavior at 30 seconds (timeout)

### Expected Results
- ✅ At 20s: Console `[ENGAGEMENT] npc.grenda is getting distracted...`
- ✅ At 30s: Console `[ENGAGEMENT] npc.grenda leaving engagement (timeout)`
- ✅ NPC status changes back to "present"
- ✅ NPC resumes previous action (wandering, etc.)
- ✅ Console: `[MovementCommandHandler] npc.grenda status updated to present`
- ✅ White "O" disappears (if visible)

### Debug Commands
```bash
# Check engagement timeouts
grep "ENGAGEMENT.*timeout\|ENGAGEMENT.*leaving\|ENGAGEMENT.*distracted" local_data/data_slot_1/logs/latest.log
```

---

## ✅ Test Case 7: Farewell Detection

### Objective
Verify that saying "bye" ends conversation immediately

### Prerequisites
- NPC in active conversation

### Steps
1. Start conversation (send "hello")
2. Wait 5 seconds (confirm conversation active)
3. Send "bye" or "goodbye"
4. Observe NPC behavior

### Expected Results
- ✅ Console: `[Witness] Farewell detected from actor.henry_actor`
- ✅ Console: `[Witness] Ending conversation for npc.grenda`
- ✅ NPC status changes to "present" immediately
- ✅ NPC resumes previous action
- ✅ Engagement ends: `[ENGAGEMENT] npc.grenda leaving engagement (conversation ended)`

---

## ✅ Test Case 8: Memory Storage (Bystander)

### Objective
Verify that eavesdropping NPCs store memories (when implemented)

### Prerequisites
- 2+ NPCs in range
- Bystander NPC has medium interest (40-69)

### Steps
1. Target NPC A
2. Ensure NPC B is nearby (within range)
3. Send message with keyword (e.g., "secret" or "gold")
4. Check if NPC B stores memory

### Expected Results (When Memory System Wired)
- ✅ Console: `[Witness] npc.b will remember this conversation (importance: X)`
- ✅ Memory stored in npc_storage/memory.ts
- ✅ NPC can recall in future conversations

### Current Status
⚠️ Algorithm exists but NOT wired to storage yet
- `shouldRemember()` returns true for interest >= 50
- `calculateMemoryImportance()` scores 1-10
- TODO: Actually call memory storage functions

---

## 🔧 Debugging Quick Reference

### Filter Logs by System
```bash
# Witness system
grep "\[WITNESS\]" local_data/data_slot_1/logs/latest.log

# Engagement system
grep "\[ENGAGEMENT\]" local_data/data_slot_1/logs/latest.log

# Social checks
grep "\[SOCIAL\]" local_data/data_slot_1/logs/latest.log

# Target selection
grep "\[TARGET\]" local_data/data_slot_1/logs/latest.log

# Movement commands
grep "\[MovementCommand\]" local_data/data_slot_1/logs/latest.log

# Communication input
grep "\[INPUT\]" local_data/data_slot_1/logs/latest.log
```

### Monitor Real-Time Logs
```bash
# Terminal 1: Start game
npm run dev:logs

# Terminal 2: Watch logs
tail -f local_data/data_slot_1/logs/latest.log | grep -E "WITNESS|ENGAGEMENT|SOCIAL|TARGET"
```

---

## 📊 Test Matrix

| Test | Component | Status | Priority |
|------|-----------|--------|----------|
| 1 | Target Selection | ⏳ Ready | High |
| 2 | Intent Creation | ⏳ Ready | High |
| 3 | NPC Reaction | ⏳ Ready | High |
| 4 | Bystander Interest | ⏳ Ready | Medium |
| 5 | Volume Range | ⏳ Ready | Medium |
| 6 | Timeout | ⏳ Ready | Medium |
| 7 | Farewell | ⏳ Ready | Low |
| 8 | Memory Storage | ⚠️ Partial | Low |

---

## 🐛 Known Issues

1. **White "O" Indicator:** Only shows in DEBUG_VISION mode (press backslash)
   - Need to make it always visible when status="busy"
   
2. **Volume Buttons:** Logic ready, UI not built yet
   - Currently defaults to NORMAL volume
   
3. **Memory Storage:** Algorithm wired, storage not implemented
   - shouldRemember() and calculateMemoryImportance() called
   - But not actually saving to npc_storage/memory.ts

---

## ✅ Success Criteria

**Minimum Viable Product:**
- ✅ Test 1 + 2 + 3 pass (target → send → NPC responds)
- ✅ NPC stops moving when communicated to
- ✅ NPC faces player
- ✅ Timeout works (30 seconds)

**Full Feature Set:**
- ✅ All tests 1-7 pass
- ✅ Bystanders react based on personality
- ✅ Volume affects range
- ✅ Memory storage works (Test 8)

---

**Ready to run tests?** Start with Test Case 1 (Target Selection).

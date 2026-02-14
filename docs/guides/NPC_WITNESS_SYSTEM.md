# NPC Witness Reaction System - Quick Reference

**Last Updated:** February 13, 2026  
**Status:** ✅ Core Working - Multi-NPC tested; perf/stealth realism deferred

---

## 🎯 What This System Does

When you talk to an NPC (like Grenda), the system should:
1. **Detect** that you spoke (via perception system)
2. **Enter conversation mode** - NPC stops wandering and faces you
3. **Track conversation state** - 30-second timeout, message counting
4. **Exit gracefully** - Resume wandering when you say "bye" or timeout

---

## ✅ What's Working

### 1. **Communication & Response** ✅
- Player says "hello grenda" → Grenda responds with AI-generated text
- Response system working perfectly
- Place-based filtering works (only NPCs in same place can hear you)
- Range gating works (no out-of-hearing responses)

### 2. **Facing System** ✅
- NPCs face direction of movement automatically
- Logs show: `Facing npc.grenda now facing north/east/south/west`
- Working since Day 1

### 3. **Movement System** ✅
- NPCs wander between tiles properly
- Movement goals work correctly
- Integration with facing system verified

### 4. **Sense Broadcasting** ✅
- COMMUNICATE action broadcasts via `senses=[light, pressure]` (WHISPER is pressure-only)
- Different actions have appropriate sense profiles
- Broadcasting infrastructure in place
- Movement emits pressure broadcasts (footsteps) and generates MOVE perception events
- NPC replies also emit COMMUNICATE broadcast particles (same as player)

---

## ✅ What's Working (Recent Fixes)

### 1. **Conversation System Working** ✅ (Fixed Feb 8, 2026)
**Evidence from logs:**
```
[Witness] Processing communication for npc.grenda from actor.henry_actor
[Witness] npc.grenda entered conversation with actor.henry_actor, goal set to: converse
NPC_Movement Set goal for npc.grenda { type: 'converse', priority: 7 }
```
- ✅ Grenda enters "converse" goal when addressed
- ✅ Previous goal saved for restoration
- ✅ Conversation state tracked properly

### 2. **Conversation Timeout Fixed** ✅ (Fixed Feb 8, 2026)
**Issue:** Timeout was showing `1970-01-01T08:00:30.000Z`  
**Root Cause:** Using game time (total_minutes) converted to milliseconds, treated as Unix epoch  
**Fix:** Changed to use `Date.now()` (real-world time) for conversation timeouts  
**File:** `src/npc_ai/conversation_state.ts` - `get_conversation_time_ms()` function

## ⚠️ Known Issues / Watch List

- If an NPC is stuck `busy` on load, check for stale persisted `place.contents.npcs_present[].status` in `local_data/` (should be auto-healed to `present`, but old slots may still carry it).
- Some debug visualization is renderer-side (particles), but key events are bridged into witness via `perception_event_batch` for movement.
- Renderer bug: entity glyphs may not step tile-to-tile during movement (render order); tracked in `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`.

---

## 🔍 Debug Tools Available

### 1. **Log Capture System** (NEW)
```bash
# Run game with automatic logging
npm run dev:logs

# View logs
npm run logs:view
npm run logs:view -- --latest
```

### 2. **Debug Functions** (in-game console)
```typescript
// In browser console or terminal:
print_witness_system_status()  // Shows conversations, facing, goals
check_success_criteria()       // Checks all success criteria
```

### 3. **Log Prefixes to Watch For**
| Prefix | Meaning | Status |
|--------|---------|--------|
| `[Perception]` | Perception broadcasting | ✅ Working |
| `[Witness]` | Witness handler processing | ✅ Working |
| `[Conversation]` | Conversation state changes | ✅ Working |
| `Facing npc.X` | Facing system | ✅ Working |
| `NPC_Movement` | Movement system | ✅ Working |
| `UI_SENSE_BROADCAST` | Speech broadcast particles | ✅ Working |
| `perception_event_batch` | Renderer -> witness bridge | ✅ Working |

---

## 🧪 How to Test

### Test 1: Basic Communication
```bash
# 1. Start game with logs
npm run dev:logs

# 2. In game, say:
hello grenda

# 3. Check logs for:
[Witness] Processing communication for npc.grenda  # Should appear
[Witness] npc.grenda entered conversation         # Should appear

# 4. Current result:
✅ Grenda responds verbally
✅ Grenda stops wandering / faces player (conversation mode)
```

### Test 2: Check Log Files
```bash
# View latest session logs (cross-platform)
npm run logs:view -- --latest

# Optional: view all logs (cleaned)
npm run logs:clean
```

---

## 📁 Key Files

### Implementation Files
- `src/npc_ai/witness_handler.ts` - Processes perception events
- `src/npc_ai/conversation_state.ts` - Tracks conversation state
- `src/npc_ai/witness_integration.ts` - Integration layer
- `src/action_system/perception.ts` - Broadcasts perception events ✅
- `src/action_system/sense_broadcast.ts` - Action -> sense profiles + ranges
- `src/action_system/pipeline.ts` - Populates `observedBy` for COMMUNICATE gating
- `src/shared/movement_engine.ts` - Emits MOVE perception batches (actors + NPCs)

### Debug Files
- `src/npc_ai/witness_debug.ts` - Debug functions
- `scripts/view_logs.js` - Log viewer utility
- `scripts/dev_with_logs.js` - Dev mode with logging

### Documentation
- `docs/archive/2026_02_07_npc_witness_reaction_system_IMPLEMENTED.md` - Full plan (implemented)
- `docs/archive/2026_02_08_cmd_log_capture_and_launcher.md` - Log system
- `LAUNCHER_GUIDE.md` - How to run with logs

---

## 🎯 Success Criteria Status

| Criteria | Status | Notes |
|----------|--------|-------|
| NPCs enter "converse" goal | ✅ | Perception -> witness -> engagement/goal integration |
| Movement faces speaker | ✅ | Facing working |
| Previous goal restored | ✅ | On farewell/timeout |
| 30-second timeout | ✅ | Conversation expires |
| Farewell detection | ✅ | Pattern ready |
| Vision cones | ✅ | Implemented + debug overlay |
| Hearing 360° | ✅ | Pressure sense + debug overlay |
| Debug particles | ✅ | `\\` toggle; `H` hearing; `B` broadcasts |
| LOS occlusion overlay | ✅ | `V` shows occlusion shadow inside cone |
| Move mode | ✅ | `M` cycles WALK/SNEAK/SPRINT (affects footstep broadcast) |
| 50+ NPCs performance | ⏳ | Not tested |

---

## 🚀 System Status

### ✅ Core System Operational (Feb 8, 2026)

The NPC Witness Reaction System is **fully functional**. Recent testing shows:

**Working Features:**
- ✅ NPCs enter "converse" goal when addressed
- ✅ Previous goals saved and restored
- ✅ 30-second conversation timeout (real-world time)
- ✅ Farewell detection ("bye", "goodbye", "farewell")
- ✅ Facing system tracks NPC direction
- ✅ Movement pauses during conversation
- ✅ Place-based filtering (only same-place NPCs respond)

**Fixed Issues:**
- ✅ **Timeout timestamp bug** - Was showing 1970, now shows correct timestamps
- ✅ **Conversation not triggering** - Now properly enters conversation mode

### 📊 Monitoring

To verify the system is working:

```bash
# Run with logs
npm run dev:logs

# In another terminal, watch for conversation events:
npm run logs:view
```

**Expected log patterns:**
```
[Witness] Processing communication for npc.grenda
[Witness] npc.grenda entered conversation with actor.henry_actor
[Conversation] Started conversation for npc.grenda
NPC_Movement Set goal for npc.grenda { type: 'converse' }
```

### Priority 3: Test Conversation State
Once perception works:
1. Verify `[Witness] npc.grenda entered conversation` appears
2. Check Grenda stops wandering
3. Test 30-second timeout
4. Test "bye" farewell detection

---

## 📝 Recent Changes (Feb 8, 2026)

1. **Log Capture System** - Now all console output saved to files
2. **Debug Logging** - Added to perception and witness systems
3. **ES Module Fixes** - All scripts work with ES modules
4. **NPC Wandering Fix** - Conversation mode now prevents wandering

---

## 💡 For AI Agents

When debugging this system:

1. **Check logs first:**
   ```bash
   npm run logs:view
   ```

2. **Look for these patterns:**
   - `[Witness]` - Should appear when NPCs detect communication
   - `[Conversation]` - Should appear when conversation starts
   - `skipping wander - in conversation` - Should appear during conversation

3. **If missing:**
   - Perception events not created → Check `perception.ts`
   - Witness handler not called → Check integration points
   - Conversation not starting → Check `conversation_state.ts`

4. **Working indicators:**
   - Grenda responds verbally ✅
   - Facing updates ✅
   - Movement works ✅
   - Logs saved ✅

---

## 🔗 Related Systems

- **Action Pipeline** - Routes communication to NPCs
- **Movement Engine** - Handles NPC wandering/goals
- **Facing System** - Tracks direction NPCs face
- **Conversation Manager** - Tracks conversation history (separate system)
- **Log Capture** - New system to save all output

---

**For full implementation details, see:**
`docs/archive/2026_02_07_npc_witness_reaction_system_IMPLEMENTED.md`

**To run with logging:**
```bash
npm run dev:logs
```

**To view logs:**
```bash
npm run logs:view
```

# NPC Witness & Reaction System - Testing Guide

**Date:** 2026-02-08  
**Status:** Ready for Integration Testing

## Quick Test Checklist

### ✅ Pre-Test Setup
- [ ] Start game with `npm run dev:logs`
- [ ] Wait for full initialization (all services booted)
- [ ] Verify Grenda is wandering in her shop
- [ ] Check logs show "[MovementCommandHandler] Started"

### Test 1: Basic NPC Reaction (CRITICAL)
**Objective:** Verify NPCs stop and face player when spoken to

**Setup:**
- Player is in Eden Crossroads
- Grenda is wandering in her shop

**Steps:**
1. Walk up to Grenda (within 2-3 tiles)
2. Say "Hello Grenda" in the game input

**Expected Results:**
```
[MovementCommandHandler] Executing NPC_STOP for npc.grenda
[MovementCommandHandler] npc.grenda facing actor.henry_actor
[Conversation] Started conversation for npc.grenda
```

**Verify in Game:**
- [ ] Grenda stops moving immediately
- [ ] Grenda turns to face the player
- [ ] Conversation interface opens

---

### Test 2: Conversation Timeout (CRITICAL)
**Objective:** NPCs resume wandering after conversation ends

**Setup:**
- Player is in conversation with Grenda

**Steps:**
1. Start conversation with Grenda (Test 1)
2. Wait 30 seconds without typing anything
3. Watch Grenda's movement

**Expected Results:**
```
[Conversation] Conversation timeout for npc.grenda
[MovementCommandHandler] Executing NPC_WANDER for npc.grenda
```

**Verify in Game:**
- [ ] After ~30 seconds, Grenda starts wandering again
- [ ] Conversation interface closes

---

### Test 3: Farewell Ending (CRITICAL)
**Objective:** Saying "bye" ends conversation immediately

**Setup:**
- Player is in conversation with Grenda

**Steps:**
1. Start conversation with Grenda
2. Say "Goodbye" or "bye"

**Expected Results:**
```
[Witness] Detected farewell, ending conversation for npc.grenda
[Conversation] Ended conversation for npc.grenda
[MovementCommandHandler] Executing NPC_WANDER for npc.grenda
```

**Verify in Game:**
- [ ] Grenda immediately resumes wandering
- [ ] No 30-second wait

---

### Test 4: Vision Cone - NPC Can See Player (HIGH)
**Objective:** NPCs only react when they can see the player

**Setup:**
- Enable debug visualization (press \ key in game)
- Find Gunther (guard NPC)

**Steps:**
1. Stand in front of Gunther (in his vision cone)
2. Say "Hello guard"

**Expected Results:**
```
[Witness] Processing event for npc.gunther: COMMUNICATE
[ConeOfVision] npc.gunther can see actor.henry_actor: true
[MovementCommandHandler] Executing NPC_STOP for npc.gunther
```

**Visual Debug:**
- [ ] Yellow ▲ triangles show vision cone covering player position

---

### Test 5: Vision Cone - Blind Spot (HIGH)
**Objective:** NPCs don't react when player is behind them

**Setup:**
- Gunther is facing north
- Debug visualization enabled (press \\ key)

**Steps:**
1. Walk behind Gunther (south of him)
2. Say "Hello" quietly

**Expected Results:**
```
[Witness] Processing event for npc.gunther: COMMUNICATE
[ConeOfVision] npc.gunther can see actor.henry_actor: false
[Witness] Cannot perceive - outside vision cone
```

**Visual Debug:**
- [ ] Yellow ▲ triangles show vision cone pointing north
- [ ] Player is outside the yellow triangle area

---

### Test 6: Multiple Witnesses (MEDIUM)
**Objective:** Multiple NPCs can react to the same communication

**Setup:**
- Multiple NPCs are in the same place (Eden Crossroads)
- Player is within range of multiple NPCs

**Steps:**
1. Position yourself so you're visible to Grenda, Gunther, and Sister Bramble
2. Shout "Hello everyone!" (use COMMUNICATE.SHOUT)

**Expected Results:**
```
[Witness] Processing event for npc.grenda: COMMUNICATE
[MovementCommandHandler] Executing NPC_STOP for npc.grenda
[Witness] Processing event for npc.gunther: COMMUNICATE
[MovementCommandHandler] Executing NPC_STOP for npc.gunther
[Witness] Processing event for npc.sister_bramble: COMMUNICATE
[MovementCommandHandler] Executing NPC_STOP for npc.sister_bramble
```

**Verify in Game:**
- [ ] All visible NPCs stop moving
- [ ] All turn to face the player

---

### Test 7: Combat Disables Reactions (MEDIUM)
**Objective:** Witness system disabled during combat

**Setup:**
- Combat is active (timed event)

**Steps:**
1. Start combat (if combat system available)
2. Try to talk to an NPC

**Expected Results:**
```
[Witness] Skipping npc.grenda - timed event active
```

---

### Test 8: Facing Updates with Movement (MEDIUM)
**Objective:** NPCs and player update facing direction when moving

**Setup:**
- Debug visualization enabled (press \\ key)

**Steps:**
1. Walk east 5 tiles
2. Watch the player's facing indicator

**Expected Results:**
```
[FacingSystem] actor.henry_actor facing: east
```

**Visual Debug:**
- [ ] White → arrow shows facing east while moving

---

### Test 9: Pressure Sense (Sound) Range (LOW)
**Objective:** Loud actions (shouting) can be heard from further away

**Setup:**
- Player is ~25 tiles away from an NPC
- Debug visualization enabled

**Steps:**
1. Stand 25 tiles away from Grenda
2. Shout "HELLO!"

**Expected Results:**
```
[SenseBroadcast] Shout: pressure intensity 8, range 30
[ConeOfVision] npc.grenda can hear actor.henry_actor: true
```

**Visual Debug:**
- [ ] Cyan ○ rings show pressure/sound detection range

---

## Debug Visualization Guide

Press **\\** (backslash) in-game to toggle debug visualization:

Keybinds:
- `\\` toggle debug
- `H` toggle hearing ring
- `B` toggle sense broadcasts
- `V` toggle LOS occlusion shadow inside the cone (character blockers for now)
- `M` cycle move mode (WALK/SNEAK/SPRINT) for footstep broadcast intensity

| Symbol | Color | Meaning |
|--------|-------|---------|
| ▲ | Yellow | Vision cone (sight/light sense) |
| ▲ | Red | Occluded tiles inside cone (LOS shadow) |
| ○ | Cyan | Hearing range (pressure sense) |
| ✦ | Various | Action broadcast burst |
| → ← ↑ ↓ | White | Facing direction |
| ! | White flash | Perception detected |
| o / O | Gray / White | Conversation debug (`o` idle, `O` conversing) |

## Troubleshooting

### Issue: NPCs not reacting to communication
**Check:**
1. Are you within the NPC's vision cone? (Press \\ to see)
2. Is the NPC already in conversation? Check logs for `[Conversation] Started`
3. Is combat active? Check logs for `timed event active`

### Issue: NPCs not resuming wandering after conversation
**Check:**
1. Conversation timeout is 30 seconds - did you wait long enough?
2. Check logs for `[Conversation] Conversation timeout`
3. Verify movement system is working: `[MovementCommandHandler] Started`

### Issue: Too many log messages
**Normal behavior:**
- Backend generates commands for all NPCs every 8 seconds
- Only NPCs in the current place will actually move
- Frontend filters out irrelevant commands silently

**Abnormal:**
- If you see 50+ commands per second, something is wrong
- Check for `already moving, skipping wander` - should be rare

## Success Criteria

✅ **PASS** if:
- NPCs stop and face player when spoken to
- NPCs resume wandering after 30 seconds
- Vision cones work (can see in front, blind behind)
- Multiple NPCs can react simultaneously
- Debug visualization shows vision/hearing ranges

❌ **FAIL** if:
- NPCs continue wandering when spoken to
- NPCs never resume wandering after conversation
- No vision cone visualization
- NPCs react when behind the player (blind spot not working)

## Next Steps After Testing

If all tests pass:
1. ✅ System is production-ready
2. Consider adding more NPC personality types
3. Add reaction variety based on NPC traits

If tests fail:
1. Check witness_handler.ts logs
2. Verify cone_of_vision.ts calculations
3. Check conversation_state.ts timeout handling
4. Review movement_command_sender.ts for stop/face commands

---

**Testing completed by:** _________________  
**Date:** _________________  
**Results:** ⬜ All Pass  ⬜ Some Fail  ⬜ Needs Debug

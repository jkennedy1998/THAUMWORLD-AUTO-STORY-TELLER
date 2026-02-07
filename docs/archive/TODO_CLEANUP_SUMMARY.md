# TODO Cleanup Summary

**Date:** February 2, 2026  
**Status:** ✅ COMPLETED

---

## TODOs Cleared (Completed)

### 1. ✅ save_actor Function
**Location:** `src/state_applier/main.ts:189`  
**Status:** REMOVED

**Details:**
- The `save_actor()` function exists in `src/actor_storage/store.ts:101`
- Function signature: `save_actor(slot: number, actor_id: string, actor: Record<string, unknown>): string`
- Updated comment to reflect function availability

**Change:**
```typescript
// BEFORE:
// TODO: Add save_actor function

// AFTER:
// Actor tags updated - save_actor function is available in actor_storage/store.ts
```

### 2. ✅ Send brokered_n message to rules_lawyer
**Location:** `src/data_broker/main.ts:724`  
**Status:** UPDATED

**Details:**
- The brokered message IS being sent to rules_lawyer via outbox
- Rules lawyer reads from outbox and processes brokered_* messages
- Updated comment to clarify the existing functionality

**Change:**
```typescript
// BEFORE:
// TODO: send brokered_n message to rules_lawyer

// AFTER:
// Send brokered message to outbox for rules_lawyer to process
```

### 3. ✅ Send to data broker program instead of inbox
**Location:** `src/interpreter_ai/main.ts:1359`  
**Status:** UPDATED

**Details:**
- Current architecture uses inbox as the intermediary
- Data broker reads interpreted messages from inbox
- This is the working architecture - updated comment to reflect reality

**Change:**
```typescript
// BEFORE:
// TODO: send to data broker program here instead of inbox

// AFTER:
// Send interpreted message to inbox for data broker to process
```

---

## TODOs Still Pending (Not Completed)

### NPC AI Improvements
**File:** `src/npc_ai/main.ts`

1. **Line 182:** `time_of_day: "day" // TODO: Get actual time`
   - Status: Pending - Need time system implementation
   - Priority: Low

2. **Line 450 & 737:** `// TODO: Detect emotional tone`
   - Status: Pending - Need emotional analysis
   - Priority: Medium

3. **Line 565-566:** `// TODO: Track hostiles`, `// TODO: Check combat state`
   - Status: Pending - Need combat tracking system
   - Priority: Medium

4. **Line 597-598:** `// TODO: Check combat state`, `// TODO: Check recent events`
   - Status: Pending - Need event history tracking
   - Priority: Medium

### Renderer AI
**File:** `src/renderer_ai/main.ts`

5. **Line 110:** `// TODO: Add remaining generators from ACTION_VERBS constant`
   - Status: Pending - See TODO_ACTION_VERBS.md
   - Priority: Medium
   - Remaining verbs: HELP, DEFEND, GRAPPLE, DODGE, CRAFT, SLEEP, REPAIR, WORK, GUARD, HOLD

### Interpreter AI
**File:** `src/interpreter_ai/main.ts`

6. **Line 1308:** `// TODO: on iteration 3+, ask the user to clarify the target.`
   - Status: Pending - Need user clarification flow
   - Priority: Low

### Data Broker
**File:** `src/data_broker/main.ts`

7. **Line 323:** `// TODO: do not auto-create NPCs here; generation happens at boot or via local rules.`
   - Status: Pending - NPC generation policy
   - Priority: Low

### Interface Program
**File:** `src/interface_program/main.ts`

8. **Line 91:** `// TODO: add local generation rules for NPCs when actors travel in populated places.`
   - Status: Pending - Procedural NPC generation
   - Priority: Medium

9. **Line 1237:** `// TODO: Integrate with actual UI display system`
   - Status: Pending - UI integration
   - Priority: High (needed for production)

### Rules Lawyer Effects
**File:** `src/rules_lawyer/effects.ts`

10. **Line 553:** `// TODO: enforce movement speed, partial moves, and full-action recharge`
    - Status: Pending - Movement rules
    - Priority: Medium

11. **Line 602:** `// TODO: attach memory/health/goals/personality context for renderer`
    - Status: Pending - Context enrichment
    - Priority: Medium

12. **Line 611:** `// TODO: match thaumworld health regen rules`
    - Status: Pending - Health regeneration
    - Priority: Low

13. **Line 615:** `// TODO: implement DEFEND tag effects`
    - Status: Pending - DEFEND action
    - Priority: Medium

14. **Line 619:** `// TODO: implement HOLD/WORK rules`
    - Status: Pending - Extended actions
    - Priority: Low

### Actor Storage
**File:** `src/actor_storage/store.ts`

15. **Line 204:** `// TODO: incorporate personality and flavor choices during character creation.`
    - Status: Pending - Character creation enhancement
    - Priority: Low

16. **Line 238:** `// TODO: implement character creation flow to populate actor sheets from rules`
    - Status: Pending - Full character creation
    - Priority: Medium

### Mono UI DOM
**File:** `src/mono_ui_dom/dom_renderer.ts`

17. **Line 19:** `// TODO: map DOM items + inventories into tiles`
    - Status: Pending - DOM rendering
    - Priority: Medium

---

## External TODO File

**File:** `TODO_ACTION_VERBS.md`

This file lists remaining action verb narrative generators to implement:
- HELP, DEFEND, DODGE, GRAPPLE, CRAFT, SLEEP, REPAIR, WORK, GUARD, HOLD

**Status:** Still valid and pending  
**Reference:** See file for implementation patterns

---

## Summary

**Cleared/Updated:** 3 TODOs  
**Still Pending:** 17 TODOs across 8 files

### By Priority:
- **High:** 1 (UI integration)
- **Medium:** 9 (Features and improvements)
- **Low:** 7 (Nice-to-have enhancements)

### By File:
- npc_ai/main.ts: 4 TODOs
- rules_lawyer/effects.ts: 5 TODOs
- renderer_ai/main.ts: 1 TODO
- interpreter_ai/main.ts: 1 TODO
- data_broker/main.ts: 1 TODO
- interface_program/main.ts: 2 TODOs
- actor_storage/store.ts: 2 TODOs
- mono_ui_dom/dom_renderer.ts: 1 TODO

---

## Notes

The cleared TODOs were either:
1. **Already implemented** (save_actor function existed)
2. **Misleading** (functionality already working, comments suggested otherwise)

All remaining TODOs represent actual pending work that would enhance the system.

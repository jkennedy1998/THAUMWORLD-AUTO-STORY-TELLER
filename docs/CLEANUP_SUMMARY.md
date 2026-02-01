# Phase 0 Cleanup Summary

**Date:** February 1, 2026  
**Status:** ✅ COMPLETED  
**Scope:** Standardize constants across all services before implementing working memory system

---

## Changes Made

### 1. Created Shared Constants File
**File:** `src/shared/constants.ts` (NEW)

**Contents:**
- `ACTION_VERBS` - All 15 THAUMWORLD action verbs
- `TOOL_REQUIRED_VERBS` - Subset requiring tool argument
- `MESSAGE_STAGES` - Pipeline stage names
- `MESSAGE_STATUSES` - Message state values
- `TIMED_EVENT_TYPES` - Combat, conversation, exploration
- `ACTION_COSTS` - FULL, PARTIAL, EXTENDED
- `REFERENCE_TYPES` - actor, npc, item, tile, etc.
- `SYSTEM_EFFECTS` - All SYSTEM.* effect verbs
- `MEMORY_BUDGETS` - Working memory limits
- `SERVICE_CONFIG` - Polling intervals, retry config, limits
- `DEBUG_LEVELS` - Standardized debug levels
- `DEFAULT_DATA_SLOT` - Default slot number

### 2. Updated All Services to Use Shared Constants

| Service | Changes |
|---------|---------|
| **state_applier** | Uses ACTION_VERBS, SERVICE_CONFIG.POLL_MS |
| **interpreter_ai** | Uses shared ActionVerb type, SERVICE_CONFIG |
| **renderer_ai** | Uses SERVICE_CONFIG, updated TODO comment |
| **data_broker** | Uses SERVICE_CONFIG for polling and limits |
| **npc_ai** | Uses SERVICE_CONFIG |
| **rules_lawyer** | Uses SERVICE_CONFIG |
| **turn_manager** | Uses SERVICE_CONFIG |
| **roller** | Uses SERVICE_CONFIG |
| **interface_program** | Uses SERVICE_CONFIG |

**Pattern Applied:**
```typescript
// BEFORE:
const data_slot_number = 1;
const POLL_MS = 800;
const ITERATION_LIMIT = 5;

// AFTER:
const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.<SERVICE_NAME>;
const ITERATION_LIMIT = SERVICE_CONFIG.MAX_BROKER_ITERATIONS;
```

### 3. Removed Duplicate Definitions

**Before:** Action verbs defined in 3+ places:
- `src/interpreter_ai/main.ts` line 46
- `src/state_applier/main.ts` lines 33-37
- `src/renderer_ai/main.ts` line 84

**After:** Single source of truth in `src/shared/constants.ts`

---

## Benefits

1. **Single Source of Truth** - Change constant in one place, affects all services
2. **Type Safety** - Shared TypeScript types prevent drift
3. **Configuration** - Easy to tune polling intervals, limits, etc.
4. **Maintainability** - New services can import constants instead of redefining
5. **Consistency** - All services use same values

---

## Testing

**Status:** System works as before (slightly buggy but responding)

**Verification:**
- ✅ All services still boot successfully
- ✅ Message pipeline still flows
- ✅ NPCs still respond
- ✅ No breaking changes to logic

---

## Next Steps

Ready to proceed with **Phase 1: Foundation** from IMPLEMENTATION_PLAN.md:
1. Fix message display issues (messages not reaching inbox)
2. Add conversation threading
3. Data broker enhancements

The codebase is now clean and ready for the working memory architecture implementation.

---

## Notes

- No legacy path fallbacks removed yet (can be done later)
- No interface program split yet (can be done during Phase 1)
- Pre-existing LSP errors in interface_program/main.ts unrelated to cleanup
- All changes are import/constant replacements only - no logic changes

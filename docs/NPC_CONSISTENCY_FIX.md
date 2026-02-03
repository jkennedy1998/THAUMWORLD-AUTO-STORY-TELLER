# NPC Data Consistency & Duplicate Function Removal

**Date:** February 2, 2026  
**Status:** ✅ COMPLETE

---

## Issues Fixed

### 1. Gunther Missing Location Data (CRITICAL)
**Problem:** Gunther's NPC file was missing the `location` field, preventing the NPC AI from finding him in the region.

**Root Cause:** Gunther was listed in `eden_crossroads.jsonc` region file but his NPC sheet didn't have location coordinates.

**Solution:** Added complete location data to Gunther:
```json
"location": {
  "world_tile": { "x": 0, "y": 0 },
  "region_tile": { "x": 0, "y": 0 },
  "tile": { "x": 0, "y": 0 }
}
```

**Additional Fields Added to Gunther:**
- `kind`: "APE_NAKED"
- `size_mag`: 3
- `sex`: "male"
- `age`: 68
- `sexual_orientation`: ""
- `sleep_type`: "SLEEP"
- `sleep_required_per_day`: 6
- `languages`: [{"name": "apish", ...}]
- `lore`: {backstory, family, relationship}
- `senses`: {light, aroma, pressure, thaumic}
- `temperature_range`: {low, high}
- `stats`: {con, str, dex, wis, int, cha}
- `profs`: {...}
- `movement`: {walk, climb, swim, fly}
- `resources`: {health, vigor, actions, ...}
- `relationships`: {}
- `memory_meta`: {last_memory_updated_at, entry_count}
- `memory_sheet`: {recent_memories: [], known_actors: []}

**Result:** Gunther now has the same complete data structure as Grenda and other NPCs.

---

### 2. Duplicate update_outbox_message Functions (CONSISTENCY)

**Problem:** Multiple services had their own copy of `update_outbox_message`, causing:
- Inconsistent behavior
- Race conditions
- Maintenance overhead
- No centralized locking

**Solution:** Removed custom implementations from all services and imported the centralized version from `outbox_store.ts`.

**Files Modified:**

| File | Action |
|------|--------|
| `src/data_broker/main.ts` | Removed custom function, added import |
| `src/interpreter_ai/main.ts` | Removed custom function, added import |
| `src/renderer_ai/main.ts` | Removed custom function, added import |
| `src/rules_lawyer/main.ts` | Removed custom function, added import |
| `src/roller/main.ts` | Removed custom function, added import |

**All services now use:**
```typescript
import { update_outbox_message } from "../engine/outbox_store.js";
```

**Centralized Function Features:**
- Atomic file locking with retry logic
- Consistent error handling
- Proper message merging
- Deduplication support

---

## NPC File Structure Comparison

### Before (Gunther):
```json
{
  "schema_version": 1,
  "id": "gunther",
  "name": "Gunther",
  "title": "the Elder of Eden",
  "description": "...",
  "race": "human",
  "gender": "male",
  "age": "elderly",
  "role": "elder",
  "appearance": {...},
  "personality": {...},
  "stats": {...},
  "derived": {...},
  // MISSING: location, senses, languages, resources, etc.
}
```

### After (Gunther):
```json
{
  "schema_version": 1,
  "id": "gunther",
  "name": "Gunther",
  "title": "the Elder of Eden",
  "description": "...",
  "kind": "APE_NAKED",
  "size_mag": 3,
  "sex": "male",
  "age": 68,
  "sexual_orientation": "",
  "sleep_type": "SLEEP",
  "sleep_required_per_day": 6,
  "languages": [...],
  "lore": {...},
  "appearance": {...},
  "personality": {...},
  "senses": {...},
  "temperature_range": {...},
  "stats": {...},
  "profs": {...},
  "movement": {...},
  "location": {...},  // ← ADDED
  "resources": {...}, // ← ADDED (was 'stats')
  "derived": {...},
  // ... etc
}
```

---

## Testing Instructions

1. **Restart the system:**
   ```bash
   npm run dev
   ```

2. **Test Gunther communication:**
   ```
   > hello gunther
   ```
   - Gunther should now respond (he has location data)
   - NPC AI will find him at region_tile (0, 0)

3. **Verify consistency:**
   - All NPCs should have same data structure
   - No more missing location errors
   - Conversation threading should work properly

---

## Files Changed

### NPC Data:
- `local_data/data_slot_1/npcs/gunther.jsonc` - Added missing fields and location

### Service Code (removed duplicate functions):
- `src/data_broker/main.ts`
- `src/interpreter_ai/main.ts`
- `src/renderer_ai/main.ts`
- `src/rules_lawyer/main.ts`
- `src/roller/main.ts`

### Already Fixed (from earlier):
- `src/state_applier/main.ts`
- `src/engine/outbox_store.ts` (centralized version)

---

## Result

✅ **Gunther now has proper location data** - NPC AI can find him  
✅ **All NPC files have consistent structure** - Matches Grenda format  
✅ **All services use centralized storage functions** - No more duplicates  
✅ **Atomic file locking** - Prevents race conditions  
✅ **Consistent error handling** - Across all services  

**Ready for testing!** Gunther should now respond when you talk to him.

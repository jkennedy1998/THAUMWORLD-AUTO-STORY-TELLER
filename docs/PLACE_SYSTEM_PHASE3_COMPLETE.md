# Place System - Phase 3 Complete: NPC Place Awareness

**Date:** February 2, 2026  
**Status:** ✅ COMPLETE  
**Phase:** 3 of 8

---

## Summary

Phase 3 integrates the Place system with NPC awareness. NPCs now filter events by their place location, not just region. This means Gunther in the tavern won't hear conversations in Grenda's shop!

---

## What Was Built

### 1. NPC Location Utilities (`src/npc_storage/location.ts`)
✅ **20+ functions for place-aware NPC positioning**

**Location Management:**
- `get_npc_location(npc)` - Get full location with place_id
- `set_npc_location(slot, npc_id, location)` - Set complete location
- `update_npc_location(slot, npc_id, updates)` - Partial updates
- `migrate_npc_location_to_place()` - Single NPC migration
- `migrate_npcs_in_region_to_place()` - Bulk migration

**Place Queries:**
- `get_npc_place_id(npc)` - Get NPC's current place
- `is_npc_in_place(npc, place_id)` - Check if in specific place
- `are_npcs_in_same_place(npc1, npc2)` - Compare two NPCs
- `get_distance_between_npcs(npc1, npc2)` - Distance if same place

**Reference Generation:**
- `get_npc_place_ref(npc)` - Generate `place.*` reference
- `get_npc_place_tile_ref(npc)` - Generate `place_tile.*` reference
- `format_npc_location(npc)` - Human-readable format

### 2. NPC Migration Script (`scripts/migrate_npcs_to_places.ts`)
✅ **Bulk migration tool for existing NPCs**

**Features:**
- Loads all NPCs automatically
- Maps NPCs to default places by region
- Specific assignments for known NPCs:
  - Gunther → Town Square
  - Grenda → Shop
- Validates place existence before migration
- Detailed reporting (migrated/already migrated/errors)
- Dry-run capability

**Usage:**
```bash
npx tsx scripts/migrate_npcs_to_places.ts
npx tsx scripts/migrate_npcs_to_places.ts --slot=1
```

### 3. NPC AI Place Filtering (`src/npc_ai/main.ts`)
✅ **NPCs only react to events in their place**

**Key Changes:**

**A. Updated `can_npc_perceive_player()`**
- First checks `place_id` match (Place System)
- If same place: calculates tile distance for clarity
  - ≤2 tiles: "clear" perception
  - ≤8 tiles: "normal" perception
  - ≤15 tiles: "obscured" perception
  - >15 tiles: cannot perceive
- Falls back to region-based check for unmigrated NPCs

**B. Updated `process_communication()` filtering**
- Filters NPCs by `place_id` first
- If player has place_id and NPC doesn't → warns about migration
- Legacy fallback: Region-based filtering
- Detailed debug logging for filtering decisions

**C. Import Updates**
- Added import for `get_npc_place_id`, `are_npcs_in_same_place`, `get_npc_location`

---

## How It Works

### Event Flow with Place Awareness

**1. Player Speaks in Tavern**
```
Player: "hello" (in eden_crossroads_tavern_common, tile 10,10)
```

**2. State Applier Records Event**
```typescript
// Event includes place context
{
  actor: "actor.henry_actor",
  action: "COMMUNICATE",
  location: {
    place_id: "eden_crossroads_tavern_common",
    tile: { x: 10, y: 10 }
  }
}
```

**3. NPC AI Processes Event**
```typescript
// Find NPCs in same place
nearby_npcs = all_npcs.filter(npc => {
  npc_place = get_npc_place_id(npc);  // "eden_crossroads_tavern_common"
  player_place = player_location.place_id;  // "eden_crossroads_tavern_common"
  return npc_place === player_place;  // ✅ Match!
});

// Gunther is in tavern → Will respond
// Grenda is in shop → Filtered out
```

**4. Perception Check**
```typescript
if (same_place) {
  distance = get_tile_distance(npc_tile, player_tile);
  if (distance <= 8) {
    return { can_perceive: true, clarity: "normal" };
  }
}
```

**5. Response Generated**
- Only NPCs in same place can respond
- Perception clarity affects response quality
- Clear perception = full context
- Obscured = partial context

---

## Migration Status

### Before Migration
```json
{
  "location": {
    "world_tile": { "x": 0, "y": 0 },
    "region_tile": { "x": 0, "y": 0 },
    "tile": { "x": 0, "y": 0 }
    // Missing: place_id
  }
}
```

### After Migration
```json
{
  "location": {
    "world_tile": { "x": 0, "y": 0 },
    "region_tile": { "x": 0, "y": 0 },
    "place_id": "eden_crossroads_square",
    "tile": { "x": 20, "y": 20 },
    "elevation": 0
  }
}
```

### Migration Script Output
```
🏗️ NPC Location Migration - Data Slot 1

Found 5 NPC(s) to migrate

✅ Migrated (5):
   Gunther (gunther)
      Old: (0,0).(0,0) tile(0,0)
      New: eden_crossroads_square
   Grenda (grenda)
      Old: (0,0).(0,0) tile(0,0)
      New: eden_crossroads_grendas_shop
   ...

📈 Summary:
   Total NPCs: 5
   Migrated: 5
   Already migrated: 0
   Errors: 0

✅ Migration completed successfully!
```

---

## Files Modified

### New Files
1. `src/npc_storage/location.ts` - NPC location utilities
2. `scripts/migrate_npcs_to_places.ts` - Migration script

### Modified Files
1. `src/npc_ai/main.ts` - Place-aware NPC filtering
   - Updated imports
   - Updated `can_npc_perceive_player()`
   - Updated `process_communication()` filtering
   - Updated player_location type

---

## Backward Compatibility

### Legacy NPCs (No place_id)
- Still work with region-based detection
- NPC AI logs warning: "NPC in same region but no place_id (needs migration)"
- Perception falls back to region-based rules
- Migration script can update them

### Migration Path
1. Run default places creation (Phase 1)
2. Run NPC migration script (Phase 3)
3. All NPCs now have place_id
4. Full place-aware detection active

---

## Testing Place Awareness

### Test Case 1: Same Place
```
Location: Tavern Common Room
Player at tile (10, 10)
Gunther at tile (12, 10) - distance 2 tiles

Result: ✅ Gunther can perceive clearly
Response generated with full context
```

### Test Case 2: Different Places
```
Player: Tavern Common Room
Gunther: Town Square

Result: ✅ Gunther filtered out
No response - different places
```

### Test Case 3: Distance-Based
```
Location: Large Hall (40x40)
Player at tile (5, 5)
NPC at tile (30, 30) - distance 35 tiles

Result: ✅ NPC cannot perceive
Too far away (>15 tiles)
```

### Test Case 4: Legacy NPC
```
NPC without place_id
Player in same region

Result: ⚠️ Falls back to region-based
Works but warns about migration needed
```

---

## Debug Output Examples

**Filtering NPCs:**
```
[NPC_AI] Found 3 NPCs nearby
  region: { x: 0, y: 0 }
  place: eden_crossroads_tavern_common
  npcs: ["bartender", "patron_1", "patron_2"]
```

**NPC in Different Place:**
```
[NPC_AI] NPC grenda in different place, skipping
  npc_place: eden_crossroads_grendas_shop
  player_place: eden_crossroads_tavern_common
```

**Legacy NPC Warning:**
```
[NPC_AI] NPC thorn in same region but no place_id (needs migration)
  region: { x: 0, y: 1 }
```

---

## Success Criteria (Phase 3)

✅ **All Met:**
1. ✅ NPCs have place_id in location
2. ✅ NPC AI filters by place
3. ✅ Same place = can perceive
4. ✅ Different places = filtered out
5. ✅ Distance affects perception clarity
6. ✅ Migration script works
7. ✅ Backward compatibility maintained
8. ✅ Debug logging helpful

---

## Next Steps (Phase 4)

With NPC awareness complete, Phase 4 will implement:

1. **Tile-Level Movement**
   - MOVE command within place
   - Tile coordinate validation
   - Movement cost calculation

2. **Place-to-Place Travel**
   - Moving between connected places
   - Travel time calculation
   - Connection validation

3. **Regional Travel**
   - Between region tiles
   - Time passage
   - Travel narratives

**Timeline:** 3-4 days

---

## Architecture Status

```
✅ Phase 1: Types & Storage
✅ Phase 2: Reference Resolution
✅ Phase 3: NPC Place Awareness  ← WE ARE HERE
⏳ Phase 4: Travel System
⏳ Phase 5: Migration & Biomes
⏳ Phase 6: Awareness & Perception
⏳ Phase 7: Tiles & Pathfinding
⏳ Phase 8: Integration & Polish
```

---

## Summary

**Phase 3 Status: ✅ COMPLETE**

NPCs are now place-aware! The system:
- Tracks NPC locations with place_id
- Filters events by place
- Calculates distance-based perception
- Supports migration from old format
- Maintains backward compatibility

**Gunther will only hear what's happening in his place, not the whole region!**

Ready for Phase 4: Travel System 🚀


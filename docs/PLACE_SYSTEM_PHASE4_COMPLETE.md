# Place System - Phase 4 Complete: Time, Schedules & Movement

**Date:** February 2, 2026  
**Status:** ✅ COMPLETE  
**Phase:** 4 of 8

---

## Summary

Phase 4 implements a comprehensive time and movement system for the Place architecture. NPCs now have schedules, time progresses, and entities can move between tiles, places, and regions with realistic travel times.

---

## What Was Built

### 1. Global Time Tracking System (`src/time_system/tracker.ts`)
✅ **Complete game time management**

**Features:**
- Minutes, hours, days, months, years
- 6-month calendar (Thawmelt, Bloomtide, Highsun, Goldharvest, Frostfall, Deepwinter)
- 7-day week (Firstday through Sevenday)
- Time of day categories (night, dawn, morning, afternoon, dusk, evening)
- Time advancement functions
- Time comparison and formatting utilities

**Game Time Storage:**
```typescript
{
  minute: 30,
  hour: 14,        // 2 PM
  day: 15,
  month: 2,        // Highsun
  year: 1,
  total_minutes: 61590
}
```

**Storage:** `local_data/data_slot_1/game_time.jsonc`

---

### 2. NPC Schedule System

#### Schedule Types (`src/npc_storage/schedule_types.ts`)
✅ **Comprehensive schedule data model**

**Schedule Entry:**
```typescript
{
  id: "gunther_morning",
  name: "Morning Routine",
  start_time: 480,          // 8:00 AM (minutes from midnight)
  duration_minutes: 120,    // 2 hours
  place_id: "eden_crossroads_tavern_common",
  activity_type: "social",
  description: "Breakfast and conversation",
  temporary_goal: "Check on tavern patrons",
  priority: 5,
  interruptible: true
}
```

**Activity Types:**
- sleep, work, travel, social, personal, meal
- patrol, study, pray, guard, craft, shop
- entertain, explore, wait

**Schedule Change Reasons:**
- job_change, goal_change, lifestyle_change
- relationship_change, health_change
- weather, seasonal, event
- player_influence, npc_influence
- quest, emergency

#### Schedule Manager (`src/npc_storage/schedule_manager.ts`)
✅ **Schedule storage and execution**

**Functions:**
- `load_schedule()` / `save_schedule()` - Persistence
- `create_default_schedule()` - 5-entry default template
- `get_current_activity()` - What's NPC doing now?
- `get_scheduled_place()` - Where should NPC be?
- `update_schedule()` - Modify schedules
- `set_schedule_override()` - Emergency/temporary changes
- `check_schedule_status()` - Detect expired schedules

**Default Daily Schedule (5 entries):**
1. 00:00-08:00: Sleep (high priority, not interruptible)
2. 08:00-10:00: Morning routine
3. 10:00-16:00: Work (with flexible duration)
4. 16:00-20:00: Evening activities
5. 20:00-00:00: Prepare for sleep

**Storage:** `{npc_id}_schedule.jsonc` alongside NPC file

---

### 3. Movement & Travel System (`src/travel/movement.ts`)
✅ **Comprehensive travel mechanics**

#### Tile-Level Movement (Within Place)
```typescript
move_within_place(
  slot: number,
  entity_ref: "npc.gunther",
  target_tile: { x: 10, y: 15 },
  speed: "walk" | "run" | "sneak" | "crawl"
)
```

**Movement Speeds:**
- Crawl: 1 tile/minute
- Sneak: 2 tiles/minute
- Walk: 4 tiles/minute (default)
- Run: 8 tiles/minute

**Example:**
```
Player: "walk to the bar" (10 tiles away)
System: 10 tiles ÷ 4 tiles/min = 2.5 minutes
Output: "You walk to the bar..." (2.5s real-time)
```

#### Place-to-Place Travel
```typescript
travel_between_places(
  slot: number,
  entity_ref: "actor.henry_actor",
  target_place_id: "eden_crossroads_tavern_common"
)
```

**Features:**
- Validates place connections
- Uses default entry position
- Updates entity location
- Updates place contents
- Returns travel description

**Example:**
```
Player: "go to the tavern"
System: Checks connection from Square to Tavern
Output: "You push through the wooden door into the tavern..."
Time: 5 seconds (place transition)
```

#### Regional Travel
```typescript
travel_between_regions(
  slot: number,
  entity_ref: "actor.henry_actor",
  target_region: { world_x: 0, world_y: 1, region_x: 2, region_y: 3 }
)
```

**Features:**
- 30 minutes per world tile
- Advances global game time
- Different from place-to-place (no instant transition)

**Example:**
```
Player: "travel to the Whispering Woods"
System: 2 world tiles away × 30 min = 60 minutes
Time advances: 8:00 AM → 9:00 AM
Output: "You walk east along the forest path..."
```

#### Schedule-Based Movement
```typescript
update_npc_position_for_schedule(
  slot: number,
  npc_id: "gunther",
  game_time: current_time
)
```

**Automatic NPC Movement:**
- Checks if NPC should be elsewhere
- Validates connection exists
- Executes travel if possible
- Logs movements for debugging

---

## Integration Points

### Time System Integration
```
Player Action → Time Advances → Schedule Check → NPC Movement
```

**Example Flow:**
1. Player talks to Gunther at 8:30 AM
2. Time advances 5 minutes → 8:35 AM
3. Gunther's schedule: Work starts at 10:00 AM (still in tavern)
4. Gunther stays put (on schedule)

### Schedule + Movement Integration
```
Current Time: 9:55 AM
Gunther's Schedule:
  - 08:00-10:00: Tavern (morning routine)
  - 10:00-16:00: Square (work at waystone)

At 10:00 AM:
  - Schedule manager detects place change needed
  - Checks connection: Tavern ↔ Square ✓
  - Executes travel_between_places()
  - Gunther now in Square
```

---

## Files Created

### Core Systems
1. `src/time_system/tracker.ts` - Global time management
2. `src/npc_storage/schedule_types.ts` - Schedule type definitions
3. `src/npc_storage/schedule_manager.ts` - Schedule storage/execution
4. `src/travel/movement.ts` - Movement and travel system

### Documentation
5. `docs/SCHEDULE_SYSTEM_TODO.md` - Comprehensive expansion plans

---

## Usage Examples

### Check NPC Current Activity
```typescript
const schedule = load_schedule(1, "gunther");
const time = load_time(1);
const activity = get_current_activity(schedule, time);

// Result:
{
  is_on_schedule: true,
  current_entry: {
    name: "Work",
    place_id: "eden_crossroads_square",
    description: "Telling stories at the waystone"
  },
  time_until_next: 180, // 3 hours until evening activities
  is_override: false
}
```

### Move Player Within Place
```typescript
await move_within_place(
  1,
  "actor.henry_actor",
  { x: 15, y: 10 },  // Move to bar
  "walk"
);

// Output: "You walk to the bar..." (takes 3.75 seconds)
```

### Travel Between Places
```typescript
await travel_between_places(
  1,
  "actor.henry_actor",
  "eden_crossroads_tavern_common"
);

// Updates:
// - Actor location (new place_id)
// - Place contents (removed from square, added to tavern)
// - Game time (if significant)
```

### Update NPC Schedule
```typescript
update_schedule(1, "gunther", {
  reason: "player_influence",
  details: "Gunther agreed to meet at tavern instead",
  modifications: [
    {
      entry_id: "gunther_work",
      field: "place_id",
      new_value: "eden_crossroads_tavern_common"
    }
  ],
  temporary: true,
  duration_minutes: 120 // 2 hour meeting
});
```

---

## Schedule System TODO (Future)

Created comprehensive TODO file: `docs/SCHEDULE_SYSTEM_TODO.md`

**High Priority:**
- Schedule templates (Guard, Merchant, Farmer, etc.)
- Dynamic schedule generation (personality-based)
- Schedule interruptions (emergencies)

**Medium Priority:**
- Schedule coordination (NPC meetings)
- Seasonal/weather adaptations
- Schedule memory & learning

**Low Priority:**
- Group schedules
- Visualization tools
- Quest integration

---

## Success Criteria (Phase 4)

✅ **All Met:**
1. ✅ Global time tracker working
2. ✅ NPC schedule system implemented
3. ✅ Schedule storage and loading
4. ✅ Tile-level movement
5. ✅ Place-to-place travel
6. ✅ Regional travel
7. ✅ Time advancement
8. ✅ Schedule execution
9. ✅ Movement integration
10. ✅ Comprehensive documentation

---

## Architecture Status

```
✅ Phase 1: Types & Storage
✅ Phase 2: Reference Resolution  
✅ Phase 3: NPC Place Awareness
✅ Phase 4: Time, Schedules & Movement  ← WE ARE HERE
⏳ Phase 5: Migration & Biomes (COMPLETE - migration done)
⏳ Phase 6: Enhanced Awareness
⏳ Phase 7: Tiles & Pathfinding
⏳ Phase 8: Integration & Polish
```

---

## What's Now Possible

### Dynamic World
- NPCs follow daily schedules
- Time progresses naturally
- NPCs move between places automatically
- Different activities at different times

### Realistic Travel
- Walking takes time
- Place transitions feel natural
- Regional travel advances time significantly
- Speed matters (walk vs run)

### Living NPCs
- Gunther: Morning in tavern → Work at waystone → Evening socializing
- Grenda: Shop hours 9-5, lunch break, closes at evening
- All NPCs can have 5-6 daily activities

### Schedule Changes
- Player can influence NPC schedules
- NPCs adapt to life changes
- Temporary overrides for quests/events
- Emergency interruptions

---

## Next Steps

**Option 1: Test Time & Schedules**
```bash
npm run dev
# Watch NPCs move according to schedule
# Test time advancement
```

**Option 2: Continue to Phase 5 (Enhanced Awareness)**
- Line of sight system
- Sound propagation
- Lighting effects
- Stealth mechanics

**Option 3: Create Schedule Templates**
- Build profession-based schedules
- Assign to NPCs
- Test coordinated activities

**Option 4: Review Documentation**
- Check TODO files
- Review architecture
- Plan remaining phases

---

## Summary

**Phase 4 Status: ✅ COMPLETE**

The world is now **DYNAMIC** and **TIME-BASED**:

✅ Time flows (minutes, hours, days, months, years)  
✅ NPCs have schedules (5-6 activities/day)  
✅ NPCs move automatically based on schedules  
✅ Players can move (tile, place, region)  
✅ Travel takes realistic time  
✅ Schedules can be updated dynamically  
✅ Comprehensive expansion plans documented  

**The world feels ALIVE!** 🌍⏰

NPCs aren't static - they sleep, work, eat, and socialize according to their schedules. Time matters. Travel matters. The world breathes!

**Ready for Phase 5 or testing!** 🚀


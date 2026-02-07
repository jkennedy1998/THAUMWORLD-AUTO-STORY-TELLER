# NPC Schedule System - TODO & Expansion Plans

**Date:** February 2, 2026  
**Status:** Basic Implementation Complete  
**Priority:** Enhancement for Future Development

---

## Current Status

### ✅ Implemented (Phase 4 Core)
- Global time tracking system
- NPC schedule types and data structures
- Schedule storage and management
- Basic schedule execution
- Time-based place transitions
- Movement system integration

---

## TODO: Schedule System Expansions

### 1. Schedule Templates [HIGH PRIORITY]
**Goal:** Pre-defined schedules for common professions

**Templates Needed:**
```typescript
- Guard Schedule: Patrol shifts, guard posts, meal breaks
- Merchant Schedule: Opening hours, lunch break, closing
- Farmer Schedule: Morning chores, field work, evening rest
- Innkeeper Schedule: Early prep, service hours, cleanup
- Blacksmith Schedule: Forge hours, lunch, market time
- Scholar Schedule: Study periods, meal times, sleep
- Noble Schedule: Court hours, meals, social events
- Criminal Schedule: Night activities, hideouts, meetings
```

**Implementation:**
- Create `src/npc_storage/schedule_templates.ts`
- Profession-based template selection
- Customizable parameters (place IDs, specific times)

---

### 2. Dynamic Schedule Generation [HIGH PRIORITY]
**Goal:** NPCs generate schedules based on personality/goals

**Features:**
- Early bird vs night owl preferences
- Goal-driven activity selection
- Social vs solitary preferences
- Work ethic variations
- Hobby integration

**Example:**
```typescript
if (npc.personality.hobby === "fishing") {
  schedule.addActivity({
    type: "personal",
    activity: "fishing",
    time: "early_morning",
    place: find_nearby_water()
  });
}
```

---

### 3. Schedule Coordination [MEDIUM PRIORITY]
**Goal:** NPCs coordinate schedules with each other

**Use Cases:**
- Guards patrol in shifts (handoffs)
- Shopkeepers coordinate lunch breaks
- Meeting appointments between NPCs
- Group activities (guard training, town meetings)
- Romantic dates
- Criminal coordination

**Implementation:**
- Shared schedule requests
- Conflict resolution
- Confirmation system
- Rescheduling

---

### 4. Schedule Interruptions [MEDIUM PRIORITY]
**Goal:** Handle emergency/unexpected changes

**Interruption Types:**
- Combat/alarm (drop everything)
- Fire/emergency (evacuate)
- NPC death in town (mourning period)
- Player actions (chase, conversation)
- Weather events (seek shelter)
- Important announcements (gather at square)

**Priority System:**
```typescript
Priority 10: Life-threatening (combat, fire)
Priority 9: Emergencies (injury, crime)
Priority 8: Urgent quests
Priority 7: Social obligations (weddings, funerals)
Priority 6: Work emergencies
Priority 5: Normal activities
Priority 4: Optional activities
Priority 3: Leisure
Priority 2: Sleep (can be interrupted)
Priority 1: Deep sleep (hard to wake)
```

---

### 5. Schedule Memory & Learning [MEDIUM PRIORITY]
**Goal:** NPCs remember schedule changes and adapt

**Features:**
- Remember missed activities ("I missed breakfast...")
- Learn optimal times for activities
- Adjust based on past interruptions
- Remember player meeting times
- Form habits over time

**Data Structure:**
```typescript
schedule_memory: {
  missed_activities: Array<{
    activity: string;
    reason: string;
    times_missed: number;
  }>;
  preferred_times: Record<activity, time_range>;
  learned_patterns: Array<{
    pattern: string;
    success_rate: number;
  }>;
}
```

---

### 6. Seasonal & Weather Schedules [MEDIUM PRIORITY]
**Goal:** Schedules adapt to seasons and weather

**Seasonal Changes:**
- Winter: Later wake times, shorter work hours
- Summer: Earlier wake times, afternoon siestas
- Harvest season: Long work hours
- Festival seasons: Special activities

**Weather Adaptations:**
- Rain: Indoor activities, delayed travel
- Snow: Winter clothing, different routes
- Storms: Seek shelter, cancel outdoor work
- Clear days: Outdoor work preferred

---

### 7. Group Schedules [LOW PRIORITY]
**Goal:** Coordinated group activities

**Examples:**
- Guard patrol teams (synchronized patrols)
- Hunting parties (coordinated departure)
- Market vendors (coordinated setup)
- Religious ceremonies (group attendance)
- Training sessions (group practice)

---

### 8. Schedule Preferences & Personality [LOW PRIORITY]
**Goal:** NPCs have unique schedule preferences

**Preference Types:**
- Chronotype: Early bird (5 AM) vs Night owl (noon)
- Punctuality: Strict vs Flexible
- Social: Group activities vs Solitary
- Work ethic: Hardworking vs Lazy
- Spontaneity: Planned vs Impulsive

**Impact:**
- Schedule entry flexibility
- Punctuality variance
- Activity preferences
- Break frequency

---

### 9. Schedule Visualization [LOW PRIORITY]
**Goal:** Dev tools to view NPC schedules

**Features:**
- Daily schedule view
- Weekly overview
- Timeline visualization
- Conflict detection
- Place occupancy heatmap

---

### 10. Schedule Quest Integration [LOW PRIORITY]
**Goal:** Quests can modify schedules

**Use Cases:**
- "Meet me at the tavern at 8 PM" (create appointment)
- Guard needs to be distracted (create gap in schedule)
- Merchant needs escort (add travel to schedule)
- NPC goes on pilgrimage (temporary schedule change)

---

## Implementation Priority

### Phase 4.5 (Next 1-2 weeks)
1. ✅ Global time tracker
2. ✅ Schedule types
3. ✅ Schedule storage
4. ✅ Movement system
5. ⏳ Schedule templates (Guard, Merchant)
6. ⏳ Basic interruption handling

### Phase 4.6 (Weeks 3-4)
1. Dynamic schedule generation
2. Schedule coordination (meetings)
3. Emergency interruptions
4. Schedule memory

### Phase 4.7 (Future)
1. Seasonal schedules
2. Group schedules
3. Personality preferences
4. Quest integration

---

## Technical Architecture

### Current Structure
```
src/
├── time_system/
│   └── tracker.ts          ✅ Global time
├── npc_storage/
│   ├── schedule_types.ts   ✅ Type definitions
│   └── schedule_manager.ts ✅ Storage/execution
└── travel/
    └── movement.ts         ✅ Movement system
```

### Future Additions
```
src/
├── time_system/
│   ├── tracker.ts
│   ├── seasons.ts          ⏳ Season management
│   └── events.ts           ⏳ Special dates
├── npc_storage/
│   ├── schedule_types.ts
│   ├── schedule_manager.ts
│   ├── schedule_templates.ts ⏳ Profession templates
│   ├── schedule_generator.ts ⏳ Dynamic generation
│   └── schedule_coordination.ts ⏳ NPC coordination
└── travel/
    └── movement.ts
```

---

## Example NPC Schedule (Post-Expansion)

```typescript
{
  npc_id: "guard_captain",
  entries: [
    // Sleep (5 hours)
    { id: "sleep", name: "Sleep", 
      start_time: 0, duration: 300,
      place_id: "barracks_bunk", activity_type: "sleep",
      priority: 9, interruptible: false },
    
    // Early patrol (suits early bird personality)
    { id: "early_patrol", name: "Dawn Patrol",
      start_time: 300, duration: 120,
      place_id: "town_square", activity_type: "patrol",
      temporary_goal: "Check for overnight incidents",
      priority: 7, interruptible: true },
    
    // Breakfast
    { id: "breakfast", name: "Breakfast",
      start_time: 420, duration: 45,
      place_id: "tavern_common", activity_type: "meal",
      priority: 5, interruptible: true },
    
    // Guard duty (coordinate with other guards)
    { id: "guard_duty", name: "Main Gate Duty",
      start_time: 480, duration: 240,
      place_id: "main_gate", activity_type: "guard",
      temporary_goal: "Control gate access",
      priority: 8, interruptible: true,
      // Coordinated with guard_2's lunch break
      coordination: { npc: "guard_2", type: "shift_handoff" } },
    
    // Lunch
    { id: "lunch", name: "Lunch Break",
      start_time: 720, duration: 60,
      place_id: "barracks_common", activity_type: "meal",
      priority: 5, interruptible: true },
    
    // Afternoon patrol
    { id: "afternoon_patrol", name: "Market Patrol",
      start_time: 780, duration: 180,
      place_id: "market_square", activity_type: "patrol",
      temporary_goal: "Maintain market order",
      priority: 7, interruptible: true,
      // More flexible for spontaneous events
      flexible_duration: 60 },
    
    // Dinner & social
    { id: "dinner", name: "Dinner & Debrief",
      start_time: 960, duration: 120,
      place_id: "barracks_common", activity_type: "social",
      temporary_goal: "Share daily reports",
      priority: 4, interruptible: true },
    
    // Evening rounds
    { id: "evening_rounds", name: "Evening Security Check",
      start_time: 1080, duration: 120,
      place_id: "town_square", activity_type: "patrol",
      temporary_goal: "Ensure town security",
      priority: 7, interruptible: true },
    
    // Wind down
    { id: "wind_down", name: "Prepare for Sleep",
      start_time: 1200, duration: 240,
      place_id: "barracks_common", activity_type: "personal",
      priority: 3, interruptible: true }
  ],
  
  // Personality-driven preferences
  preferences: {
    chronotype: "early_bird",  // Wakes up earlier
    punctuality: "strict",     // On time to entries
    social_preference: "group", // Prefers group activities
    flexibility: "moderate"    // Some schedule flexibility
  },
  
  // Can be interrupted by emergencies
  emergency_override: true,
  
  // Learns from schedule changes
  adaptive: true
}
```

---

## Notes

**Current Limitations:**
- Schedules are daily (no weekly/monthly patterns yet)
- No schedule coordination between NPCs yet
- Limited interruption handling
- Static schedules only (no learning/adaptation)

**Next Steps:**
1. Create schedule templates for 5-10 professions
2. Implement basic interruption system
3. Add schedule visualization tool
4. Test with multiple NPCs moving simultaneously

**Integration Points:**
- NPC AI needs to check schedule before responding
- Travel system needs to execute scheduled moves
- Time system needs to trigger schedule checks
- Quest system needs to modify schedules

---

## Summary

The schedule system foundation is **SOLID** and **EXTENSIBLE**. Current implementation supports:
- ✅ Time-based activities
- ✅ Place transitions
- ✅ Schedule storage
- ✅ Movement integration

**Future enhancements will make NPCs feel truly alive with:**
- Dynamic schedules based on personality
- Coordination with other NPCs
- Adaptation to circumstances
- Emergencies and interruptions
- Learning from experience

**Ready for:** Phase 4.5 (templates & interruptions) when needed!

---

**Last Updated:** February 6, 2026  
**Status:** Active Plan

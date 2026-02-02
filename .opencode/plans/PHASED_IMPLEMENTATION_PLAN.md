# THAUMWORLD Region Travel System - Phased Implementation Plan
**Version:** 2.0 (Refined)  
**Date:** February 2, 2026  
**Status:** Implementation Ready  
**Priority:** Message System First, Travel System Second

---

## Executive Summary

This plan prioritizes **fixing the message system bugs** while laying the groundwork for the region travel system. We use temporary/default data to unblock the pipeline, then build the full travel system incrementally.

### Design Decisions (Based on User Feedback)

| Question | Decision | Impact |
|----------|----------|--------|
| Q1 World Scale | World tile = 10,000 tiles, Region = 1,000 tiles, Tile = 2.5ft | 10 regions per world tile |
| Q1 World Bounds | Infinite for now, eventually sphere of quads | Procedural generation unbounded |
| Q2 Persistence | Save permanently to local_data | Generated regions persist across sessions |
| Q3 Multiplayer | Plan for single player, but actors are players | Each player = actor, sync handled separately |
| Q4 Fast Travel | No fast travel | All travel is real-time through region graph |
| Q5 Maps | Text-based for now, coordinate system ready | Maps are future feature, not current priority |
| Q6 Actor Location | Always in a region (can be travel region) | No null locations, always valid region context |
| Q7 Adjacent Visibility | Players see large details of adjacent & connected regions | Descriptions include nearby regions |
| Q8 Backtracking | No speed bonus for familiar paths | Consistent travel times |
| Q9 Travel Speed | Party moves at slowest speed | Speed = world tiles per extended action |
| Q10 NPC Travel | NPCs have schedules, can follow actors, or stay put | Dynamic NPC locations |

### World Scale Specification

**Hierarchy:**
```
World (Infinite / Sphere of Quads)
  └── World Tile (10,000 tiles × 10,000 tiles)
       └── Regions (10 × 10 grid = 100 regions per world tile)
            └── Tiles (1,000 tiles × 1,000 tiles per region)
                 └── Each tile = 2.5 feet
```

**Calculations:**
- World Tile size: 10,000 tiles × 2.5ft = 25,000 feet ≈ 4.73 miles
- Region size: 1,000 tiles × 2.5ft = 2,500 feet ≈ 0.47 miles
- Tiles per region: 1,000 × 1,000 = 1,000,000 tiles per region
- Regions per world tile: 10 × 10 = 100 regions

**Travel Speed (THAUMWORLD Rules):**
- Speed stat = number of world tiles per extended action
- Example: Speed 3 = 3 world tiles per extended action
- 1 world tile = 100 regions (10×10 grid)
- So Speed 3 = 300 regions of movement per extended action
- Party moves at slowest member's speed

**NPC Movement:**
- NPCs have schedule-based locations (region_id at specific times)
- Can follow actors if they have relevant goals
- Static NPCs (prisoners, homebodies) stay in fixed regions
- System fetches NPC data based on current time + schedule

---

## Phase Breakdown

### PHASE 0: Message System Fixes (IMMEDIATE - This Week)
**Goal:** Unblock working memory and message pipeline
**Status:** In Progress

#### P0.0: Tabletop Pacing + Intent/Targeting Guardrails (ADDED)
**Priority:** CRITICAL

This sub-phase fixes the largest tabletop-experience regressions:
- One player input can currently trigger multiple internal interpretations/refinements, producing multiple narrations/NPC replies.
- UI targeting tokens like `@Name` can reach the machine-text parser and cause rapid retry/refinement loops.

**Design Decisions (Confirmed):**
- **A. UI mentions**: `@Name` is treated as UI targeting, not literal text. If valid, the UI removes the token and sends `target_ref` separately.
- **B. Timed events**: During initiative-based play, multiple NPC messages per round are expected. Outside timed events, a single player input should behave atomically.
- **C. NPC triggers**: NPCs may respond to any relevant action (not only COMMUNICATE) if they are aware and the action targets them or occurs nearby.
- **D. Clarify loop**: When intent/target is unclear, the system asks for clarification (and pauses) rather than speculating.
- **Targeting rule**: If `@Name` doesn’t match a nearby/loaded target, warn and ask user to choose from available targets (no cross-region telepathy).

**Implementation Pieces:**

1) **UI: Mention-based targeting (no parser pollution)**
- Detect `@Name` anywhere in the typed message.
- If `Name` matches a known target, strip it from the outgoing text and send `target_ref`.
- If not found, warn in status window and keep text unchanged.

2) **UI: Intent override + action cost override**
- One intent per message (buttons), plus action_cost buttons: `FREE`, `PARTIAL`, `FULL`, `EXTENDED`.
- Auto-suggest intent 1s after the user stops typing (non-AI keyword/token matcher).
- If no intent hint and no override, show a one-time pre-send warning in the status window:
  - `your message does not contain an action type hint` → brief pause → `waiting for actor response`

3) **UI: Targeting panel (text-only for now)**
- A new window lists possible targets in the current region (NPCs present, current region, self).
- Support commands:
  - `@name <message>` sets target for that message
  - `/target <name>` sets persistent target
  - `/target` clears persistent target

4) **Backend: Targets endpoint**
- Add `GET /api/targets?slot=&actor_id=` returning region label and nearby targets.

5) **Pipeline: Atomic action packets (non-timed mode)**
- Add an `action_packet_id` derived from the inbound user message id.
- Services propagate it across stages.
- Outside timed events: only one final applied message should render + trigger NPC responses.
- Earlier variants are marked `superseded` and ignored by renderer/npc.

6) **Timed events exception (initiative mode)**
- When a timed event is active, allow multiple NPC outputs per round in initiative order.
- Still keep per-message idempotency: an NPC responds at most once per action packet.

7) **Clarification workflow**
- If intent is unknown or target missing for verbs that require it:
  - emit a `hint` message that asks a single clarifying question
  - do not generate multiple alternative actions


#### P0.1: Fix Working Memory Region Resolution ✅ COMPLETED
**Files Modified:**
- `src/interface_program/main.ts` - Use timed event ID as correlation_id
- `src/state_applier/main.ts` - Create working memory on-demand, search region files by coordinates

**Result:** Working memory now creates for all actions, not just timed events

#### P0.2: Fix Message Deduplication (NEXT)
**Priority:** HIGH  
**Effort:** 2 hours

**Problem:** 40% duplicate messages in outbox
**Solution:**
1. Add `append_outbox_message_deduped()` to outbox_store.ts
2. Use deterministic message IDs in state_applier
3. Filter duplicates in NPC AI polling
4. Clean outbox on startup

**Files to Modify:**
- `src/engine/outbox_store.ts` - Add dedup functions
- `src/state_applier/main.ts` - Use deterministic IDs
- `src/npc_ai/main.ts` - Filter duplicates

#### P0.3: Fix Conversation Threading (NEXT)
**Priority:** HIGH  
**Effort:** 2 hours

**Problem:** Multiple conversation IDs per interaction
**Solution:**
1. Create deterministic conversation ID generator (session + region + primary_npc)
2. Update interpreter AI to use consistent IDs
3. Update NPC AI to reuse existing conversations

**Files to Modify:**
- `src/conversation_manager/index.ts` - Add ID generator
- `src/interpreter_ai/main.ts` - Use consistent IDs
- `src/npc_ai/main.ts` - Reuse conversations

---

### PHASE 1: Region System Foundation (Week 1-2)
**Goal:** Solid region resolution for working memory and basic travel
**Dependencies:** Phase 0 complete

#### P1.1: Create Region Resolver Service
**Priority:** CRITICAL  
**Effort:** 4 hours

**New File:** `src/region_system/resolver.ts`

**Features:**
```typescript
class RegionResolver {
  // O(1) - Direct file access
  resolveById(region_id: string): RegionNode | null;
  
  // O(n) - Scan all region files (acceptable for 1000s)
  resolveByName(name: string): RegionNode | null;
  
  // O(n) - Match coordinates
  resolveByCoords(world_x, world_y, region_x, region_y): RegionNode | null;
  
  // Calculate target from direction
  resolveRelative(from_region_id: string, direction: CardinalDirection): RegionNode | null;
  
  // Find region matching actor location
  resolveByActorLocation(actor_ref: string): RegionNode | null;
}
```

**Implementation:**
- Search `local_data/data_slot_1/regions/` for matching files
- Parse region headers (id, name, world_coords) without loading full content
- Cache recently accessed regions in memory (LRU cache, max 100)
- Return null if not found (generation happens in Phase 4)

#### P1.2: Update Working Memory to Use Resolver
**Priority:** HIGH  
**Effort:** 2 hours

**File:** `src/state_applier/main.ts`

**Changes:**
- Replace `get_current_region()` with `resolver.resolveByActorLocation("actor.henry_actor")`
- Remove file scanning logic from state_applier
- Use resolver for all region lookups

**Benefit:** Centralized region resolution, consistent behavior

#### P1.3: Add Default/Biome Region Templates
**Priority:** MEDIUM  
**Effort:** 3 hours

**New Directory:** `src/region_system/templates/`

**Create 5-10 basic templates:**
- `forest_clearing.jsonc` - For forest areas
- `grassland_path.jsonc` - For open plains
- `mountain_pass.jsonc` - For mountain areas
- `settlement_edge.jsonc` - For town outskirts
- `river_bank.jsonc` - For water areas
- `cave_entrance.jsonc` - For underground
- `road_way.jsonc` - For roads between regions
- `wilderness.jsonc` - Generic fallback

**Template Structure:**
```jsonc
{
  "template_id": "forest_clearing",
  "biome": ["temperate", "boreal"],
  "terrain": "forest",
  "base_description": "A clearing in the forest...",
  "features": ["wildflowers", "fallen_log"],
  "travel_difficulty": 3,
  "speed_modifier": 0.75
}
```

**Purpose:** Provide fallback content when resolving regions that don't exist yet

---

### PHASE 2: Basic Travel System (Week 3-4)
**Goal:** Enable region-to-region travel with time calculation
**Dependencies:** Phase 1 complete

#### P2.1: Create Travel Engine Core
**Priority:** CRITICAL  
**Effort:** 6 hours

**New File:** `src/travel_system/engine.ts`

**Features:**
```typescript
class TravelEngine {
  // Calculate travel between adjacent regions
  calculateCardinalTravel(
    from_region_id: string,
    direction: CardinalDirection
  ): TravelStep;
  
  // Calculate time based on THAUMWORLD rules
  calculateTravelTime(
    regions_to_travel: number,
    party: Actor[]
  ): number;
  
  // Execute the travel
  async executeTravel(travel: TravelState): Promise<TravelResult>;
}
```

**Implementation Details:**
- **THAUMWORLD Travel Rules:**
  - Speed stat = number of world tiles per extended action
  - 1 world tile = 100 regions (10×10 grid)
  - Speed 3 = 300 regions of movement per extended action
  - Party moves at slowest member's speed
  - Extended action = full turn/action in combat/time system
  
```typescript
function calculateTravelTime(
  regions_to_travel: number,
  party: Actor[]
): number {
  // Find slowest speed in party
  const slowest_speed = Math.min(...party.map(a => a.stats.speed || 3));
  
  // Calculate how many extended actions needed
  // Speed 3 = 300 regions per extended action
  const regions_per_action = slowest_speed * 100; // 100 regions per world tile
  const actions_needed = Math.ceil(regions_to_travel / regions_per_action);
  
  // Convert to minutes (assume 1 extended action = 10 minutes for now)
  const minutes_per_action = 10;
  return actions_needed * minutes_per_action;
}
```

#### P2.2: Update MOVE Action for Inter-Region Travel
**Priority:** HIGH  
**Effort:** 4 hours

**File:** `src/rules_lawyer/effects.ts`

**Changes:**
- Detect if target is a region (starts with "region." or matches region ID)
- If inter-region: create travel plan instead of SET_OCCUPANCY
- Add SYSTEM.TRAVEL effect
- Calculate and add SYSTEM.ADVANCE_TIME effect

**Example:**
```typescript
if (target_type === "region") {
  const travel = travelEngine.planTravel(actor, from_region, target_region);
  effect_lines.push(`SYSTEM.TRAVEL(travel_id=${travel.id})`);
  effect_lines.push(`SYSTEM.ADVANCE_TIME(minutes=${travel.duration})`);
}
```

#### P2.3: Implement SET_OCCUPANCY for Location Updates
**Priority:** HIGH  
**Effort:** 3 hours

**File:** `src/state_applier/apply.ts`

**Implementation:**
- Update actor.location.world_tile
- Update actor.location.region_tile
- Update region.state.visited/visit_count
- Apply awareness tags to NPCs in new region
- Save actor and region files

#### P2.4: Add Exhaustion Tracking
**Priority:** MEDIUM  
**Effort:** 2 hours

**File:** `src/travel_system/engine.ts`

**Implementation:**
- Track hours without rest
- Track forced march hours
- Apply exhaustion levels (1-6)
- Modify actor stats based on exhaustion
- Save exhaustion state to actor file

**THAUMWORLD Rules:**
- Every 8 hours of forced march = +1 exhaustion
- Every 24 hours without rest = +1 exhaustion
- Level 3+: Disadvantage on ability checks
- Level 5+: Speed halved
- Level 6: Death

---

### PHASE 3: Travel Events (Week 5)
**Goal:** Make travel interesting with encounters and discoveries
**Dependencies:** Phase 2 complete

#### P3.1: Create Event System Framework
**Priority:** MEDIUM  
**Effort:** 4 hours

**New File:** `src/travel_system/events.ts`

**Features:**
- Event definitions (JSONC format)
- Condition checking (region type, terrain, danger level, time)
- Probability rolling
- Event execution with choices

**Example Events:**
- Bandit ambush (wilderness, 10% chance)
- Hidden shrine (forest, 5% chance)
- Weather change (any, 20% chance)
- Discovery of resource (varies by terrain)

#### P3.2: Integrate Events into Travel
**Priority:** MEDIUM  
**Effort:** 3 hours

**File:** `src/travel_system/engine.ts`

**Changes:**
- Roll for events at travel start
- Roll for events during travel (per hour)
- Pause travel for event resolution
- Resume after event completes

#### P3.3: Create 10-20 Base Events
**Priority:** LOW  
**Effort:** 4 hours

**New Directory:** `src/travel_system/events/`

**Event Types:**
- 5 combat encounters (bandits, wolves, etc.)
- 5 discoveries (shrine, abandoned camp, etc.)
- 5 obstacles (blocked path, river crossing, etc.)
- 5 environmental (weather, terrain difficulty, etc.)

---

### PHASE 4: Procedural Generation (Week 6-7)
**Goal:** Generate regions on-demand as players explore
**Dependencies:** Phase 3 complete

#### P4.1: Create Region Generator
**Priority:** HIGH  
**Effort:** 8 hours

**New File:** `src/region_system/generator.ts`

**Features:**
```typescript
class RegionGenerator {
  generateRegion(
    world_x: number, world_y: number,
    region_x: number, region_y: number,
    context: GenerationContext
  ): RegionNode;
  
  // Select template based on biome/terrain
  selectTemplate(biome: string, terrain: string): RegionTemplate;
  
  // Interpolate description from nearby regions
  interpolateDescription(
    new_region: RegionNode,
    nearby: RegionNode[]
  ): RegionDescription;
  
  // Generate exits for all directions
  generateExits(region: RegionNode): RegionExit[];
  
  // Save to disk
  saveRegion(region: RegionNode): void;
}
```

#### P4.2: Implement Biome/Terrain Determination
**Priority:** MEDIUM  
**Effort:** 3 hours

**New File:** `src/region_system/biomes.ts`

**Implementation:**
- Noise-based biome generation (Perlin/Simplex noise)
- Map world coordinates to biome types
- Temperature based on world_y (north/south)
- Elevation based on noise

**Biomes:**
- Polar (world_y < -100)
- Tundra (world_y -100 to -50)
- Temperate Forest (world_y -50 to 50)
- Desert (world_y 50 to 100)
- Tropical (world_y > 100)

#### P4.3: Integrate Generation into Resolver
**Priority:** HIGH  
**Effort:** 2 hours

**File:** `src/region_system/resolver.ts`

**Changes:**
- If resolveByCoords returns null, check if should generate
- Generate region on-demand
- Return generated region
- Save to `local_data/data_slot_1/regions/generated/`

**Generation Trigger:**
- Player attempts to travel to non-existent region
- Player looks in direction of non-existent region
- Any query for a region that doesn't exist yet

---

### PHASE 5: Advanced Features (Week 8+)
**Goal:** Polish and advanced mechanics
**Dependencies:** Phase 4 complete

#### P5.1: Region Connection Web (Beyond Cardinal)
**Priority:** MEDIUM  
**Effort:** 6 hours

**Feature:** Regions can connect to other regions within half a world tile
- Calculate distance between regions
- Create explicit exits for close regions
- Support "portal" or "path" exits that aren't cardinal

#### P5.2: Long-Distance Pathfinding
**Priority:** MEDIUM  
**Effort:** 4 hours

**Feature:** Find paths between distant regions
- A* pathfinding on region graph
- Calculate total travel time
- Show route to player
- Support waypoints

#### P5.3: Party Travel
**Priority:** LOW  
**Effort:** 4 hours

**Feature:** Multiple actors travel together
- Slowest actor determines speed
- Group exhaustion calculation
- Shared encounter rolls
- Split party mechanics

#### P5.4: Mounts and Vehicles
**Priority:** LOW  
**Effort:** 6 hours

**Feature:** Faster travel with mounts
- Mount stats (speed, endurance)
- Vehicle capacity and speed
- Mount exhaustion separate from rider
- Vehicle breakdown events

#### P5.5: Rest and Camping
**Priority:** LOW  
**Effort:** 4 hours

**Feature:** Rest during travel
- Find rest spots (regions with rest_spot: true)
- Camp in wilderness (lower rest quality)
- Recover exhaustion
- Camp encounter risks

---

## Immediate Action Plan (Next 48 Hours)

### Today: Complete Phase 0

**Hour 1-2:** Fix message deduplication
- [ ] Add `append_outbox_message_deduped()` to outbox_store.ts
- [ ] Update state_applier to use deterministic IDs
- [ ] Test: Send message, verify no duplicates

**Hour 3-4:** Fix conversation threading
- [ ] Add `generate_conversation_id()` to conversation_manager
- [ ] Update interpreter AI to use consistent IDs
- [ ] Update NPC AI to find existing conversations
- [ ] Test: Send 3 messages, verify single conversation

**Hour 5-6:** Test working memory with new fixes
- [ ] Boot game
- [ ] Send 3 messages
- [ ] Verify working_memory.jsonc is populated
- [ ] Verify no errors in logs

### Tomorrow: Start Phase 1

**Hour 1-2:** Create region resolver skeleton
- [ ] Create `src/region_system/resolver.ts`
- [ ] Implement resolveById()
- [ ] Implement resolveByCoords()

**Hour 3-4:** Integrate resolver with working memory
- [ ] Update state_applier to use resolver
- [ ] Remove old coordinate scanning code
- [ ] Test: Working memory creates with correct region

**Hour 5-6:** Create 3-5 basic region templates
- [ ] forest_clearing template
- [ ] grassland_path template
- [ ] settlement_edge template
- [ ] Test: Templates load correctly

---

## File Structure

```
src/
  region_system/
    resolver.ts           # Phase 1 - Region resolution
    generator.ts          # Phase 4 - Procedural generation
    biomes.ts             # Phase 4 - Biome determination
    templates/
      forest_clearing.jsonc
      grassland_path.jsonc
      mountain_pass.jsonc
      settlement_edge.jsonc
      river_bank.jsonc
      cave_entrance.jsonc
      road_way.jsonc
      wilderness.jsonc
  
  travel_system/
    engine.ts             # Phase 2 - Travel calculation
    events.ts             # Phase 3 - Event system
    events/               # Phase 3 - Event definitions
      bandit_ambush.jsonc
      hidden_shrine.jsonc
      weather_change.jsonc
      ...
    
    types.ts              # Shared types

local_data/
  data_slot_1/
    regions/
      handcrafted/        # Pre-written regions
        eden_crossroads.jsonc
        eden_commons.jsonc
        ...
      generated/          # Auto-generated regions
        0_0_0_0.jsonc
        0_0_0_1.jsonc
        ...
```

---

## Success Criteria by Phase

### Phase 0 Success
- [ ] Working memory populated for all actions
- [ ] Message duplication <5%
- [ ] Single conversation per interaction thread
- [ ] No critical errors in logs

### Phase 1 Success
- [ ] Can resolve any region by ID instantly
- [ ] Can resolve region by actor location
- [ ] Working memory uses correct region data
- [ ] Templates provide fallback content

### Phase 2 Success
- [ ] Can travel between existing regions
- [ ] Travel time calculated correctly (respects speeds)
- [ ] Actor location updates properly
- [ ] Exhaustion tracked and applied

### Phase 3 Success
- [ ] Random encounters during travel
- [ ] Discoveries found while traveling
- [ ] Events can interrupt travel
- [ ] Travel feels engaging, not instant

### Phase 4 Success
- [ ] New regions generate as player explores
- [ ] Generated regions blend with handcrafted
- [ ] Can explore infinitely
- [ ] Generation is fast (<1 second)

### Phase 5 Success
- [ ] Can travel long distances with pathfinding
- [ ] Regions connect in web (not just cardinal)
- [ ] Party travel works
- [ ] System handles 1000s of regions smoothly

---

## Risk Mitigation

### Risk: Performance with 1000s of Regions
**Mitigation:**
- Lazy loading (only load active regions)
- LRU cache (keep last 100 regions in memory)
- Async file operations
- Generate regions on-demand, don't pre-generate

### Risk: Generated Regions Feel Repetitive
**Mitigation:**
- 20-30 diverse templates
- Interpolation from nearby handcrafted regions
- Random variation in features
- Player can tell which regions are generated vs handcrafted

### Risk: Travel Takes Too Long (Player Boredom)
**Mitigation:**
- Events break up travel
- Discoveries reward exploration
- Can pause/cancel travel
- Text descriptions of journey
- Future: Visual map shows progress

### Risk: Data Corruption with Procedural Gen
**Mitigation:**
- Save to separate directory (generated/)
- Validate generated JSON before saving
- Backup handcrafted regions
- Can delete generated/ to reset

---

## Open Questions Remaining

1. **Region Density:** How many regions per world tile? (10x10 grid = 100?)
2. **Travel Visibility:** Do players see adjacent regions in descriptions?
3. **Backtracking:** Should travel back be faster (familiar path)?
4. **Time Scale:** 1 region = 1 hour? Or variable?
5. **NPC Travel:** Can NPCs travel between regions? How?

---

## Next Steps

**Option A: Continue with Phase 0 (Recommended)**
- Fix message deduplication now
- Fix conversation threading now
- Test working memory
- Then move to Phase 1

**Option B: Skip to Phase 1**
- Accept current working memory (partial fix)
- Start building region resolver
- May need to revisit working memory later

**Option C: Full System Now**
- Try to implement everything at once
- High risk, not recommended

**My Recommendation:** Complete Phase 0 first. The message system bugs are blocking proper testing of everything else. Once the pipeline is solid, building the travel system will be much easier.

**Ready to proceed with Phase 0 completion?**

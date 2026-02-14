# Region Loading and Travel System Plan

**Date:** 2026-02-06  
**Status:** 🔵 READY FOR IMPLEMENTATION  
**Priority:** High  
**File:** `docs/plans/2026_02_06_region_travel_system.md`

> **Dependencies:** Place system operational, actor location tracking working

---

## Overview

Implement region-to-region travel so players can move between different areas of the world. Currently players are stuck in their starting region. This system enables world exploration, quest progression, and dynamic gameplay.

**Core Principle:** Regions are connected nodes in a graph. Travel takes time and may trigger events.

---

## Current State Problem

From Feb 6 logs:
```
[1] Interpreter Matched place name word {
[1]   text: 'i move to the town square',
[1]   matched_word: 'town',
[1]   place_id: 'eden_crossroads_square'
}
[4] Renderer Out As you trudge through the mist-shrouded forest...
```

**Issue:** System detects travel intent but only renders narrative. No actual region change occurs.

---

## Region Architecture

### World Structure

```
World Grid (infinite)
├── World Tile (0, 0) - 10,000 x 10,000 tiles
│   ├── Region: Eden Crossroads (0, 0 within tile) - 1,000 x 1,000 tiles
│   │   ├── Place: Town Square [DEFAULT]
│   │   ├── Place: Grenda's Shop
│   │   └── Place: Whispering Woods Edge
│   ├── Region: Whispering Woods (1, 0) - 1,000 x 1,000 tiles
│   │   ├── Place: Forest Clearing [DEFAULT]
│   │   └── Place: Ancient Grove
│   └── Region: Stone Circle (0, 1) - 1,000 x 1,000 tiles
│       └── Place: Druid Circle [DEFAULT]
```

### Region Connections

Regions connect to adjacent regions:
- **Explicit paths:** Defined connections with travel time
- **Implicit adjacency:** Adjacent world tiles connect automatically
- **Special routes:** Roads reduce travel time, dangerous routes increase it

```typescript
interface RegionConnection {
  from_region_id: string;
  to_region_id: string;
  travel_time_minutes: number;  // In-game time
  travel_distance_tiles: number;
  path_type: 'road' | 'trail' | 'wilderness' | 'dangerous';
  encounter_chance: number;  // 0-1 chance of random encounter
  requirements?: {
    items?: string[];  // e.g., ['item.rope'] for cliff
    skills?: string[]; // e.g., ['skill.climbing']
  };
}

// Example connections
const EDEN_CONNECTIONS: RegionConnection[] = [
  {
    from_region_id: 'eden_crossroads',
    to_region_id: 'whispering_woods',
    travel_time_minutes: 15,
    travel_distance_tiles: 200,
    path_type: 'trail',
    encounter_chance: 0.1
  },
  {
    from_region_id: 'eden_crossroads',
    to_region_id: 'stone_circle',
    travel_time_minutes: 30,
    travel_distance_tiles: 400,
    path_type: 'road',
    encounter_chance: 0.05
  }
];
```

---

## Travel System Flow

### Phase 1: Initiate Travel

**Player input:**
- Type: `"travel to whispering woods"`
- UI: Click on adjacent region on world map
- Context: Walk to region edge in current place

**System checks:**
1. Is destination valid? (exists, connected)
2. Are requirements met? (items, skills)
3. Is party ready? (not in combat, not overloaded)

### Phase 2: Travel Time

**If travel time > 0:**
```
[Travel Event Created]
Type: TRAVEL
Duration: 15 minutes (in-game)
Start: Eden Crossroads
Destination: Whispering Woods
Progress: 0%
```

**During travel:**
- Time passes (game clock advances)
- Random encounter check every 5 minutes
- Player can cancel travel (return to start)
- Party moves as group (slowest member sets pace)

### Phase 3: Arrival

**On arrival:**
1. Load destination region
2. Place player in default place
3. Generate arrival narrative
4. Check for arrival events (NPCs present, weather, etc.)
5. Resume normal time flow

```
[Renderer Output]
"After a quarter hour of walking along the forest trail, 
 the trees grow denser and the path darker. You arrive at 
 the edge of the Whispering Woods. The air here smells of 
 moss and ancient magic."

[Current Location Updated]
Region: whispering_woods
Place: forest_clearing
Position: (15, 15)
```

---

## Implementation Components

### 1. Region Registry

**File:** `src/region_system/registry.ts`

```typescript
interface RegionDefinition {
  id: string;
  name: string;
  world_tile: { x: number; y: number };
  region_tile: { x: number; y: number };  // 0-9 within world tile
  description: string;
  places: PlaceDefinition[];
  default_place_id: string;
  connections: RegionConnection[];
  biome: string;
  danger_level: number;  // 1-10
  resources: string[];
}

class RegionRegistry {
  private regions: Map<string, RegionDefinition> = new Map();
  
  register(region: RegionDefinition) {
    this.regions.set(region.id, region);
  }
  
  get(region_id: string): RegionDefinition | undefined {
    return this.regions.get(region_id);
  }
  
  get_connections(from_region_id: string): RegionConnection[] {
    const region = this.regions.get(from_region_id);
    return region?.connections || [];
  }
  
  is_connected(from: string, to: string): boolean {
    const connections = this.get_connections(from);
    return connections.some(c => c.to_region_id === to);
  }
  
  get_travel_time(from: string, to: string): number {
    const connection = this.get_connections(from)
      .find(c => c.to_region_id === to);
    return connection?.travel_time_minutes || 0;
  }
}

export const region_registry = new RegionRegistry();
```

### 2. Travel Event System

**File:** `src/region_system/travel_events.ts`

```typescript
interface TravelEvent {
  id: string;
  type: 'TRAVEL';
  actor_id: string;
  party: string[];  // All actors traveling together
  from_region: string;
  to_region: string;
  start_time: Date;
  estimated_arrival: Date;
  progress_percent: number;
  status: 'preparing' | 'traveling' | 'paused' | 'completed' | 'cancelled';
  encounter_checks: number;
  completed_checks: number;
}

export async function initiate_travel(
  actor_id: string,
  to_region_id: string,
  data_slot: number
): Promise<TravelResult> {
  const actor = await load_actor(data_slot, actor_id);
  const from_region_id = actor.location.region_id;
  
  // Validate connection
  if (!region_registry.is_connected(from_region_id, to_region_id)) {
    return {
      success: false,
      error: 'NO_CONNECTION',
      message: `Cannot travel directly to ${to_region_id}. No path exists.`
    };
  }
  
  // Check requirements
  const connection = region_registry.get_connections(from_region_id)
    .find(c => c.to_region_id === to_region_id);
    
  if (connection?.requirements) {
    const can_travel = await check_requirements(
      actor, 
      connection.requirements
    );
    if (!can_travel.success) {
      return can_travel;
    }
  }
  
  // Create travel event
  const travel_time = connection?.travel_time_minutes || 15;
  const travel_event: TravelEvent = {
    id: generate_id(),
    type: 'TRAVEL',
    actor_id,
    party: [actor_id],  // TODO: Include followers
    from_region: from_region_id,
    to_region: to_region_id,
    start_time: new Date(),
    estimated_arrival: add_minutes(new Date(), travel_time),
    progress_percent: 0,
    status: 'traveling',
    encounter_checks: Math.ceil(travel_time / 5),
    completed_checks: 0
  };
  
  // Save travel event
  await save_travel_event(data_slot, travel_event);
  
  // Start travel processing
  process_travel_event(data_slot, travel_event);
  
  return {
    success: true,
    travel_event,
    message: `Traveling to ${to_region_id}. Estimated arrival: ${travel_time} minutes.`
  };
}

async function process_travel_event(
  data_slot: number,
  event: TravelEvent
) {
  while (event.status === 'traveling') {
    await sleep(5000);  // Check every 5 seconds real-time
    
    // Update progress
    const elapsed = Date.now() - event.start_time.getTime();
    const total = event.estimated_arrival.getTime() - event.start_time.getTime();
    event.progress_percent = Math.min(100, (elapsed / total) * 100);
    
    // Encounter check
    if (event.completed_checks < event.encounter_checks) {
      const should_encounter = await check_random_encounter(event);
      if (should_encounter) {
        await trigger_travel_encounter(data_slot, event);
        event.status = 'paused';
        await save_travel_event(data_slot, event);
        return;  // Travel paused for encounter
      }
      event.completed_checks++;
    }
    
    // Check completion
    if (event.progress_percent >= 100) {
      await complete_travel(data_slot, event);
      return;
    }
    
    await save_travel_event(data_slot, event);
  }
}
```

### 3. Region Loader

**File:** `src/region_system/loader.ts`

```typescript
export async function load_region(
  data_slot: number,
  region_id: string
): Promise<RegionInstance> {
  // Check if region data exists
  const region_path = get_region_path(data_slot, region_id);
  
  let region_data = await load_region_data(region_path);
  
  if (!region_data) {
    // Generate new region
    const definition = region_registry.get(region_id);
    if (!definition) {
      throw new Error(`Unknown region: ${region_id}`);
    }
    
    region_data = await generate_region(data_slot, definition);
    await save_region_data(region_path, region_data);
  }
  
  // Load places within region
  for (const place_def of region_data.places) {
    await load_place(data_slot, place_def.id);
  }
  
  return region_data;
}

async function generate_region(
  data_slot: number,
  definition: RegionDefinition
): Promise<RegionInstance> {
  // Generate procedural content based on biome
  const biome_generator = get_biome_generator(definition.biome);
  
  const places = definition.places.map(place_def => {
    return biome_generator.generate_place(place_def);
  });
  
  // Generate NPCs based on danger level and biome
  const npcs = biome_generator.generate_npcs(definition.danger_level);
  
  // Generate items/resources
  const items = biome_generator.generate_items(definition.resources);
  
  return {
    id: definition.id,
    schema_version: 1,
    definition,
    places,
    npcs,
    items,
    generated_at: new Date().toISOString(),
    visit_count: 0
  };
}
```

### 4. Interpreter Integration

**File:** `src/interface_program/main.ts` (interpreter_ai is archived in this build)

Update travel intent detection:

```typescript
// In message interpretation
if (intent.verb === 'MOVE' || intent.verb === 'TRAVEL') {
  // Check if destination is a region
  const region_match = extract_region_from_text(text);
  
  if (region_match) {
    const target_region = region_registry.get(region_match.region_id);
    
    if (target_region) {
      // Check if connected to current region
      const current_region = get_player_region(data_slot);
      
      if (region_registry.is_connected(current_region, target_region.id)) {
        // Create travel action instead of local move
        return {
          verb: 'TRAVEL',
          target_region: target_region.id,
          target_place: target_region.default_place_id,
          action_cost: 'EXTENDED',
          estimated_time: region_registry.get_travel_time(current_region, target_region.id)
        };
      } else {
        // Not connected - suggest path
        return {
          verb: 'TRAVEL',
          error: 'NOT_CONNECTED',
          message: `Cannot reach ${target_region.name} directly. ` +
                   `Try traveling to an intermediate region first.`,
          suggestions: find_path(current_region, target_region.id)
        };
      }
    }
  }
}
```

### 5. UI Integration

**File:** `src/interface_program/world_map.ts`

```typescript
// World map showing regions
interface WorldMapProps {
  current_region: string;
  discovered_regions: string[];
  connections: RegionConnection[];
}

function render_world_map(props: WorldMapProps) {
  return `
    ┌─────────────────────────────┐
    │      WORLD MAP              │
    ├─────────────────────────────┤
    │                             │
    │  [?] Whispering Woods       │
    │      ↑                      │
    │  [★] Eden Crossroads ← You  │
    │      ↓                      │
    │  [?] Stone Circle           │
    │                             │
    │  [?] = Undiscovered         │
    │  [★] = Current Location     │
    │                             │
    └─────────────────────────────┘
    
    Click a region to travel there.
  `;
}

// Click handler
async function on_region_click(region_id: string) {
  const current = get_player_region();
  
  if (region_id === current) {
    show_message("You are already here.");
    return;
  }
  
  if (!region_registry.is_connected(current, region_id)) {
    show_message("No direct path to this region.");
    return;
  }
  
  const travel_time = region_registry.get_travel_time(current, region_id);
  const confirmed = await confirm_dialog(
    `Travel to ${region_id}?`,
    `Estimated travel time: ${travel_time} minutes`
  );
  
  if (confirmed) {
    await initiate_travel('actor.henry_actor', region_id, data_slot);
  }
}
```

---

## Implementation Phases

### Phase 1: Region Registry (2 days)
- [ ] Create RegionRegistry class
- [ ] Define Eden Crossroads connections
- [ ] Load/save region definitions
- [ ] Validation: Region connections work

### Phase 2: Travel Event System (2 days)
- [ ] Create TravelEvent structure
- [ ] Implement initiate_travel()
- [ ] Process travel events over time
- [ ] Handle travel completion

### Phase 3: Region Loader (2 days)
- [ ] Load existing regions
- [ ] Generate new regions procedurally
- [ ] Biome-based content generation
- [ ] NPC/item placement

### Phase 4: Interpreter Updates (1 day)
- [ ] Detect travel intent
- [ ] Check region connections
- [ ] Create TRAVEL action type
- [ ] Suggest paths when not connected

### Phase 5: UI Integration (2 days)
- [ ] World map display
- [ ] Region click handlers
- [ ] Travel progress UI
- [ ] Arrival notifications

### Phase 6: Testing (1 day)
- [ ] Travel between connected regions
- [ ] Attempt travel to unconnected region
- [ ] Cancel travel mid-way
- [ ] Verify NPCs/Items in new region

---

## Sample Regions

### Eden Crossroads (Starting Region)
```typescript
{
  id: 'eden_crossroads',
  name: 'Eden Crossroads',
  world_tile: { x: 0, y: 0 },
  region_tile: { x: 0, y: 0 },
  description: 'A peaceful crossroads where travelers meet.',
  biome: 'grassland',
  danger_level: 1,
  places: [
    { id: 'eden_crossroads_square', name: 'Town Square', default: true },
    { id: 'eden_crossroads_grendas_shop', name: "Grenda's Shop" },
    { id: 'eden_crossroads_tavern', name: 'The Wandering Bard Tavern' }
  ],
  default_place_id: 'eden_crossroads_square',
  connections: [
    { to: 'whispering_woods', time: 15, type: 'trail' },
    { to: 'stone_circle', time: 30, type: 'road' }
  ]
}
```

### Whispering Woods
```typescript
{
  id: 'whispering_woods',
  name: 'Whispering Woods',
  world_tile: { x: 1, y: 0 },
  region_tile: { x: 0, y: 0 },
  description: 'Ancient forest filled with mystery and magic.',
  biome: 'forest',
  danger_level: 3,
  places: [
    { id: 'whispering_woods_clearing', name: 'Forest Clearing', default: true },
    { id: 'whispering_woods_grove', name: 'Ancient Grove' },
    { id: 'whispering_woods_stream', name: 'Babbling Brook' }
  ],
  default_place_id: 'whispering_woods_clearing',
  connections: [
    { to: 'eden_crossroads', time: 15, type: 'trail' },
    { to: 'shadowmere', time: 45, type: 'wilderness' }
  ]
}
```

---

## Success Criteria

- [ ] Player can travel from Eden Crossroads to Whispering Woods
- [ ] Travel takes estimated time (15 minutes)
- [ ] Region loads with correct places and NPCs
- [ ] Player appears in default place of new region
- [ ] World map shows discovered regions
- [ ] Attempting unconnected travel gives helpful error
- [ ] Travel can be cancelled
- [ ] Arrival generates appropriate narrative

---

**Document:** Region Loading and Travel System Plan  
**Location:** `docs/plans/2026_02_06_region_travel_system.md`  
**Estimated Time:** 10 days  
**Last Updated:** February 6, 2026

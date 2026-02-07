# Place System Implementation Plan

**Date:** 2026-02-02  
**Status:** 🟡 IN PROGRESS - Phases 1-2 implemented, Phases 3-8 pending  
**Priority:** High - Core Architecture  
**File:** `docs/plans/PLACE_SYSTEM_PLAN.md`

> **NOTE:** Current canonical place system architecture. Implementation partially complete.

---

## Overview

The Place system partitions Regions into smaller, interactive areas (like rooms, chambers, or zones). This enables granular positioning, local awareness, and realistic travel within regions.

### Current Architecture
```
World Tile (x,y) → Region (0-9, 0-9 within tile) → [Entities scattered]
```

### New Architecture
```
World Tile (x,y) → Region (0-9, 0-9) → Places (graph of rooms/areas) → Tiles (2.5ft grid)
                                                                                ↓
                                                                      NPCs/Actors positioned on tiles
```

---

## Core Concepts

### 1. Place
**Definition:** A bounded area within a region where interactions are local

**Characteristics:**
- Abstract node in a graph structure
- Represents a room, chamber, or defined area
- Contains a tile grid (approx 20-40 tiles across for typical rooms)
- Has connections to other places (within same region or to other regions)
- Has a default entry point (coordinates for arriving travelers)
- Can be public or private
- Has environmental properties (lighting, cover, terrain type)

**Examples:**
- Tavern common room
- Tavern kitchen
- Tavern private room #3
- Town square
- Church nave
- Church basement
- Smithy workshop
- Alleyway behind buildings

### 2. Tile Grid
**Definition:** Positional grid within a place

**Characteristics:**
- 2.5 feet per tile (allows detailed positioning)
- Typical room: 20x20 tiles (50ft x 50ft)
- Large hall: 40x40 tiles (100ft x 100ft)
- Small room: 10x10 tiles (25ft x 25ft)
- Coordinates: (x, y) relative to place origin
- Supports future tilesets (graphics, detailed terrain)

### 3. World Tile Enhancement
**3D Volume Concept:**
- World tiles now include vertical dimension
- **Above:** Half a world tile up (air, flying, elevated positions)
- **Surface:** Ground level (walking, standing)
- **Below:** Half a world tile down (basements, caves, underground)
- Allows multi-level regions and places

### 4. Biome Presets
**Definition:** Pre-configured world tiles with default places

**Characteristics:**
- Applied to regionless world tiles
- Contains default place layouts
- Examples: forest campsite, roadside clearing, cave entrance, mountain pass
- Provides consistent encounters in wilderness

---

## Data Structures

### Place Schema
```typescript
type Place = {
  schema_version: 1,
  id: string,                    // "eden_crossroads_tavern_common"
  name: string,                  // "The Singing Sword - Common Room"
  region_id: string,             // "eden_crossroads"
  
  // Position in region's place graph
  coordinates: {
    world_tile: { x: number, y: number },
    region_tile: { x: number, y: number },  // Region coords
    elevation: number            // 0=surface, +1=above, -1=below
  },
  
  // Tile grid dimensions
  tile_grid: {
    width: number,               // tiles across
    height: number,              // tiles deep
    default_entry: { x: number, y: number }  // Where arrivals appear
  },
  
  // Place graph connections
  connections: PlaceConnection[],
  
  // Environmental properties
  environment: {
    lighting: "bright" | "dim" | "dark",
    terrain: string,             // "wooden_floor", "cobblestone", "dirt"
    cover_available: string[],   // ["tables", "pillars", "bar"]
    temperature_offset: number   // +/- from region base
  },
  
  // Contents tracking
  contents: {
    npcs_present: PlaceNPC[],
    actors_present: PlaceActor[],
    items_on_ground: PlaceItem[],
    features: PlaceFeature[]     // Tables, doors, fireplaces
  },
  
  // Metadata
  is_public: boolean,            // Can random travelers enter?
  is_default: boolean,           // Is this the region's default place?
  max_occupancy?: number,        // Soft limit for realism
  description: {
    short: string,
    full: string,
    sensory: {
      sight: string[],
      sound: string[],
      smell: string[],
      touch: string[]
    }
  }
}

type PlaceConnection = {
  target_place_id: string,       // "eden_crossroads_tavern_kitchen"
  target_region_id?: string,     // If different region
  direction: string,             // "north", "up", "through_door"
  travel_time_seconds: number,   // Usually 0 for same region
  requires_key?: boolean,
  is_hidden?: boolean,
  description: string            // "A wooden door leads to the kitchen"
}

type PlaceNPC = {
  npc_ref: string,               // "npc.gunther"
  tile_position: { x: number, y: number },
  status: "present" | "moving" | "busy",
  activity: string               // "sitting at the bar"
}
```

### Region Schema Updates
```typescript
type Region = {
  // ... existing fields ...
  
  // Place system
  places: {
    list: string[],              // IDs of places in this region
    default_place_id: string,    // Where new arrivals go
    graph: PlaceGraph            // Connections between places
  },
  
  // Quick reference (denormalized for performance)
  npc_locations: {               // Quick lookup: npc_id → place_id
    [npc_id: string]: string
  },
  actor_locations: {             // Quick lookup: actor_id → place_id
    [actor_id: string]: string
  }
}

type PlaceGraph = {
  nodes: string[],               // place_ids
  edges: {
    from: string,
    to: string,
    direction: string,
    travel_time: number
  }[]
}
```

### Actor/NPC Schema Updates
```typescript
type Actor = {
  // ... existing fields ...
  
  location: {
    world_tile: { x: number, y: number },
    region_tile: { x: number, y: number },
    place_id: string,            // NEW: Required field
    tile: { x: number, y: number },
    elevation: number
  }
}
```

### Reference Format Updates
```
place.<region_id>.<place_id>           → place.eden_crossroads.tavern_common
place_tile.<region_id>.<place_id>.x.y  → place_tile.eden_crossroads.tavern_common.5.10
```

---

## Implementation Phases

### Phase 1: Foundation & Storage
**Goal:** Create place data structure and storage system

**Tasks:**
1. **Create Place Type Definitions** (`src/types/place.ts`)
   - Define Place, PlaceConnection, PlaceNPC types
   - Add to MessageEnvelope for pipeline support

2. **Create Place Storage** (`src/place_storage/store.ts`)
   ```typescript
   export function load_place(slot: number, place_id: string): PlaceResult
   export function save_place(slot: number, place: Place): string
   export function list_places_in_region(slot: number, region_id: string): string[]
   export function ensure_place_exists(slot: number, place_config: PlaceConfig): PlaceResult
   ```

3. **Create Place Directory Structure**
   ```
   local_data/data_slot_1/
   └── places/
       ├── eden_crossroads_tavern_common.jsonc
       ├── eden_crossroads_tavern_kitchen.jsonc
       ├── eden_crossroads_square.jsonc
       └── ...
   ```

4. **Update Region Storage**
   - Add `places` field to Region schema
   - Add place graph to region file
   - Migration: Create default place for existing regions

**Acceptance Criteria:**
- Can create, load, save places
- Places are stored in separate files
- Regions reference places correctly

---

### Phase 2: Reference Resolution & Data Broker
**Goal:** Enable place references in the pipeline

**Tasks:**
1. **Update Reference Resolver** (`src/reference_resolver/resolver.ts`)
   - Add "place" reference type
   - Resolve `place.<region>.<id>` format
   - Resolve `place_tile.<region>.<place>.x.y` format
   - Load place data for context

2. **Update Data Broker Commands**
   - Add `PLACE` verb for place interactions
   - Add `MOVE` command with place targets
   - Support place_tile coordinates in INSPECT

3. **Create Place Utility Functions** (`src/place_storage/utils.ts`)
   ```typescript
   export function get_npc_place_id(slot: number, npc_id: string): string | null
   export function get_actor_place_id(slot: number, actor_id: string): string | null
   export function move_entity_to_place(
     slot: number, 
     entity_ref: string, 
     target_place_id: string,
     target_tile?: { x: number, y: number }
   ): boolean
   export function get_nearby_entities_in_place(
     slot: number,
     place_id: string,
     center_tile: { x: number, y: number },
     radius_tiles: number
   ): EntityRef[]
   ```

**Acceptance Criteria:**
- Can reference places in commands
- Data broker resolves place references
- Can query entity locations

---

### Phase 3: NPC AI & Awareness
**Goal:** NPCs operate within places, react to local events

**Tasks:**
1. **Update NPC Location Format**
   - Add `place_id` to all NPC files
   - Migration script: Assign NPCs to default places

2. **Update NPC Detection** (`src/npc_ai/main.ts`)
   - Filter by place: NPCs only detect events in their place
   - Add proximity detection: NPCs react to nearby tiles
   - Eavesdropping: NPCs can hear from adjacent tiles
   ```typescript
   function get_nearby_npcs_in_place(
     slot: number,
     place_id: string,
     center_tile: { x: number, y: number },
     awareness_radius: number
   ): NPC[]
   ```

3. **Update NPC Movement**
   - NPCs can move within place (tile to tile)
   - NPCs can move between connected places
   - Pathfinding for NPCs (simple: follow connections)

4. **Update Working Memory**
   - Track place_id in working memory
   - Filter memories by place for NPC context
   - "Remember what happened in this room"

**Acceptance Criteria:**
- Gunther in tavern common room doesn't react to events in kitchen
- Grenda in her shop doesn't hear whispers in the square
- NPCs react to adjacent conversations (eavesdropping)

---

### Phase 4: Travel System
**Goal:** Realistic movement between places and regions

**Tasks:**
1. **Enhance MOVE Command**
   ```typescript
   // Within place (tile movement)
   actor.henry_actor.MOVE(target=place_tile.eden_crossroads.tavern_common.10.15)
   
   // Between places (same region)
   actor.henry_actor.MOVE(target=place.eden_crossroads.tavern_kitchen)
   
   // Between regions (travel)
   actor.henry_actor.MOVE(target=region_tile.0.0.1.0)  // To adjacent region
   ```

2. **Create Place Travel System** (`src/travel/place_travel.ts`)
   ```typescript
   export function can_travel_to_place(
     slot: number,
     entity_ref: string,
     target_place_id: string
   ): { ok: boolean; reason?: string }
   
   export function execute_place_travel(
     slot: number,
     entity_ref: string,
     target_place_id: string
   ): TravelResult
   
   export function get_travel_description(
     from_place_id: string,
     to_place_id: string
   ): string
   ```

3. **Update Rules Lawyer** (`src/rules_lawyer/effects.ts`)
   - MOVE effects update place_id and tile coordinates
   - Travel time calculation for regional moves
   - Obstruction detection (locked doors, etc.)

4. **Update Renderer AI**
   - Generate travel narratives for place-to-place movement
   - Describe entering new places
   - Contextual travel descriptions

**Acceptance Criteria:**
- Can walk around within a place (tile movement)
- Can move between connected places
- Can travel between regions (with time passage)
- Travel narratives are generated

---

### Phase 5: Region Migration & Biomes
**Goal:** Update existing regions, create biome system

**Tasks:**
1. **Migration Script** (`scripts/migrate_to_places.js`)
   - Create default place for each existing region
   - Move NPCs to default places
   - Update actor locations
   - Preserve existing conversations/memories

2. **Update Region Definitions**
   - Eden Crossroads: Square, Tavern (common, kitchen, rooms), Shop
   - Eden Whispering Woods: Campsite, Stream, Grove
   - Eden Stone Circle: Circle center, Hillside
   - Eden Commons: Green, Well, Meeting hall

3. **Create Biome System** (`src/biome_system/`)
   ```typescript
   type Biome = {
     id: string,
     name: string,
     world_tile_tags: string[],
     default_places: PlaceTemplate[],
     random_encounters: EncounterTable
   }
   ```

4. **Biome Presets**
   - Forest: Campsite, Hunting ground, Stream, Glade
   - Mountain: Pass, Cave entrance, Summit, Ledge
   - Plains: Roadside, Field, Farmstead
   - Swamp: Dry ground, Sinking area, Island

**Acceptance Criteria:**
- All existing regions have places
- NPCs are in appropriate places
- Traveling to regionless tiles uses biome defaults

---

### Phase 6: Enhanced Awareness & Perception
**Goal:** Granular detection based on position

**Tasks:**
1. **Line of Sight System**
   - Obstacles block awareness (walls, doors)
   - Cover reduces visibility
   - Lighting affects perception distance

2. **Sound System**
   - Sound travels through places (shouting heard farther)
   - Doors/walls muffle sound
   - Silent actions vs noisy actions

3. **Awareness Radius**
   ```typescript
   type AwarenessConfig = {
     sight_radius_tiles: number,      // How far can see
     hearing_radius_tiles: number,    // How far can hear
     shout_radius_tiles: number       // How far shouts travel
   }
   ```

4. **Update State Applier**
   - COMMUNICATE generates sound events
   - ATTACK generates noise
   - SNEAK reduces noise footprint

**Acceptance Criteria:**
- Can't see around corners
- Shouting attracts distant attention
- Sneaking avoids detection
- Closed doors block line of sight

---

### Phase 7: Tile System Foundation
**Goal:** Framework for future tile graphics

**Tasks:**
1. **Tile Type Definitions** (`src/types/tiles.ts`)
   ```typescript
   type TileType = {
     id: string,
     name: string,
     is_walkable: boolean,
     is_transparent: boolean,
     movement_cost: number,
     graphics_id?: string  // Future: reference to tileset
   }
   ```

2. **Place Tile Maps**
   ```typescript
   type PlaceTileMap = {
     place_id: string,
     tiles: TileType[][],  // 2D grid
     width: number,
     height: number
   }
   ```

3. **Pathfinding** (`src/pathfinding/a_star.ts`)
   - A* pathfinding within places
   - Respect walkable tiles
   - Used for NPC movement
   - Future: Used for click-to-move

4. **Storage Schema** (Non-breaking)
   - Tile map stored separately from place (place_tiles/)
   - Place can exist without tile map (abstract mode)
   - Gradual migration path

**Acceptance Criteria:**
- Can define tile types
- Can create tile maps for places
- NPCs pathfind around obstacles
- Framework ready for graphics layer

---

### Phase 8: Integration & Polish
**Goal:** Full system integration, testing, documentation

**Tasks:**
1. **Update All Services**
   - Interface: Show place name in UI
   - Interpreter: Understand place references
   - Renderer: Describe places and travel
   - NPC AI: Full place awareness

2. **Update Documentation**
   - PLACE_SYSTEM.md
   - Update ARCHITECTURE.md diagrams
   - Update MACHINE_TEXT_SYNTAX.md
   - Migration guide for developers

3. **Testing Suite**
   - Place creation/loading
   - Entity movement
   - NPC awareness boundaries
   - Travel between places/regions
   - Performance with 100+ places

4. **Performance Optimization**
   - Cache place lookups
   - Lazy load place data
   - Optimize proximity queries

**Acceptance Criteria:**
- All existing functionality works with places
- Performance acceptable
- Documentation complete
- Migration successful

---

## Technical Considerations

### Storage Strategy

**File Structure:**
```
local_data/data_slot_1/
├── places/
│   ├── eden_crossroads_square.jsonc
│   ├── eden_crossroads_tavern_common.jsonc
│   └── ...
├── place_tiles/                    # Phase 7
│   ├── eden_crossroads_tavern_common_tiles.jsonc
│   └── ...
├── regions/
│   └── eden_crossroads.jsonc       # References places
└── ...
```

**Performance:**
- Places loaded on-demand
- Region stores place_id list (not full data)
- NPC location cached in region for quick lookup
- Working memory stores current place_id

### Migration Strategy

**Backward Compatibility:**
1. Phase 1-2: Add place system alongside existing region system
2. Phase 3-5: Migrate existing data with migration script
3. Phase 6-8: Deprecate old location format
4. Final: Remove backward compatibility code

**Migration Script:**
```javascript
// For each region:
// 1. Create default place from region data
// 2. Move NPCs to default place
// 3. Update NPC location format
// 4. Preserve memories/conversations
```

### Reference Updates

**New Reference Types:**
- `place.<region_id>.<place_id>`
- `place_tile.<region_id>.<place_id>.<x>.<y>`
- `place_connection.<place_id>.<direction>`

**Resolver Updates:**
- Resolve place references to place data
- Resolve place_tile to tile coordinates
- Support place-relative positioning

---

## Benefits

### Gameplay
- **Realistic positioning:** Characters have actual locations
- **Local interactions:** Conversations happen in specific rooms
- **Stealth gameplay:** Hide behind cover, sneak past guards
- **Exploration:** Discover hidden places, secret passages
- **Atmosphere:** Places have distinct environmental qualities

### Technical
- **Scalability:** Can have 100+ places per region
- **Performance:** Only load relevant places
- **Flexibility:** Easy to add new places
- **Extensibility:** Tile system ready for graphics

### Narrative
- **Contextual responses:** NPCs react to local events
- **Spatial memory:** "I saw you in the tavern yesterday"
- **Environmental storytelling:** Each place tells a story
- **Dynamic encounters:** Based on place properties

---

## Risks & Mitigations

### Risk: Complex Migration
**Mitigation:** Gradual migration with backward compatibility

### Risk: Performance Issues
**Mitigation:** Caching, lazy loading, proximity-based updates

### Risk: Breaking Existing Saves
**Mitigation:** Comprehensive migration script, data validation

### Risk: Over-complication
**Mitigation:** Start simple, add complexity incrementally

---

## Success Criteria

1. ✅ Can create places within regions
2. ✅ NPCs positioned in specific places
3. ✅ NPCs only react to local events
4. ✅ Can travel between places
5. ✅ Can move within places (tile-level)
6. ✅ Travel generates appropriate narratives
7. ✅ All existing content migrated successfully
8. ✅ Performance remains acceptable
9. ✅ Documentation complete
10. ✅ Ready for tile graphics (Phase 7)

---

## Timeline Estimate

**Phase 1:** 2-3 days (Foundation)  
**Phase 2:** 2-3 days (References)  
**Phase 3:** 3-4 days (NPC AI)  
**Phase 4:** 3-4 days (Travel)  
**Phase 5:** 2-3 days (Migration)  
**Phase 6:** 3-4 days (Awareness)  
**Phase 7:** 2-3 days (Tiles)  
**Phase 8:** 3-4 days (Integration)  

**Total:** ~20-28 days of development  
**Testing & Polish:** +5-7 days  
**Documentation:** +2-3 days  

**Estimated Total:** 4-5 weeks for complete implementation

---

## Next Steps

1. **Review this plan** - Any adjustments needed?
2. **Prioritize phases** - Which are most critical?
3. **Begin Phase 1** - Create type definitions and storage
4. **Create migration strategy** - How to handle existing data?

Ready to begin implementation when you are!

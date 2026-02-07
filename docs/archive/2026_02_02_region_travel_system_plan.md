# THAUMWORLD Region Travel System - Plan B
**Version:** 1.0  
**Date:** February 2, 2026  
**Status:** Planning Phase  
**Scope:** Comprehensive region travel, procedural generation, and node-based navigation

---

## Executive Summary

### Vision
Transform THAUMWORLD into a seamless open-world experience where players travel region-to-region through a node-based graph system. Support 1000s of regions with procedural generation, instant ID-based lookups, and immersive travel mechanics that respect tabletop RPG pacing.

### Core Principles
1. **Regions as Nodes** - Each region is a node in a travel graph
2. **Implicit + Explicit Paths** - Cardinal directions create automatic connections, regions can override with custom exits
3. **Travel Takes Time** - All inter-region movement routes through a travel system that calculates time, triggers events
4. **Procedural Generation** - New regions generated on-demand as players explore, interpolating from pre-written templates
5. **Tabletop Pacing** - Travel respects action economy, exhaustion, and narrative flow

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    REGION TRAVEL SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Resolver   │───▶│   Registry   │───▶│   Loader     │      │
│  │   Service    │    │   (Dynamic)  │    │   Service    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  ID Lookup   │    │  Name Search │    │  Coordinate  │      │
│  │  (Instant)   │    │  (Scan)      │    │  Matching    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    TRAVEL ENGINE                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │  Path    │  │  Time    │  │  Event   │  │  State   │  │  │
│  │  │  Finder  │  │  Calc    │  │  Manager │  │  Machine │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              PROCEDURAL GENERATOR                         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ Template │  │  Noise   │  │  Content │  │  Exit    │  │  │
│  │  │ Selector │  │  Gen     │  │  Weaver  │  │  Planner │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Travel Request:**
1. Player issues command: "walk north" or "travel to Eden Commons"
2. **Resolver** identifies current region and target
3. **Travel Engine** calculates path, time, events
4. **State Machine** manages travel phases (departure → journey → arrival)
5. **Event Manager** triggers encounters, discoveries, obstacles
6. **Procedural Generator** creates regions if target doesn't exist

---

## Data Structures

### Region Node Schema

```typescript
interface RegionNode {
  // Identity
  id: string;                    // Unique ID (e.g., "eden_crossroads")
  name: string;                  // Display name
  canonical_name: string;        // Normalized for searching
  
  // Location
  world_coords: {
    world_x: number;            // World tile X (-∞ to +∞)
    world_y: number;            // World tile Y (-∞ to +∞)
    region_x: number;           // Region grid X (0-9 within world tile)
    region_y: number;           // Region grid Y (0-9 within world tile)
  };
  
  // Graph Connections
  exits: RegionExit[];          // Explicit custom exits
  implicit_exits: boolean;      // Allow cardinal direction travel?
  
  // Content
  region_type: RegionType;      // settlement, wilderness, dungeon, etc.
  template_id: string;          // For procedural generation
  description: RegionDescription;
  features: Feature[];
  contents: RegionContents;
  
  // State
  state: {
    discovered: boolean;
    visited: boolean;
    visit_count: number;
    last_visited: string;       // ISO timestamp
    danger_level: number;       // 0-10, affects encounters
    rest_spot: boolean;         // Can rest here?
    generated: boolean;         // Was this procedurally generated?
    generation_seed: string;    // For reproducible generation
  };
  
  // Travel metadata
  travel: {
    base_difficulty: number;    // Terrain difficulty 0-10
    speed_modifier: number;     // Multiplier (0.5 = slow, 2.0 = fast)
    encounter_rate: number;     // Chance per hour
    rest_quality: number;       // How good is resting here (0-10)
  };
}

interface RegionExit {
  direction: CardinalDirection | string;  // "north", "northeast", "portal", "path"
  target_region: string;                  // Region ID
  target_world_coords?: WorldCoords;      // For implicit generation
  
  // Travel properties
  distance: number;                       // In region-units (default: 1)
  terrain_difficulty: number;             // 0-10
  travel_time_minutes: number;            // Base time
  
  // State
  blocked: boolean;
  blocked_reason?: string;
  key_required?: string;
  hidden: boolean;
  hidden_dc?: number;                     // Perception DC to find
  
  // Description
  description: string;                    // What players see
  discovery_text?: string;                // Text when discovered
  
  // Events
  on_travel_start?: string[];             // Event IDs to trigger
  on_travel_end?: string[];
  on_discover?: string[];
}

type CardinalDirection = "north" | "northeast" | "east" | "southeast" | 
                         "south" | "southwest" | "west" | "northwest";

type RegionType = "settlement" | "wilderness" | "dungeon" | "building" | 
                  "outdoor" | "cave" | "water";
```

### Travel State Machine

```typescript
interface TravelState {
  // Identity
  travel_id: string;            // Unique travel instance
  actor_ref: string;            // Who is traveling
  
  // Route
  path: TravelStep[];           // Ordered list of steps
  current_step: number;         // Index in path
  
  // Timing
  start_time: string;           // ISO timestamp
  estimated_duration: number;   // Total minutes
  elapsed_minutes: number;      // Progress
  
  // State
  status: TravelStatus;         // preparing | traveling | paused | arrived | interrupted
  pace: TravelPace;             // careful | normal | fast | forced
  
  // Conditions
  stealth_mode: boolean;        // Trying to avoid encounters?
  carrying_capacity: number;    // Current encumbrance
  party_members: string[];      // Others traveling together
  
  // Events
  scheduled_events: ScheduledEvent[];
  completed_events: string[];
}

interface TravelStep {
  from_region: string;
  to_region: string;
  exit_used: string;            // Exit direction/ID
  
  // Calculated
  distance: number;             // Region-units
  base_time: number;            // Minutes at normal pace
  actual_time: number;          // Minutes with modifiers
  
  // Events
  encounters: Encounter[];      // What happens on this leg
  discoveries: Discovery[];     // Things found during travel
}

type TravelStatus = "preparing" | "traveling" | "paused" | "arrived" | "interrupted";

type TravelPace = "careful" | "normal" | "fast" | "forced";
```

---

## Resolver Service (Plan B)

### Multi-Strategy Resolution

```typescript
class RegionResolver {
  // Strategy 1: ID Lookup (Instant)
  resolveById(region_id: string): RegionNode | null {
    const path = `regions/${region_id}.jsonc`;
    if (fileExists(path)) {
      return loadRegionFile(path);
    }
    return null;
  }
  
  // Strategy 2: Name Search (Linear Scan)
  resolveByName(name: string): RegionNode | null {
    const canonical = normalizeName(name);
    const regions = listAllRegionFiles();
    
    for (const file of regions) {
      const region = loadRegionFile(file);
      if (region.canonical_name === canonical) {
        return region;
      }
    }
    return null;
  }
  
  // Strategy 3: Coordinate Match (Spatial)
  resolveByCoords(world_x: number, world_y: number, 
                  region_x: number, region_y: number): RegionNode | null {
    // Try exact match first
    const exact = findRegionByCoords(world_x, world_y, region_x, region_y);
    if (exact) return exact;
    
    // Generate if within exploration bounds
    if (shouldGenerateRegion(world_x, world_y, region_x, region_y)) {
      return generateRegion(world_x, world_y, region_x, region_y);
    }
    
    return null;
  }
  
  // Strategy 4: Relative Direction (Travel)
  resolveRelative(from_region_id: string, 
                  direction: CardinalDirection): RegionNode | null {
    const from = this.resolveById(from_region_id);
    if (!from) return null;
    
    // Check explicit exits first
    const explicit = from.exits.find(e => e.direction === direction);
    if (explicit) {
      return this.resolveById(explicit.target_region) || 
             this.generateTargetRegion(explicit);
    }
    
    // Use implicit cardinal travel
    if (from.implicit_exits !== false) {
      const targetCoords = calculateCardinalCoords(
        from.world_coords, direction
      );
      return this.resolveByCoords(
        targetCoords.world_x, targetCoords.world_y,
        targetCoords.region_x, targetCoords.region_y
      );
    }
    
    return null;
  }
  
  // Main entry point - tries all strategies
  resolve(query: RegionQuery): RegionNode | null {
    if (query.id) return this.resolveById(query.id);
    if (query.name) return this.resolveByName(query.name);
    if (query.coords) return this.resolveByCoords(
      query.coords.world_x, query.coords.world_y,
      query.coords.region_x, query.coords.region_y
    );
    if (query.from_region && query.direction) {
      return this.resolveRelative(query.from_region, query.direction);
    }
    return null;
  }
}
```

### Performance Characteristics

| Lookup Type | Time Complexity | Use Case |
|-------------|----------------|----------|
| ID | O(1) - direct file access | Runtime references, saved data |
| Name | O(n) - scan all regions | Player commands, fuzzy matching |
| Coordinates | O(n) - scan all regions | Spatial queries, procedural gen |
| Relative | O(1) + O(n) | Travel commands |

**Optimization for 1000s of regions:**
- ID lookups remain O(1) - direct file access
- Name/coordinate scans can be parallelized
- Consider lazy-loading region metadata (only load headers)
- Cache recently accessed regions in memory

---

## Travel Engine

### Path Finding

```typescript
class TravelEngine {
  // Find path between two regions
  findPath(from: string, to: string, options: PathOptions): TravelPath {
    // Use A* or Dijkstra on region graph
    const graph = this.buildRegionGraph();
    const path = aStar(graph, from, to, {
      heuristic: this.distanceHeuristic,
      cost: this.travelCost
    });
    
    return this.calculateTravelDetails(path, options);
  }
  
  // Calculate cardinal direction travel (implicit path)
  calculateCardinalTravel(from: RegionNode, 
                          direction: CardinalDirection): TravelStep {
    const targetCoords = this.getCardinalCoords(from, direction);
    
    // Check if region exists or needs generation
    let target = resolver.resolveByCoords(
      targetCoords.world_x, targetCoords.world_y,
      targetCoords.region_x, targetCoords.region_y
    );
    
    if (!target) {
      target = generator.generateRegion(
        targetCoords.world_x, targetCoords.world_y,
        targetCoords.region_x, targetCoords.region_y,
        { from_region: from.id, direction }
      );
    }
    
    // Calculate travel time based on terrain, distance, pace
    const distance = 1; // One region unit
    const terrain_diff = this.calculateTerrainDifficulty(from, target);
    const base_time = this.calculateBaseTime(distance, terrain_diff);
    
    return {
      from_region: from.id,
      to_region: target.id,
      exit_used: direction,
      distance,
      base_time,
      actual_time: this.applyPaceModifiers(base_time, options.pace),
      encounters: this.rollEncounters(from, target, base_time),
      discoveries: this.checkDiscoveries(from, target)
    };
  }
  
  // Execute travel with state machine
  async executeTravel(travel: TravelState): Promise<TravelResult> {
    const actor = loadActor(travel.actor_ref);
    
    // Phase 1: Preparation
    travel.status = "preparing";
    await this.triggerEvent("travel_start", travel);
    
    // Phase 2: Journey
    travel.status = "traveling";
    for (let i = travel.current_step; i < travel.path.length; i++) {
      const step = travel.path[i];
      
      // Execute step
      await this.executeStep(travel, step);
      
      // Check for interruptions
      if (travel.status === "interrupted") {
        return { status: "interrupted", travel };
      }
      
      // Update actor location
      await this.updateActorLocation(travel.actor_ref, step.to_region);
      
      travel.current_step = i + 1;
      travel.elapsed_minutes += step.actual_time;
    }
    
    // Phase 3: Arrival
    travel.status = "arrived";
    await this.triggerEvent("travel_end", travel);
    
    return { status: "arrived", travel };
  }
}
```

### Time Calculation (THAUMWORLD Rules)

```typescript
// Based on THAUMWORLD movement stats
interface MovementStats {
  walk: number;      // Base speed (regions per hour)
  climb: number;     // Climbing speed
  swim: number;      // Swimming speed
  fly: number;       // Flying speed
}

// Default speeds (from kind definitions)
const BASE_SPEEDS = {
  walk: 6,      // 6 region-units per hour
  climb: 1,     // 1 region-unit per hour
  swim: 2,      // 2 region-units per hour
  fly: 0        // Most can't fly
};

// Terrain difficulty multipliers
const TERRAIN_MODIFIERS = {
  road: 1.0,
  grassland: 1.0,
  forest: 0.75,
  hills: 0.5,
  mountains: 0.25,
  swamp: 0.33,
  desert: 0.66,
  water: 0.0,   // Must swim or boat
  urban: 0.9
};

// Pace modifiers (trade speed for stealth/safety)
const PACE_MODIFIERS = {
  careful: 0.5,    // Half speed, stealth advantage
  normal: 1.0,     // Base speed
  fast: 1.5,       // 150% speed, exhaustion risk
  forced: 2.0      // 200% speed, guaranteed exhaustion
};

// Exhaustion system
interface ExhaustionState {
  level: number;           // 0-6 (0=none, 6=death)
  hours_without_rest: number;
  forced_march_hours: number;
}

function calculateTravelTime(
  distance: number,           // Region-units
  terrain: string,            // Terrain type
  pace: TravelPace,           // Travel pace
  actor: Actor                // Who's traveling
): number {
  // Base time from movement speed
  const speed = actor.movement.walk || BASE_SPEEDS.walk;
  let hours = distance / speed;
  
  // Apply terrain modifier
  const terrain_mod = TERRAIN_MODIFIERS[terrain] || 1.0;
  hours /= terrain_mod;
  
  // Apply pace modifier
  const pace_mod = PACE_MODIFIERS[pace];
  hours /= pace_mod;
  
  // Convert to minutes for game system
  return Math.round(hours * 60);
}

function checkExhaustion(actor: Actor, travel: TravelState): boolean {
  const exhaustion = actor.state.exhaustion || { level: 0 };
  
  // Forced march causes exhaustion
  if (travel.pace === "forced") {
    exhaustion.forced_march_hours += travel.elapsed_minutes / 60;
    
    // Every 8 hours of forced march = +1 exhaustion level
    if (exhaustion.forced_march_hours >= 8) {
      exhaustion.level += 1;
      exhaustion.forced_march_hours -= 8;
    }
  }
  
  // Long travel without rest
  exhaustion.hours_without_rest += travel.elapsed_minutes / 60;
  if (exhaustion.hours_without_rest >= 24) {
    exhaustion.level += 1;
    exhaustion.hours_without_rest = 0;
  }
  
  // Apply exhaustion effects
  if (exhaustion.level >= 3) {
    // Disadvantage on ability checks
    actor.modifiers.disadvantage_ability_checks = true;
  }
  if (exhaustion.level >= 5) {
    // Speed halved
    actor.movement.walk = Math.floor(actor.movement.walk / 2);
  }
  if (exhaustion.level >= 6) {
    // Death
    return true; // Actor dies
  }
  
  return false;
}
```

---

## Procedural Generation

### Generation Strategy

```typescript
class RegionGenerator {
  // Main generation entry point
  generateRegion(
    world_x: number, world_y: number,
    region_x: number, region_y: number,
    context: GenerationContext
  ): RegionNode {
    
    // 1. Determine region characteristics from world position
    const biome = this.determineBiome(world_x, world_y);
    const terrain = this.determineTerrain(world_x, world_y, region_x, region_y);
    
    // 2. Select template based on characteristics
    const template = this.selectTemplate(biome, terrain);
    
    // 3. Generate base structure from template
    const region = this.instantiateTemplate(template, {
      world_x, world_y, region_x, region_y,
      seed: this.generateSeed(world_x, world_y, region_x, region_y)
    });
    
    // 4. Interpolate from nearby pre-written regions
    const nearby = this.findNearbyHandcraftedRegions(
      world_x, world_y, region_x, region_y
    );
    region.description = this.interpolateDescription(region, nearby);
    region.atmosphere = this.interpolateAtmosphere(region, nearby);
    
    // 5. Add procedural content
    region.features = this.generateFeatures(region, template);
    region.contents = this.generateContents(region, template);
    
    // 6. Set up exits (implicit + any special connections)
    region.exits = this.generateExits(region, context);
    
    // 7. Calculate travel properties
    region.travel = this.calculateTravelProperties(region);
    
    // 8. Save to disk
    this.saveRegion(region);
    
    return region;
  }
  
  // Interpolation from pre-written content
  interpolateDescription(new_region: RegionNode, 
                         nearby: RegionNode[]): RegionDescription {
    if (nearby.length === 0) {
      // Use template default
      return new_region.description;
    }
    
    // Weight by distance (closer = more influence)
    const weights = nearby.map(n => 1.0 / this.distance(new_region, n));
    const total_weight = weights.reduce((a, b) => a + b, 0);
    
    // Blend descriptions
    return {
      short: this.blendText(
        nearby.map(n => n.description.short),
        weights
      ),
      full: this.blendText(
        nearby.map(n => n.description.full),
        weights
      ),
      atmosphere: this.blendText(
        nearby.map(n => n.description.atmosphere),
        weights
      ),
      sensory: this.interpolateSensory(nearby, weights)
    };
  }
  
  // Generate exits based on context
  generateExits(region: RegionNode, context: GenerationContext): RegionExit[] {
    const exits: RegionExit[] = [];
    
    // Check all 8 cardinal directions
    const directions: CardinalDirection[] = [
      "north", "northeast", "east", "southeast",
      "south", "southwest", "west", "northwest"
    ];
    
    for (const dir of directions) {
      const targetCoords = this.getCardinalCoords(region, dir);
      
      // Check if there's already a region there
      const existing = resolver.resolveByCoords(
        targetCoords.world_x, targetCoords.world_y,
        targetCoords.region_x, targetCoords.region_y
      );
      
      if (existing) {
        // Bidirectional connection
        exits.push({
          direction: dir,
          target_region: existing.id,
          distance: 1,
          terrain_difficulty: this.calculateDifficulty(region, existing),
          travel_time_minutes: this.calculateTime(region, existing),
          blocked: false,
          hidden: false,
          description: this.generateExitDescription(region, existing, dir)
        });
      } else if (this.shouldConnect(region, dir)) {
        // Mark for future generation
        exits.push({
          direction: dir,
          target_region: `gen_${targetCoords.world_x}_${targetCoords.world_y}_${targetCoords.region_x}_${targetCoords.region_y}`,
          target_world_coords: targetCoords,
          distance: 1,
          terrain_difficulty: 5, // Default
          travel_time_minutes: 60, // Default 1 hour
          blocked: false,
          hidden: false,
          description: this.generatePlaceholderDescription(dir)
        });
      }
    }
    
    return exits;
  }
}
```

### Template System

```typescript
interface RegionTemplate {
  id: string;
  name: string;
  
  // Matching criteria
  biome: BiomeType[];
  terrain: TerrainType[];
  region_type: RegionType;
  
  // Base content
  description_patterns: string[];
  feature_templates: FeatureTemplate[];
  encounter_tables: EncounterTable[];
  
  // Generation rules
  min_features: number;
  max_features: number;
  exit_probability: number;  // 0-1 chance of exit in each direction
  
  // Travel properties
  base_difficulty: number;
  speed_modifier: number;
  encounter_rate: number;
}

// Example templates
const TEMPLATES: RegionTemplate[] = [
  {
    id: "forest_clearing",
    name: "Forest Clearing",
    biome: ["temperate", "boreal"],
    terrain: ["forest"],
    region_type: "wilderness",
    description_patterns: [
      "A small clearing in the forest, dappled sunlight filtering through the canopy.",
      "An open space amidst the trees, where wildflowers grow in profusion.",
      "A natural clearing, evidence of an ancient lightning strike."
    ],
    feature_templates: [
      { type: "landmark", name: "Standing Stone", probability: 0.3 },
      { type: "terrain", name: "Wildflower Meadow", probability: 0.7 },
      { type: "obstacle", name: "Fallen Log", probability: 0.4 }
    ],
    min_features: 2,
    max_features: 4,
    exit_probability: 0.8,
    base_difficulty: 3,
    speed_modifier: 0.75,
    encounter_rate: 0.15
  },
  // ... more templates
];
```

---

## Event System Integration

### Travel Events

```typescript
interface TravelEvent {
  id: string;
  type: "encounter" | "discovery" | "obstacle" | "weather" | "story";
  
  // Trigger conditions
  conditions: {
    region_types?: RegionType[];
    terrain_types?: string[];
    time_of_day?: ("dawn" | "day" | "dusk" | "night")[];
    danger_level?: { min: number; max: number };
    probability: number;  // 0-1 base chance
  };
  
  // Event content
  title: string;
  description: string;
  
  // Choices/outcomes
  choices?: TravelChoice[];
  
  // Effects
  effects: {
    time_cost?: number;        // Additional minutes
    exhaustion?: number;       // Exhaustion levels gained
    damage?: string;          // Damage formula
    items?: string[];         // Items found/lost
    state_changes?: Record<string, any>;
  };
}

// Example events
const TRAVEL_EVENTS: TravelEvent[] = [
  {
    id: "bandit_ambush",
    type: "encounter",
    conditions: {
      region_types: ["wilderness", "road"],
      danger_level: { min: 3, max: 8 },
      probability: 0.1
    },
    title: "Ambush!",
    description: "Bandits emerge from the undergrowth, blocking the path ahead.",
    choices: [
      { text: "Fight", outcome: "combat", effects: { time_cost: 30 } },
      { text: "Flee", outcome: "escape", effects: { exhaustion: 1 } },
      { text: "Pay toll", outcome: "payment", effects: { items: ["gold:-10"] } }
    ],
    effects: {}
  },
  {
    id: "hidden_shrine",
    type: "discovery",
    conditions: {
      terrain_types: ["forest", "mountains"],
      probability: 0.05
    },
    title: "Hidden Shrine",
    description: "Tucked away in a secluded spot, you find a small shrine to an unknown deity.",
    effects: {
      time_cost: 15,
      state_changes: { "discovered_shrine": true }
    }
  }
];
```

### Event Triggering

```typescript
class TravelEventManager {
  // Roll for events during travel step
  rollEvents(step: TravelStep, travel: TravelState): TravelEvent[] {
    const events: TravelEvent[] = [];
    const from_region = resolver.resolveById(step.from_region);
    const to_region = resolver.resolveById(step.to_region);
    
    // Get time of day
    const time_of_day = this.getTimeOfDay(travel.start_time, travel.elapsed_minutes);
    
    // Check each event type
    for (const event of TRAVEL_EVENTS) {
      if (this.checkConditions(event.conditions, {
        from_region, to_region, time_of_day,
        danger_level: Math.max(from_region.state.danger_level, to_region.state.danger_level)
      })) {
        // Roll probability
        if (Math.random() < event.conditions.probability) {
          events.push(event);
        }
      }
    }
    
    return events;
  }
  
  // Execute an event
  async executeEvent(event: TravelEvent, travel: TravelState): Promise<EventResult> {
    // Send event to player
    await this.sendEventToPlayer(event);
    
    // If event has choices, wait for player response
    if (event.choices && event.choices.length > 0) {
      const choice = await this.waitForPlayerChoice(event.choices);
      return this.applyChoiceEffects(choice, travel);
    }
    
    // Apply automatic effects
    return this.applyEffects(event.effects, travel);
  }
}
```

---

## Integration with Existing Systems

### State Applier Integration

```typescript
// Add to state_applier/apply.ts

// Handle SET_OCCUPANCY effect
async function applySetOccupancy(
  slot: number,
  effect: Effect,
  context: EffectContext
): Promise<EffectResult> {
  const actor_ref = effect.args.target;
  const target_region = effect.args.target_region;
  
  // Load actor
  const actor = loadActor(slot, actor_ref);
  if (!actor.ok) return { success: false, error: "actor_not_found" };
  
  // Resolve target region
  const region = resolver.resolve({ id: target_region });
  if (!region) return { success: false, error: "region_not_found" };
  
  // Update actor location
  actor.actor.location = {
    world_tile: { x: region.world_coords.world_x, y: region.world_coords.world_y },
    region_tile: { x: region.world_coords.region_x, y: region.world_coords.region_y },
    tile: { x: 0, y: 0 }  // Center of region
  };
  
  // Update region state
  region.state.visited = true;
  region.state.visit_count++;
  region.state.last_visited = new Date().toISOString();
  
  // Apply awareness to NPCs in region
  await applyAwarenessToRegionNPCs(slot, region.id, actor_ref);
  
  // Save changes
  saveActor(slot, actor.actor);
  saveRegion(slot, region);
  
  return { success: true };
}

// Handle TRAVEL effect (new)
async function applyTravel(
  slot: number,
  effect: Effect,
  context: EffectContext
): Promise<EffectResult> {
  const travel_id = effect.args.travel_id;
  
  // Load travel state
  const travel = loadTravelState(slot, travel_id);
  
  // Execute travel
  const engine = new TravelEngine();
  const result = await engine.executeTravel(travel);
  
  return { 
    success: result.status === "arrived",
    travel_result: result 
  };
}
```

### Rules Lawyer Integration

```typescript
// Add to rules_lawyer/effects.ts

// Enhanced MOVE action with travel system
if (command.verb === "MOVE") {
  const actor = command.subject;
  const target = get_identifier(command.args.target);
  const mode = get_identifier(command.args.mode) || "walk";
  const action_cost = get_identifier(command.args.action_cost) || "PARTIAL";
  
  // Check if this is inter-region travel
  if (target.startsWith("region.")) {
    // Use travel system
    const from_region = getCurrentRegion(slot, actor);
    const to_region = resolver.resolve({ id: target });
    
    if (!to_region) {
      effect_lines.push(`NOTE.INVALID_TARGET(verb=MOVE, target=${target})`);
      return effect_lines;
    }
    
    // Create travel state
    const travel = travelEngine.createTravel({
      actor_ref: actor,
      from_region: from_region.id,
      to_region: to_region.id,
      mode,
      pace: action_cost === "FULL" ? "fast" : "normal"
    });
    
    // Add travel effect
    effect_lines.push(`SYSTEM.TRAVEL(travel_id=${travel.id})`);
    
    // Time advancement based on calculated travel time
    const hours = Math.ceil(travel.estimated_duration / 60);
    effect_lines.push(`SYSTEM.ADVANCE_TIME(unit=hour, count=${hours})`);
    
  } else {
    // Intra-region movement (existing logic)
    effect_lines.push(`SYSTEM.SET_OCCUPANCY(target=${actor}, tiles=[${target}])`);
    
    if (action_cost === "EXTENDED") {
      effect_lines.push("SYSTEM.ADVANCE_TIME(unit=EXTENDED_ACTION, count=1)");
    }
  }
}
```

### Turn Manager Integration

```typescript
// Add to turn_manager/main.ts

// Handle travel as a special action type
async function processTravelAction(
  slot: number,
  action: TravelAction,
  turn_state: TurnState
): Promise<void> {
  // Travel takes the entire turn
  turn_state.phase = "TRAVELING";
  
  // Execute travel
  const engine = new TravelEngine();
  const result = await engine.executeTravel(action.travel_state);
  
  // Handle result
  if (result.status === "arrived") {
    // End turn after arrival
    transitionPhase(turn_state, "TURN_END");
  } else if (result.status === "interrupted") {
    // Pause for event resolution
    turn_state.phase = "ACTION_SELECTION";
    await this.pauseForEvent(result.interruption_event);
  }
}
```

---

## API Design

### Player Commands

```typescript
// Natural language commands supported

// Cardinal direction travel
"walk north"
"go east"
"travel south"
"head northwest"

// Named destination travel
"go to Eden Commons"
"travel to Grenda's Shop"
"walk to the Whispering Woods"

// Relative travel
"walk toward the mountains"
"head away from town"
"go deeper into the forest"

// Travel with pace
"walk carefully north"
"travel fast to Eden"
"forced march east"

// Travel with mode
"climb up the cliff"
"swim across the river"
"fly to the tower"  // If capable

// Discovery/Exploration
"explore the area"
"look for paths"
"scout ahead"
"find a way around"
```

### System API

```typescript
// Region Resolution API
interface RegionAPI {
  // Core resolution
  resolve(query: RegionQuery): RegionNode | null;
  resolveById(id: string): RegionNode | null;
  resolveByName(name: string): RegionNode | null;
  resolveByCoords(coords: WorldCoords): RegionNode | null;
  resolveRelative(from: string, direction: CardinalDirection): RegionNode | null;
  
  // Discovery
  findRegionsAround(center: string, radius: number): RegionNode[];
  findPath(from: string, to: string): TravelPath | null;
  getExits(region_id: string): RegionExit[];
  
  // Generation
  generate(coords: WorldCoords, context: GenContext): RegionNode;
  shouldGenerate(coords: WorldCoords): boolean;
}

// Travel API
interface TravelAPI {
  // Planning
  planTravel(from: string, to: string, options: TravelOptions): TravelPlan;
  calculateTime(distance: number, terrain: string, pace: TravelPace): number;
  
  // Execution
  startTravel(plan: TravelPlan): TravelState;
  executeTravel(travel_id: string): Promise<TravelResult>;
  pauseTravel(travel_id: string): void;
  resumeTravel(travel_id: string): void;
  cancelTravel(travel_id: string): void;
  
  // Events
  rollEncounters(travel: TravelState): TravelEvent[];
  executeEvent(event: TravelEvent): Promise<EventResult>;
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
**Goal:** Basic region resolution and travel

**Tasks:**
1. Create `src/travel_system/` module structure
2. Implement RegionResolver with ID and coordinate lookup
3. Update `get_current_region()` to use resolver
4. Create basic RegionNode TypeScript interfaces
5. Add exit data to existing region files
6. Implement cardinal direction coordinate calculation
7. Test: Verify can resolve all existing regions

**Deliverables:**
- Region resolution working
- Can find regions by ID and coordinates
- Foundation for travel system in place

### Phase 2: Travel Engine (Week 2)
**Goal:** Execute travel between regions

**Tasks:**
1. Implement TravelEngine with path calculation
2. Create TravelState machine
3. Implement time calculation (respecting THAUMWORLD speeds)
4. Add SET_OCCUPANCY effect to state_applier
5. Update Rules Lawyer MOVE action for inter-region travel
6. Implement exhaustion tracking
7. Test: Walk from Crossroads to Whispering Woods

**Deliverables:**
- Can travel between existing regions
- Time advances correctly
- Actor location updates properly

### Phase 3: Events & Encounters (Week 3)
**Goal:** Make travel interesting

**Tasks:**
1. Create TravelEventManager
2. Define 10-20 base travel events
3. Implement encounter rolling
4. Add discovery system
5. Create event UI/dialog system
6. Test: Trigger events during travel

**Deliverables:**
- Random encounters during travel
- Discoveries appear appropriately
- Events can interrupt/pause travel

### Phase 4: Procedural Generation (Week 4)
**Goal:** Generate regions on-demand

**Tasks:**
1. Create RegionGenerator class
2. Define 20-30 region templates
3. Implement template selection logic
4. Add content interpolation from nearby regions
5. Create exit generation for implicit connections
6. Implement generation seeding for reproducibility
7. Test: Walk off the map, generate new regions

**Deliverables:**
- New regions generate as player explores
- Generated regions blend with handcrafted content
- Can explore infinitely (in theory)

### Phase 5: Advanced Features (Week 5-6)
**Goal:** Polish and advanced mechanics

**Tasks:**
1. Implement name-based region lookup
2. Add relative direction resolution ("walk toward mountains")
3. Create pathfinding for long-distance travel
4. Add travel modes (stealth, forced march)
5. Implement party travel (multiple actors)
6. Add mount/vehicle travel
7. Create rest spots and camping
8. Test: Full integration test

**Deliverables:**
- Complete travel system
- All query types work
- Performance acceptable with 1000s of regions

---

## Performance Considerations

### For 1000s of Regions

**File Organization:**
```
local_data/
  data_slot_1/
    regions/
      handcrafted/          # Pre-written regions
        eden_crossroads.jsonc
        eden_commons.jsonc
        ...
      generated/            # Procedurally generated
        0_0_0_0.jsonc       # Naming: worldX_worldY_regionX_regionY
        0_0_0_1.jsonc
        ...
      index.jsonc           # Optional: metadata index
```

**Optimization Strategies:**

1. **Lazy Loading:** Only load full region data when needed
2. **Metadata Caching:** Keep region headers (id, name, coords) in memory
3. **Spatial Partitioning:** Organize regions by world tile for faster coordinate lookup
4. **Generation Caching:** Don't regenerate if file exists
5. **Async I/O:** All file operations non-blocking

**Benchmark Targets:**
- ID lookup: <10ms
- Name lookup (1000 regions): <100ms
- Coordinate lookup: <50ms
- Region generation: <500ms
- Pathfinding (50 regions): <200ms

---

## Open Questions

1. **World Bounds:** Should there be a world boundary, or infinite generation?
2. **Persistence:** Should generated regions be saved permanently or regenerated each session?
3. **Multi-Player:** How does travel work if multiple players are in different locations?
4. **Fast Travel:** Should there be a fast travel system once areas are discovered?
5. **Map Display:** Do players see a map, or is travel more narrative/descriptive?
6. **Save/Load:** How do we handle saving mid-travel?

---

## Next Steps

**Ready to implement?** I recommend:

1. **Review this plan** - Does this match your vision?
2. **Answer open questions** - Critical for implementation details
3. **Prioritize phases** - Which features are most important?
4. **Start Phase 1** - Begin with region resolver foundation

**Alternative:** If this is too large, we can scope down to:
- **Minimal:** Just fix coordinate-based lookup for working memory (immediate need)
- **Basic:** Add explicit exits to existing regions, enable region-to-region travel
- **Full:** Complete system as outlined above

What would you like to do?
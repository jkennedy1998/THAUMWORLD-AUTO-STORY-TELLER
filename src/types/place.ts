/**
 * Place System Type Definitions
 * 
 * Defines the data structures for the place/room system that partitions
 * regions into smaller interactive areas with tile-level positioning.
 */

/**
 * A place represents a bounded area within a region where interactions are local.
 * Examples: Tavern common room, shop interior, town square, church nave
 */
export type Place = {
  schema_version: 1;
  id: string;                    // Unique ID: "eden_crossroads_tavern_common"
  name: string;                  // Display name: "The Singing Sword - Common Room"
  region_id: string;             // Parent region: "eden_crossroads"
  
  // Position in the world
  coordinates: PlaceCoordinates;
  
  // Tile grid dimensions and entry point
  tile_grid: TileGrid;
  
  // Connections to other places (graph structure)
  connections: PlaceConnection[];
  
  // Environmental properties
  environment: PlaceEnvironment;
  
  // Contents tracking (denormalized for quick access)
  contents: PlaceContents;
  
  // Metadata
  is_public: boolean;            // Can random travelers enter?
  is_default: boolean;           // Is this the region's default entry place?
  max_occupancy?: number;        // Soft limit for realism
  description: PlaceDescription;
};

/**
 * World position of a place
 */
export type PlaceCoordinates = {
  world_tile: {
    x: number;
    y: number;
  };
  region_tile: {
    x: number;
    y: number;
  };
  elevation: number;             // 0=surface, +1=above, -1=below
};

/**
 * Tile grid dimensions within a place
 */
export type TileGrid = {
  width: number;                 // Tiles across (typical: 20-40)
  height: number;                // Tiles deep (typical: 20-40)
  default_entry: {               // Where arrivals appear
    x: number;
    y: number;
  };
};

/**
 * Connection to another place
 */
export type PlaceConnection = {
  target_place_id: string;       // Target place ID
  target_region_id?: string;     // If different region (for regional travel)
  direction: string;             // "north", "up", "through_door", etc.
  travel_time_seconds: number;   // Usually 0 for same region
  requires_key?: boolean;        // Locked connection?
  is_hidden?: boolean;           // Secret passage?
  description: string;           // Description shown to player
};

/**
 * Environmental properties of a place
 */
export type PlaceEnvironment = {
  lighting: "bright" | "dim" | "dark";
  terrain: string;               // "wooden_floor", "cobblestone", "dirt", etc.
  cover_available: string[];     // ["tables", "pillars", "bar"]
  temperature_offset: number;    // +/- from region base temperature
  sound_properties?: {
    dampening: number;           // 0-1, reduces sound travel
    echo: boolean;               // Sound echoes?
  };
};

/**
 * Contents currently in a place
 */
export type PlaceContents = {
  npcs_present: PlaceNPC[];
  actors_present: PlaceActor[];
  items_on_ground: PlaceItem[];
  features: PlaceFeature[];
};

/**
 * NPC present in a place
 */
export type PlaceNPC = {
  npc_ref: string;               // "npc.gunther"
  tile_position: TilePosition;
  status: "present" | "moving" | "busy" | "sleeping";
  activity: string;              // "sitting at the bar", "whittling by the fire"
};

/**
 * Actor (player character) present in a place
 */
export type PlaceActor = {
  actor_ref: string;             // "actor.henry_actor"
  tile_position: TilePosition;
  status: "present" | "moving" | "busy";
};

/**
 * Item on the ground in a place
 */
export type PlaceItem = {
  item_ref: string;              // "item.iron_sword"
  tile_position: TilePosition;
  quantity: number;
};

/**
 * Static feature in a place (furniture, obstacles, etc.)
 */
export type PlaceFeature = {
  id: string;
  name: string;
  description: string;
  tile_positions: TilePosition[];  // Can span multiple tiles
  is_obstacle: boolean;            // Blocks movement?
  is_cover: boolean;               // Provides cover?
  is_interactable: boolean;        // Can players interact?
};

/**
 * Tile coordinates within a place
 */
export type TilePosition = {
  x: number;                     // 0 to tile_grid.width - 1
  y: number;                     // 0 to tile_grid.height - 1
};

/**
 * Place description for display
 */
export type PlaceDescription = {
  short: string;                 // One line summary
  full: string;                  // Detailed description
  sensory: {
    sight: string[];
    sound: string[];
    smell: string[];
    touch: string[];
  };
};

/**
 * Graph structure for places within a region
 */
export type PlaceGraph = {
  nodes: string[];               // List of place_ids
  edges: PlaceGraphEdge[];
};

export type PlaceGraphEdge = {
  from: string;                  // place_id
  to: string;                    // place_id
  direction: string;
  travel_time: number;
};

/**
 * Region schema updates (places field added to Region)
 */
export type RegionPlaces = {
  list: string[];                // IDs of places in this region
  default_place_id: string;      // Where new arrivals go
  graph: PlaceGraph;             // Connections between places
};

/**
 * Biome preset for regionless world tiles
 */
export type Biome = {
  id: string;
  name: string;
  world_tile_tags: string[];     // Tags that trigger this biome
  default_places: PlaceTemplate[];
  random_encounters: EncounterTable;
};

/**
 * Template for generating a place
 */
export type PlaceTemplate = {
  id_suffix: string;             // Appended to region_id
  name: string;
  tile_grid: Omit<TileGrid, "default_entry">;
  environment: PlaceEnvironment;
  features: Omit<PlaceFeature, "id">[];
  description: PlaceDescription;
};

export type EncounterTable = {
  encounters: {
    npc_ref?: string;
    weight: number;
    conditions?: string[];
  }[];
};

/**
 * Actor/NPC location updates
 */
export type EntityLocation = {
  world_tile: { x: number; y: number };
  region_tile: { x: number; y: number };
  place_id: string;              // NEW: Required field
  tile: TilePosition;
  elevation: number;
};

/**
 * Result types for place operations
 */
export type PlaceResult =
  | { ok: true; place: Place; path: string }
  | { ok: false; error: string; details?: unknown };

export type PlaceListResult =
  | { ok: true; places: string[] }
  | { ok: false; error: string };

export type PlaceTravelResult =
  | { 
      ok: true; 
      place_id: string; 
      tile_position: TilePosition;
      travel_description: string;
      time_seconds: number;
    }
  | { ok: false; error: string; reason?: string };

/**
 * Reference format types for the pipeline
 */
export type PlaceReference = `place.${string}.${string}`;
export type PlaceTileReference = `place_tile.${string}.${string}.${number}.${number}`;

/**
 * Awareness configuration for perception calculations
 */
export type AwarenessConfig = {
  sight_radius_tiles: number;    // How far can see
  hearing_radius_tiles: number;  // How far can hear normally
  shout_radius_tiles: number;    // How far shouts travel
};

/**
 * Sound event for propagation calculations
 */
export type SoundEvent = {
  source_tile: TilePosition;
  volume: "whisper" | "normal" | "loud" | "shout";
  content: string;
  source_entity: string;
};

/**
 * Line of sight calculation result
 */
export type LineOfSightResult = {
  can_see: boolean;
  obstacles: string[];           // What's blocking view?
  distance_tiles: number;
  visibility_quality: "clear" | "obscured" | "blocked";
};

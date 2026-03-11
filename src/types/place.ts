/**
 * Place System Type Definitions
 * 
 * Defines the data structures for the place/room system that partitions
 * regions into smaller interactive areas with tile-level positioning.
 */

import type { BodySlots } from "./body_slots.js";
import type { Container } from "./container.js";
import type { InlineItem } from "./inline_item.js";
import type { TagInstance } from "../tag_system/registry.js";
import type { BodyModelVoxel } from "../shared/body_model.js";

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

  // Tile data:
  // - tiles_z0: ground/support layer (blocks beneath actors)
  // - tiles: default layer (z=1 in current 3dification test room)
  // y=0 is the bottom row; cells are indexed as cells[y][x].
  tiles_z0?: PlaceTiles;
  tiles?: PlaceTiles;
  
  // Connections to other places (graph structure)
  connections: PlaceConnection[];
  
  // Environmental properties
  environment: PlaceEnvironment;
  
  // Contents tracking (denormalized for quick access)
  contents: PlaceContents;

  // Container storage - DEPRECATED: Use ground instead
  containers?: Record<string, Container>;

  // Ground storage - inline items on the ground (Phase 5)
  ground?: {
    main: InlineItem[];                    // Items without specific position
    scattered: Record<string, InlineItem[]>;  // Key = "x_y", items at that position
  };

  // Multi-voxel structures stored as explicit instances.
  // Each instance references a tile definition (`def_id`) for behavior/appearance.
  structures?: PlaceStructureInstance[];

  // Metadata
  is_public: boolean;            // Can random travelers enter?
  is_default: boolean;           // Is this the region's default entry place?
  max_occupancy?: number;        // Soft limit for realism
  description: PlaceDescription;
};

export type PlaceStructureInstance = {
  // Stable instance id (unique within the place).
  id: string;
  // Tile definition id from local_data/tiles/** (e.g. "chest", "door", "tall_statue").
  def_id: string;

  // Origin voxel in place tile coordinates.
  // z is absolute world-z; when omitted, defaults to place.coordinates.elevation.
  origin: { x: number; y: number; z?: number };

  // Optional facing/orientation (future: used to rotate (dx,dy) footprints).
  facing?: string;

  // Optional arbitrary instance state (open/closed, growth stage, etc.).
  state?: Record<string, unknown>;

  // Inline container-like storage for structure contents (e.g. multi-tile chest).
  // Only used if the effective tags include CONTAINER.
  contents?: InlineItem[];
  container_capacity?: {
    max_slots?: number;
    max_weight?: number;
  };

  // Optional tag deltas applied on top of the tile definition's tags.
  tag_add?: TagInstance[];
  tag_remove?: Array<{ key: string; mag: number }>;

  // Derived/runtime-only (populated by server API):
  display_char?: string;
  display_color?: string;
  container_glyphs?: { closed: string; open: string };
  tags?: TagInstance[];
  // Resolved physical body model (voxel footprint). When absent, treated as 1 voxel at origin.
  body_model?: { anchor_part?: string; physical: BodyModelVoxel[] };
  __derived_runtime?: boolean;
};

// Tile definition reference - references local_data/tiles/{category}/{kind}.jsonc
export type PlaceTileKind = string;

export type PlaceDoorMeta = {
  target_place_id: string;
  direction: string;
};

export type PlaceTile = {
  kind: PlaceTileKind;  // References tile definition ID (e.g., "tile_stone_brick", "chest")
  
  // Door metadata (only present if tile has DOOR tag)
  door?: PlaceDoorMeta;

  // Tag deltas (remove+add) applied on top of tile definition tags.
  // Effective tags are resolved server-side; `tags` is treated as derived/runtime-only.
  tag_add?: TagInstance[];
  tag_remove?: Array<{ key: string; mag: number }>;
  tags?: TagInstance[];

  // Inline container-like storage for tile contents (e.g., harvestables, planters).
  // Items may carry grid_x/grid_y fields (same as container-items) for organization.
  // Only used if tile has CONTAINER tag.
  contents?: InlineItem[];
  
  // Container capacity - overrides tile definition if specified
  // Used for tiles with CONTAINER tag
  container_capacity?: {
    max_slots?: number;
    max_weight?: number;
  };

  // Time-skip support (bulk tick processing).
  // Last GameTime.total_minutes when this tile was processed.
  last_tick_processed?: number;

  // Multitile grouping (architecture; not implemented yet).
  multitile_id?: string;
  
  // Deprecated: collidable removed - use OCCUPIES tag instead
};

export type PlaceTiles = {
  width: number;
  height: number;
  // null means empty space on that layer
  cells: Array<Array<PlaceTile | null>>;
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
  kind_id?: string;              // Kind id (used for body models + rendering)
  body_model_id?: string;        // Body model id for multi-voxel occupancy/render
  body_slot_representation?: Record<string, any>; // Kind-driven body slot mapping (optional)
  // 3Dification: vertical position in place/world space.
  // For now this is sourced from npc.location.elevation when available.
  elevation?: number;
  status: "present" | "moving" | "busy" | "sleeping";
  activity: string;              // "sitting at the bar", "whittling by the fire"
  tags?: Array<{ name: string; mag: number; meta: string[] }>;  // Optional tags for visual effects
  body_slots?: BodySlots;        // Equipment slots for inventory interactions
};

/**
 * Actor (player character) present in a place
 */
export type PlaceActor = {
  actor_ref: string;             // "actor.henry_actor"
  tile_position: TilePosition;
  kind_id?: string;              // Kind id (used for body models + rendering)
  body_model_id?: string;        // Body model id for multi-voxel occupancy/render
  body_slot_representation?: Record<string, any>; // Kind-driven body slot mapping (optional)
  // 3Dification: vertical position in place/world space.
  // For now this is sourced from actor.location.elevation when available.
  elevation?: number;
  status: "present" | "moving" | "busy";
  tags?: Array<{ name: string; mag: number; meta: string[] }>;  // Optional tags for visual effects
};

/**
 * Item on the ground in a place
 */
export type PlaceItem = {
  item_ref: string;              // "item.iron_sword"
  tile_position: TilePosition;
  // Optional absolute world-z for 3dification rendering.
  elevation?: number;
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

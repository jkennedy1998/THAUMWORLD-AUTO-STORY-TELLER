/**
 * Place Utility Functions
 * 
 * Helper functions for working with places, entity positioning,
 * proximity detection, and place graph traversal.
 */

import type {
  Place,
  PlaceNPC,
  PlaceActor,
  TilePosition,
  PlaceTravelResult,
  EntityLocation
} from "../types/place.js";
import { load_place, save_place } from "./store.js";

/**
 * Calculate distance between two tile positions (in tiles)
 */
export function get_tile_distance(
  pos1: TilePosition,
  pos2: TilePosition
): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if a tile position is within a place's bounds
 */
export function is_valid_tile_position(
  place: Place,
  position: TilePosition
): boolean {
  return (
    position.x >= 0 &&
    position.x < place.tile_grid.width &&
    position.y >= 0 &&
    position.y < place.tile_grid.height
  );
}

/**
 * Get NPC location from place data
 */
export function get_npc_position_in_place(
  place: Place,
  npc_ref: string
): TilePosition | null {
  const npc = place.contents.npcs_present.find(n => n.npc_ref === npc_ref);
  return npc?.tile_position ?? null;
}

/**
 * Get actor location from place data
 */
export function get_actor_position_in_place(
  place: Place,
  actor_ref: string
): TilePosition | null {
  const actor = place.contents.actors_present.find(a => a.actor_ref === actor_ref);
  return actor?.tile_position ?? null;
}

/**
 * Find all entities within a radius of a center position
 */
export function get_nearby_entities_in_place(
  place: Place,
  center: TilePosition,
  radius_tiles: number
): {
  npcs: PlaceNPC[];
  actors: PlaceActor[];
} {
  const npcs = place.contents.npcs_present.filter(npc =>
    get_tile_distance(center, npc.tile_position) <= radius_tiles
  );
  
  const actors = place.contents.actors_present.filter(actor =>
    get_tile_distance(center, actor.tile_position) <= radius_tiles
  );
  
  return { npcs, actors };
}

/**
 * Check if two places are connected
 */
export function are_places_connected(
  from_place: Place,
  to_place_id: string
): boolean {
  return from_place.connections.some(conn => conn.target_place_id === to_place_id);
}

/**
 * Get connection between two places
 */
export function get_place_connection(
  from_place: Place,
  to_place_id: string
) {
  return from_place.connections.find(conn => conn.target_place_id === to_place_id);
}

/**
 * Add an NPC to a place
 */
export function add_npc_to_place(
  place: Place,
  npc_ref: string,
  position: TilePosition,
  activity?: string
): boolean {
  // Check if position is valid
  if (!is_valid_tile_position(place, position)) {
    return false;
  }
  
  // Check if NPC already exists
  const existing_index = place.contents.npcs_present.findIndex(
    n => n.npc_ref === npc_ref
  );
  
  const npc_data: PlaceNPC = {
    npc_ref,
    tile_position: position,
    status: "present",
    activity: activity ?? "standing here"
  };
  
  if (existing_index >= 0) {
    // Update existing
    place.contents.npcs_present[existing_index] = npc_data;
  } else {
    // Add new
    place.contents.npcs_present.push(npc_data);
  }
  
  return true;
}

/**
 * Remove an NPC from a place
 */
export function remove_npc_from_place(
  place: Place,
  npc_ref: string
): boolean {
  const index = place.contents.npcs_present.findIndex(n => n.npc_ref === npc_ref);
  if (index >= 0) {
    place.contents.npcs_present.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Add an actor to a place
 */
export function add_actor_to_place(
  place: Place,
  actor_ref: string,
  position: TilePosition
): boolean {
  if (!is_valid_tile_position(place, position)) {
    return false;
  }
  
  const existing_index = place.contents.actors_present.findIndex(
    a => a.actor_ref === actor_ref
  );
  
  const actor_data: PlaceActor = {
    actor_ref,
    tile_position: position,
    status: "present"
  };
  
  if (existing_index >= 0) {
    place.contents.actors_present[existing_index] = actor_data;
  } else {
    place.contents.actors_present.push(actor_data);
  }
  
  return true;
}

/**
 * Remove an actor from a place
 */
export function remove_actor_from_place(
  place: Place,
  actor_ref: string
): boolean {
  const index = place.contents.actors_present.findIndex(a => a.actor_ref === actor_ref);
  if (index >= 0) {
    place.contents.actors_present.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Move an entity from one place to another
 * Returns the travel result
 */
export async function move_entity_between_places(
  slot: number,
  entity_ref: string,
  from_place_id: string,
  to_place_id: string,
  target_tile?: TilePosition
): Promise<PlaceTravelResult> {
  // Load both places
  const from_result = load_place(slot, from_place_id);
  const to_result = load_place(slot, to_place_id);
  
  if (!from_result.ok) {
    return {
      ok: false,
      error: "source_place_not_found",
      reason: from_result.error
    };
  }
  
  if (!to_result.ok) {
    return {
      ok: false,
      error: "destination_place_not_found",
      reason: to_result.error
    };
  }
  
  const from_place = from_result.place;
  const to_place = to_result.place;
  
  // Check if places are connected
  if (!are_places_connected(from_place, to_place_id)) {
    return {
      ok: false,
      error: "places_not_connected",
      reason: `No direct connection from ${from_place_id} to ${to_place_id}`
    };
  }
  
  // Get connection info
  const connection = get_place_connection(from_place, to_place_id)!;
  
  // Determine if NPC or actor
  const is_npc = entity_ref.startsWith("npc.");
  
  // Remove from source place
  if (is_npc) {
    remove_npc_from_place(from_place, entity_ref);
  } else {
    remove_actor_from_place(from_place, entity_ref);
  }
  
  // Determine entry position
  const entry_position = target_tile ?? to_place.tile_grid.default_entry;
  
  // Add to destination place
  if (is_npc) {
    add_npc_to_place(to_place, entity_ref, entry_position);
  } else {
    add_actor_to_place(to_place, entity_ref, entry_position);
  }
  
  // Save both places
  save_place(slot, from_place);
  save_place(slot, to_place);
  
  return {
    ok: true,
    place_id: to_place_id,
    tile_position: entry_position,
    travel_description: connection.description,
    time_seconds: connection.travel_time_seconds
  };
}

/**
 * Create a place ID from region and place name
 */
export function create_place_id(region_id: string, place_suffix: string): string {
  return `${region_id}_${place_suffix}`;
}

/**
 * Parse a place ID to extract region and place name
 */
export function parse_place_id(place_id: string): {
  region_id: string;
  place_suffix: string;
} | null {
  const parts = place_id.split("_");
  if (parts.length < 2) return null;
  
  // Handle region IDs with underscores (e.g., "eden_crossroads")
  // Last part is the place suffix, rest is region
  const place_suffix = parts.pop()!;
  const region_id = parts.join("_");
  
  return { region_id, place_suffix };
}

/**
 * Get all connected place IDs from a place
 */
export function get_connected_places(place: Place): string[] {
  return place.connections.map(conn => conn.target_place_id);
}

/**
 * Create a default entry position for a place (center)
 */
export function get_default_entry_position(place: Place): TilePosition {
  return {
    x: Math.floor(place.tile_grid.width / 2),
    y: Math.floor(place.tile_grid.height / 2)
  };
}

/**
 * Format tile position as string
 */
export function format_tile_position(pos: TilePosition): string {
  return `(${pos.x}, ${pos.y})`;
}

/**
 * Parse tile position from string
 */
export function parse_tile_position(str: string): TilePosition | null {
  const match = str.match(/\((\d+),\s*(\d+)\)/);
  if (!match) return null;
  
  return {
    x: parseInt(match[1]!, 10),
    y: parseInt(match[2]!, 10)
  };
}

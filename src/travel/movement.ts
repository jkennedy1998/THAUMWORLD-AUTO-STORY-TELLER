/**
 * Travel and Movement System
 * 
 * Handles all types of movement:
 * - Tile-level movement within places
 * - Place-to-place travel
 * - Regional travel
 * - Time-based travel cost
 */

import type { Place, TilePosition } from "../types/place.js";
import type { GameTime } from "../time_system/tracker.js";
import { load_place, save_place, get_default_place_for_region } from "../place_storage/store.js";
import { 
  get_tile_distance, 
  is_valid_tile_position,
  get_connected_places,
  add_actor_to_place,
  remove_actor_from_place,
  add_npc_to_place,
  remove_npc_from_place
} from "../place_storage/utils.js";
import { get_npc_location, set_npc_location, update_npc_location } from "../npc_storage/location.js";
import { load_actor, save_actor } from "../actor_storage/store.js";
import { load_npc, save_npc } from "../npc_storage/store.js";
import { advance_time } from "../time_system/tracker.js";

// Movement speeds (tiles per minute)
const MOVEMENT_SPEEDS = {
  walk: 4,      // 4 tiles per minute (10 ft per minute)
  run: 8,       // 8 tiles per minute
  sneak: 2,     // 2 tiles per minute
  crawl: 1      // 1 tile per minute
};

// Place transition time (seconds)
const PLACE_TRANSITION_TIME = 5;

// Regional travel time (minutes per world tile)
const REGIONAL_TRAVEL_MINUTES = 30;

export type MoveResult = {
  ok: boolean;
  error?: string;
  new_position?: TilePosition;
  travel_time_seconds?: number;
  time_advanced?: boolean;
};

export type TravelResult = {
  ok: boolean;
  error?: string;
  from_place_id?: string;
  to_place_id?: string;
  travel_time_seconds?: number;
  travel_description?: string;
};

/**
 * Move entity within a place (tile to tile)
 */
export async function move_within_place(
  slot: number,
  entity_ref: string,
  target_tile: TilePosition,
  speed: "walk" | "run" | "sneak" | "crawl" = "walk"
): Promise<MoveResult> {
  // Determine if NPC or actor
  const is_npc = entity_ref.startsWith("npc.");
  const entity_id = entity_ref.replace(/^(npc|actor)\./, "");
  
  // Load entity
  let entity: Record<string, unknown> | null = null;
  if (is_npc) {
    const result = load_npc(slot, entity_id);
    if (result.ok) entity = result.npc;
  } else {
    const result = load_actor(slot, entity_id);
    if (result.ok) entity = result.actor;
  }
  
  if (!entity) {
    return { ok: false, error: "entity_not_found" };
  }
  
  // Get current location
  const current_location = get_npc_location(entity);
  if (!current_location?.place_id) {
    return { ok: false, error: "entity_not_in_place" };
  }
  
  // Load place
  const place_result = load_place(slot, current_location.place_id);
  if (!place_result.ok) {
    return { ok: false, error: "place_not_found" };
  }
  const place = place_result.place;
  
  // Validate target position
  if (!is_valid_tile_position(place, target_tile)) {
    return { ok: false, error: "target_out_of_bounds" };
  }
  
  // Calculate distance and time
  const distance = get_tile_distance(current_location.tile, target_tile);
  const speed_tiles_per_minute = MOVEMENT_SPEEDS[speed];
  const time_minutes = distance / speed_tiles_per_minute;
  const time_seconds = Math.ceil(time_minutes * 60);
  
  // Update entity location
  const new_location = {
    ...current_location,
    tile: target_tile
  };
  
  const update_result = await (is_npc
    ? update_npc_location(slot, entity_id, { tile: target_tile })
    : update_actor_location(slot, entity_id, { tile: target_tile }));
  
  if (!update_result.ok) {
    return { ok: false, error: update_result.error };
  }
  
  // Update place contents
  if (is_npc) {
    remove_npc_from_place(place, entity_ref);
    add_npc_to_place(place, entity_ref, target_tile, "moving");
  } else {
    remove_actor_from_place(place, entity_ref);
    add_actor_to_place(place, entity_ref, target_tile);
  }
  
  save_place(slot, place);
  
  return {
    ok: true,
    new_position: target_tile,
    travel_time_seconds: time_seconds,
    time_advanced: false // Tile movement doesn't advance global time significantly
  };
}

/**
 * Travel between connected places
 */
export async function travel_between_places(
  slot: number,
  entity_ref: string,
  target_place_id: string
): Promise<TravelResult> {
  // Determine if NPC or actor
  const is_npc = entity_ref.startsWith("npc.");
  const entity_id = entity_ref.replace(/^(npc|actor)\./, "");
  
  // Load entity
  let entity: Record<string, unknown> | null = null;
  if (is_npc) {
    const result = load_npc(slot, entity_id);
    if (result.ok) entity = result.npc;
  } else {
    const result = load_actor(slot, entity_id);
    if (result.ok) entity = result.actor;
  }
  
  if (!entity) {
    return { ok: false, error: "entity_not_found" };
  }
  
  // Get current location
  const current_location = get_npc_location(entity);
  if (!current_location?.place_id) {
    return { ok: false, error: "entity_not_in_place" };
  }
  
  const from_place_id = current_location.place_id;
  
  // Check if trying to travel to same place
  if (from_place_id === target_place_id) {
    return { ok: false, error: "already_in_place" };
  }
  
  // Load current place to check connection
  const from_place_result = load_place(slot, from_place_id);
  if (!from_place_result.ok) {
    return { ok: false, error: "current_place_not_found" };
  }
  const from_place = from_place_result.place;
  
  // Check if places are connected
  const connection = from_place.connections.find(c => c.target_place_id === target_place_id);
  if (!connection) {
    return { 
      ok: false, 
      error: "places_not_connected",
      from_place_id,
      to_place_id: target_place_id
    };
  }
  
  // Load target place
  const to_place_result = load_place(slot, target_place_id);
  if (!to_place_result.ok) {
    return { ok: false, error: "target_place_not_found" };
  }
  const to_place = to_place_result.place;
  
  // Remove from current place
  if (is_npc) {
    remove_npc_from_place(from_place, entity_ref);
  } else {
    remove_actor_from_place(from_place, entity_ref);
  }
  save_place(slot, from_place);
  
  // Add to target place at default entry
  const entry_tile = to_place.tile_grid.default_entry;
  if (is_npc) {
    add_npc_to_place(to_place, entity_ref, entry_tile);
  } else {
    add_actor_to_place(to_place, entity_ref, entry_tile);
  }
  save_place(slot, to_place);
  
  // Update entity location
  const new_location = {
    world_tile: to_place.coordinates.world_tile,
    region_tile: to_place.coordinates.region_tile,
    place_id: target_place_id,
    tile: entry_tile,
    elevation: to_place.coordinates.elevation
  };
  
  if (is_npc) {
    await set_npc_location(slot, entity_id, new_location);
  } else {
    await set_actor_location(slot, entity_id, new_location);
  }
  
  return {
    ok: true,
    from_place_id,
    to_place_id: target_place_id,
    travel_time_seconds: connection.travel_time_seconds,
    travel_description: connection.description
  };
}

/**
 * Travel between regions
 */
export async function travel_between_regions(
  slot: number,
  entity_ref: string,
  target_region_coords: { world_x: number; world_y: number; region_x: number; region_y: number }
): Promise<TravelResult> {
  // This would handle regional travel with time advancement
  // For now, simplified version
  
  const travel_minutes = REGIONAL_TRAVEL_MINUTES;
  
  // Advance game time
  advance_time(slot, travel_minutes);
  
  return {
    ok: true,
    travel_time_seconds: travel_minutes * 60,
    travel_description: `Travelled to region at ${target_region_coords.world_x},${target_region_coords.world_y}.${target_region_coords.region_x},${target_region_coords.region_y}`
  };
}

/**
 * Helper: Update actor location (similar to NPC location)
 */
async function update_actor_location(
  slot: number,
  actor_id: string,
  updates: { tile?: TilePosition; place_id?: string }
): Promise<{ ok: boolean; error?: string }> {
  const actor_result = load_actor(slot, actor_id);
  
  if (!actor_result.ok) {
    return { ok: false, error: actor_result.error };
  }
  
  const actor = actor_result.actor;
  const location = (actor.location as Record<string, unknown>) || {};
  
  if (updates.tile) {
    location.tile = updates.tile;
  }
  if (updates.place_id) {
    location.place_id = updates.place_id;
  }
  
  actor.location = location;
  save_actor(slot, actor_id, actor);
  
  return { ok: true };
}

/**
 * Helper: Set actor location
 */
async function set_actor_location(
  slot: number,
  actor_id: string,
  location: {
    world_tile: { x: number; y: number };
    region_tile: { x: number; y: number };
    place_id: string;
    tile: TilePosition;
    elevation?: number;
  }
): Promise<void> {
  const actor_result = load_actor(slot, actor_id);
  
  if (actor_result.ok) {
    const actor = actor_result.actor;
    actor.location = location;
    save_actor(slot, actor_id, actor);
  }
}

/**
 * Check if travel is possible between two places
 */
export function can_travel_between_places(
  slot: number,
  from_place_id: string,
  to_place_id: string
): { possible: boolean; reason?: string } {
  const from_place = load_place(slot, from_place_id);
  
  if (!from_place.ok) {
    return { possible: false, reason: "from_place_not_found" };
  }
  
  const connection = from_place.place.connections.find(c => c.target_place_id === to_place_id);
  
  if (!connection) {
    return { possible: false, reason: "no_connection" };
  }
  
  if (connection.requires_key) {
    return { possible: false, reason: "requires_key" };
  }
  
  return { possible: true };
}

/**
 * Get available destinations from a place
 */
export function get_available_destinations(
  slot: number,
  place_id: string
): { place_id: string; direction: string; description: string }[] {
  const place_result = load_place(slot, place_id);
  
  if (!place_result.ok) {
    return [];
  }
  
  return place_result.place.connections.map(c => ({
    place_id: c.target_place_id,
    direction: c.direction,
    description: c.description
  }));
}

/**
 * Move NPC according to their schedule
 * This should be called periodically to update NPC positions
 */
export async function update_npc_position_for_schedule(
  slot: number,
  npc_id: string,
  game_time: GameTime
): Promise<{ moved: boolean; from_place?: string; to_place?: string }> {
  // Load NPC schedule
  const { load_schedule, get_scheduled_place } = await import("../npc_storage/schedule_manager.js");
  const schedule = load_schedule(slot, npc_id);
  
  if (!schedule) {
    return { moved: false };
  }
  
  // Get where NPC should be
  const scheduled = get_scheduled_place(schedule, game_time);
  
  // Get where NPC currently is
  const npc_result = load_npc(slot, npc_id);
  if (!npc_result.ok) {
    return { moved: false };
  }
  
  const current_place_id = get_npc_location(npc_result.npc)?.place_id;
  
  // Check if NPC needs to move
  if (current_place_id && current_place_id !== scheduled.place_id) {
    // Check if places are connected
    const can_travel = can_travel_between_places(slot, current_place_id, scheduled.place_id);
    
    if (can_travel.possible) {
      // Move NPC
      const travel_result = await travel_between_places(slot, `npc.${npc_id}`, scheduled.place_id);
      
      if (travel_result.ok) {
        return {
          moved: true,
          from_place: current_place_id,
          to_place: scheduled.place_id
        };
      }
    }
  }
  
  return { moved: false };
}

// TODO: Add pathfinding for tile movement
// TODO: Add obstacle avoidance
// TODO: Add stealth/sneak mechanics
// TODO: Add fatigue system for long travel
// TODO: Add mount/vehicle travel options
// TODO: Add travel interruption (combat, events)
// TODO: Add group travel coordination

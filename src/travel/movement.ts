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
import { find_path, is_tile_walkable } from "../shared/pathfinding.js";
import type { GameTime } from "../time_system/tracker.js";
import { load_place, save_place, get_default_place_for_region, list_places_in_region } from "../place_storage/store.js";
import { 
  get_tile_distance, 
  is_valid_tile_position,
  get_place_connection,
  add_actor_to_place,
  remove_actor_from_place,
  add_npc_to_place,
  remove_npc_from_place
} from "../place_storage/utils.js";
import { get_place_region_bounds, get_places_face_adjacency, is_region_voxel_inside_place, region_voxel_to_local_voxel } from "../shared/place_adjacency.js";
import { get_npc_location, set_npc_location, update_npc_location } from "../npc_storage/location.js";
import { load_actor, save_actor } from "../actor_storage/store.js";
import { load_npc, save_npc } from "../npc_storage/store.js";
import { advance_time } from "../time_system/tracker.js";
import { move_entity_in_index } from "../place_storage/entity_index.js";
import { end_conversations_involving_entity } from "../npc_ai/witness_handler.js";
import { MetaTagProcessor } from "../tag_system/meta_processor.js";
import { debug_log } from "../shared/debug.js";

function find_valid_entry_tile(place: Place, entity_ref: string, preferred: TilePosition): TilePosition {
  const width = Math.max(1, Math.floor(Number(place.tile_grid.width) || 1));
  const height = Math.max(1, Math.floor(Number(place.tile_grid.height) || 1));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const start: TilePosition = {
    x: clamp(Math.floor(Number(preferred.x) || 0), width > 2 ? 1 : 0, width > 2 ? width - 2 : width - 1),
    y: clamp(Math.floor(Number(preferred.y) || 0), height > 2 ? 1 : 0, height > 2 ? height - 2 : height - 1),
    z: typeof preferred.z === 'number' && Number.isFinite(preferred.z)
      ? Math.floor(preferred.z)
      : (Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0),
  };

  const ok0 = is_tile_walkable(place, start, {
    exclude_entity: entity_ref,
    treat_occupied_as_wall: true,
    movement_mode: 'WALK',
  });
  if (ok0) return start;

  const maxRadius = Math.max(width, height);
  for (let r = 1; r <= maxRadius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cand: TilePosition = {
          x: clamp(start.x + dx, width > 2 ? 1 : 0, width > 2 ? width - 2 : width - 1),
          y: clamp(start.y + dy, height > 2 ? 1 : 0, height > 2 ? height - 2 : height - 1),
          z: start.z,
        };
        if (is_tile_walkable(place, cand, {
          exclude_entity: entity_ref,
          treat_occupied_as_wall: true,
          movement_mode: 'WALK',
        })) {
          return cand;
        }
      }
    }
  }

  return start;
}

function is_same_region_adjacent(slot: number, from_place: Place, to_place_id: string): boolean {
  const region_id = String(from_place.region_id ?? "").trim();
  if (!region_id) return false;
  const target_res = load_place(slot, to_place_id);
  if (!target_res.ok) return false;
  const target_place = target_res.place;
  if (String(target_place.region_id ?? "") !== region_id) return false;
  return !!get_places_face_adjacency(from_place, target_place);
}

function get_adjacent_place_ids(slot: number, from_place: Place): string[] {
  const region_id = String(from_place.region_id ?? "").trim();
  if (!region_id) return [];
  const listed = list_places_in_region(slot, region_id);
  if (!listed.ok) return [];
  const ids: string[] = [];
  for (const candidate_id of listed.places) {
    const pid = String(candidate_id ?? "").trim();
    if (!pid || pid === from_place.id) continue;
    const target_res = load_place(slot, pid);
    if (!target_res.ok) continue;
    if (get_places_face_adjacency(from_place, target_res.place)) ids.push(pid);
  }
  return ids;
}

function resolve_same_region_entry_tile(from_place: Place, to_place: Place, current_location: { tile?: TilePosition; elevation?: number } | null | undefined): TilePosition | null {
  const tile = current_location?.tile;
  if (!tile || typeof tile.x !== "number" || typeof tile.y !== "number") return null;
  const from_bounds = get_place_region_bounds(from_place);
  const current_world_z = Number.isFinite(Number(current_location?.elevation))
    ? Math.floor(Number(current_location?.elevation))
    : Math.floor(Number((tile as any)?.z ?? from_bounds.origin.z ?? 0)) || 0;
  const world_region = {
    x: (Math.floor(Number(from_bounds.origin.x ?? 0)) || 0) + (Math.floor(Number(tile.x) || 0)),
    y: (Math.floor(Number(from_bounds.origin.y ?? 0)) || 0) + (Math.floor(Number(tile.y) || 0)),
    z: current_world_z,
  };
  if (!is_region_voxel_inside_place(to_place, world_region)) return null;
  const local = region_voxel_to_local_voxel(to_place, world_region);
  return {
    x: local.x,
    y: local.y,
    z: world_region.z,
  };
}

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

  // Unified legality + reservations (server-side travel semantics).
  // Travel/movement in this module is still coarse (it teleports to target),
  // but we must never move into blocked/reserved stance origins.
  {
    const pk = reservation_place_key(slot, place.id);
    const reserved = get_reserved_stance_origins(pk, entity_ref);

    const ok = is_tile_walkable(place, target_tile, {
      exclude_entity: entity_ref,
      treat_occupied_as_wall: true,
      movement_mode: "WALK",
      reserved_stance_origins: reserved,
    });

    if (!ok) {
      return { ok: false, error: "tile_blocked" };
    }

    // Reserve destination stance origin briefly to reduce multi-NPC contention.
    // (Reservations expire automatically; release is best-effort.)
    if (is_npc) {
      const z0 = Number((current_location as any)?.elevation);
      const z = Number.isFinite(z0) ? Math.floor(z0) : base_z(place);
      const reserved_ok = reserve_tile(place.id, target_tile, entity_ref, { slot, world_z: z, ttl_ms: 3000 });
      if (!reserved_ok) {
        return { ok: false, error: "tile_reserved" };
      }
      try {
        const cur = (current_location as any)?.tile;
        if (cur && typeof cur.x === "number" && typeof cur.y === "number") {
          release_tile(place.id, { x: cur.x, y: cur.y }, entity_ref, { slot, world_z: z });
        }
      } catch {
        // ignore
      }
    }
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
  const connection = get_place_connection(from_place, target_place_id);
  const adjacent = is_same_region_adjacent(slot, from_place, target_place_id);
  if (!connection && !adjacent) {
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
  
  const preferred_entry = adjacent
    ? (resolve_same_region_entry_tile(from_place, to_place, current_location) ?? to_place.tile_grid.default_entry)
    : to_place.tile_grid.default_entry;
  const entry_tile = find_valid_entry_tile(to_place, entity_ref, preferred_entry);
  debug_log('MOVE_VEL_TEST', 'travel destination placement resolved', {
    entity_ref,
    from_place_id,
    to_place_id: target_place_id,
    via_direction: connection?.direction ?? (adjacent ? 'seam' : null),
    adjacent,
    preferred_entry,
    entry_tile,
  });
  
  // Remove from current place
  if (is_npc) {
    remove_npc_from_place(from_place, entity_ref);
  } else {
    remove_actor_from_place(from_place, entity_ref);
  }
  save_place(slot, from_place);
  
  // Add to target place at the calculated entry position (near the door)
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
  
  // Update entity index for fast lookups
  move_entity_in_index(slot, entity_ref, from_place_id, target_place_id);

  // If an actor leaves a place, terminate any conversations/engagements in that place.
  // This prevents NPCs remaining "busy" and following after the player departs.
  if (!is_npc) {
    end_conversations_involving_entity(entity_ref, `left place ${from_place_id} -> ${target_place_id}`);
  }
  
  // Process dispersing tags when moving between places
  await MetaTagProcessor.processDispersingTags(slot);
  
  return {
    ok: true,
    from_place_id,
    to_place_id: target_place_id,
    travel_time_seconds: connection?.travel_time_seconds ?? 0,
    travel_description: connection?.description ?? (adjacent ? "Walk across seam" : "Travel")
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
  
  // Process dispersing tags after regional travel
  await MetaTagProcessor.processDispersingTags(slot);
  
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
  
  const connection = get_place_connection(from_place.place, to_place_id);
  const adjacent = is_same_region_adjacent(slot, from_place.place, to_place_id);

  if (!connection && !adjacent) {
    return { possible: false, reason: "no_connection" };
  }
  
  if (connection?.requires_key) {
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
  
  const adjacent_destinations = get_adjacent_place_ids(slot, place_result.place).map((adjacent_place_id) => ({
    place_id: adjacent_place_id,
    direction: 'seam',
    description: 'Walk across seam'
  }));
  const explicitDestinations = place_result.place.connections.map(c => ({
    place_id: c.target_place_id,
    direction: c.direction,
    description: c.description
  }));
  const merged = new Map<string, { place_id: string; direction: string; description: string }>();
  for (const dest of [...adjacent_destinations, ...explicitDestinations]) {
    if (!merged.has(dest.place_id)) merged.set(dest.place_id, dest);
  }
  return Array.from(merged.values());
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

// ============================================================================
// NPC FREE MOVEMENT PATHFINDING
// ============================================================================

type Reservation = { holder: string; expires_at_ms: number };

// Tile reservation system to prevent NPC collision.
// Reservations are stance-origin scoped: key format `x_y_z`.
// Keyed by `slot:place_id` to avoid cross-slot bleed.
const tile_reservations = new Map<string, Map<string, Reservation>>();

function reservation_place_key(slot: number, place_id: string): string {
  return `${slot}:${place_id}`;
}

function reservation_key(tile: TilePosition, world_z: number): string {
  return `${Math.floor(tile.x)}_${Math.floor(tile.y)}_${Math.floor(world_z)}`;
}

function base_z(place: Place): number {
  try {
    const z = Number((place as any)?.coordinates?.elevation);
    return Number.isFinite(z) ? Math.floor(z) : 0;
  } catch {
    return 0;
  }
}

function cleanup_expired_reservations(place_key: string): void {
  const m = tile_reservations.get(place_key);
  if (!m) return;
  const now = Date.now();
  for (const [k, r] of m) {
    if (!r || r.expires_at_ms <= now) m.delete(k);
  }
  if (m.size === 0) tile_reservations.delete(place_key);
}

function get_reserved_stance_origins(place_key: string, exclude_holder?: string): Set<string> {
  cleanup_expired_reservations(place_key);
  const m = tile_reservations.get(place_key);
  const out = new Set<string>();
  if (!m) return out;
  for (const [k, r] of m) {
    if (!r) continue;
    if (exclude_holder && r.holder === exclude_holder) continue;
    out.add(k);
  }
  return out;
}

/**
 * Reserve a tile for an NPC
 */
export function reserve_tile(
  place_id: string,
  tile: TilePosition,
  npc_ref: string,
  opts?: { slot?: number; world_z?: number; ttl_ms?: number }
): boolean {
  const slot = Number(opts?.slot ?? 1);
  const z = Math.floor(Number(opts?.world_z ?? 0));
  const ttl_ms = Math.max(250, Math.floor(Number(opts?.ttl_ms ?? 3000)));

  const pk = reservation_place_key(slot, place_id);
  cleanup_expired_reservations(pk);

  if (!tile_reservations.has(pk)) {
    tile_reservations.set(pk, new Map());
  }

  const place_reservations = tile_reservations.get(pk)!;
  const key = reservation_key(tile, z);

  const existing = place_reservations.get(key);
  if (existing && existing.holder !== npc_ref && existing.expires_at_ms > Date.now()) {
    return false;
  }

  place_reservations.set(key, { holder: npc_ref, expires_at_ms: Date.now() + ttl_ms });
  return true;
}

/**
 * Release a tile reservation
 */
export function release_tile(
  place_id: string,
  tile: TilePosition,
  npc_ref: string,
  opts?: { slot?: number; world_z?: number }
): void {
  const slot = Number(opts?.slot ?? 1);
  const z = Math.floor(Number(opts?.world_z ?? 0));
  const pk = reservation_place_key(slot, place_id);
  cleanup_expired_reservations(pk);

  const place_reservations = tile_reservations.get(pk);
  if (!place_reservations) return;

  const key = reservation_key(tile, z);
  const r = place_reservations.get(key);
  if (r && r.holder === npc_ref) {
    place_reservations.delete(key);
  }

  if (place_reservations.size === 0) tile_reservations.delete(pk);
}

/**
 * Get who has reserved a tile
 */
export function get_tile_reservation(
  place_id: string,
  tile: TilePosition,
  opts?: { slot?: number; world_z?: number }
): string | null {
  const slot = Number(opts?.slot ?? 1);
  const z = Math.floor(Number(opts?.world_z ?? 0));
  const pk = reservation_place_key(slot, place_id);
  cleanup_expired_reservations(pk);

  const place_reservations = tile_reservations.get(pk);
  if (!place_reservations) return null;

  const key = reservation_key(tile, z);
  const r = place_reservations.get(key);
  if (!r) return null;
  if (r.expires_at_ms <= Date.now()) {
    place_reservations.delete(key);
    return null;
  }
  return r.holder;
}

/**
 * Check if a tile is blocked by entities, features, or reservations
 */
export async function is_tile_blocked(
  slot: number,
  place: Place,
  tile: TilePosition,
  exclude_npc_ref?: string
): Promise<boolean> {
  const pk = reservation_place_key(slot, place.id);
  const reserved = get_reserved_stance_origins(pk, exclude_npc_ref);

  const walkable = is_tile_walkable(place, tile, {
    exclude_entity: exclude_npc_ref,
    treat_occupied_as_wall: true,
    movement_mode: "WALK",
    reserved_stance_origins: reserved,
  });

  return !walkable;
}

/**
 * BFS pathfinding for NPCs
 */
export async function find_path_for_npc(
  slot: number,
  place: Place,
  start: TilePosition,
  goal: TilePosition,
  npc_ref: string
): Promise<TilePosition[] | null> {
  if (!(find_path_for_npc as any).__move_unify_path_marker) {
    (find_path_for_npc as any).__move_unify_path_marker = true;
    // travel module runs in Node; still uses shared pathfinding.
    // This marker is meant for dev:logs verification.
    console.log('[MOVE_UNIFY_TEST]', 'travel find_path_for_npc uses shared pathfinding', { slot, place_id: place.id });
  }
  const pk = reservation_place_key(slot, place.id);
  const reserved = get_reserved_stance_origins(pk, npc_ref);

  const res = find_path(place, start, goal, {
    exclude_entity: npc_ref,
    allow_diagonal: false,
    max_iterations: 1000,
    treat_occupied_as_wall: true,
    movement_mode: "WALK",
    reserved_stance_origins: reserved,
  });

  if (res.blocked) return null;
  return res.path;
}

// TODO: Add obstacle avoidance
// TODO: Add stealth/sneak mechanics
// TODO: Add fatigue system for long travel
// TODO: Add mount/vehicle travel options
// TODO: Add travel interruption (combat, events)
// TODO: Add group travel coordination

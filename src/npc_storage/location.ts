/**
 * NPC Location Utilities with Place Support
 * 
 * Manages NPC positioning within the place system.
 * Provides functions to get/set NPC locations with place awareness.
 */

import type { NpcLookupResult } from "./store.js";
import { load_npc, save_npc } from "./store.js";

/**
 * NPC Location structure with place support
 */
export type NpcLocation = {
  world_tile: { x: number; y: number };
  region_tile: { x: number; y: number };
  place_id: string;  // NEW: Required field for place system
  tile: { x: number; y: number };
  elevation?: number;  // Optional: 0=surface, +1=above, -1=below
};

/**
 * Get NPC location with place support
 * Returns null if location field is missing or malformed
 */
export function get_npc_location(
  npc: Record<string, unknown>
): NpcLocation | null {
  const location = npc.location as Record<string, unknown> | undefined;
  
  if (!location) return null;
  
  // Check for required fields
  const world_tile = location.world_tile as { x: number; y: number } | undefined;
  const region_tile = location.region_tile as { x: number; y: number } | undefined;
  const tile = location.tile as { x: number; y: number } | undefined;
  const place_id = location.place_id as string | undefined;
  
  // For backward compatibility: if place_id is missing, try to derive from region
  // This is temporary until all NPCs are migrated
  if (!place_id && world_tile && region_tile) {
    // Return partial location - migration needed
    return {
      world_tile,
      region_tile,
      place_id: "",  // Empty indicates migration needed
      tile: tile ?? { x: 0, y: 0 },
      elevation: (location.elevation as number) ?? 0
    };
  }
  
  if (!world_tile || !region_tile || !tile || !place_id) {
    return null;
  }
  
  return {
    world_tile,
    region_tile,
    place_id,
    tile,
    elevation: (location.elevation as number) ?? 0
  };
}

/**
 * Set NPC location with place support
 * Updates the NPC object and saves to disk
 */
export function set_npc_location(
  slot: number,
  npc_id: string,
  location: NpcLocation
): { ok: boolean; error?: string } {
  const npc_result = load_npc(slot, npc_id);
  
  if (!npc_result.ok) {
    return { ok: false, error: npc_result.error };
  }
  
  const npc = npc_result.npc;
  npc.location = location;
  
  save_npc(slot, npc_id, npc);
  
  return { ok: true };
}

/**
 * Update NPC location (partial update)
 * Only updates provided fields
 */
export function update_npc_location(
  slot: number,
  npc_id: string,
  updates: Partial<NpcLocation>
): { ok: boolean; error?: string } {
  const npc_result = load_npc(slot, npc_id);
  
  if (!npc_result.ok) {
    return { ok: false, error: npc_result.error };
  }
  
  const npc = npc_result.npc;
  const current_location = get_npc_location(npc) ?? {
    world_tile: { x: 0, y: 0 },
    region_tile: { x: 0, y: 0 },
    place_id: "",
    tile: { x: 0, y: 0 },
    elevation: 0
  };
  
  npc.location = {
    ...current_location,
    ...updates
  };
  
  save_npc(slot, npc_id, npc);
  
  return { ok: true };
}

/**
 * Get NPC place ID
 * Returns null if NPC has no location or place_id
 */
export function get_npc_place_id(
  npc: Record<string, unknown>
): string | null {
  const location = get_npc_location(npc);
  return location?.place_id ?? null;
}

/**
 * Get NPC tile position within their place
 */
export function get_npc_tile_position(
  npc: Record<string, unknown>
): { x: number; y: number } | null {
  const location = get_npc_location(npc);
  return location?.tile ?? null;
}

/**
 * Check if NPC is in a specific place
 */
export function is_npc_in_place(
  npc: Record<string, unknown>,
  place_id: string
): boolean {
  const npc_place_id = get_npc_place_id(npc);
  return npc_place_id === place_id;
}

/**
 * Get NPC region coordinates
 */
export function get_npc_region_coords(
  npc: Record<string, unknown>
): { world_x: number; world_y: number; region_x: number; region_y: number } | null {
  const location = get_npc_location(npc);
  
  if (!location) return null;
  
  return {
    world_x: location.world_tile.x,
    world_y: location.world_tile.y,
    region_x: location.region_tile.x,
    region_y: location.region_tile.y
  };
}

/**
 * Format NPC location for display
 */
export function format_npc_location(npc: Record<string, unknown>): string {
  const location = get_npc_location(npc);
  
  if (!location) return "Unknown location";
  
  const { world_tile, region_tile, place_id, tile } = location;
  
  if (!place_id) {
    // Legacy format, migration needed
    return `Region: (${world_tile.x},${world_tile.y}).(${region_tile.x},${region_tile.y}) - Needs migration`;
  }
  
  return `${place_id} at tile (${tile.x}, ${tile.y})`;
}

/**
 * Create a reference string for NPC's current place
 * Returns format: place.<region_id>.<place_id>
 */
export function get_npc_place_ref(npc: Record<string, unknown>): string | null {
  const location = get_npc_location(npc);
  
  if (!location?.place_id) return null;
  
  // Parse place_id to get region
  const parts = location.place_id.split("_");
  if (parts.length < 2) return null;
  
  const place_suffix = parts.pop();
  const region_id = parts.join("_");
  
  return `place.${region_id}.${place_suffix}`;
}

/**
 * Create a reference string for NPC's tile position
 * Returns format: place_tile.<region_id>.<place_id>.<x>.<y>
 */
export function get_npc_place_tile_ref(npc: Record<string, unknown>): string | null {
  const location = get_npc_location(npc);
  
  if (!location?.place_id) return null;
  
  const parts = location.place_id.split("_");
  if (parts.length < 2) return null;
  
  const place_suffix = parts.pop();
  const region_id = parts.join("_");
  
  return `place_tile.${region_id}.${place_suffix}.${location.tile.x}.${location.tile.y}`;
}

/**
 * Check if two NPCs are in the same place
 */
export function are_npcs_in_same_place(
  npc1: Record<string, unknown>,
  npc2: Record<string, unknown>
): boolean {
  const place1 = get_npc_place_id(npc1);
  const place2 = get_npc_place_id(npc2);
  
  if (!place1 || !place2) return false;
  
  return place1 === place2;
}

/**
 * Calculate distance between two NPCs (if in same place)
 * Returns null if in different places or location unknown
 */
export function get_distance_between_npcs(
  npc1: Record<string, unknown>,
  npc2: Record<string, unknown>
): number | null {
  if (!are_npcs_in_same_place(npc1, npc2)) return null;
  
  const loc1 = get_npc_tile_position(npc1);
  const loc2 = get_npc_tile_position(npc2);
  
  if (!loc1 || !loc2) return null;
  
  const dx = loc1.x - loc2.x;
  const dy = loc1.y - loc2.y;
  
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Migration helper: Add place_id to NPC location
 * Call this for each NPC that needs migration
 */
export function migrate_npc_location_to_place(
  slot: number,
  npc_id: string,
  default_place_id: string
): { ok: boolean; error?: string } {
  const npc_result = load_npc(slot, npc_id);
  
  if (!npc_result.ok) {
    return { ok: false, error: npc_result.error };
  }
  
  const npc = npc_result.npc;
  const current_location = npc.location as Record<string, unknown> | undefined;
  
  if (!current_location) {
    return { ok: false, error: "npc_has_no_location" };
  }
  
  // Check if already has place_id
  if (current_location.place_id) {
    return { ok: true };  // Already migrated
  }
  
  // Add place_id
  current_location.place_id = default_place_id;
  
  // Ensure tile exists
  if (!current_location.tile) {
    current_location.tile = { x: 0, y: 0 };
  }
  
  // Add elevation if missing
  if (typeof current_location.elevation !== "number") {
    current_location.elevation = 0;
  }
  
  save_npc(slot, npc_id, npc);
  
  return { ok: true };
}

/**
 * Bulk migration: Migrate all NPCs in a region to a default place
 */
export function migrate_npcs_in_region_to_place(
  slot: number,
  region_id: string,
  default_place_id: string,
  npc_ids: string[]
): { migrated: number; errors: string[] } {
  const errors: string[] = [];
  let migrated = 0;
  
  for (const npc_id of npc_ids) {
    const result = migrate_npc_location_to_place(slot, npc_id, default_place_id);
    if (result.ok) {
      migrated++;
    } else {
      errors.push(`${npc_id}: ${result.error}`);
    }
  }
  
  return { migrated, errors };
}

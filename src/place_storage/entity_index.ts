/**
 * Place Entity Index
 * 
 * Spatial index mapping place_id -> entity_refs for fast lookups.
 * Updated in real-time when entities move.
 * 
 * DEBUG: This is a temporary/debug file (place_entity_index.jsonc)
 * Can be deleted/rebuilt at any time from entity locations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { debug_log, debug_warn, debug_error } from "../shared/debug.js";
import { get_data_slot_dir } from "../engine/paths.js";
import { find_npcs, load_npc } from "../npc_storage/store.js";
import { find_actors, load_actor } from "../actor_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";

const INDEX_FILE = "place_entity_index.jsonc";

// Index structure: place_id -> { npcs: [...], actors: [...], last_updated }
export type PlaceEntityEntry = {
  npcs: string[];      // npc_ref strings like "npc.gunther"
  actors: string[];    // actor_ref strings like "actor.henry_actor"
  last_updated: string; // ISO timestamp
};

export type PlaceEntityIndex = {
  schema_version: number;
  generated_at: string;
  places: Record<string, PlaceEntityEntry>;
};

const SCHEMA_VERSION = 1;

/**
 * Get path to index file for a data slot
 */
function get_index_path(slot: number): string {
  return path.join(get_data_slot_dir(slot), INDEX_FILE);
}

/**
 * Ensure index file exists with valid structure
 */
function ensure_index_file(slot: number): PlaceEntityIndex {
  const file_path = get_index_path(slot);
  
  if (!fs.existsSync(file_path)) {
    debug_log("PlaceEntityIndex", `Creating new index file for slot ${slot}`, { file_path });
    const empty_index: PlaceEntityIndex = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      places: {}
    };
    save_index(slot, empty_index);
    return empty_index;
  }
  
  try {
    const content = fs.readFileSync(file_path, "utf-8");
    const index = JSON.parse(content) as PlaceEntityIndex;
    
    // Validate structure
    if (!index.places || typeof index.places !== "object") {
      debug_warn("PlaceEntityIndex", `Invalid index structure in ${file_path}, recreating`, { index });
      const empty_index: PlaceEntityIndex = {
        schema_version: SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        places: {}
      };
      save_index(slot, empty_index);
      return empty_index;
    }
    
    return index;
  } catch (err) {
    debug_error("PlaceEntityIndex", `Failed to parse index file ${file_path}`, err);
    const empty_index: PlaceEntityIndex = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      places: {}
    };
    save_index(slot, empty_index);
    return empty_index;
  }
}

/**
 * Save index to disk
 */
function save_index(slot: number, index: PlaceEntityIndex): boolean {
  const file_path = get_index_path(slot);
  try {
    fs.writeFileSync(file_path, JSON.stringify(index, null, 2), "utf-8");
    return true;
  } catch (err) {
    debug_error("PlaceEntityIndex", `Failed to save index to ${file_path}`, err);
    return false;
  }
}

/**
 * Get all entity refs for a place
 */
export function get_entities_in_place(slot: number, place_id: string): { npcs: string[]; actors: string[] } {
  const index = ensure_index_file(slot);
  const entry = index.places[place_id];
  
  if (!entry) {
    debug_log("PlaceEntityIndex", `No entities found in place ${place_id}`, { slot });
    return { npcs: [], actors: [] };
  }
  
  debug_log("PlaceEntityIndex", `Retrieved entities for place ${place_id}`, {
    slot,
    npc_count: entry.npcs.length,
    actor_count: entry.actors.length,
    last_updated: entry.last_updated
  });
  
  return {
    npcs: [...entry.npcs],
    actors: [...entry.actors]
  };
}

/**
 * Add entity to a place in the index
 */
export function add_entity_to_place_index(
  slot: number,
  entity_ref: string,
  place_id: string
): boolean {
  debug_log("PlaceEntityIndex", `Adding ${entity_ref} to place ${place_id}`, { slot });
  
  const index = ensure_index_file(slot);
  
  if (!index.places[place_id]) {
    index.places[place_id] = {
      npcs: [],
      actors: [],
      last_updated: new Date().toISOString()
    };
  }
  
  const entry = index.places[place_id];
  const is_npc = entity_ref.startsWith("npc.");
  const is_actor = entity_ref.startsWith("actor.");
  
  if (!is_npc && !is_actor) {
    debug_warn("PlaceEntityIndex", `Invalid entity_ref format: ${entity_ref}`, { slot });
    return false;
  }
  
  const list = is_npc ? entry.npcs : entry.actors;
  
  if (list.includes(entity_ref)) {
    debug_log("PlaceEntityIndex", `Entity ${entity_ref} already in place ${place_id}`, { slot });
    return true;
  }
  
  list.push(entity_ref);
  entry.last_updated = new Date().toISOString();
  
  const success = save_index(slot, index);
  if (success) {
    debug_log("PlaceEntityIndex", `Successfully added ${entity_ref} to ${place_id}`, {
      slot,
      total_npcs: entry.npcs.length,
      total_actors: entry.actors.length
    });
  }
  return success;
}

/**
 * Remove entity from a place in the index
 */
export function remove_entity_from_place_index(
  slot: number,
  entity_ref: string,
  place_id: string
): boolean {
  debug_log("PlaceEntityIndex", `Removing ${entity_ref} from place ${place_id}`, { slot });
  
  const index = ensure_index_file(slot);
  const entry = index.places[place_id];
  
  if (!entry) {
    debug_warn("PlaceEntityIndex", `Place ${place_id} not found in index when removing ${entity_ref}`, { slot });
    return false;
  }
  
  const is_npc = entity_ref.startsWith("npc.");
  const list = is_npc ? entry.npcs : entry.actors;
  const idx = list.indexOf(entity_ref);
  
  if (idx === -1) {
    debug_warn("PlaceEntityIndex", `Entity ${entity_ref} not found in place ${place_id}`, { slot });
    return false;
  }
  
  list.splice(idx, 1);
  entry.last_updated = new Date().toISOString();
  
  // Clean up empty places
  if (entry.npcs.length === 0 && entry.actors.length === 0) {
    delete index.places[place_id];
    debug_log("PlaceEntityIndex", `Removed empty place entry ${place_id}`, { slot });
  }
  
  const success = save_index(slot, index);
  if (success) {
    debug_log("PlaceEntityIndex", `Successfully removed ${entity_ref} from ${place_id}`, {
      slot,
      remaining_npcs: entry.npcs?.length ?? 0,
      remaining_actors: entry.actors?.length ?? 0
    });
  }
  return success;
}

/**
 * Move entity from one place to another
 * Convenience function that handles both remove and add
 */
export function move_entity_in_index(
  slot: number,
  entity_ref: string,
  from_place_id: string | null,
  to_place_id: string
): boolean {
  debug_log("PlaceEntityIndex", `Moving ${entity_ref} from ${from_place_id ?? "(none)"} to ${to_place_id}`, { slot });
  
  let success = true;
  
  if (from_place_id && from_place_id !== to_place_id) {
    success = remove_entity_from_place_index(slot, entity_ref, from_place_id) && success;
  }
  
  success = add_entity_to_place_index(slot, entity_ref, to_place_id) && success;
  
  return success;
}

/**
 * Rebuild entire index from scratch
 * Scans all NPC and actor files to populate index
 */
export function rebuild_place_entity_index(slot: number): { 
  ok: boolean; 
  stats?: { places: number; npcs: number; actors: number };
  error?: string 
} {
  debug_log("PlaceEntityIndex", `Starting full index rebuild for slot ${slot}`);
  
  try {
    const new_index: PlaceEntityIndex = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      places: {}
    };
    

    
    // Scan all NPCs
    let npc_count = 0;
    const npcs = find_npcs(slot, {}).filter((n: { id: string }) => n.id !== "default_npc");
    debug_log("PlaceEntityIndex", `Found ${npcs.length} NPCs to index`, { slot });
    
    for (const npc_hit of npcs) {
      const npc_res = load_npc(slot, npc_hit.id);
      if (!npc_res.ok) {
        debug_warn("PlaceEntityIndex", `Failed to load NPC ${npc_hit.id}`, { slot, error: npc_res.error });
        continue;
      }
      
      const location = get_npc_location(npc_res.npc);
      if (!location?.place_id) {
        debug_log("PlaceEntityIndex", `NPC ${npc_hit.id} has no place_id, skipping`, { slot });
        continue;
      }
      
      const place_id = location.place_id;
      const npc_ref = `npc.${npc_hit.id}`;
      
      if (!new_index.places[place_id]) {
        new_index.places[place_id] = { npcs: [], actors: [], last_updated: new Date().toISOString() };
      }
      
      new_index.places[place_id].npcs.push(npc_ref);
      npc_count++;
    }
    
    // Scan all actors
    let actor_count = 0;
    const actors = find_actors(slot, {});
    debug_log("PlaceEntityIndex", `Found ${actors.length} actors to index`, { slot });
    
    for (const actor_hit of actors) {
      const actor_res = load_actor(slot, actor_hit.id);
      if (!actor_res.ok) {
        debug_warn("PlaceEntityIndex", `Failed to load actor ${actor_hit.id}`, { slot, error: actor_res.error });
        continue;
      }
      
      const actor = actor_res.actor;
      const location = (actor.location as { place_id?: string })?.place_id;
      
      if (!location) {
        debug_log("PlaceEntityIndex", `Actor ${actor_hit.id} has no place_id, skipping`, { slot });
        continue;
      }
      
      const place_id = location;
      const actor_ref = `actor.${actor_hit.id}`;
      
      if (!new_index.places[place_id]) {
        new_index.places[place_id] = { npcs: [], actors: [], last_updated: new Date().toISOString() };
      }
      
      new_index.places[place_id].actors.push(actor_ref);
      actor_count++;
    }
    
    // Save the rebuilt index
    const save_success = save_index(slot, new_index);
    if (!save_success) {
      return { ok: false, error: "Failed to save rebuilt index" };
    }
    
    const stats = {
      places: Object.keys(new_index.places).length,
      npcs: npc_count,
      actors: actor_count
    };
    
    debug_log("PlaceEntityIndex", `Index rebuild complete`, { slot, stats });
    return { ok: true, stats };
    
  } catch (err) {
    const error_msg = err instanceof Error ? err.message : String(err);
    debug_error("PlaceEntityIndex", `Index rebuild failed`, { slot, error: error_msg });
    return { ok: false, error: error_msg };
  }
}

/**
 * Purge the index file (for cleanup/debugging)
 */
export function purge_place_entity_index(slot: number): boolean {
  const file_path = get_index_path(slot);
  
  if (!fs.existsSync(file_path)) {
    debug_log("PlaceEntityIndex", `No index file to purge for slot ${slot}`, { file_path });
    return true;
  }
  
  try {
    fs.unlinkSync(file_path);
    debug_log("PlaceEntityIndex", `Purged index file for slot ${slot}`, { file_path });
    return true;
  } catch (err) {
    debug_error("PlaceEntityIndex", `Failed to purge index file ${file_path}`, err);
    return false;
  }
}

/**
 * Debug: Get full index contents
 */
export function debug_get_full_index(slot: number): PlaceEntityIndex | null {
  try {
    return ensure_index_file(slot);
  } catch (err) {
    debug_error("PlaceEntityIndex", `Failed to get full index for slot ${slot}`, err);
    return null;
  }
}

/**
 * NPC Movement System
 * 
 * Integrates NPCs into the unified movement engine.
 * NPCs share the same movement infrastructure as actors.
 */

import type { Place, TilePosition } from "../types/place.js";
import { debug_log } from "../shared/debug.js";
import {
  init_movement_engine,
  start_entity_movement,
  get_entity_path,
  get_movement_state,
  register_place,
  unregister_place,
  type MovementGoal,
} from "../shared/movement_engine.js";
import { find_path } from "../shared/pathfinding.js";

// Store place data
const place_data = new Map<string, Place>();
const active_place_ids = new Set<string>();
const wandering_timeouts = new Map<string, ReturnType<typeof setTimeout>>();
let engine_initialized = false;

// Callback for UI updates
let on_place_update: ((place: Place) => void) | null = null;
// Callback for spawning path particles
let on_path_start: ((path: TilePosition[]) => void) | null = null;

/**
 * Initialize NPC movement system
 */
export function init_npc_movement(
  update_callback: (place: Place) => void,
  path_callback?: (path: TilePosition[]) => void
): void {
  on_place_update = update_callback;
  on_path_start = path_callback || null;
  
  if (!engine_initialized) {
    init_movement_engine((updated_place) => {
      // Forward update to UI
      if (on_place_update) {
        on_place_update(updated_place);
      }
    });
    engine_initialized = true;
  }
}

/**
 * Register a place for NPC movement
 */
export function init_place_movement(place_id: string, place: Place): void {
  if (active_place_ids.has(place_id)) {
    // Update place data
    place_data.set(place_id, place);
    return;
  }

  place_data.set(place_id, place);
  active_place_ids.add(place_id);
  register_place(place_id, place);

  debug_log("NPC_Movement", `Initialized movement for place ${place_id}`, {
    npc_count: place.contents.npcs_present.length,
  });

  // Start wandering behavior for all NPCs
  for (const npc of place.contents.npcs_present) {
    start_npc_wandering(place_id, npc.npc_ref);
  }
}

/**
 * Stop tracking movement for a place
 */
export function stop_place_movement(place_id: string): void {
  if (!active_place_ids.has(place_id)) {
    return;
  }

  // Cancel all wandering timeouts for NPCs in this place
  const place = place_data.get(place_id);
  if (place) {
    for (const npc of place.contents.npcs_present) {
      const timeout_id = wandering_timeouts.get(npc.npc_ref);
      if (timeout_id) {
        clearTimeout(timeout_id);
        wandering_timeouts.delete(npc.npc_ref);
      }
    }
  }

  active_place_ids.delete(place_id);
  place_data.delete(place_id);
  unregister_place(place_id);

  debug_log("NPC_Movement", `Stopped movement for place ${place_id}`);
}

/**
 * Start an NPC wandering
 */
function start_npc_wandering(place_id: string, npc_ref: string): void {
  const place = place_data.get(place_id);
  if (!place) return;

  // Find NPC
  const npc = place.contents.npcs_present.find(n => n.npc_ref === npc_ref);
  if (!npc) return;

  // Pick random destination
  const width = place.tile_grid.width;
  const height = place.tile_grid.height;
  
  const target = {
    x: 1 + Math.floor(Math.random() * (width - 2)),
    y: 1 + Math.floor(Math.random() * (height - 2)),
  };

  // Check if path exists
  const path_result = find_path(place, npc.tile_position, target, {
    exclude_entity: npc_ref,
  });

  if (path_result.blocked || path_result.path.length === 0) {
    // Try again later
    setTimeout(() => start_npc_wandering(place_id, npc_ref), 2000);
    return;
  }

  // Start movement
  // NPC walk speed: 300 tiles per minute (5 tiles per second)
  const tiles_per_minute = 300;
  
  const goal = {
    type: "wander" as const,
    target_position: target,
    priority: 1,
    reason: "Wandering around",
  };
  
  const started = start_entity_movement(
    npc_ref,
    "npc",
    place,
    goal,
    tiles_per_minute,
    undefined, // on_complete
    (path) => {
      // on_start callback - spawn path particles
      if (on_path_start) {
        on_path_start(path);
      }
    }
  );

  if (started) {
    debug_log("NPC_Movement", `${npc_ref} started wandering to (${target.x}, ${target.y})`);
    
    // Schedule next wander after this one completes
    // 300 tiles per minute = 200ms per tile (60000ms / 300 tiles)
    const ms_per_tile = 60000 / tiles_per_minute;
    const duration_ms = path_result.path.length * ms_per_tile;
    const timeout_id = setTimeout(() => {
      wandering_timeouts.delete(npc_ref);
      if (active_place_ids.has(place_id)) {
        start_npc_wandering(place_id, npc_ref);
      }
    }, duration_ms + 3000); // Add 3s pause between moves
    
    wandering_timeouts.set(npc_ref, timeout_id);
  } else {
    // Failed to start, try again later
    const timeout_id = setTimeout(() => {
      wandering_timeouts.delete(npc_ref);
      start_npc_wandering(place_id, npc_ref);
    }, 2000);
    
    wandering_timeouts.set(npc_ref, timeout_id);
  }
}

/**
 * Force an NPC to stop and reassess
 */
export function force_npc_reassess(npc_ref: string): void {
  // In unified engine, this happens automatically when path is blocked
  debug_log("NPC_Movement", `${npc_ref} forced reassess`);
}

/**
 * Get movement summary
 */
export function get_npc_movement_summary(): {
  active_places: number;
  active_npcs: number;
} {
  return {
    active_places: active_place_ids.size,
    active_npcs: place_data.size, // Approximate
  };
}

/**
 * Get path for visualization
 */
export function get_npc_path(npc_ref: string) {
  return get_entity_path(npc_ref);
}

/**
 * Check if NPC is moving
 */
export function is_npc_moving(npc_ref: string): boolean {
  return get_movement_state(npc_ref)?.is_moving ?? false;
}

// Re-export types for compatibility
export type { MovementGoal } from "../shared/movement_engine.js";

/**
 * Unified Movement Engine
 * 
 * Shared movement system for all entities (actors and NPCs).
 * Features:
 * - Per-entity speeds based on kind stats
 * - Step-based architecture (for future timed interactions)
 * - Shared pathfinding
 * - Smooth interpolation
 * - Failed path visualization
 */

import type { Place, TilePosition } from "../types/place.js";
import { find_path, type PathResult } from "./pathfinding.js";
import { debug_log, DEBUG_LEVEL } from "./debug.js";

// Default speed: 300 tiles per minute (5 tiles per second = 200ms per tile)
// Faster for better gameplay feel
const DEFAULT_SPEED_TPM = 300;

// Convert tiles per minute to milliseconds per tile
function tpm_to_mspt(tiles_per_minute: number): number {
  if (tiles_per_minute <= 0) return 15000; // Default 15s per tile
  return (60 * 1000) / tiles_per_minute; // ms per tile
}

/** Types of movement goals */
export type MovementGoalType = 
  | "move_to"      // Go to specific tile
  | "follow"       // Follow target entity
  | "wander"       // Random exploration
  | "patrol"       // Patrol route
  | "flee";        // Run away

/** A movement goal */
export type MovementGoal = {
  type: MovementGoalType;
  target_position?: TilePosition;
  target_entity?: string;
  priority: number;
  reason: string;
};

/** Movement state for any entity */
export type EntityMovementState = {
  entity_ref: string;
  entity_type: "actor" | "npc";
  
  // Current movement
  goal: MovementGoal | null;
  path: TilePosition[];
  path_index: number;
  is_moving: boolean;
  
  // Timing (step-based)
  speed_tpm: number;           // Tiles per minute
  ms_per_tile: number;         // Calculated from speed
  last_step_time: number;      // Timestamp of last step
  next_step_time: number;      // When next step should occur
  
  // Step counter (for beat/tick system)
  step_count: number;
  total_distance: number;
  
  // Visual
  show_path: boolean;
  path_color: "white" | "red"; // Red for blocked/failed paths
  
  // Status
  blocked_since?: number;
  failed_path?: boolean;
  
  // Callback when complete
  on_complete?: () => void;
};

// Store all entity movement states
const movement_states = new Map<string, EntityMovementState>();

// Callback when place needs visual update
let on_place_update: ((place: Place) => void) | null = null;

// Track active places
const active_places = new Map<string, Place>();
let is_running = false;
let interval_id: ReturnType<typeof setInterval> | null = null;

// Configuration
const TICK_RATE_MS = 50; // 20Hz for smooth interpolation
const PATH_VISUAL_DURATION_MS = 2000; // How long to show red failed paths

/**
 * Initialize movement engine
 */
export function init_movement_engine(
  place_update_callback: (place: Place) => void
): void {
  on_place_update = place_update_callback;
  
  if (!is_running) {
    start_engine();
  }
}

/**
 * Start the movement engine loop
 */
function start_engine(): void {
  if (is_running || interval_id) return;
  
  is_running = true;
  interval_id = setInterval(() => {
    void engine_tick();
  }, TICK_RATE_MS);
  
  debug_log("MovementEngine", "Started", { tick_rate_ms: TICK_RATE_MS });
}

/**
 * Stop the movement engine
 */
export function stop_engine(): void {
  if (interval_id) {
    clearInterval(interval_id);
    interval_id = null;
  }
  is_running = false;
  movement_states.clear();
  active_places.clear();
  debug_log("MovementEngine", "Stopped");
}

/**
 * Register a place for movement processing
 */
export function register_place(place_id: string, place: Place): void {
  active_places.set(place_id, place);
}

/**
 * Unregister a place
 */
export function unregister_place(place_id: string): void {
  const place = active_places.get(place_id);
  active_places.delete(place_id);
  
  // Clean up any movement states for entities in this place
  if (place) {
    // Remove all actor movement states
    for (const actor of place.contents.actors_present) {
      movement_states.delete(actor.actor_ref);
    }
    // Remove all NPC movement states
    for (const npc of place.contents.npcs_present) {
      movement_states.delete(npc.npc_ref);
    }
  }
}

/**
 * Start movement for an entity
 */
export function start_entity_movement(
  entity_ref: string,
  entity_type: "actor" | "npc",
  place: Place,
  goal: MovementGoal,
  speed_tpm: number = DEFAULT_SPEED_TPM,
  on_complete?: () => void,
  on_start?: (path: TilePosition[]) => void
): boolean {
  const current_pos = get_entity_position(place, entity_ref, entity_type);
  if (!current_pos) {
    debug_log("MovementEngine", `${entity_ref} not found in place`);
    return false;
  }
  
  // Calculate path
  const path_result = calculate_path(place, current_pos, goal, entity_ref);
  
  // Create movement state
  const ms_per_tile = tpm_to_mspt(speed_tpm);
  const now = Date.now();
  
  const state: EntityMovementState = {
    entity_ref,
    entity_type,
    goal,
    path: path_result.path,
    path_index: 0,
    is_moving: path_result.path.length > 0 && !path_result.blocked,
    speed_tpm,
    ms_per_tile,
    last_step_time: now,
    next_step_time: now + ms_per_tile,
    step_count: 0,
    total_distance: path_result.path.length,
    show_path: true,
    path_color: path_result.blocked ? "red" : "white",
    failed_path: path_result.blocked,
    on_complete,
  };
  
  movement_states.set(entity_ref, state);
  
  if (path_result.blocked) {
    debug_log("MovementEngine", `${entity_ref} path blocked`, { 
      blocked_at: path_result.blocked_at 
    });
    // Schedule cleanup of failed path visualization
    setTimeout(() => {
      const s = movement_states.get(entity_ref);
      if (s && s.failed_path) {
        movement_states.delete(entity_ref);
      }
    }, PATH_VISUAL_DURATION_MS);
    return false;
  }
  
  debug_log("MovementEngine", `${entity_ref} started moving`, {
    path_length: path_result.path.length,
    speed_tpm,
    ms_per_tile,
  });
  
  // Call on_start callback with the path for particle spawning
  if (on_start) {
    on_start(path_result.path);
  }
  
  return true;
}

/**
 * Stop entity movement
 */
export function stop_entity_movement(entity_ref: string): void {
  const state = movement_states.get(entity_ref);
  if (state) {
    state.is_moving = false;
    state.show_path = false;
    movement_states.delete(entity_ref);
    debug_log("MovementEngine", `${entity_ref} stopped`);
  }
}

/**
 * Get entity position from place data
 */
function get_entity_position(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc"
): TilePosition | null {
  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    return actor?.tile_position ?? null;
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    return npc?.tile_position ?? null;
  }
}

/**
 * Calculate path for a goal
 */
function calculate_path(
  place: Place,
  start: TilePosition,
  goal: MovementGoal,
  entity_ref: string
): PathResult {
  if (!goal.target_position) {
    return { path: [], blocked: true };
  }
  
  return find_path(place, start, goal.target_position, {
    exclude_entity: entity_ref,
    allow_diagonal: false,
    treat_occupied_as_wall: true,
  });
}

/**
 * Main engine tick - processes all active movements
 */
async function engine_tick(): Promise<void> {
  const now = Date.now();
  
  for (const [entity_ref, state] of movement_states) {
    if (!state.is_moving) continue;
    
    // Find which place this entity is in
    const place = find_entity_place(entity_ref);
    if (!place) continue;
    
    // Check if it's time for next step
    if (now >= state.next_step_time) {
      debug_log("MovementEngine", `${entity_ref} executing step ${state.step_count}/${state.total_distance}`);
      await execute_step(entity_ref, state, place);
    }
  }
}

/**
 * Execute one movement step
 */
async function execute_step(
  entity_ref: string,
  state: EntityMovementState,
  place: Place
): Promise<void> {
  // Get next tile
  const next_tile = state.path[state.path_index];
  if (!next_tile) {
    // Path complete
    complete_movement(entity_ref, state, place);
    return;
  }
  
  // Move entity
  const success = move_entity_to_tile(place, entity_ref, state.entity_type, next_tile);
  
  if (success) {
    state.path_index++;
    state.step_count++;
    state.last_step_time = Date.now();
    state.next_step_time = state.last_step_time + state.ms_per_tile;
    
    // Check if complete
    if (state.path_index >= state.path.length) {
      complete_movement(entity_ref, state, place);
    } else {
      // Notify UI of position change
      if (on_place_update) {
        on_place_update(place);
      }
    }
  } else {
    // Move failed (tile became blocked)
    debug_log("MovementEngine", `${entity_ref} step blocked`);
    state.is_moving = false;
    state.failed_path = true;
    state.path_color = "red";
    
    // Schedule cleanup
    setTimeout(() => {
      movement_states.delete(entity_ref);
      if (on_place_update) {
        on_place_update(place);
      }
    }, PATH_VISUAL_DURATION_MS);
  }
}

/**
 * Move entity to a tile
 */
function move_entity_to_tile(
  place: Place,
  entity_ref: string,
  entity_type: "actor" | "npc",
  tile: TilePosition
): boolean {
  if (entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (!actor) return false;
    actor.tile_position = tile;
    actor.status = "moving";
    return true;
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (!npc) return false;
    npc.tile_position = tile;
    npc.status = "moving";
    return true;
  }
}

/**
 * Complete movement
 */
function complete_movement(
  entity_ref: string,
  state: EntityMovementState,
  place: Place
): void {
  state.is_moving = false;
  state.show_path = false;
  
  // Update status to present
  if (state.entity_type === "actor") {
    const actor = place.contents.actors_present.find(a => a.actor_ref === entity_ref);
    if (actor) actor.status = "present";
  } else {
    const npc = place.contents.npcs_present.find(n => n.npc_ref === entity_ref);
    if (npc) npc.status = "present";
  }
  
  // Call completion callback
  if (state.on_complete) {
    state.on_complete();
  }
  
  movement_states.delete(entity_ref);
  
  debug_log("MovementEngine", `${entity_ref} completed movement`, {
    steps: state.step_count,
    distance: state.total_distance,
  });
  
  if (on_place_update) {
    on_place_update(place);
  }
}

/**
 * Find which place contains an entity
 */
function find_entity_place(entity_ref: string): Place | undefined {
  for (const place of active_places.values()) {
    const is_actor = place.contents.actors_present.some(a => a.actor_ref === entity_ref);
    const is_npc = place.contents.npcs_present.some(n => n.npc_ref === entity_ref);
    if (is_actor || is_npc) {
      return place;
    }
  }
  // Only log at trace level to avoid spam - entity may have moved to inactive place
  if (DEBUG_LEVEL >= 4) {
    debug_log("MovementEngine", `${entity_ref} not found in any active place`);
  }
  return undefined;
}

/**
 * Get movement state for an entity
 */
export function get_movement_state(entity_ref: string): EntityMovementState | undefined {
  return movement_states.get(entity_ref);
}

/**
 * Get all active movement states
 */
export function get_all_movement_states(): EntityMovementState[] {
  return Array.from(movement_states.values());
}

/**
 * Get interpolated position for smooth rendering
 * Returns position between tiles based on timing
 */
export function get_interpolated_position(
  entity_ref: string
): TilePosition | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.is_moving) return null;
  
  const now = Date.now();
  const time_since_last = now - state.last_step_time;
  const progress = Math.min(time_since_last / state.ms_per_tile, 1);
  
  // Get current and next tile
  const current_idx = Math.max(0, state.path_index - 1);
  const next_idx = state.path_index;
  
  if (current_idx >= state.path.length || next_idx >= state.path.length) {
    return null;
  }
  
  const current = state.path[current_idx];
  const next = state.path[next_idx];
  
  if (!current || !next) return null;
  
  // Interpolate
  return {
    x: current.x + (next.x - current.x) * progress,
    y: current.y + (next.y - current.y) * progress,
  };
}

/**
 * Check if entity is currently moving
 */
export function is_entity_moving(entity_ref: string): boolean {
  const state = movement_states.get(entity_ref);
  return state?.is_moving ?? false;
}

/**
 * Get entity's current path for visualization
 */
export function get_entity_path(entity_ref: string): { 
  path: TilePosition[]; 
  color: "white" | "red";
  show: boolean;
} | null {
  const state = movement_states.get(entity_ref);
  if (!state || !state.show_path) return null;
  
  return {
    path: state.path,
    color: state.path_color,
    show: state.show_path,
  };
}

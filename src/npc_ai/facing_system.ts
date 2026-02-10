/**
 * NPC/Entity Facing System
 * 
 * Tracks which direction entities are facing for vision cone calculations.
 * Updates automatically based on movement and actions.
 * 
 * The 8 directions match the THAUMWORLD tabletop system:
 * - Cardinal: north, south, east, west
 * - Ordinal: northeast, northwest, southeast, southwest
 */

import type { TilePosition } from "../types/place.js";
import { debug_log } from "../shared/debug.js";

/** 8-directional facing */
export type Direction = 
  | "north" 
  | "south" 
  | "east" 
  | "west" 
  | "northeast" 
  | "northwest" 
  | "southeast" 
  | "southwest";

/** Facing state for an entity */
export interface FacingState {
  entity_ref: string;
  direction: Direction;
  last_updated: number;  // Timestamp
  facing_target?: string; // Entity ref if facing a specific target
}

// In-memory storage - Map<entity_ref, FacingState>
const facing_states = new Map<string, FacingState>();

/**
 * Initialize facing state for an entity
 * Called when entity is created or enters a place
 */
export function init_facing(entity_ref: string, initial_direction: Direction = "south"): FacingState {
  const state: FacingState = {
    entity_ref,
    direction: initial_direction,
    last_updated: Date.now()
  };
  
  facing_states.set(entity_ref, state);
  debug_log("Facing", `Initialized facing for ${entity_ref}: ${initial_direction}`);
  
  return state;
}

/**
 * Get facing direction for an entity
 * Returns south as default if not set
 */
export function get_facing(entity_ref: string): Direction {
  return facing_states.get(entity_ref)?.direction ?? "south";
}

/**
 * Get full facing state for an entity
 */
export function get_facing_state(entity_ref: string): FacingState | undefined {
  return facing_states.get(entity_ref);
}

/**
 * Set facing direction directly
 */
export function set_facing(entity_ref: string, direction: Direction): void {
  const state = facing_states.get(entity_ref);
  
  if (state) {
    state.direction = direction;
    state.last_updated = Date.now();
    state.facing_target = undefined; // Clear target when manually setting
  } else {
    // Initialize if not exists
    init_facing(entity_ref, direction);
  }
  
  debug_log("Facing", `${entity_ref} now facing ${direction}`);
}

// Movement history for fluid diagonal detection
const movement_history = new Map<string, Array<{ dx: number; dy: number; timestamp: number }>>();
const HISTORY_WINDOW_MS = 500; // Consider movements within 500ms
const HISTORY_MAX_ENTRIES = 5; // Keep last 5 movements

/**
 * Calculate direction based on movement delta
 * Used when entity moves to automatically face direction of travel
 * 
 * Enhanced with fluid diagonal detection: tracks recent movement history
 * to detect diagonal patterns from zigzag cardinal movements
 */
export function calculate_direction(from: TilePosition, to: TilePosition, entity_ref?: string): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  
  // If we have an entity_ref, track movement history for fluid diagonal detection
  if (entity_ref) {
    const now = Date.now();
    let history = movement_history.get(entity_ref) || [];
    
    // Add current movement to history
    history.push({ dx, dy, timestamp: now });
    
    // Remove old entries outside the time window
    history = history.filter(entry => now - entry.timestamp < HISTORY_WINDOW_MS);
    
    // Keep only last N entries
    if (history.length > HISTORY_MAX_ENTRIES) {
      history = history.slice(-HISTORY_MAX_ENTRIES);
    }
    
    movement_history.set(entity_ref, history);
    
    // Calculate cumulative direction from history
    if (history.length >= 2) {
      const total_dx = history.reduce((sum, entry) => sum + entry.dx, 0);
      const total_dy = history.reduce((sum, entry) => sum + entry.dy, 0);
      
      // If there's a clear diagonal trend, use it
      if (Math.abs(total_dx) >= 1 && Math.abs(total_dy) >= 1) {
        const ndx = total_dx > 0 ? 1 : -1;
        const ndy = total_dy > 0 ? 1 : -1;
        
        if (ndx === 1 && ndy === 1) return "northeast";
        if (ndx === -1 && ndy === 1) return "northwest";
        if (ndx === 1 && ndy === -1) return "southeast";
        if (ndx === -1 && ndy === -1) return "southwest";
      }
    }
  }
  
  // Single-tile movement: normalize to -1, 0, 1
  const ndx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const ndy = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  
  // Map to direction
  if (ndx === 0 && ndy === 1) return "north";
  if (ndx === 0 && ndy === -1) return "south";
  if (ndx === 1 && ndy === 0) return "east";
  if (ndx === -1 && ndy === 0) return "west";
  if (ndx === 1 && ndy === 1) return "northeast";
  if (ndx === -1 && ndy === 1) return "northwest";
  if (ndx === 1 && ndy === -1) return "southeast";
  if (ndx === -1 && ndy === -1) return "southwest";
  
  // Default if no movement
  return "south";
}

/**
 * Clear movement history for an entity
 * Call when entity stops moving or leaves place
 */
export function clear_movement_history(entity_ref: string): void {
  movement_history.delete(entity_ref);
}

/**
 * Update facing based on movement
 * Called automatically when entity moves between tiles
 * 
 * Uses fluid diagonal detection to maintain diagonal facing during
 * zigzag cardinal movements (e.g., 1 up 1 right 1 up 1 right)
 */
export function update_facing_on_move(
  entity_ref: string,
  from: TilePosition,
  to: TilePosition
): void {
  // Only update if there's actual movement
  if (from.x === to.x && from.y === to.y) return;
  
  const direction = calculate_direction(from, to, entity_ref);
  set_facing(entity_ref, direction);
}

/**
 * Face a specific target entity
 * Used when communicating, attacking, or inspecting
 */
export function face_target(
  entity_ref: string,
  target_ref: string,
  target_pos: TilePosition,
  observer_pos: TilePosition
): void {
  const direction = calculate_direction(observer_pos, target_pos);
  
  const state = facing_states.get(entity_ref);
  if (state) {
    state.direction = direction;
    state.last_updated = Date.now();
    state.facing_target = target_ref;
  } else {
    const new_state = init_facing(entity_ref, direction);
    new_state.facing_target = target_ref;
  }
  
  // Clear movement history when manually facing (override auto-facing)
  clear_movement_history(entity_ref);
  
  debug_log("Facing", `${entity_ref} facing target ${target_ref}: ${direction}`);
}

/**
 * Update facing to track a moving target
 * Call this periodically when in "converse" goal or similar
 */
export function update_facing_to_track(
  entity_ref: string,
  target_ref: string,
  get_target_position: (ref: string) => TilePosition | null
): boolean {
  const state = facing_states.get(entity_ref);
  if (!state || state.facing_target !== target_ref) return false;
  
  const target_pos = get_target_position(target_ref);
  if (!target_pos) return false;
  
  // We need observer position - this would come from entity storage
  // For now, just update the target tracking timestamp
  state.last_updated = Date.now();
  
  return true;
}

/**
 * Remove facing state for an entity
 * Call when entity leaves place or is destroyed
 */
export function remove_facing(entity_ref: string): void {
  facing_states.delete(entity_ref);
  clear_movement_history(entity_ref);
  debug_log("Facing", `Removed facing state for ${entity_ref}`);
}

/**
 * Check if entity is facing a specific target
 */
export function is_facing_target(entity_ref: string, target_ref: string): boolean {
  return facing_states.get(entity_ref)?.facing_target === target_ref;
}

/**
 * Get all tracked entity refs
 */
export function get_all_tracked_entities(): string[] {
  return Array.from(facing_states.keys());
}

/**
 * Clear all facing states
 * Use for cleanup/shutdown
 */
export function clear_all_facing(): void {
  facing_states.clear();
  debug_log("Facing", "Cleared all facing states");
}

/**
 * Convert direction to angle in radians
 * Useful for vision cone calculations
 */
export function direction_to_angle(direction: Direction): number {
  switch (direction) {
    case "north": return Math.PI / 2;
    case "south": return -Math.PI / 2;
    case "east": return 0;
    case "west": return Math.PI;
    case "northeast": return Math.PI / 4;
    case "northwest": return 3 * Math.PI / 4;
    case "southeast": return -Math.PI / 4;
    case "southwest": return -3 * Math.PI / 4;
    default: return 0;
  }
}

/**
 * Convert direction to arrow character for debugging
 */
export function direction_to_arrow(direction: Direction): string {
  switch (direction) {
    case "north": return "↑";
    case "south": return "↓";
    case "east": return "→";
    case "west": return "←";
    case "northeast": return "↗";
    case "northwest": return "↖";
    case "southeast": return "↘";
    case "southwest": return "↙";
    default: return "•";
  }
}

/**
 * Get the opposite direction
 */
export function opposite_direction(direction: Direction): Direction {
  switch (direction) {
    case "north": return "south";
    case "south": return "north";
    case "east": return "west";
    case "west": return "east";
    case "northeast": return "southwest";
    case "southwest": return "northeast";
    case "northwest": return "southeast";
    case "southeast": return "northwest";
    default: return "south";
  }
}

/**
 * Check if a direction is cardinal (N, S, E, W)
 */
export function is_cardinal(direction: Direction): boolean {
  return ["north", "south", "east", "west"].includes(direction);
}

/**
 * Check if a direction is ordinal (NE, NW, SE, SW)
 */
export function is_ordinal(direction: Direction): boolean {
  return ["northeast", "northwest", "southeast", "southwest"].includes(direction);
}

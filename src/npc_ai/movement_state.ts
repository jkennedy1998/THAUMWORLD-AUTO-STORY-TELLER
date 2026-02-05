/**
 * NPC Movement State Management
 * 
 * Tracks real-time movement state for each NPC during free movement mode.
 * Each NPC has a MovementState that persists across ticks but not across server restarts.
 * 
 * State includes:
 * - Current goal (what they want to do)
 * - Current action (what they're doing right now)
 * - Movement path and progress
 * - Timestamps for reassessment decisions
 * 
 * This system runs during non-timed events only. During timed events,
 * the turn manager takes over.
 */

import type { TilePosition } from "../types/place.js";
import { debug_log } from "../shared/debug.js";

/** Types of goals NPCs can pursue */
export type GoalType = 
  | "wander"      // Random exploration
  | "patrol"      // Follow waypoints
  | "interact"    // Use a feature
  | "social"      // Move toward others
  | "follow"      // Follow target entity
  | "flee"        // Move away from threat
  | "rest";       // Stand/sit idle

/** A goal the NPC is trying to achieve */
export type Goal = {
  type: GoalType;
  target_position?: TilePosition;    // Where they need to go
  target_entity?: string;            // npc.<id> or actor.<id>
  target_feature?: string;           // Feature ID
  priority: number;                  // 1-10, higher = more urgent
  created_at: number;                // When goal was set
  expires_at?: number;               // When goal becomes stale
  reason: string;                    // Why this goal was chosen (for debugging)
};

/** Types of actions NPCs can perform */
export type ActionType =
  | "moving"      // Walking to destination
  | "waiting"     // Waiting for something
  | "interacting" // Using a feature
  | "animating"   // Playing an animation
  | "idle";       // Doing nothing

/** Current action being performed */
export type Action = {
  type: ActionType;
  started_at: number;                // When action began
  duration_ms?: number;              // Expected duration
  target?: TilePosition | string;    // What the action targets
};

/** Complete movement state for an NPC */
export type MovementState = {
  npc_ref: string;
  
  // Current state
  current_goal: Goal | null;
  current_action: Action | null;
  
  // Movement
  path: TilePosition[];              // Full path to goal
  path_index: number;                // Current position in path
  is_moving: boolean;
  
  // Timestamps
  last_reassess_time: number;        // Last time we picked a new goal
  blocked_since?: number;            // When path became blocked
  wait_until?: number;               // Don't reassess until this time
  
  // Position tracking
  last_position: TilePosition;       // For detecting actual movement
  stuck_count: number;               // How many ticks position hasn't changed
};

/** Configuration for movement system */
export const MOVEMENT_CONFIG = {
  // Timing
  TICK_RATE_MS: 250,                 // 4Hz update rate
  REASSESS_MIN_MS: 10000,            // Min 10s between goal changes
  REASSESS_MAX_MS: 30000,            // Max 30s (adds randomness)
  BLOCKED_TIMEOUT_MS: 3000,          // Wait 3s before repathing
  TILES_PER_SECOND: 1,               // Movement speed
  
  // Stuck detection
  STUCK_THRESHOLD: 4,                // Ticks without movement = stuck
  
  // Pathfinding
  MAX_PATH_LENGTH: 50,               // Don't path further than this
  MAX_NPCS_PER_TICK: 5,              // Process this many NPCs per tick
};

// In-memory state storage - Map<npc_ref, MovementState>
const movement_states = new Map<string, MovementState>();

/**
 * Get or create movement state for an NPC
 */
export function get_movement_state(npc_ref: string): MovementState | undefined {
  return movement_states.get(npc_ref);
}

/**
 * Initialize movement state for an NPC
 */
export function init_movement_state(
  npc_ref: string,
  current_position: TilePosition
): MovementState {
  const now = Date.now();
  const state: MovementState = {
    npc_ref,
    current_goal: null,
    current_action: null,
    path: [],
    path_index: 0,
    is_moving: false,
    last_reassess_time: now,
    last_position: current_position,
    stuck_count: 0,
  };
  
  movement_states.set(npc_ref, state);
  debug_log("NPC_Movement", `Initialized movement state for ${npc_ref}`, {
    position: current_position
  });
  
  return state;
}

/**
 * Remove movement state (when NPC leaves place or system shuts down)
 */
export function remove_movement_state(npc_ref: string): void {
  movement_states.delete(npc_ref);
  debug_log("NPC_Movement", `Removed movement state for ${npc_ref}`);
}

/**
 * Update movement state
 */
export function update_movement_state(
  npc_ref: string,
  updates: Partial<MovementState>
): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  Object.assign(state, updates);
}

/**
 * Set a new goal for an NPC
 */
export function set_goal(
  npc_ref: string,
  goal: Goal,
  path: TilePosition[] = []
): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  const now = Date.now();
  
  state.current_goal = goal;
  state.path = path;
  state.path_index = 0;
  state.last_reassess_time = now;
  state.blocked_since = undefined;
  state.stuck_count = 0;
  
  // Set action based on goal
  if (path.length > 0) {
    state.current_action = {
      type: "moving",
      started_at: now,
      target: path[0],
    };
    state.is_moving = true;
  } else {
    state.current_action = {
      type: "idle",
      started_at: now,
    };
    state.is_moving = false;
  }
  
  debug_log("NPC_Movement", `Set goal for ${npc_ref}`, {
    type: goal.type,
    priority: goal.priority,
    reason: goal.reason,
    path_length: path.length
  });
}

/**
 * Clear current goal (goal completed or abandoned)
 */
export function clear_goal(npc_ref: string, reason: string): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  state.current_goal = null;
  state.path = [];
  state.path_index = 0;
  state.is_moving = false;
  state.current_action = {
    type: "idle",
    started_at: Date.now(),
  };
  
  debug_log("NPC_Movement", `Cleared goal for ${npc_ref}`, { reason });
}

/**
 * Check if NPC should reassess their goal
 */
export function should_reassess(state: MovementState): boolean {
  const now = Date.now();
  
  // ALWAYS reassess if no goal (priority check)
  if (!state.current_goal) {
    return true;
  }
  
  // Don't reassess too frequently
  if (state.wait_until && now < state.wait_until) {
    return false;
  }
  
  const time_since_reassess = now - state.last_reassess_time;
  const min_interval = MOVEMENT_CONFIG.REASSESS_MIN_MS;
  
  if (time_since_reassess < min_interval) {
    return false;
  }
  
  // Reassess if:
  
  // 2. Goal expired
  if (state.current_goal.expires_at && now > state.current_goal.expires_at) {
    return true;
  }
  
  // 3. Path blocked for too long
  if (state.blocked_since && (now - state.blocked_since > MOVEMENT_CONFIG.BLOCKED_TIMEOUT_MS)) {
    return true;
  }
  
  // 4. Stuck (not moving despite trying)
  if (state.stuck_count >= MOVEMENT_CONFIG.STUCK_THRESHOLD) {
    return true;
  }
  
  // 5. Max time elapsed (with randomness to desync NPCs)
  const max_interval = MOVEMENT_CONFIG.REASSESS_MAX_MS;
  const random_offset = Math.random() * 5000; // 0-5s random variance
  if (time_since_reassess > (max_interval + random_offset)) {
    return true;
  }
  
  return false;
}

/**
 * Mark path as blocked
 */
export function mark_blocked(npc_ref: string): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  if (!state.blocked_since) {
    state.blocked_since = Date.now();
    debug_log("NPC_Movement", `Path blocked for ${npc_ref}`);
  }
}

/**
 * Mark path as unblocked
 */
export function mark_unblocked(npc_ref: string): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  if (state.blocked_since) {
    state.blocked_since = undefined;
    debug_log("NPC_Movement", `Path unblocked for ${npc_ref}`);
  }
}

/**
 * Advance to next step in path
 */
export function advance_path(npc_ref: string): TilePosition | null {
  const state = movement_states.get(npc_ref);
  if (!state || state.path.length === 0) {
    return null;
  }
  
  state.path_index++;
  
  if (state.path_index >= state.path.length) {
    // Reached destination
    state.is_moving = false;
    state.current_action = {
      type: "idle",
      started_at: Date.now(),
    };
    return null;
  }
  
  const next_tile = state.path[state.path_index];
  if (!next_tile) {
    return null;
  }
  
  state.current_action = {
    type: "moving",
    started_at: Date.now(),
    target: next_tile,
  };
  
  return next_tile;
}

/**
 * Get current target tile (next step in path)
 */
export function get_current_target(state: MovementState): TilePosition | null {
  if (!state.is_moving || state.path.length === 0) {
    return null;
  }
  const target = state.path[state.path_index];
  return target ?? null;
}

/**
 * Update position tracking (call every tick)
 */
export function update_position_tracking(
  npc_ref: string,
  current_position: TilePosition
): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  const moved = (
    current_position.x !== state.last_position.x ||
    current_position.y !== state.last_position.y
  );
  
  if (moved) {
    state.last_position = current_position;
    state.stuck_count = 0;
    mark_unblocked(npc_ref);
  } else if (state.is_moving) {
    // Trying to move but position didn't change
    state.stuck_count++;
    if (state.stuck_count >= MOVEMENT_CONFIG.STUCK_THRESHOLD) {
      mark_blocked(npc_ref);
    }
  }
}

/**
 * Get all tracked NPC refs
 */
export function get_all_tracked_npcs(): string[] {
  return Array.from(movement_states.keys());
}

/**
 * Clear all movement states (for cleanup/shutdown)
 */
export function clear_all_movement_states(): void {
  movement_states.clear();
  debug_log("NPC_Movement", "Cleared all movement states");
}

/**
 * Set cooldown before next reassessment
 */
export function set_reassess_cooldown(npc_ref: string, duration_ms: number): void {
  const state = movement_states.get(npc_ref);
  if (!state) return;
  
  state.wait_until = Date.now() + duration_ms;
}

/**
 * Format state for debugging
 */
export function format_state_summary(state: MovementState): string {
  const parts = [
    `NPC: ${state.npc_ref}`,
    `Goal: ${state.current_goal?.type ?? "none"}`,
    `Action: ${state.current_action?.type ?? "none"}`,
    `Moving: ${state.is_moving}`,
    `Path: ${state.path_index}/${state.path.length}`,
  ];
  return parts.join(" | ");
}

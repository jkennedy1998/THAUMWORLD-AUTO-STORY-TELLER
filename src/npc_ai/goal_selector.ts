/**
 * NPC Goal Selector
 * 
 * Determines what goals NPCs should pursue during free movement.
 * Uses heuristics, personality, schedule, and environment - NOT LLM calls.
 * 
 * Goal selection is lightweight and runs every 10-30 seconds per NPC.
 * Complex narrative decisions are still handled by the main NPC AI (when player communicates).
 */

import type { Place, TilePosition, PlaceFeature } from "../types/place.js";
import type { Goal, GoalType } from "./movement_state.js";
import { load_npc } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { load_schedule, get_current_activity } from "../npc_storage/schedule_manager.js";
import type { GameTime } from "../time_system/tracker.js";
import { debug_log } from "../shared/debug.js";

/** Context for goal selection */
export type GoalContext = {
  slot: number;
  place: Place;
  game_time: GameTime;
  other_npcs: string[];           // Other NPC refs in same place
  player_actors: string[];        // Player actor refs in same place
  recent_events: string[];        // Recent notable events
};

/** NPC personality traits relevant to goals */
export type PersonalityProfile = {
  social: number;                 // 0-10, higher = more social
  energetic: number;              // 0-10, higher = more active
  curious: number;                // 0-10, higher = explores more
  role: string;                   // "guard", "shopkeeper", "villager", etc.
  schedule_driven: boolean;       // Follows schedule strictly?
};

/** Priority levels for goals */
const PRIORITY = {
  CRITICAL: 10,    // Fleeing danger
  HIGH: 8,         // Schedule obligations, important tasks
  MEDIUM: 5,       // Social, exploration
  LOW: 3,          // Idle wandering
  IDLE: 1,         // Doing nothing
};

/**
 * Select a goal for an NPC based on context
 * This is the main entry point - returns the best goal or null if no change needed
 */
export function select_goal(
  npc_ref: string,
  context: GoalContext
): Goal | null {
  const npc_id = npc_ref.replace("npc.", "");
  const npc_result = load_npc(context.slot, npc_id);
  
  if (!npc_result.ok) {
    debug_log("NPC_Goals", `Failed to load NPC ${npc_id}`);
    return null;
  }
  
  const npc = npc_result.npc;
  const personality = extract_personality(npc);
  const current_pos = get_current_position(npc);
  
  debug_log("NPC_Goals", `${npc_ref} personality:`, personality);
  
  // 1. Check schedule (highest priority for schedule-driven NPCs)
  const schedule_goal = check_schedule_goal(npc_ref, npc, context, personality);
  debug_log("NPC_Goals", `${npc_ref} schedule_goal:`, schedule_goal);
  if (schedule_goal && schedule_goal.priority >= PRIORITY.HIGH) {
    return schedule_goal;
  }
  
  // 2. Check if should react to environment
  const environment_goal = check_environment_goal(npc_ref, npc, context, current_pos);
  debug_log("NPC_Goals", `${npc_ref} environment_goal:`, environment_goal);
  if (environment_goal && environment_goal.priority >= PRIORITY.MEDIUM) {
    return environment_goal;
  }
  
  // 3. Check social opportunities
  const social_goal = check_social_goal(npc_ref, npc, context, current_pos, personality);
  debug_log("NPC_Goals", `${npc_ref} social_goal:`, social_goal);
  if (social_goal && personality.social >= 5) {
    return social_goal;
  }
  
  // 4. Default behavior based on personality
  if (schedule_goal) {
    // Follow schedule even if low priority
    return schedule_goal;
  }
  
  // 5. Generate default goal based on personality
  const default_goal = generate_default_goal(npc_ref, context, current_pos, personality);
  debug_log("NPC_Goals", `${npc_ref} default_goal:`, default_goal);
  return default_goal;
}

/**
 * Extract personality profile from NPC data
 */
function extract_personality(npc: Record<string, unknown>): PersonalityProfile {
  const personality = (npc.personality as Record<string, unknown>) ?? {};
  const role = String(npc.role ?? "villager");
  
  // Default values
  let social = 5;
  let energetic = 5;
  let curious = 5;
  let schedule_driven = false;
  
  // Extract from personality
  if (personality.social) {
    social = Number(personality.social);
  } else if (personality.extraversion) {
    social = Number(personality.extraversion);
  }
  
  if (personality.energy) {
    energetic = Number(personality.energy);
  }
  
  if (personality.curiosity) {
    curious = Number(personality.curiosity);
  }
  
  // Role-based adjustments
  if (role === "guard" || role === "shopkeeper") {
    schedule_driven = true;
    energetic = Math.max(energetic, 6);
  } else if (role === "elder" || role === "scholar") {
    schedule_driven = true;
    social = Math.min(social, 4);
  }
  
  return {
    social: Math.max(1, Math.min(10, social)),
    energetic: Math.max(1, Math.min(10, energetic)),
    curious: Math.max(1, Math.min(10, curious)),
    role,
    schedule_driven,
  };
}

/**
 * Get NPC's current tile position
 */
function get_current_position(npc: Record<string, unknown>): TilePosition {
  const location = get_npc_location(npc);
  return location?.tile ?? { x: 0, y: 0 };
}

/**
 * Check if NPC should follow schedule
 */
function check_schedule_goal(
  npc_ref: string,
  npc: Record<string, unknown>,
  context: GoalContext,
  personality: PersonalityProfile
): Goal | null {
  const npc_id = npc_ref.replace("npc.", "");
  const schedule = load_schedule(context.slot, npc_id);
  
  if (!schedule) {
    return null;
  }
  
  const activity_result = get_current_activity(schedule, context.game_time);
  if (!activity_result.current_entry) {
    return null;
  }
  
  const entry = activity_result.current_entry;
  const current_place_id = get_npc_location(npc)?.place_id;
  
  // If not in right place, travel there
  if (entry.place_id !== current_place_id) {
    // This would require place-to-place travel, handled separately
    // For now, just return null - travel system handles place changes
    return null;
  }
  
  // If in right place, do scheduled activity
  // Check for specific tile position first
  if (entry.tile_position) {
    return {
      type: "interact",
      target_position: entry.tile_position,
      priority: personality.schedule_driven ? PRIORITY.HIGH : PRIORITY.MEDIUM,
      created_at: Date.now(),
      expires_at: Date.now() + entry.duration_minutes * 60 * 1000,
      reason: `Scheduled: ${entry.description}`,
    };
  }
  
  // Otherwise, just wander/idle at the location
  return {
    type: "rest",
    priority: personality.schedule_driven ? PRIORITY.HIGH : PRIORITY.LOW,
    created_at: Date.now(),
    expires_at: Date.now() + entry.duration_minutes * 60 * 1000,
    reason: `Scheduled activity: ${entry.description}`,
  };
}

/**
 * Check if NPC should react to environment features
 */
function check_environment_goal(
  npc_ref: string,
  npc: Record<string, unknown>,
  context: GoalContext,
  current_pos: TilePosition
): Goal | null {
  const features = context.place.contents.features;
  
  if (features.length === 0) {
    return null;
  }
  
  // Look for interesting features nearby
  const interesting_features = features.filter(f => {
    // Check if within reasonable distance
    const feature_pos = f.tile_positions[0];
    if (!feature_pos) return false;
    
    const distance = Math.abs(feature_pos.x - current_pos.x) + 
                     Math.abs(feature_pos.y - current_pos.y);
    
    // Features within 10 tiles are "nearby"
    return distance <= 10 && f.is_interactable;
  });
  
  if (interesting_features.length === 0) {
    return null;
  }
  
  // Pick a random interesting feature
  const feature = interesting_features[Math.floor(Math.random() * interesting_features.length)];
  if (!feature) {
    return null;
  }
  
  const feature_pos = feature.tile_positions[0];
  
  if (!feature_pos) {
    return null;
  }
  
  return {
    type: "interact",
    target_feature: feature.id,
    target_position: feature_pos,
    priority: PRIORITY.MEDIUM,
    created_at: Date.now(),
    expires_at: Date.now() + 5 * 60 * 1000, // 5 minutes
    reason: `Interact with ${feature.name}`,
  };
}

/**
 * Check if NPC should pursue social goal
 */
function check_social_goal(
  npc_ref: string,
  npc: Record<string, unknown>,
  context: GoalContext,
  current_pos: TilePosition,
  personality: PersonalityProfile
): Goal | null {
  // Only social NPCs pursue social goals
  if (personality.social < 4) {
    return null;
  }
  
  // Find potential social targets
  const targets: string[] = [];
  
  // Other NPCs
  for (const other_ref of context.other_npcs) {
    if (other_ref !== npc_ref) {
      targets.push(other_ref);
    }
  }
  
  // Player actors (higher priority)
  for (const actor_ref of context.player_actors) {
    targets.push(actor_ref);
  }
  
  if (targets.length === 0) {
    return null;
  }
  
  // Pick random target
  const target = targets[Math.floor(Math.random() * targets.length)];
  
  return {
    type: "social",
    target_entity: target,
    priority: context.player_actors.length > 0 ? PRIORITY.MEDIUM + 1 : PRIORITY.MEDIUM,
    created_at: Date.now(),
    expires_at: Date.now() + 3 * 60 * 1000, // 3 minutes
    reason: `Approach ${target}`,
  };
}

/**
 * Generate default goal based on personality
 */
function generate_default_goal(
  npc_ref: string,
  context: GoalContext,
  current_pos: TilePosition,
  personality: PersonalityProfile
): Goal {
  const roll = Math.random();
  
  // Role-based defaults
  if (personality.role === "guard") {
    return generate_patrol_goal(context, current_pos);
  }
  
  if (personality.role === "shopkeeper") {
    return generate_counter_goal(context);
  }
  
  // Personality-based
  if (personality.energetic >= 7 && roll < 0.6) {
    return generate_wander_goal(context, current_pos);
  }
  
  if (personality.curious >= 7 && roll < 0.4) {
    return generate_explore_goal(context, current_pos);
  }
  
  if (personality.social >= 7 && roll < 0.3) {
    // Will try social goal next tick if people nearby
    return generate_wait_goal(context, current_pos, "Looking for someone to talk to");
  }
  
  // Default: wander or rest
  if (roll < 0.7) {
    return generate_wander_goal(context, current_pos);
  }
  
  return generate_rest_goal(context, current_pos);
}

/**
 * Generate patrol goal (for guards)
 */
function generate_patrol_goal(context: GoalContext, current_pos: TilePosition): Goal {
  // Pick a random edge or corner of the place
  const width = context.place.tile_grid.width;
  const height = context.place.tile_grid.height;
  
  const patrol_points = [
    { x: 2, y: 2 },
    { x: width - 3, y: 2 },
    { x: width - 3, y: height - 3 },
    { x: 2, y: height - 3 },
  ];
  
  const target = patrol_points[Math.floor(Math.random() * patrol_points.length)];
  
  return {
    type: "patrol",
    target_position: target,
    priority: PRIORITY.MEDIUM,
    created_at: Date.now(),
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes
    reason: "Patrolling the area",
  };
}

/**
 * Generate counter/station goal (for shopkeepers)
 */
function generate_counter_goal(context: GoalContext): Goal {
  // Find a central feature or use default entry
  const features = context.place.contents.features;
  const counter = features.find(f => 
    f.name.toLowerCase().includes("counter") ||
    f.name.toLowerCase().includes("bar") ||
    f.name.toLowerCase().includes("table")
  );
  
  if (counter) {
    return {
      type: "interact",
      target_feature: counter.id,
      target_position: counter.tile_positions[0],
      priority: PRIORITY.MEDIUM,
      created_at: Date.now(),
      expires_at: Date.now() + 15 * 60 * 1000, // 15 minutes
      reason: "Working at the counter",
    };
  }
  
  // Default to entry point
  return {
    type: "rest",
    target_position: context.place.tile_grid.default_entry,
    priority: PRIORITY.MEDIUM,
    created_at: Date.now(),
    expires_at: Date.now() + 10 * 60 * 1000,
    reason: "Standing at post",
  };
}

/**
 * Generate wander goal
 */
function generate_wander_goal(context: GoalContext, current_pos: TilePosition): Goal {
  const width = context.place.tile_grid.width;
  const height = context.place.tile_grid.height;
  
  // Pick random position within bounds (with margin)
  const target = {
    x: 1 + Math.floor(Math.random() * (width - 2)),
    y: 1 + Math.floor(Math.random() * (height - 2)),
  };
  
  return {
    type: "wander",
    target_position: target,
    priority: PRIORITY.LOW,
    created_at: Date.now(),
    expires_at: Date.now() + 3 * 60 * 1000, // 3 minutes
    reason: "Wandering around",
  };
}

/**
 * Generate exploration goal (go to new area)
 */
function generate_explore_goal(context: GoalContext, current_pos: TilePosition): Goal {
  // Go to opposite side of place
  const width = context.place.tile_grid.width;
  const height = context.place.tile_grid.height;
  
  const target = {
    x: current_pos.x < width / 2 ? width - 2 : 1,
    y: current_pos.y < height / 2 ? height - 2 : 1,
  };
  
  return {
    type: "wander",
    target_position: target,
    priority: PRIORITY.LOW,
    created_at: Date.now(),
    expires_at: Date.now() + 5 * 60 * 1000,
    reason: "Exploring the area",
  };
}

/**
 * Generate wait/idle goal
 */
function generate_wait_goal(
  context: GoalContext,
  current_pos: TilePosition,
  reason: string
): Goal {
  return {
    type: "rest",
    target_position: current_pos,
    priority: PRIORITY.IDLE,
    created_at: Date.now(),
    expires_at: Date.now() + 2 * 60 * 1000, // 2 minutes
    reason,
  };
}

/**
 * Generate rest goal (find place to sit/stand)
 */
function generate_rest_goal(context: GoalContext, current_pos: TilePosition): Goal {
  // Look for seating
  const seats = context.place.contents.features.filter(f =>
    f.name.toLowerCase().includes("chair") ||
    f.name.toLowerCase().includes("stool") ||
    f.name.toLowerCase().includes("bench")
  );
  
  if (seats.length > 0) {
    const seat = seats[Math.floor(Math.random() * seats.length)];
    if (seat) {
      return {
        type: "interact",
        target_feature: seat.id,
        target_position: seat.tile_positions[0],
        priority: PRIORITY.LOW,
        created_at: Date.now(),
        expires_at: Date.now() + 5 * 60 * 1000,
        reason: "Taking a seat",
      };
    }
  }
  
  // Just idle where standing
  return generate_wait_goal(context, current_pos, "Resting");
}

/**
 * Get position for a goal
 * Returns target position or null if goal doesn't require movement
 */
export function get_goal_position(goal: Goal): TilePosition | null {
  if (goal.target_position) {
    return goal.target_position;
  }
  
  // Some goals don't require specific positions
  if (goal.type === "rest" || goal.type === "flee") {
    return null;
  }
  
  return null;
}

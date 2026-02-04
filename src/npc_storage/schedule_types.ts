/**
 * NPC Schedule System
 * 
 * Manages NPC daily schedules including:
 * - Time-based location changes
 * - Activity goals at each location
 * - Schedule modifications based on life events
 * - Integration with global time system
 */

import type { GameTime } from "../time_system/tracker.js";

/**
 * A single scheduled activity for an NPC
 */
export type NPCScheduleEntry = {
  id: string;                    // Unique ID for this entry
  name: string;                  // Activity name (e.g., "Morning Patrol")
  
  // Time
  start_time: number;            // Minutes from start of day (0-1439)
  duration_minutes: number;      // How long this activity lasts
  end_time: number;              // Calculated: start_time + duration
  
  // Location
  place_id: string;              // Primary location for this activity
  alternative_place_ids?: string[]; // Alternative places if primary unavailable
  tile_position?: { x: number; y: number }; // Specific tile within place
  
  // Activity details
  activity_type: ScheduleActivityType;
  description: string;           // What NPC is doing
  
  // Goals (temporary for this activity)
  temporary_goal?: string;       // Short-term goal during this activity
  
  // Conditions
  conditions?: ScheduleConditions; // When this schedule applies
  
  // Priority for schedule conflicts
  priority: number;              // Higher = more important (1-10)
  
  // Can be interrupted?
  interruptible: boolean;
  
  // Flexibility
  flexible_start?: number;       // Minutes of flexibility (+-)
  flexible_duration?: number;    // Can be shorter/longer
};

export type ScheduleActivityType =
  | "sleep"           // Sleeping/resting
  | "work"            // Working (shop, guard duty, etc.)
  | "travel"          // Moving between places
  | "social"          // Socializing, meetings
  | "personal"        // Personal time, hobbies
  | "meal"            // Eating
  | "patrol"          // Patrolling/walking around
  | "study"           // Reading, learning
  | "pray"            // Religious activities
  | "guard"           // Guarding specific location
  | "craft"           // Crafting/making things
  | "shop"            // Shopping/buying
  | "entertain"       // Performing/entertaining
  | "explore"         // Exploring/wandering
  | "wait";           // Waiting for something/someone

export type ScheduleConditions = {
  weather?: ("clear" | "rain" | "snow" | "storm")[];
  season?: ("spring" | "summer" | "fall" | "winter")[];
  day_of_week?: number[];        // 0-6
  required_tags?: string[];      // NPC must have these tags
  excluded_tags?: string[];      // NPC must NOT have these tags
  min_health_percent?: number;   // Minimum health required
  special_event?: string;        // Only during specific events
};

/**
 * Full daily schedule for an NPC
 */
export type NPCSchedule = {
  schema_version: 1;
  npc_id: string;
  
  // Schedule entries (typically 4-6 per day)
  entries: NPCScheduleEntry[];
  
  // Default schedule (fallback if no entry matches)
  default_place_id: string;
  default_activity: string;
  
  // Schedule metadata
  last_updated: string;          // ISO timestamp
  update_reason?: string;        // Why was schedule last changed
  
  // Routine stability
  is_temporary: boolean;         // Is this a temporary schedule?
  temporary_until?: string;      // ISO date when temporary schedule ends
  
  // Override (for special circumstances)
  override_entry?: NPCScheduleEntry; // Current override (illness, quest, etc.)
  override_until?: number;       // Minutes until override ends
};

/**
 * Schedule change reason types
 */
export type ScheduleChangeReason =
  | "job_change"          // Lost job, new job
  | "goal_change"         // Personal goals changed
  | "lifestyle_change"    // Living situation changed
  | "relationship_change" // Marriage, friendship, enemy
  | "health_change"       // Illness, injury
  | "weather"             // Weather forcing change
  | "seasonal"            // Seasonal routine
  | "event"               // Special event/festival
  | "player_influence"    // Player actions affected NPC
  | "npc_influence"       // Other NPC actions affected this NPC
  | "quest"               // On a quest/adventure
  | "emergency";          // Emergency situation

/**
 * Result of checking what an NPC should be doing
 */
export type CurrentActivityResult = {
  is_on_schedule: boolean;
  current_entry?: NPCScheduleEntry;
  next_entry?: NPCScheduleEntry;
  time_until_next: number;       // Minutes until next activity
  is_override: boolean;
};

/**
 * Schedule update request
 */
export type ScheduleUpdateRequest = {
  reason: ScheduleChangeReason;
  details: string;
  new_entries?: NPCScheduleEntry[]; // Full replacement
  modifications?: ScheduleModification[]; // Partial updates
  temporary?: boolean;
  duration_minutes?: number;
};

export type ScheduleModification = {
  entry_id: string;
  field: keyof NPCScheduleEntry;
  new_value: unknown;
};

// TODO: Expand schedule system
// TODO: Add schedule templates for different professions (guard, merchant, farmer, etc.)
// TODO: Add schedule conflict resolution
// TODO: Add NPC-to-NPC schedule coordination (meetings, appointments)
// TODO: Add dynamic schedule generation based on NPC personality/goals
// TODO: Add schedule learning (NPCs adapt schedules based on what works)
// TODO: Add group schedules (guards patrol together, shopkeepers coordinate shifts)
// TODO: Add schedule interruption system (alerts, emergencies)
// TODO: Add schedule memory (NPCs remember missing schedule items)
// TODO: Add schedule preferences (early bird vs night owl)

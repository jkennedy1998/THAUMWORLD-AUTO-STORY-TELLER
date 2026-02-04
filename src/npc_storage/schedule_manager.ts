/**
 * NPC Schedule Storage and Management
 * 
 * Handles loading, saving, and querying NPC schedules.
 * Integrates with the global time system.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { get_npc_dir } from "../engine/paths.js";
import type { 
  NPCSchedule, 
  NPCScheduleEntry, 
  CurrentActivityResult,
  ScheduleUpdateRequest,
  ScheduleChangeReason
} from "./schedule_types.js";
import type { GameTime } from "../time_system/tracker.js";
import { get_minutes_from_start_of_day, MINUTES_PER_DAY } from "../time_system/tracker.js";

const SCHEDULE_SUFFIX = "_schedule";

/**
 * Get path to NPC schedule file
 */
function get_schedule_path(slot: number, npc_id: string): string {
  const npc_dir = get_npc_dir(slot);
  return path.join(npc_dir, `${npc_id}${SCHEDULE_SUFFIX}.jsonc`);
}

/**
 * Check if NPC has a schedule
 */
export function has_schedule(slot: number, npc_id: string): boolean {
  const schedule_path = get_schedule_path(slot, npc_id);
  return fs.existsSync(schedule_path);
}

/**
 * Load NPC schedule
 */
export function load_schedule(slot: number, npc_id: string): NPCSchedule | null {
  try {
    const schedule_path = get_schedule_path(slot, npc_id);
    
    if (!fs.existsSync(schedule_path)) {
      return null;
    }
    
    const raw = fs.readFileSync(schedule_path, "utf-8");
    const schedule = JSON.parse(raw) as NPCSchedule;
    
    // Calculate end times for entries
    for (const entry of schedule.entries) {
      entry.end_time = entry.start_time + entry.duration_minutes;
    }
    
    return schedule;
  } catch (err) {
    console.error(`Failed to load schedule for ${npc_id}:`, err);
    return null;
  }
}

/**
 * Save NPC schedule
 */
export function save_schedule(slot: number, schedule: NPCSchedule): void {
  const schedule_path = get_schedule_path(slot, schedule.npc_id);
  fs.writeFileSync(schedule_path, JSON.stringify(schedule, null, 2), "utf-8");
}

/**
 * Create default schedule for an NPC
 */
export function create_default_schedule(
  npc_id: string,
  default_place_id: string,
  profession?: string
): NPCSchedule {
  const now = new Date().toISOString();
  
  // Default schedule: Wake up, work, relax, sleep
  const entries: NPCScheduleEntry[] = [
    {
      id: `${npc_id}_sleep`,
      name: "Sleep",
      start_time: 0, // Midnight
      duration_minutes: 480, // 8 hours
      end_time: 480,
      place_id: default_place_id,
      activity_type: "sleep",
      description: "Resting and sleeping",
      priority: 10, // High priority
      interruptible: false
    },
    {
      id: `${npc_id}_morning`,
      name: "Morning Routine",
      start_time: 480, // 8 AM
      duration_minutes: 120, // 2 hours
      end_time: 600,
      place_id: default_place_id,
      activity_type: "personal",
      description: "Morning routine and breakfast",
      temporary_goal: "Start the day fresh",
      priority: 5,
      interruptible: true
    },
    {
      id: `${npc_id}_work`,
      name: "Work",
      start_time: 600, // 10 AM
      duration_minutes: 360, // 6 hours
      end_time: 960,
      place_id: default_place_id,
      activity_type: profession === "guard" ? "guard" : "work",
      description: profession === "guard" ? "On guard duty" : "Working",
      temporary_goal: "Fulfill daily duties",
      priority: 7,
      interruptible: true,
      flexible_duration: 60
    },
    {
      id: `${npc_id}_evening`,
      name: "Evening Activities",
      start_time: 960, // 4 PM
      duration_minutes: 240, // 4 hours
      end_time: 1200,
      place_id: default_place_id,
      activity_type: "social",
      description: "Evening meal and socializing",
      temporary_goal: "Relax and socialize",
      priority: 4,
      interruptible: true
    },
    {
      id: `${npc_id}_prep_sleep`,
      name: "Prepare for Sleep",
      start_time: 1200, // 8 PM
      duration_minutes: 240, // 4 hours
      end_time: 1440,
      place_id: default_place_id,
      activity_type: "personal",
      description: "Winding down for the night",
      priority: 6,
      interruptible: true
    }
  ];
  
  return {
    schema_version: 1,
    npc_id,
    entries,
    default_place_id,
    default_activity: "waiting",
    last_updated: now,
    is_temporary: false
  };
}

/**
 * Get NPC's current activity based on schedule
 */
export function get_current_activity(
  schedule: NPCSchedule,
  game_time: GameTime
): CurrentActivityResult {
  const minutes_from_midnight = get_minutes_from_start_of_day(game_time);
  
  // Check for override first
  if (schedule.override_entry && schedule.override_until) {
    const time_remaining = schedule.override_until - minutes_from_midnight;
    if (time_remaining > 0) {
      return {
        is_on_schedule: true,
        current_entry: schedule.override_entry,
        time_until_next: time_remaining,
        is_override: true
      };
    }
  }
  
  // Find current entry
  let current_entry: NPCScheduleEntry | undefined;
  let next_entry: NPCScheduleEntry | undefined;
  
  for (let i = 0; i < schedule.entries.length; i++) {
    const entry = schedule.entries[i]!;
    
    if (minutes_from_midnight >= entry.start_time && minutes_from_midnight < entry.end_time) {
      current_entry = entry;
      next_entry = schedule.entries[i + 1];
      break;
    }
    
    // If we've passed all entries, we're in the gap between last and first (next day)
    if (i === schedule.entries.length - 1 && minutes_from_midnight >= entry.end_time) {
      current_entry = undefined; // In gap
      next_entry = schedule.entries[0]; // First entry tomorrow
      break;
    }
  }
  
  // Calculate time until next activity
  let time_until_next: number;
  if (current_entry) {
    time_until_next = current_entry.end_time - minutes_from_midnight;
  } else if (next_entry) {
    // Time until next entry starts (handles wrap around midnight)
    if (next_entry.start_time > minutes_from_midnight) {
      time_until_next = next_entry.start_time - minutes_from_midnight;
    } else {
      // Next entry is tomorrow
      time_until_next = (MINUTES_PER_DAY - minutes_from_midnight) + next_entry.start_time;
    }
  } else {
    time_until_next = 0;
  }
  
  return {
    is_on_schedule: !!current_entry,
    current_entry,
    next_entry,
    time_until_next,
    is_override: false
  };
}

/**
 * Get the place where NPC should be at current time
 */
export function get_scheduled_place(
  schedule: NPCSchedule,
  game_time: GameTime
): { place_id: string; activity: string; is_override: boolean } {
  const activity = get_current_activity(schedule, game_time);
  
  if (activity.current_entry) {
    return {
      place_id: activity.current_entry.place_id,
      activity: activity.current_entry.description,
      is_override: activity.is_override
    };
  }
  
  // Not on schedule - use defaults
  return {
    place_id: schedule.default_place_id,
    activity: schedule.default_activity,
    is_override: false
  };
}

/**
 * Update NPC schedule
 */
export function update_schedule(
  slot: number,
  npc_id: string,
  request: ScheduleUpdateRequest
): { ok: boolean; error?: string } {
  try {
    let schedule = load_schedule(slot, npc_id);
    
    if (!schedule) {
      // Create new schedule
      schedule = create_default_schedule(npc_id, "unknown");
    }
    
    // Update metadata
    schedule.last_updated = new Date().toISOString();
    schedule.update_reason = `${request.reason}: ${request.details}`;
    
    if (request.temporary && request.duration_minutes) {
      schedule.is_temporary = true;
      schedule.temporary_until = new Date(
        Date.now() + request.duration_minutes * 60 * 1000
      ).toISOString();
    } else {
      schedule.is_temporary = false;
      schedule.temporary_until = undefined;
    }
    
    // Apply updates
    if (request.new_entries) {
      schedule.entries = request.new_entries;
    }
    
    if (request.modifications) {
      for (const mod of request.modifications) {
        const entry = schedule.entries.find(e => e.id === mod.entry_id);
        if (entry) {
          (entry as any)[mod.field] = mod.new_value;
        }
      }
    }
    
    // Recalculate end times
    for (const entry of schedule.entries) {
      entry.end_time = entry.start_time + entry.duration_minutes;
    }
    
    save_schedule(slot, schedule);
    
    return { ok: true };
  } catch (err) {
    return { 
      ok: false, 
      error: err instanceof Error ? err.message : String(err) 
    };
  }
}

/**
 * Set schedule override (for emergencies, quests, etc.)
 */
export function set_schedule_override(
  slot: number,
  npc_id: string,
  override_entry: NPCScheduleEntry,
  duration_minutes: number
): { ok: boolean; error?: string } {
  const schedule = load_schedule(slot, npc_id);
  
  if (!schedule) {
    return { ok: false, error: "No schedule found" };
  }
  
  schedule.override_entry = override_entry;
  schedule.override_until = duration_minutes;
  schedule.last_updated = new Date().toISOString();
  schedule.update_reason = `Temporary override: ${override_entry.name}`;
  
  save_schedule(slot, schedule);
  
  return { ok: true };
}

/**
 * Clear schedule override
 */
export function clear_schedule_override(
  slot: number,
  npc_id: string
): void {
  const schedule = load_schedule(slot, npc_id);
  
  if (schedule) {
    schedule.override_entry = undefined;
    schedule.override_until = undefined;
    save_schedule(slot, schedule);
  }
}

/**
 * Check if schedule needs update (temporary schedule expired, etc.)
 */
export function check_schedule_status(
  schedule: NPCSchedule
): { needs_update: boolean; reason?: string } {
  // Check if temporary schedule expired
  if (schedule.is_temporary && schedule.temporary_until) {
    const now = new Date();
    const until = new Date(schedule.temporary_until);
    
    if (now >= until) {
      return { 
        needs_update: true, 
        reason: "Temporary schedule expired" 
      };
    }
  }
  
  // Check if override expired (will be checked in get_current_activity)
  if (schedule.override_entry && !schedule.override_until) {
    return {
      needs_update: true,
      reason: "Override expired"
    };
  }
  
  return { needs_update: false };
}

// TODO: Add schedule templates for professions
// TODO: Add schedule conflict detection
// TODO: Add NPC-to-NPC schedule synchronization
// TODO: Add schedule history tracking
// TODO: Add schedule preference learning
// TODO: Add schedule interruption handling

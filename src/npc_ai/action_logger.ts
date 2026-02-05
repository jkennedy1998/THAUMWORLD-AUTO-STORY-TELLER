/**
 * NPC Action Logger
 * 
 * Records current and recent activities for each NPC in their memory_sheet.
 * This allows the AI to:
 * - Narrate what NPCs were doing when player arrives
 * - Reference recent activities in conversation
 * - Create sense of persistent, living world
 * 
 * Activities are stored in npc.memory_sheet:
 * - current_activity: What they're doing right now
 * - activity_history: Last 10 completed activities
 */

import type { TilePosition, Place } from "../types/place.js";
import { load_npc, save_npc } from "../npc_storage/store.js";
import { debug_log } from "../shared/debug.js";
import type { GoalType, ActionType } from "./movement_state.js";

/** Current activity being performed */
export type CurrentActivity = {
  action_type: string;           // "walking", "sitting", "working", "talking"
  description: string;           // Human-readable description
  target?: string;               // Feature ID, entity ref, or "location"
  started_at: string;            // ISO timestamp
  duration_ms?: number;          // How long action took (set on completion)
  completed_at?: string;         // ISO timestamp (set on completion)
  location: {
    place_id: string;
    tile: TilePosition;
  };
};

/** Completed activity in history */
export type CompletedActivity = CurrentActivity & {
  duration_ms: number;           // Required for completed activities
  completed_at: string;          // Required for completed activities
};

/** Activity history stored in NPC sheet */
export type ActivityLog = {
  current: CurrentActivity | null;
  history: CompletedActivity[];
};

const MAX_HISTORY_LENGTH = 10;

/**
 * Log a new activity for an NPC
 * Completes any existing activity first
 */
export async function log_activity(
  slot: number,
  npc_ref: string,
  activity: Omit<CurrentActivity, "started_at">
): Promise<void> {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) {
    debug_log("NPC_Logger", `Failed to load NPC ${npc_id} for activity logging`);
    return;
  }
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  // Complete current activity if exists
  const current = memory_sheet.current_activity as CurrentActivity | undefined;
  if (current) {
    complete_current_activity(slot, npc_ref);
  }
  
  // Set new activity
  const new_activity: CurrentActivity = {
    ...activity,
    started_at: new Date().toISOString(),
  };
  
  memory_sheet.current_activity = new_activity;
  npc.memory_sheet = memory_sheet;
  
  save_npc(slot, npc_id, npc);
  
  debug_log("NPC_Logger", `Logged activity for ${npc_ref}`, {
    type: activity.action_type,
    description: activity.description
  });
}

/**
 * Complete the current activity and move to history
 */
export async function complete_current_activity(
  slot: number,
  npc_ref: string
): Promise<void> {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) return;
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  const current = memory_sheet.current_activity as CurrentActivity | undefined;
  if (!current) return;
  
  // Mark as completed
  const completed_at = new Date().toISOString();
  const started_at = new Date(current.started_at).getTime();
  const duration_ms = new Date(completed_at).getTime() - started_at;
  
  const completed_activity: CompletedActivity = {
    ...current,
    duration_ms,
    completed_at,
  };
  
  // Add to history
  const history = (memory_sheet.activity_history as CompletedActivity[]) ?? [];
  history.unshift(completed_activity);
  
  // Trim history
  while (history.length > MAX_HISTORY_LENGTH) {
    history.pop();
  }
  
  memory_sheet.activity_history = history;
  memory_sheet.current_activity = null;
  npc.memory_sheet = memory_sheet;
  
  save_npc(slot, npc_id, npc);
  
  debug_log("NPC_Logger", `Completed activity for ${npc_ref}`, {
    type: completed_activity.action_type,
    duration_ms
  });
}

/**
 * Update current activity description (for ongoing actions)
 */
export async function update_activity_description(
  slot: number,
  npc_ref: string,
  new_description: string
): Promise<void> {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) return;
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  const current = memory_sheet.current_activity as CurrentActivity | undefined;
  if (!current) return;
  
  current.description = new_description;
  memory_sheet.current_activity = current;
  npc.memory_sheet = memory_sheet;
  
  save_npc(slot, npc_id, npc);
}

/**
 * Get current activity for an NPC
 */
export function get_current_activity(
  slot: number,
  npc_ref: string
): CurrentActivity | null {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) return null;
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  return (memory_sheet.current_activity as CurrentActivity) ?? null;
}

/**
 * Get activity history for an NPC
 */
export function get_activity_history(
  slot: number,
  npc_ref: string,
  limit: number = MAX_HISTORY_LENGTH
): CompletedActivity[] {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) return [];
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  const history = (memory_sheet.activity_history as CompletedActivity[]) ?? [];
  return history.slice(0, limit);
}

/**
 * Get formatted recent activities for AI context
 * Returns a string describing what the NPC has been doing
 */
export function get_recent_activities_summary(
  slot: number,
  npc_ref: string,
  max_items: number = 3
): string {
  const history = get_activity_history(slot, npc_ref, max_items);
  const current = get_current_activity(slot, npc_ref);
  
  const parts: string[] = [];
  
  if (current) {
    parts.push(`Currently: ${current.description}`);
  }
  
  if (history.length > 0) {
    const recent = history.slice(0, max_items).map(a => a.description);
    parts.push(`Recently: ${recent.join("; ")}`);
  }
  
  return parts.join(". ");
}

/**
 * Log movement activity
 */
export async function log_movement_activity(
  slot: number,
  npc_ref: string,
  place: Place,
  from: TilePosition,
  to: TilePosition,
  reason?: string
): Promise<void> {
  const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  let description: string;
  
  if (distance <= 1) {
    description = `Stepped to (${to.x}, ${to.y})`;
  } else if (distance <= 5) {
    description = `Walked a short distance`;
  } else {
    description = `Walked across the room`;
  }
  
  if (reason) {
    description += ` to ${reason}`;
  }
  
  await log_activity(slot, npc_ref, {
    action_type: "walking",
    description,
    target: `tile_${to.x}_${to.y}`,
    location: {
      place_id: place.id,
      tile: to
    }
  });
}

/**
 * Log idle/waiting activity
 */
export async function log_idle_activity(
  slot: number,
  npc_ref: string,
  place: Place,
  position: TilePosition,
  context?: string
): Promise<void> {
  const descriptions = [
    "Standing around",
    "Looking around",
    "Waiting",
    "Observing the surroundings",
  ];
  
  let description: string;
  if (context) {
    description = `${descriptions[0]} ${context}`;
  } else {
    description = descriptions[Math.floor(Math.random() * descriptions.length)]!;
  }
  
  await log_activity(slot, npc_ref, {
    action_type: "waiting",
    description,
    location: {
      place_id: place.id,
      tile: position
    }
  });
}

/**
 * Log interaction with a feature
 */
export async function log_interaction_activity(
  slot: number,
  npc_ref: string,
  place: Place,
  feature_name: string,
  interaction: string,
  position: TilePosition
): Promise<void> {
  await log_activity(slot, npc_ref, {
    action_type: "interacting",
    description: `${interaction} the ${feature_name}`,
    target: feature_name,
    location: {
      place_id: place.id,
      tile: position
    }
  });
}

/**
 * Log social activity
 */
export async function log_social_activity(
  slot: number,
  npc_ref: string,
  place: Place,
  target_ref: string,
  target_name: string,
  position: TilePosition
): Promise<void> {
  await log_activity(slot, npc_ref, {
    action_type: "social",
    description: `Approached ${target_name}`,
    target: target_ref,
    location: {
      place_id: place.id,
      tile: position
    }
  });
}

/**
 * Clear activity log (for debugging/cleanup)
 */
export async function clear_activity_log(
  slot: number,
  npc_ref: string
): Promise<void> {
  const npc_id = npc_ref.replace("npc.", "");
  const result = load_npc(slot, npc_id);
  
  if (!result.ok) return;
  
  const npc = result.npc as Record<string, unknown>;
  const memory_sheet = (npc.memory_sheet as Record<string, unknown>) ?? {};
  
  memory_sheet.current_activity = null;
  memory_sheet.activity_history = [];
  npc.memory_sheet = memory_sheet;
  
  save_npc(slot, npc_id, npc);
  
  debug_log("NPC_Logger", `Cleared activity log for ${npc_ref}`);
}

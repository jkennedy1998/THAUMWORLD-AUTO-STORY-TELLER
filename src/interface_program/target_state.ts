// Target State Management
// Tracks what entity an actor is currently targeting for communication/actions

import { debug_log } from "../shared/debug.js";
import { send_highlight_command, send_target_command } from "../npc_ai/movement_command_sender.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

function resolve_target_display_name(target_ref: string, target_type: "npc" | "actor" | "item" | "terrain", fallback?: string): string | undefined {
  const clean_fallback = typeof fallback === "string" ? fallback.trim() : "";
  if (clean_fallback.length > 0) return clean_fallback;

  if (target_type === "npc" && target_ref.startsWith("npc.")) {
    const npc_id = target_ref.slice(4);
    const result = load_npc(data_slot_number, npc_id);
    if (result.ok && typeof (result.npc as any)?.name === "string" && String((result.npc as any).name).trim().length > 0) {
      return String((result.npc as any).name).trim();
    }
    return undefined;
  }

  if (target_type === "actor" && target_ref.startsWith("actor.")) {
    const actor_id = target_ref.slice(6);
    const result = load_actor(data_slot_number, actor_id);
    if (result.ok && typeof (result.actor as any)?.name === "string" && String((result.actor as any).name).trim().length > 0) {
      return String((result.actor as any).name).trim();
    }
    return undefined;
  }

  return undefined;
}

export interface ActorTargetState {
  actor_ref: string;
  target_ref?: string;
  target_type?: "npc" | "actor" | "item" | "terrain";
  selected_at: number;
  is_valid: boolean;
}

// In-memory storage for actor targets
const actor_targets = new Map<string, ActorTargetState>();

// Track previous target for cleanup
const previous_targets = new Map<string, string>();

// Constants
const MAX_TARGET_RANGE = 20; // Maximum range to maintain target
const TARGET_TIMEOUT_MS = 300000; // 5 minutes before target auto-clears

/**
 * Set target for an actor (called on left click)
 * Sends visual feedback commands to frontend
 */
export function setActorTarget(
  actor_ref: string,
  target_ref: string,
  target_type: "npc" | "actor" | "item" | "terrain",
  target_name?: string
): void {
  debug_log("[TARGET]", `Set target for ${actor_ref}: ${target_ref} (${target_type})`);
  
  // Clear previous target highlight if exists
  const prev_target = previous_targets.get(actor_ref);
  if (prev_target && prev_target !== target_ref) {
    send_highlight_command(prev_target, false, "yellow", "Clearing previous target");
  }
  
  // Set new target
  actor_targets.set(actor_ref, {
    actor_ref,
    target_ref,
    target_type,
    selected_at: Date.now(),
    is_valid: true
  });
  
  // Track for cleanup
  previous_targets.set(actor_ref, target_ref);
  
  // Send visual feedback commands
  // Highlight the target
  send_highlight_command(target_ref, true, "yellow", "Target selected");
  
  // Update target display UI
  send_target_command(actor_ref, target_ref, resolve_target_display_name(target_ref, target_type, target_name), "Target selected");
}

/**
 * Clear target for an actor
 * Sends visual feedback commands to frontend
 */
export function clearActorTarget(actor_ref: string): void {
  debug_log("[TARGET]", `Clear target for ${actor_ref}`);
  
  // Get current target to clear highlight
  const state = actor_targets.get(actor_ref);
  if (state?.target_ref) {
    send_highlight_command(state.target_ref, false, "yellow", "Target cleared");
  }
  
  // Clear target display UI
  send_target_command(actor_ref, undefined, undefined, "Target cleared");
  
  // Remove from tracking
  actor_targets.delete(actor_ref);
  previous_targets.delete(actor_ref);
}

/**
 * Get current target for an actor
 */
export function getActorTarget(actor_ref: string): ActorTargetState | undefined {
  return actor_targets.get(actor_ref);
}

/**
 * Check if actor has a valid target
 */
export function hasValidTarget(actor_ref: string): boolean {
  const state = actor_targets.get(actor_ref);
  if (!state) return false;
  
  // Check timeout
  const age = Date.now() - state.selected_at;
  if (age > TARGET_TIMEOUT_MS) {
    clearActorTarget(actor_ref);
    return false;
  }
  
  return state.is_valid && !!state.target_ref;
}

/**
 * Validate target (check if still exists and in range)
 * This should be called before using the target
 */
export function validateTarget(
  actor_ref: string,
  getDistanceFn: (actor: string, target: string) => number
): boolean {
  const state = actor_targets.get(actor_ref);
  if (!state?.target_ref) return false;
  
  // Check distance
  try {
    const distance = getDistanceFn(actor_ref, state.target_ref);
    if (distance > MAX_TARGET_RANGE) {
      debug_log("[TARGET]", `Target ${state.target_ref} out of range (${distance} > ${MAX_TARGET_RANGE})`);
      state.is_valid = false;
      return false;
    }
    
    state.is_valid = true;
    return true;
  } catch (err) {
    debug_log("[TARGET]", `Failed to validate target: ${err}`);
    state.is_valid = false;
    return false;
  }
}

/**
 * Get target reference if valid
 */
export function getValidTargetRef(actor_ref: string): string | undefined {
  const state = actor_targets.get(actor_ref);
  if (state?.is_valid && state.target_ref) {
    return state.target_ref;
  }
  return undefined;
}

/**
 * Clean up expired targets (call periodically)
 */
export function cleanupExpiredTargets(): void {
  const now = Date.now();
  for (const [actor_ref, state] of actor_targets.entries()) {
    const age = now - state.selected_at;
    if (age > TARGET_TIMEOUT_MS) {
      debug_log("[TARGET]", `Cleaned up expired target for ${actor_ref}`);
      actor_targets.delete(actor_ref);
    }
  }
}

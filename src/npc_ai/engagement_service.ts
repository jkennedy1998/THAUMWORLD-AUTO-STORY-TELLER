// Engagement Service
// Manages NPC engagement state during conversations
// Tabletop concept: "NPC stops what they're doing to talk"

import { debug_log } from "../shared/debug.js";
import { send_stop_command, send_face_command, send_status_command } from "../npc_ai/movement_command_sender.js";

export type EngagementType = "participant" | "bystander";
export type EngagementState = "idle" | "engaged" | "distracted" | "leaving";

export interface Engagement {
  npc_ref: string;
  engaged_with: string[];
  type: EngagementType;
  state: EngagementState;
  
  // Interrupted action for restoration
  interrupted_action?: string;
  interrupted_goal?: string;
  
  // Timing
  attention_span_ms: number;
  last_interaction_at: number;
  created_at: number;
  
  // Range
  max_distance_tiles: number;
}

// In-memory storage
const engagements = new Map<string, Engagement>();

// Constants
const DEFAULT_ATTENTION_SPAN_MS = 30000; // 30 seconds
const BYSTANDER_ATTENTION_SPAN_MS = 20000; // 20 seconds
const DISTRACTED_THRESHOLD_MS = 20000; // Warning at 20s
const CHECK_INTERVAL_MS = 1000; // Check every second

/**
 * Initialize engagement service
 * Call this once at startup
 */
export function initEngagementService(): void {
  debug_log("[ENGAGEMENT]", "Service initialized");
  
  // Start periodic check
  setInterval(() => {
    checkAllEngagements();
  }, CHECK_INTERVAL_MS);
}

/**
 * Enter engagement (NPC starts talking)
 */
export function enterEngagement(
  npc_ref: string,
  target_ref: string,
  type: EngagementType
): void {
  // Check if already engaged
  if (engagements.has(npc_ref)) {
    // Update existing engagement
    const existing = engagements.get(npc_ref)!;
    existing.last_interaction_at = Date.now();
    existing.state = "engaged";
    debug_log("[ENGAGEMENT]", `${npc_ref} refreshed engagement`);
    return;
  }
  
  // Create new engagement
  const attention_span = type === "participant" 
    ? DEFAULT_ATTENTION_SPAN_MS 
    : BYSTANDER_ATTENTION_SPAN_MS;
  
  const max_distance = type === "participant" ? 3 : 8;
  
  const engagement: Engagement = {
    npc_ref,
    engaged_with: [target_ref],
    type,
    state: "engaged",
    attention_span_ms: attention_span,
    last_interaction_at: Date.now(),
    created_at: Date.now(),
    max_distance_tiles: max_distance
  };
  
  engagements.set(npc_ref, engagement);
  
  debug_log("[ENGAGEMENT]", `${npc_ref} entered ${type} engagement with ${target_ref}`);
  
  // Send commands to frontend
  send_stop_command(npc_ref, "Entering conversation");
  send_face_command(npc_ref, target_ref, "Facing conversation partner");
  send_status_command(npc_ref, "busy", "In conversation");
}

/**
 * Check all engagements (called periodically)
 */
function checkAllEngagements(): void {
  const now = Date.now();
  
  for (const [npc_ref, engagement] of engagements.entries()) {
    const idle_time = now - engagement.last_interaction_at;
    
    // Check if should leave (timeout)
    if (idle_time > engagement.attention_span_ms) {
      endEngagement(npc_ref, "timeout");
      continue;
    }
    
    // Check if distracted (warning phase)
    if (idle_time > DISTRACTED_THRESHOLD_MS && engagement.state === "engaged") {
      engagement.state = "distracted";
      debug_log("[ENGAGEMENT]", `${npc_ref} is getting distracted...`);
      
      // TODO: Send visual feedback (yellow indicator?)
    }
  }
}

/**
 * Update engagement (called when new message in conversation)
 */
export function updateEngagement(npc_ref: string): void {
  const engagement = engagements.get(npc_ref);
  if (!engagement) return;
  
  engagement.last_interaction_at = Date.now();
  
  // Reset to engaged if was distracted
  if (engagement.state === "distracted") {
    engagement.state = "engaged";
    debug_log("[ENGAGEMENT]", `${npc_ref} re-engaged`);
  }
}

/**
 * End engagement (NPC leaves conversation)
 */
export function endEngagement(npc_ref: string, reason: string): void {
  const engagement = engagements.get(npc_ref);
  if (!engagement) return;
  
  debug_log("[ENGAGEMENT]", `${npc_ref} leaving engagement (${reason})`);
  
  // Restore previous action if any
  if (engagement.interrupted_action) {
    debug_log("[ENGAGEMENT]", `${npc_ref} restoring action: ${engagement.interrupted_action}`);
    // TODO: Restore previous goal/action
  }
  
  // Clear status
  send_status_command(npc_ref, "present", "Leaving conversation");
  
  // Remove engagement
  engagements.delete(npc_ref);
}

/**
 * Check if NPC is engaged
 */
export function isEngaged(npc_ref: string): boolean {
  return engagements.has(npc_ref);
}

/**
 * Get engagement info
 */
export function getEngagement(npc_ref: string): Engagement | undefined {
  return engagements.get(npc_ref);
}

/**
 * Get all engaged NPCs
 */
export function getAllEngaged(): string[] {
  return Array.from(engagements.keys());
}

/**
 * Get engaged NPCs for a specific target
 */
export function getEngagedWith(target_ref: string): string[] {
  const result: string[] = [];
  for (const [npc_ref, engagement] of engagements.entries()) {
    if (engagement.engaged_with.includes(target_ref)) {
      result.push(npc_ref);
    }
  }
  return result;
}

/**
 * Force end all engagements (e.g., on game reload)
 */
export function clearAllEngagements(): void {
  debug_log("[ENGAGEMENT]", "Clearing all engagements");
  
  for (const npc_ref of engagements.keys()) {
    send_status_command(npc_ref, "present", "System clearing engagements");
  }
  
  engagements.clear();
}

/**
 * Check if NPC can engage (not fleeing, etc.)
 */
export function canEngage(npc_ref: string): boolean {
  // TODO: Check if NPC is in combat, fleeing, etc.
  // For now, always true
  return true;
}

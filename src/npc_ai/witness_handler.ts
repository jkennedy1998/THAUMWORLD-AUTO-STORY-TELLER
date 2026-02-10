/**
 * Witness Handler
 * 
 * Processes perception events and triggers NPC reactions.
 * Connects the perception system to the movement/goal system.
 * 
 * When NPCs witness actions (especially COMMUNICATE), they react immediately
 * without LLM processing by adjusting their movement goals.
 */

import type { PerceptionEvent } from "../action_system/perception.js";
import { is_timed_event_active } from "../world_storage/store.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import { debug_log } from "../shared/debug.js";
import { is_action_detectable } from "../action_system/sense_broadcast.js";

import {
  start_conversation,
  end_conversation,
  is_in_conversation,
  get_conversation,
  update_conversation_timeout,
  update_conversations as update_conversations_state
} from "./conversation_state.js";

import {
  get_movement_state,
  set_goal,
  clear_goal
} from "./movement_state.js";

import {
  generate_conversation_goal
} from "./goal_selector.js";

import {
  resume_npc_wandering,
  cancel_npc_wandering
} from "./movement_loop.js";

import {
  stop_entity_movement
} from "../shared/movement_engine.js";

import {
  send_stop_command,
  send_face_command,
  send_status_command
} from "./movement_command_sender.js";

import {
  face_target
} from "./facing_system.js";

import {
  can_see,
  can_hear,
  check_perception_with_senses
} from "./cone_of_vision.js";

import {
  load_place,
  save_place
} from "../place_storage/store.js";

import {
  get_npc_location
} from "../npc_storage/location.js";

const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

// Pattern to detect farewells
const FAREWELL_PATTERN = /\b(goodbye|bye|farewell|see you|later|until)\b/i;

/**
 * Process a perception event for a specific observer
 * Called by the action pipeline for each observer that perceives an action
 */
export function process_witness_event(
  observer_ref: string,
  event: PerceptionEvent
): void {
  console.log(`[WITNESS] process_witness_event called for ${observer_ref}, verb: ${event.verb}, actor: ${event.actorRef}`);
  debug_log("[Witness]", `Processing event for ${observer_ref}:`, { verb: event.verb, actor: event.actorRef });
  
  // Skip if in combat/timed event
  if (is_timed_event_active(data_slot)) {
    debug_log("[Witness]", `Skipping ${observer_ref} - timed event active`);
    return;
  }
  
  // Skip if observer can't perceive
  if (!event.actorVisibility || event.actorVisibility === "obscured") {
    debug_log("[Witness]", `Skipping ${observer_ref} - cannot perceive (clarity: ${event.actorVisibility})`);
    return;
  }
  
  debug_log("[Witness]", `Handling ${event.verb} for ${observer_ref}`);
  handle_perception_event(observer_ref, event);
}

/**
 * Handle a single perception event
 */
function handle_perception_event(observer_ref: string, event: PerceptionEvent): void {
  // Skip if observer can't perceive
  console.log(`[WITNESS] handle_perception_event checking can_npc_perceive for ${observer_ref}`);
  if (!can_npc_perceive(observer_ref, event)) {
    console.log(`[WITNESS] handle_perception_event: ${observer_ref} cannot perceive, returning`);
    return;
  }
  console.log(`[WITNESS] handle_perception_event: ${observer_ref} can perceive, handling ${event.verb}`);
  
  // Handle based on event type
  switch (event.verb) {
    case "COMMUNICATE":
      handle_communication_perception(observer_ref, event);
      break;
    case "USE":
    case "MOVE":
      handle_movement_perception(observer_ref, event);
      break;
    default:
      // Other actions - just face the actor if close
      if (event.distance <= 5) {
        face_actor(observer_ref, event);
      }
  }
}

/**
 * Check if NPC can perceive an event
 * Uses vision cones for light sense, 360-degree for pressure sense
 */
function can_npc_perceive(observer_ref: string, event: PerceptionEvent): boolean {
  console.log(`[WITNESS] can_npc_perceive: checking ${observer_ref}, visibility: ${event.actorVisibility}, distance: ${event.distance}`);
  
  // Must be able to perceive at all
  if (!event.actorVisibility || event.actorVisibility === "obscured") {
    console.log(`[WITNESS] can_npc_perceive: ${observer_ref} failed visibility check`);
    return false;
  }
  
  // Get observer position - need to look this up from storage
  // For now, skip position-based checks if we don't have observer location
  // This will be enhanced when we integrate with entity storage
  
  // Check if within detection range using sense broadcasting
  const detection = is_action_detectable(
    event.verb,
    undefined, // subtype not stored in PerceptionEvent yet
    event.distance
  );
  
  console.log(`[WITNESS] can_npc_perceive: detection for ${event.verb} - detectable: ${detection.detectable}, sense: ${detection.best_sense}`);
  
  if (!detection.detectable) {
    console.log(`[WITNESS] can_npc_perceive: ${observer_ref} failed detection check`);
    return false;
  }
  
  // Check if the detecting sense requires vision cone (light) or is omnidirectional (pressure)
  if (detection.best_sense === "light") {
    // Light sense requires being in vision cone
    // TODO: Get observer position from storage and check can_see()
    // For now, assume they can see if within range and facing roughly toward
    // This will be properly implemented when we integrate full position tracking
  }
  
  // Pressure sense works 360 degrees, just needs to be in range
  // (already checked by is_action_detectable)
  
  console.log(`[WITNESS] can_npc_perceive: ${observer_ref} CAN perceive`);
  return true;
}

/**
 * Handle communication perception
 * Most important - triggers conversation state
 */
function handle_communication_perception(
  observer_ref: string,
  event: PerceptionEvent
): void {
  console.log(`[WITNESS] handle_communication_perception called for ${observer_ref}, event: ${event.verb} from ${event.actorRef}`);
  debug_log("[Witness]", `Handling COMMUNICATE for ${observer_ref} from ${event.actorRef}`);
  
  // Don't react to own communications
  if (event.actorRef === observer_ref) {
    debug_log("[Witness]", `Skipping - self communication`);
    return;
  }
  
  // Get message details
  const message = (event.details as any)?.messageText || "";
  const volume = (event.details as any)?.volume || "normal";
  
  debug_log("[Witness]", `Message: "${message.substring(0, 50)}..." (volume: ${volume})`);
  
  // Check if farewell using pattern
  if (FAREWELL_PATTERN.test(message)) {
    debug_log("[Witness]", `Farewell detected from ${event.actorRef}`);
    // If in conversation with this speaker, end it
    const conv = get_conversation(observer_ref);
    if (conv && conv.target_entity === event.actorRef) {
      debug_log("[Witness]", `Ending conversation for ${observer_ref}`);
      end_conversation(observer_ref);
      restore_previous_goal(observer_ref);
    }
    return;
  }
  
  // Check if addressed or very close
  const is_addressed = event.targetRef === observer_ref;
  const is_very_close = event.distance <= 2;
  const should_respond = is_addressed || is_very_close;
  
  debug_log("[Witness]", `Response check for ${observer_ref}:`, { is_addressed, is_very_close, distance: event.distance });
  
  if (!should_respond) {
    debug_log("[Witness]", `${observer_ref} not responding - not addressed and not close enough`);
    // Still face the speaker if nearby
    if (event.distance <= 5) {
      face_actor(observer_ref, event);
    }
    return;
  }
  
  debug_log("[Witness]", `${observer_ref} SHOULD respond to ${event.actorRef}`);
  
  // Already in conversation
  if (is_in_conversation(observer_ref)) {
    const conv = get_conversation(observer_ref);
    debug_log("[Witness]", `${observer_ref} already in conversation with ${conv?.target_entity}`);
    
    // If talking to this same person, extend conversation
    if (conv && conv.target_entity === event.actorRef) {
      debug_log("[Witness]", `Extending conversation for ${observer_ref}`);
      update_conversation_timeout(observer_ref);
      face_actor(observer_ref, event);
    }
    // If talking to someone else, check if we should switch
    else if (conv && is_addressed) {
      debug_log("[Witness]", `Switching conversation for ${observer_ref} to ${event.actorRef}`);
      // Switch to new speaker
      end_conversation(observer_ref);
      start_conversation_with_actor(observer_ref, event);
    }
    return;
  }
  
  // Not in conversation - start one
  debug_log("[Witness]", `Starting conversation for ${observer_ref} with ${event.actorRef}`);
  start_conversation_with_actor(observer_ref, event);
}

/**
 * Handle movement perception
 * NPCs might look at moving entities
 */
function handle_movement_perception(
  observer_ref: string,
  event: PerceptionEvent
): void {
  // Only face if close and not busy
  if (event.distance > 5) return;
  
  // Don't interrupt conversations
  if (is_in_conversation(observer_ref)) return;
  
  // Face the moving entity
  face_actor(observer_ref, event);
}

/**
 * Start conversation with an actor
 */
function start_conversation_with_actor(
  observer_ref: string,
  event: PerceptionEvent
): void {
  console.log(`[WITNESS] start_conversation_with_actor called for ${observer_ref}, actor: ${event.actorRef}`);
  debug_log("[Witness]", `start_conversation_with_actor called for ${observer_ref}`);
  
  const state = get_movement_state(observer_ref);
  if (!state) {
    debug_log("[Witness]", `No movement state for ${observer_ref}`);
    return;
  }
  
  debug_log("[Witness]", `Current goal for ${observer_ref}:`, { current_goal: state.current_goal?.type ?? "none" });

  // IMMEDIATE: Send face command FIRST (before anything else)
  // This ensures immediate visual feedback
  debug_log("[Witness]", `Sending IMMEDIATE face command for ${observer_ref} to face ${event.actorRef}`);
  send_face_command(observer_ref, event.actorRef, "IMMEDIATE: Face speaker");
  
  // Cancel any pending wandering and stop current movement
  cancel_npc_wandering(observer_ref);
  stop_entity_movement(observer_ref);

  // Send movement commands to renderer (Phase 8: Unified Movement Authority)
  // NPC_AI is the sole authority for movement decisions
  send_stop_command(observer_ref, "Entering conversation");
  
  // Send face command again after stop to ensure it takes effect
  setTimeout(() => {
    send_face_command(observer_ref, event.actorRef, "Face speaker during conversation");
  }, 50);

  // Save current goal
  const previous_goal = state.current_goal;
  const previous_path_state = state.path.length > 0 ? {
    path: state.path,
    path_index: state.path_index
  } : null;

  // Start conversation tracking
  debug_log("[Witness]", `Calling start_conversation for ${observer_ref}`);
  start_conversation(
    observer_ref,
    event.actorRef,
    [observer_ref, event.actorRef],
    previous_goal,
    previous_path_state
  );
  
  // Set conversation goal
  const target_pos = { x: event.location.x ?? 0, y: event.location.y ?? 0 };
  debug_log("[Witness]", `Generating conversation goal for ${observer_ref} at (${target_pos.x}, ${target_pos.y})`);
  const converse_goal = generate_conversation_goal(observer_ref, event.actorRef, target_pos);
  debug_log("[Witness]", `Setting goal for ${observer_ref}:`, { goal_type: converse_goal.type, priority: converse_goal.priority });
  set_goal(observer_ref, converse_goal);
  face_actor(observer_ref, event);
  
  // Update NPC status to "busy" in place data so renderer shows conversation state
  console.log(`[WITNESS] About to call update_npc_status_in_place for ${observer_ref} with status "busy"`);
  update_npc_status_in_place(observer_ref, "busy");
  
  // Send status command to renderer for real-time visual indicator
  console.log(`[WITNESS] About to call send_status_command for ${observer_ref} with status "busy"`);
  send_status_command(observer_ref, "busy", "Entering conversation");
  console.log(`[WITNESS] Finished status updates for ${observer_ref}`);
  
  debug_log("[Witness]", `${observer_ref} started conversation with ${event.actorRef}`);
}

/**
 * Face the actor who triggered the event
 */
function face_actor(observer_ref: string, event: PerceptionEvent): void {
  // Need location data from event
  // PerceptionEvent has location field which is the actor's location
  const actor_loc = event.location;
  
  // TODO: Get observer's location from storage
  // For now, skip facing if we don't have observer location
  // This will be implemented when we integrate with entity storage
  
  debug_log("Witness", `${observer_ref} facing ${event.actorRef}`);
}

/**
 * Restore previous goal after conversation ends
 */
function restore_previous_goal(npc_ref: string): void {
  const conv = get_conversation(npc_ref);
  if (!conv) return;

  if (conv.previous_goal) {
    // Restore path if available
    if (conv.previous_path_state) {
      set_goal(npc_ref, conv.previous_goal, conv.previous_path_state.path);
    } else {
      set_goal(npc_ref, conv.previous_goal);
    }

    debug_log("Witness", `${npc_ref} restored goal: ${conv.previous_goal.type}`);
  } else {
    // No previous goal to restore, resume wandering
    clear_goal(npc_ref, "Conversation ended - no previous goal");
    resume_npc_wandering(npc_ref);
    debug_log("Witness", `${npc_ref} resumed wandering after conversation`);
  }
  
  // Update NPC status back to "present" in place data
  update_npc_status_in_place(npc_ref, "present");
  
  // Send status command to renderer to update visual indicator
  send_status_command(npc_ref, "present", "Exiting conversation");
}

/**
 * Update conversations and clean up timed-out ones
 */
export function update_conversations(): void {
  const ended = update_conversations_state();

  // Restore goals for ended conversations
  for (const npc_ref of ended) {
    restore_previous_goal(npc_ref);
  }
}

/**
 * Force end a conversation (for admin/debug)
 */
export function force_end_conversation(npc_ref: string): void {
  if (is_in_conversation(npc_ref)) {
    end_conversation(npc_ref);
    restore_previous_goal(npc_ref);
    debug_log("Witness", `Force-ended conversation for ${npc_ref}`);
  }
}

/**
 * Get witness debug info
 */
export function get_witness_debug_info(): {
  conversations_active: number;
} {
  const { get_conversation_count } = require("./conversation_state.js");
  return {
    conversations_active: get_conversation_count()
  };
}

/**
 * Update NPC status in place data
 * This ensures the renderer shows the correct status (busy when in conversation)
 */
function update_npc_status_in_place(
  npc_ref: string,
  status: "present" | "moving" | "busy" | "sleeping"
): void {
  try {
    console.log(`[Witness] update_npc_status_in_place called for ${npc_ref} with status ${status}`);
    
    // Load NPC to get their location
    const npc_id = npc_ref.replace("npc.", "");
    const { load_npc } = require("../npc_storage/store.js");
    const npc_result = load_npc(data_slot, npc_id);
    
    if (!npc_result.ok || !npc_result.npc) {
      console.log(`[Witness] Failed to load NPC ${npc_ref}`);
      return;
    }
    console.log(`[Witness] Loaded NPC ${npc_ref}`);
    
    // Get place_id from NPC location
    const location = get_npc_location(npc_result.npc);
    if (!location?.place_id) {
      console.log(`[Witness] No place_id for ${npc_ref}`);
      return;
    }
    console.log(`[Witness] NPC ${npc_ref} is in place ${location.place_id}`);
    
    // Load the place
    const place_result = load_place(data_slot, location.place_id);
    if (!place_result.ok || !place_result.place) {
      console.log(`[Witness] Failed to load place ${location.place_id}`);
      return;
    }
    
    const place = place_result.place;
    console.log(`[Witness] Loaded place ${place.id} with ${place.contents.npcs_present.length} NPCs`);
    
    // Find and update the NPC in the place
    const npc_in_place = place.contents.npcs_present.find(
      (n: any) => n.npc_ref === npc_ref
    );
    
    if (npc_in_place) {
      npc_in_place.status = status;
      save_place(data_slot, place);
      console.log(`[Witness] UPDATED ${npc_ref} status to ${status} in place ${place.id}`);
    } else {
      console.log(`[Witness] NPC ${npc_ref} not found in place ${place.id}`);
    }
  } catch (err) {
    console.error(`[Witness] ERROR updating ${npc_ref} status:`, err);
  }
}

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
import { debug_event } from "../shared/debug_event.js";
import { get_senses_for_action } from "../action_system/sense_broadcast.js";

import {
  start_conversation,
  end_conversation,
  is_in_conversation,
  get_conversation,
  update_conversation_timeout,
  update_conversations as update_conversations_state,
  get_conversation_count,
  get_all_conversations
} from "./conversation_state.js";

import { load_npc } from "../npc_storage/store.js";
import { get_npc_tile_position } from "../npc_storage/location.js";
import { add_memory } from "../npc_storage/memory.js";

import {
  get_movement_state,
  set_goal,
  clear_goal,
  init_movement_state
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
  ensure_outbox_exists,
  read_outbox,
  write_outbox
} from "../engine/outbox_store.js";

// Command throttling to prevent spam
const last_command_time = new Map<string, number>();
const MIN_COMMAND_INTERVAL_MS = 3000; // Minimum 3 seconds between commands
const active_conversations = new Set<string>(); // Track NPCs already in conversation

// Response eligibility tracking (single communication pipeline)
// Keyed by ActionPipeline actionId (== intent.id). Only NPCs that are participants
// in the witness-driven conversation state are allowed to respond.
const response_eligible_by_action = new Map<string, { created_at_ms: number; npcs: Set<string> }>();
const RESPONSE_ELIGIBILITY_TTL_MS = 30_000;

function prune_response_eligibility(now_ms: number = Date.now()): void {
  for (const [action_id, entry] of response_eligible_by_action) {
    if (now_ms - entry.created_at_ms > RESPONSE_ELIGIBILITY_TTL_MS) {
      response_eligible_by_action.delete(action_id);
    }
  }
}

function note_response_eligible(action_id: string | undefined, npc_ref: string): void {
  if (!action_id) return;
  const now = Date.now();
  prune_response_eligibility(now);
  const existing = response_eligible_by_action.get(action_id);
  if (existing) {
    existing.npcs.add(npc_ref);
    return;
  }
  response_eligible_by_action.set(action_id, {
    created_at_ms: now,
    npcs: new Set([npc_ref]),
  });
}

export function get_response_eligible_by_action(action_id: string): string[] {
  prune_response_eligibility();
  const entry = response_eligible_by_action.get(action_id);
  return entry ? Array.from(entry.npcs) : [];
}

function ensure_movement_state(observer_ref: string) {
  const existing = get_movement_state(observer_ref);
  if (existing) return existing;

  // Movement state is in-memory; initialize from stored NPC tile position.
  const npc_id = observer_ref.replace("npc.", "");
  const npc_result = load_npc(data_slot, npc_id);
  if (!npc_result.ok) return undefined;

  const tile = get_npc_tile_position(npc_result.npc as any);
  if (!tile) return undefined;

  return init_movement_state(observer_ref, { x: tile.x, y: tile.y });
}

function should_send_command(npc_ref: string, command_type: string): boolean {
  const key = `${npc_ref}:${command_type}`;
  const now = Date.now();
  const last_time = last_command_time.get(key) || 0;
  
  if (now - last_time < MIN_COMMAND_INTERVAL_MS) {
    return false; // Too soon, don't send
  }
  
  last_command_time.set(key, now);
  return true;
}

function is_starting_conversation(npc_ref: string): boolean {
  return active_conversations.has(npc_ref);
}

function mark_conversation_starting(npc_ref: string): void {
  active_conversations.add(npc_ref);
}

function mark_conversation_ended(npc_ref: string): void {
  active_conversations.delete(npc_ref);
}

import { get_outbox_path } from "../engine/paths.js";

import {
  face_target
} from "./facing_system.js";

import {
  can_see,
  can_hear,
} from "./cone_of_vision.js";

import {
  enterEngagement,
  isEngaged,
  updateEngagement,
  endEngagement,
  getEngagement,
  getEngagedWith
} from "./engagement_service.js";

import {
  calculateSocialResponse,
  shouldRemember,
  calculateMemoryImportance,
  getDefaultPersonality,
  logSocialCheck
} from "./social_checks.js";

import {
  set_conversation_presence,
  clear_conversation_presence,
} from "../shared/conversation_presence_store.js";

import type { VolumeLevel } from "../interface_program/communication_input.js";

import {
  load_place,
  save_place
} from "../place_storage/store.js";

import {
  get_npc_location
} from "../npc_storage/location.js";

const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const outbox_path = get_outbox_path(data_slot);

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
  debug_event("WITNESS", "perception.event", {
    observer_ref,
    verb: event.verb,
    actor_ref: event.actorRef,
    target_ref: event.targetRef,
    distance: event.distance,
    visibility: event.actorVisibility
  });
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
  debug_event("WITNESS", "perception.check", { observer_ref, verb: event.verb });
  if (!can_npc_perceive(observer_ref, event)) {
    debug_event("WITNESS", "perception.rejected", { observer_ref, verb: event.verb });
    return;
  }
  debug_event("WITNESS", "perception.accepted", { observer_ref, verb: event.verb });
  
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
  debug_event("WITNESS", "perception.can_npc_perceive", {
    observer_ref,
    visibility: event.actorVisibility,
    distance: event.distance,
    verb: event.verb
  });
  
  // Must be able to perceive at all
  if (!event.actorVisibility || event.actorVisibility === "obscured") {
    debug_event("WITNESS", "perception.visibility_failed", { observer_ref });
    return false;
  }
  
  // Get observer position - need to look this up from storage
  // For now, skip position-based checks if we don't have observer location
  // This will be enhanced when we integrate with entity storage
  
  // Choose the best sense that is both in-range and allowed by directional constraints.
  // Prefer canonical event subtype; fall back to details when missing.
  const details = event.details as any;
  const subtype_raw: unknown = event.subtype ?? details?.subtype ?? details?.volume ?? details?.movement ?? undefined;
  const subtype = typeof subtype_raw === "string" ? subtype_raw.toUpperCase() : undefined;

  // Sense broadcast profiles are subtype-aware (e.g. USE.IMPACT_SINGLE), but PerceptionEvent
  // doesn't currently carry subtype for all verbs. When we can't find a profile, fall back
  // to the senses already computed by the perception system.
  const broadcasts_raw = get_senses_for_action(event.verb, subtype);
  const broadcasts = broadcasts_raw.length
    ? broadcasts_raw
    : (event.senses ?? []).map(sense => ({ sense, intensity: 1, range_tiles: Number.POSITIVE_INFINITY }));

  if (broadcasts.length === 0) {
    debug_event("WITNESS", "perception.detection_failed", {
      observer_ref,
      verb: event.verb,
      reason: "no_senses",
    });
    return false;
  }

  // Positions (optional): used for vision cone/hearing capacity checks.
  // Prefer explicit positions provided in event details (renderer -> backend batches),
  // then fall back to local movement_state (backend-only), then storage init.
  const details_pos = (details as any)?.observer_pos;
  const observer_state = ensure_movement_state(observer_ref);
  const observer_pos =
    details_pos && typeof details_pos.x === "number" && typeof details_pos.y === "number"
      ? { x: details_pos.x, y: details_pos.y }
      : observer_state?.last_position;

  const actor_pos =
    typeof event.location?.x === "number" && typeof event.location?.y === "number"
      ? { x: event.location.x, y: event.location.y }
      : undefined;

  let best_sense: string | null = null;
  let detectable = false;

  // Prefer higher-intensity senses first so "pressure" can win over "light" for speech, etc.
  const candidates = broadcasts
    .filter(b => event.distance <= b.range_tiles)
    .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0));

  for (const b of candidates) {

    // Directional constraints
    if (b.sense === "light") {
      if (observer_pos && actor_pos) {
        if (!can_see(observer_ref, observer_pos, actor_pos)) {
          debug_event("WITNESS", "perception.vision_blocked", {
            observer_ref,
            verb: event.verb,
            distance: event.distance,
          });
          continue;
        }
      }
    }

    if (b.sense === "pressure") {
      // Hearing is omnidirectional but limited by the observer's hearing capacity.
      if (observer_pos && actor_pos) {
        if (!can_hear(observer_ref, observer_pos, actor_pos)) {
          debug_event("WITNESS", "perception.hearing_blocked", {
            observer_ref,
            verb: event.verb,
            distance: event.distance,
          });
          continue;
        }
      }
    }

    detectable = true;
    best_sense = b.sense;
    break;
  }

  debug_event("WITNESS", "perception.detection", {
    observer_ref,
    verb: event.verb,
    detectable,
    best_sense,
  });

  if (!detectable) {
    debug_event("WITNESS", "perception.detection_failed", { observer_ref, verb: event.verb });
    return false;
  }
  
  debug_event("WITNESS", "perception.ok", { observer_ref, verb: event.verb });
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
  debug_event("WITNESS", "communication.perceived", {
    observer_ref,
    actor_ref: event.actorRef,
    target_ref: event.targetRef,
    distance: event.distance
  });
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
    // End conversation/engagement if the farewell is directed to this NPC or
    // if this NPC is currently engaged with the speaker (even if conversation_state is missing).
    const is_addressed = event.targetRef === observer_ref;
    const engagement = getEngagement(observer_ref);
    const engaged_with_speaker = !!engagement?.engaged_with?.includes(event.actorRef);
    const conv = get_conversation(observer_ref);
    const talking_to_speaker = !!conv && conv.target_entity === event.actorRef;

    if (is_addressed || engaged_with_speaker || talking_to_speaker) {
      debug_log("[Witness]", `Ending conversation for ${observer_ref} (farewell)`);
      const ended_conv = end_conversation(observer_ref);
      restore_previous_goal(observer_ref, ended_conv);
    }
    return;
  }
  
  // Check if addressed or very close
  const is_addressed = event.targetRef === observer_ref;
  const is_very_close = event.distance <= 2;
  const should_respond = is_addressed || is_very_close;
  
  debug_event("WITNESS", "communication.response_check", {
    observer_ref,
    is_addressed,
    is_very_close,
    distance: event.distance,
    event_target_ref: event.targetRef,
  });
  debug_log("[Witness]", `Response check for ${observer_ref}:`, { is_addressed, is_very_close, distance: event.distance });
  
  if (!should_respond) {
    debug_log("[Witness]", `${observer_ref} not responding - not addressed and not close enough`);
    // Handle as bystander (might eavesdrop based on personality)
    handle_bystander_reaction(observer_ref, event);
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
      updateEngagement(observer_ref); // Also extend engagement
      face_actor(observer_ref, event);

      // Sync cross-process conversation presence for movement decisions.
      const updated = get_conversation(observer_ref);
      if (updated) {
        set_conversation_presence(data_slot, observer_ref, updated.target_entity, updated.timeout_at_ms);
      }

      // This NPC is a conversation participant and is therefore eligible to respond.
      note_response_eligible(event.actionId, observer_ref);
      // Note: NPC responses are handled by process_communication() in the main loop,
      // which reads the original COMMUNICATE message from the outbox and generates
      // contextual LLM responses using build_npc_prompt() and the full decision hierarchy.
    }
    // If talking to someone else, check if we should switch
    else if (conv && is_addressed) {
      debug_log("[Witness]", `Switching conversation for ${observer_ref} to ${event.actorRef}`);
      // Switch to new speaker
      const ended_conv = end_conversation(observer_ref);
      restore_previous_goal(observer_ref, ended_conv);
      start_conversation_with_actor(observer_ref, event);
    }
    return;
  }
  
  // Not in conversation - check if NPC should engage
  debug_log("[Witness]", `Starting conversation for ${observer_ref} with ${event.actorRef}`);
  start_conversation_with_actor(observer_ref, event);
  
  // Also enter engagement state for better tracking
  enterEngagement(observer_ref, event.actorRef, "participant");
}

/**
 * Handle bystander reaction to communication
 * NPCs who hear but aren't directly addressed
 */
function handle_bystander_reaction(
  observer_ref: string,
  event: PerceptionEvent
): void {
  // Skip if already in conversation
  if (is_in_conversation(observer_ref) || isEngaged(observer_ref)) {
    return;
  }
  
  // Get message details
  const message = (event.details as any)?.messageText || "";
  const volume = (event.details as any)?.volume || "NORMAL";
  
  // Get personality for this NPC (includes shopkeeper info)
  const personality = getDefaultPersonality(observer_ref);
  
  // Get NPC location for place context
  const npc_id = observer_ref.replace("npc.", "");
  const npc_result = load_npc(data_slot, npc_id);
  let current_place_id: string | undefined;
  if (npc_result.ok && npc_result.npc) {
    const npc_location = get_npc_location(npc_result.npc);
    current_place_id = npc_location?.place_id;
  }
  
  // Check if this NPC was directly addressed
  const is_direct_address = event.targetRef === observer_ref;
  
  // Calculate social response with place context
  const result = calculateSocialResponse(
    personality,
    message,
    volume as VolumeLevel,
    event.distance,
    event.actorRef,
    0, // relationship_fondness
    current_place_id,
    is_direct_address
  );
  
  logSocialCheck(observer_ref, result, {
    message,
    distance: event.distance,
    volume: volume as VolumeLevel
  });
  
  // Handle based on interest level
  switch (result.response_type) {
    case "join":
      // High interest - join as participant
      debug_log("[Witness]", `${observer_ref} is interested (${result.interest_level}) - joining conversation`);
      start_conversation_with_actor(observer_ref, event);
      enterEngagement(observer_ref, event.actorRef, "participant");
      face_actor(observer_ref, event);

      // Store a lightweight memory for joiners (they're attentive by choice).
      if (message.trim().length > 0 && shouldRemember(result.interest_level, false)) {
        const importance = Math.max(
          1,
          calculateMemoryImportance(
            result.interest_level,
            false,
            message.toLowerCase().includes("secret")
          )
        );
        try {
          add_memory(data_slot, observer_ref, {
            type: "conversation",
            importance,
            summary: `I overheard ${event.actorRef} speaking${event.targetRef ? ` to ${event.targetRef}` : ""}: "${message}"`,
            details: [
              `role=joiner`,
              `volume=${String(volume)}`,
              `distance=${event.distance.toFixed(2)}`,
              `interest=${result.interest_level}`,
              `perception_event_id=${event.id}`,
              `action_id=${event.actionId}`,
            ].join("\n"),
            related_entities: [event.actorRef, ...(event.targetRef ? [event.targetRef] : [])],
            location: current_place_id,
            emotional_tone: "curious",
          });
        } catch (err) {
          debug_event("WITNESS", "memory.store_failed", {
            observer_ref,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      break;
      
    case "eavesdrop":
      // Medium interest - eavesdrop as bystander
      debug_log("[Witness]", `${observer_ref} is curious (${result.interest_level}) - eavesdropping`);
      enterEngagement(observer_ref, event.actorRef, "bystander");
      
      // Determine if should remember this
      if (shouldRemember(result.interest_level, false)) {
        const importance = calculateMemoryImportance(
          result.interest_level,
          false,
          message.toLowerCase().includes("secret")
        );
        debug_log("[Witness]", `${observer_ref} will remember this conversation (importance: ${importance})`);

        if (message.trim().length > 0) {
          try {
            add_memory(data_slot, observer_ref, {
              type: "conversation",
              importance: Math.max(1, importance),
              summary: `I overheard ${event.actorRef} speaking${event.targetRef ? ` to ${event.targetRef}` : ""}: "${message}"`,
              details: [
                `role=bystander`,
                `volume=${String(volume)}`,
                `distance=${event.distance.toFixed(2)}`,
                `interest=${result.interest_level}`,
                `perception_event_id=${event.id}`,
                `action_id=${event.actionId}`,
              ].join("\n"),
              related_entities: [event.actorRef, ...(event.targetRef ? [event.targetRef] : [])],
              location: current_place_id,
              emotional_tone: "curious",
            });
          } catch (err) {
            debug_event("WITNESS", "memory.store_failed", {
              observer_ref,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      break;
      
    case "ignore":
    default:
      // Low interest - ignore
      debug_log("[Witness]", `${observer_ref} not interested (${result.interest_level}) - ignoring`);
      // Just face if close
      if (event.distance <= 5) {
        face_actor(observer_ref, event);
      }
      break;
  }
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
  
  // Don't interrupt conversations or engagements
  if (is_in_conversation(observer_ref) || isEngaged(observer_ref)) return;
  
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
  debug_event("WITNESS", "conversation.start_requested", {
    npc_ref: observer_ref,
    actor_ref: event.actorRef,
  });
  debug_log("[Witness]", `start_conversation_with_actor called for ${observer_ref}`);
  
  // Check if we already started a conversation with this NPC recently
  if (is_starting_conversation(observer_ref)) {
    debug_log("[Witness]", `Already starting conversation for ${observer_ref}, skipping`);
    return;
  }
  
  // Check if we're throttled (minimum time between conversation attempts)
  if (!should_send_command(observer_ref, "conversation_start")) {
    debug_log("[Witness]", `Throttled - too soon to start another conversation with ${observer_ref}`);
    return;
  }
  
  // Mark that we're starting a conversation (prevents duplicate calls)
  mark_conversation_starting(observer_ref);
  
  // Get message from event details
  const message_text = (event.details as any)?.messageText || "";
  
  // Note: NPC responses are handled by process_communication() in the main NPC_AI loop,
  // which reads the original COMMUNICATE message from outbox and generates contextual
  // LLM responses using build_npc_prompt() and the full decision hierarchy (scripted → template → AI).
  // The witness system only handles engagement state (stop, face, timeout) and visual feedback.
  
  const state = ensure_movement_state(observer_ref);
  if (!state) {
    debug_log("[Witness]", `No movement state for ${observer_ref}`);
    mark_conversation_ended(observer_ref);
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

  // Sync presence to disk so other processes (npc_ai) treat this NPC as in-conversation.
  const conv = get_conversation(observer_ref);
  if (conv) {
    set_conversation_presence(data_slot, observer_ref, conv.target_entity, conv.timeout_at_ms);
  }
  
  // Set conversation goal
  const target_pos = { x: event.location.x ?? 0, y: event.location.y ?? 0 };
  debug_log("[Witness]", `Generating conversation goal for ${observer_ref} at (${target_pos.x}, ${target_pos.y})`);
  const converse_goal = generate_conversation_goal(observer_ref, event.actorRef, target_pos);
  debug_log("[Witness]", `Setting goal for ${observer_ref}:`, { goal_type: converse_goal.type, priority: converse_goal.priority });
  set_goal(observer_ref, converse_goal);
  face_actor(observer_ref, event);
  
  // Update NPC status to "busy" in place data so renderer shows conversation state
  debug_event("WITNESS", "npc_status.set", {
    npc_ref: observer_ref,
    status: "busy",
    reason: "enter_conversation",
  });
  update_npc_status_in_place(observer_ref, "busy");
  
  // Send status command to renderer for real-time visual indicator
  send_status_command(observer_ref, "busy", "Entering conversation");
  // Status commands are the renderer-visible source of truth for conversation visuals.

  // Single pipeline: if the witness system put this NPC into conversation, they are eligible
  // to respond to this COMMUNICATE action.
  note_response_eligible(event.actionId, observer_ref);
  
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
function restore_previous_goal(npc_ref: string, ended_conv?: any | null): void {
  const conv = ended_conv ?? get_conversation(npc_ref);
  if (!conv) {
    // Even if we lost the conversation record, always clear the visual/engagement state.
    update_npc_status_in_place(npc_ref, "present");
    send_status_command(npc_ref, "present", "Exiting conversation");
    clear_conversation_presence(data_slot, npc_ref);
    endEngagement(npc_ref, "conversation ended");
    mark_conversation_ended(npc_ref);
    return;
  }

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
  clear_conversation_presence(data_slot, npc_ref);
   
  // Send status command to renderer to update visual indicator
  send_status_command(npc_ref, "present", "Exiting conversation");
  
  // End engagement tracking
  endEngagement(npc_ref, "conversation ended");
  
  // Clear conversation starting flag
  mark_conversation_ended(npc_ref);
}

/**
 * Update conversations and clean up timed-out ones
 */
export function update_conversations(): void {
  const ended = update_conversations_state();

  // Restore goals for ended conversations
  for (const conv of ended) {
    restore_previous_goal(conv.npc_ref, conv);
  }
}

/**
 * Force end a conversation (for admin/debug)
 */
export function force_end_conversation(npc_ref: string): void {
  if (is_in_conversation(npc_ref)) {
    const ended_conv = end_conversation(npc_ref);
    restore_previous_goal(npc_ref, ended_conv);
    debug_log("Witness", `Force-ended conversation for ${npc_ref}`);
  }
}

/**
 * End all conversations (and engagement/status) involving an entity.
 * Used when an actor leaves a place so NPCs stop following/being "busy".
 */
export function end_conversations_involving_entity(entity_ref: string, reason: string): void {
  // End conversations tracked in conversation_state
  for (const conv of get_all_conversations()) {
    if (conv.target_entity === entity_ref || conv.participants.includes(entity_ref)) {
      const ended_conv = end_conversation(conv.npc_ref);
      restore_previous_goal(conv.npc_ref, ended_conv);
      debug_log("Witness", `Ended conversation for ${conv.npc_ref} because ${entity_ref} (${reason})`);
    }
  }

  // Also end any engagement-only cases (in case conversation_state was lost)
  for (const npc_ref of getEngagedWith(entity_ref)) {
    restore_previous_goal(npc_ref, null);
    debug_log("Witness", `Ended engagement for ${npc_ref} because ${entity_ref} (${reason})`);
  }
}

/**
 * Get witness debug info
 */
export function get_witness_debug_info(): {
  conversations_active: number;
} {
  return {
    conversations_active: get_conversation_count()
  };
}

/**
 * Update NPC status in place data
 *
 * NOTE: Status is an ephemeral, renderer-visible state and should be driven by `NPC_STATUS`
 * commands. Persisting it to disk can cause stale "busy" flags across sessions.
 */
function update_npc_status_in_place(
  npc_ref: string,
  status: "present" | "moving" | "busy" | "sleeping"
): void {
  try {
    debug_event("WITNESS", "place_status.update_skipped", { npc_ref, status });
  } catch (err) {
    // Keep as console.error so it shows regardless of debug level.
    console.error(`[Witness] ERROR updating ${npc_ref} status:`, err);
  }
}

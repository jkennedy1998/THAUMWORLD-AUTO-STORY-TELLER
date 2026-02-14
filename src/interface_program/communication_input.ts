// Communication Input Module
// Handles text input, volume selection, and intent creation

import { createIntent } from "../action_system/intent.js";
import { get_sense_profile } from "../action_system/sense_broadcast.js";
import { load_actor } from "../actor_storage/store.js";
import { getActorTarget, hasValidTarget } from "./target_state.js";
import { debug_log } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

export type VolumeLevel = "WHISPER" | "NORMAL" | "SHOUT";

export interface CommunicationIntent {
  verb: "COMMUNICATE";
  actorRef: string;
  targetRef?: string;
  message: string;
  volume: VolumeLevel;
  tool: string;
}

function get_communicate_pressure_range_tiles(volume: VolumeLevel): number {
  const profile = get_sense_profile("COMMUNICATE", volume);
  const pressure = profile?.broadcasts.find(b => b.sense === "pressure");
  if (pressure?.range_tiles) return pressure.range_tiles;

  // Fallback values should match `src/action_system/sense_broadcast.ts`.
  switch (volume) {
    case "WHISPER": return 3;
    case "NORMAL": return 5;
    case "SHOUT": return 30;
    default: return 5;
  }
}

// Current state
let current_volume: VolumeLevel = "NORMAL";
let current_message: string = "";

/**
 * Set volume level (called when volume button clicked)
 */
export function setVolume(volume: VolumeLevel): void {
  debug_log("[INPUT]", `Volume set to: ${volume}`);
  current_volume = volume;

  // UI rendering of selected volume is handled by the frontend.
}

/**
 * Get current volume
 */
export function getVolume(): VolumeLevel {
  return current_volume;
}

/**
 * Set message text
 */
export function setMessage(message: string): void {
  current_message = message;
}

/**
 * Create COMMUNICATE intent from current state
 * This is called when user hits Enter or clicks Send
 */
export function createCommunicationIntent(): CommunicationIntent | null {
  const actor_ref = "actor.henry_actor"; // TODO: Get from session
  
  // Load actor
  const actor_result = load_actor(data_slot_number, "henry_actor");
  if (!actor_result.ok || !actor_result.actor) {
    debug_log("[INPUT]", "Failed to load actor");
    return null;
  }
  
  const actor = actor_result.actor as any;
  const actor_location = actor.location;
  
  if (!actor_location) {
    debug_log("[INPUT]", "Actor has no location");
    return null;
  }
  
  // Get target from target state
  const target_ref = hasValidTarget(actor_ref) 
    ? getActorTarget(actor_ref)?.target_ref 
    : undefined;
  
  if (!current_message.trim()) {
    debug_log("[INPUT]", "Empty message, not creating intent");
    return null;
  }
  
  debug_log("[INPUT]", `Creating COMMUNICATE intent`, {
    actor: actor_ref,
    target: target_ref || "(none - broadcast)",
    volume: current_volume,
    message: current_message.slice(0, 50)
  });
  
  // Create the intent using action system
  const intent = createIntent(actor_ref, "COMMUNICATE", "player_input", {
    actorLocation: {
      world_x: actor_location.world_tile?.x ?? 0,
      world_y: actor_location.world_tile?.y ?? 0,
      region_x: actor_location.region_tile?.x ?? 0,
      region_y: actor_location.region_tile?.y ?? 0,
      x: actor_location.tile?.x ?? 0,
      y: actor_location.tile?.y ?? 0,
      place_id: actor_location.place_id
    },
    targetRef: target_ref,
    parameters: {
      subtype: current_volume,
      message: current_message,
      volume: current_volume,
      targets: target_ref ? [target_ref] : []
    }
  });
  
  // Clear message after sending
  current_message = "";
  
  // Return the full intent with actorLocation for the action pipeline
  return {
    ...intent,
    verb: "COMMUNICATE",
    message: intent.parameters?.message || "",
    volume: current_volume,
    tool: "actor.voice"
  };
}

/**
 * Handle text input submission
 * Called when user presses Enter or clicks Send button
 */
export function handleCommunicationSubmit(
  text: string,
  processIntentFn: (intent: any) => void
): void {
  setMessage(text);
  const intent = createCommunicationIntent();
  
  if (intent) {
    processIntentFn(intent);
  } else {
    debug_log("[INPUT]", "Failed to create communication intent");
  }
}

/**
 * Get range for volume level
 */
export function getVolumeRange(volume: VolumeLevel): number {
  return get_communicate_pressure_range_tiles(volume);
}

/**
 * Get description for volume level
 */
export function getVolumeDescription(volume: VolumeLevel): string {
  const range = getVolumeRange(volume);
  switch (volume) {
    case "WHISPER": return `Quiet; audible within ${range} tiles`;
    case "NORMAL": return `Normal conversation; audible within ${range} tiles`;
    case "SHOUT": return `Loud; audible within ${range} tiles`;
    default: return `Audible within ${range} tiles`;
  }
}

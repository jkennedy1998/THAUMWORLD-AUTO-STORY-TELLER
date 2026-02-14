/**
 * Movement Command Sender
 * 
 * Part of Phase 8: Unified Movement Authority
 * 
 * This module sends movement commands from NPC_AI (backend) to the renderer (frontend).
 * NPC_AI is the SOLE AUTHORITY for all NPC movement decisions.
 * 
 * Usage:
 *   import { send_movement_command } from "./movement_command_sender.js";
 *   
 *   // When conversation starts:
 *   send_movement_command(npc_ref, {
 *     type: "NPC_STOP",
 *     reason: "Entering conversation with player"
 *   });
 *   
 *   // Face the speaker:
 *   send_movement_command(npc_ref, {
 *     type: "NPC_FACE",
 *     target_entity: speaker_ref,
 *     reason: "Face player during conversation"
 *   });
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { get_outbox_path } from "../engine/paths.js";
import { ensure_outbox_exists, read_outbox, write_outbox } from "../engine/outbox_store.js";
import { debug_log } from "../shared/debug.js";
import type { AnyMovementCommand, AnyMovementCommandInput, MovementCommandMessage } from "../shared/movement_commands.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

/**
 * Send a movement command to the renderer
 * 
 * @param npc_ref - NPC reference (e.g., "npc.grenda")
 * @param command - Movement command (without npc_ref and timestamp)
 * @param place_id - Optional place ID for context
 * @returns true if command was sent successfully
 */
export function send_movement_command(
  npc_ref: string,
  command: AnyMovementCommandInput,
  place_id?: string
): boolean {
  try {
    const outbox_path = get_outbox_path(data_slot);
    ensure_outbox_exists(outbox_path);

    // Create full command with npc_ref and timestamp
    const full_command = {
      ...command,
      npc_ref,
      timestamp: Date.now(),
    } as AnyMovementCommand;

    // Create message envelope
    const message: MovementCommandMessage = {
      id: `move_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      command: full_command,
      sender: "npc_ai",
      recipient: "renderer",
      place_id,
      created_at: new Date().toISOString(),
    };

    // Read current outbox
    const outbox = read_outbox(outbox_path);

    // Add movement command to outbox
    // We use a special "movement_command" type that the renderer will recognize
    outbox.messages.unshift({
      id: message.id,
      sender: "npc_ai",
      content: JSON.stringify(message),
      created_at: message.created_at,
      type: "movement_command",
      stage: "npc_movement",
      status: "sent",
      meta: {
        movement_command: true,
        npc_ref,
        command_type: command.type,
      },
    });

    // Write back to outbox
    write_outbox(outbox_path, outbox);

    debug_log("[MovementCommand]", `Sent ${command.type} to ${npc_ref}`, {
      reason: command.reason,
      place_id,
    });

    return true;
  } catch (error) {
    debug_log("[MovementCommand]", `Failed to send command to ${npc_ref}:`, error);
    return false;
  }
}

/**
 * Send NPC_STOP command - Stop all movement immediately
 */
export function send_stop_command(
  npc_ref: string,
  reason: string,
  place_id?: string
): boolean {
  return send_movement_command(
    npc_ref,
    { type: "NPC_STOP", reason },
    place_id
  );
}

/**
 * Send NPC_FACE command - Face a specific entity or direction
 */
export function send_face_command(
  npc_ref: string,
  target_entity: string,
  reason: string,
  place_id?: string
): boolean {
  const face_cmd: AnyMovementCommand = {
    type: "NPC_FACE",
    npc_ref: "", // Will be set by send_movement_command
    timestamp: 0, // Will be set by send_movement_command
    target_entity,
    reason,
  };
  return send_movement_command(
    npc_ref,
    face_cmd,
    place_id
  );
}

/**
 * Send NPC_WANDER command - Start continuous wandering
 */
export function send_wander_command(
  npc_ref: string,
  reason: string,
  intensity?: number,
  range?: number,
  place_id?: string
): boolean {
  const wander_cmd: AnyMovementCommand = {
    type: "NPC_WANDER",
    npc_ref: "",
    timestamp: 0,
    reason,
    intensity,
    range,
  };
  return send_movement_command(
    npc_ref,
    wander_cmd,
    place_id
  );
}

/**
 * Send NPC_MOVE command - Move to a specific position
 */
export function send_move_command(
  npc_ref: string,
  target_position: { x: number; y: number },
  reason: string,
  path?: { x: number; y: number }[],
  speed?: number,
  place_id?: string
): boolean {
  const move_cmd: AnyMovementCommand = {
    type: "NPC_MOVE",
    npc_ref: "",
    timestamp: 0,
    target_position,
    path,
    speed,
    reason,
  };
  return send_movement_command(
    npc_ref,
    move_cmd,
    place_id
  );
}

/**
 * Send NPC_STATUS command - Update NPC status for visual indicator
 * Used when NPC enters/exits conversation
 */
export function send_status_command(
  npc_ref: string,
  status: "present" | "moving" | "busy" | "sleeping",
  reason: string,
  place_id?: string
): boolean {
  console.log(`[MovementCommand] Sending STATUS command for ${npc_ref}: ${status}`);
  const status_cmd: AnyMovementCommand = {
    type: "NPC_STATUS",
    npc_ref: "",
    timestamp: 0,
    status,
    reason,
  };
  const result = send_movement_command(
    npc_ref,
    status_cmd,
    place_id
  );
  console.log(`[MovementCommand] STATUS command result for ${npc_ref}: ${result}`);
  return result;
}

/**
 * Send UI_HIGHLIGHT command - Highlight or unhighlight an entity
 * Used for visual feedback when selecting targets
 * 
 * @param entity_ref - Entity to highlight (npc.<id> or actor.<id>)
 * @param highlight - true to highlight, false to remove
 * @param color - Optional color ("yellow", "red", "green")
 * @param reason - Why highlighting
 */
export function send_highlight_command(
  entity_ref: string,
  highlight: boolean,
  color: string = "yellow",
  reason: string = "Target selection"
): boolean {
  debug_log("[MovementCommand]", `Sending HIGHLIGHT command for ${entity_ref}: ${highlight ? color : "off"}`);
  
  const result = send_movement_command(
    entity_ref,
    {
      type: "UI_HIGHLIGHT",
      target_entity: entity_ref,
      highlight,
      color,
      reason,
    }
  );
  
  debug_log("[MovementCommand]", `HIGHLIGHT command result: ${result}`);
  return result;
}

/**
 * Send UI_TARGET command - Update target display
 * Shows "Talking to: Grenda" in the UI
 * 
 * @param actor_ref - Who is targeting (e.g., "actor.henry")
 * @param target_ref - Who is being targeted (e.g., "npc.grenda")
 * @param target_name - Display name for UI
 */
export function send_target_command(
  actor_ref: string,
  target_ref: string | undefined,
  target_name: string | undefined,
  reason: string = "Target changed"
): boolean {
  debug_log("[MovementCommand]", `Sending TARGET command: ${actor_ref} → ${target_ref || "(none)"}`);
  
  const result = send_movement_command(
    actor_ref,
    {
      type: "UI_TARGET",
      source_actor: actor_ref,
      target_entity: target_ref,
      display_name: target_name,
      reason,
    }
  );
  
  debug_log("[MovementCommand]", `TARGET command result: ${result}`);
  return result;
}

/**
 * Send UI_SENSE_BROADCAST command - Spawn broadcast particles for an entity.
 */
export function send_sense_broadcast_command(
  entity_ref: string,
  verb: string,
  subtype: string | undefined,
  reason: string,
  place_id?: string
): boolean {
  debug_log("[MovementCommand]", `Sending SENSE_BROADCAST command for ${entity_ref}: ${verb}${subtype ? "." + subtype : ""}`);
  return send_movement_command(
    entity_ref,
    {
      type: "UI_SENSE_BROADCAST",
      verb,
      subtype,
      reason,
    },
    place_id
  );
}

/**
 * Send UI_SOUND command - Play an SFX in the renderer.
 */
export function send_sound_command(
  emitter_ref: string,
  sound_id: string,
  loudness: string | undefined,
  reason: string,
  place_id?: string
): boolean {
  debug_log("[MovementCommand]", `Sending SOUND command for ${emitter_ref}: ${sound_id}`);
  return send_movement_command(
    emitter_ref,
    {
      type: "UI_SOUND",
      sound_id,
      emitter_ref,
      loudness,
      channel: "sfx",
      cooldown_ms: 120,
      reason,
    },
    place_id
  );
}

/**
 * NPC Movement Command Types
 * 
 * Part of Phase 8: Unified Movement Authority
 * 
 * These types define the command protocol between NPC_AI (backend) and
 * the renderer (frontend). NPC_AI makes ALL movement decisions and sends
 * commands. The renderer executes commands without making decisions.
 * 
 * This architecture ensures:
 * - Single source of truth for movement (NPC_AI)
 * - No race conditions between systems
 * - Proper conversation state handling
 * - Tabletop RPG feel (DM controls all NPCs)
 */

import type { TilePosition } from "../types/place.js";

/**
 * Types of movement commands NPC_AI can send to renderer
 */
export type MovementCommandType = 
  | "NPC_STOP"      // Stop all movement immediately
  | "NPC_MOVE"      // Move to specific position
  | "NPC_WANDER"    // Start continuous wandering
  | "NPC_FACE"      // Face a direction or entity
  | "NPC_PATROL"    // Follow a patrol route
  | "NPC_FLEE"      // Move away from threat
  | "NPC_STATUS"    // Update NPC status (busy/present)
  | "UI_HIGHLIGHT"  // Highlight entity in UI
  | "UI_TARGET";    // Update target display

/**
 * Base movement command interface
 * All commands extend this
 */
export interface MovementCommand {
  type: MovementCommandType;
  npc_ref: string;
  timestamp: number;  // When command was issued
  reason: string;     // Why this command was sent (for debugging)
}

/**
 * Stop all movement immediately
 * Used when:
 * - Conversation starts
 * - Combat starts
 * - NPC needs to react to event
 */
export interface NPCStopCommand extends MovementCommand {
  type: "NPC_STOP";
}

/**
 * Move to a specific position
 * Used when:
 * - NPC needs to approach player for conversation
 * - NPC is following a path
 * - NPC is fleeing to specific location
 */
export interface NPCMoveCommand extends MovementCommand {
  type: "NPC_MOVE";
  target_position: TilePosition;
  path?: TilePosition[];  // Optional: specific path to follow
  speed?: number;         // Optional: tiles per minute
}

/**
 * Start continuous wandering
 * Used when:
 * - NPC has no specific goal
 * - Previous goal completed
 * - Conversation ended
 */
export interface NPCWanderCommand extends MovementCommand {
  type: "NPC_WANDER";
  intensity?: number;  // 1-10: how energetic the wandering is
  range?: number;      // Maximum distance from current position
}

/**
 * Face a specific direction or entity
 * Used when:
 * - NPC enters conversation (face speaker)
 * - NPC reacts to sound
 * - NPC acknowledges player presence
 */
export interface NPCFaceCommand extends MovementCommand {
  type: "NPC_FACE";
  target?: TilePosition;  // Face toward position
  target_entity?: string; // Or face toward entity (npc.<id> or actor.<id>)
  direction?: "north" | "south" | "east" | "west";  // Or specific direction
}

/**
 * Follow a patrol route
 * Used when:
 * - NPC is a guard on patrol
 * - NPC has routine waypoints
 */
export interface NPCPatrolCommand extends MovementCommand {
  type: "NPC_PATROL";
  waypoints: TilePosition[];
  loop?: boolean;      // Return to start after last waypoint
  pause_ms?: number;   // Pause at each waypoint
}

/**
 * Flee from a threat
 * Used when:
 * - NPC is in combat and needs to retreat
 * - NPC is frightened
 */
export interface NPCFleeCommand extends MovementCommand {
  type: "NPC_FLEE";
  from_position: TilePosition;  // Flee from this location
  min_distance: number;         // Minimum safe distance
}

/**
 * Update NPC status
 * Used when:
 * - NPC enters/exits conversation (busy/present)
 * - NPC state changes that visual indicator should show
 */
export interface NPCStatusCommand extends MovementCommand {
  type: "NPC_STATUS";
  status: "present" | "moving" | "busy" | "sleeping";
}

/**
 * Visual Feedback Command
 * Used for UI feedback, not movement
 * These are separate from movement commands
 */
export interface UIHighlightCommand extends MovementCommand {
  type: "UI_HIGHLIGHT";
  target_entity: string; // Entity to highlight (using consistent naming)
  highlight: boolean;    // true = highlight, false = remove
  color?: string;        // Optional: "yellow", "red", etc.
}

/**
 * Target Update Command
 * Updates the target display in UI
 * Shows "Talking to: Grenda" or similar
 */
export interface UITargetCommand extends MovementCommand {
  type: "UI_TARGET";
  source_actor: string;  // Who is targeting (using consistent naming)
  target_entity?: string; // Who is being targeted (undefined = clear)
  display_name?: string;  // Display name for UI
}

/**
 * Union type for all movement commands
 */
export type AnyMovementCommand =
  | NPCStopCommand
  | NPCMoveCommand
  | NPCWanderCommand
  | NPCFaceCommand
  | NPCPatrolCommand
  | NPCFleeCommand
  | NPCStatusCommand
  | UIHighlightCommand
  | UITargetCommand;

/**
 * Message envelope for movement commands
 * Wraps the command with routing info
 */
export interface MovementCommandMessage {
  id: string;
  command: AnyMovementCommand;
  sender: "npc_ai";    // Always from NPC_AI
  recipient: "renderer"; // Always to renderer
  place_id?: string;   // Which place this affects
  created_at: string;  // ISO timestamp
}

/**
 * NPC Position Update Message
 * Sent from renderer to backend when NPC completes movement
 * So backend can save position to storage
 */
export interface NPCPositionUpdateMessage {
  id: string;
  type: "npc_position_update";
  npc_ref: string;
  position: { x: number; y: number };
  place_id: string;
  timestamp: string;
  sender: "renderer";
  recipient: "npc_ai";
}

/**
 * Storage format for movement commands
 * Used when saving to outbox or sending via IPC
 */
export interface MovementCommandStorage {
  schema_version: 1;
  commands: MovementCommandMessage[];
}

/**
 * Helper function to create a movement command message
 */
export function create_movement_command(
  npc_ref: string,
  command: Omit<AnyMovementCommand, "npc_ref" | "timestamp">,
  reason: string,
  place_id?: string
): MovementCommandMessage {
  const full_command = {
    ...command,
    npc_ref,
    timestamp: Date.now(),
    reason,
  } as AnyMovementCommand;

  return {
    id: `move_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    command: full_command,
    sender: "npc_ai",
    recipient: "renderer",
    place_id,
    created_at: new Date().toISOString(),
  };
}

/**
 * Type guards for movement commands
 */
export function is_stop_command(cmd: AnyMovementCommand): cmd is NPCStopCommand {
  return cmd.type === "NPC_STOP";
}

export function is_move_command(cmd: AnyMovementCommand): cmd is NPCMoveCommand {
  return cmd.type === "NPC_MOVE";
}

export function is_wander_command(cmd: AnyMovementCommand): cmd is NPCWanderCommand {
  return cmd.type === "NPC_WANDER";
}

export function is_face_command(cmd: AnyMovementCommand): cmd is NPCFaceCommand {
  return cmd.type === "NPC_FACE";
}

export function is_patrol_command(cmd: AnyMovementCommand): cmd is NPCPatrolCommand {
  return cmd.type === "NPC_PATROL";
}

export function is_flee_command(cmd: AnyMovementCommand): cmd is NPCFleeCommand {
  return cmd.type === "NPC_FLEE";
}

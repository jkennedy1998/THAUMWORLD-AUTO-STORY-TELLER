/**
 * Movement Command Handler (Renderer Side)
 * 
 * Part of Phase 8: Unified Movement Authority
 * 
 * This module runs in the renderer (frontend) and handles movement commands
 * sent by the NPC_AI (backend). Uses Electron IPC to read outbox.
 */

import type { MovementCommandMessage, NPCPositionUpdateMessage } from "../../shared/movement_commands.js";
import { 
  start_entity_movement, 
  stop_entity_movement,
  get_movement_state 
} from "../../shared/movement_engine.js";
import { find_path } from "../../shared/pathfinding.js";
import type { Place, TilePosition } from "../../types/place.js";
import { set_facing, face_target } from "../../npc_ai/facing_system.js";

// Track processed command IDs to avoid duplicates
const processed_commands = new Set<string>();

// Track place data for pathfinding
let current_place: Place | null = null;

// Track NPC actual positions (persisted between movements to prevent snap-back)
// This is needed because place data gets refreshed from storage which may have stale positions
const npc_actual_positions = new Map<string, TilePosition>();

// Track when handler started (to ignore old queued messages at startup)
const handler_start_time = Date.now();
const STARTUP_GRACE_PERIOD_MS = 5000; // Ignore commands from first 5 seconds after startup

// Renderer-side throttling: minimum time between wander commands per NPC
const npc_last_wander_time = new Map<string, number>();
const MIN_WANDER_INTERVAL_MS = 8000; // Match backend's 8-second throttle

// Track NPCs currently being processed (prevents race conditions)
const npcs_being_processed = new Set<string>();

// Maximum age of commands to process (ignore stale commands)
const MAX_COMMAND_AGE_MS = 30000; // 30 seconds

// Declare electronAPI that was exposed in preload script
declare global {
  interface Window {
    electronAPI?: {
      readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
      getDataSlotDir: (slot: number) => Promise<string>;
    };
  }
}

/**
 * Set the current place for pathfinding
 * Also syncs NPC positions from place data to the tracker
 */
export function set_command_handler_place(place: Place | null): void {
  current_place = place;
  
  // Sync positions from place data to tracker
  // This ensures we have the latest positions when place is refreshed
  if (place) {
    for (const npc of place.contents.npcs_present) {
      const current_tracked = npc_actual_positions.get(npc.npc_ref);
      // Only update if place has a different position (new data from storage)
      // But prefer the tracked position if the NPC was recently moving
      if (!current_tracked) {
        npc_actual_positions.set(npc.npc_ref, { ...npc.tile_position });
      }
    }
  }
}

/**
 * Update actor position in current_place
 * This is called when the player moves to ensure facing commands use current positions
 */
export function update_actor_position_in_place(
  actor_ref: string,
  new_position: TilePosition
): void {
  if (!current_place) return;
  
  const actor = current_place.contents.actors_present.find(
    (a: any) => a.actor_ref === actor_ref
  );
  
  if (actor) {
    actor.tile_position = { ...new_position };
    console.log(`[MovementCommandHandler] Updated ${actor_ref} position to (${new_position.x}, ${new_position.y})`);
  }
}

/**
 * Set tracked position for any entity (NPC or actor)
 * Used for real-time facing calculations
 */
export function set_npc_tracked_position(
  entity_ref: string,
  position: TilePosition
): void {
  npc_actual_positions.set(entity_ref, { ...position });
  console.log(`[MovementCommandHandler] Tracked position for ${entity_ref}: (${position.x}, ${position.y})`);
}

/**
 * Mark all existing movement commands in outbox as processed
 * This clears the backlog from previous sessions
 */
async function mark_existing_commands_processed(): Promise<void> {
  try {
    if (!window.electronAPI) return;
    
    const dataSlotDir = await window.electronAPI.getDataSlotDir(1);
    const outboxPath = `${dataSlotDir}/outbox.jsonc`;
    
    const result = await window.electronAPI.readFile(outboxPath);
    if (!result.success || !result.content) return;
    
    const outbox = JSON.parse(result.content);
    if (!outbox.messages || !Array.isArray(outbox.messages)) return;
    
    let marked_count = 0;
    for (const msg of outbox.messages) {
      if ((msg.type === "movement_command" || msg.meta?.movement_command) && !processed_commands.has(msg.id)) {
        processed_commands.add(msg.id);
        marked_count++;
      }
    }
    
    if (marked_count > 0) {
      console.log(`[MovementCommandHandler] Cleared ${marked_count} queued movement commands from backlog`);
    }
  } catch (err) {
    // Silently fail - outbox might not exist yet
    console.log("[MovementCommandHandler] Could not clear backlog (outbox may not exist yet)");
  }
}

/**
 * Start the movement command handler
 * Polls the outbox for movement commands and executes them
 */
export function start_movement_command_handler(poll_ms: number = 500): () => void {
  console.log("[MovementCommandHandler] Started");
  
  // Mark all existing movement commands as "processed" to clear the backlog
  // This prevents rapid-fire execution of queued commands from previous sessions
  void mark_existing_commands_processed();
  
  const interval_id = setInterval(() => {
    process_movement_commands();
  }, poll_ms);
  
  // Return cleanup function
  return () => {
    clearInterval(interval_id);
    console.log("[MovementCommandHandler] Stopped");
  };
}

/**
 * Process all pending movement commands from outbox
 */
async function process_movement_commands(): Promise<void> {
  try {
    if (!window.electronAPI) {
      console.error("[MovementCommandHandler] Electron API not available");
      return;
    }
    
    // Get data slot directory
    const dataSlotDir = await window.electronAPI.getDataSlotDir(1);
    const outboxPath = `${dataSlotDir}/outbox.jsonc`;
    
    // Read outbox via IPC
    const result = await window.electronAPI.readFile(outboxPath);
    if (!result.success || !result.content) {
      return;
    }
    
    // Parse outbox
    const outbox = JSON.parse(result.content);
    if (!outbox.messages || !Array.isArray(outbox.messages)) {
      return;
    }
    
    const now = Date.now();
    const startup_complete = now - handler_start_time > STARTUP_GRACE_PERIOD_MS;
    
    // Find movement command messages
    const commands = outbox.messages.filter((msg: any) => {
      // Skip if not a movement command
      if (msg.type !== "movement_command" && !msg.meta?.movement_command) {
        return false;
      }
      
      // Skip if already processed
      if (processed_commands.has(msg.id)) {
        return false;
      }
      
      // Skip commands from before startup (old queued messages)
      const msg_timestamp = new Date(msg.created_at).getTime();
      if (!startup_complete && msg_timestamp < handler_start_time) {
        processed_commands.add(msg.id); // Mark as processed so we don't check again
        return false;
      }
      
      // Skip stale commands (older than MAX_COMMAND_AGE_MS)
      const age_ms = now - msg_timestamp;
      if (age_ms > MAX_COMMAND_AGE_MS) {
        processed_commands.add(msg.id);
        return false;
      }
      
      return true;
    });
    
    for (const msg of commands) {
      try {
        // Parse the command
        const movement_msg: MovementCommandMessage = JSON.parse(msg.content);
        
        // Mark as processed
        processed_commands.add(msg.id);
        
        // Execute the command
        execute_movement_command(movement_msg);
      } catch (err) {
        console.error(`[MovementCommandHandler] Failed to process command ${msg.id}:`, err);
      }
    }
    
    // Cleanup old processed commands (keep last 100)
    if (processed_commands.size > 1000) {
      const to_remove = Array.from(processed_commands).slice(0, processed_commands.size - 100);
      for (const id of to_remove) {
        processed_commands.delete(id);
      }
    }
  } catch (err) {
    // Silently fail - outbox might not exist yet
    // console.error("[MovementCommandHandler] Failed to process commands:", err);
  }
}

/**
 * Execute a single movement command
 */
function execute_movement_command(msg: MovementCommandMessage): void {
  const { command } = msg;
  const npc_ref = command.npc_ref;
  
  // Only log stop commands (important for conversation flow)
  // Wander/move commands will log when they actually start moving
  if (command.type === "NPC_STOP") {
    console.log(`[MovementCommandHandler] Executing ${command.type} for ${npc_ref}`, {
      reason: command.reason,
    });
  }
  
  switch (command.type) {
    case "NPC_STOP":
      execute_stop_command(npc_ref);
      break;
      
    case "NPC_MOVE":
      execute_move_command(npc_ref, command);
      break;
      
    case "NPC_WANDER":
      execute_wander_command(npc_ref, command);
      break;
      
    case "NPC_FACE":
      execute_face_command(npc_ref, command);
      break;
      
    case "NPC_STATUS":
      execute_status_command(npc_ref, command);
      break;
      
    default:
      console.log(`[MovementCommandHandler] Unknown command type: ${(command as any).type}`);
  }
}

/**
 * Execute NPC_STOP command - Stop all movement
 */
function execute_stop_command(npc_ref: string): void {
  stop_entity_movement(npc_ref);
  console.log(`[MovementCommandHandler] ${npc_ref} stopped`);
}

/**
 * Execute NPC_MOVE command - Move to specific position
 */
function execute_move_command(npc_ref: string, cmd: any): void {
  if (!current_place) {
    console.log(`[MovementCommandHandler] Cannot move ${npc_ref} - no place set`);
    return;
  }
  
  const target = cmd.target_position as TilePosition;
  
  // Find NPC in place
  const npc = current_place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
  if (!npc) {
    console.log(`[MovementCommandHandler] Cannot move ${npc_ref} - not in current place`);
    return;
  }
  
  // Check if path provided, otherwise calculate
  let path = cmd.path as TilePosition[] | undefined;
  if (!path || path.length === 0) {
    const path_result = find_path(current_place, npc.tile_position, target, {
      exclude_entity: npc_ref,
    });
    
    if (path_result.blocked || path_result.path.length === 0) {
      console.log(`[MovementCommandHandler] Cannot move ${npc_ref} - path blocked`);
      return;
    }
    
    path = path_result.path;
  }
  
  // Start movement
  const speed = cmd.speed || 300; // Default 300 tiles/minute
  
  const started = start_entity_movement(
    npc_ref,
    "npc",
    current_place,
    {
      type: "move_to",
      target_position: target,
      priority: 5,
      reason: cmd.reason,
    },
    speed
  );
  
  if (started) {
    console.log(`[MovementCommandHandler] ${npc_ref} moving to (${target.x}, ${target.y})`);
  } else {
    console.log(`[MovementCommandHandler] ${npc_ref} failed to start movement`);
  }
}

/**
 * Execute NPC_WANDER command - Start continuous wandering
 */
function execute_wander_command(npc_ref: string, cmd: any): void {
  if (!current_place) {
    return;
  }
  
  // Check if already being processed (prevents race conditions)
  if (npcs_being_processed.has(npc_ref)) {
    return;
  }
  
  // Renderer-side throttling: check time since last wander
  const now = Date.now();
  const last_wander = npc_last_wander_time.get(npc_ref) || 0;
  const time_since_last_wander = now - last_wander;
  if (time_since_last_wander < MIN_WANDER_INTERVAL_MS) {
    return;
  }
  
  // Check if already moving
  const movement_state = get_movement_state(npc_ref);
  if (movement_state?.is_moving) {
    return;
  }
  
  // Mark as being processed
  npcs_being_processed.add(npc_ref);
  
  // Record wander time
  npc_last_wander_time.set(npc_ref, now);
  
  // Find NPC
  const npc = current_place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
  if (!npc) {
    npcs_being_processed.delete(npc_ref);
    return;
  }
  
  // Use actual tracked position if available, otherwise fall back to place data
  // This prevents snap-back when place data is refreshed from storage
  const start_position = npc_actual_positions.get(npc_ref) || npc.tile_position;
  
  // Pick random destination
  const width = current_place.tile_grid.width;
  const height = current_place.tile_grid.height;
  const intensity = cmd.intensity || 3;
  const range = cmd.range || 6;
  
  // Use intensity to determine how far to wander
  const max_distance = Math.min(range, Math.max(2, intensity));
  
  // Pick random point within range
  let target: TilePosition;
  let attempts = 0;
  do {
    const angle = Math.random() * Math.PI * 2;
    const distance = 1 + Math.random() * max_distance;
    target = {
      x: Math.round(start_position.x + Math.cos(angle) * distance),
      y: Math.round(start_position.y + Math.sin(angle) * distance),
    };
    attempts++;
  } while (
    (target.x < 1 || target.x >= width - 1 || target.y < 1 || target.y >= height - 1) &&
    attempts < 10
  );
  
  // Clamp to valid range
  target.x = Math.max(1, Math.min(width - 2, target.x));
  target.y = Math.max(1, Math.min(height - 2, target.y));
  
  // Check path exists
  const path_result = find_path(current_place, start_position, target, {
    exclude_entity: npc_ref,
  });
  
  if (path_result.blocked || path_result.path.length === 0) {
    console.log(`[MovementCommandHandler] ${npc_ref} wander blocked`);
    npcs_being_processed.delete(npc_ref);
    return;
  }
  
  // Start wandering movement
  // NPC walk speed: 300 tiles per minute (5 tiles per second)
  const tiles_per_minute = 300;
  
  // Update place data immediately so it reflects the correct starting position
  // This prevents snap-back when the place refreshes from storage
  if (npc && start_position !== npc.tile_position) {
    npc.tile_position = { ...start_position };
  }

  const started = start_entity_movement(
    npc_ref,
    "npc",
    current_place,
    {
      type: "wander",
      target_position: target,
      priority: 1,
      reason: cmd.reason || "Wandering around",
    },
    tiles_per_minute,
    (final_position: TilePosition) => {
      // on_complete - receives final position directly from movement engine
      // This is the ACTUAL position the NPC ended up at, regardless of place object refreshes
      npc_actual_positions.set(npc_ref, { ...final_position });
      console.log(`[MovementCommandHandler] ${npc_ref} completed movement at (${final_position.x}, ${final_position.y}), tracker updated`);
      // Save to storage via backend
      save_npc_position_on_complete(npc_ref, final_position, current_place!);
      // Release processing lock
      npcs_being_processed.delete(npc_ref);
    },
    (path) => {
      // on_start - movement started
      console.log(`[MovementCommandHandler] ${npc_ref} started wandering from (${start_position.x}, ${start_position.y}) to (${target.x}, ${target.y})`);
      // Release processing lock once movement has actually started
      npcs_being_processed.delete(npc_ref);
    }
  );
  
  if (started) {
    console.log(`[MovementCommandHandler] ${npc_ref} wandering to (${target.x}, ${target.y})`);
  } else {
    // Movement failed to start - release the lock
    console.log(`[MovementCommandHandler] ${npc_ref} failed to start wandering`);
    npcs_being_processed.delete(npc_ref);
  }
}

/**
 * Send NPC position update to backend when movement completes
 * Backend will save position to NPC storage
 */
async function save_npc_position_on_complete(npc_ref: string, final_position: TilePosition, place: Place): Promise<void> {
  try {
    // Send position update message to backend via inbox
    // We need to write to inbox so backend can save it
    if (window.electronAPI) {
      const dataSlotDir = await window.electronAPI.getDataSlotDir(1);
      const inboxPath = `${dataSlotDir}/inbox.jsonc`;
      
      // Create position update message
      const positionMsg: NPCPositionUpdateMessage = {
        id: `pos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        type: "npc_position_update",
        npc_ref: npc_ref,
        position: {
          x: final_position.x,
          y: final_position.y
        },
        place_id: place.id,
        timestamp: new Date().toISOString(),
        sender: "renderer",
        recipient: "npc_ai"
      };
      
      // Read current inbox
      const result = await window.electronAPI.readFile(inboxPath);
      let inbox = { schema_version: 1, messages: [] as any[] };
      
      if (result.success && result.content) {
        try {
          inbox = JSON.parse(result.content);
        } catch (e) {
          console.log("[MovementCommandHandler] Failed to parse inbox, creating new");
        }
      }
      
      // Add message to inbox
      inbox.messages.unshift({
        id: positionMsg.id,
        sender: "renderer",
        content: JSON.stringify(positionMsg),
        created_at: positionMsg.timestamp,
        type: "npc_position_update",
        status: "sent"
      });
      
      // Write inbox back to file via IPC
      const writeResult = await window.electronAPI.writeFile(inboxPath, JSON.stringify(inbox, null, 2));
      
      if (writeResult.success) {
        console.log(`[MovementCommandHandler] ${npc_ref} position update sent to backend`, {
          x: final_position.x,
          y: final_position.y,
          place_id: place.id
        });
      } else {
        console.error(`[MovementCommandHandler] Failed to write inbox for ${npc_ref}:`, writeResult.error);
      }
    }
  } catch (err) {
    console.error(`[MovementCommandHandler] Failed to send position update for ${npc_ref}:`, err);
  }
}

/**
 * Execute NPC_FACE command - Face a direction or entity
 */
function execute_face_command(npc_ref: string, cmd: any): void {
  if (!current_place) {
    console.log(`[MovementCommandHandler] Cannot face ${npc_ref} - no place set`);
    return;
  }
  
  // Find NPC in place
  const npc = current_place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
  if (!npc) {
    console.log(`[MovementCommandHandler] Cannot face ${npc_ref} - not in current place`);
    return;
  }
  
  const npc_pos = npc.tile_position;
  let target_pos: TilePosition | null = null;
  
  // If target_entity is specified, find that entity's position
  if (cmd.target_entity) {
    // First check if we have a tracked position for this entity
    // (actors update their position in real-time during movement)
    const tracked_pos = npc_actual_positions.get(cmd.target_entity);
    if (tracked_pos) {
      target_pos = tracked_pos;
      console.log(`[MovementCommandHandler] Using tracked position for ${cmd.target_entity}: (${target_pos.x}, ${target_pos.y})`);
    } else {
      // Check if target is an actor in place data
      const target_actor = current_place.contents.actors_present.find(
        (a: any) => a.actor_ref === cmd.target_entity
      );
      if (target_actor) {
        target_pos = target_actor.tile_position;
      }
      
      // Check if target is an NPC in place data
      if (!target_pos) {
        const target_npc = current_place.contents.npcs_present.find(
          (n: any) => n.npc_ref === cmd.target_entity
        );
        if (target_npc) {
          target_pos = target_npc.tile_position;
        }
      }
    }
  }
  
  // If direction is specified directly, use that
  if (!target_pos && cmd.direction) {
    // Set facing directly by direction
    set_facing(npc_ref, cmd.direction);
    console.log(`[MovementCommandHandler] ${npc_ref} facing direction ${cmd.direction}`);
    return;
  }
  
  // If we have a target position, calculate and set facing
  if (target_pos) {
    face_target(npc_ref, cmd.target_entity || "unknown", target_pos, npc_pos);
    console.log(`[MovementCommandHandler] ${npc_ref} facing ${cmd.target_entity} at (${target_pos.x}, ${target_pos.y})`);
  } else {
    console.log(`[MovementCommandHandler] Cannot face ${npc_ref} - target not found: ${cmd.target_entity}`);
  }
}

/**
 * Execute NPC_STATUS command - Update NPC status for visual indicator
 */
function execute_status_command(npc_ref: string, cmd: any): void {
  if (!current_place) {
    console.log(`[MovementCommandHandler] Cannot update status for ${npc_ref} - no place set`);
    return;
  }
  
  // Find NPC in place
  const npc = current_place.contents.npcs_present.find((n: any) => n.npc_ref === npc_ref);
  if (!npc) {
    console.log(`[MovementCommandHandler] Cannot update status for ${npc_ref} - not in current place`);
    return;
  }
  
  // Update the NPC's status
  npc.status = cmd.status;
  console.log(`[MovementCommandHandler] ${npc_ref} status updated to ${cmd.status}`);
}

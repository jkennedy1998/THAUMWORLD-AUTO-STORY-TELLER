/**
 * Witness Integration
 * 
 * Bridges the NPC_AI system with the witness/reaction system.
 * Called when NPCs detect communication or movement to trigger real-time reactions.
 */

import { debug_log } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import type { TilePosition } from "../types/place.js";
import { load_place } from "../place_storage/store.js";
import { load_npc } from "../npc_storage/store.js";

// Import witness system components
import {
    start_conversation,
    end_conversation,
    is_in_conversation,
    get_conversation,
    update_conversation_timeout
} from "./conversation_state.js";

import {
    get_movement_state,
    set_goal,
    clear_goal,
    init_movement_state
} from "./movement_state.js";

import {
    resume_npc_wandering,
    cancel_npc_wandering
} from "./movement_loop.js";

import {
    stop_entity_movement
} from "../shared/movement_engine.js";

import {
    send_stop_command,
    send_face_command
} from "./movement_command_sender.js";

import {
    generate_conversation_goal
} from "./goal_selector.js";

import {
    face_target,
    get_facing
} from "./facing_system.js";

import {
    is_action_detectable
} from "../action_system/sense_broadcast.js";

const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

// Pattern to detect farewells
const FAREWELL_PATTERN = /\b(goodbye|bye|farewell|see you|later|until)\b/i;

/**
 * Process communication from an actor to an NPC
 * Called by NPC_AI when a communication event is detected
 * 
 * @param npc_ref - The NPC receiving the communication (e.g., "npc.grenda")
 * @param actor_ref - The actor sending the communication (e.g., "actor.henry_actor")
 * @param message - The message text
 * @param is_direct_target - Whether the NPC was directly addressed
 * @param distance - Distance between NPC and actor (if known)
 * @param npc_position - Current position of NPC
 * @param actor_position - Current position of actor
 */
export function process_witness_communication(
    npc_ref: string,
    actor_ref: string,
    message: string,
    is_direct_target: boolean,
    distance: number = 0,
    npc_position?: TilePosition,
    actor_position?: TilePosition
): void {
    debug_log("[Witness]", `Processing communication for ${npc_ref} from ${actor_ref}`);
    debug_log("[Witness]", `Message: "${message.substring(0, 50)}..."`, { is_direct_target, distance });
    
    // Check if farewell
    if (FAREWELL_PATTERN.test(message.toLowerCase())) {
        handle_farewell(npc_ref, actor_ref);
        return;
    }
    
    // Check if should respond
    const should_respond = is_direct_target || distance <= 2;
    
    if (!should_respond) {
        debug_log("[Witness]", `${npc_ref} not responding - not addressed and not close enough`);
        // Still face the speaker if nearby
        if (distance <= 5 && npc_position && actor_position) {
            face_target(npc_ref, actor_ref, actor_position, npc_position);
        }
        return;
    }
    
    debug_log("[Witness]", `${npc_ref} SHOULD respond to ${actor_ref}`);
    
    // Handle based on conversation state
    if (is_in_conversation(npc_ref)) {
        handle_existing_conversation(npc_ref, actor_ref, message, npc_position, actor_position);
    } else {
        // Start new conversation
        start_conversation_with_actor(npc_ref, actor_ref, npc_position, actor_position);
    }
}

/**
 * Process movement detection
 * Called per-step when an entity moves
 * 
 * @param observer_ref - The NPC observing the movement
 * @param mover_ref - The entity that moved
 * @param mover_position - Current position of mover
 * @param step_number - Which step in the movement path (0-indexed)
 * @param total_steps - Total number of steps in movement
 */
export function process_witness_movement(
    observer_ref: string,
    mover_ref: string,
    mover_position: TilePosition,
    step_number: number = 0,
    total_steps: number = 1
): void {
    // Only react periodically to avoid spam
    // React every 3 steps or on the first/last step
    const should_react = step_number === 0 || 
                        step_number === total_steps - 1 || 
                        step_number % 3 === 0;
    
    if (!should_react) return;
    
    debug_log("[Witness]", `${observer_ref} detected movement from ${mover_ref} at step ${step_number}/${total_steps}`);
    
    // TODO: Calculate distance and check if observer can hear/see
    // For now, just log
    
    // If in conversation with this mover, face them
    const conv = get_conversation(observer_ref);
    if (conv && conv.target_entity === mover_ref) {
        // Update facing to track them
        debug_log("[Witness]", `${observer_ref} tracking ${mover_ref} during conversation`);
    }
}

/**
 * Handle farewell message
 */
function handle_farewell(npc_ref: string, actor_ref: string): void {
    debug_log("[Witness]", `Farewell detected from ${actor_ref} to ${npc_ref}`);
    
    const conv = get_conversation(npc_ref);
    if (conv && conv.target_entity === actor_ref) {
        debug_log("[Witness]", `Ending conversation for ${npc_ref}`);
        end_conversation(npc_ref);
        restore_previous_goal(npc_ref);
    }
}

/**
 * Handle existing conversation
 */
function handle_existing_conversation(
    npc_ref: string,
    actor_ref: string,
    message: string,
    npc_position?: TilePosition,
    actor_position?: TilePosition
): void {
    const conv = get_conversation(npc_ref);
    
    if (!conv) return;
    
    // If talking to same person, extend conversation
    if (conv.target_entity === actor_ref) {
        debug_log("[Witness]", `Extending conversation for ${npc_ref}`);
        update_conversation_timeout(npc_ref);
        if (npc_position && actor_position) {
            face_target(npc_ref, actor_ref, actor_position, npc_position);
        }
    }
    // If addressed by someone else, maybe switch
    // TODO: Add logic for conversation switching
}

/**
 * Start conversation with an actor
 */
function start_conversation_with_actor(
    npc_ref: string,
    actor_ref: string,
    npc_position?: TilePosition,
    actor_position?: TilePosition
): void {
    debug_log("[Witness]", `Starting conversation for ${npc_ref} with ${actor_ref}`);
    
    // Get or initialize movement state
    let state = get_movement_state(npc_ref);
    
    if (!state) {
        debug_log("[Witness]", `No movement state for ${npc_ref}, attempting to initialize from place data`);
        
        // Try to get position from place storage
        const npc_id = npc_ref.replace("npc.", "");
        const npc_result = load_npc(data_slot, npc_id);
        
        if (npc_result.ok) {
            const npc = npc_result.npc;
            const npc_location = (npc as any).location;
            
            if (npc_location?.tile) {
                const position: TilePosition = {
                    x: npc_location.tile.x,
                    y: npc_location.tile.y
                };
                
                // Initialize movement state with position from storage
                state = init_movement_state(npc_ref, position);
                debug_log("[Witness]", `Initialized movement state for ${npc_ref} from storage`, position);
            } else {
                debug_log("[Witness]", `No tile position found for ${npc_ref}`);
                return;
            }
        } else {
            debug_log("[Witness]", `Failed to load NPC ${npc_ref}`);
            return;
        }
    }
    
    // Save current goal
    const previous_goal = state.current_goal;
    const previous_path_state = state.path.length > 0 ? {
        path: state.path,
        path_index: state.path_index
    } : null;
    
    // Cancel any pending wandering and stop current movement
    cancel_npc_wandering(npc_ref);
    stop_entity_movement(npc_ref);

    // Send movement commands to renderer (Phase 8: Unified Movement Authority)
    send_stop_command(npc_ref, "Entering conversation");
    send_face_command(npc_ref, actor_ref, "Face speaker during conversation");

    // Start conversation tracking
    start_conversation(
        npc_ref,
        actor_ref,
        [npc_ref, actor_ref],
        previous_goal,
        previous_path_state
    );

    // Set conversation goal
    const target_pos = actor_position ?? { x: 0, y: 0 };
    const converse_goal = generate_conversation_goal(npc_ref, actor_ref, target_pos);
    set_goal(npc_ref, converse_goal);
    
    // Face the actor
    if (npc_position && actor_position) {
        face_target(npc_ref, actor_ref, actor_position, npc_position);
    }
    
    debug_log("[Witness]", `${npc_ref} entered conversation with ${actor_ref}, goal set to: ${converse_goal.type}`);
}

/**
 * Restore previous goal after conversation ends
 */
function restore_previous_goal(npc_ref: string): void {
    const conv = get_conversation(npc_ref);
    if (!conv) return;

    if (conv.previous_goal) {
        if (conv.previous_path_state) {
            set_goal(npc_ref, conv.previous_goal, conv.previous_path_state.path);
        } else {
            set_goal(npc_ref, conv.previous_goal);
        }
        debug_log("[Witness]", `${npc_ref} restored previous goal: ${conv.previous_goal.type}`);
    } else {
        clear_goal(npc_ref, "Conversation ended");
        debug_log("[Witness]", `${npc_ref} cleared goal after conversation`);
        // Resume wandering since there was no previous goal
        resume_npc_wandering(npc_ref);
    }
}

/**
 * Check if movement should be detectable based on step count
 * Walking is quieter than running, fewer steps = less sound
 */
export function calculate_movement_detectability(
    total_steps: number,
    speed: number = 300 // tiles per minute
): { intensity: number; range: number; description: string } {
    // Fewer steps = slower movement = quieter
    // Speed: 300 TPM is normal walk, 600 is run
    
    if (speed >= 500) {
        // Running - loud
        return { intensity: 6, range: 8, description: "running (loud)" };
    } else if (total_steps <= 2) {
        // Very short movement - subtle
        return { intensity: 2, range: 3, description: "subtle movement (quiet)" };
    } else if (total_steps <= 5) {
        // Short movement
        return { intensity: 3, range: 5, description: "walking (normal)" };
    } else {
        // Longer movement - more noticeable
        return { intensity: 4, range: 6, description: "extended movement" };
    }
}

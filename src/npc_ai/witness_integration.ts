/**
 * Witness Integration (LEGACY)
 *
 * This module remains only as a compatibility surface while the project converges on the
 * canonical witness pipeline.
 *
 * Canonical ownership:
 * - Conversation start/end + reactions: `src/npc_ai/witness_handler.ts`
 * - Renderer-safe movement perception helpers: `src/npc_ai/movement_perception.ts`
 */

import { debug_log } from "../shared/debug.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import type { TilePosition } from "../types/place.js";
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
} from "./facing_system.js";

// NOTE: movement detection exports are re-exported from movement_perception.

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

export { process_witness_movement, calculate_movement_detectability } from "./movement_perception.js";

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
// NOTE: legacy movement detectability function is re-exported above.

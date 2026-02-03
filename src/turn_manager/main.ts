import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_world_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, append_outbox_message } from "../engine/outbox_store.js";
import { create_message } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { debug_log, log_service_error } from "../shared/debug.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import {
    ensure_world_exists,
    get_timed_event_state,
    save_world_store,
    start_timed_event,
    end_timed_event,
    advance_turn,
    mark_actor_done,
    check_all_done,
    mark_actor_left_region,
    is_actor_in_region,
    get_active_actor_ref
} from "../world_storage/store.js";
import type { WorldStore } from "../world_storage/store.js";
import type { MessageEnvelope } from "../engine/types.js";
import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { SERVICE_CONFIG } from "../shared/constants.js";
import { build_working_memory, add_event_to_memory, get_working_memory, cleanup_expired_memories } from "../context_manager/index.js";
import type { TimedEventType } from "../shared/constants.js";
import { initialize_turn_state, roll_initiative as roll_initiative_state_machine, transition_phase, get_turn_state, is_turn_timer_expired, get_turn_summary, type TurnState } from "./state_machine.js";
import { validate_action, can_perform_action, type ActorState } from "./validator.js";
import { hold_action, check_triggers, process_reaction, clear_event_reactions, create_trigger, type ReactionRequest } from "./reactions.js";
import { append_timed_event_memory_journal } from "../npc_ai/timed_event_journal.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.TURN_MANAGER;

// Track which events we've already processed to avoid duplicates
const processedEventIds = new Set<string>();
const processedMessages = new Set<string>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read actor/NPC DEX score for initiative
function get_actor_dex(slot: number, actor_ref: string): number {
    if (actor_ref.startsWith("actor.")) {
        const actor_id = actor_ref.replace("actor.", "");
        const result = load_actor(slot, actor_id);
        if (result.ok) {
            return Number((result.actor as any)?.stats?.dex ?? 50);
        }
    } else if (actor_ref.startsWith("npc.")) {
        const npc_id = actor_ref.replace("npc.", "");
        const result = load_npc(slot, npc_id);
        if (result.ok) {
            return Number((result.npc as any)?.stats?.dex ?? 50);
        }
    }
    return 50; // Default DEX
}

// Get actor location
function get_actor_location(slot: number, actor_ref: string): { world_x: number; world_y: number; region_x: number; region_y: number } | null {
    let location: Record<string, unknown> | null = null;
    
    if (actor_ref.startsWith("actor.")) {
        const actor_id = actor_ref.replace("actor.", "");
        const result = load_actor(slot, actor_id);
        if (result.ok) {
            location = result.actor.location as Record<string, unknown>;
        }
    } else if (actor_ref.startsWith("npc.")) {
        const npc_id = actor_ref.replace("npc.", "");
        const result = load_npc(slot, npc_id);
        if (result.ok) {
            location = result.npc.location as Record<string, unknown>;
        }
    }
    
    if (!location) return null;
    
    const world = (location.world_tile as Record<string, unknown>) ?? {};
    const region = (location.region_tile as Record<string, unknown>) ?? {};
    
    return {
        world_x: Number(world.x ?? 0),
        world_y: Number(world.y ?? 0),
        region_x: Number(region.x ?? 0),
        region_y: Number(region.y ?? 0)
    };
}

// Roll 1d20
function roll_d20(): number {
    return Math.floor(Math.random() * 20) + 1;
}

// Calculate DEX bonus from score (50 = 0, 60 = +1, 40 = -1, etc.)
function get_dex_bonus(dex: number): number {
    return Math.floor((dex - 50) / 10);
}

// Roll initiative for all participants
async function roll_initiative(slot: number, store: WorldStore): Promise<void> {
    if (!store.initiative_order) return;
    
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    // Roll initiative for each participant
    for (const entry of store.initiative_order) {
        const dex = get_actor_dex(slot, entry.actor_ref);
        const dex_bonus = get_dex_bonus(dex);
        const roll = roll_d20();
        entry.initiative_roll = roll + dex_bonus;
        entry.dex_score = dex;
        
        debug_log("TurnManager: initiative roll", {
            actor: entry.actor_ref,
            roll,
            dex_bonus,
            total: entry.initiative_roll
        });
        
        // Log the roll
        const actor_name = entry.actor_ref.split(".")[1] ?? entry.actor_ref;
        append_log_message(log_path, "system", `${actor_name} rolls initiative: ${roll} + ${dex_bonus} DEX = ${entry.initiative_roll}`);
    }
    
    // Sort by initiative (highest first), random tie-break for same DEX
    store.initiative_order.sort((a, b) => {
        if (b.initiative_roll !== a.initiative_roll) {
            return b.initiative_roll - a.initiative_roll;
        }
        // Same initiative roll - higher DEX wins
        if (b.dex_score !== a.dex_score) {
            return b.dex_score - a.dex_score;
        }
        // Same DEX - random tie-break
        return Math.random() - 0.5;
    });
    
    // Create initiative announcement message
    const order_text = store.initiative_order
        .map((e, i) => `${i + 1}. ${e.actor_ref.split(".")[1]} (${e.initiative_roll})`)
        .join("\n");
    
    const initiative_msg: MessageInput = {
        sender: "turn_manager",
        content: `Initiative order:\n${order_text}`,
        stage: "initiative_announcement",
        status: "sent",
        meta: {
            initiative_order: store.initiative_order.map(e => ({
                actor: e.actor_ref,
                roll: e.initiative_roll
            })),
            event_type: store.timed_event_type
        }
    };
    
    append_inbox_message(inbox_path, create_message(initiative_msg));
    append_log_message(log_path, "system", `Timed event started: ${store.timed_event_type}. ${store.initiative_order.length} participants.`);
    
    // Save the updated store
    save_world_store(slot, store);
}

// Check if actors have left the region
async function check_region_exits(slot: number, store: WorldStore): Promise<void> {
    if (!store.initiative_order || !store.event_region) return;
    
    const log_path = get_log_path(slot);
    
    for (const entry of store.initiative_order) {
        if (entry.status === "left_region") continue;
        
        const location = get_actor_location(slot, entry.actor_ref);
        if (!location) continue;
        
        const in_region = is_actor_in_region(slot, entry.actor_ref, location);
        if (!in_region) {
            mark_actor_left_region(slot, entry.actor_ref);
            const actor_name = entry.actor_ref.split(".")[1] ?? entry.actor_ref;
            append_log_message(log_path, "system", `${actor_name} has left the region and is no longer participating in the timed event.`);
            debug_log("TurnManager: actor left region", { actor: entry.actor_ref });
        }
    }
}

// Process NPC turn
async function process_npc_turn(slot: number, actor_ref: string, store: WorldStore): Promise<void> {
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    debug_log("TurnManager: processing NPC turn", { actor: actor_ref });
    
    // For now, NPCs in timed events will just communicate once and pass
    // This is a simplified version - in the future, NPC AI could make tactical decisions
    
    const npc_id = actor_ref.replace("npc.", "");
    const npc_result = load_npc(slot, npc_id);
    
    if (!npc_result.ok) {
        // NPC not found, mark as done
        mark_actor_done(slot, actor_ref);
        return;
    }
    
    const npc = npc_result.npc;
    const npc_name = (npc.name as string) ?? npc_id;
    
    // Check if there are active player actors to interact with
    const player_actors = store.initiative_order?.filter(e => 
        e.actor_ref.startsWith("actor.") && e.status === "active"
    ) ?? [];
    
    if (player_actors.length === 0) {
        // No players to interact with, just pass
        mark_actor_done(slot, actor_ref);
        return;
    }
    
    // Simple behavior based on event type
    let action_text = "";
    
    if (store.timed_event_type === "combat") {
        // In combat, NPCs might attack or defend
        const actions = ["prepares to attack", "takes a defensive stance", "assesses the situation", "waits for an opening"];
        action_text = actions[Math.floor(Math.random() * actions.length)] ?? "";
    } else if (store.timed_event_type === "conversation") {
        // In conversation, NPCs respond
        action_text = "listens attentively";
    } else {
        // Exploration or other
        action_text = "observes the surroundings";
    }
    
    // Create NPC action message
    const npc_action: MessageInput = {
        sender: actor_ref,
        content: `${npc_name} ${action_text}.`,
        stage: "npc_timed_action",
        status: "sent",
        meta: {
            npc_id: npc_id,
            npc_name: npc_name,
            action_type: store.timed_event_type,
            turn_number: store.current_turn
        }
    };
    
    append_inbox_message(inbox_path, create_message(npc_action));
    append_log_message(log_path, "system", `${npc_name}'s turn: ${action_text}`);
    
    // Mark NPC as done
    mark_actor_done(slot, actor_ref);
    
    debug_log("TurnManager: NPC turn complete", { actor: actor_ref, action: action_text });
}

// Process turn advancement
async function process_turn_advancement(slot: number, store: WorldStore): Promise<void> {
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    // Check if current actor is done
    const active_index = store.active_actor_index ?? 0;
    const current_entry = store.initiative_order?.[active_index];
    
    if (!current_entry) return;
    
    // If current actor is done, advance to next
    if (current_entry.status === "done" || current_entry.status === "left_region") {
        debug_log("TurnManager: advancing turn", { 
            from_actor: current_entry.actor_ref,
            turn: store.current_turn 
        });
        
        const result = advance_turn(slot);
        
        if (result.ok) {
            // Create turn announcement
            const turn_announcement: MessageInput = {
                sender: "turn_manager",
                content: `Turn ${result.new_turn}: ${result.active_actor.split(".")[1]}'s turn`,
                stage: "turn_announcement",
                status: "sent",
                meta: {
                    turn_number: result.new_turn,
                    active_actor: result.active_actor,
                    event_type: store.timed_event_type
                }
            };
            
            append_inbox_message(inbox_path, create_message(turn_announcement));
            append_log_message(log_path, "system", `Turn ${result.new_turn}: ${result.active_actor.split(".")[1]}'s turn`);
            
            // If it's an NPC's turn, process it automatically
            if (result.active_actor.startsWith("npc.")) {
                await sleep(1000); // Small delay for readability
                await process_npc_turn(slot, result.active_actor, store);
            }
        }
    }
}

// Check if event should end
async function check_event_end(slot: number, store: WorldStore): Promise<void> {
    if (!store.timed_event_active) return;
    
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    // Check if all participants are done or have left
    const all_done = check_all_done(slot);
    
    if (all_done) {
        debug_log("TurnManager: ending timed event", { 
            event_id: store.timed_event_id,
            turns: store.current_turn 
        });
        
        // Create end announcement
        const end_announcement: MessageInput = {
            sender: "turn_manager",
            content: `The ${store.timed_event_type} has concluded after ${store.current_turn} turns.`,
            stage: "timed_event_end",
            status: "sent",
            meta: {
                event_type: store.timed_event_type,
                total_turns: store.current_turn,
                event_id: store.timed_event_id
            }
        };
        
        append_inbox_message(inbox_path, create_message(end_announcement));
        append_log_message(log_path, "system", `Timed event ended: ${store.timed_event_type} (${store.current_turn} turns)`);

        // NPC memory journal: summarize what each NPC would remember from this timed event
        try {
            const event_id = store.timed_event_id;
            const event_type = store.timed_event_type;
            const region = store.event_region ?? null;
            const participants = Array.isArray(store.initiative_order)
                ? store.initiative_order.map((e: any) => String(e?.actor_ref ?? "")).filter((s) => s.length > 0)
                : [];
            if (event_id && event_type && participants.length > 0) {
                for (const ref of participants) {
                    if (!ref.startsWith("npc.")) continue;
                    void append_timed_event_memory_journal(slot, ref, {
                        event_id,
                        event_type,
                        participants,
                        region,
                    });
                }
            }
        } catch (err) {
            log_service_error("turn_manager", "npc_memory_journal_end", { event_id: store.timed_event_id }, err);
        }
        
        // End the event
        end_timed_event(slot);
    }
}

// Process messages that trigger timed events
async function process_trigger_messages(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        // Look for ruling messages that might trigger timed events
        const candidates = outbox.messages.filter((m: MessageEnvelope) => {
            return m.stage?.startsWith("ruling_") && 
                   m.status === "done" && 
                   !processedMessages.has(m.id);
        });
        
        for (const msg of candidates) {
            processedMessages.add(msg.id);
            
            const events = (msg.meta as Record<string, unknown>)?.events as string[] ?? [];
            const machine_text = (msg.meta as Record<string, unknown>)?.machine_text as string ?? "";
            
            // Check if this is an ATTACK or COMMUNICATE action
            const is_attack = events.some(e => e.includes(".ATTACK(")) || machine_text.includes(".ATTACK(");
            const is_communicate = events.some(e => e.includes(".COMMUNICATE(")) || machine_text.includes(".COMMUNICATE(");
            
            if (!is_attack && !is_communicate) continue;
            
            // Check if timed event is already active
            const store = get_timed_event_state(data_slot_number);
            if (store?.timed_event_active) {
                // Event already active, just continue
                continue;
            }
            
            // Extract participants from the message
            const participants: string[] = [];
            
            // Add the actor who initiated
            const sender = msg.sender ?? "";
            if (sender.startsWith("actor.") || sender.startsWith("npc.")) {
                participants.push(sender);
            }
            
            // Extract targets from events
            for (const event of events) {
                // Parse target from event strings like "actor.henry_actor.ATTACK(target=npc.goblin, ...)"
                const target_match = event.match(/target=(actor\.[^,)]+|npc\.[^,)]+)/);
                if (target_match) {
                    const target = target_match[1] ?? "";
                    if (!target) continue;
                    if (!participants.includes(target)) {
                        participants.push(target);
                    }
                }
            }
            
            if (participants.length < 2) {
                // Need at least 2 participants for a timed event
                continue;
            }
            
            // Get region from first participant
            const first_participant = participants[0] ?? "";
            if (!first_participant) continue;
            const location = get_actor_location(data_slot_number, first_participant);
            
            if (!location) {
                debug_log("TurnManager: cannot start timed event, no location", { participant: first_participant });
                continue;
            }
            
            // Determine event type
            const event_type = is_attack ? "combat" : "conversation";
            
            debug_log("TurnManager: starting timed event", {
                type: event_type,
                participants,
                trigger: is_attack ? "attack" : "communicate"
            });
            
            // Start the timed event
            const result = start_timed_event(
                data_slot_number,
                event_type,
                participants,
                location
            );
            
            if (result.ok) {
                // Get the updated store and roll initiative
                const new_store = get_timed_event_state(data_slot_number);
                if (new_store) {
                    await roll_initiative(data_slot_number, new_store);
                }
                
                // ===== PHASE 5: INITIALIZE TURN STATE MACHINE =====
                try {
                    // Initialize turn state
                    const turn_state = initialize_turn_state(
                        result.event_id,
                        event_type as TimedEventType,
                        participants,
                        { turn_duration_limit_ms: 60000 } // 60 second turn limit
                    );
                    
                    // Roll initiative
                    const initiative_scores = new Map<string, number>();
                    for (const participant of participants) {
                        const dex = get_actor_dex(data_slot_number, participant);
                        const roll = roll_d20();
                        const bonus = get_dex_bonus(dex);
                        initiative_scores.set(participant, roll + bonus + 50); // Base 50 + roll + bonus
                    }
                    
                    roll_initiative_state_machine(turn_state, initiative_scores);
                    
                    debug_log("TurnManager: turn state initialized", { 
                        event_id: result.event_id, 
                        participants: participants.length,
                        first_actor: turn_state.current_actor_ref,
                        phase: turn_state.phase
                    });
                    
                    // Create turn announcement with initiative order
                    const turn_announcement: MessageInput = {
                        sender: "turn_manager",
                        content: `Turn order: ${turn_state.initiative_order.map(ref => {
                            const parts = ref.split(".");
                            return parts[1] || ref;
                        }).join(", ")}`,
                        stage: "turn_order",
                        status: "sent",
                        meta: {
                            event_id: result.event_id,
                            initiative_order: turn_state.initiative_order,
                            first_actor: turn_state.current_actor_ref
                        }
                    };
                    append_inbox_message(inbox_path, create_message(turn_announcement));
                    
                } catch (err) {
                    debug_log("TurnManager: failed to initialize turn state", { error: err instanceof Error ? err.message : String(err) });
                }
                
                // Build working memory for this timed event
                try {
                    const region_id = `region.${location.world_x}_${location.world_y}_${location.region_x}_${location.region_y}`;
                    await build_working_memory(
                        data_slot_number,
                        result.event_id,
                        event_type as TimedEventType,
                        region_id,
                        participants
                    );
                    debug_log("TurnManager: working memory built", { event_id: result.event_id, participants: participants.length });
                } catch (err) {
                    debug_log("TurnManager: failed to build working memory", { error: err instanceof Error ? err.message : String(err) });
                }
                
                // Create start announcement
                const start_announcement: MessageInput = {
                    sender: "turn_manager",
                    content: `${event_type === "combat" ? "Combat" : "Conversation"} begins! ${participants.length} participants.`,
                    stage: "timed_event_start",
                    status: "sent",
                    meta: {
                        event_type,
                        participants,
                        event_id: result.event_id,
                        region: location
                    }
                };
                
                append_inbox_message(inbox_path, create_message(start_announcement));
                append_log_message(log_path, "system", `Timed event started: ${event_type} with ${participants.length} participants`);
            }
        }
    } catch (err) {
        log_service_error("turn_manager", "process_trigger_messages", {}, err);
    }
}

// Main polling loop
let lastMemoryCleanup = 0;

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        // Periodic memory cleanup (every 60 seconds)
        const now = Date.now();
        if (now - lastMemoryCleanup > 60000) {
            const cleaned = cleanup_expired_memories(data_slot_number);
            if (cleaned > 0) {
                debug_log("TurnManager: cleaned up expired memories", { removed: cleaned });
            }
            lastMemoryCleanup = now;
        }
        
        // Process any new trigger messages
        await process_trigger_messages(outbox_path, inbox_path, log_path);
        
        // Get current timed event state
        const store = get_timed_event_state(data_slot_number);
        
        if (!store?.timed_event_active) {
            return; // No active timed event
        }
        
        // Check for region exits
        await check_region_exits(data_slot_number, store);
        
        // ===== PHASE 5: PROCESS TURN STATE MACHINE =====
        if (store.event_id) {
            const turn_state = get_turn_state(store.event_id);
            if (turn_state) {
                await process_turn_phases(data_slot_number, store.event_id, turn_state, inbox_path, log_path);
            }
        }
        
        // Legacy turn advancement (kept for compatibility)
        await process_turn_advancement(data_slot_number, store);
        
        // Refresh store state after potential changes
        const updated_store = get_timed_event_state(data_slot_number);
        if (updated_store?.timed_event_active) {
            // Check if event should end
            await check_event_end(data_slot_number, updated_store);
        }
        
    } catch (err) {
        log_service_error("turn_manager", "tick", {}, err);
    }
}

// ===== PHASE 5: TURN STATE MACHINE PROCESSING =====

async function process_turn_phases(
    slot: number,
    event_id: string,
    turn_state: TurnState,
    inbox_path: string,
    log_path: string
): Promise<void> {
    try {
        // Check turn timer
        if (is_turn_timer_expired(turn_state)) {
            debug_log("TurnManager", `Turn timer expired for ${turn_state.current_actor_ref}`, {
                event_id,
                turn: turn_state.current_turn
            });
            
            // Auto-skip turn
            transition_phase(turn_state, "TURN_END");
            
            const skip_announcement: MessageInput = {
                sender: "turn_manager",
                content: `${turn_state.current_actor_ref}'s turn timed out and was skipped.`,
                stage: "turn_skip",
                status: "sent",
                meta: {
                    event_id,
                    skipped_actor: turn_state.current_actor_ref,
                    turn: turn_state.current_turn
                }
            };
            append_inbox_message(inbox_path, create_message(skip_announcement));
        }
        
        // Process based on current phase
        switch (turn_state.phase) {
            case "TURN_START":
                // Announce turn start
                const turn_announcement: MessageInput = {
                    sender: "turn_manager",
                    content: `Turn ${turn_state.current_turn}: ${turn_state.current_actor_ref}`,
                    stage: "turn_start",
                    status: "sent",
                    meta: {
                        event_id,
                        turn: turn_state.current_turn,
                        actor: turn_state.current_actor_ref,
                        round: turn_state.round_number,
                        time_remaining: turn_state.turn_time_remaining_ms
                    }
                };
                append_inbox_message(inbox_path, create_message(turn_announcement));
                
                // Transition to action selection
                transition_phase(turn_state, "ACTION_SELECTION");
                break;
                
            case "ACTION_SELECTION":
                // Wait for action input (player) or NPC decision
                // This is handled by other services (interpreter, npc_ai)
                // Turn manager just waits in this phase
                break;
                
            case "ACTION_RESOLUTION":
                // Action is being resolved
                // This is handled by state_applier
                // After resolution, transition to turn end
                // (State applier should signal completion)
                break;
                
            case "TURN_END":
                // Process any held action triggers
                const held_reactions = check_triggers(
                    event_id,
                    `turn_end_${turn_state.current_turn}`,
                    turn_state.current_turn,
                    { actor_ref: turn_state.current_actor_ref ?? undefined }
                );
                
                if (held_reactions.length > 0) {
                    // Process reactions
                    for (const reaction of held_reactions) {
                        const result = process_reaction(reaction, (actor, action, target) => {
                            // Simple validation - in full implementation would check properly
                            return true;
                        });
                        
                        debug_log("TurnManager", `Processed reaction: ${result.message}`, {
                            event_id,
                            reactor: reaction.reactor_ref,
                            success: result.success
                        });
                    }
                }
                
                // Transition to event end check (which may start next turn)
                transition_phase(turn_state, "EVENT_END_CHECK");
                break;
                
            case "EVENT_END_CHECK":
                // Check end conditions
                const should_end = await check_event_end_conditions(slot, event_id, turn_state);
                if (should_end) {
                    transition_phase(turn_state, "EVENT_END");
                    
                    // Clear reactions
                    clear_event_reactions(event_id);
                    
                    // End the timed event
                    // NPC memory journal: summarize what each NPC would remember from this timed event
                    try {
                        const store = get_timed_event_state(slot);
                        const region = store?.event_region ?? null;
                        const participants = Array.isArray(turn_state.initiative_order) ? turn_state.initiative_order : [];
                        for (const ref of participants) {
                            if (!ref.startsWith("npc.")) continue;
                            void append_timed_event_memory_journal(slot, ref, {
                                event_id,
                                event_type: turn_state.event_type,
                                participants,
                                region,
                            });
                        }
                    } catch (err) {
                        log_service_error("turn_manager", "npc_memory_journal_end", { event_id }, err);
                    }

                    end_timed_event(slot);
                    
                    const end_announcement: MessageInput = {
                        sender: "turn_manager",
                        content: `${turn_state.event_type} has ended.`,
                        stage: "timed_event_end",
                        status: "sent",
                        meta: {
                            event_id,
                            event_type: turn_state.event_type,
                            rounds: turn_state.round_number,
                            final_turn: turn_state.current_turn
                        }
                    };
                    append_inbox_message(inbox_path, create_message(end_announcement));
                    append_log_message(log_path, "system", `Timed event ended: ${event_id}`);
                }
                break;
        }
        
        // Log turn summary periodically
        if (turn_state.current_turn % 5 === 0) {
            const summary = get_turn_summary(turn_state);
            debug_log("TurnManager", "Turn summary", summary);
        }
        
    } catch (err) {
        log_service_error("turn_manager", "process_turn_phases", { event_id }, err);
    }
}

async function check_event_end_conditions(
    slot: number,
    event_id: string,
    turn_state: TurnState
): Promise<boolean> {
    // Check different end conditions based on event type
    switch (turn_state.event_type) {
        case "combat":
            // End if all enemies defeated or all allies defeated
            // This would check working memory or world state
            // For now, end after 20 turns max
            return turn_state.round_number >= 20;
            
        case "conversation":
            // End if conversation naturally concludes
            // Or after 10 turns
            return turn_state.round_number >= 10;
            
        case "exploration":
            // End if time limit reached or objective found
            // Or after 15 turns
            return turn_state.round_number >= 15;
            
        default:
            return false;
    }
}

// Initialize function
function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const world_path = get_world_path(data_slot_number);
    
    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    
    // Ensure world exists
    ensure_world_exists(data_slot_number);
    
    return { outbox_path, inbox_path, log_path };
}

// Boot the service
const { outbox_path, inbox_path, log_path } = initialize();
debug_log("TurnManager: booted", { 
    outbox_path, 
    inbox_path, 
    poll_ms: POLL_MS 
});

// Start polling
setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

// Also run immediately on startup
debug_log("TurnManager: running initial tick");
void tick(outbox_path, inbox_path, log_path);

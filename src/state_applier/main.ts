import { get_data_slot_dir, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message, append_outbox_message_deduped, update_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_error, debug_pipeline, DEBUG_LEVEL } from "../shared/debug.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { ACTION_VERBS, SERVICE_CONFIG } from "../shared/constants.js";
import { parse_machine_text } from "../system_syntax/index.js";
import { resolve_references } from "../reference_resolver/resolver.js";
import { apply_effects } from "./apply.js";
import { find_npcs, load_npc, save_npc } from "../npc_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import { add_event_to_memory, get_working_memory, build_working_memory } from "../context_manager/index.js";
import { get_timed_event_state } from "../world_storage/store.js";
import { parse } from "jsonc-parser";
import * as fs from "node:fs";
import * as path from "node:path";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.STATE_APPLIER;

// Track last logged state to prevent spam
let lastLoggedState: {
    messageCount: number;
    stageBreakdown: string;
    statusBreakdown: string;
    timestamp: number;
} | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the action verb from events array
 * Returns the verb (e.g., "INSPECT", "ATTACK") or null if not found
 */
function extractActionVerb(events: string[] | undefined): string | null {
    if (!events || events.length === 0) return null;
    
    for (const event of events) {
        for (const verb of ACTION_VERBS) {
            // Match pattern: actor.<id>.VERB( or npc.<id>.VERB(
            if (event.includes(`.${verb}(`)) {
                return verb;
            }
        }
    }
    return null;
}

/**
 * Extract target from event string
 * Parses patterns like: target=region_tile.0.0.0.0 or target=npc.goblin
 */
function extractTarget(event: string): string | null {
    const targetMatch = event.match(/target=([^,)]+)/);
    return targetMatch && targetMatch[1] ? targetMatch[1] : null;
}

/**
 * Extract tool from event string
 * Parses patterns like: tool=actor.henry_actor.hands
 */
function extractTool(event: string): string | null {
    const toolMatch = event.match(/tool=([^,)]+)/);
    return toolMatch && toolMatch[1] ? toolMatch[1] : null;
}

// Note: Atomic update functions are now provided by outbox_store.ts
// StateApplier uses the centralized update_outbox_message from outbox_store.ts

// Apply AWARENESS tags to NPCs when player communicates
// Per THAUMWORLD rules: NPCs gain awareness when player makes sensible actions (communicating)
function apply_awareness_tags(events: string[] | undefined): number {
    if (!events || events.length === 0) return 0;
    
    let appliedCount = 0;
    
    for (const event of events) {
        if (!event.includes("COMMUNICATE")) continue;
        
        // Extract actor ID from event (e.g., "actor.henry_actor.COMMUNICATE")
        const actorMatch = event.match(/actor\.(\w+)\.COMMUNICATE/);
        if (!actorMatch || !actorMatch[1]) continue;
        
        const actorId = actorMatch[1];
        
        // Load actor to get their location
        const actorResult = load_actor(data_slot_number, actorId);
        if (!actorResult.ok) continue;
        
        const actor = actorResult.actor;
        const actorLocation = actor.location as { 
            region_tile?: { x: number; y: number }; 
            tile?: { x: number; y: number };
        };
        
        if (!actorLocation?.region_tile) continue;
        
        // Find all NPCs in the same region
        const nearbyNpcs = find_npcs(data_slot_number, {}).filter(npcHit => {
            if (npcHit.id === "default_npc") return false;
            
            const npcResult = load_npc(data_slot_number, npcHit.id);
            if (!npcResult.ok) return false;
            
            const npc = npcResult.npc as { 
                location?: { region_tile?: { x: number; y: number } } 
            };
            const npcRegion = npc.location?.region_tile;
            
            if (!npcRegion) return false;
            
            // Check if in same region
            return (
                npcRegion.x === actorLocation.region_tile!.x &&
                npcRegion.y === actorLocation.region_tile!.y
            );
        });
        
        // Apply AWARENESS tag to each nearby NPC
        for (const npcHit of nearbyNpcs) {
            const npcResult = load_npc(data_slot_number, npcHit.id);
            if (!npcResult.ok) continue;
            
            const npc = npcResult.npc as Record<string, unknown>;
            const tags = (npc.tags || []) as Array<Record<string, unknown>>;
            
            // Check if already has awareness of this actor
            const actorRef = `actor.${actorId}`;
            const hasAwareness = tags.some(tag => 
                tag.name === "AWARENESS" &&
                Array.isArray(tag.info) &&
                tag.info.includes(actorRef)
            );
            
            if (!hasAwareness) {
                // Add AWARENESS tag
                const newTag = {
                    name: "AWARENESS",
                    info: [actorRef],
                    created_at: new Date().toISOString()
                };
                
                tags.push(newTag);
                npc.tags = tags;
                
                // Save updated NPC
                save_npc(data_slot_number, npcHit.id, npc);
                appliedCount++;
                
                if (DEBUG_LEVEL >= 3) {
                    debug_pipeline("StateApplier", `Applied AWARENESS tag to ${npcHit.id}`, {
                        npc: npcHit.id,
                        target: actorRef
                    });
                }
            }
        }
        
        // Also apply bidirectional awareness: player gains awareness of NPCs
        // This is done by adding tags to the actor as well
        const actorTags = (actor.tags || []) as Array<Record<string, unknown>>;
        for (const npcHit of nearbyNpcs) {
            const npcRef = `npc.${npcHit.id}`;
            const hasNpcAwareness = actorTags.some(tag =>
                tag.name === "AWARENESS" &&
                Array.isArray(tag.info) &&
                tag.info.includes(npcRef)
            );
            
            if (!hasNpcAwareness) {
                const newTag = {
                    name: "AWARENESS",
                    info: [npcRef],
                    created_at: new Date().toISOString()
                };
                actorTags.push(newTag);
            }
        }
        
        const originalTagsLen = Array.isArray((actor as any).tags) ? ((actor as any).tags as any[]).length : 0;
        if (actorTags.length > originalTagsLen) {
            actor.tags = actorTags;
            // Actor tags updated - save_actor function is available in actor_storage/store.ts
        }
    }
    
    return appliedCount;
}

async function process_message(outbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    // Step 1: Transition to processing
    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) {
        debug_error("StateApplier", `Failed to transition ${msg.id} to processing`, { currentStatus: msg.status });
        return;
    }
    
    // Use centralized atomic update from outbox_store
    update_outbox_message(outbox_path, processing.message);
    const updated = true; // Assume success since outbox_store handles errors internally
    if (!updated) {
        debug_error("StateApplier", `Failed to update outbox for ${msg.id} (processing)`, { id: msg.id });
        return;
    }
    append_log_envelope(log_path, processing.message);
    debug_pipeline("StateApplier", `  [1/4] Status: pending_state_apply -> processing`, { id: msg.id });

    // Step 2: Extract and process effects
    let effectsApplied = 0;
    const effects = (msg.meta as any)?.effects as string[] | undefined;
    
    if (DEBUG_LEVEL >= 3) {
        debug_pipeline("StateApplier", `  [2/4] Effects check`, { 
            id: msg.id,
            hasEffects: !!effects,
            effectsCount: effects?.length || 0,
            effects: effects?.slice(0, 3) // Show first 3 effects
        });
    }
    
    if (effects && effects.length > 0) {
        const parsed = parse_machine_text(effects.join("\n"));
        
        if (parsed.errors.length > 0) {
            debug_error("StateApplier", `  Parse errors for ${msg.id}`, { 
                errors: parsed.errors,
                effectsCount: effects.length 
            });
            // Continue processing even with parse errors - some effects may still apply
        } else {
            debug_pipeline("StateApplier", `  [2/4] Parsed ${parsed.commands.length} commands`, { id: msg.id });
            
            const resolved = resolve_references(parsed.commands, {
                slot: data_slot_number,
                use_representative_data: false,
            });

            if (DEBUG_LEVEL >= 3) {
                debug_pipeline("StateApplier", `  [2/4] Resolved ${Object.keys(resolved.resolved).length} references`, { 
                    id: msg.id,
                    resolved: Object.keys(resolved.resolved)
                });
            }

            const target_paths: Record<string, string> = {};
            for (const [ref, info] of Object.entries(resolved.resolved)) {
                if (info.path) target_paths[ref] = info.path;
            }

            const applied = apply_effects(parsed.commands, target_paths);
            effectsApplied = applied.diffs.length;
            
            if (effectsApplied > 0) {
                debug_pipeline("StateApplier", `  [2/4] APPLIED ${effectsApplied} effects`, { 
                    id: msg.id,
                    diffs: applied.diffs.map(d => ({ 
                        target: d.target, 
                        field: d.field,
                        delta: d.delta,
                        reason: d.reason 
                    }))
                });
                
                for (const diff of applied.diffs) {
                    append_log_message(log_path, "state_applier", `data change to ${diff.target} 's DATA`);
                }
            } else {
                debug_pipeline("StateApplier", `  [2/4] No effects applied`, { id: msg.id });
            }

            if (applied.warnings.length > 0) {
                for (const warning of applied.warnings) {
                    debug_error("StateApplier", `  Warning during apply: ${warning}`, { id: msg.id });
                }
            }
        }
    } else {
        debug_pipeline("StateApplier", `  [2/4] No effects to apply`, { id: msg.id });
    }

    // Step 3: Apply awareness tags for COMMUNICATE events
    const events = (msg.meta as any)?.events as string[] | undefined;
    const hasCommunicateEvents = events?.some(e => e.includes("COMMUNICATE")) ?? false;
    
    if (hasCommunicateEvents) {
        const awarenessApplied = apply_awareness_tags(events);
        if (awarenessApplied > 0) {
            debug_pipeline("StateApplier", `  [2.5/4] Applied ${awarenessApplied} awareness tags`, { id: msg.id });
        }
    }
    
    // Step 3.5: Record events to working memory for ALL actions
    // FIX: Check for active timed event and use event_id as lookup key to align with turn_manager
    const timed_event = get_timed_event_state(data_slot_number);
    const is_timed_event_active = timed_event?.timed_event_active && timed_event?.event_id;
    
    // Use timed event ID if active, otherwise fall back to correlation_id
    const memory_lookup_id = is_timed_event_active 
        ? timed_event.event_id! 
        : msg.correlation_id;
    
    if (memory_lookup_id && events && events.length > 0) {
        // Try to find working memory by the correct lookup key
        let memory = get_working_memory(data_slot_number, memory_lookup_id);
        
        // If no memory exists and no timed event is active, create it on-demand
        // (If timed event is active, turn_manager should have created the memory)
        if (!memory && !is_timed_event_active) {
            // Get region from current player location
            const region_id = get_current_region(data_slot_number);
            const participants = extract_participants_from_events(events);
            
            // Ensure player actor is always included
            const player_ref = "actor.henry_actor";
            if (!participants.includes(player_ref)) {
                participants.unshift(player_ref);
            }
            
            memory = await build_working_memory(
                data_slot_number,
                memory_lookup_id,
                detect_event_type(events),
                region_id,
                participants
            );
            
            debug_pipeline("StateApplier", `  [2.6/4] Created working memory for session`, {
                lookup_id: memory_lookup_id,
                region_id,
                participant_count: participants.length,
                is_timed_event: false
            });
        } else if (memory && is_timed_event_active) {
            debug_pipeline("StateApplier", `  [2.6/4] Found existing working memory for timed event`, {
                lookup_id: memory_lookup_id,
                event_id: timed_event.event_id,
                is_timed_event: true
            });
        }
        
        if (memory && events.length > 0) {
            // Extract event details from the first event
            const firstEvent = events[0];
            const actor_match = firstEvent?.match(/^(actor|npc)\.([^\.]+)/);
            const verb_match = firstEvent?.match(/\.([A-Z_]+)\(/);
            const target_match = firstEvent?.match(/target=([^,)]+)/);
            
            if (actor_match && verb_match && actor_match[1] && actor_match[2] && verb_match[1]) {
                const actor_ref = `${actor_match[1]}.${actor_match[2]}`;
                const action: string = verb_match[1];
                const target = target_match?.[1];
                
                // Determine emotional tone based on action
                let emotional_tone = "neutral";
                if (action === "ATTACK") emotional_tone = "tense";
                else if (action === "COMMUNICATE") emotional_tone = "conversational";
                else if (action === "DEFEND") emotional_tone = "defensive";
                else if (action === "HELP") emotional_tone = "supportive";
                
                // Build event object
                const event_data: {
                    turn: number;
                    actor: string;
                    action: string;
                    outcome: string;
                    emotional_tone: string;
                    target?: string;
                } = {
                    turn: memory.recent_events.length + 1,
                    actor: actor_ref,
                    action,
                    outcome: effectsApplied > 0 ? "succeeded" : "attempted",
                    emotional_tone
                };
                
                // Only add target if it exists
                if (target) {
                    event_data.target = target;
                }
                
                // Add to working memory using the correct lookup ID
                add_event_to_memory(data_slot_number, memory_lookup_id, event_data);
                
                debug_pipeline("StateApplier", `  [2.7/4] Recorded event to working memory`, {
                    lookup_id: memory_lookup_id,
                    actor: actor_ref,
                    action,
                    is_timed_event: is_timed_event_active
                });
            }
        }
    }
    
    // Step 4: ALWAYS create applied_1 message for every ruling
    // This ensures Renderer AI can generate narrative for ALL actions
    const actionVerb = extractActionVerb(events);
    
    // Use deterministic ID based on parent message to prevent duplicates
    const output: MessageInput = {
        id: `${msg.id}_applied`, // Deterministic ID
        sender: "state_applier",
        content: "state applied",
        stage: "applied_1",
        status: "sent",
        reply_to: msg.id,
        meta: {
            ...getSessionMeta(),
            effects_applied: effectsApplied,
            effects: effects || [],
            events: events || [],
            original_text: (msg.meta as any)?.original_text,
            machine_text: (msg.meta as any)?.machine_text,
            ruling_stage: msg.stage,
            is_final_ruling: (msg.meta as any)?.is_final_ruling,
            action_verb: actionVerb,
        },
    };

    if (msg.correlation_id) output.correlation_id = msg.correlation_id;
    if (msg.conversation_id !== undefined) output.conversation_id = msg.conversation_id;
    if (msg.turn_number !== undefined) output.turn_number = msg.turn_number;
    if (msg.role !== undefined) output.role = msg.role;
    append_outbox_message_deduped(outbox_path, create_message(output));
    debug_pipeline("StateApplier", `  [3/4] Created applied_1 message`, { 
        id: msg.id,
        effectsApplied,
        hasCommunicateEvents,
        actionVerb,
        replyTo: msg.id
    });

    // Step 4: Mark original message as done
    debug_pipeline("StateApplier", `  [4/4] Marking ruling as done`, { 
        id: msg.id,
        stage: msg.stage,
        effectsApplied,
        hasCommunicateEvents 
    });
    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        // Use centralized atomic update from outbox_store
        update_outbox_message(outbox_path, done.message);
        const doneUpdated = true; // Assume success since outbox_store handles errors internally
        if (doneUpdated) {
            append_log_envelope(log_path, done.message);
            debug_pipeline("StateApplier", `  [4/4] COMPLETED - Status: processing -> done`, { id: done.message.id });
        } else {
            debug_error("StateApplier", `  [4/4] Failed to mark as done (outbox update failed)`, { id: msg.id });
        }
    } else {
        debug_error("StateApplier", `  [4/4] Failed to transition to done`, { id: msg.id });
    }

    await sleep(0);
}

async function tick(outbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        // Log poll results only when state changes (prevents spam)
        if (DEBUG_LEVEL >= 3) {
            const stageBreakdown: Record<string, number> = {};
            const statusBreakdown: Record<string, number> = {};
            
            for (const m of outbox.messages) {
                const stage = m.stage || 'no_stage';
                const status = m.status || 'no_status';
                stageBreakdown[stage] = (stageBreakdown[stage] || 0) + 1;
                statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
            }
            
            // Create state signature for comparison
            const currentState = {
                messageCount: outbox.messages.length,
                stageBreakdown: JSON.stringify(stageBreakdown),
                statusBreakdown: JSON.stringify(statusBreakdown),
                timestamp: Date.now()
            };
            
            // Only log if state changed or it's been more than 30 seconds
            const shouldLog = !lastLoggedState || 
                currentState.messageCount !== lastLoggedState.messageCount ||
                currentState.stageBreakdown !== lastLoggedState.stageBreakdown ||
                currentState.statusBreakdown !== lastLoggedState.statusBreakdown ||
                (currentState.timestamp - lastLoggedState.timestamp) > 30000;
            
            if (shouldLog) {
                debug_pipeline("StateApplier", `POLL - ${outbox.messages.length} messages in outbox`, {
                    byStage: stageBreakdown,
                    byStatus: statusBreakdown
                });
                lastLoggedState = currentState;
            }
        }
        
        // Clean architecture: Only process messages marked as pending_state_apply by RulesLawyer
        const candidates = outbox.messages.filter((m) => {
            if (!m.stage?.startsWith("ruling_")) return false;
            // Only process messages specifically marked for state application
            if (m.status !== "pending_state_apply") return false;
            if (!isCurrentSession(m)) return false;
            return true;
        });

        if (candidates.length > 0) {
            debug_pipeline("StateApplier", `FOUND ${candidates.length} CANDIDATES for processing`, {
                ids: candidates.map(m => m.id),
                stages: candidates.map(m => m.stage),
                statuses: candidates.map(m => m.status),
                correlationIds: candidates.map(m => m.correlation_id)
            });
        } else if (DEBUG_LEVEL >= 4) {
            // Only log at high debug level - this is expected when rulings are already processed
            const rulingMessages = outbox.messages.filter(m => m.stage?.startsWith("ruling_"));
            if (rulingMessages.length > 0) {
                const pendingRulings = rulingMessages.filter(m => m.status === "pending_state_apply");
                if (pendingRulings.length === 0) {
                    // All rulings processed - this is normal, log at trace level only
                    debug_log("StateApplier", "All rulings processed (normal)", {
                        totalRulings: rulingMessages.length,
                        done: rulingMessages.filter(m => m.status === "done").length
                    });
                } else {
                    // Some rulings pending but not matching filter - investigate
                    debug_pipeline("StateApplier", "PENDING RULINGS not matching filter", {
                        pendingCount: pendingRulings.length,
                        statuses: pendingRulings.map(m => ({ id: m.id, status: m.status }))
                    });
                }
            }
        }

        for (const msg of candidates) {
            debug_pipeline("StateApplier", `>>> PROCESSING ${msg.id}`, { 
                stage: msg.stage, 
                status: msg.status,
                sender: msg.sender,
                correlationId: msg.correlation_id,
                effectsCount: ((msg.meta as any)?.effects as string[] | undefined)?.length || 0
            });
            
            try {
                await process_message(outbox_path, log_path, msg);
            } catch (err) {
                debug_error("StateApplier", `FAILED to process message ${msg.id}`, err);
                // Continue to next message even if this one failed
            }
        }
    } catch (err) {
        debug_error("StateApplier", "Tick failed", err);
    }
}

// Helper functions for working memory management

function detect_event_type(events: string[]): "combat" | "conversation" | "exploration" {
    const event_text = events.join(" ");
    if (event_text.includes("ATTACK") || event_text.includes("DEFEND")) return "combat";
    if (event_text.includes("COMMUNICATE")) return "conversation";
    return "exploration";
}

function extract_participants_from_events(events: string[]): string[] {
    const participants = new Set<string>();
    for (const event of events) {
        // Extract actor
        const actor_match = event.match(/^(actor|npc)\.([^\.]+)/);
        if (actor_match) {
            participants.add(`${actor_match[1]}.${actor_match[2]}`);
        }
        // Extract target
        const target_match = event.match(/target=(actor|npc)\.([^,)]+)/);
        if (target_match) {
            participants.add(`${target_match[1]}.${target_match[2]}`);
        }
    }
    return Array.from(participants);
}

function get_current_region(slot: number): string {
    // Get player location
    const result = load_actor(slot, "henry_actor");
    if (!result.ok || !result.actor.location) {
        return "eden_crossroads"; // Default fallback
    }
    
    const location = result.actor.location as { 
        world_tile?: { x: number; y: number }; 
        region_tile?: { x: number; y: number };
    };
    
    const player_wx = location.world_tile?.x ?? 0;
    const player_wy = location.world_tile?.y ?? 0;
    const player_rx = location.region_tile?.x ?? 0;
    const player_ry = location.region_tile?.y ?? 0;
    
    // Search for region file matching player coordinates
    const regions_dir = path.join(get_data_slot_dir(slot), "regions");
    if (fs.existsSync(regions_dir)) {
        const files = fs.readdirSync(regions_dir).filter(f => f.endsWith('.jsonc'));
        
        for (const file of files) {
            try {
                const region_path = path.join(regions_dir, file);
                const raw = fs.readFileSync(region_path, 'utf-8');
                const region = parse(raw) as { 
                    id: string; 
                    world_coords?: { 
                        world_x: number; 
                        world_y: number; 
                        region_x: number; 
                        region_y: number; 
                    };
                };
                
                if (region.world_coords) {
                    const wc = region.world_coords;
                    if (wc.world_x === player_wx && 
                        wc.world_y === player_wy && 
                        wc.region_x === player_rx && 
                        wc.region_y === player_ry) {
                        return region.id;
                    }
                }
            } catch (e) {
                // Skip files that can't be parsed
                continue;
            }
        }
    }
    
    // Fallback to default region
    return "eden_crossroads";
}

function initialize(): { outbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, log_path };
}

const { outbox_path, log_path } = initialize();
debug_log("StateApplier: booted", { outbox_path, log_path });

setInterval(() => {
    void tick(outbox_path, log_path);
}, POLL_MS);

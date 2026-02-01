import { get_data_slot_dir, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_error, debug_pipeline, DEBUG_LEVEL } from "../shared/debug.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { parse_machine_text } from "../system_syntax/index.js";
import { resolve_references } from "../reference_resolver/resolver.js";
import { apply_effects } from "./apply.js";
import { find_npcs, load_npc, save_npc } from "../npc_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import * as fs from "node:fs";
import * as path from "node:path";

const data_slot_number = 1;
const POLL_MS = 800;

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

// THAUMWORLD Action Verbs for narrative generation
const THAUMWORLD_ACTION_VERBS = [
    "ATTACK", "COMMUNICATE", "INSPECT", "MOVE", "USE", 
    "HELP", "DEFEND", "GRAPPLE", "DODGE", "CRAFT", 
    "SLEEP", "REPAIR", "WORK", "GUARD", "HOLD"
];

/**
 * Extract the action verb from events array
 * Returns the verb (e.g., "INSPECT", "ATTACK") or null if not found
 */
function extractActionVerb(events: string[] | undefined): string | null {
    if (!events || events.length === 0) return null;
    
    for (const event of events) {
        for (const verb of THAUMWORLD_ACTION_VERBS) {
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
    return targetMatch ? targetMatch[1] : null;
}

/**
 * Extract tool from event string
 * Parses patterns like: tool=actor.henry_actor.hands
 */
function extractTool(event: string): string | null {
    const toolMatch = event.match(/tool=([^,)]+)/);
    return toolMatch ? toolMatch[1] : null;
}

function update_outbox_message_atomic(outbox_path: string, updated: MessageEnvelope): boolean {
    const lockPath = outbox_path + '.lock';
    const maxRetries = 10;
    const retryDelay = 50; // ms
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Try to acquire lock
            try {
                fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
            } catch (e) {
                // Lock exists, wait and retry
                if (attempt < maxRetries - 1) {
                    sleep(retryDelay);
                    continue;
                }
                debug_error("StateApplier", `Failed to acquire lock after ${maxRetries} attempts`, e);
                return false;
            }
            
            // Read, modify, write
            const outbox = read_outbox(outbox_path);
            const idx = outbox.messages.findIndex((m) => m.id === updated.id);
            if (idx === -1) {
                fs.unlinkSync(lockPath);
                return false;
            }
            outbox.messages[idx] = updated;
            const pruned = prune_outbox_messages(outbox, 10);
            write_outbox(outbox_path, pruned);
            
            // Release lock
            fs.unlinkSync(lockPath);
            return true;
        } catch (err) {
            // Clean up lock if it exists
            try {
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                }
            } catch {}
            
            if (attempt < maxRetries - 1) {
                sleep(retryDelay);
            } else {
                debug_error("StateApplier", `Failed to update outbox after ${maxRetries} attempts`, err);
                return false;
            }
        }
    }
    return false;
}

// Keep old function for backwards compatibility, but use atomic version
function update_outbox_message(outbox_path: string, updated: MessageEnvelope): void {
    update_outbox_message_atomic(outbox_path, updated);
}

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
        
        if (actorTags.length > (actor.tags || []).length) {
            actor.tags = actorTags;
            // Actor storage needs save function - for now, skip actor save
            // TODO: Add save_actor function
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
    
    const updated = update_outbox_message_atomic(outbox_path, processing.message);
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
    
    // Step 4: ALWAYS create applied_1 message for every ruling
    // This ensures Renderer AI can generate narrative for ALL actions
    const actionVerb = extractActionVerb(events);
    
    const output: MessageInput = {
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
    append_outbox_message(outbox_path, create_message(output));
    debug_pipeline("StateApplier", `  [3/4] Created applied_1 message`, { 
        id: msg.id,
        effectsApplied,
        hasCommunicateEvents,
        actionVerb,
        replyTo: msg.id
    });

    // Step 4: Mark original message as done
    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        const doneUpdated = update_outbox_message_atomic(outbox_path, done.message);
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
                correlationIds: candidates.map(m => m.correlation_id)
            });
        } else if (DEBUG_LEVEL >= 3) {
            // Log why no candidates found
            const rulingMessages = outbox.messages.filter(m => m.stage?.startsWith("ruling_"));
            if (rulingMessages.length > 0) {
                debug_pipeline("StateApplier", "NO CANDIDATES - ruling messages exist but wrong status", {
                    rulingCount: rulingMessages.length,
                    statuses: rulingMessages.map(m => ({ id: m.id, status: m.status }))
                });
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

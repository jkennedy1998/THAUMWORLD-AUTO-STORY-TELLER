import { get_data_slot_dir, get_log_path, get_inbox_path, get_outbox_path, get_npc_path, get_actor_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_error, debug_pipeline, DEBUG_LEVEL, log_ai_io_terminal, log_ai_io_file } from "../shared/debug.js";
import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { append_metric } from "../engine/metrics_store.js";
import { find_npcs, load_npc } from "../npc_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import * as fs from "node:fs";
import * as path from "node:path";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.NPC_AI;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const NPC_AI_MODEL = process.env.NPC_AI_MODEL ?? "llama3.2:latest";
const NPC_AI_TIMEOUT_MS_RAW = Number(process.env.NPC_AI_TIMEOUT_MS ?? 120_000);
const NPC_AI_TIMEOUT_MS = Number.isFinite(NPC_AI_TIMEOUT_MS_RAW) ? NPC_AI_TIMEOUT_MS_RAW : 120_000;
const NPC_AI_KEEP_ALIVE = "30m";
const NPC_AI_TEMPERATURE = 0.8;

// Track which NPCs have responded in current conversation round to avoid duplicates
const responded_npcs = new Set<string>();
let last_communication_id: string | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChatTurn = { role: "user" | "assistant"; content: string };
const npc_sessions = new Map<string, ChatTurn[]>();
const SESSION_LIMIT = 10;

function get_session_key(npc_id: string, correlation_id: string): string {
    return `${npc_id}:${correlation_id}`;
}

function get_session_history(session_key: string): ChatTurn[] {
    return npc_sessions.get(session_key) ?? [];
}

function append_session_turn(session_key: string, user_text: string, assistant_text: string): void {
    const history = [...get_session_history(session_key)];
    history.push({ role: "user", content: user_text }, { role: "assistant", content: assistant_text });
    if (history.length > SESSION_LIMIT) {
        history.splice(0, history.length - SESSION_LIMIT);
    }
    npc_sessions.set(session_key, history);
}

// Build NPC system prompt based on character sheet
function build_npc_prompt(npc: any, player_text: string, can_perceive: boolean, clarity: string): string {
    const personality = npc.personality || {};
    const lore = npc.lore || {};
    const appearance = npc.appearance || {};
    
    let prompt_parts: string[] = [];
    
    // Identity
    prompt_parts.push(`You are ${npc.name}${npc.title ? `, ${npc.title}` : ''}.`);
    
    // Role/Goal
    if (personality.story_goal) {
        prompt_parts.push(`Your role: ${personality.story_goal}`);
    }
    
    // Personality traits
    const traits: string[] = [];
    if (personality.fear) traits.push(`fear: ${personality.fear}`);
    if (personality.flaw) traits.push(`flaw: ${personality.flaw}`);
    if (personality.passion) traits.push(`passionate about: ${personality.passion}`);
    if (personality.hobby) traits.push(`hobby: ${personality.hobby}`);
    if (traits.length > 0) {
        prompt_parts.push(`Personality: ${traits.join(', ')}`);
    }
    
    // Triggers
    const triggers: string[] = [];
    if (personality.happy_triggers) triggers.push(`made happy by: ${personality.happy_triggers}`);
    if (personality.angry_triggers) triggers.push(`angered by: ${personality.angry_triggers}`);
    if (personality.sad_triggers) triggers.push(`saddened by: ${personality.sad_triggers}`);
    if (triggers.length > 0) {
        prompt_parts.push(`Triggers: ${triggers.join('; ')}`);
    }
    
    // Appearance if notable
    if (appearance.distinguishing_features) {
        prompt_parts.push(`Notable features: ${appearance.distinguishing_features}`);
    }
    
    // Perception context
    if (!can_perceive) {
        prompt_parts.push(`\nCURRENT SITUATION: You cannot perceive who is speaking to you. You might hear muffled sounds or sense a presence but cannot identify the source.`);
    } else if (clarity === "obscured") {
        prompt_parts.push(`\nCURRENT SITUATION: You can sense someone nearby but cannot see them clearly. You hear their voice but details are unclear.`);
    } else {
        prompt_parts.push(`\nCURRENT SITUATION: You can clearly see and hear the player.`);
    }
    
    // Response instruction
    prompt_parts.push(`\nSomeone says: "${player_text}"`);
    prompt_parts.push(`\nRespond as ${npc.name} would, staying true to your personality.`);
    prompt_parts.push(`Keep response to 1-2 sentences.`);
    prompt_parts.push(`If you can't perceive them well, show confusion or ignore them.`);
    prompt_parts.push(`Never break character. Never mention game mechanics.`);
    
    return prompt_parts.join("\n");
}

// Check if NPC can perceive the player
function can_npc_perceive_player(npc: any, player_location: any, player_ref: string): { can_perceive: boolean; clarity: string } {
    // Phase 1: Check if NPC has AWARENESS tag for player (per THAUMWORLD rules)
    const tags = npc.tags || [];
    const hasAwarenessTag = tags.some((tag: Record<string, unknown>) => 
        tag.name === "AWARENESS" &&
        Array.isArray(tag.info) &&
        tag.info.includes(player_ref)
    );
    
    if (hasAwarenessTag) {
        // Has awareness - determine clarity based on location
        const npc_region = npc.location?.region_tile;
        const player_region = player_location?.region_tile;
        
        if (npc_region && player_region &&
            npc_region.x === player_region.x && 
            npc_region.y === player_region.y) {
            // Same region - check if same tile for clarity
            const npc_tile = npc.location?.tile;
            const player_tile = player_location?.tile;
            
            if (npc_tile && player_tile && 
                npc_tile.x === player_tile.x && 
                npc_tile.y === player_tile.y) {
                return { can_perceive: true, clarity: "clear" };
            }
            
            return { can_perceive: true, clarity: "obscured" };
        }
        
        // Player left region - awareness persists but can't perceive well
        return { can_perceive: false, clarity: "none" };
    }
    
    // Phase 2: No awareness tag yet - check for initial contact via senses
    const npc_region = npc.location?.region_tile;
    const player_region = player_location?.region_tile;
    
    if (!npc_region || !player_region) {
        return { can_perceive: false, clarity: "none" };
    }
    
    const same_region = (
        npc_region.x === player_region.x && 
        npc_region.y === player_region.y
    );
    
    if (!same_region) {
        return { can_perceive: false, clarity: "none" };
    }
    
    // Check senses - pressure is default for hearing
    const pressure_sense = npc.senses?.pressure ?? 0;
    
    if (pressure_sense > 0) {
        // Same tile = clear, same region = obscured
        const npc_tile = npc.location?.tile;
        const player_tile = player_location?.tile;
        
        if (npc_tile && player_tile && 
            npc_tile.x === player_tile.x && 
            npc_tile.y === player_tile.y) {
            return { can_perceive: true, clarity: "clear" };
        }
        
        return { can_perceive: true, clarity: "obscured" };
    }
    
    return { can_perceive: false, clarity: "none" };
}

// Determine if NPC should respond based on personality
function should_npc_respond(npc: any, is_direct_target: boolean): boolean {
    // Direct target always responds
    if (is_direct_target) return true;
    
    // Otherwise, check if personality suggests they would join conversation
    const personality = npc.personality || {};
    
    // Passionate or hobby-focused NPCs might chime in
    if (personality.passion || personality.hobby) {
        // 30% chance to join unaddressed conversation
        return Math.random() < 0.3;
    }
    
    // Default: don't respond unless directly addressed
    return false;
}

async function process_communication(
    outbox_path: string,
    inbox_path: string,
    log_path: string,
    msg: MessageEnvelope
): Promise<void> {
    const started = Date.now();
    
    // Extract communication details from meta
    const original_text = (msg.meta as any)?.original_text as string || "";
    const machine_text = (msg.meta as any)?.machine_text as string || "";
    const events = (msg.meta as any)?.events as string[] || [];
    
    // Find COMMUNICATE events to identify targets
    const communicate_events = events.filter(e => e.includes("COMMUNICATE"));
    
    if (communicate_events.length === 0) {
        debug_pipeline("NPC_AI", "No COMMUNICATE events found", { id: msg.id });
        return;
    }
    
    // Get player actor info
    const correlation_id = msg.correlation_id ?? msg.id;
    
    // Find the player actor from the communication
    // The machine text contains actor.<id>.COMMUNICATE
    const actor_match = machine_text.match(/actor\.(\w+)\.COMMUNICATE/);
    if (!actor_match || !actor_match[1]) {
        debug_error("NPC_AI", "Could not identify actor from machine text", { machine_text });
        return;
    }
    
    const actor_id = actor_match[1];
    const actor_result = load_actor(data_slot_number, actor_id);
    
    if (!actor_result.ok) {
        debug_error("NPC_AI", `Failed to load actor ${actor_id}`, actor_result);
        return;
    }
    
    const player_location = actor_result.actor.location as { region_tile?: { x: number; y: number }; tile?: { x: number; y: number } };
    
    // Parse targets from machine text
    const targets_match = machine_text.match(/targets=\[([^\]]+)\]/);
    const direct_targets: string[] = [];
    
    if (targets_match && targets_match[1]) {
        const targets_str = targets_match[1];
        // Parse individual targets like npc.shopkeep, actor.other, etc.
        const target_matches = targets_str.match(/npc\.(\w+)/g);
        if (target_matches) {
            target_matches.forEach(t => {
                const npc_id = t.replace("npc.", "");
                direct_targets.push(npc_id);
            });
        }
    }
    
    // Find all NPCs in same region
    const nearby_npcs = find_npcs(data_slot_number, {}).filter(npc_hit => {
        if (npc_hit.id === "default_npc") return false;
        const npc_result = load_npc(data_slot_number, npc_hit.id);
        if (!npc_result.ok) return false;
        
        const npc = npc_result.npc as { location?: { region_tile?: { x: number; y: number }; tile?: { x: number; y: number } } };
        const npc_region = npc.location?.region_tile;
        const player_region = player_location?.region_tile;
        
        if (!npc_region || !player_region) return false;
        
        return npc_region.x === player_region.x && npc_region.y === player_region.y;
    });
    
    debug_pipeline("NPC_AI", `Found ${nearby_npcs.length} NPCs in region`, {
        region: player_location?.region_tile,
        npcs: nearby_npcs.map(n => n.id)
    });
    
    // Track responses for this communication
    const communication_key = `${correlation_id}:${original_text}`;
    if (last_communication_id !== communication_key) {
        // New communication round, reset tracking
        responded_npcs.clear();
        last_communication_id = communication_key;
    }
    
    // Process each nearby NPC
    for (const npc_hit of nearby_npcs) {
        // Skip if already responded in this round
        if (responded_npcs.has(npc_hit.id)) {
            continue;
        }
        
        const npc_result = load_npc(data_slot_number, npc_hit.id);
        if (!npc_result.ok) continue;
        
        const npc = npc_result.npc;
        const is_direct_target = direct_targets.includes(npc_hit.id);
        
        // Check if NPC should respond
        if (!should_npc_respond(npc, is_direct_target)) {
            continue;
        }
        
        // Check perception using AWARENESS tags (per THAUMWORLD rules)
        const player_ref = `actor.${actor_id}`;
        const perception = can_npc_perceive_player(npc, player_location, player_ref);
        
        if (!perception.can_perceive && !is_direct_target) {
            // Can't perceive and not directly addressed - skip
            continue;
        }
        
        debug_pipeline("NPC_AI", `Generating response for ${npc.name}`, {
            npc_id: npc_hit.id,
            is_direct_target,
            clarity: perception.clarity
        });
        
        // Build prompt
        const prompt = build_npc_prompt(npc, original_text, perception.can_perceive, perception.clarity);
        
        // Get session history
        const session_key = get_session_key(npc_hit.id, correlation_id);
        const history = get_session_history(session_key);
        
        const messages: OllamaMessage[] = [
            { role: "system", content: "You are roleplaying as an NPC in a fantasy world. Stay in character." },
            ...history,
            { role: "user", content: prompt }
        ];
        
        try {
            const response = await ollama_chat({
                host: OLLAMA_HOST,
                model: NPC_AI_MODEL,
                messages,
                keep_alive: NPC_AI_KEEP_ALIVE,
                timeout_ms: NPC_AI_TIMEOUT_MS,
                options: { temperature: NPC_AI_TEMPERATURE },
            });
            
            const npc_response = response.content.trim();
            
            // Log AI I/O
            log_ai_io_terminal(
                'interpreter', // Using interpreter type for NPC responses
                `${npc.name} responding to: ${original_text.slice(0, 30)}...`,
                npc_response,
                response.duration_ms,
                session_key
            );
            
            // Store to session
            append_session_turn(session_key, original_text, npc_response);
            
            // Create response message
            const output: MessageInput = {
                sender: `npc.${npc_hit.id}`,
                content: npc_response,
                stage: "npc_response",
                status: "sent",
                reply_to: msg.id,
                correlation_id: correlation_id,
                meta: {
                    ...getSessionMeta(),
                    npc_id: npc_hit.id,
                    npc_name: npc.name,
                    target_actor: actor_id,
                    communication_context: original_text,
                    is_direct_response: is_direct_target,
                    perception_clarity: perception.clarity,
                },
            };
            
            const response_msg = create_message(output);
            append_inbox_message(inbox_path, response_msg);
            
            debug_pipeline("NPC_AI", `Created response from ${npc.name}`, {
                msg_id: response_msg.id,
                response_preview: npc_response.slice(0, 50)
            });
            
            // Mark as responded
            responded_npcs.add(npc_hit.id);
            
            // Log metric
            append_metric(data_slot_number, "npc_ai", {
                at: new Date().toISOString(),
                model: response.model,
                ok: true,
                duration_ms: response.duration_ms,
                stage: "npc_response",
                session: session_key,
            });
            
        } catch (err) {
            debug_error("NPC_AI", `Failed to generate response for ${npc.name}`, err);
            append_metric(data_slot_number, "npc_ai", {
                at: new Date().toISOString(),
                model: NPC_AI_MODEL,
                ok: false,
                duration_ms: Date.now() - started,
                stage: "npc_response",
                session: session_key,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        // Look for applied_1 messages that contain COMMUNICATE events
        // Only process messages with status "sent" - skip "processing" and "done"
        const candidates = outbox.messages.filter((m) => {
            if (!m.stage?.startsWith("applied_")) return false;
            if (m.status !== "sent") return false;  // Only process if not yet handled
            if (!isCurrentSession(m)) return false;  // Only process messages from current session
            
            // Check if it has COMMUNICATE-related events
            const events = (m.meta as any)?.events as string[] || [];
            const has_communicate = events.some(e => 
                e.includes("COMMUNICATE") || e.includes("SET_AWARENESS")
            );
            
            return has_communicate;
        });
        
        if (candidates.length > 0 && DEBUG_LEVEL >= 3) {
            debug_pipeline("NPC_AI", `Found ${candidates.length} communication candidates`, {
                ids: candidates.map(m => m.id)
            });
        }
        
        for (const msg of candidates) {
            try {
                // Mark as processing to prevent duplicate handling
                try_set_message_status(outbox_path, msg.id, "processing");
                
                await process_communication(outbox_path, inbox_path, log_path, msg);
                
                // Mark as done after successful processing
                try_set_message_status(outbox_path, msg.id, "done");
            } catch (err) {
                debug_error("NPC_AI", `Failed to process communication ${msg.id}`, err);
                // Don't mark as done on error - will retry next poll
            }
        }
        
        await sleep(0);
    } catch (err) {
        debug_error("NPC_AI", "Tick failed", err);
    }
}

function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("NPC_AI: booted", { outbox_path, inbox_path, model: NPC_AI_MODEL });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);
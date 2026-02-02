import { get_data_slot_dir, get_log_path, get_inbox_path, get_outbox_path, get_npc_path, get_actor_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, update_outbox_message, remove_duplicate_messages } from "../engine/outbox_store.js";
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
import { get_working_memory, format_memory_for_ai } from "../context_manager/index.js";
import { filter_memory_for_action, format_filtered_memory } from "../context_manager/relevance.js";
import { checkScriptedResponse, buildDecisionContext, type MatchedScriptedResponse } from "./decision_tree.js";
import { findTemplate, getTemplateResponse, detectSituation } from "./template_db.js";
import { getAvailableActions, buildNPCState, type AvailableAction } from "./action_selector.js";
import { applySway, applySwayToActions, createSwayFromCommunication, getActiveSway, describeSwayEffects } from "./sway_system.js";
import { start_conversation, add_message, end_conversation, get_conversation } from "../conversation_manager/archive.js";
import { format_for_ai } from "../conversation_manager/formatter.js";
import { summarize_for_npc, get_important_memories } from "../conversation_manager/summarizer.js";
import { get_memories_about, remembers_entity, get_relationship_status, add_conversation_memory, get_formatted_memories } from "../npc_storage/memory.js";
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

// ===== DECISION HIERARCHY: Scripted → Template → AI =====

type DecisionResult = 
    | { type: "scripted"; response: MatchedScriptedResponse }
    | { type: "template"; action: string; dialogue: string }
    | { type: "ai"; reason: string };

/**
 * Determine NPC response using decision hierarchy
 * 1. Check scripted responses (emergency, combat, social)
 * 2. Check template database (archetype-specific)
 * 3. Fall back to AI if needed
 */
function determineResponse(
    npc: any,
    player_text: string,
    situation: {
        is_combat: boolean;
        has_been_attacked: boolean;
        nearby_hostiles: number;
        nearby_allies: number;
        is_direct_target: boolean;
    },
    available_actions: AvailableAction[]
): DecisionResult {
    // Step 1: Check scripted responses (highest priority)
    const decision_context = buildDecisionContext(
        {
            id: npc.id,
            name: npc.name,
            role: npc.role || "unknown",
            personality: npc.personality ? JSON.stringify(npc.personality) : "neutral",
            stats: npc.stats
        },
        player_text,
        {
            is_combat: situation.is_combat,
            has_been_attacked: situation.has_been_attacked,
            nearby_hostiles: situation.nearby_hostiles,
            nearby_allies: situation.nearby_allies,
            action_verb: available_actions[0]?.verb,
            target_ref: situation.is_direct_target ? "player" : undefined
        }
    );
    
    const scripted = checkScriptedResponse(decision_context);
    if (scripted.matched && scripted.priority >= 7) {
        // High priority scripted responses (emergency, combat)
        return { type: "scripted", response: scripted };
    }
    
    // Step 2: Check template database
    const archetype = npc.role || "villager";
    const detected_situation = detectSituation(player_text);
    const health = npc.stats?.health;
    const health_percent = health ? (health.current / health.max) * 100 : 100;
    
    const template = findTemplate(archetype, detected_situation, {
        is_combat: situation.is_combat,
        health_percent,
        time_of_day: "day" // TODO: Get actual time
    });
    
    if (template && template.priority >= 5) {
        // Template found with good priority
        return { 
            type: "template", 
            action: template.action,
            dialogue: getTemplateResponse(template)
        };
    }
    
    // Step 3: Use AI for complex situations
    // - Low priority scripted/template responses
    // - Questions requiring knowledge
    // - Emotional situations
    // - Multi-turn conversations
    let ai_reason = "Complex situation requiring AI";
    if (scripted.matched && scripted.priority < 7) {
        ai_reason = `Scripted response too generic (priority ${scripted.priority})`;
    } else if (template && template.priority < 5) {
        ai_reason = `Template too generic (priority ${template.priority})`;
    } else if (!template) {
        ai_reason = "No matching template found";
    }
    
    return { type: "ai", reason: ai_reason };
}

// Build NPC system prompt based on character sheet
function build_npc_prompt(npc: any, player_text: string, can_perceive: boolean, clarity: string, memory_context?: string): string {
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
    
    // Working memory context (if available)
    if (memory_context && memory_context.length > 0) {
        prompt_parts.push(`\n${memory_context}`);
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
    const player_ref = `actor.${actor_id}`;
    
    // ===== PHASE 4: CONVERSATION TRACKING =====
    
    // Get or create conversation
    let conversation_id = msg.conversation_id;
    let conversation = conversation_id ? get_conversation(data_slot_number, conversation_id) : null;
    
    if (!conversation && conversation_id) {
        // Conversation ID exists but conversation not found, create new
        const player_loc = player_location as { world_tile?: { x: number; y: number }; region_tile?: { x: number; y: number } };
        const region_id = `region.${player_loc.world_tile?.x ?? 0}_${player_loc.world_tile?.y ?? 0}_${player_loc.region_tile?.x ?? 0}_${player_loc.region_tile?.y ?? 0}`;
        const initial_participants = [player_ref];
        conversation = start_conversation(data_slot_number, conversation_id, region_id, initial_participants, undefined);
    }
    
    // Add player message to conversation
    if (conversation && conversation_id) {
        add_message(
            data_slot_number,
            conversation_id,
            player_ref,
            original_text,
            "neutral", // TODO: Detect emotional tone
            "COMMUNICATE"
        );
    }
    
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
        
        // ===== PHASE 3: DECISION HIERARCHY =====
        
        // Get available actions for this NPC
        const npc_state = buildNPCState(
            {
                id: npc_hit.id,
                stats: (npc as Record<string, unknown>).stats as { health?: { current: number; max: number } } | undefined,
                body_slots: (npc as Record<string, unknown>).body_slots as Record<string, unknown> | undefined,
                hand_slots: (npc as Record<string, unknown>).hand_slots as Record<string, string> | undefined,
                tags: (npc as Record<string, unknown>).tags as Array<{ name: string }> | undefined,
                personality: (npc as Record<string, unknown>).personality ? JSON.stringify((npc as Record<string, unknown>).personality) : "neutral",
                role: (npc as Record<string, unknown>).role as string || "unknown"
            },
            {
                nearby_allies: nearby_npcs.length - 1, // Exclude self
                nearby_enemies: 0, // TODO: Track hostiles
                is_in_combat: false // TODO: Check combat state
            }
        );
        
        let available_actions = getAvailableActions(npc_state);
        
        // Apply sway from player communication
        const sway = createSwayFromCommunication(original_text, player_ref, npc_state.personality);
        if (sway) {
            applySway(npc_hit.id, sway);
            debug_pipeline("NPC_AI", `Applied ${sway.type} sway to ${npc.name}`, {
                magnitude: sway.magnitude,
                reason: sway.reason
            });
        }
        
        // Get active sway and apply to actions
        const active_sway = getActiveSway(npc_hit.id);
        if (active_sway.length > 0) {
            available_actions = applySwayToActions(available_actions, active_sway, npc_state.personality);
            debug_pipeline("NPC_AI", `Applied sway to ${npc.name}'s actions`, {
                sway_description: describeSwayEffects(active_sway, npc_state.personality),
                top_action: available_actions[0]?.verb
            });
        }
        
        // Determine response using decision hierarchy
        const decision = determineResponse(
            npc,
            original_text,
            {
                is_combat: false, // TODO: Check combat state
                has_been_attacked: false, // TODO: Check recent events
                nearby_hostiles: 0,
                nearby_allies: nearby_npcs.length - 1,
                is_direct_target: is_direct_target
            },
            available_actions
        );
        
        let npc_response: string;
        let decision_source: string;
        let ai_duration_ms = 0;
        
        switch (decision.type) {
            case "scripted":
                npc_response = decision.response.dialogue;
                decision_source = `scripted (${decision.response.action}, priority ${decision.response.priority})`;
                debug_pipeline("NPC_AI", `Using scripted response for ${npc.name}`, {
                    action: decision.response.action,
                    priority: decision.response.priority,
                    reasoning: decision.response.reasoning
                });
                break;
                
            case "template":
                npc_response = decision.dialogue;
                decision_source = `template (${decision.action})`;
                debug_pipeline("NPC_AI", `Using template response for ${npc.name}`, {
                    action: decision.action
                });
                break;
                
            case "ai":
                // Get working memory for context if available
                let memory_context = "";
                if (correlation_id) {
                    const memory = get_working_memory(data_slot_number, correlation_id);
                    if (memory) {
                        // Filter memory for COMMUNICATE action from NPC's perspective
                        const npc_ref = `npc.${npc_hit.id}`;
                        const filtered = filter_memory_for_action(memory, "COMMUNICATE", npc_ref);
                        memory_context = format_filtered_memory(filtered);
                    }
                }
                
                // Build prompt with working memory context
                const prompt = build_npc_prompt(npc, original_text, perception.can_perceive, perception.clarity, memory_context);
                
                // Get session history
                const session_key = get_session_key(npc_hit.id, correlation_id);
                const history = get_session_history(session_key);
                
                const messages: OllamaMessage[] = [
                    { role: "system", content: "You are roleplaying as an NPC in a fantasy world. Stay in character." },
                    ...history,
                    { role: "user", content: prompt }
                ];
                
                try {
                    const ai_start = Date.now();
                    const response = await ollama_chat({
                        host: OLLAMA_HOST,
                        model: NPC_AI_MODEL,
                        messages,
                        keep_alive: NPC_AI_KEEP_ALIVE,
                        timeout_ms: NPC_AI_TIMEOUT_MS,
                        options: { temperature: NPC_AI_TEMPERATURE },
                    });
                    ai_duration_ms = Date.now() - ai_start;
                    
                    npc_response = response.content.trim();
                    decision_source = `AI (${decision.reason})`;
                    
                    // Log AI I/O
                    log_ai_io_terminal(
                        'interpreter',
                        `${npc.name} responding to: ${original_text.slice(0, 30)}...`,
                        npc_response,
                        ai_duration_ms,
                        session_key
                    );
                } catch (err) {
                    debug_error("NPC_AI", `AI call failed for ${npc.name}`, err);
                    // Fallback to template if available, otherwise generic
                    const fallback_template = findTemplate(String(npc.role || "villager"), "greeting", {
                        is_combat: false,
                        health_percent: 100
                    });
                    npc_response = fallback_template 
                        ? getTemplateResponse(fallback_template)
                        : "*nods silently*";
                    decision_source = "fallback (AI error)";
                }
                break;
        }
        
        // Store to session (for all response types)
        const session_key = get_session_key(npc_hit.id, correlation_id);
        append_session_turn(session_key, original_text, npc_response);
        
        // ===== PHASE 4: ADD TO CONVERSATION =====
        if (conversation) {
            const npc_ref = `npc.${npc_hit.id}`;
            
            // Add NPC to participants if not already there
            if (!conversation.participants.some(p => p.ref === npc_ref)) {
                // Participant added implicitly by add_message
            }
            
            // Add NPC response to conversation
            if (conversation_id) {
                add_message(
                    data_slot_number,
                    conversation_id,
                    npc_ref,
                    npc_response,
                    "neutral", // TODO: Detect emotional tone
                    decision.type === "scripted" ? decision.response.action : 
                    decision.type === "template" ? decision.action : "COMMUNICATE"
                );
            }
            
            // Check if we should summarize (every 10 messages)
            if (conversation.messages.length % 10 === 0 && conversation.messages.length > 0) {
                // Summarize asynchronously (don't block response)
                const npc_name = typeof (npc as any)?.name === "string" ? ((npc as any).name as string) : npc_hit.id;
                const personality_text = (() => {
                    const p = (npc as any)?.personality;
                    const json = p ? JSON.stringify(p) : "";
                    return typeof json === "string" && json.length > 0 ? json : "neutral";
                })();
                summarize_conversation_for_npc(data_slot_number, conversation, npc_hit.id, npc_name, personality_text).catch(err => {
                    debug_error("NPC_AI", "Failed to summarize conversation", { error: err });
                });
            }
        }
        
        // ===== PHASE 4: INCLUDE LONG-TERM MEMORY IN PROMPT =====
        // Get memories about the player
        const npc_mem_ref = `npc.${npc_hit.id}`;
        const memories = get_memories_about(data_slot_number, npc_mem_ref, player_ref, { limit: 3 });
        
        // Check if NPC remembers the player
        const knows_player = remembers_entity(data_slot_number, npc_mem_ref, player_ref);
        const relationship = get_relationship_status(data_slot_number, npc_mem_ref, player_ref);
        
        if (knows_player) {
            debug_pipeline("NPC_AI", `${npc.name} remembers player`, {
                relationship: relationship.status,
                memory_count: relationship.memory_count
            });
        }
        
        // Create response message with conversation threading
        const output: MessageInput = {
            sender: `npc.${npc_hit.id}`,
            content: npc_response,
            stage: "npc_response",
            status: "sent",
            reply_to: msg.id,
            correlation_id: correlation_id,
            // Inherit conversation from triggering message
            conversation_id: msg.conversation_id,
            turn_number: (msg.turn_number || 0) + 1,
            role: "npc",
            meta: {
                ...getSessionMeta(),
                npc_id: npc_hit.id,
                npc_name: npc.name,
                target_actor: actor_id,
                communication_context: original_text,
                is_direct_response: is_direct_target,
                perception_clarity: perception.clarity,
                decision_source: decision_source,
                available_actions: available_actions.slice(0, 3).map(a => a.verb),
            },
        };
        
        const response_msg = create_message(output);
        append_inbox_message(inbox_path, response_msg);

        // The canvas UI reads /api/log (log.jsonc), not inbox.jsonc.
        // Log NPC responses directly so they appear in the in-game window.
        append_log_envelope(log_path, response_msg);
        
        debug_pipeline("NPC_AI", `Created response from ${npc.name}`, {
            msg_id: response_msg.id,
            decision_source: decision_source,
            response_preview: npc_response.slice(0, 50)
        });
        
        // Mark as responded
        responded_npcs.add(npc_hit.id);
        
        // Log metric
        append_metric(data_slot_number, "npc_ai", {
            at: new Date().toISOString(),
            model: decision.type === "ai" ? NPC_AI_MODEL : "decision_hierarchy",
            ok: true,
            duration_ms: ai_duration_ms,
            stage: "npc_response",
            session: session_key,
        });
    }
}

// ===== PHASE 4: CONVERSATION SUMMARIZATION =====

async function summarize_conversation_for_npc(
    slot: number,
    conversation: import("../conversation_manager/archive.js").ConversationArchive,
    npc_id: string,
    npc_name: string,
    npc_personality: string
): Promise<void> {
    const npc_ref = `npc.${npc_id}`;
    
    // Import here to avoid circular dependencies
    const { summarize_for_npc } = await import("../conversation_manager/summarizer.js");
    const { add_conversation_memory } = await import("../npc_storage/memory.js");
    
    const summary = await summarize_for_npc(
        slot,
        conversation,
        npc_ref,
        npc_name,
        npc_personality
    );
    
    if (summary) {
        // Add to NPC's long-term memory
        const related_entities = conversation.participants
            .filter(p => p.ref !== npc_ref)
            .map(p => p.ref);
        
        add_conversation_memory(slot, npc_ref, summary, related_entities);
        
        debug_log("NPC_AI", `Added conversation memory for ${npc_name}`, {
            conversation_id: conversation.conversation_id,
            importance: summary.importance_score,
            emotion: summary.emotion
        });
    }
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        // Look for applied_* messages that contain COMMUNICATE events.
        // NOTE: renderer_ai may mark messages as processing/done quickly, so we must not rely on
        // seeing status="sent" here; instead use a meta flag to ensure idempotency.
        const candidates = outbox.messages.filter((m) => {
            if (!m.stage?.startsWith("applied_")) return false;
            if (!isCurrentSession(m)) return false;  // Only process messages from current session
            if ((m.meta as any)?.npc_processed === true) return false;
            // Accept sent/done/processing to avoid race with renderer_ai
            if (m.status !== "sent" && m.status !== "done" && m.status !== "processing") return false;
            
            // Check if it has COMMUNICATE-related events
            const events = (m.meta as any)?.events as string[] || [];
            const has_communicate = events.some(e => 
                e.includes("COMMUNICATE") || e.includes("SET_AWARENESS")
            );
            
            return has_communicate;
        });
        
        // Deduplicate by message ID to prevent processing same message multiple times
        const seen_ids = new Set<string>();
        const unique_candidates = candidates.filter(msg => {
            if (seen_ids.has(msg.id)) {
                return false;
            }
            seen_ids.add(msg.id);
            return true;
        });
        
        if (candidates.length > 0 && DEBUG_LEVEL >= 3) {
            const filtered_count = candidates.length - unique_candidates.length;
            debug_pipeline("NPC_AI", `Found ${unique_candidates.length} communication candidates${filtered_count > 0 ? ` (filtered ${filtered_count} duplicates)` : ""}`, {
                ids: unique_candidates.map(m => m.id)
            });
        }
        
        for (const msg of unique_candidates) {
            try {
                // Mark as processing to prevent duplicate handling (best-effort)
                const processing = try_set_message_status(msg, "processing");
                if (processing.ok) update_outbox_message(outbox_path, processing.message);
                
                await process_communication(outbox_path, inbox_path, log_path, msg);
                
                // Mark as npc_processed so we never handle this applied_* message twice.
                // Keep existing status if already done.
                const done = try_set_message_status(msg, "done");
                const final_msg = done.ok ? done.message : msg;
                final_msg.meta = { ...(final_msg.meta ?? {}), npc_processed: true };
                update_outbox_message(outbox_path, final_msg);
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

    // Clean up any duplicate messages from previous sessions
    const removed = remove_duplicate_messages(outbox_path);
    if (removed > 0) {
        debug_log("NPC_AI", `Cleaned ${removed} duplicate messages on startup`);
    }

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("NPC_AI: booted", { outbox_path, inbox_path, model: NPC_AI_MODEL });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

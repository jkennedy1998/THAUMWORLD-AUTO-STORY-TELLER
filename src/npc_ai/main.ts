import { get_data_slot_dir, get_log_path, get_inbox_path, get_outbox_path, get_npc_path, get_actor_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message, read_inbox, write_inbox } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, update_outbox_message, remove_duplicate_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_error, debug_pipeline, DEBUG_LEVEL, log_ai_io_terminal, log_ai_io_file } from "../shared/debug.js";
import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { append_metric } from "../engine/metrics_store.js";
import { find_npcs, load_npc, save_npc } from "../npc_storage/store.js";
import { get_npc_place_id, are_npcs_in_same_place, get_npc_location } from "../npc_storage/location.js";
import { load_actor } from "../actor_storage/store.js";
import { get_movement_state } from "./movement_state.js";
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
import { is_timed_event_active, get_timed_event_state, get_region_by_coords } from "../world_storage/store.js";
import { load_place } from "../place_storage/store.js";
import { consolidate_npc_memory_journal_if_needed, append_non_timed_conversation_journal } from "./timed_event_journal.js";

// Import witness system for real-time reactions
import { process_witness_communication } from "./witness_integration.js";
import { update_conversations } from "./witness_handler.js";

// Import movement command sender for Phase 8: Unified Movement Authority
import { send_wander_command } from "./movement_command_sender.js";
import { is_in_conversation } from "./conversation_state.js";

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

// Track which NPC journals have been consolidated for a given timed event
const consolidated_for_event = new Map<string, Set<string>>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Hierarchical Conversation Context Types
// Supports 5 verbatim turns + summary of older conversation
type ChatTurn = { 
    role: "user" | "assistant"; 
    content: string;
    speaker_ref: string;  // actor.<id> or npc.<id>
    timestamp: string;
};

type ConversationContext = {
    recent_turns: ChatTurn[];      // Last 5 verbatim turns
    summary: string;               // Condensed summary of older turns (AI-generated)
    total_turns: number;           // Track total for debugging
};

const npc_sessions = new Map<string, ConversationContext>();
const VERBATIM_LIMIT = 5;  // Keep 5 recent turns verbatim
const MERGE_BATCH = 3;     // Merge oldest 3 when exceeding limit

// Idle timeout summarization for non-timed conversations
// Timer starts only when player does non-communication actions (not COMMUNICATE)
const NPC_IDLE_SUMMARY_MS_RAW = Number(process.env.NPC_IDLE_SUMMARY_MS ?? 180_000);
const NPC_IDLE_SUMMARY_MS = Number.isFinite(NPC_IDLE_SUMMARY_MS_RAW) ? NPC_IDLE_SUMMARY_MS_RAW : 180_000;
const npc_idle_timers = new Map<string, NodeJS.Timeout>();

function clear_idle_timer(npc_id: string): void {
    const t = npc_idle_timers.get(npc_id);
    if (t) {
        clearTimeout(t);
        npc_idle_timers.delete(npc_id);
    }
}

function schedule_idle_summary(slot: number, npc_id: string, npc_name: string, conversation_id: string | null, session_key: string | null, region_label: string | null): void {
    clear_idle_timer(npc_id);
    const ref = `npc.${npc_id}`;
    const timer = setTimeout(() => {
        npc_idle_timers.delete(npc_id);
        
        // Get final conversation context before clearing
        const ctx = session_key ? npc_sessions.get(session_key) : null;
        const transcript = ctx 
            ? `Summary: ${ctx.summary}\nRecent: ${ctx.recent_turns.map(t => `${get_speaker_name(t.speaker_ref)}: ${t.content}`).join('\n')}`
            : "";
        
        void append_non_timed_conversation_journal(slot, ref, {
            region_label: region_label ?? undefined,
            conversation_id,
            transcript,
        });
        
        // Clear session to free memory
        if (session_key) {
            npc_sessions.delete(session_key);
            debug_log("NPC_AI", `Cleared conversation session for ${npc_name}`, { session_key });
        }
    }, NPC_IDLE_SUMMARY_MS);
    npc_idle_timers.set(npc_id, timer);
    debug_log("NPC_AI", `Scheduled idle memory summary for ${npc_name}`, { npc_id, ms: NPC_IDLE_SUMMARY_MS });
}

function get_session_key(npc_id: string, correlation_id: string): string {
    return `${npc_id}:${correlation_id}`;
}

function get_session_context(session_key: string): ConversationContext | undefined {
    return npc_sessions.get(session_key);
}

function get_session_history(session_key: string): ChatTurn[] {
    const ctx = npc_sessions.get(session_key);
    return ctx ? ctx.recent_turns : [];
}

async function append_session_turn(
    session_key: string, 
    user_text: string, 
    assistant_text: string,
    user_ref: string,
    npc_ref: string,
    npc_name: string,
    npc_personality: string
): Promise<void> {
    let ctx = npc_sessions.get(session_key);
    if (!ctx) {
        ctx = { recent_turns: [], summary: "", total_turns: 0 };
    }
    
    // Add new turns (user then assistant)
    const now = new Date().toISOString();
    ctx.recent_turns.push(
        { role: "user", content: user_text, speaker_ref: user_ref, timestamp: now },
        { role: "assistant", content: assistant_text, speaker_ref: npc_ref, timestamp: now }
    );
    ctx.total_turns += 2;
    
    // If we exceed verbatim limit, merge oldest batch into summary
    if (ctx.recent_turns.length > VERBATIM_LIMIT) {
        const to_merge = ctx.recent_turns.splice(0, MERGE_BATCH);
        
        // Generate AI summary of merged turns from NPC's perspective
        const merge_summary = await generate_turns_summary(
            to_merge, 
            npc_name, 
            npc_personality,
            ctx.summary
        );
        
        // Append to existing summary
        ctx.summary = ctx.summary 
            ? `${ctx.summary} ${merge_summary}`
            : merge_summary;
        
        // Truncate if gets too long (keep last 400 chars)
        if (ctx.summary.length > 400) {
            ctx.summary = ctx.summary.slice(-400);
        }
    }
    
    npc_sessions.set(session_key, ctx);
}

// Generate AI summary of conversation turns from NPC's perspective
async function generate_turns_summary(
    turns: ChatTurn[],
    npc_name: string,
    npc_personality: string,
    existing_summary: string
): Promise<string> {
    // Build conversation text
    const conversation_text = turns
        .map(t => `${get_speaker_name(t.speaker_ref)}: ${t.content}`)
        .join("\n");
    
    const prompt = `You are ${npc_name}. ${npc_personality ? `Personality: ${npc_personality}` : ""}

${existing_summary ? `Previous context: ${existing_summary}\n\nNew exchanges:` : "Summarize these exchanges from your perspective:"}

${conversation_text}

Provide a brief 1-sentence summary of what was discussed and how you feel about it. Focus on key facts and emotional reactions. Be concise.`;

    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: NPC_AI_MODEL,
            messages: [
                { role: "system", content: "You are an NPC summarizing a conversation from your perspective." },
                { role: "user", content: prompt }
            ],
            timeout_ms: 15000,
            options: { temperature: 0.7 },
        });
        
        return response.content.trim();
    } catch (err) {
        // Fallback to simple concatenation if AI fails
        return turns.map(t => t.content).join(" | ");
    }
}

// Resolve speaker ref to actual name
function get_speaker_name(speaker_ref: string): string {
    // Handle npc.<id>
    if (speaker_ref.startsWith("npc.")) {
        const npc_id = speaker_ref.slice(4);
        const result = load_npc(data_slot_number, npc_id);
        if (result.ok && result.npc.name) {
            return String(result.npc.name);
        }
        return npc_id;
    }
    
    // Handle actor.<id>
    if (speaker_ref.startsWith("actor.")) {
        const actor_id = speaker_ref.slice(6);
        const result = load_actor(data_slot_number, actor_id);
        if (result.ok && result.actor.name) {
            return String(result.actor.name);
        }
        return actor_id;
    }
    
    return speaker_ref;
}

// Build conversation context for prompt with hierarchical structure
function build_conversation_context(session_key: string): string {
    const ctx = npc_sessions.get(session_key);
    if (!ctx) return "";
    
    const parts: string[] = [];
    
    // Add summary if exists
    if (ctx.summary) {
        parts.push(`SUMMARY: ${ctx.summary}`);
    }
    
    // Add verbatim recent turns with speaker names
    if (ctx.recent_turns.length > 0) {
        parts.push("RECENT:");
        for (const turn of ctx.recent_turns) {
            const speaker_name = get_speaker_name(turn.speaker_ref);
            parts.push(`${speaker_name}: ${turn.content}`);
        }
    }
    
    return parts.join("\n");
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
    const archetype = (() => {
        const role = typeof npc.role === "string" ? npc.role : "";
        if (role) return role;
        const title = typeof npc.title === "string" ? npc.title.toLowerCase() : "";
        const goal = typeof npc.personality?.story_goal === "string" ? npc.personality.story_goal.toLowerCase() : "";
        if (title.includes("elder") || goal.includes("protect") || goal.includes("knowledge")) return "elder";
        if (title.includes("shop") || title.includes("shopkeep")) return "shopkeeper";
        return "villager";
    })();
    const detected_situation = detectSituation(player_text);

    // If the player is asking an open-ended/identity/goals question directly, prefer AI over templates.
    // Templates are good for quick flavor, but this style of question should reflect personality + memory.
    const lowered = player_text.toLowerCase();
    const is_big_question = situation.is_direct_target && detected_situation === "question" && (
        lowered.includes("goal") ||
        lowered.includes("remember") ||
        lowered.includes("world") ||
        lowered.includes("why") ||
        lowered.includes("who are") ||
        lowered.includes("what are you")
    );
    if (is_big_question) {
        return { type: "ai", reason: "Direct open-ended question" };
    }
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
// TODO: Inject random local and world lore based on incoming action, target, and location
// through the smart injector system. This will help keep the world THAUMWORLD-oriented.
// TODO: Include perception notes into NPC AI with culling events to their senses
function build_npc_prompt(npc: any, player_text: string, can_perceive: boolean, memory_context?: string, player_location?: string, npc_location?: string): string {
    const personality = npc.personality || {};
    const appearance = npc.appearance || {};
    
    let prompt_parts: string[] = [];
    
    // Identity (always included, compact)
    prompt_parts.push(`You are ${npc.name}${npc.title ? `, ${npc.title}` : ''}.`);
    
    // Role/Goal (only if defined and not generic)
    if (personality.story_goal && npc.role !== 'villager') {
        prompt_parts.push(`Goal: ${personality.story_goal}`);
    }
    
    // Personality traits (smart injection - only relevant ones)
    const relevant_traits = get_relevant_personality_traits(player_text, personality);
    if (relevant_traits.length > 0) {
        prompt_parts.push(`Traits: ${relevant_traits.join(', ')}`);
    }
    
    // Appearance if notable and player can see them clearly
    if (appearance.distinguishing_features && can_perceive) {
        prompt_parts.push(`Features: ${appearance.distinguishing_features}`);
    }
    
    // Memory context with tight culling and random outside memories
    if (memory_context && memory_context.length > 0) {
        prompt_parts.push(`\n${memory_context}`);
    }

    // Location context (condensed)
    if (npc_location && player_location) {
        if (npc_location !== player_location) {
            prompt_parts.push(`\nYou are in ${npc_location}; they claim to be in ${player_location}.`);
        }
    }
    
    // Smart perception injection - only when cannot perceive
    // Perception is place-based only: same place = can perceive, different place = cannot
    if (!can_perceive) {
        prompt_parts.push(`\nYou sense someone nearby but cannot perceive them clearly.`);
    }
    
    // Compact response instruction (consolidated from 7 lines to 2)
    prompt_parts.push(`\n"${player_text}" — Reply in character as ${npc.name}, 1-2 sentences. Stay in world; never break character or mention game mechanics.`);
    
    return prompt_parts.join("\n");
}

// Get personality traits relevant to the player's input
function get_relevant_personality_traits(player_text: string, personality: any): string[] {
    const traits: string[] = [];
    const text_lower = player_text.toLowerCase();
    
    // Check for trigger matches
    if (personality.happy_triggers && text_lower.includes(personality.happy_triggers.toLowerCase())) {
        traits.push(`happy about: ${personality.happy_triggers}`);
    }
    if (personality.angry_triggers && text_lower.includes(personality.angry_triggers.toLowerCase())) {
        traits.push(`angered by: ${personality.angry_triggers}`);
    }
    if (personality.sad_triggers && text_lower.includes(personality.sad_triggers.toLowerCase())) {
        traits.push(`saddened by: ${personality.sad_triggers}`);
    }
    
    // Include core traits only if they might affect response
    if (personality.fear && (text_lower.includes('fear') || text_lower.includes('scare') || text_lower.includes('afraid'))) {
        traits.push(`fear: ${personality.fear}`);
    }
    if (personality.passion && (text_lower.includes(personality.passion.toLowerCase()) || Math.random() < 0.3)) {
        traits.push(`passion: ${personality.passion}`);
    }
    
    return traits;
}

// Check if NPC can perceive the player
// Simplified: Place-based perception only - same place = can perceive, different place = cannot
function can_npc_perceive_player(npc: any, player_location: any, player_ref: string): { can_perceive: boolean } {
    // Get place-aware locations
    const npc_place_id = get_npc_place_id(npc);
    const player_place_id = player_location?.place_id;
    
    debug_log("NPC_AI", `Perception check - npc_place: ${npc_place_id}, player_place: ${player_place_id}`);
    
    // Place System: Check if both in same place
    if (npc_place_id && player_place_id) {
        const can_perceive = npc_place_id === player_place_id;
        debug_log("NPC_AI", `Place-based perception: ${can_perceive}`);
        return { can_perceive };
    }
    
    // Legacy fallback: Region-based checking for NPCs without place_id
    const npc_region = npc.location?.region_tile;
    const player_region = player_location?.region_tile;
    
    if (!npc_region || !player_region) {
        debug_log("NPC_AI", `Missing region data - cannot perceive`);
        return { can_perceive: false };
    }
    
    const same_region = (
        npc_region.x === player_region.x && 
        npc_region.y === player_region.y
    );
    
    debug_log("NPC_AI", `Region-based perception: ${same_region}`);
    return { can_perceive: same_region };
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
    // Support both old format (meta.original_text + meta.machine_text) 
    // and new format (content + meta.intent_verb from ActionPipeline)
    const meta = msg.meta as any;
    let original_text = meta?.original_text as string || "";
    let machine_text = meta?.machine_text as string || "";
    const events = meta?.events as string[] || [];
    
    // NEW: Handle direct COMMUNICATE messages from ActionPipeline
    // These have meta.intent_verb === "COMMUNICATE" and content in msg.content
    if (meta?.intent_verb === "COMMUNICATE" && !original_text) {
        original_text = msg.content || "";
        // Build machine_text from sender and target info
        const sender_actor = msg.sender?.startsWith("actor.") ? msg.sender.replace("actor.", "") : msg.sender;
        const target_npc = meta?.target_ref;
        if (sender_actor) {
            machine_text = `actor.${sender_actor}.COMMUNICATE(target=${target_npc || "broadcast"})`;
        }
    }
    
    // Find COMMUNICATE events to identify targets
    const communicate_events = events.filter(e => e.includes("COMMUNICATE"));
    
    // Also accept messages with intent_verb === "COMMUNICATE" even if no events
    const has_communicate = communicate_events.length > 0 || meta?.intent_verb === "COMMUNICATE";
    
    if (!has_communicate) {
        debug_pipeline("NPC_AI", "No COMMUNICATE events found", { id: msg.id });
        return;
    }
    
    // Get player actor info
    const correlation_id = msg.correlation_id ?? msg.id;
    
    // Find the player actor from the communication
    // First try machine text, then fall back to sender
    let actor_match = machine_text.match(/actor\.(\w+)\.COMMUNICATE/);
    let actor_id: string | null = null;
    
    if (actor_match && actor_match[1]) {
        actor_id = actor_match[1];
    } else if (msg.sender?.startsWith("actor.")) {
        // Extract from sender field
        actor_id = msg.sender.replace("actor.", "");
    } else if (msg.sender && !msg.sender.includes(".")) {
        // Assume sender is just the actor ID
        actor_id = msg.sender;
    }
    
    if (!actor_id) {
        debug_error("NPC_AI", "Could not identify actor from message", { 
            machine_text, 
            sender: msg.sender,
            id: msg.id 
        });
        return;
    }
    
    const actor_result = load_actor(data_slot_number, actor_id);
    
    if (!actor_result.ok) {
        debug_error("NPC_AI", `Failed to load actor ${actor_id}`, actor_result);
        return;
    }
    
    const player_location = actor_result.actor.location as { 
        region_tile?: { x: number; y: number }; 
        tile?: { x: number; y: number };
        place_id?: string;  // Added for Place System
    };
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
    
    // Parse targets from machine text or meta.target_ref
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
    
    // NEW: Also check meta.target_ref for direct target (from ActionPipeline)
    const meta_target = (msg.meta as any)?.target_ref as string;
    if (meta_target?.startsWith("npc.")) {
        const npc_id = meta_target.replace("npc.", "");
        if (!direct_targets.includes(npc_id)) {
            direct_targets.push(npc_id);
        }
    }
    
    // Find all NPCs - filter by place first, then region for backward compatibility
    const all_npcs = find_npcs(data_slot_number, {});
    
    // Get player's place_id if available (Place System)
    const player_place_id = player_location?.place_id;
    
    const nearby_npcs = all_npcs.filter(npc_hit => {
        if (npc_hit.id === "default_npc") return false;
        const npc_result = load_npc(data_slot_number, npc_hit.id);
        if (!npc_result.ok) {
            debug_log("NPC_AI", `Failed to load NPC ${npc_hit.id}`);
            return false;
        }
        
        const npc = npc_result.npc;
        
        // Place System: Filter by place_id if available
        const npc_place_id = get_npc_place_id(npc);
        
        debug_log("NPC_AI", `Checking NPC ${npc_hit.id} - player_place: ${player_place_id}, npc_place: ${npc_place_id}`);
        
        if (player_place_id && npc_place_id) {
            // Both have place_id - must be in same place
            const same_place = npc_place_id === player_place_id;
            if (!same_place) {
                debug_pipeline("NPC_AI", `NPC ${npc_hit.id} in different place, skipping`, {
                    npc_place: npc_place_id,
                    player_place: player_place_id
                });
            } else {
                debug_log("NPC_AI", `NPC ${npc_hit.id} is in same place!`);
            }
            return same_place;
        }
        
        // Legacy fallback: Region-based filtering
        const npc_region = (npc as any).location?.region_tile;
        const player_region = player_location?.region_tile;
        
        if (!npc_region || !player_region) {
            debug_log("NPC_AI", `NPC ${npc_hit.id} or player missing region data`);
            return false;
        }
        
        const same_region = npc_region.x === player_region.x && npc_region.y === player_region.y;
        if (same_region && player_place_id && !npc_place_id) {
            debug_pipeline("NPC_AI", `NPC ${npc_hit.id} in same region but no place_id (needs migration)`, {
                region: player_region
            });
        }
        
        if (same_region) {
            debug_log("NPC_AI", `NPC ${npc_hit.id} is in same region (legacy mode)`);
        }
        
        return same_region;
    });
    
    debug_pipeline("NPC_AI", `Found ${nearby_npcs.length} NPCs nearby`, {
        region: player_location?.region_tile,
        place: player_place_id,
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

        // If a timed event is active and this NPC is being engaged, consolidate its memory journal before the conversation continues.
        if (is_direct_target && is_timed_event_active(data_slot_number)) {
            const store = get_timed_event_state(data_slot_number);
            const event_id = typeof store?.timed_event_id === "string" ? store.timed_event_id : "";
            if (event_id) {
                const set = consolidated_for_event.get(event_id) ?? new Set<string>();
                if (!set.has(npc_hit.id)) {
                    set.add(npc_hit.id);
                    consolidated_for_event.set(event_id, set);
                    clear_idle_timer(npc_hit.id);
                    void consolidate_npc_memory_journal_if_needed(data_slot_number, `npc.${npc_hit.id}`);
                }
            }
        }
        
        // Check if NPC should respond
        const should_respond = should_npc_respond(npc, is_direct_target);
        debug_log("NPC_AI", `should_npc_respond for ${npc_hit.id}: ${should_respond}, is_direct_target: ${is_direct_target}`);
        if (!should_respond) {
            continue;
        }
        
        // Check perception using AWARENESS tags (per THAUMWORLD rules)
        const player_ref = `actor.${actor_id}`;
        const perception = can_npc_perceive_player(npc, player_location, player_ref);
        debug_log("NPC_AI", `can_npc_perceive_player for ${npc_hit.id}: ${perception.can_perceive}, player_place: ${player_location?.place_id}`);
        
        if (!perception.can_perceive && !is_direct_target) {
            // Can't perceive and not directly addressed - skip
            debug_log("NPC_AI", `Skipping ${npc_hit.id} - can't perceive and not direct target`);
            continue;
        }
        
        // Mark as responded IMMEDIATELY to prevent duplicate processing in rapid ticks
        responded_npcs.add(npc_hit.id);
        
        // ===== WITNESS SYSTEM INTEGRATION =====
        // Trigger real-time reaction through witness system
        // Distance is 0 since they're in the same place
        process_witness_communication(
            `npc.${npc_hit.id}`,
            player_ref,
            original_text,
            is_direct_target,
            0  // Same place = effectively 0 distance
        );
        
        debug_pipeline("NPC_AI", `Generating response for ${npc.name}`, {
            npc_id: npc_hit.id,
            is_direct_target,
            can_perceive: perception.can_perceive
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
                // Build hierarchical conversation context
                let memory_context = "";
                if (correlation_id) {
                    // Get conversation context from session (hierarchical: summary + recent turns)
                    const session_key = get_session_key(npc_hit.id, correlation_id);
                    const conversation_ctx = build_conversation_context(session_key);
                    
                    // Get random outside memories for variance
                    const npc_mem_ref = `npc.${npc_hit.id}`;
                    const all_memories = get_memories_about(data_slot_number, npc_mem_ref, player_ref, { limit: 10 });
                    const outside_memories = all_memories.filter((m: any) => {
                        // Filter out memories that are part of current conversation
                        const is_current_conv = m.conversation_id === conversation_id;
                        return !is_current_conv;
                    });
                    
                    // Pick 1-2 random outside memories for variety
                    const shuffled = outside_memories.sort(() => Math.random() - 0.5);
                    const selected_random = shuffled.slice(0, Math.min(2, shuffled.length));
                    
                    // Build memory context: conversation history + random outside memories
                    const memory_parts: string[] = [];
                    if (conversation_ctx) {
                        memory_parts.push(conversation_ctx);
                    }
                    if (selected_random.length > 0) {
                        const random_text = selected_random.map((m: any) => m.summary).join('; ');
                        memory_parts.push(`\nRecall: ${random_text}`);
                    }
                    
                    memory_context = memory_parts.join('\n');
                }
                
                // Get location names for context
                const npc_place_id = get_npc_place_id(npc);
                let npc_location_name = "unknown";
                let player_location_name = "unknown";
                
                if (npc_place_id) {
                    const placeResult = load_place(data_slot_number, npc_place_id);
                    if (placeResult.ok) {
                        npc_location_name = placeResult.place.name || npc_place_id;
                    }
                }
                
                const player_place_id = player_location?.place_id;
                if (player_place_id) {
                    const placeResult = load_place(data_slot_number, player_place_id);
                    if (placeResult.ok) {
                        player_location_name = placeResult.place.name || player_place_id;
                    }
                }
                
                // Build prompt with working memory context and location awareness
                const prompt = build_npc_prompt(npc, original_text, perception.can_perceive, memory_context, player_location_name, npc_location_name);
                
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
        const npc_ref = `npc.${npc_hit.id}`;
        const npc_name = typeof (npc as any).name === "string" ? ((npc as any).name as string) : npc_hit.id;
        const npc_personality = (npc as any).personality ? JSON.stringify((npc as any).personality) : "";
        await append_session_turn(session_key, original_text, npc_response, player_ref, npc_ref, npc_name, npc_personality);

        // Track this actor's active session for idle timer management
        // Timer will only start when player does a non-communication action
        actor_sessions.set(player_ref, session_key);
        
        // Note: Idle timer is NOT scheduled here - it starts only on non-communication actions
        // This allows conversations to continue indefinitely until player does something else
        
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
                can_perceive: perception.can_perceive,
                decision_source: decision_source,
                available_actions: available_actions.slice(0, 3).map(a => a.verb),
            },
        };
        
        const response_msg = create_message(output);
        append_inbox_message(inbox_path, response_msg);

        // Note: Breath function reads inbox and calls displayMessageToUser() 
        // which writes to log. Don't write directly to log here to avoid duplicates.

        // Persist conversation context to NPC memory_sheet
        // Stores hierarchical conversation threads (summary + recent turns) for continuity
        try {
            const npc_sheet = load_npc(data_slot_number, npc_hit.id);
            if (npc_sheet.ok) {
                const npc_obj = npc_sheet.npc as Record<string, unknown>;
                const mem = (npc_obj.memory_sheet as Record<string, unknown>) ?? {};
                
                // Get current conversation context from session
                const session_key = get_session_key(npc_hit.id, correlation_id);
                const ctx = npc_sessions.get(session_key);
                
                if (ctx) {
                    // Build conversation thread entry
                    const thread_entry: Record<string, unknown> = {
                        at: new Date().toISOString(),
                        type: "conversation_thread",
                        with: player_ref,
                        summary: ctx.summary.slice(0, 200),  // Keep summary compact
                        recent_turns: ctx.recent_turns.slice(-3).map(t => ({  // Store last 3 turns
                            speaker: t.speaker_ref,
                            text: t.content.slice(0, 100)  // Truncate for storage
                        })),
                        total_exchanges: ctx.total_turns
                    };
                    
                    // Maintain conversation_threads array (keep last 5 active threads)
                    const threads = Array.isArray(mem.conversation_threads) 
                        ? mem.conversation_threads as Record<string, unknown>[]
                        : [];
                    
                    // Update existing thread for this player or add new
                    const existing_idx = threads.findIndex((t: any) => t.with === player_ref);
                    if (existing_idx >= 0) {
                        threads[existing_idx] = thread_entry;
                    } else {
                        threads.push(thread_entry);
                    }
                    
                    // Keep only last 5 threads to prevent bloat
                    mem.conversation_threads = threads.slice(-5);
                }
                
                // Update known actors
                const known = Array.isArray(mem.known_actors) ? (mem.known_actors as string[]) : [];
                if (!known.includes(player_ref)) known.unshift(player_ref);
                mem.known_actors = known.slice(0, 20);

                npc_obj.memory_sheet = mem;
                save_npc(data_slot_number, npc_hit.id, npc_obj);
            }
        } catch {
            // ignore
        }
        
        debug_pipeline("NPC_AI", `Created response from ${npc.name}`, {
            msg_id: response_msg.id,
            decision_source: decision_source,
            response_preview: npc_response.slice(0, 50)
        });
        
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

// Track which actor is in which conversation session
const actor_sessions = new Map<string, string>(); // actor_ref -> session_key

// Handle non-communication actions - triggers idle timer for active conversations
async function process_non_communication_action(
    msg: MessageEnvelope
): Promise<void> {
    const events = (msg.meta as any)?.events as string[] || [];
    const machine_text = (msg.meta as any)?.machine_text as string || "";
    
    // Find non-COMMUNICATE events
    const non_comm_events = events.filter(e => {
        const action_match = e.match(/actor\.\w+\.(\w+)/);
        if (!action_match) return false;
        const action = action_match[1];
        return action && action !== "COMMUNICATE";
    });
    
    if (non_comm_events.length === 0) return;
    
    // Extract actor from machine text
    const actor_match = machine_text.match(/actor\.(\w+)\.\w+/);
    if (!actor_match || !actor_match[1]) return;
    
    const actor_id = actor_match[1];
    const actor_ref = `actor.${actor_id}`;
    
    // Check if this actor has active conversation sessions
    const session_key = actor_sessions.get(actor_ref);
    if (!session_key) return;
    
    // Extract NPC ID from session key (format: "npc_id:correlation_id")
    const npc_id = session_key.split(":")[0];
    if (!npc_id) return;
    
    debug_log("NPC_AI", `Non-communication action detected, scheduling idle timer for ${npc_id}`, {
        actor: actor_ref,
        action: non_comm_events[0],
        session_key
    });
    
    // Load NPC to get name and location
    const npc_result = load_npc(data_slot_number, npc_id);
    if (!npc_result.ok) return;
    
    const npc = npc_result.npc;
    const npc_name = typeof (npc as any).name === "string" ? ((npc as any).name as string) : npc_id;
    
    // Get region label
    const region_label = (() => {
        const loc = (npc as any)?.location;
        const wx = Number(loc?.world_tile?.x ?? 0);
        const wy = Number(loc?.world_tile?.y ?? 0);
        const rx = Number(loc?.region_tile?.x ?? 0);
        const ry = Number(loc?.region_tile?.y ?? 0);
        const region = get_region_by_coords(data_slot_number, wx, wy, rx, ry);
        return region.ok ? (String((region.region as any)?.name ?? "") || region.region_id) : null;
    })();
    
    // Schedule idle timer
    schedule_idle_summary(data_slot_number, npc_id, npc_name, null, session_key, region_label);
    
    // Remove from tracking
    actor_sessions.delete(actor_ref);
}

/**
 * Phase 8: Unified Movement Authority
 * 
 * Backend decides when NPCs should wander and sends commands to renderer.
 * This function runs every tick to manage NPC movement decisions.
 * 
 * Rules:
 * - NPCs in conversation: DO NOT wander
 * - NPCs already moving: DO NOT start new wandering  
 * - NPCs idle for > 5 seconds: Send wander command
 * - Minimum 8 seconds between wander commands to prevent snapping
 */
const npc_last_movement_decision = new Map<string, number>();
const npc_last_wander_time = new Map<string, number>();
const WANDER_CHECK_INTERVAL_MS = 1000; // Check every 1 second
const MIN_IDLE_BEFORE_WANDER_MS = 2000; // Must be idle for 2 seconds before wandering
const MIN_TIME_BETWEEN_WANDERS_MS = 8000; // Minimum 8 seconds between wander commands

// Track all active NPC refs that need wandering
const active_npc_refs = new Set<string>();

async function process_npc_movement_decisions(): Promise<void> {
    try {
        const now = Date.now();
        
        // Get player's location to filter NPCs by place
        // Only generate movement commands for NPCs in the same place as the player
        // This prevents log spam from commands for NPCs the player can't see
        const player_actor_result = load_actor(data_slot_number, "henry_actor");
        const player_place_id = player_actor_result.ok 
            ? (player_actor_result.actor as any)?.location?.place_id 
            : null;
        
        if (!player_place_id) {
            // No player location available, skip movement decisions
            return;
        }
        
        // Get all NPCs from storage to find active ones
        const all_npcs = find_npcs(data_slot_number, {});
        
        // Add all NPCs to active tracking
        for (const npc of all_npcs) {
            const npc_ref = `npc.${npc.id}`;
            active_npc_refs.add(npc_ref);
        }
        
        // Process all active NPCs
        for (const npc_ref of active_npc_refs) {
            const last_check = npc_last_movement_decision.get(npc_ref) || 0;
            
            // Only check every WANDER_CHECK_INTERVAL_MS
            if (now - last_check < WANDER_CHECK_INTERVAL_MS) {
                continue;
            }
            
            npc_last_movement_decision.set(npc_ref, now);
            
            // Filter: Only send commands for NPCs in the same place as the player
            // This prevents generating commands for NPCs the player can't see
            const npc_id = npc_ref.replace("npc.", "");
            const npc_result = load_npc(data_slot_number, npc_id);
            if (!npc_result.ok) continue;
            
            const npc_place_id = get_npc_place_id(npc_result.npc);
            if (npc_place_id !== player_place_id) {
                // NPC is not in the player's place - skip silently (no log spam)
                continue;
            }
            
            // Skip if in conversation (check both in-memory state and place data)
            const in_conv = is_in_conversation(npc_ref);
            
            // Also check place data for "busy" status (set by witness handler in Interface Program)
            let npc_status_in_place: string | undefined;
            if (npc_place_id) {
                const place_result = load_place(data_slot_number, npc_place_id);
                if (place_result.ok && place_result.place) {
                    const npc_in_place = place_result.place.contents.npcs_present.find(
                        (n: any) => n.npc_ref === npc_ref
                    );
                    npc_status_in_place = npc_in_place?.status;
                }
            }
            
            const is_busy_in_place = npc_status_in_place === "busy";
            
            console.log(`[NPC_AI] ${npc_ref} in conversation: ${in_conv}, place status: ${npc_status_in_place}, busy: ${is_busy_in_place}`);
            
            if (in_conv || is_busy_in_place) {
                console.log(`[NPC_AI] ${npc_ref} skipping wander - in conversation or busy`);
                continue;
            }
            
            // Check if NPC is already moving (prevents redundant commands)
            const movement_state = get_movement_state(npc_ref);
            if (movement_state?.is_moving) {
                continue;
            }
            
            // Check when we last sent a wander command
            const last_wander = npc_last_wander_time.get(npc_ref) || 0;
            const time_since_last_wander = now - last_wander;
            
            // Must wait minimum time between wander commands to prevent snapping
            if (time_since_last_wander < MIN_TIME_BETWEEN_WANDERS_MS) {
                continue;
            }
            
            // Record this wander command
            npc_last_wander_time.set(npc_ref, now);
            
            // Send wander command
            send_wander_command(
                npc_ref,
                "Idle wandering - no conversation active",
                3, // Normal intensity
                6  // Normal range
            );
        }
    } catch (err) {
        debug_error("NPC_AI", "process_npc_movement_decisions failed", err);
    }
}

/**
 * Process NPC position updates from inbox
 * Renderer sends these when NPCs complete movement
 */
async function process_npc_position_updates(inbox_path: string): Promise<void> {
    try {
        const inbox = read_inbox(inbox_path);
        const position_updates = inbox.messages.filter((msg: any) => 
            msg.type === "npc_position_update" && 
            !msg.meta?.position_processed
        );
        
        for (const msg of position_updates) {
            try {
                const update = JSON.parse(msg.content) as {
                    npc_ref: string;
                    position: { x: number; y: number };
                    place_id: string;
                };
                
                const npc_id = update.npc_ref.replace("npc.", "");
                
                // Validate position - reject (0,0) which indicates a bug
                if (update.position.x === 0 && update.position.y === 0) {
                    debug_log("NPC_AI", `REJECTED invalid position (0,0) for ${update.npc_ref} - not saving`);
                    // Mark as processed to avoid retry loop
                    msg.meta = { ...(msg.meta || {}), position_processed: true, rejected: true, reason: "zero_position" };
                    continue;
                }
                
                // Load NPC from storage
                const npc_result = load_npc(data_slot_number, npc_id);
                if (!npc_result.ok) {
                    debug_log("NPC_AI", `Cannot save position for ${update.npc_ref} - NPC not found`);
                    continue;
                }
                
                const npc = npc_result.npc as Record<string, any>;
                
                // Get current position for logging
                const old_pos = npc.location?.tile;
                
                // Update location
                if (!npc.location) {
                    npc.location = {};
                }
                npc.location.tile = {
                    x: update.position.x,
                    y: update.position.y
                };
                npc.location.place_id = update.place_id;
                
                // Save to storage
                save_npc(data_slot_number, npc_id, npc);
                
                debug_log("NPC_AI", `Saved position for ${update.npc_ref}`, {
                    x: update.position.x,
                    y: update.position.y,
                    place_id: update.place_id,
                    moved_from: old_pos ? `(${old_pos.x}, ${old_pos.y})` : "(unknown)"
                });
                
                // Mark as processed
                msg.meta = { ...(msg.meta || {}), position_processed: true };
                
            } catch (err) {
                debug_error("NPC_AI", "Failed to process position update", err);
            }
        }
        
        // Write updated inbox back
        if (position_updates.length > 0) {
            write_inbox(inbox_path, inbox);
        }
        
    } catch (err) {
        debug_error("NPC_AI", "process_npc_position_updates failed", err);
    }
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        // First, process position updates from renderer
        await process_npc_position_updates(inbox_path);
        
        // Drain outbox for messages that need NPC responses
        const outbox = read_outbox(outbox_path);
        const messages = outbox.messages;
        
        debug_log("NPC_AI", `Tick started - checking ${messages.length} messages`);
        
        // Process non-communication actions first (triggers idle timers)
        for (const msg of messages) {
            const msg_any = msg as any;
            if (msg_any.meta?.npc_processed) continue;
            const meta = msg_any.meta;
            if (meta?.events?.some((e: string) => !e.includes("COMMUNICATE") && e.includes("actor."))) {
                await process_non_communication_action(msg);
            }
        }
        
        // Filter to messages that need NPC responses
        const candidates = messages.filter((msg: any) => {
            // Skip if already processed by NPC AI
            if (msg.meta?.npc_processed) {
                // Only log at debug level 4+ to avoid spam
                if (DEBUG_LEVEL >= 4) {
                    debug_log("NPC_AI", `Skipping message ${msg.id} - already npc_processed`);
                }
                return false;
            }
            
            // Process messages that are ready for NPC response generation:
            // - "applied" messages (processed by state_applier)
            // - "done" messages that haven't been npc_processed yet
            // - "sent" messages with COMMUNICATE intent (direct from ActionPipeline)
            const is_ready = msg.status === "applied" || msg.status === "applied_1" || msg.status === "applied_2" || 
                            (msg.status === "done" && !msg.meta?.npc_processed) ||
                            (msg.status === "sent" && (msg.meta as any)?.intent_verb === "COMMUNICATE");
            if (!is_ready) {
                // Only log at debug level 4+ to avoid spam - most messages aren't ready for NPC processing
                if (DEBUG_LEVEL >= 4) {
                    debug_log("NPC_AI", `Skipping message ${msg.id} - status ${msg.status} not ready`);
                }
                return false;
            }
            
            // Check if message has communication context
            const meta = msg.meta;
            const has_communicate_context = 
                meta?.original_text || 
                meta?.events?.some((e: string) => e.includes("COMMUNICATE")) ||
                (meta as any)?.intent_verb === "COMMUNICATE";
            if (!has_communicate_context) {
                // Only log at debug level 4+ to avoid spam
                if (DEBUG_LEVEL >= 4) {
                    debug_log("NPC_AI", `Skipping message ${msg.id} - no communication context`);
                }
                return false;
            }
            
            debug_log("NPC_AI", `Found candidate message ${msg.id} - status: ${msg.status}`);
            return true;
        });
        
        // Deduplicate by message ID to prevent processing same message multiple times
        const seen_ids = new Set<string>();
        const unique_candidates = candidates.filter((msg: any) => {
            if (seen_ids.has(msg.id)) {
                return false;
            }
            seen_ids.add(msg.id);
            return true;
        });
        
        if (candidates.length > 0 && DEBUG_LEVEL >= 3) {
            const filtered_count = candidates.length - unique_candidates.length;
            debug_pipeline("NPC_AI", `Found ${unique_candidates.length} communication candidates${filtered_count > 0 ? ` (filtered ${filtered_count} duplicates)` : ""}`, {
                ids: unique_candidates.map((m: any) => m.id)
            });
        }
        
        for (const msg of unique_candidates) {
            try {
                // Skip if already being processed by another tick
                if (msg.status === "processing") {
                    debug_pipeline("NPC_AI", `Skipping message already being processed`, { id: msg.id });
                    continue;
                }
                
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
        
        // Note: Conversation responses are now handled entirely through process_communication()
        // which is called above for all applied_COMMUNICATE messages.
        // The witness system triggers real-time reactions via process_witness_communication()
        // which sets up engagement state, but actual LLM responses come through process_communication().
        
        // Check for conversation timeouts and clean up ended conversations
        update_conversations();
        
        // Phase 8: Unified Movement Authority
        // Backend decides when NPCs should wander and sends commands to renderer
        // This runs every tick to ensure continuous wandering behavior
        await process_npc_movement_decisions();
        
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

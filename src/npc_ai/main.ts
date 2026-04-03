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
import { build_dialogue_prompt_context } from "../context_manager/prompt_context/dialogue_context.js";
import { findTemplate, detectSituation, type ConversationContinuityState, type NPCTemplate } from "./template_db.js";
import { get_fallback_dialogue } from "./fallback_dialogue.js";
import { getAvailableActions, buildNPCState, type AvailableAction } from "./action_selector.js";
import { applySway, applySwayToActions, createSwayFromCommunication, getActiveSway, describeSwayEffects } from "./sway_system.js";
import { start_conversation, add_message, end_conversation, get_conversation } from "../conversation_manager/archive.js";
import { add_session_observers, admit_speakers_for_event, append_conversation_session_message, build_queue_transport_context, build_speech_turn_context, create_communication_event, create_listener_decision, ensure_conversation_session, get_next_session_queue_entry, get_session_queue_entry, get_session_queue_entry_ids, mark_communication_event_evaluated, mark_conversation_session_cooling, mark_queue_entry_status, mark_queue_entry_status_by_id, mark_session_participant_left, mark_session_participant_rejoined, mark_session_targets_addressed, resolve_conversation_session_id, set_conversation_session_summary, set_participant_memory_factoids, update_conversation_session_lifecycle } from "../conversation_manager/session_state.js";
import { format_for_ai } from "../conversation_manager/formatter.js";
import { summarize_for_npc, get_important_memories } from "../conversation_manager/summarizer.js";
import { get_memories_about, remembers_entity, get_relationship_status, add_conversation_memory, get_formatted_memories } from "../npc_storage/memory.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { cancel_pending_communication_opportunity, complete_pending_communication_opportunity, get_active_actor_ref, get_timed_event_state, get_region_by_coords, is_timed_event_active, mark_actor_done, release_pending_communication_opportunity, sync_pending_communication_opportunities_with_queue } from "../world_storage/store.js";
import { load_place, save_place } from "../place_storage/store.js";
import { consolidate_npc_memory_journal_if_needed, append_non_timed_conversation_journal } from "./timed_event_journal.js";
import {
    build_npc_dialogue_prompts,
    build_turn_summary_prompts,
} from "./prompts.js";

import { project_witness_state_for_conversation, update_conversations } from "./witness_handler.js";

// Import engagement service for conversation management
import { updateEngagement, initEngagementService } from "./engagement_service.js";

// Import movement command sender for Phase 8: Unified Movement Authority
import { send_wander_command, send_sense_broadcast_command } from "./movement_command_sender.js";
import { is_in_conversation_presence } from "../shared/conversation_presence_store.js";
import { resolve_npc_behavior } from "./behavior.js";
import { get_configured_data_slot } from "../shared/boot_env.js";

const data_slot_number = get_configured_data_slot();
const POLL_MS = SERVICE_CONFIG.POLL_MS.NPC_AI;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const NPC_AI_MODEL = process.env.NPC_AI_MODEL ?? "llama3.2:latest";
const NPC_AI_TIMEOUT_MS_RAW = Number(process.env.NPC_AI_TIMEOUT_MS ?? 15_000);
const NPC_AI_TIMEOUT_MS = Number.isFinite(NPC_AI_TIMEOUT_MS_RAW) ? NPC_AI_TIMEOUT_MS_RAW : 15_000;
const NPC_AI_NUM_CTX_RAW = Number(process.env.NPC_AI_NUM_CTX ?? 12_288);
const NPC_AI_NUM_CTX = Number.isFinite(NPC_AI_NUM_CTX_RAW) && NPC_AI_NUM_CTX_RAW > 0
    ? Math.floor(NPC_AI_NUM_CTX_RAW)
    : 12_288;
const NPC_AI_NUM_PREDICT_RAW = Number(process.env.NPC_AI_NUM_PREDICT ?? 80);
const NPC_AI_NUM_PREDICT = Number.isFinite(NPC_AI_NUM_PREDICT_RAW) && NPC_AI_NUM_PREDICT_RAW > 0
    ? Math.floor(NPC_AI_NUM_PREDICT_RAW)
    : 80;
const LEGACY_NPC_SESSION_HISTORY_FALLBACK = process.env.LEGACY_NPC_SESSION_HISTORY_FALLBACK === "true";
const NPC_MEMORY_NUM_CTX_RAW = Number(process.env.NPC_MEMORY_NUM_CTX ?? 8_192);
const NPC_MEMORY_NUM_CTX = Number.isFinite(NPC_MEMORY_NUM_CTX_RAW) && NPC_MEMORY_NUM_CTX_RAW > 0
    ? Math.floor(NPC_MEMORY_NUM_CTX_RAW)
    : 8_192;
const NPC_AI_KEEP_ALIVE = "30m";
const NPC_AI_TEMPERATURE = 0.8;

// Track which NPCs have responded in current conversation round to avoid duplicates
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

function create_conversation_id_from_message_id(message_id: string): string {
    const compact = String(message_id ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
    const suffix = compact.length > 0 ? compact : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return `conv_${suffix}`;
}

function get_behavior_listener_modifier(behavior_resolved: string, is_direct_target: boolean): number {
    if (is_direct_target) return 10;
    switch (behavior_resolved) {
        case "shopkeep": return 8;
        case "follow": return 6;
        case "idle_wander":
        default:
            return 0;
    }
}

function get_behavior_relevance_modifier(npc: any, behavior_resolved: string, text: string): number {
    const lower = String(text ?? "").toLowerCase();
    const role = String(npc?.role ?? npc?.title ?? "").toLowerCase();
    let score = 0;

    if ((behavior_resolved === "shopkeep" || role.includes("shop") || role.includes("merchant")) && /(buy|sell|price|trade|shop|coin|gold|wares)/.test(lower)) {
        score += 20;
    }
    if ((role.includes("guard") || role.includes("watch")) && /(danger|crime|attack|guard|law|help|thief|fight|weapon)/.test(lower)) {
        score += 20;
    }
    if ((behavior_resolved === "follow" || role.includes("follow") || role.includes("companion")) && /(come|follow|wait|stay|with me|let's go)/.test(lower)) {
        score += 15;
    }
    if (/(hello|hi|greetings|goodbye|bye|farewell)/.test(lower)) {
        score += 5;
    }
    return score;
}

function is_farewell_text(text: string): boolean {
    return /(goodbye|bye|farewell|see you|later|until next time)/i.test(String(text ?? ""));
}

function is_question_text(text: string): boolean {
    return /\?$/.test(String(text ?? "").trim()) || /^(who|what|when|where|why|how|do|did|can|could|would|will|are|is)\b/i.test(String(text ?? "").trim());
}

function get_listener_social_role(text: string, is_direct_target: boolean): "direct_reply" | "follow_up" | "farewell_response" | "answer" | "clarification" {
    if (is_farewell_text(text)) return "farewell_response";
    if (is_question_text(text)) return is_direct_target ? "answer" : "clarification";
    return is_direct_target ? "direct_reply" : "follow_up";
}

function should_limit_free_roam_to_single_speaker(params: {
    forced_npc_id?: string | null;
    timed_event_active: boolean;
}): boolean {
    return !params.forced_npc_id && !params.timed_event_active;
}

function derive_speech_source_from_turn_context(params: {
    npc_ref: string;
    fallback_text: string;
    fallback_speaker_ref: string;
    speech_turn_context?: {
        transcript_recent: Array<{ speaker_ref: string; text: string }>;
    } | null;
}): { source_text: string; source_speaker_ref: string } {
    const recent = params.speech_turn_context?.transcript_recent ?? [];
    const latest_other = [...recent].reverse().find((turn) => String(turn?.speaker_ref ?? "") !== params.npc_ref && String(turn?.text ?? "").trim().length > 0) ?? null;
    if (latest_other) {
        return {
            source_text: String(latest_other.text ?? "").trim(),
            source_speaker_ref: String(latest_other.speaker_ref ?? params.fallback_speaker_ref),
        };
    }
    return {
        source_text: params.fallback_text,
        source_speaker_ref: params.fallback_speaker_ref,
    };
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
    
    const prompt_pair = build_turn_summary_prompts({
        npc_name,
        npc_personality,
        existing_summary,
        conversation_text,
    });

    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: NPC_AI_MODEL,
            messages: [
                { role: "system", content: prompt_pair.system },
                { role: "user", content: prompt_pair.user }
            ],
            timeout_ms: 15000,
            options: { temperature: 0.7, num_ctx: NPC_MEMORY_NUM_CTX },
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

function build_ollama_history_from_speech_turn_context(params: {
    npc_ref: string;
    transcript_recent?: Array<{ speaker_ref: string; text: string }> | null;
}): OllamaMessage[] {
    const recent = Array.isArray(params.transcript_recent) ? params.transcript_recent : [];
    return recent
        .map((turn) => {
            const content = String(turn?.text ?? "").trim();
            if (!content) return null;
            const role: "user" | "assistant" = String(turn?.speaker_ref ?? "") === params.npc_ref ? "assistant" : "user";
            return { role, content } as OllamaMessage;
        })
        .filter((item): item is OllamaMessage => item !== null)
        .slice(-8);
}

function build_memory_thread_from_speech_turn_context(params: {
    player_ref: string;
    transcript_summary?: string | null;
    transcript_recent?: Array<{ speaker_ref: string; text: string }> | null;
    participant_factoids?: string[] | null;
}): Record<string, unknown> | null {
    const recent = Array.isArray(params.transcript_recent) ? params.transcript_recent : [];
    const recent_turns = recent.slice(-3).map((turn) => ({
        speaker: turn.speaker_ref,
        text: String(turn.text ?? "").slice(0, 100),
    }));
    const summary = String(params.transcript_summary ?? "").trim();
    const factoids = Array.isArray(params.participant_factoids) ? params.participant_factoids.filter(Boolean).slice(-3) : [];
    if (!summary && recent_turns.length === 0 && factoids.length === 0) return null;
    return {
        at: new Date().toISOString(),
        type: "conversation_thread",
        with: params.player_ref,
        summary: summary.slice(0, 200),
        recent_turns,
        remembered_factoids: factoids,
        total_exchanges: recent.length,
    };
}

// ===== DECISION HIERARCHY: Guided Template → AI =====

type DecisionResult = 
    | { type: "guided_ai"; reason: string; template: NPCTemplate | null };

/**
 * Determine NPC conversational response guidance.
 * This path intentionally avoids hard scripted spoken output so we can
 * keep conversational speech flexible and grounded in transcript/memory.
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
        transcript_recent_count: number;
        farewell_hint: boolean;
        continuity_state: ConversationContinuityState;
        npc_has_spoken_in_session: boolean;
        player_has_spoken_in_session: boolean;
        transcript_summary_present: boolean;
        participant_factoid_count: number;
    },
    available_actions: AvailableAction[]
): DecisionResult {
    void npc;
    void available_actions;
    const detected_situation = detectSituation(player_text, {
        transcript_recent_count: situation.transcript_recent_count,
        farewell_hint: situation.farewell_hint,
        continuity_state: situation.continuity_state,
        npc_has_spoken_in_session: situation.npc_has_spoken_in_session,
        player_has_spoken_in_session: situation.player_has_spoken_in_session,
        transcript_summary_present: situation.transcript_summary_present,
        participant_factoid_count: situation.participant_factoid_count,
    });

    const lowered = player_text.toLowerCase();
    const looks_like_question = /\?|\b(what|where|who|why|how|when|is|are|can|do|does)\b/.test(lowered);
    const is_big_question = situation.is_direct_target && looks_like_question && (
        lowered.includes("goal") ||
        lowered.includes("remember") ||
        lowered.includes("world") ||
        lowered.includes("why") ||
        lowered.includes("who are") ||
        lowered.includes("what are you")
    );
    if (is_big_question) {
        return { type: "guided_ai", reason: "Direct open-ended question", template: null };
    }
    const template = findTemplate(detected_situation);
    return {
        type: "guided_ai",
        reason: template ? `Template-guided AI (${template.situation})` : "Conversation AI without template guidance",
        template,
    };
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
function should_npc_respond(npc: any, is_direct_target: boolean, text: string): boolean {
    const behavior = resolve_npc_behavior(`npc.${String(npc?.id ?? npc?.npc_id ?? "unknown")}`, npc);
    const resolved_behavior = String(behavior.resolved);
    const lower = String(text ?? "").toLowerCase();

    if (is_direct_target) return true;

    switch (resolved_behavior) {
        case "shopkeep":
            return /(buy|sell|price|trade|coin|gold|wares|shop|room|rent|inn)/.test(lower);
        case "follow":
            return /(come|follow|wait|stay|with me|let's go|help me)/.test(lower);
        case "idle_wander": {
            const personality = npc?.personality || {};
            if (personality.passion || personality.hobby) {
                return Math.random() < 0.3;
            }
            return /(hello|hi|greetings|danger|fight|help|rumor|secret)/.test(lower) && Math.random() < 0.25;
        }
        default:
            return false;
    }
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
    const queued_speech_service = meta?.service_kind === "queued_speech_turn";
    let original_text = meta?.original_text as string || "";
    let machine_text = meta?.machine_text as string || "";
    const events = meta?.events as string[] || [];

    // If the action pipeline produced an observed-by list, prefer that as the set of NPCs
    // allowed to perceive/respond. This prevents out-of-range "telepathy" responses.
    const pipeline_driven = meta?.processed_by_action_pipeline === true;

    const observed_by: string[] = Array.isArray(meta?.observed_by)
        ? meta.observed_by
        : Array.isArray(meta?.observedBy)
            ? meta.observedBy
            : [];
    const observed_npc_ids = new Set(
        observed_by
            .filter((r: unknown) => typeof r === 'string')
            .map((r: string) => r.startsWith('npc.') ? r.replace('npc.', '') : r)
            .filter((id: string) => id.length > 0)
    );

    // Single communication pipeline: only witness-driven conversation participants may respond.
    const response_eligible_by: string[] = Array.isArray(meta?.response_eligible_by)
        ? meta.response_eligible_by
        : Array.isArray(meta?.responseEligibleBy)
            ? meta.responseEligibleBy
            : [];
    const response_eligible_npc_ids = new Set(
        response_eligible_by
            .filter((r: unknown) => typeof r === 'string')
            .map((r: string) => r.startsWith('npc.') ? r.replace('npc.', '') : r)
            .filter((id: string) => id.length > 0)
    );
    const has_explicit_response_eligibility = response_eligible_npc_ids.size > 0;
    const forced_npc_id = typeof meta?.force_npc_ref === "string" && meta.force_npc_ref.startsWith("npc.")
        ? meta.force_npc_ref.replace("npc.", "")
        : null;
    const forced_pending_opportunity_id = typeof meta?.timed_event_pending_opportunity_id === "string"
        ? meta.timed_event_pending_opportunity_id
        : null;
    const forced_queue_entry_id = typeof meta?.timed_event_queue_entry_id === "string"
        ? meta.timed_event_queue_entry_id
        : null;
    const forced_npc_ref = forced_npc_id ? `npc.${forced_npc_id}` : null;
    const queued_transport_context = queued_speech_service && typeof msg.conversation_id === "string" && forced_npc_ref
        ? build_queue_transport_context(data_slot_number, {
            conversation_id: msg.conversation_id,
            participant_ref: forced_npc_ref,
            queue_entry_id: forced_queue_entry_id,
        })
        : null;
    const queued_transport_entry = queued_transport_context?.queue_entry ?? null;
    const queued_latest_external_turn = queued_transport_context?.latest_external_turn ?? null;
    if (queued_speech_service && queued_latest_external_turn) {
        original_text = String(queued_latest_external_turn.text ?? "").trim();
    }
    if (queued_speech_service && (!queued_transport_entry || !queued_latest_external_turn || original_text.length === 0)) {
        debug_error("NPC_AI", "Queued speech service missing queue transport context", {
            id: msg.id,
            conversation_id: msg.conversation_id ?? null,
            forced_npc_ref,
            forced_queue_entry_id,
            has_queue_entry: !!queued_transport_entry,
            has_latest_external_turn: !!queued_latest_external_turn,
            original_text_length: original_text.length,
        });
        return;
    }
    
    // NEW: Handle direct COMMUNICATE messages from ActionPipeline
    // These have meta.intent_verb === "COMMUNICATE" and content in msg.content
    if (meta?.intent_verb === "COMMUNICATE" && !queued_speech_service && !original_text) {
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
    const has_communicate = queued_speech_service || communicate_events.length > 0 || meta?.intent_verb === "COMMUNICATE";
    
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
    if (!actor_id && queued_speech_service && typeof queued_latest_external_turn?.speaker_ref === "string" && queued_latest_external_turn.speaker_ref.startsWith("actor.")) {
        actor_id = queued_latest_external_turn.speaker_ref.replace("actor.", "");
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
    
    const breath_index = typeof meta?.world_breath_index === "number"
        ? meta.world_breath_index
        : (typeof meta?.timed_event_world_breath_index === "number" ? meta.timed_event_world_breath_index : null);
    
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
    const queue_target_refs = queued_transport_entry?.target_refs?.filter((ref): ref is string => typeof ref === "string" && ref.startsWith("npc."))
        ?? [];
    for (const queue_target_ref of queue_target_refs) {
        const npc_id = queue_target_ref.replace("npc.", "");
        if (!direct_targets.includes(npc_id)) {
            direct_targets.push(npc_id);
        }
    }
    debug_log("NPC_AI", "Resolved communication direct targets", {
        msg_id: msg.id,
        actor_ref: player_ref,
        meta_target_ref: typeof meta_target === "string" ? meta_target : null,
        queue_target_refs,
        direct_target_refs: direct_targets.map((npc_id) => `npc.${npc_id}`),
        queued_speech_service,
    });

    // ===== PHASE 4: CONVERSATION TRACKING =====
    let conversation_id = typeof msg.conversation_id === "string" && msg.conversation_id.length > 0
        ? msg.conversation_id
        : null;
    if (!conversation_id) {
        const resolved_session_id = resolve_conversation_session_id(data_slot_number, {
            place_id: typeof player_location?.place_id === "string" && player_location.place_id.length > 0 ? player_location.place_id : "unknown_place",
            speaker_ref: player_ref,
            direct_target_refs: direct_targets.map((npc_id) => `npc.${npc_id}`),
            created_breath_index: breath_index,
            timed_event_id: typeof get_timed_event_state(data_slot_number)?.timed_event_id === "string"
                ? get_timed_event_state(data_slot_number)?.timed_event_id
                : undefined,
        });
        conversation_id = resolved_session_id ?? create_conversation_id_from_message_id(msg.id);
    }
    let conversation = conversation_id ? get_conversation(data_slot_number, conversation_id) : null;

    if (!conversation && conversation_id) {
        const player_loc = player_location as { world_tile?: { x: number; y: number }; region_tile?: { x: number; y: number } };
        const region_id = `region.${player_loc.world_tile?.x ?? 0}_${player_loc.world_tile?.y ?? 0}_${player_loc.region_tile?.x ?? 0}_${player_loc.region_tile?.y ?? 0}`;
        const initial_participants = [player_ref];
        conversation = start_conversation(data_slot_number, conversation_id, region_id, initial_participants, undefined);
    }

    if (conversation && conversation_id) {
        add_message(
            data_slot_number,
            conversation_id,
            player_ref,
            original_text,
            "neutral",
            "COMMUNICATE"
        );
    }

    const direct_target_refs_full = direct_targets.map((npc_id) => `npc.${npc_id}`);
    const heard_by_refs = observed_by.filter((ref): ref is string => typeof ref === "string" && ref.startsWith("npc."));
    const eligible_speaker_refs = Array.isArray(response_eligible_by)
        ? response_eligible_by.filter((ref): ref is string => typeof ref === "string" && ref.startsWith("npc."))
        : [];
    const session_place_id = typeof player_location?.place_id === "string" && player_location.place_id.length > 0 ? player_location.place_id : "unknown_place";
    const session = ensure_conversation_session(data_slot_number, {
        conversation_id,
        place_id: session_place_id,
        speaker_ref: player_ref,
        direct_target_refs: direct_target_refs_full,
        created_breath_index: breath_index,
        timed_event_id: typeof get_timed_event_state(data_slot_number)?.timed_event_id === "string"
            ? get_timed_event_state(data_slot_number)?.timed_event_id
            : undefined,
    });
    const communication_event = queued_speech_service
        ? null
        : create_communication_event(data_slot_number, {
            event_id: msg.id,
            speaker_ref: player_ref,
            text: original_text,
            volume: typeof meta?.intent_subtype === "string" ? meta.intent_subtype : undefined,
            direct_target_refs: direct_target_refs_full,
            heard_by_refs,
            eligible_speaker_refs,
            place_id: session.place_id,
            conversation_id,
            created_breath_index: breath_index,
            timed_event_id: session.timed_event_id,
            source_action_id: typeof meta?.intent_id === "string" ? meta.intent_id : (typeof meta?.intentId === "string" ? meta.intentId : undefined),
        });
    if (!queued_speech_service) {
        add_session_observers(data_slot_number, conversation_id, heard_by_refs, breath_index);
        mark_session_targets_addressed(data_slot_number, conversation_id, direct_target_refs_full, breath_index);
        append_conversation_session_message(data_slot_number, {
            conversation_id,
            speaker_ref: player_ref,
            text: original_text,
            created_breath_index: breath_index,
            social_role: get_listener_social_role(original_text, direct_target_refs_full.length > 0),
        });
        if (is_farewell_text(original_text)) {
            mark_conversation_session_cooling(data_slot_number, conversation_id, breath_index);
            for (const target_ref of direct_target_refs_full) {
                mark_session_participant_left(data_slot_number, conversation_id, target_ref, breath_index);
            }
            debug_log("NPC_AI", "farewell detected; conversation session cooling/leave applied", {
                conversation_id,
                speaker_ref: player_ref,
                target_refs: direct_target_refs_full,
                breath_index,
            });
        }
        for (const target_ref of direct_target_refs_full) {
            mark_session_participant_rejoined(data_slot_number, conversation_id, target_ref, breath_index);
        }
        update_conversation_session_lifecycle(data_slot_number, conversation_id, breath_index);
    }
    
    // Find all NPCs - filter by place first, then region for backward compatibility
    const all_npcs = find_npcs(data_slot_number, {});
    
    // Get player's place_id if available (Place System)
    const player_place_id = player_location?.place_id;
    
    const nearby_npcs = all_npcs.filter(npc_hit => {
        if (npc_hit.id === "default_npc") return false;

        // If ActionPipeline drove this message, only NPCs in observed_by may respond.
        // (Empty observed_by means nobody perceived it.)
        if (pipeline_driven && !observed_npc_ids.has(npc_hit.id)) return false;

        if (forced_npc_id && npc_hit.id !== forced_npc_id) return false;

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

    if (forced_npc_id && nearby_npcs.length === 0) {
        if (forced_pending_opportunity_id) {
            const cancelled = cancel_pending_communication_opportunity(data_slot_number, forced_pending_opportunity_id, "forced_npc_not_observing_message");
            debug_pipeline("NPC_AI", "Cancelled forced pending communication opportunity - forced npc not available for this message", {
                opportunity_id: forced_pending_opportunity_id,
                cancelled,
            });
        }
        if (forced_queue_entry_id && conversation_id) {
            mark_queue_entry_status_by_id(data_slot_number, conversation_id, forced_queue_entry_id, "declined", breath_index);
        }
        debug_pipeline("NPC_AI", "Forced timed communication has no available observing npc", {
            id: msg.id,
            intent_id: meta?.intent_id ?? meta?.intentId ?? msg.id,
            observed_by: observed_by.length,
            forced_npc_id,
        });
        if (communication_event) {
            mark_communication_event_evaluated(data_slot_number, communication_event.event_id);
        }
        if (forced_npc_id) {
            const done_ok = mark_actor_done(data_slot_number, `npc.${forced_npc_id}`);
            debug_pipeline("NPC_AI", `Marked forced timed-event actor done after forced observer miss for npc.${forced_npc_id}`, {
                source_message_id: msg.id,
                pending_opportunity_id: forced_pending_opportunity_id,
                queue_entry_id: forced_queue_entry_id,
                marked_done: done_ok,
            });
        }
        return;
    }
    
    debug_pipeline("NPC_AI", `Found ${nearby_npcs.length} NPCs nearby`, {
        region: player_location?.region_tile,
        place: player_place_id,
        npcs: nearby_npcs.map(n => n.id)
    });

    const listener_decisions = queued_speech_service ? [] : nearby_npcs.flatMap((npc_hit) => {
        const npc_ref = `npc.${npc_hit.id}`;
        const npc_result = load_npc(data_slot_number, npc_hit.id);
        if (!npc_result.ok) return [];
        const npc = npc_result.npc;
        const behavior = resolve_npc_behavior(npc_ref, npc);
        const is_direct_target = direct_targets.includes(npc_hit.id);
        const can_perceive = pipeline_driven
            ? true
            : can_npc_perceive_player(npc, player_location, player_ref).can_perceive;
        const eligible_to_speak = pipeline_driven
            ? (has_explicit_response_eligibility
                ? response_eligible_npc_ids.has(npc_hit.id)
                : should_npc_respond(npc, is_direct_target, original_text))
            : should_npc_respond(npc, is_direct_target, original_text);
        const decision = create_listener_decision(data_slot_number, {
            conversation_id,
            listener_ref: npc_ref,
            direct_target_refs: direct_target_refs_full,
            eligible_to_speak,
            can_perceive,
            is_current_participant: session.active_participants.includes(npc_ref),
            behavior_modifier: get_behavior_listener_modifier(behavior.resolved, is_direct_target),
            relationship_modifier: 0,
            relevance_score: (is_direct_target ? 40 : (eligible_to_speak ? 10 : 0)) + get_behavior_relevance_modifier(npc, behavior.resolved, original_text),
            social_role: get_listener_social_role(original_text, is_direct_target),
            reason: eligible_to_speak ? (is_direct_target ? "direct_target" : "witness_eligible") : (can_perceive ? "observe_only" : "cannot_perceive"),
            breath_index,
        });
        return decision ? [decision] : [];
    });
    const admitted_queue_entries = queued_speech_service ? [] : admit_speakers_for_event(data_slot_number, {
        conversation_id,
        event_id: communication_event!.event_id,
        decisions: listener_decisions,
        breath_index,
    });
    const queue_sync = sync_pending_communication_opportunities_with_queue(data_slot_number, {
        conversation_id,
        valid_queue_entry_ids: get_session_queue_entry_ids(data_slot_number, conversation_id),
    });
    debug_pipeline("NPC_AI", "Projecting witness state from canonical session admission", {
        conversation_id,
        queued_speech_service,
        event_id: communication_event?.event_id ?? null,
        queue_sync,
        admitted_queue_entries: admitted_queue_entries.map((entry) => ({
            participant_ref: entry.participant_ref,
            stable_order: entry.stable_order,
            status: entry.status,
        })),
        heard_by_refs,
        direct_target_refs: direct_target_refs_full,
    });
    project_witness_state_for_conversation(conversation_id, queued_speech_service ? "Queued speech session projection" : "Communication session admission");
    if (listener_decisions.length > 0) {
        debug_log("NPC_AI", "listener decisions evaluated for communication event", {
            conversation_id,
            event_id: communication_event?.event_id ?? null,
            decisions: listener_decisions.map((decision) => ({
                listener_ref: decision.listener_ref,
                disposition: decision.disposition,
                priority_score: decision.priority_score,
                address_recency: decision.address_recency,
                reason: decision.reason,
            })),
            admitted_queue_entries: admitted_queue_entries.map((entry) => ({
                participant_ref: entry.participant_ref,
                stable_order: entry.stable_order,
                score: entry.admission_priority_score,
            })),
            queue_sync,
        });
    }
    const queue_order = new Map(admitted_queue_entries.map((entry) => [entry.participant_ref, entry.stable_order]));
    nearby_npcs.sort((a, b) => {
        const a_order = queue_order.get(`npc.${a.id}`) ?? Number.MAX_SAFE_INTEGER;
        const b_order = queue_order.get(`npc.${b.id}`) ?? Number.MAX_SAFE_INTEGER;
        if (a_order !== b_order) return a_order - b_order;
        return a.id.localeCompare(b.id);
    });
    
    const communication_key = `${correlation_id}:${original_text}`;
    debug_log("NPC_AI", "processing communication through session-owned queue", {
        communication_key,
        conversation_id,
        event_id: communication_event?.event_id ?? null,
        direct_target_refs: direct_target_refs_full,
        admitted_queue_entries: admitted_queue_entries.map((entry) => ({
            participant_ref: entry.participant_ref,
            stable_order: entry.stable_order,
            score: entry.admission_priority_score,
        })),
    });
    const limit_free_roam_to_single_speaker = should_limit_free_roam_to_single_speaker({
        forced_npc_id,
        timed_event_active: is_timed_event_active(data_slot_number),
    });
    let free_roam_speaker_emitted = false;
    const free_roam_front_speaker_ref = limit_free_roam_to_single_speaker
        ? (get_next_session_queue_entry(data_slot_number, conversation_id)?.participant_ref ?? null)
        : null;
    if (limit_free_roam_to_single_speaker) {
        debug_log("NPC_AI", "free-roam queue front selected for this poll", {
            conversation_id,
            free_roam_front_speaker_ref,
        });
    }
    
    // Process each nearby NPC
    for (const npc_hit of nearby_npcs) {
        if (limit_free_roam_to_single_speaker && free_roam_speaker_emitted) {
            debug_log("NPC_AI", "free-roam sequential queue already emitted a speaker this poll", {
                conversation_id,
                skipped_npc: `npc.${npc_hit.id}`,
            });
            continue;
        }
        if (limit_free_roam_to_single_speaker && free_roam_front_speaker_ref && free_roam_front_speaker_ref !== `npc.${npc_hit.id}`) {
            debug_log("NPC_AI", "skipping npc because they are not free-roam queue front", {
                conversation_id,
                npc_ref: `npc.${npc_hit.id}`,
                free_roam_front_speaker_ref,
            });
            continue;
        }
        const npc_result = load_npc(data_slot_number, npc_hit.id);
        if (!npc_result.ok) continue;
        
        const npc = npc_result.npc;
        const behavior = resolve_npc_behavior(`npc.${npc_hit.id}`, npc);
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
        
        // Single pipeline: witness decides which NPCs are allowed to respond.
        if (pipeline_driven) {
            if (has_explicit_response_eligibility && !response_eligible_npc_ids.has(npc_hit.id)) {
                continue;
            }
        } else {
            // Legacy (non-pipeline) behavior.
            const should_respond = should_npc_respond(npc, is_direct_target, original_text);
            debug_log("NPC_AI", `should_npc_respond for ${npc_hit.id}: ${should_respond}, is_direct_target: ${is_direct_target}`);
            if (!should_respond) {
                continue;
            }
        }
        
        // Check perception using AWARENESS tags (per THAUMWORLD rules)
        const player_ref = `actor.${actor_id}`;
        const perception = pipeline_driven
            ? { can_perceive: true }
            : can_npc_perceive_player(npc, player_location, player_ref);
        debug_log("NPC_AI", `can_npc_perceive_player for ${npc_hit.id}: ${perception.can_perceive}, player_place: ${player_location?.place_id}`);
        
        if (!perception.can_perceive && !is_direct_target) {
            // Can't perceive and not directly addressed - skip
            debug_log("NPC_AI", `Skipping ${npc_hit.id} - can't perceive and not direct target`);
            continue;
        }
        
        const npc_ref = `npc.${npc_hit.id}`;
        const queued_entry = get_session_queue_entry(data_slot_number, conversation_id, npc_ref);
        const next_queue_entry = get_next_session_queue_entry(data_slot_number, conversation_id);
        const forced_transport_context = forced_npc_id && forced_queue_entry_id
            ? build_queue_transport_context(data_slot_number, {
                conversation_id,
                participant_ref: npc_ref,
                queue_entry_id: forced_queue_entry_id,
            })
            : null;
        const forced_queue_entry = forced_transport_context?.queue_entry ?? null;
        const active_queue_entry = forced_queue_entry ?? queued_entry;
        if (forced_npc_id && forced_queue_entry_id && !forced_queue_entry) {
            if (forced_pending_opportunity_id) {
                const cancelled = cancel_pending_communication_opportunity(data_slot_number, forced_pending_opportunity_id, "missing_forced_queue_entry");
                debug_log("NPC_AI", "cancelled forced pending opportunity because forced queue entry is missing", {
                    npc_ref,
                    conversation_id,
                    pending_opportunity_id: forced_pending_opportunity_id,
                    queue_entry_id: forced_queue_entry_id,
                    cancelled,
                });
            }
            const done_ok = mark_actor_done(data_slot_number, npc_ref);
            debug_log("NPC_AI", "marked forced timed-event actor done because forced queue entry is missing", {
                npc_ref,
                conversation_id,
                queue_entry_id: forced_queue_entry_id,
                marked_done: done_ok,
            });
            continue;
        }
        if (!forced_npc_id && !queued_entry) {
            debug_log("NPC_AI", "skipping npc not admitted to session queue", {
                npc_ref,
                conversation_id,
                event_id: communication_event?.event_id ?? null,
                communication_key,
            });
            continue;
        }
        const speech_turn_context = build_speech_turn_context(data_slot_number, {
            conversation_id,
            participant_ref: npc_ref,
        });
        const speech_source_context = forced_transport_context?.speech_turn_context ?? speech_turn_context;
        const speech_source = derive_speech_source_from_turn_context({
            npc_ref,
            fallback_text: original_text,
            fallback_speaker_ref: typeof queued_latest_external_turn?.speaker_ref === "string" && queued_latest_external_turn.speaker_ref.length > 0
                ? queued_latest_external_turn.speaker_ref
                : player_ref,
            speech_turn_context: speech_source_context ? { transcript_recent: speech_source_context.transcript_recent } : null,
        });
        debug_log("NPC_AI", "prepared speech turn context for npc response attempt", {
            npc_ref,
            conversation_id,
            forced_npc_id: forced_npc_id ?? null,
            queued_entry: queued_entry ? {
                queue_entry_id: queued_entry.queue_entry_id,
                stable_order: queued_entry.stable_order,
                social_role: queued_entry.social_role,
                status: queued_entry.status,
            } : null,
            forced_queue_entry: forced_queue_entry ? {
                queue_entry_id: forced_queue_entry.queue_entry_id,
                stable_order: forced_queue_entry.stable_order,
                social_role: forced_queue_entry.social_role,
                status: forced_queue_entry.status,
            } : null,
            next_queue_entry: next_queue_entry ? {
                participant_ref: next_queue_entry.participant_ref,
                stable_order: next_queue_entry.stable_order,
            } : null,
            speech_turn_context: speech_turn_context ? {
                participant_ref: speech_turn_context.participant_ref,
                current_mode: speech_turn_context.current_mode,
                transcript_recent_count: speech_turn_context.transcript_recent.length,
                transcript_summary_present: speech_turn_context.transcript_summary.length > 0,
                memory_factoid_count: speech_turn_context.memory_factoids_for_participant.length,
            } : null,
            speech_source,
        });
        const speech_turn_decision = reevaluate_npc_speech_turn({
            npc_ref,
            queued_entry: active_queue_entry ? { stable_order: active_queue_entry.stable_order, social_role: active_queue_entry.social_role } : null,
            next_queue_entry: next_queue_entry ? { participant_ref: next_queue_entry.participant_ref, stable_order: next_queue_entry.stable_order } : null,
            speech_turn_context: speech_turn_context ? {
                current_mode: speech_turn_context.current_mode,
                transcript_recent: speech_turn_context.transcript_recent,
                transcript_summary: speech_turn_context.transcript_summary,
                participants: speech_turn_context.participants,
            } : null,
            forced_npc_id,
        });
        debug_log("NPC_AI", "speech turn re-evaluated", {
            npc_ref,
            conversation_id,
            should_speak: speech_turn_decision.should_speak,
            reason: speech_turn_decision.reason,
            queued_entry_order: active_queue_entry?.stable_order ?? null,
            next_queue_speaker: next_queue_entry?.participant_ref ?? null,
        });
        if (!speech_turn_decision.should_speak) {
            if (forced_pending_opportunity_id) {
                const cancelled = cancel_pending_communication_opportunity(data_slot_number, forced_pending_opportunity_id, speech_turn_decision.reason);
                debug_log("NPC_AI", "cancelled forced pending opportunity after speech re-evaluation declined", {
                    npc_ref,
                    conversation_id,
                    pending_opportunity_id: forced_pending_opportunity_id,
                    cancelled,
                    reason: speech_turn_decision.reason,
                });
            }
            if (forced_queue_entry?.queue_entry_id) {
                mark_queue_entry_status_by_id(data_slot_number, conversation_id, forced_queue_entry.queue_entry_id, "declined", breath_index);
            } else {
                mark_queue_entry_status(data_slot_number, conversation_id, npc_ref, "declined", breath_index);
            }
            sync_pending_communication_opportunities_with_queue(data_slot_number, {
                conversation_id,
                valid_queue_entry_ids: get_session_queue_entry_ids(data_slot_number, conversation_id),
            });
            continue;
        }
        if (!forced_npc_id && is_timed_event_active(data_slot_number)) {
            const active_actor_ref = get_active_actor_ref(data_slot_number);
            if (active_actor_ref && active_actor_ref !== npc_ref) {
                debug_log("NPC_AI", "deferring queued speech into timed-event pending opportunity", {
                    npc_ref,
                    active_actor_ref,
                    conversation_id,
                    queue_entry_id: active_queue_entry?.queue_entry_id ?? null,
                    queue_stable_order: active_queue_entry?.stable_order ?? null,
                    speech_turn_context: speech_turn_context ? {
                        transcript_recent_count: speech_turn_context.transcript_recent.length,
                        transcript_summary_present: speech_turn_context.transcript_summary.length > 0,
                        participant_count: speech_turn_context.participants.length,
                    } : null,
                });
                debug_pipeline("NPC_AI", `Deferred queued speech until actor turn for ${npc_ref}`, {
                    source_message_id: msg.id,
                    active_actor_ref,
                    queue_entry_id: active_queue_entry?.queue_entry_id ?? null,
                    queue_entry_order: active_queue_entry?.stable_order ?? null,
                });
                debug_log("NPC_AI", "timed-event communication left in session queue awaiting turn-manager transport", {
                    npc_ref,
                    source_message_id: msg.id,
                    active_actor_ref,
                    communication_key,
                    correlation_id: correlation_id ?? null,
                    original_text: speech_source.source_text,
                    queue_entry_id: active_queue_entry?.queue_entry_id ?? null,
                    queue_entry_order: active_queue_entry?.stable_order ?? null,
                    conversation_id,
                });
                continue;
            }
        }

        // Witness reactions are handled by ActionPipeline perception broadcast
        // (witness_handler). Avoid duplicating real-time reactions here.
        
        debug_pipeline("NPC_AI", `Generating response for ${npc.name}`, {
            npc_id: npc_hit.id,
            is_direct_target,
            can_perceive: perception.can_perceive,
            behavior_requested: behavior.requested,
            behavior_resolved: behavior.resolved,
            queue_entry_order: active_queue_entry?.stable_order ?? null,
            next_queue_speaker: next_queue_entry?.participant_ref ?? null,
        });
        if (forced_queue_entry?.queue_entry_id) {
            mark_queue_entry_status_by_id(data_slot_number, conversation_id, forced_queue_entry.queue_entry_id, "thinking", breath_index);
        } else {
            mark_queue_entry_status(data_slot_number, conversation_id, npc_ref, "thinking", breath_index);
        }
        
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
        const sway = createSwayFromCommunication(speech_source.source_text, speech_source.source_speaker_ref, npc_state.personality);
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
        
        const transcript_recent = speech_turn_context?.transcript_recent ?? [];
        const transcript_summary_present = (speech_turn_context?.transcript_summary.trim().length ?? 0) > 0;
        const participant_factoid_count = speech_turn_context?.memory_factoids_for_participant.length ?? 0;
        const npc_has_spoken_in_session = transcript_recent.some((turn) => turn.speaker_ref === npc_ref);
        const player_has_spoken_in_session = transcript_recent.some((turn) => turn.speaker_ref === player_ref);
        const continuity_state: ConversationContinuityState = is_farewell_text(speech_source.source_text)
            ? "closing_exchange"
            : ((npc_has_spoken_in_session || transcript_recent.length >= 2 || transcript_summary_present || participant_factoid_count > 0)
                ? "ongoing_exchange"
                : "fresh_exchange");

        // Determine response using decision hierarchy
        const decision = determineResponse(
            npc,
            speech_source.source_text,
            {
                is_combat: false, // TODO: Check combat state
                has_been_attacked: false, // TODO: Check recent events
                nearby_hostiles: 0,
                nearby_allies: nearby_npcs.length - 1,
                is_direct_target: is_direct_target,
                transcript_recent_count: transcript_recent.length,
                farewell_hint: is_farewell_text(speech_source.source_text),
                continuity_state,
                npc_has_spoken_in_session,
                player_has_spoken_in_session,
                transcript_summary_present,
                participant_factoid_count,
            },
            available_actions
        );
        
        let npc_response: string;
        let decision_source: string;
        let ai_duration_ms = 0;
        
        switch (decision.type) {
            case "guided_ai":
                const npc_mem_ref = `npc.${npc_hit.id}`;
                const relationship = get_relationship_status(data_slot_number, npc_mem_ref, player_ref);
                const participant_factoids = speech_turn_context?.memory_factoids_for_participant ?? [];
                
                // Get place/region data for localized prompt-context assembly
                const npc_place_id = get_npc_place_id(npc);
                let npc_place: any = null;
                
                if (npc_place_id) {
                    const placeResult = load_place(data_slot_number, npc_place_id);
                    if (placeResult.ok) {
                        npc_place = placeResult.place;
                    }
                }

                let npc_region: any = null;
                const npc_loc_any = (npc as any)?.location;
                if (npc_loc_any?.world_tile && npc_loc_any?.region_tile) {
                    const wx = Number(npc_loc_any.world_tile.x ?? 0);
                    const wy = Number(npc_loc_any.world_tile.y ?? 0);
                    const rx = Number(npc_loc_any.region_tile.x ?? 0);
                    const ry = Number(npc_loc_any.region_tile.y ?? 0);
                    const region_res = get_region_by_coords(data_slot_number, wx, wy, rx, ry);
                    if (region_res.ok) npc_region = region_res.region;
                }

                const selected_prompt_context = build_dialogue_prompt_context({
                    slot: data_slot_number,
                    npc,
                    npc_ref,
                    player_ref,
                    player_text: speech_source.source_text,
                    conversation_id,
                    template_situation: decision.template?.situation ?? null,
                    place: npc_place,
                    region: npc_region,
                    speech_turn_context,
                });
                
                // Build prompt with working memory context and location awareness
                const prompt_pair = build_npc_dialogue_prompts({
                    npc,
                    player_text: speech_source.source_text,
                    can_perceive: perception.can_perceive,
                    memory_context: selected_prompt_context.memory_context,
                    conversation_mode: speech_turn_context?.current_mode,
                    social_role: active_queue_entry?.social_role ?? undefined,
                    transcript_recent: selected_prompt_context.transcript_recent,
                    transcript_summary: selected_prompt_context.transcript_summary,
                    participant_factoids: selected_prompt_context.participant_factoids,
                    player_location_name: selected_prompt_context.player_location_name,
                    npc_location_name: selected_prompt_context.npc_location_name,
                    relationship_status: relationship.status,
                    relationship_memory_count: relationship.memory_count,
                    template_situation: decision.template?.situation,
                    template_context_lines: decision.template?.context_lines,
                    template_examples: decision.template?.example_phrasings,
                    response_constraints: decision.template?.constraints,
                    selected_personality_lines: selected_prompt_context.personality_lines,
                    selected_world_lines: selected_prompt_context.world_lines,
                    selected_place_summary_lines: selected_prompt_context.place_summary_lines,
                });
                debug_pipeline("NPC_AI", `Using guided AI response for ${npc.name}`, {
                    template_id: decision.template?.id ?? null,
                    template_situation: decision.template?.situation ?? null,
                    reason: decision.reason,
                    continuity_state,
                    transcript_recent_count: transcript_recent.length,
                    npc_has_spoken_in_session,
                    player_has_spoken_in_session,
                    transcript_summary_present,
                    participant_factoid_count,
                    prompt_context_debug: selected_prompt_context.debug,
                    selected_personality_lines: selected_prompt_context.personality_lines,
                    selected_world_lines: selected_prompt_context.world_lines,
                    selected_memory_context_length: selected_prompt_context.memory_context.length,
                    selected_factoid_count: selected_prompt_context.participant_factoids.length,
                    selected_transcript_recent_count: selected_prompt_context.transcript_recent.length,
                    transcript_summary_selected: selected_prompt_context.transcript_summary.length > 0,
                });
                
                // Prefer canonical session-owned recent transcript history.
                // Legacy npc_sessions history remains available behind an env flag while we validate
                // that session transcript/summary/factoids fully cover live dialogue continuity.
                const session_key = get_session_key(npc_hit.id, correlation_id);
                const history = build_ollama_history_from_speech_turn_context({
                    npc_ref,
                    transcript_recent: speech_turn_context?.transcript_recent,
                });
                const fallback_history_available = history.length === 0 ? get_session_history(session_key) : [];
                const fallback_history = history.length === 0 && LEGACY_NPC_SESSION_HISTORY_FALLBACK
                    ? fallback_history_available
                    : [];
                if (history.length > 0) {
                    debug_log("NPC_AI", "using session-owned transcript history for prompt context", {
                        npc_ref,
                        conversation_id,
                        message_count: history.length,
                    });
                } else if (fallback_history.length > 0) {
                    debug_log("NPC_AI", "using legacy session history fallback for prompt context", {
                        npc_ref,
                        conversation_id,
                        message_count: fallback_history.length,
                        reason: "no_session_transcript_history",
                    });
                } else if (fallback_history_available.length > 0 && !LEGACY_NPC_SESSION_HISTORY_FALLBACK) {
                    debug_log("NPC_AI", "legacy session history fallback available but disabled", {
                        npc_ref,
                        conversation_id,
                        available_message_count: fallback_history_available.length,
                        reason: "canonical_session_history_preferred",
                    });
                }
                
                const messages: OllamaMessage[] = [
                    { role: "system", content: prompt_pair.system },
                    ...history,
                    ...fallback_history,
                    { role: "user", content: prompt_pair.user }
                ];
                const generation_started_at = Date.now();
                
                try {
                    debug_pipeline("NPC_AI", `Starting guided AI generation for ${npc.name}`, {
                        conversation_id,
                        template_id: decision.template?.id ?? null,
                        template_situation: decision.template?.situation ?? null,
                        history_count: history.length,
                        fallback_history_count: fallback_history.length,
                        timeout_ms: NPC_AI_TIMEOUT_MS,
                        num_predict: NPC_AI_NUM_PREDICT,
                    });
                    const ai_start = Date.now();
                    const response = await ollama_chat({
                        host: OLLAMA_HOST,
                        model: NPC_AI_MODEL,
                        messages,
                        keep_alive: NPC_AI_KEEP_ALIVE,
                        timeout_ms: NPC_AI_TIMEOUT_MS,
                        options: { temperature: NPC_AI_TEMPERATURE, num_ctx: NPC_AI_NUM_CTX, num_predict: NPC_AI_NUM_PREDICT },
                    });
                    ai_duration_ms = Date.now() - ai_start;
                    
                    npc_response = response.content.trim();
                    decision_source = `AI (${decision.reason})`;
                    debug_pipeline("NPC_AI", `Finished guided AI generation for ${npc.name}`, {
                        conversation_id,
                        duration_ms: ai_duration_ms,
                        in_flight_duration_ms: Date.now() - generation_started_at,
                        response_length: npc_response.length,
                    });
                    
                    // Log AI I/O
                    log_ai_io_terminal(
                        'npc_dialogue',
                        `${npc.name} responding to: ${speech_source.source_text.slice(0, 30)}...`,
                        npc_response,
                        ai_duration_ms,
                        session_key
                    );
                } catch (err) {
                    const in_flight_duration_ms = Date.now() - generation_started_at;
                    debug_error("NPC_AI", `AI call failed for ${npc.name}`, err);
                    debug_pipeline("NPC_AI", `Guided AI generation fell back for ${npc.name}`, {
                        conversation_id,
                        template_id: decision.template?.id ?? null,
                        template_situation: decision.template?.situation ?? null,
                        timeout_ms: NPC_AI_TIMEOUT_MS,
                        in_flight_duration_ms,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    if (forced_pending_opportunity_id) {
                        const released = release_pending_communication_opportunity(data_slot_number, forced_pending_opportunity_id);
                        debug_pipeline("NPC_AI", `Released forced timed-event communication after AI failure for npc.${npc_hit.id}`, {
                            opportunity_id: forced_pending_opportunity_id,
                            released,
                        });
                    }
                    npc_response = get_fallback_dialogue(decision.template?.situation ?? "first_communication");
                    decision_source = "fallback (AI error)";
                }
                break;
        }
        
        // Store to session (for all response types)
        const session_key = get_session_key(npc_hit.id, correlation_id);
        const npc_name = typeof (npc as any).name === "string" ? ((npc as any).name as string) : npc_hit.id;
        const npc_personality = (npc as any).personality ? JSON.stringify((npc as any).personality) : "";
        await append_session_turn(session_key, original_text, npc_response, player_ref, npc_ref, npc_name, npc_personality);
        const session_ctx = get_session_context(session_key);
        if (session_ctx) {
            if (session_ctx.summary.length > 0) {
                set_conversation_session_summary(data_slot_number, conversation_id, session_ctx.summary);
            }
            const memory_factoids = session_ctx.summary.length > 0
                ? session_ctx.summary.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter((part) => part.length > 0).slice(-3)
                : [];
            if (memory_factoids.length > 0) {
                set_participant_memory_factoids(data_slot_number, conversation_id, npc_ref, memory_factoids);
            }
        }

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
                    "COMMUNICATE"
                );
            }
            append_conversation_session_message(data_slot_number, {
                conversation_id,
                speaker_ref: npc_ref,
                text: npc_response,
                created_breath_index: breath_index,
                social_role: is_direct_target ? "direct_reply" : "follow_up",
            });
            
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
            conversation_id,
            turn_number: (msg.turn_number || 0) + 1,
            role: "npc",
            meta: {
                ...getSessionMeta(),
                npc_id: npc_hit.id,
                npc_name: npc.name,
                target_actor: actor_id,
                communication_context: speech_source.source_text,
                is_direct_response: is_direct_target,
                can_perceive: perception.can_perceive,
                decision_source: decision_source,
                available_actions: available_actions.slice(0, 3).map(a => a.verb),
                queue_entry_id: active_queue_entry?.queue_entry_id ?? null,
                queue_stable_order: active_queue_entry?.stable_order ?? null,
                queue_social_role: active_queue_entry?.social_role ?? null,
                speech_turn_context: speech_turn_context ? {
                    participant_count: speech_turn_context.participants.length,
                    transcript_recent_count: speech_turn_context.transcript_recent.length,
                    transcript_summary_present: speech_turn_context.transcript_summary.length > 0,
                    memory_factoid_count: speech_turn_context.memory_factoids_for_participant.length,
                } : null,
            },
        };
        
        const response_msg = create_message(output);
        append_inbox_message(inbox_path, response_msg);
        if (limit_free_roam_to_single_speaker) {
            free_roam_speaker_emitted = true;
            debug_log("NPC_AI", "free-roam sequential queue emitted one speaker for this poll", {
                conversation_id,
                speaker_ref: npc_ref,
            });
        }
        if (forced_queue_entry?.queue_entry_id) {
            mark_queue_entry_status_by_id(data_slot_number, conversation_id, forced_queue_entry.queue_entry_id, "spoken", breath_index);
        } else {
            mark_queue_entry_status(data_slot_number, conversation_id, npc_ref, "spoken", breath_index);
        }
        sync_pending_communication_opportunities_with_queue(data_slot_number, {
            conversation_id,
            valid_queue_entry_ids: get_session_queue_entry_ids(data_slot_number, conversation_id),
        });

        // Log the canonical npc_response envelope so the UI can display it.
        // (Do not rely on interface_program to mirror inbox messages into log.)
        append_log_envelope(log_path, response_msg);

        // Renderer debug: NPC speech should emit the same sense broadcasts as player speech.
        // This is purely visual (ASCII rings) and uses the COMMUNICATE sense profile.
        try {
            const vol_raw = meta?.intent_subtype ?? meta?.intentSubtype ?? meta?.volume;
            const vol = typeof vol_raw === "string" ? vol_raw.toUpperCase() : "NORMAL";
            const subtype = (vol === "WHISPER" || vol === "SHOUT" || vol === "NORMAL") ? vol : "NORMAL";
            send_sense_broadcast_command(`npc.${npc_hit.id}`, "COMMUNICATE", subtype, "NPC spoke");
        } catch {
            // ignore
        }

        // Note: npc_ai logs its own npc_response envelopes.
        // Avoid writing extra "display-only" log lines elsewhere.

        if (forced_npc_id && forced_npc_id === npc_hit.id) {
            const completed = forced_pending_opportunity_id
                ? complete_pending_communication_opportunity(data_slot_number, forced_pending_opportunity_id)
                : false;
            const done_ok = mark_actor_done(data_slot_number, `npc.${npc_hit.id}`);
            debug_pipeline("NPC_AI", `Completed forced timed-event communication for npc.${npc_hit.id}`, {
                source_message_id: msg.id,
                pending_opportunity_id: forced_pending_opportunity_id,
                completed,
                marked_done: done_ok,
            });
        }

        // Persist conversation context to NPC memory_sheet
        // Stores hierarchical conversation threads (summary + recent turns) for continuity
        try {
            const npc_sheet = load_npc(data_slot_number, npc_hit.id);
            if (npc_sheet.ok) {
                const npc_obj = npc_sheet.npc as Record<string, unknown>;
                const mem = (npc_obj.memory_sheet as Record<string, unknown>) ?? {};
                const thread_entry = build_memory_thread_from_speech_turn_context({
                    player_ref,
                    transcript_summary: speech_turn_context?.transcript_summary,
                    transcript_recent: speech_turn_context?.transcript_recent,
                    participant_factoids: speech_turn_context?.memory_factoids_for_participant,
                });

                if (thread_entry) {
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
        
        // Update engagement to extend conversation timeout when NPC responds
        updateEngagement(npc_ref);
        
        debug_pipeline("NPC_AI", `Created response from ${npc.name}`, {
            msg_id: response_msg.id,
            decision_source: decision_source,
            response_preview: npc_response.slice(0, 50)
        });
        
        // Log metric
        append_metric(data_slot_number, "npc_ai", {
            at: new Date().toISOString(),
            model: NPC_AI_MODEL,
            ok: true,
            duration_ms: ai_duration_ms,
            stage: "npc_response",
            session: session_key,
        });
    }

    if (communication_event) {
        mark_communication_event_evaluated(data_slot_number, communication_event.event_id);
    }
}

function reevaluate_npc_speech_turn(params: {
    npc_ref: string;
    queued_entry: { stable_order: number; social_role: string } | null;
    next_queue_entry: { participant_ref: string; stable_order: number } | null;
    speech_turn_context: { current_mode: string; transcript_recent: Array<{ speaker_ref: string; text: string }>; transcript_summary: string; participants: string[] } | null;
    forced_npc_id?: string | null;
}): { should_speak: boolean; reason: string } {
    if (!params.queued_entry) {
        return { should_speak: false, reason: "not_in_queue" };
    }
    if (params.next_queue_entry && params.next_queue_entry.participant_ref !== params.npc_ref) {
        return { should_speak: false, reason: "not_queue_front" };
    }
    const recent = params.speech_turn_context?.transcript_recent ?? [];
    const last_turn = recent.length > 0 ? recent[recent.length - 1] : null;
    if (last_turn && last_turn.speaker_ref === params.npc_ref && !params.forced_npc_id) {
        return { should_speak: false, reason: "already_spoke_last" };
    }
    return { should_speak: true, reason: params.speech_turn_context?.current_mode === "timed" ? "timed_queue_front" : "free_queue_front" };
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
const active_communication_ids = new Set<string>();

async function process_npc_movement_decisions(): Promise<void> {
    try {
        if (!(process_npc_movement_decisions as any).__server_authority_logged) {
            (process_npc_movement_decisions as any).__server_authority_logged = true;
            debug_log("NPC_AI", "Skipping legacy NPC movement decisions; server brain owns movement goals", {
                mode: "server_authoritative_goals",
            });
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
        const removed = inbox.messages.filter((msg: any) => msg?.type === "npc_position_update").length;
        if (removed > 0) {
            inbox.messages = inbox.messages.filter((msg: any) => msg?.type !== "npc_position_update");
            write_inbox(inbox_path, inbox);
            debug_log("NPC_AI", "Discarded legacy renderer npc_position_update messages", { removed });
        }
    } catch (err) {
        debug_error("NPC_AI", "process_npc_position_updates failed", err);
    }
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        // First, process position updates from renderer
        await process_npc_position_updates(inbox_path);

        const removed_duplicates = remove_duplicate_messages(outbox_path);
        if (removed_duplicates > 0) {
            debug_log("NPC_AI", "Removed duplicate outbox messages before communication processing", {
                removed_duplicates,
            });
        }
        
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
                            (msg.status === "sent" && ((msg.meta as any)?.intent_verb === "COMMUNICATE" || (msg.meta as any)?.service_kind === "queued_speech_turn"));
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
                (meta as any)?.intent_verb === "COMMUNICATE" ||
                (meta as any)?.service_kind === "queued_speech_turn";
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
            if (active_communication_ids.has(msg.id)) {
                debug_pipeline("NPC_AI", "Skipping candidate already active in this process", { id: msg.id });
                continue;
            }
            try {
                active_communication_ids.add(msg.id);
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
                const next_error_count = Math.max(1, Math.floor(Number((msg.meta as any)?.npc_error_count ?? 0)) + 1);
                const error_meta = {
                    ...(msg.meta ?? {}),
                    npc_error_count: next_error_count,
                    npc_last_error: err instanceof Error ? err.message : String(err),
                    npc_last_error_at: new Date().toISOString(),
                };
                if (next_error_count >= 3) {
                    const failed = try_set_message_status({ ...msg, meta: error_meta }, "error");
                    const final_msg = failed.ok ? failed.message : { ...msg, meta: error_meta };
                    update_outbox_message(outbox_path, final_msg);
                    debug_log("NPC_AI", "Marked communication message as error after repeated failures", {
                        id: msg.id,
                        error_count: next_error_count,
                        last_error: error_meta.npc_last_error,
                    });
                } else {
                    update_outbox_message(outbox_path, { ...msg, status: "sent", meta: error_meta });
                }
            } finally {
                active_communication_ids.delete(msg.id);
            }
        }
        
        // Note: Conversation responses are now handled entirely through process_communication()
        // which is called above for all applied_COMMUNICATE messages.
        // The witness system triggers real-time reactions via ActionPipeline broadcast (witness_handler).
        // Actual LLM responses come through process_communication().
        
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

    // Initialize engagement service for conversation management
    initEngagementService();
    debug_log("NPC_AI", "Engagement service initialized");

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("NPC_AI: booted", { outbox_path, inbox_path, model: NPC_AI_MODEL });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

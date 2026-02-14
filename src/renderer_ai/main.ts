import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, update_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_content, debug_warn, debug_pipeline, debug_error, DEBUG_LEVEL, log_ai_io_terminal, log_ai_io_file } from "../shared/debug.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { ACTION_VERBS, SERVICE_CONFIG } from "../shared/constants.js";
import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { append_metric } from "../engine/metrics_store.js";
import { get_region_by_coords } from "../world_storage/store.js";
import { load_place } from "../place_storage/store.js";
import { load_actor } from "../actor_storage/store.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const POLL_MS = SERVICE_CONFIG.POLL_MS.RENDERER;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? "llama3.2:latest";
// gpt-oss:20b is installed; swap back if you want higher quality.
const RENDERER_TIMEOUT_MS_RAW = Number(process.env.RENDERER_TIMEOUT_MS ?? 600_000);
const RENDERER_TIMEOUT_MS = Number.isFinite(RENDERER_TIMEOUT_MS_RAW) ? RENDERER_TIMEOUT_MS_RAW : 180_000;
const RENDERER_HISTORY_LIMIT = 12;
const RENDERER_KEEP_ALIVE = "30m";
const RENDERER_TEMPERATURE = 0.7;

type ChatTurn = { role: "user" | "assistant"; content: string };

const renderer_sessions = new Map<string, ChatTurn[]>();

const RENDERER_SYSTEM_PROMPT = [
    "You are the Renderer AI.",
    "Convert system effects and events into readable narrative for the player.",
    "Output narrative only. Do not output system syntax or code.",
    "Use the provided effects/events and recent context.",
    "If details are missing, infer minimally and stay consistent.",
    "If awareness is obscured, describe presence/direction only, not identity.",
    "Keep it concise and clear.",
    "NEVER add meta-commentary or break the 4th wall",
    "Only describe what the player character experiences in the moment.",
].join("\n");

function normalize_action_verb(v: string | null): string | null {
    if (!v) return null;
    const s = String(v).trim().toUpperCase();
    return s.length > 0 ? s : null;
}

function move_is_travelish(events: string[]): boolean {
    const joined = events.join(" ");
    // Heuristics: moving to a named place/region tile is travel; moving within a place tile grid is local.
    if (/\bregion_tile\./i.test(joined)) return true;
    if (/\bplace\.[a-z0-9_]+\.[a-z0-9_]+/i.test(joined)) return true;
    return false;
}

function move_has_notable_outcome(events: string[], effects: string[]): boolean {
    if (effects.length > 0) return true;
    const joined = `${events.join(" ")} ${effects.join(" ")}`.toLowerCase();
    // If something went wrong / changed state, narrate.
    if (joined.includes("blocked")) return true;
    if (joined.includes("fail")) return true;
    if (joined.includes("stumble")) return true;
    if (joined.includes("system.set_awareness")) return true;
    return false;
}

function should_skip_narration(action_verb: string | null, events: string[], effects: string[]): { skip: boolean; reason?: string } {
    const v = normalize_action_verb(action_verb);
    if (!v) return { skip: false };

    // MOVE within a place should not produce narration unless something notable happened.
    if (v === "MOVE") {
        if (!move_is_travelish(events) && !move_has_notable_outcome(events, effects)) {
            return { skip: true, reason: "MOVE.local.no_notable_outcome" };
        }
    }

    return { skip: false };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function get_session_key(msg: MessageEnvelope): string {
    const raw = typeof msg.correlation_id === "string" && msg.correlation_id.length > 0 ? msg.correlation_id : msg.id;
    return String(raw ?? msg.id);
}

function get_session_history(session_key: string): ChatTurn[] {
    return renderer_sessions.get(session_key) ?? [];
}

function append_session_turn(session_key: string, user_text: string, assistant_text: string): void {
    const history = [...get_session_history(session_key)];
    history.push({ role: "user", content: user_text }, { role: "assistant", content: assistant_text });
    if (history.length > RENDERER_HISTORY_LIMIT) {
        history.splice(0, history.length - RENDERER_HISTORY_LIMIT);
    }
    renderer_sessions.set(session_key, history);
}

function strip_code_fences(text: string): string {
    const fence_regex = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    if (!fence_regex.test(text)) return text;
    return text.replace(fence_regex, "$1");
}

function format_list(label: string, items: string[]): string {
    if (items.length === 0) return `${label}:\n- none`;
    return `${label}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function extract_obscured_awareness(effects: string[]): string[] {
    const matches: string[] = [];
    for (const line of effects) {
        if (!line.includes("SYSTEM.SET_AWARENESS")) continue;
        if (!line.includes("clarity=obscured")) continue;
        const target_match = line.match(/target=([^,\)]+)/);
        if (target_match && target_match[1]) matches.push(target_match[1]);
    }
    return matches;
}

// Helper function to convert region_tile references to region names
function resolveRegionName(target: string): string {
    // Check if this is a region_tile reference
    const regionMatch = target.match(/region_tile\.(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (regionMatch && regionMatch[1] && regionMatch[2] && regionMatch[3] && regionMatch[4]) {
        const world_x = parseInt(regionMatch[1], 10);
        const world_y = parseInt(regionMatch[2], 10);
        const region_x = parseInt(regionMatch[3], 10);
        const region_y = parseInt(regionMatch[4], 10);
        const regionResult = get_region_by_coords(
            data_slot_number,
            world_x,
            world_y,
            region_x,
            region_y
        );
        if (regionResult.ok && regionResult.region.name) {
            return regionResult.region.name as string;
        }
        // Fallback to coordinates if name not available
        return `region at ${world_x}.${world_y}.${region_x}.${region_y}`;
    }
    
    // Check if this is a place reference (e.g., place.eden_crossroads.tavern)
    const placeMatch = target.match(/place\.([^.]+)\.([^.]+)/);
    if (placeMatch) {
        const placeId = `${placeMatch[1]}_${placeMatch[2]}`;
        const placeResult = load_place(data_slot_number, placeId);
        if (placeResult.ok && placeResult.place.name) {
            return placeResult.place.name;
        }
    }
    
    return target;
}

// Helper function to get place details for rich descriptions
function getPlaceDetails(target: string, playerActorId?: string): { name: string; description: string; sensory: string; features: string } | null {
    // Try to extract place_id from various reference formats
    let placeId: string | null = null;
    
    // Format: place.<region>.<place>
    const placeMatch = target.match(/place\.([^.]+\.[^.]+)$/);
    if (placeMatch && placeMatch[1]) {
        placeId = placeMatch[1].replace(/\./g, '_');
    }
    
    // Format: place_tile.<region>.<place>.<x>.<y>
    const placeTileMatch = target.match(/place_tile\.([^.]+\.[^.]+)\./);
    if (placeTileMatch && placeTileMatch[1]) {
        placeId = placeTileMatch[1].replace(/\./g, '_');
    }
    
    // If target is a region_tile and player is provided, check if player is in a place in that region
    if (!placeId && target.includes("region_tile.")) {
        // Try to get the player's current place - default to henry_actor if not specified
        const actorToCheck = playerActorId || "henry_actor";
        const actorResult = load_actor(data_slot_number, actorToCheck);
        if (actorResult.ok) {
            const actorPlaceId = (actorResult.actor as any)?.location?.place_id;
            if (actorPlaceId) {
                placeId = actorPlaceId;
            }
        }
    }
    
    // If no place reference found, try to get actor's current place
    if (!placeId && target.includes("actor.")) {
        // Extract actor ID and load their place
        const actorMatch = target.match(/actor\.([^.]+)/);
        if (actorMatch && actorMatch[1]) {
            const actorResult = load_actor(data_slot_number, actorMatch[1]);
            if (actorResult.ok) {
                const actorPlaceId = (actorResult.actor as any)?.location?.place_id;
                if (actorPlaceId) {
                    placeId = actorPlaceId;
                }
            }
        }
    }
    
    if (!placeId) {
        return null;
    }
    
    const placeResult = load_place(data_slot_number, placeId);
    if (!placeResult.ok) {
        return null;
    }
    
    const place = placeResult.place;
    const desc = place.description;
    
    // Build sensory description
    const sensoryParts: string[] = [];
    if (desc?.sensory?.sight?.length) {
        sensoryParts.push(`You see: ${desc.sensory.sight.join(', ')}.`);
    }
    if (desc?.sensory?.sound?.length) {
        sensoryParts.push(`You hear: ${desc.sensory.sound.join(', ')}.`);
    }
    if (desc?.sensory?.smell?.length) {
        sensoryParts.push(`The air smells of: ${desc.sensory.smell.join(', ')}.`);
    }
    if (desc?.sensory?.touch?.length) {
        sensoryParts.push(`You feel: ${desc.sensory.touch.join(', ')}.`);
    }
    
    // Build features list
    const featureParts: string[] = [];
    if (place.contents?.features?.length) {
        for (const feature of place.contents.features) {
            featureParts.push(`${feature.name}: ${feature.description}`);
        }
    }
    
    return {
        name: place.name || placeId,
        description: desc?.full || desc?.short || `You are in ${placeId}.`,
        sensory: sensoryParts.join(' ') || 'The surroundings are unremarkable.',
        features: featureParts.join('\n') || 'No notable features.'
    };
}

// Action-specific narrative generators for THAUMWORLD
// Current implementation covers: INSPECT, ATTACK, COMMUNICATE, MOVE, USE
// TODO: Add remaining generators from ACTION_VERBS constant

function generateInspectNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
    context?: Record<string, unknown>;
}): string {
    const ctx = params.context ?? {};
    const ir = (ctx as any).inspect_result as any;
    if (ir && typeof ir === "object") {
        const clarity = String(ir.clarity ?? "unknown");
        const sense = String(ir.sense_used ?? "unknown");
        const short_desc = String(ir?.content?.short_description ?? "").trim();
        const full_desc = String(ir?.content?.full_description ?? "").trim();
        const features = Array.isArray(ir?.content?.features) ? ir.content.features : [];

        const feature_lines = features
            .filter((f: any) => !!f && f.discovered === true)
            .slice(0, 6)
            .map((f: any) => `- ${String(f.description ?? f.name ?? "").trim()}`)
            .filter((s: string) => s.length > 2)
            .join("\n");

        const sensory = ir?.content?.sensory_details;
        const sensory_lines: string[] = [];
        if (sensory && typeof sensory === "object") {
            for (const k of Object.keys(sensory)) {
                const arr = (sensory as any)[k];
                if (Array.isArray(arr) && arr.length > 0) {
                    sensory_lines.push(`${k}: ${arr.slice(0, 6).join(", ")}`);
                }
            }
        }

        return `The player inspects a target. Use ONLY the provided inspection result.

INSPECTION RESULT:
Clarity: ${clarity}
Sense: ${sense}
Short: ${short_desc || "(none)"}
Full: ${full_desc || "(none)"}
Sensory: ${sensory_lines.length > 0 ? sensory_lines.join(" | ") : "(none)"}
Notable features (discovered only):
${feature_lines || "- (none)"}

Write 1-2 concise sentences in second person.
Do NOT invent new features, items, identities, or facts.
If clarity is vague/obscured, keep it restrained and do not add extra detail beyond Short/Sensory/Notable features.`;
    }

    // Fallback: older, less-structured prompt.
    const rawTarget = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "the area";
    const target = resolveRegionName(rawTarget);
    const hasFindings = params.effects.length > 0;

    return `The player is inspecting ${target}.
${hasFindings ? "They discover something noteworthy." : "They find nothing of particular interest."}

Write a brief narrative (1-2 sentences) in second person.
Do not invent specific findings unless explicitly provided in the input.`;
}

function generateAttackNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const rawTarget = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "the target";
    const target = resolveRegionName(rawTarget);
    const weapon = params.events[0]?.match(/tool=([^,)]+)/)?.[1]?.split('.').pop() || "their weapon";
    const damageEffects = params.effects.filter(e => e.includes("APPLY_DAMAGE"));
    const hit = damageEffects.length > 0;
    
    return `The player attacks ${target} using ${weapon}.
${hit 
    ? "The attack connects and deals damage. Describe the impact and the target's reaction."
    : "The attack misses or fails to connect. Describe the near-miss or the target's evasion."}

Write a dynamic combat narrative (1-3 sentences).
Use active, visceral language.
Describe the motion of the attack and the immediate result.
Write in second person ("You swing...", "Your strike...").`;
}

function generateCommunicateNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
    context?: Record<string, unknown>;
}): string {
    const ctx = params.context ?? {};

    const text = params.events[0]?.match(/text="([^"]+)"/)?.[1] || params.original_text || "something";
    const actor_ref = typeof (ctx as any).actor_ref === "string" ? ((ctx as any).actor_ref as string) : "actor.unknown";
    const target_ref = typeof (ctx as any).target_ref === "string" ? ((ctx as any).target_ref as string) : null;
    const volume = typeof (ctx as any).intent_subtype === "string" ? ((ctx as any).intent_subtype as string) : "NORMAL";
    const conversation_phase = typeof (ctx as any).conversation_phase === "string" ? ((ctx as any).conversation_phase as string) : "mid";
    const observed_by = Array.isArray((ctx as any).observed_by) ? ((ctx as any).observed_by as unknown[]) : [];
    const heard_by = observed_by
        .filter((r) => typeof r === "string")
        .map((r) => (r as string).split(".").pop() ?? (r as string));

    const actor_id = actor_ref.startsWith("actor.") ? actor_ref.slice("actor.".length) : actor_ref;
    const target_name = target_ref ? target_ref.split(".").pop() ?? target_ref : null;

    let locationContext = "";
    let placeDetailsText = "";
    try {
        const actorResult = load_actor(data_slot_number, actor_id);
        if (actorResult.ok) {
            const placeId = (actorResult.actor as any)?.location?.place_id;
            if (placeId) {
                const placeResult = load_place(data_slot_number, placeId);
                if (placeResult.ok) {
                    const placeName = placeResult.place.name || placeId;
                    locationContext = `\nCURRENT LOCATION: ${placeName}`;

                    const desc = ((placeResult.place as any).description ?? "").toString().trim();
                    const sensory = ((placeResult.place as any).sensory ?? "").toString().trim();
                    const features = Array.isArray((placeResult.place as any).features)
                        ? ((placeResult.place as any).features as unknown[]).slice(0, 6).join(", ")
                        : "";

                    const parts = [
                        desc ? `Description: ${desc}` : "",
                        sensory ? `Sensory: ${sensory}` : "",
                        features ? `Features: ${features}` : "",
                    ].filter(p => p.length > 0);

                    if (parts.length > 0) {
                        placeDetailsText = `\nPLACE CONTEXT:\n${parts.join("\n")}`;
                    }
                }
            }
        }
    } catch {
        // best-effort only
    }

    const addressing = target_name ? `to ${target_name}` : "into the air";

    return `The player speaks ${addressing}.${locationContext}${placeDetailsText}
Spoken text: "${text}"
Volume: ${volume}
Conversation phase: ${conversation_phase}
Heard by: ${heard_by.length > 0 ? heard_by.join(", ") : "(nobody)"}

Write exactly 2 lines of narration.
Line 1: describe the act of speaking (tone, volume, intent).
Line 2: describe the immediate social beat (someone hears/turns/reacts if Heard by is not (nobody), otherwise the emptiness).
Do NOT invent spoken replies or quotes from NPCs; dialogue will be provided separately by NPC response lines.
Do NOT mention specific objects or events unless explicitly present in PLACE CONTEXT or the input fields.
Stay grounded in the provided context; do not invent new world facts.
Write in second person.`;
}

function generateMoveNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const rawDestination = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "a new location";
    const destination = resolveRegionName(rawDestination);
    const mode = params.events[0]?.match(/mode="([^"]+)"/)?.[1] || "walk";
    
    // Extract actor ID from event (e.g., "actor.henry_actor.MOVE...")
    const actorMatch = params.events[0]?.match(/actor\.([^.]+)\./);
    const actorId = actorMatch?.[1];
    
    // Get place details for the destination
    const placeDetails = getPlaceDetails(rawDestination, actorId);
    
    let placeContext = "";
    if (placeDetails) {
        placeContext = `
DESTINATION DETAILS:
Name: ${placeDetails.name}
Description: ${placeDetails.description}
Sensory: ${placeDetails.sensory}
Features: ${placeDetails.features}`;
    }
    
    const travelish = move_is_travelish(params.events);

    if (!travelish) {
        return `The player moves locally within the current place.
Events: ${params.events.join(", ") || "none"}
Effects: ${params.effects.join(", ") || "none"}

If nothing notable occurs, write exactly 0 lines (output nothing).
If something notable occurs (blocked path, stumble, bumped into someone, sudden sensation), write 1-2 concise sentences.
Write in second person.`;
    }

    return `The player ${mode}s toward ${destination}.${placeContext}

Write a travel narrative (2-4 sentences) describing their movement and arrival.
Describe the journey briefly, then focus on their arrival and the new surroundings.
${placeDetails ? "Use the sensory details and features of the destination provided above." : "Use sensory details about the environment."}
Write in second person ("You make your way...", "You arrive at...", "Before you stands...").`;
}

function generateUseNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const tool = params.events[0]?.match(/tool=([^,)]+)/)?.[1]?.split('.').pop() || "the item";
    const hasEffects = params.effects.length > 0;
    
    return `The player uses ${tool}.
${hasEffects 
    ? "The item produces a noticeable effect. Describe what happens when they use it."
    : "They attempt to use it but nothing significant occurs."}

Write an item interaction narrative (1-3 sentences).
Describe the physical interaction and any results.
Write in second person.`;
}

function generateGenericNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    return `The player attempts: "${params.original_text || 'an action'}"

Something happens but produces no significant effects or changes.
Write a brief narrative (1-3 sentences) acknowledging the attempt.
Describe why nothing notable occurs (wrong context, no target, already done, etc.).
Keep it informative but atmospheric.
Write in second person.`;
}

function build_renderer_prompt(params: {
    original_text: string;
    machine_text: string;
    events: string[];
    effects: string[];
    action_verb: string | null;
    context?: Record<string, unknown>;
}): string {
    // Route to action-specific narrative generator
    switch (params.action_verb) {
        case "INSPECT":
            return generateInspectNarrativePrompt({
                original_text: params.original_text,
                events: params.events,
                effects: params.effects,
                context: params.context,
            });
        case "ATTACK":
            return generateAttackNarrativePrompt(params);
        case "COMMUNICATE":
            return generateCommunicateNarrativePrompt({
                original_text: params.original_text,
                events: params.events,
                effects: params.effects,
                context: params.context,
            });
        case "MOVE":
            return generateMoveNarrativePrompt(params);
        case "USE":
            return generateUseNarrativePrompt(params);
        default:
            return generateGenericNarrativePrompt(params);
    }
}

async function run_renderer_ai(params: {
    msg: MessageEnvelope;
    original_text: string;
    machine_text: string;
    events: string[];
    effects: string[];
    action_verb: string | null;
    context?: Record<string, unknown>;
}): Promise<string> {
    const session_key = get_session_key(params.msg);
    const history = get_session_history(session_key);
    const started = Date.now();
    const user_prompt = build_renderer_prompt({
        original_text: params.original_text,
        machine_text: params.machine_text,
        events: params.events,
        effects: params.effects,
        action_verb: params.action_verb,
        context: params.context,
    });

    const messages: OllamaMessage[] = [
        { role: "system", content: RENDERER_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: user_prompt },
    ];

    debug_log("RendererAI: request", {
        model: RENDERER_MODEL,
        session: session_key,
        history: history.length,
    });

    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: RENDERER_MODEL,
            messages,
            keep_alive: RENDERER_KEEP_ALIVE,
            timeout_ms: RENDERER_TIMEOUT_MS,
            options: { temperature: RENDERER_TEMPERATURE },
        });

        debug_log("RendererAI: response", {
            model: response.model,
            session: session_key,
            duration_ms: response.duration_ms,
            chars: response.content.length,
        });

        let cleaned = strip_code_fences(response.content).trim();

        // Keep COMMUNICATE narration tight (2 lines max).
        if (params.action_verb === "COMMUNICATE") {
            const lines = cleaned.split("\n").map(l => l.trim()).filter(l => l.length > 0);
            cleaned = lines.slice(0, 2).join("\n");
        }
        
        // AI I/O Logging
        const fullPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const inputSummary = params.original_text || params.events.join(', ').slice(0, 50);
        log_ai_io_terminal(
            'renderer',
            inputSummary,
            cleaned,
            response.duration_ms,
            session_key,
            fullPrompt,
            response.content
        );
        log_ai_io_file(data_slot_number, {
            timestamp: new Date().toISOString(),
            service: 'renderer',
            session_id: session_key,
            input_summary: inputSummary,
            output_summary: cleaned,
            duration_ms: response.duration_ms,
            prompt_chars: fullPrompt.length,
            response_chars: response.content.length,
            full_prompt: fullPrompt,
            full_response: response.content,
            metadata: {
                model: response.model,
                event_count: params.events.length,
                effect_count: params.effects.length,
                original_text: params.original_text,
                machine_text: params.machine_text,
            }
        });
        
        append_session_turn(session_key, user_prompt, cleaned.length > 0 ? cleaned : response.content.trim());
        append_metric(data_slot_number, "renderer_ai", {
            at: new Date().toISOString(),
            model: response.model,
            ok: true,
            duration_ms: response.duration_ms,
            stage: "render",
            session: session_key,
        });
        return cleaned;
    } catch (err) {
        const duration_ms = Date.now() - started;
        debug_warn("RendererAI: request failed", {
            model: RENDERER_MODEL,
            session: session_key,
            error: err instanceof Error ? err.message : String(err),
        });
        append_metric(data_slot_number, "renderer_ai", {
            at: new Date().toISOString(),
            model: RENDERER_MODEL,
            ok: false,
            duration_ms,
            stage: "render",
            session: session_key,
            error: err instanceof Error ? err.message : String(err),
        });
        return "";
    }
}

// Note: update_outbox_message is now imported from outbox_store.ts for consistency

async function process_message(outbox_path: string, inbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    debug_log("Renderer: received", { id: msg.id, status: msg.status, stage: msg.stage });

    // Best-effort lock (prevents double-processing if the same message is seen twice).
    const now_ms = Date.now();
    const meta0 = (msg.meta as Record<string, unknown> | undefined) ?? {};
    const lock_at = typeof meta0.render_lock_at_ms === "number" ? (meta0.render_lock_at_ms as number) : null;
    if (lock_at !== null && Number.isFinite(lock_at) && now_ms - lock_at < 30_000) {
        return;
    }

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;

    processing.message.meta = {
        ...(processing.message.meta ?? {}),
        render_lock_at_ms: now_ms,
    };
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const meta = (processing.message.meta as Record<string, unknown> | undefined) ?? {};
    const effects = Array.isArray(meta?.effects) ? (meta.effects as string[]) : [];
    const events = Array.isArray(meta?.events) ? (meta.events as string[]) : [];
    const original_text = typeof meta?.original_text === "string" ? (meta.original_text as string) : "";
    const machine_text = typeof meta?.machine_text === "string" ? (meta.machine_text as string) : "";
    const action_verb =
        (typeof meta?.action_verb === "string" ? (meta.action_verb as string) : null) ??
        (typeof (meta as any)?.intent_verb === "string" ? ((meta as any).intent_verb as string) : null);
    const action_verb_norm = normalize_action_verb(action_verb);

    const renderer_context = typeof (meta as any)?.renderer_context === "object" && (meta as any).renderer_context !== null
        ? ((meta as any).renderer_context as Record<string, unknown>)
        : {
            actor_ref: (meta as any)?.actor_ref,
            target_ref: (meta as any)?.target_ref,
            intent_subtype: (meta as any)?.intent_subtype,
            observed_by: (meta as any)?.observed_by,
            response_eligible_by: (meta as any)?.response_eligible_by,
            conversation_phase: (meta as any)?.conversation_phase,
        };

    if (effects.length > 0) {
        debug_log("Renderer: effects", { id: msg.id, effects });
    }
    
    debug_log("Renderer: action detected", { id: msg.id, action_verb: action_verb || "unknown" });

    // Narration routing by action type: some actions should not emit narration unless notable.
    const skip = should_skip_narration(action_verb_norm, events, effects);
    if (skip.skip) {
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            done.message.meta = {
                ...(done.message.meta ?? {}),
                rendered: true,
                rendered_skipped: true,
                rendered_skip_reason: skip.reason ?? "unknown",
            };
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        debug_log("Renderer: narration skipped", { id: msg.id, action_verb: action_verb_norm, reason: skip.reason });
        await sleep(0);
        return;
    }

    // Log the exact input being sent to renderer
    console.log(`\n[RENDERER_AI] =========================================`);
    console.log(`[RENDERER_AI] Input:  "${original_text}"`);
    console.log(`[RENDERER_AI] Action: ${action_verb || "unknown"}`);
    console.log(`[RENDERER_AI] Events: ${events.join(", ") || "none"}`);
    console.log(`[RENDERER_AI] =========================================\n`);

    const response_text = await run_renderer_ai({
        msg: processing.message,
        original_text,
        machine_text,
        events,
        effects,
        action_verb: action_verb_norm,
        context: renderer_context,
    });
    const content = response_text.length > 0 ? response_text : "Narration unavailable.";
    
    // Log the exact output from renderer
    console.log(`\n[RENDERER_AI] =========================================`);
    console.log(`[RENDERER_AI] Output: ${content.substring(0, 100)}${content.length > 100 ? "..." : ""}`);
    console.log(`[RENDERER_AI] =========================================\n`);
    
    debug_content("Renderer Out", content);
    const output: MessageInput = {
        sender: "renderer_ai",
        content,
        stage: "rendered_1",
        status: "sent",
        reply_to: msg.id,
        meta: {
            ...getSessionMeta(),
            events,
            effects,
        },
    };

    if (msg.correlation_id !== undefined) output.correlation_id = msg.correlation_id;
    if (msg.conversation_id !== undefined) output.conversation_id = msg.conversation_id;
    if (msg.turn_number !== undefined) output.turn_number = msg.turn_number;
    output.role = "renderer";
    const rendered = create_message(output);
    append_inbox_message(inbox_path, rendered);
    append_log_envelope(log_path, rendered);
    debug_log("Renderer: output sent to inbox and log", { id: rendered.id, stage: rendered.stage, content: rendered.content });

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        done.message.meta = {
            ...(done.message.meta ?? {}),
            rendered: true,
        };
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
    }

    await sleep(0);
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);
        
        if (DEBUG_LEVEL >= 4) {
            debug_pipeline("Renderer", "polling", { messageCount: outbox.messages.length });
        }
        
        const candidates = outbox.messages.filter((m) => {
            if (!m.stage?.startsWith("applied_")) return false;
            if ((m.meta as any)?.rendered === true) return false;
            // Only process stable "ready" messages. Never re-process "processing".
            if ((m.status === "sent" || m.status === "done") && isCurrentSession(m)) return true;
            return false;
        });

        if (candidates.length > 0) {
            debug_pipeline("Renderer", `found ${candidates.length} applied candidates`, {
                ids: candidates.map(m => m.id),
                stages: candidates.map(m => m.stage),
                statuses: candidates.map(m => m.status)
            });
        }

        for (const msg of candidates) {
            debug_pipeline("Renderer", "processing message", { 
                id: msg.id, 
                stage: msg.stage, 
                status: msg.status,
                sender: msg.sender 
            });
            
            try {
                await process_message(outbox_path, inbox_path, log_path, msg);
            } catch (err) {
                debug_error("Renderer", `Failed to process message ${msg.id}`, err);
            }
        }
    } catch (err) {
        debug_error("Renderer", "Tick failed", err);
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
debug_log("Renderer: booted", { outbox_path, inbox_path });
    debug_log("RendererAI: config", {
        model: RENDERER_MODEL,
        host: OLLAMA_HOST,
        history_limit: RENDERER_HISTORY_LIMIT,
        timeout_ms: RENDERER_TIMEOUT_MS,
    });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

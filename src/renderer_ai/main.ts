import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_content, debug_warn, debug_pipeline, debug_error, DEBUG_LEVEL, log_ai_io_terminal, log_ai_io_file } from "../shared/debug.js";
import { isCurrentSession, getSessionMeta } from "../shared/session.js";
import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { append_metric } from "../engine/metrics_store.js";

const data_slot_number = 1;
const POLL_MS = 800;
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
].join("\n");

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

// Action-specific narrative generators for THAUMWORLD
// TODO: Add remaining verbs: HELP, DEFEND, GRAPPLE, DODGE, CRAFT, SLEEP, REPAIR, WORK, GUARD, HOLD

function generateInspectNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const target = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "the area";
    const hasFindings = params.effects.length > 0;
    
    return `The player is inspecting ${target}.
${hasFindings 
    ? "They discover something noteworthy. Describe what they find in detail."
    : "They find nothing of particular interest. Describe the mundane details of what they observe."}

Write a descriptive narrative (1-3 sentences) of what they see, hear, or notice.
Use sensory details appropriate to the location.
Write in second person ("You see...", "You notice...").
Keep it immersive and atmospheric.`;
}

function generateAttackNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const target = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "the target";
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
}): string {
    const text = params.events[0]?.match(/text="([^"]+)"/)?.[1] || params.original_text || "something";
    const targets = params.events[0]?.match(/targets=\[([^\]]*)\]/)?.[1];
    const hasTarget = targets && targets.length > 0 && !targets.includes("[]");
    
    return `The player says: "${text}"
${hasTarget 
    ? "They are speaking to someone present. Describe how they deliver the message and the context."
    : "They speak but there's no one around to hear. Describe their words echoing into the silence."}

Write a narrative (1-3 sentences) describing the communication.
Include the tone and manner of speaking.
${hasTarget ? "Set up the scene for the NPC's response." : "Convey the emptiness or solitude of the moment."}
Write in second person.`;
}

function generateMoveNarrativePrompt(params: {
    original_text: string;
    events: string[];
    effects: string[];
}): string {
    const destination = params.events[0]?.match(/target=([^,)]+)/)?.[1] || "a new location";
    const mode = params.events[0]?.match(/mode="([^"]+)"/)?.[1] || "walk";
    
    return `The player ${mode}s toward ${destination}.

Write a travel narrative (1-3 sentences) describing their movement.
Describe the terrain, the journey, and their arrival.
Use sensory details about the environment.
Write in second person ("You make your way...", "You arrive at...").`;
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
}): string {
    // Route to action-specific narrative generator
    switch (params.action_verb) {
        case "INSPECT":
            return generateInspectNarrativePrompt(params);
        case "ATTACK":
            return generateAttackNarrativePrompt(params);
        case "COMMUNICATE":
            return generateCommunicateNarrativePrompt(params);
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

        const cleaned = strip_code_fences(response.content).trim();
        
        // AI I/O Logging
        const fullPrompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const inputSummary = params.original_text || params.events.join(', ').slice(0, 50);
        log_ai_io_terminal(
            'renderer',
            inputSummary,
            cleaned,
            response.duration_ms,
            session_key
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

function update_outbox_message(outbox_path: string, updated: MessageEnvelope): void {
    const outbox = read_outbox(outbox_path);
    const idx = outbox.messages.findIndex((m) => m.id === updated.id);
    if (idx === -1) return;
    outbox.messages[idx] = updated;
    const pruned = prune_outbox_messages(outbox, 10);
    write_outbox(outbox_path, pruned);
}

async function process_message(outbox_path: string, inbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    debug_log("Renderer: received", { id: msg.id, status: msg.status, stage: msg.stage });

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const meta = (msg.meta as Record<string, unknown> | undefined) ?? {};
    const effects = Array.isArray(meta?.effects) ? (meta.effects as string[]) : [];
    const events = Array.isArray(meta?.events) ? (meta.events as string[]) : [];
    const original_text = typeof meta?.original_text === "string" ? (meta.original_text as string) : "";
    const machine_text = typeof meta?.machine_text === "string" ? (meta.machine_text as string) : "";
    const action_verb = typeof meta?.action_verb === "string" ? (meta.action_verb as string) : null;

    if (effects.length > 0) {
        debug_log("Renderer: effects", { id: msg.id, effects });
    }
    
    debug_log("Renderer: action detected", { id: msg.id, action_verb: action_verb || "unknown" });

    const response_text = await run_renderer_ai({
        msg: processing.message,
        original_text,
        machine_text,
        events,
        effects,
        action_verb,
    });
    const content = response_text.length > 0 ? response_text : "Narration unavailable.";
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

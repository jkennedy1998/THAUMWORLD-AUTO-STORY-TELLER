import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_content, debug_warn } from "../shared/debug.js";
import { find_actors } from "../actor_storage/store.js";
import { find_npcs } from "../npc_storage/store.js";
import { append_metric } from "../engine/metrics_store.js";
import { ollama_chat, type OllamaMessage } from "../shared/ollama_client.js";
import { get_status_path } from "../engine/paths.js";
import { ensure_status_exists, write_status_line } from "../engine/status_store.js";

const data_slot_number = 1;
const POLL_MS = 800;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const INTERPRETER_MODEL = process.env.INTERPRETER_MODEL ?? "llama3.2:latest";
// gpt-oss:20b is installed; swap back if you want higher quality.
const INTERPRETER_TIMEOUT_MS_RAW = Number(process.env.INTERPRETER_TIMEOUT_MS ?? 600_000);
const INTERPRETER_TIMEOUT_MS = Number.isFinite(INTERPRETER_TIMEOUT_MS_RAW) ? INTERPRETER_TIMEOUT_MS_RAW : 180_000;
const INTERPRETER_HISTORY_LIMIT = 12;
const INTERPRETER_KEEP_ALIVE = "30m";
const INTERPRETER_TEMPERATURE = 0.2;

type ChatTurn = { role: "user" | "assistant"; content: string };

const interpreter_sessions = new Map<string, ChatTurn[]>();

const INTERPRETER_SYSTEM_PROMPT = [
    "You are the Interpreter AI for a tabletop RPG system.",
    "Convert human input into strict machine-readable system text.",
    "Output ONLY machine text. One command per line. No prose. No markdown.",
    "Syntax: <subject>.<VERB>(key=value, ...).",
    "All arguments must be named key=value pairs. Positional args are forbidden.",
    "Subjects are refs (actor, npc, item, tile, etc). Verbs are uppercase actions or SYSTEM.*.",
    "Strings must be double-quoted. Lists use [a, b]. Objects use {k=v}.",
    "Use actor.<id> (from the active actor in the save slot) as the subject.",
    "Action verbs: USE, ATTACK, HELP, DEFEND, GRAPPLE, INSPECT, COMMUNICATE, DODGE, CRAFT, SLEEP, REPAIR, MOVE, WORK, GUARD, HOLD.",
    "System verbs: SYSTEM.APPLY_TAG, SYSTEM.REMOVE_TAG, SYSTEM.ADJUST_RESOURCE, SYSTEM.ADJUST_STAT, SYSTEM.APPLY_DAMAGE, SYSTEM.APPLY_HEAL, SYSTEM.ADVANCE_TIME (and other SYSTEM.* verbs).",
    "If unsure, choose the smallest valid command that matches intent.",
    "All greetings or conversational speech must use COMMUNICATE, not SYSTEM.*.",
    "Bad: SYSTEM.APPLY_TAG(actor.tjem, \"player\", key=\"greeting\")",
    "Good: actor.<id>.COMMUNICATE(tool=actor.<id>.voice, targets=[npc.default_npc], text=\"hello\", language=lang.common, senses=[pressure], tone=\"neutral\", contexts=[region_tile.0.0.0.0])",
    "Example: actor.MOVE(target=tile.loc.market.5.12, tool=actor.self.hands, mode=\"walk\")",
].join("\n");

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pre_tweak(msg: MessageEnvelope): MessageEnvelope {
    return msg;
}

const ITERATION_LIMIT = 5;

const COMMAND_MAP: Record<string, string> = {
    "1": "henry_actor.ATTACK(target=npc.shopkeep, tool=henry_actor.inventory.item_9x3k2q, action_cost=FULL, roll={type=RESULT, dice=\"D20\", effectors=[], target_cr=10}, potency={type=POTENCY, mag=1, dice=\"1d2\", effectors=[]})",
    "2": "henry_actor.CRAFT(tool=henry_actor.inventory.item_kit_2mag, components=[henry_actor.inventory.item_ing_a1, henry_actor.inventory.item_ing_a2], result=henry_actor.inventory.item_potion_flinch, action_cost=EXTENDED, roll={type=RESULT, dice=\"D20\", effectors=[], target_cr=10}, tags=[{name=FLINCH, mag=2, info=[]}])",
    "3": "henry_actor.COMMUNICATE(tool=henry_actor.voice, targets=[npc.shopkeep], text=\"hey, whats on the food menu today?\", language=lang.common, senses=[pressure], tone=\"curious\", contexts=[region_tile.0.0.0.0])",
    "4": "henry_actor.MOVE(target=tile.loc.forest.10.12, tool=henry_actor.hands, mode=walk, action_cost=FULL)",
    "5": "henry_actor.USE(target=henry_actor.inventory.item_torch, tool=henry_actor.hands, action_cost=PARTIAL, roll={type=RESULT, dice=\"D20\", effectors=[], target_cr=0})",
    "6": "henry_actor.INSPECT(target=tile.loc.cave.4.9, tool=henry_actor.hands, roll={type=RESULT, dice=\"D20\", effectors=[], target_cr=10})",
    "7": "henry_actor.GRAPPLE(target=npc.shopkeep, tool=henry_actor.hands, roll={type=RESULT, dice=\"D20\", effectors=[], target_cr=12}, size_delta=0, action_cost=FULL)",
    "8": "henry_actor.DEFEND(target=henry_actor, tool=henry_actor.hands, potency={type=POTENCY, mag=1, dice=\"1d2\", effectors=[]}, potency_applies_to=henry_actor.evasion, duration=1, unit=TURN)",
    "9": "henry_actor.SLEEP(tool=henry_actor.body, potency={type=POTENCY, mag=1, dice=\"1d2\", effectors=[]}, consumes=[{resource=VIGOR, mag=1, optional=true}], action_cost=EXTENDED)",
    "10": "henry_actor.HOLD(tool=henry_actor.hands, verb=ATTACK, action_cost=FULL, condition={type=ACTION, target=npc.shopkeep.action, op=EQUALS, value=\"open_mouth\"})",
};

function get_session_key(msg: MessageEnvelope): string {
    const raw = typeof msg.correlation_id === "string" && msg.correlation_id.length > 0 ? msg.correlation_id : msg.id;
    return String(raw ?? msg.id);
}

function get_session_history(session_key: string): ChatTurn[] {
    return interpreter_sessions.get(session_key) ?? [];
}

function append_session_turn(session_key: string, user_text: string, assistant_text: string): void {
    const history = [...get_session_history(session_key)];
    history.push({ role: "user", content: user_text }, { role: "assistant", content: assistant_text });
    if (history.length > INTERPRETER_HISTORY_LIMIT) {
        history.splice(0, history.length - INTERPRETER_HISTORY_LIMIT);
    }
    interpreter_sessions.set(session_key, history);
}

function format_error_list(errors: unknown[]): string {
    if (!errors || errors.length === 0) return "- none";
    return errors
        .map((err) => {
            if (typeof err === "string") return `- ${err}`;
            if (err && typeof err === "object") return `- ${JSON.stringify(err)}`;
            return `- ${String(err)}`;
        })
        .join("\n");
}

function build_interpreter_prompt(params: {
    text: string;
    is_refinement: boolean;
    error_reason: string | undefined;
    errors: unknown[] | undefined;
    previous_machine_text: string | undefined;
    intent: Intent;
    communicate_template: string | undefined;
}): string {
    if (!params.is_refinement) {
        const base = ["Human input:", params.text, "", "Return machine text only."];
        if (params.intent === "communicate" && params.communicate_template) {
            base.push("", "Use COMMUNICATE for greetings and speech.", "Template:", params.communicate_template);
        }
        return base.join("\n").trim();
    }

    const error_reason = params.error_reason ?? "unknown";
    const errors = format_error_list(params.errors ?? []);
    const previous_machine_text = params.previous_machine_text?.trim();
    const machine_text_block = previous_machine_text
        ? ["Previous machine text:", previous_machine_text].join("\n")
        : "Previous machine text: (none)";

    const lines = [
        "The data broker reported errors in the machine text.",
        "Original input:",
        params.text,
        "",
        machine_text_block,
        "",
        `Error reason: ${error_reason}`,
        "Errors:",
        errors,
        "",
        "Rewrite the machine text so it parses correctly.",
        "Return machine text only.",
    ];
    if (params.intent === "communicate" && params.communicate_template) {
        lines.push("", "Use COMMUNICATE for greetings and speech.", "Template:", params.communicate_template);
    }
    return lines.join("\n").trim();
}

function strip_code_fences(text: string): string {
    const fence_regex = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    if (!fence_regex.test(text)) return text;
    return text.replace(fence_regex, "$1");
}

function strip_list_prefix(line: string): string {
    return line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "");
}

function is_command_line(line: string): boolean {
    return /^[A-Za-z0-9_.]+\.[A-Z_]+\(.*\)$/.test(line);
}

function get_command_args(line: string): string {
    const start = line.indexOf("(");
    const end = line.lastIndexOf(")");
    if (start === -1 || end === -1 || end <= start) return "";
    return line.slice(start + 1, end).trim();
}

function has_positional_args(line: string): boolean {
    const args = get_command_args(line);
    if (!args) return false;
    const first = args.split(",")[0] ?? "";
    return first.length > 0 && !first.includes("=");
}

function has_named_args(line: string): boolean {
    const args = get_command_args(line);
    if (!args) return false;
    return args.includes("=");
}

function replace_outside_quotes(input: string, regex: RegExp, replacement: string): string {
    const parts = input.split('"');
    for (let i = 0; i < parts.length; i += 2) {
        parts[i] = parts[i]?.replace(regex, replacement) ?? "";
    }
    return parts.join('"');
}

function normalize_jsonc_refs(line: string): { line: string; changed: boolean } {
    if (!line.includes(".jsonc")) return { line, changed: false };
    const replaced = replace_outside_quotes(line, /\.jsonc\b/g, "");
    return { line: replaced, changed: replaced !== line };
}

function get_command_subject(line: string): string {
    const dot = line.indexOf(".");
    if (dot === -1) return "";
    return line.slice(0, dot);
}

function get_command_verb(line: string): string {
    const match = /^[A-Za-z0-9_.]+\.([A-Z_]+)\(/.exec(line);
    return match?.[1] ?? "";
}

function has_arg(line: string, arg: string): boolean {
    const args = get_command_args(line);
    if (!args) return false;
    const re = new RegExp(`(^|,|\n)\s*${arg}\s*=`);
    return re.test(args);
}

function add_arg(line: string, arg: string, value: string): string {
    const start = line.lastIndexOf("(");
    const end = line.lastIndexOf(")");
    if (start === -1 || end === -1 || end <= start) return line;
    const before = line.slice(0, end);
    const args = line.slice(start + 1, end).trim();
    const prefix = args.length > 0 ? ", " : "";
    return `${before}${prefix}${arg}=${value})`;
}

function default_tool_for_verb(verb: string, actor_ref: string): string | null {
    if (!verb) return null;
    if (verb === "COMMUNICATE") return `${actor_ref}.voice`;
    return `${actor_ref}.hands`;
}

type LineIssue = "invalid_line" | "positional_args" | "missing_tool";

function normalize_command_line(
    line: string,
    actor_ref: string,
    apply_defaults: boolean,
): { line: string; issues: LineIssue[]; changed: boolean } {
    const issues: LineIssue[] = [];
    if (!is_command_line(line)) return { line, issues: ["invalid_line"], changed: false };

    let next = line;
    let changed = false;

    const normalized = normalize_jsonc_refs(next);
    next = normalized.line;
    if (normalized.changed) changed = true;

    if (has_positional_args(next)) issues.push("positional_args");

    const verb = get_command_verb(next);
    const subject = get_command_subject(next);
    const is_system = subject === "SYSTEM" || verb.startsWith("SYSTEM");
    if (!is_system) {
        const tool = default_tool_for_verb(verb, actor_ref);
        if (tool && !has_arg(next, "tool")) {
            issues.push("missing_tool");
            if (apply_defaults) {
                next = add_arg(next, "tool", tool);
                changed = true;
            }
        }
    }

    return { line: next, issues, changed };
}

function normalize_machine_text(
    text: string,
    actor_ref: string,
    apply_defaults: boolean,
): { text: string; issues: LineIssue[]; changed: boolean } {
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const out: string[] = [];
    const issues: LineIssue[] = [];
    let changed = false;

    for (const line of lines) {
        const normalized = normalize_command_line(line, actor_ref, apply_defaults);
        out.push(normalized.line);
        issues.push(...normalized.issues);
        if (normalized.changed) changed = true;
    }

    return { text: out.join("\n"), issues, changed };
}

function is_valid_machine_text(text: string): boolean {
    if (!text.trim()) return false;
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length === 0) return false;
    return lines.every((line) => is_command_line(line) && has_named_args(line) && !has_positional_args(line));
}

function sanitize_machine_text(text: string): string {
    const cleaned = strip_code_fences(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const lines = cleaned
        .split("\n")
        .map((line) => strip_list_prefix(line.trim()))
        .filter((line) => line.length > 0);
    const command_lines = lines.filter((line) => is_command_line(line));
    if (command_lines.length > 0) return command_lines.join("\n");
    return cleaned;
}

type Intent = "communicate" | "system" | "unknown";

function detect_intent(text: string): Intent {
    const lowered = text.toLowerCase();
    const system_keywords = ["system", "apply", "tag", "set", "adjust", "remove", "add", "give", "take"];
    if (system_keywords.some((kw) => lowered.includes(kw))) return "system";
    const communicate_keywords = [
        "say",
        "ask",
        "tell",
        "speak",
        "talk",
        "hello",
        "hi ",
        "hey",
        "greet",
        "whisper",
        "shout",
        "yell",
        "signal",
        "smoke",
    ];
    if (communicate_keywords.some((kw) => lowered.includes(kw))) return "communicate";
    return "unknown";
}

function normalize_entity_id(raw: string): { id: string; changed: boolean } {
    const trimmed = raw.trim();
    let id = trimmed;
    if (id.startsWith("actor.")) id = id.slice("actor.".length);
    if (id.startsWith("npc.")) id = id.slice("npc.".length);
    if (id.endsWith(".jsonc")) id = id.slice(0, -".jsonc".length);
    return { id, changed: id !== trimmed };
}

function get_active_actor_id(): string {
    const actors = find_actors(data_slot_number, {});
    if (actors.length === 0) return "henry_actor";
    const sorted = [...actors].sort((a, b) => a.id.localeCompare(b.id));
    const candidate = sorted[0]?.id ?? "henry_actor";
    const normalized = normalize_entity_id(candidate);
    if (normalized.changed) {
        debug_warn("Interpreter: normalized actor id", { from: candidate, to: normalized.id });
    }
    return normalized.id || "henry_actor";
}

function get_active_actor_ref(): string {
    const actor_id = get_active_actor_id();
    return `actor.${actor_id}`;
}

function resolve_communication_targets(): string[] {
    // TODO: replace with sense-range filtering for NPCs in the active region tile.
    const npcs = find_npcs(data_slot_number, {});
    if (npcs.length === 0) return ["npc.default_npc"];
    const sorted = [...npcs].sort((a, b) => a.id.localeCompare(b.id));
    const candidate = sorted[0]?.id ?? "default_npc";
    const normalized = normalize_entity_id(candidate);
    if (normalized.changed) {
        debug_warn("Interpreter: normalized npc id", { from: candidate, to: normalized.id });
    }
    return [`npc.${normalized.id || "default_npc"}`];
}

function resolve_communication_senses(text: string): string[] {
    const lowered = text.toLowerCase();
    if (lowered.includes("smoke") || lowered.includes("signal")) return ["light"];
    return ["pressure"];
}

function sanitize_quoted_text(text: string, max_len = 200): string {
    return text.replace(/"/g, "'").slice(0, max_len);
}

function build_communicate_command(text: string): string {
    const actor_ref = get_active_actor_ref();
    const targets = resolve_communication_targets();
    const senses = resolve_communication_senses(text);
    const sanitized = sanitize_quoted_text(text);
    return `${actor_ref}.COMMUNICATE(tool=${actor_ref}.voice, targets=[${targets.join(", ")}], text="${sanitized}", language=lang.common, senses=[${senses.join(", ")}], tone="neutral", contexts=[region_tile.0.0.0.0])`;
}

function build_communicate_template(text: string): string {
    const actor_ref = get_active_actor_ref();
    const targets = resolve_communication_targets();
    const senses = resolve_communication_senses(text);
    return `${actor_ref}.COMMUNICATE(tool=${actor_ref}.voice, targets=[${targets.join(", ")}], text="<TEXT>", language=lang.common, senses=[${senses.join(", ")}], tone="neutral", contexts=[region_tile.0.0.0.0])`;
}

function describe_issue(issue: LineIssue): string {
    switch (issue) {
        case "invalid_line":
            return "invalid_line: line does not match <subject>.<VERB>(args)";
        case "positional_args":
            return "positional_args: all args must be key=value";
        case "missing_tool":
            return "missing_tool: required tool arg is missing";
        default:
            return String(issue);
    }
}

async function run_interpreter_ai(params: {
    msg: MessageEnvelope;
    text: string;
    is_refinement: boolean;
    error_reason: string | undefined;
    errors: unknown[] | undefined;
    previous_machine_text: string | undefined;
    intent: Intent;
    communicate_template: string | undefined;
}): Promise<string> {
    const session_key = get_session_key(params.msg);
    const history = get_session_history(session_key);
    const started = Date.now();
    const user_prompt = build_interpreter_prompt({
        text: params.text,
        is_refinement: params.is_refinement,
        error_reason: params.error_reason,
        errors: params.errors,
        previous_machine_text: params.previous_machine_text,
        intent: params.intent,
        communicate_template: params.communicate_template,
    });

    const messages: OllamaMessage[] = [
        { role: "system", content: INTERPRETER_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: user_prompt },
    ];

    debug_log("InterpreterAI: request", {
        model: INTERPRETER_MODEL,
        session: session_key,
        refinement: params.is_refinement,
        history: history.length,
    });

    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: INTERPRETER_MODEL,
            messages,
            keep_alive: INTERPRETER_KEEP_ALIVE,
            timeout_ms: INTERPRETER_TIMEOUT_MS,
            options: { temperature: INTERPRETER_TEMPERATURE },
        });

        debug_log("InterpreterAI: response", {
            model: response.model,
            session: session_key,
            duration_ms: response.duration_ms,
            chars: response.content.length,
        });

        const sanitized = sanitize_machine_text(response.content);
        const stored_output = sanitized.length > 0 ? sanitized : response.content.trim();
        append_session_turn(session_key, user_prompt, stored_output);
        append_metric(data_slot_number, "interpreter_ai", {
            at: new Date().toISOString(),
            model: response.model,
            ok: true,
            duration_ms: response.duration_ms,
            stage: params.is_refinement ? "refine" : "interpret",
            session: session_key,
        });
        return sanitized;
    } catch (err) {
        const duration_ms = Date.now() - started;
        debug_warn("InterpreterAI: request failed", {
            model: INTERPRETER_MODEL,
            session: session_key,
            error: err instanceof Error ? err.message : String(err),
        });
        append_metric(data_slot_number, "interpreter_ai", {
            at: new Date().toISOString(),
            model: INTERPRETER_MODEL,
            ok: false,
            duration_ms,
            stage: params.is_refinement ? "refine" : "interpret",
            session: session_key,
            error: err instanceof Error ? err.message : String(err),
        });
        return "";
    }
}

function message_contains_text(msg: MessageEnvelope, needle: string): boolean {
    if (!needle) return false;
    const text = msg.content ?? "";
    return text.toLowerCase().includes(needle.toLowerCase());
}

function parse_error_iteration(meta: Record<string, unknown> | undefined): number | undefined {
    const error_iteration = meta?.error_iteration;
    if (typeof error_iteration === "number" && Number.isFinite(error_iteration) && error_iteration > 0) {
        return Math.trunc(error_iteration);
    }
    const error_stage = typeof meta?.error_stage === "string" ? (meta?.error_stage as string) : "";
    if (!error_stage.startsWith("interpretation_error_")) return undefined;
    const parts = error_stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function post_tweak(text: string, original: MessageEnvelope): MessageEnvelope {
    const input: MessageInput = {
        sender: "interpreter_ai",
        content: text,
        reply_to: original.id,
        stage: "interpreted_1",
        status: "done",
    };

    if (original.correlation_id !== undefined) input.correlation_id = original.correlation_id;

    return create_message(input);
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
    debug_log("Interpreter: received", { id: msg.id, status: msg.status, stage: msg.stage });
    const meta = (msg.meta as Record<string, unknown> | undefined) ?? undefined;
    const error_iteration = parse_error_iteration(meta);
    const bounded_error_iteration = error_iteration ? Math.min(error_iteration, ITERATION_LIMIT) : undefined;
    const next_iteration = Math.min((bounded_error_iteration ?? 0) + 1, ITERATION_LIMIT);
    const is_refinement = bounded_error_iteration !== undefined;
    const original_text = typeof meta?.original_text === "string" ? (meta?.original_text as string) : msg.content ?? "";
    const error_reason = meta?.error_reason;

    // Iteration rule: interpretation_error_n => interpreted_(n+1)
    if (is_refinement) {
        const reason = typeof error_reason === "string" && error_reason.length > 0 ? ` (${error_reason})` : "";
        write_status_line(get_status_path(data_slot_number), `interpreter pass ${next_iteration}: refining${reason}`);
    } else {
        write_status_line(get_status_path(data_slot_number), "the interpreter grabs the message");
    }

    const prepped = pre_tweak(msg);

    const processing = try_set_message_status(prepped, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);
    debug_log("Interpreter: processing", { id: processing.message.id });
    write_status_line(get_status_path(data_slot_number), "the interpreter is thinking");

    const error_list = Array.isArray(meta?.errors) ? (meta?.errors as unknown[]) : [];
    const intent = detect_intent(original_text);
    const communicate_template = intent === "communicate" ? build_communicate_template(original_text) : undefined;
    const actor_ref = get_active_actor_ref();
    const response_text = await run_interpreter_ai({
        msg: processing.message,
        text: original_text,
        is_refinement,
        error_reason: typeof error_reason === "string" ? error_reason : undefined,
        errors: error_list,
        previous_machine_text: typeof meta?.machine_text === "string" ? (meta?.machine_text as string) : undefined,
        intent,
        communicate_template,
    });
    const sanitized = sanitize_machine_text(response_text);
    let normalized = normalize_machine_text(sanitized, actor_ref, false);
    if (normalized.changed) {
        debug_warn("Interpreter: normalized machine text", { id: msg.id });
    }
    if (!normalized.text.trim()) {
        normalized.issues.push("invalid_line");
    }

    let issues = normalized.issues;
    let final_text = normalized.text;

    if (issues.length > 0) {
        const retry_errors = issues.map(describe_issue);
        const retry_text = await run_interpreter_ai({
            msg: processing.message,
            text: original_text,
            is_refinement: true,
            error_reason: "local_validation",
            errors: retry_errors,
            previous_machine_text: sanitized,
            intent,
            communicate_template,
        });
        const retry_sanitized = sanitize_machine_text(retry_text);
        const retry_normalized = normalize_machine_text(retry_sanitized, actor_ref, false);
        if (retry_normalized.changed) {
            debug_warn("Interpreter: normalized retry text", { id: msg.id });
        }
        if (!retry_normalized.text.trim()) {
            retry_normalized.issues.push("invalid_line");
        }
        issues = retry_normalized.issues;
        final_text = retry_normalized.text;
    }

    if (issues.length > 0) {
        const has_hard_error = issues.includes("invalid_line") || issues.includes("positional_args");
        if (!has_hard_error && issues.every((i) => i === "missing_tool")) {
            final_text = normalize_machine_text(final_text, actor_ref, true).text;
        } else if (intent === "communicate") {
            // TODO: on iteration 3+, ask the user to clarify the target via COMMUNICATE.
            final_text = build_communicate_command(original_text);
        } else {
            final_text = "";
        }
    }
    if (is_refinement) {
        debug_log("Interpreter: refine", { id: msg.id, error_iteration: bounded_error_iteration, error_reason, errors: error_list });
    }
    const response_msg = post_tweak(final_text, processing.message);

    response_msg.content = final_text;
    debug_content("Interpreter Out", response_msg.content ?? "");
    response_msg.meta = {
        ...(response_msg.meta ?? {}),
        machine_text: final_text,
        original_text,
        error_reason,
        error_iteration: bounded_error_iteration,
        errors: error_list,
    };
    response_msg.stage = is_refinement ? `interpreted_${next_iteration}` : "interpreted_1";
    response_msg.status = "sent";

    // TODO: send to data broker program here instead of inbox
    append_inbox_message(inbox_path, response_msg);
    debug_log("Interpreter: sent response", { reply_to: response_msg.reply_to, id: response_msg.id });
    write_status_line(get_status_path(data_slot_number), `interpreter pass ${response_msg.stage?.split("_")[1] ?? "1"}: translation ready`);

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
        debug_log("Interpreter: done", { id: done.message.id });
        write_status_line(get_status_path(data_slot_number), "the interpreter sends their translation onward");
    }
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    const outbox = read_outbox(outbox_path);
    const candidates = outbox.messages.filter(
        (m) => m.stage === "interpreter_ai" && m.status === "sent",
    );

    if (candidates.length > 0) {
        debug_log("Interpreter: candidates", { count: candidates.length });
        write_status_line(get_status_path(data_slot_number), "the interpreter sees the message");
    }

    for (const msg of candidates) {
        await process_message(outbox_path, inbox_path, log_path, msg);
    }
}

function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const status_path = get_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_status_exists(status_path);

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("Interpreter: booted", { outbox_path, inbox_path });
debug_log("InterpreterAI: config", {
    model: INTERPRETER_MODEL,
    host: OLLAMA_HOST,
    history_limit: INTERPRETER_HISTORY_LIMIT,
    timeout_ms: INTERPRETER_TIMEOUT_MS,
});

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

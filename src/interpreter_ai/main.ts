import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log } from "../shared/debug.js";
import { get_status_path } from "../engine/paths.js";
import { ensure_status_exists, write_status_line } from "../engine/status_store.js";

const data_slot_number = 1;
const POLL_MS = 800;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pre_tweak(msg: MessageEnvelope): MessageEnvelope {
    return msg;
}

const ITERATION_LIMIT = 5;

const COMMAND_MAP: Record<string, string> = {
    "1": "henry_actor.ATTACK(target=npc.shopkeep, tool=henry_actor.inventory.item_9x3k2q, action_cost=FULL, roll={type=RESULT, dice=\"D20\", nat=12, base=12, effectors=[], target_cr=10, result=12}, potency={type=POTENCY, mag=1, dice=\"1d2\", nat=1, base=1, effectors=[], result=1})",
    "2": "henry_actor.CRAFT(tool=henry_actor.inventory.item_kit_2mag, components=[henry_actor.inventory.item_ing_a1, henry_actor.inventory.item_ing_a2], result=henry_actor.inventory.item_potion_flinch, action_cost=EXTENDED, roll={type=RESULT, dice=\"D20\", nat=11, base=11, effectors=[], target_cr=10, result=11}, tags=[{name=FLINCH, mag=2, info=[]}])",
    "3": "henry_actor.COMMUNICATE(tool=henry_actor.voice, targets=[npc.shopkeep], text=\"hey, whats on the food menu today?\", language=lang.common, senses=[pressure], tone=\"curious\", contexts=[region_tile.0.0.0.0])",
    "4": "henry_actor.MOVE(target=tile.loc.forest.10.12, tool=henry_actor.hands, mode=walk, action_cost=FULL)",
    "5": "henry_actor.USE(target=henry_actor.inventory.item_torch, tool=henry_actor.hands, action_cost=PARTIAL, roll={type=RESULT, dice=\"D20\", nat=9, base=9, effectors=[], target_cr=0, result=9})",
    "6": "henry_actor.INSPECT(target=tile.loc.cave.4.9, tool=henry_actor.hands, roll={type=RESULT, dice=\"D20\", nat=10, base=10, effectors=[], target_cr=10, result=10})",
    "7": "henry_actor.GRAPPLE(target=npc.shopkeep, tool=henry_actor.hands, roll={type=RESULT, dice=\"D20\", nat=11, base=11, effectors=[], target_cr=12, result=11}, size_delta=0, action_cost=FULL)",
    "8": "henry_actor.DEFEND(target=henry_actor, tool=henry_actor.hands, potency={type=POTENCY, mag=1, dice=\"1d2\", nat=2, base=2, effectors=[], result=2}, potency_applies_to=henry_actor.evasion, duration=1, unit=TURN)",
    "9": "henry_actor.SLEEP(tool=henry_actor.body, potency={type=POTENCY, mag=1, dice=\"1d2\", nat=2, base=2, effectors=[], result=2}, consumes=[{resource=VIGOR, mag=1, optional=true}], action_cost=EXTENDED)",
    "10": "henry_actor.HOLD(tool=henry_actor.hands, verb=ATTACK, action_cost=FULL, condition={type=ACTION, target=npc.shopkeep.action, op=EQUALS, value=\"open_mouth\"})",
};

// TODO: add an AI agent and train it on the system syntax
async function simulate_ai_from_text(text: string): Promise<string> {
    await sleep(200);
    const key = text.trim();
    if (COMMAND_MAP[key]) return COMMAND_MAP[key] as string;
    return "";
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

function create_fallback_command(original_text: string): string {
    const sanitized = original_text.replace(/"/g, "'").slice(0, 120);
    return `default_actor.COMMUNICATE(tool=default_actor.voice, targets=[npc.default_npc], text="fallback response to keep story moving: ${sanitized}", language=lang.common, senses=[pressure], tone="uncertain", contexts=[region_tile.0.0.0.0])`;
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

    const response_text = await simulate_ai_from_text(is_refinement ? original_text : (processing.message.content ?? ""));
    const error_list = Array.isArray(meta?.errors) ? (meta?.errors as unknown[]) : [];
    if (is_refinement) {
        debug_log("Interpreter: refine", { id: msg.id, error_iteration: bounded_error_iteration, error_reason, errors: error_list });
    }
    const response_msg = post_tweak(response_text, processing.message);

    const should_fallback = is_refinement && next_iteration >= ITERATION_LIMIT && response_text.length === 0;
    const final_text = should_fallback ? create_fallback_command(original_text) : response_text;
    response_msg.content = final_text;
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

    if (should_fallback) {
        response_msg.status = "sent";
    }

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

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

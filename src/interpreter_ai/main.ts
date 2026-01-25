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

async function simulate_ai(msg: MessageEnvelope): Promise<string> {
    await sleep(400);
    return `STUB AI: received "${msg.content}"`;
}

function message_contains_text(msg: MessageEnvelope, needle: string): boolean {
    if (!needle) return false;
    const text = msg.content ?? "";
    return text.toLowerCase().includes(needle.toLowerCase());
}

function parse_error_iteration(error_stage: string | undefined): number {
    if (!error_stage) return 1;
    if (!error_stage.startsWith("interpretation_error_")) return 1;
    const parts = error_stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
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
    const error_stage = (msg.meta as any)?.error_stage as string | undefined;
    const iteration = parse_error_iteration(error_stage);
    const next_iteration = iteration + 1;

    if (error_stage) {
        write_status_line(get_status_path(data_slot_number), "the interpreter is refining the translation");
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

    const response_text = await simulate_ai(processing.message);
    const response_msg = post_tweak(response_text, processing.message);

    response_msg.meta = { ...(response_msg.meta ?? {}), machine_text: response_msg.content };
    response_msg.stage = error_stage ? `interpreted_${next_iteration}` : "interpreted_1";
    response_msg.status = "sent";

    // TODO: send to data broker program here instead of inbox
    append_inbox_message(inbox_path, response_msg);
    debug_log("Interpreter: sent response", { reply_to: response_msg.reply_to, id: response_msg.id });
    write_status_line(get_status_path(data_slot_number), "the interpreter has made a translation");

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

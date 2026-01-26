import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log } from "../shared/debug.js";

const data_slot_number = 1;
const POLL_MS = 800;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

    const effects = (msg.meta as any)?.effects as string[] | undefined;
    const events = (msg.meta as any)?.events as string[] | undefined;

    if (effects && effects.length > 0) {
        debug_log("Renderer: effects", { id: msg.id, effects });
    }

    const content = "rendered narrative stub";
    const output: MessageInput = {
        sender: "renderer_ai",
        content,
        stage: "rendered_1",
        status: "sent",
        reply_to: msg.id,
        meta: {
            events: events ?? [],
            effects: effects ?? [],
        },
    };

    if (msg.correlation_id !== undefined) output.correlation_id = msg.correlation_id;
    const rendered = create_message(output);
    append_inbox_message(inbox_path, rendered);
    debug_log("Renderer: output sent", { id: rendered.id, stage: rendered.stage });

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
    }

    await sleep(0);
}

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    const outbox = read_outbox(outbox_path);
    const candidates = outbox.messages.filter(
        (m) => m.stage?.startsWith("ruling_") && m.status === "sent",
    );

    if (candidates.length > 0) {
        debug_log("Renderer: candidates", { count: candidates.length });
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

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("Renderer: booted", { outbox_path, inbox_path });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

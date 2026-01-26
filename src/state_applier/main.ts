import { get_data_slot_dir, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message, append_log_envelope } from "../engine/log_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log } from "../shared/debug.js";
import { parse_machine_text } from "../system_syntax/index.js";
import { resolve_references } from "../reference_resolver/resolver.js";
import { apply_effects } from "./apply.js";

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

async function process_message(outbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const effects = (msg.meta as any)?.effects as string[] | undefined;
    if (!effects || effects.length === 0) {
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const parsed = parse_machine_text(effects.join("\n"));
    if (parsed.errors.length > 0) {
        debug_log("StateApplier: parse errors", { errors: parsed.errors });
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const resolved = resolve_references(parsed.commands, {
        slot: data_slot_number,
        use_representative_data: false,
    });

    const target_paths: Record<string, string> = {};
    for (const [ref, info] of Object.entries(resolved.resolved)) {
        if (info.path) target_paths[ref] = info.path;
    }

    const applied = apply_effects(parsed.commands, target_paths);
    for (const diff of applied.diffs) {
        append_log_message(log_path, "state_applier", `data change to ${diff.target} 's DATA`);
    }

    for (const warning of applied.warnings) {
        // TODO<system-reminder>: log warning and skip saving for unhandled effects
        debug_log("StateApplier: warning", { warning });
    }

    const output: MessageInput = {
        sender: "state_applier",
        content: "state applied",
        stage: "applied_1",
        status: "sent",
        reply_to: msg.id,
        meta: {
            effects_applied: applied.diffs.length,
        },
    };

    if (msg.correlation_id) output.correlation_id = msg.correlation_id;
    append_outbox_message(outbox_path, create_message(output));

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
    }

    await sleep(0);
}

async function tick(outbox_path: string, log_path: string): Promise<void> {
    const outbox = read_outbox(outbox_path);
    const candidates = outbox.messages.filter(
        (m) => m.stage?.startsWith("ruling_") && m.status === "sent",
    );

    for (const msg of candidates) {
        await process_message(outbox_path, log_path, msg);
    }
}

function initialize(): { outbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, log_path };
}

const { outbox_path, log_path } = initialize();
debug_log("StateApplier: booted", { outbox_path, log_path });

setInterval(() => {
    void tick(outbox_path, log_path);
}, POLL_MS);

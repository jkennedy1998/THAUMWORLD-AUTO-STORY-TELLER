import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log } from "../shared/debug.js";
import { parse_machine_text } from "../system_syntax/index.js";
import type { CommandNode } from "../system_syntax/index.js";
import { resolve_references } from "../reference_resolver/resolver.js";

const data_slot_number = 1;
const POLL_MS = 800;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse_stage_iteration(stage: string | undefined): number {
    // TODO: parse stage suffix (interpreted_n) and increment for brokered_n
    if (!stage) return 1;
    const parts = stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
}

function resolve_entities(
    commands: CommandNode[],
    options: { use_representative_data: boolean },
): { resolved: Record<string, unknown>; errors: string[]; warnings: string[] } {
    const resolved = resolve_references(commands, {
        slot: data_slot_number,
        use_representative_data: options.use_representative_data,
    });
    return {
        resolved: resolved.resolved,
        errors: resolved.errors.map((e) => `${e.ref}: ${e.reason}`),
        warnings: resolved.warnings.map((w) => `${w.ref}: ${w.message}`),
    };
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
    debug_log("DataBroker: received", { id: msg.id, status: msg.status, stage: msg.stage });

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const iteration = parse_stage_iteration(msg.stage);
    const machine_text = (msg.meta as any)?.machine_text as string | undefined;
    if (!machine_text || machine_text.trim().length === 0) {
        debug_log("DataBroker: empty machine_text", { id: msg.id, stage: msg.stage });
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const parsed = parse_machine_text(machine_text);

    if (parsed.errors.length > 0) {
        debug_log("DataBroker: parse errors", { id: msg.id, errors: parsed.errors });
        const error_input: MessageInput = {
            sender: "data_broker",
            content: "unable to parse machine text",
            stage: `interpretation_error_${iteration}`,
            status: "done",
            reply_to: msg.id,
            meta: { errors: parsed.errors, machine_text },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;

        const error_msg = create_message(error_input);

        // TODO: support iterative warnings and clarification requests
        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: parse error sent", { reply_to: error_msg.reply_to, id: error_msg.id });

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const should_create_data = iteration >= 4;
    const should_create_from_scratch = iteration >= 5;
    debug_log("DataBroker: resolve start", {
        id: msg.id,
        iteration,
        should_create_data,
        should_create_from_scratch,
    });
    // TODO<system-reminder>: add data creation rules (iteration 4 create, iteration 5 create from scratch)
    const resolved = resolve_entities(parsed.commands, { use_representative_data: should_create_from_scratch });
    if (resolved.errors.length > 0 && !should_create_from_scratch) {
        debug_log("DataBroker: resolve errors", { id: msg.id, errors: resolved.errors, warnings: resolved.warnings });
        const error_input: MessageInput = {
            sender: "data_broker",
            content: "unable to resolve referenced data",
            stage: `interpretation_error_${iteration}`,
            status: "done",
            reply_to: msg.id,
            meta: {
                errors: resolved.errors,
                warnings: resolved.warnings,
                machine_text,
                should_create_data,
                should_create_from_scratch,
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;

        const error_msg = create_message(error_input);

        // TODO: support iterative warnings and clarification requests
        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: resolve error sent", { reply_to: error_msg.reply_to, id: error_msg.id });

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    debug_log("DataBroker: resolve ok", { id: msg.id, warnings: resolved.warnings });

    const brokered_input: MessageInput = {
        sender: "data_broker",
        content: "brokered data ready",
        stage: `brokered_${iteration}`,
        status: "sent",
        reply_to: msg.id,
        meta: {
            machine_text,
            commands: parsed.commands,
            resolved: resolved.resolved,
            warnings: [...parsed.warnings, ...resolved.warnings],
            should_create_data,
            should_create_from_scratch,
        },
    };

    if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;

    const brokered = create_message(brokered_input);

    // TODO: send brokered_n message to rules_lawyer
    append_outbox_message(outbox_path, brokered);
    debug_log("DataBroker: brokered sent", { id: brokered.id, stage: brokered.stage });

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
        (m) => m.stage?.startsWith("interpreted_") && m.status === "sent",
    );

    if (candidates.length > 0) {
        debug_log("DataBroker: candidates", { count: candidates.length });
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
debug_log("DataBroker: booted", { outbox_path, inbox_path });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

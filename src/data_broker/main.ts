import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_status_path } from "../engine/paths.js";
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
import { ensure_status_exists, write_status_line } from "../engine/status_store.js";
import { ensure_actor_exists } from "../actor_storage/store.js";
import { ensure_npc_exists } from "../npc_storage/store.js";
import { ensure_region_tile, ensure_world_tile } from "../world_storage/store.js";

const data_slot_number = 1;
const POLL_MS = 800;
const ITERATION_LIMIT = 5;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse_stage_iteration(stage: string | undefined): number {
    if (!stage) return 1;
    if (!stage.startsWith("interpreted_")) return 1;
    const parts = stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(Math.trunc(n), ITERATION_LIMIT);
}

function format_error_summary(
    errors: Array<
        | string
        | { code?: string; message?: string; line?: number; column?: number }
        | { ref?: string; reason?: string; path?: string }
    >,
): string {
    if (errors.length === 0) return "none";
    return errors
        .map((err) => {
            if (typeof err === "string") return err;
            if ("reason" in err || "ref" in err) {
                const ref = err.ref ? `${err.ref}:` : "";
                const reason = err.reason ?? "unknown";
                return `${ref}${reason}`;
            }
            if ("code" in err || "message" in err) {
                const code = err.code ? `${err.code}:` : "";
                const msg = err.message ?? "unknown error";
                const loc =
                    typeof err.line === "number" && typeof err.column === "number"
                        ? `@${err.line}:${err.column}`
                        : "";
                return `${code}${msg}${loc}`;
            }
            return "unknown";
        })
        .join("; ");
}

function resolve_entities(
    commands: CommandNode[],
    options: { use_representative_data: boolean },
): {
    resolved: Record<string, unknown>;
    errors: Array<{ ref: string; reason: string; path?: string }>;
    warnings: Array<{ ref: string; message: string }>;
} {
    const resolved = resolve_references(commands, {
        slot: data_slot_number,
        use_representative_data: options.use_representative_data,
    });
    return {
        resolved: resolved.resolved,
        errors: resolved.errors,
        warnings: resolved.warnings,
    };
}

function parse_ref_parts(ref: string): string[] {
    return ref.split(".").filter((p) => p.length > 0);
}

function create_missing_entities(
    errors: Array<{ ref: string; reason: string; path?: string }>,
): { created: number; notes: string[] } {
    let created = 0;
    const notes: string[] = [];

    for (const err of errors) {
        if (err.reason === "actor_not_found") {
            const parts = parse_ref_parts(err.ref);
            const actor_id = parts[1] ?? "";
            if (!actor_id) continue;
            const created_actor = ensure_actor_exists(data_slot_number, actor_id);
            if (created_actor.ok) {
                created += 1;
                notes.push(`created actor ${actor_id}`);
            }
        }

        if (err.reason === "npc_not_found") {
            const parts = parse_ref_parts(err.ref);
            const npc_id = parts[1] ?? "";
            if (!npc_id) continue;
            const created_npc = ensure_npc_exists(data_slot_number, npc_id);
            if (created_npc.ok) {
                created += 1;
                notes.push(`created npc ${npc_id}`);
            }
        }

        if (err.reason === "world_tile_missing") {
            const parts = parse_ref_parts(err.ref);
            const x = Number(parts[1]);
            const y = Number(parts[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const created_tile = ensure_world_tile(data_slot_number, x, y);
            if (created_tile.ok) {
                created += 1;
                notes.push(`created world_tile ${x},${y}`);
            }
        }

        if (err.reason === "region_tile_missing") {
            const parts = parse_ref_parts(err.ref);
            const world_x = Number(parts[1]);
            const world_y = Number(parts[2]);
            const region_x = Number(parts[3]);
            const region_y = Number(parts[4]);
            if (![world_x, world_y, region_x, region_y].every((n) => Number.isFinite(n))) continue;
            const created_region = ensure_region_tile(data_slot_number, world_x, world_y, region_x, region_y);
            if (created_region.ok) {
                created += 1;
                notes.push(`created region_tile ${world_x},${world_y}.${region_x},${region_y}`);
            }
        }
    }

    return { created, notes };
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
    const iteration = parse_stage_iteration(msg.stage);
    const original_text = typeof (msg.meta as any)?.original_text === "string" ? ((msg.meta as any)?.original_text as string) : "";
    const should_create_data = iteration >= 4;
    const should_create_from_scratch = iteration >= 5;
    const brokered_iteration = Math.min(iteration + 1, ITERATION_LIMIT);
    debug_log("DataBroker: pass", { id: msg.id, iteration, stage: msg.stage });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: received`);

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const machine_text = (msg.meta as any)?.machine_text as string | undefined;
    if (!machine_text || machine_text.trim().length === 0) {
        debug_log("DataBroker: empty machine_text", { id: msg.id, stage: msg.stage });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: no machine text`);
        if (iteration >= ITERATION_LIMIT) {
            const brokered_input: MessageInput = {
                sender: "data_broker",
                content: "brokered data ready",
                stage: `brokered_${brokered_iteration}`,
                status: "sent",
                reply_to: msg.id,
                meta: {
                    machine_text: machine_text ?? "",
                    commands: [],
                    resolved: {},
                    warnings: ["machine_text_empty (band_aid)"],
                    should_create_data,
                    should_create_from_scratch,
                    original_text,
                    iteration,
                    band_aid: true,
                },
            };
            if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;
            const brokered = create_message(brokered_input);
            append_outbox_message(outbox_path, brokered);
            debug_log("DataBroker: band_aid brokered sent", { id: brokered.id, stage: brokered.stage });
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: band aid brokered`);

            const done = try_set_message_status(processing.message, "done");
            if (done.ok) {
                update_outbox_message(outbox_path, done.message);
                append_log_envelope(log_path, done.message);
            }
            return;
        }
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to parse machine text | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "machine_text_empty",
                errors: ["machine_text_empty"],
                warnings: [],
                original_text,
                machine_text: machine_text ?? "",
                should_create_data,
                should_create_from_scratch,
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;

        const error_msg = create_message(error_input);
        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: empty machine_text error sent", { reply_to: error_msg.reply_to, id: error_msg.id });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: parsing`);
    const parsed = parse_machine_text(machine_text);

    if (parsed.errors.length > 0) {
        debug_log("DataBroker: parse errors", { id: msg.id, errors: parsed.errors });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: parse error`);
        if (iteration >= ITERATION_LIMIT) {
            const resolved = resolve_entities(parsed.commands, { use_representative_data: true });
            const brokered_input: MessageInput = {
                sender: "data_broker",
                content: "brokered data ready",
                stage: `brokered_${brokered_iteration}`,
                status: "sent",
                reply_to: msg.id,
                meta: {
                    machine_text,
                    commands: parsed.commands,
                    resolved: resolved.resolved,
                    warnings: [
                        ...parsed.warnings.map((w) => `${w.code}:${w.message}@${w.line}:${w.column}`),
                        ...parsed.errors.map((e) => `${e.code}:${e.message}@${e.line}:${e.column}`),
                        ...resolved.warnings,
                    ],
                    should_create_data,
                    should_create_from_scratch,
                    original_text,
                    iteration,
                    band_aid: true,
                },
            };
            if (msg.correlation_id !== undefined) brokered_input.correlation_id = msg.correlation_id;
            const brokered = create_message(brokered_input);
            append_outbox_message(outbox_path, brokered);
            debug_log("DataBroker: band_aid brokered sent", { id: brokered.id, stage: brokered.stage });
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: band aid brokered`);

            const done = try_set_message_status(processing.message, "done");
            if (done.ok) {
                update_outbox_message(outbox_path, done.message);
                append_log_envelope(log_path, done.message);
            }
            return;
        }
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to parse machine text | errors: ${format_error_summary(parsed.errors)} | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "parse_error",
                errors: parsed.errors,
                warnings: parsed.warnings,
                machine_text,
                original_text,
                should_create_data,
                should_create_from_scratch,
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;

        const error_msg = create_message(error_input);

        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: parse error sent", { reply_to: error_msg.reply_to, id: error_msg.id, iteration });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    debug_log("DataBroker: resolve start", {
        id: msg.id,
        iteration,
        should_create_data,
        should_create_from_scratch,
    });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: resolving`);
    let resolved = resolve_entities(parsed.commands, { use_representative_data: should_create_from_scratch });
    if (resolved.errors.length > 0 && should_create_data && !should_create_from_scratch) {
        const created = create_missing_entities(resolved.errors);
        if (created.created > 0) {
            debug_log("DataBroker: created missing data", { id: msg.id, created: created.created, notes: created.notes });
            write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: created ${created.created} missing`);
            resolved = resolve_entities(parsed.commands, { use_representative_data: false });
        }
    }
    if (resolved.errors.length > 0 && !should_create_from_scratch) {
        debug_log("DataBroker: resolve errors", { id: msg.id, errors: resolved.errors, warnings: resolved.warnings });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: resolve error`);
        const error_input: MessageInput = {
            sender: "data_broker",
            content: `unable to resolve referenced data | errors: ${format_error_summary(resolved.errors)} | original: ${original_text}`,
            stage: `broker_error_${iteration}`,
            status: "error",
            reply_to: msg.id,
            meta: {
                error_iteration: iteration,
                error_reason: "resolve_error",
                errors: resolved.errors,
                warnings: resolved.warnings,
                machine_text,
                original_text,
                should_create_data,
                should_create_from_scratch,
            },
        };

        if (msg.correlation_id !== undefined) error_input.correlation_id = msg.correlation_id;

        const error_msg = create_message(error_input);

        append_inbox_message(inbox_path, error_msg);
        debug_log("DataBroker: resolve error sent", { reply_to: error_msg.reply_to, id: error_msg.id, iteration });
        write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: error sent`);

        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    debug_log("DataBroker: resolve ok", { id: msg.id, warnings: resolved.warnings });
    write_status_line(get_status_path(data_slot_number), `data broker pass ${iteration}: brokered`);

    const brokered_input: MessageInput = {
        sender: "data_broker",
        content: "brokered data ready",
        stage: `brokered_${brokered_iteration}`,
        status: "sent",
        reply_to: msg.id,
        meta: {
            machine_text,
            commands: parsed.commands,
            resolved: resolved.resolved,
            warnings: [...parsed.warnings, ...resolved.warnings],
            should_create_data,
            should_create_from_scratch,
            original_text,
            iteration,
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
    const status_path = get_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_status_exists(status_path);

    return { outbox_path, inbox_path, log_path };
}

const { outbox_path, inbox_path, log_path } = initialize();
debug_log("DataBroker: booted", { outbox_path, inbox_path });

setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists } from "../engine/log_store.js";
import { ensure_inbox_exists } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { append_log_envelope } from "../engine/log_store.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log, debug_waiting_roll } from "../shared/debug.js";
import { apply_rules_stub } from "./effects.js";
import type { CommandNode } from "../system_syntax/index.js";
import { make_log_id } from "../engine/log_store.js";

const data_slot_number = 1;
const POLL_MS = 800;

type PendingJob = {
    msg: MessageEnvelope;
    commands: CommandNode[];
    pending_rolls: Record<string, { command_index: number; field: "roll" | "potency" }>;
};

const pending_jobs: Record<string, PendingJob> = {};

function is_actor_subject(subject: string): boolean {
    return subject.startsWith("actor.") || subject.endsWith("_actor");
}

function get_roll_node(command: CommandNode, field: "roll" | "potency"): any {
    return (command.args as any)?.[field];
}

function needs_roll(roll_node: any): boolean {
    if (!roll_node || roll_node.type !== "object") return false;
    return roll_node.value?.nat === undefined;
}

function apply_roll_result_to_command(command: CommandNode, field: "roll" | "potency", nat: number | number[], base: number, roll_result: string): void {
    const roll_node = get_roll_node(command, field);
    if (!roll_node || roll_node.type !== "object") return;
    if (Array.isArray(nat)) {
        roll_node.value.nat = { type: "list", value: nat.map((n) => ({ type: "number", value: n })) };
    } else {
        roll_node.value.nat = { type: "number", value: nat };
    }
    roll_node.value.base = { type: "number", value: base };
    roll_node.value.roll_result = { type: "string", value: roll_result };
}

async function process_roll_result(outbox_path: string, log_path: string, msg: MessageEnvelope): Promise<void> {
    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const meta = (msg.meta as any) ?? {};
    const roll_id = String(meta.roll_id ?? "");
    const nat = meta.nat as number | number[] | undefined;
    const base = Number(meta.base ?? 0);
    const roll_result = String(meta.roll_result ?? "");

    if (!roll_id || nat === undefined) {
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const job_entry = Object.entries(pending_jobs).find(([, job]) => job.pending_rolls[roll_id]);
    if (!job_entry) {
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const [job_id, job] = job_entry;
    const roll_ref = job.pending_rolls[roll_id];
    if (roll_ref) {
        const cmd = job.commands[roll_ref.command_index];
        if (cmd) apply_roll_result_to_command(cmd, roll_ref.field, nat, base, roll_result);
        delete job.pending_rolls[roll_id];
    }

    if (Object.keys(job.pending_rolls).length === 0) {
        const job_meta = (job.msg.meta as any) ?? {};
        const original_text = typeof job_meta?.original_text === "string" ? (job_meta.original_text as string) : "";
        const machine_text = typeof job_meta?.machine_text === "string" ? (job_meta.machine_text as string) : "";
        const ruled = apply_rules_stub(job.commands);
        const iteration = parse_stage_iteration(job.msg.stage);
        const output: MessageInput = {
            sender: "rules_lawyer",
            content: "rule effects ready",
            stage: `ruling_${iteration}`,
            status: "sent",
            reply_to: job.msg.id,
            meta: {
                events: ruled.event_lines,
                effects: ruled.effect_lines,
                original_text,
                machine_text,
            },
        };
        if (job.msg.correlation_id) output.correlation_id = job.msg.correlation_id;
        const ruled_msg = create_message(output);
        append_outbox_message(outbox_path, ruled_msg);
        debug_log("RulesLawyer: output sent", { id: ruled_msg.id, stage: ruled_msg.stage });

        const done_job = try_set_message_status(job.msg, "done");
        if (done_job.ok) {
            update_outbox_message(outbox_path, done_job.message);
            append_log_envelope(log_path, done_job.message);
        }
        delete pending_jobs[job_id];
    }

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(log_path, done.message);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse_stage_iteration(stage: string | undefined): number {
    if (!stage) return 1;
    const parts = stage.split("_");
    const last = parts[parts.length - 1] ?? "";
    const n = Number(last);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
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
    debug_log("RulesLawyer: received", { id: msg.id, status: msg.status, stage: msg.stage });

    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(log_path, processing.message);

    const iteration = parse_stage_iteration(msg.stage);
    const commands = (msg.meta as any)?.commands as CommandNode[] | undefined;
    if (!commands || !Array.isArray(commands)) {
        debug_log("RulesLawyer: missing commands", { id: msg.id });
        const done = try_set_message_status(processing.message, "done");
        if (done.ok) {
            update_outbox_message(outbox_path, done.message);
            append_log_envelope(log_path, done.message);
        }
        return;
    }

    const pending: PendingJob = {
        msg: processing.message,
        commands: [...commands],
        pending_rolls: {},
    };

    const roll_requests: MessageInput[] = [];
    for (let i = 0; i < commands.length; i += 1) {
        const cmd = commands[i];
        if (!cmd) continue;
        for (const field of ["roll", "potency"] as const) {
            const roll_node = get_roll_node(cmd, field);
            if (!needs_roll(roll_node)) continue;
            const dice = roll_node?.value?.dice?.value ?? "";
            if (!dice) continue;

            const roll_id = make_log_id(1);
            pending.pending_rolls[roll_id] = { command_index: i, field };

            const req: MessageInput = {
                sender: "rules_lawyer",
                content: "roll request",
                stage: `roll_request_${iteration}`,
                status: "sent",
                reply_to: msg.id,
                meta: {
                    roll_id,
                    dice,
                    rolled_by_player: is_actor_subject(cmd.subject),
                    source: { command_index: i, field },
                },
            };
            if (msg.correlation_id) req.correlation_id = msg.correlation_id;
            roll_requests.push(req);
            if (req.meta?.rolled_by_player) {
                debug_waiting_roll("Awaiting Roll", dice, field, i);
            }
        }
    }

    if (roll_requests.length > 0) {
        pending_jobs[msg.id] = pending;
        for (const req of roll_requests) {
            append_outbox_message(outbox_path, create_message(req));
        }

        const awaiting = try_set_message_status(processing.message, `awaiting_roll_${iteration}` as any);
        if (awaiting.ok) {
            update_outbox_message(outbox_path, awaiting.message);
            append_log_envelope(log_path, awaiting.message);
        }
        return;
    }

    const original_text = typeof (msg.meta as any)?.original_text === "string" ? ((msg.meta as any)?.original_text as string) : "";
    const machine_text = typeof (msg.meta as any)?.machine_text === "string" ? ((msg.meta as any)?.machine_text as string) : "";
    const ruled = apply_rules_stub(commands);
    const output: MessageInput = {
        sender: "rules_lawyer",
        content: "rule effects ready",
        stage: `ruling_${iteration}`,
        status: "sent",
        reply_to: msg.id,
        meta: {
            events: ruled.event_lines,
            effects: ruled.effect_lines,
            original_text,
            machine_text,
        },
    };

    if (msg.correlation_id !== undefined) output.correlation_id = msg.correlation_id;
    const ruled_msg = create_message(output);
    append_outbox_message(outbox_path, ruled_msg);
    debug_log("RulesLawyer: output sent", { id: ruled_msg.id, stage: ruled_msg.stage });

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
        (m) => m.stage?.startsWith("brokered_") && m.status === "sent",
    );

    const roll_results = outbox.messages.filter(
        (m) => m.stage?.startsWith("roll_result_") && m.status === "sent",
    );

    if (candidates.length > 0) {
        debug_log("RulesLawyer: candidates", { count: candidates.length });
    }

    for (const msg of candidates) {
        await process_message(outbox_path, log_path, msg);
    }

    for (const msg of roll_results) {
        await process_roll_result(outbox_path, log_path, msg);
    }
}

function initialize(): { outbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);

    return { outbox_path, log_path };
}

const { outbox_path, log_path } = initialize();
debug_log("RulesLawyer: booted", { outbox_path, log_path });

setInterval(() => {
    void tick(outbox_path, log_path);
}, POLL_MS);

import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_roller_status_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_envelope } from "../engine/log_store.js";
import { ensure_inbox_exists } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, prune_outbox_messages, append_outbox_message } from "../engine/outbox_store.js";
import { create_message, try_set_message_status } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import type { MessageEnvelope } from "../engine/types.js";
import { debug_log } from "../shared/debug.js";
import { roll_expr } from "../rules_lawyer/dice.js";
import { ensure_roller_status_exists, read_roller_status, write_roller_status } from "../engine/roller_status_store.js";

const data_slot_number = 1;
const POLL_MS = 800;
const SPINNER_FRAMES = ["|", "/", "-", "\\"];

type RollRequest = {
    roll_id: string;
    dice: string;
    rolled_by_player: boolean;
    correlation_id?: string | undefined;
};

const pending_player: Record<string, RollRequest> = {};
let active_roll_id: string | null = null;
let spinner_index = 0;

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

function next_spinner(): string {
    spinner_index = (spinner_index + 1) % SPINNER_FRAMES.length;
    return SPINNER_FRAMES[spinner_index] ?? "|";
}

function write_status(path: string, patch: Partial<{ spinner: string; last_player_roll: string; dice_label: string; disabled: boolean; roll_id: string | null }>): void {
    const current = read_roller_status(path);
    const next = {
        ...current,
        ...patch,
    };
    write_roller_status(path, next);
}

function emit_roll_result(outbox_path: string, request: RollRequest, faces: number[], base: number): void {
    const roll_result = `${base} (${request.dice} rolled ${faces.join(",")})`;
    const output: MessageInput = {
        sender: "roller",
        content: "roll result",
        stage: "roll_result_1",
        status: "sent",
        meta: {
            roll_id: request.roll_id,
            nat: faces.length === 1 ? faces[0] : faces,
            base,
            roll_result,
        },
    };
    if (request.correlation_id) output.correlation_id = request.correlation_id;
    const msg = create_message(output);
    append_outbox_message(outbox_path, msg);
}

function handle_roll_request(outbox_path: string, status_path: string, msg: MessageEnvelope): void {
    const meta = (msg.meta as any) ?? {};
    const roll_id = String(meta.roll_id ?? "");
    const dice = String(meta.dice ?? "");
    const rolled_by_player = Boolean(meta.rolled_by_player);
    const correlation_id = msg.correlation_id;

    if (!roll_id || !dice) return;

    const request: RollRequest = { roll_id, dice, rolled_by_player, correlation_id };
    if (rolled_by_player) {
        pending_player[roll_id] = request;
        active_roll_id = active_roll_id ?? roll_id;
        write_status(status_path, {
            spinner: next_spinner(),
            dice_label: dice,
            disabled: false,
            roll_id: active_roll_id,
        });
        return;
    }

    const rolled = roll_expr(dice);
    if (!rolled) return;
    write_status(status_path, { spinner: next_spinner() });
    emit_roll_result(outbox_path, request, rolled.faces, rolled.base);
}

function handle_roll_input(outbox_path: string, status_path: string, msg: MessageEnvelope): void {
    const meta = (msg.meta as any) ?? {};
    const roll_id = String(meta.roll_id ?? "");
    if (!roll_id) return;

    const request = pending_player[roll_id];
    if (!request) return;

    const rolled = roll_expr(request.dice);
    if (!rolled) return;

    delete pending_player[roll_id];
    active_roll_id = Object.keys(pending_player)[0] ?? null;

    write_status(status_path, {
        spinner: next_spinner(),
        last_player_roll: `${rolled.base} (${request.dice} rolled ${rolled.faces.join(",")})`,
        dice_label: active_roll_id ? pending_player[active_roll_id]?.dice ?? request.dice : request.dice,
        disabled: active_roll_id === null,
        roll_id: active_roll_id,
    });

    emit_roll_result(outbox_path, request, rolled.faces, rolled.base);
}

async function process_message(outbox_path: string, status_path: string, msg: MessageEnvelope): Promise<void> {
    const processing = try_set_message_status(msg, "processing");
    if (!processing.ok) return;
    update_outbox_message(outbox_path, processing.message);
    append_log_envelope(get_log_path(data_slot_number), processing.message);

    if (msg.stage?.startsWith("roll_request_")) {
        handle_roll_request(outbox_path, status_path, msg);
    }

    if (msg.stage?.startsWith("roll_input_")) {
        handle_roll_input(outbox_path, status_path, msg);
    }

    const done = try_set_message_status(processing.message, "done");
    if (done.ok) {
        update_outbox_message(outbox_path, done.message);
        append_log_envelope(get_log_path(data_slot_number), done.message);
    }

    await sleep(0);
}

async function tick(outbox_path: string, status_path: string): Promise<void> {
    const outbox = read_outbox(outbox_path);
    const candidates = outbox.messages.filter(
        (m) => (m.stage?.startsWith("roll_request_") || m.stage?.startsWith("roll_input_")) && m.status === "sent",
    );

    for (const msg of candidates) {
        await process_message(outbox_path, status_path, msg);
    }
}

function initialize(): { outbox_path: string; status_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const status_path = get_roller_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_roller_status_exists(status_path);

    return { outbox_path, status_path };
}

const { outbox_path, status_path } = initialize();
debug_log("Roller: booted", { outbox_path, status_path });

setInterval(() => {
    void tick(outbox_path, status_path);
}, POLL_MS);

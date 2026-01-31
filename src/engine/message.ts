import type { MessageEnvelope, MessageStatus } from "./types.js";
import { make_log_id } from "./log_store.js";

export type MessageInput = Omit<MessageEnvelope, "id" | "created_at"> & {
    id?: string;
    created_at?: string;
};

export function create_correlation_id(): string {
    return make_log_id(1);
}

type StatusResult = {
    ok: boolean;
    message: MessageEnvelope;
};

function is_awaiting_roll(status: MessageStatus | undefined): boolean {
    return typeof status === 'string' && status.startsWith('awaiting_roll_');
}

function can_transition_status(from: MessageStatus | undefined, to: MessageStatus): boolean {
    if (from === undefined) return to === 'sent' || to === 'queued';
    if (from === 'queued') return to === 'sent' || to === 'processing' || to === 'error';
    if (from === 'sent') return to === 'processing' || to === 'error';
    if (from === 'processing') return to === 'done' || to === 'pending_state_apply' || to === 'error' || is_awaiting_roll(to);
    if (is_awaiting_roll(from)) return to === 'processing' || to === 'done' || to === 'error';
    if (from === 'pending_state_apply') return to === 'processing' || to === 'error';  // StateApplier processes pending messages
    return false;
}

export function try_set_message_status(message: MessageEnvelope, to: MessageStatus): StatusResult {
    if (!can_transition_status(message.status, to)) {
        return { ok: false, message };
    }

    const meta = { ...(message.meta ?? {}), status_updated_at: new Date().toISOString() };
    return {
        ok: true,
        message: {
            ...message,
            status: to,
            meta,
        },
    };
}

export function create_message(input: MessageInput): MessageEnvelope {
    const msg: MessageEnvelope = {
        id: input.id ?? make_log_id(1),
        sender: input.sender,
        content: input.content,
        created_at: input.created_at ?? new Date().toISOString(),
    };

    if (input.type !== undefined) msg.type = input.type;
    if (input.stage !== undefined) msg.stage = input.stage;
    if (input.slot !== undefined) msg.slot = input.slot;
    if (input.correlation_id !== undefined) msg.correlation_id = input.correlation_id;
    if (input.reply_to !== undefined) msg.reply_to = input.reply_to;
    if (input.priority !== undefined) msg.priority = input.priority;
    if (input.status !== undefined) msg.status = input.status;
    if (input.flags !== undefined) msg.flags = input.flags;
    if (input.meta !== undefined) msg.meta = input.meta;

    return msg;
}

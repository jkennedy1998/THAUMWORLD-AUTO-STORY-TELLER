// moved from src/interface_program/main.ts during engine split

export type MessageStatus = 'queued' | 'sent' | 'processing' | 'pending_state_apply' | 'done' | 'error' | `awaiting_roll_${number}`;

export type MessageEnvelope = {
    id: string; // "ISO : 000001 : randBase32RFC(6)"
    sender: string;
    content: string;
    created_at?: string; // ISO timestamp
    type?: string; // message kind, e.g. "user_input", "narrative"
    stage?: string; // pipeline stage name
    slot?: number; // data slot
    correlation_id?: string; // ties a whole pipeline run together
    reply_to?: string; // message id this responds to
    priority?: number; // higher = more urgent
    status?: MessageStatus;
    flags?: string[];
    meta?: Record<string, unknown>;
};

export type LogMessage = MessageEnvelope;

export type LogFile = {
    schema_version: 1;
    messages: MessageEnvelope[];
};

export type InboxFile = {
    schema_version: 1;
    messages: MessageEnvelope[]; // same shape as log.jsonc
};

export type OutboxFile = {
    schema_version: 1;
    messages: MessageEnvelope[];
};

export const BASE32_RFC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

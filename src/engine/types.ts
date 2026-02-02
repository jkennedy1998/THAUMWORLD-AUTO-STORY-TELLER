// moved from src/interface_program/main.ts during engine split

export type MessageStatus = 'queued' | 'sent' | 'processing' | 'pending_state_apply' | 'done' | 'error' | 'superseded' | `awaiting_roll_${number}`;

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
    
    // Conversation threading (Phase 1)
    conversation_id?: string; // Groups related messages
    turn_number?: number; // Order within conversation
    displayed?: boolean; // Whether user has seen this message
    role?: "player" | "npc" | "system" | "renderer"; // Who/what generated this
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

// Conversation threading types (Phase 1)
export type ConversationParticipant = {
    ref: string; // actor.henry_actor or npc.grenda
    name: string;
    joined_at: string; // ISO timestamp
    left_at?: string; // ISO timestamp if they left
    role: "active" | "passive" | "eavesdropper"; // active = speaking, passive = listening, eavesdropper = overhearing
};

export type ConversationMessage = {
    turn: number;
    message_id: string; // Reference to MessageEnvelope.id
    speaker: string;
    text: string;
    timestamp: string;
    emotional_tone?: string;
    action_verb?: string;
};

export type Conversation = {
    id: string;
    schema_version: 1;
    
    // Metadata
    started_at: string;
    ended_at?: string;
    region_id: string; // Where conversation happens
    event_id?: string; // If part of timed event
    
    // Participants
    participants: ConversationParticipant[];
    
    // Content
    messages: ConversationMessage[];
    
    // Topics & state
    topics_discussed: string[];
    unresolved_points: string[];
    agreements_reached: string[];
    conflicts_raised: string[];
    
    // Status
    status: "active" | "paused" | "ended";
    last_activity: string; // ISO timestamp
};

export type ConversationFile = {
    schema_version: 1;
    conversations: Conversation[];
};

// Conversation Manager Service
// Manages conversation threading, tracking, and lifecycle

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error } from "../shared/debug.js";
import type { Conversation, ConversationParticipant, ConversationMessage } from "../engine/types.js";

const CONVERSATIONS_FILE = "conversations.jsonc";

function get_conversations_path(slot: number): string {
    return path.join(get_data_slot_dir(slot), CONVERSATIONS_FILE);
}

function ensure_conversations_file(slot: number): void {
    const file_path = get_conversations_path(slot);
    if (!fs.existsSync(file_path)) {
        const initial = { schema_version: 1, conversations: [] };
        fs.writeFileSync(file_path, JSON.stringify(initial, null, 2), "utf-8");
    }
}

function read_conversations(slot: number): { schema_version: number; conversations: Conversation[] } {
    ensure_conversations_file(slot);
    const file_path = get_conversations_path(slot);
    const raw = fs.readFileSync(file_path, "utf-8");
    return parse(raw) as { schema_version: number; conversations: Conversation[] };
}

function write_conversations(slot: number, data: { schema_version: number; conversations: Conversation[] }): void {
    const file_path = get_conversations_path(slot);
    fs.writeFileSync(file_path, JSON.stringify(data, null, 2), "utf-8");
}

// Start a new conversation
export function start_conversation(
    slot: number,
    region_id: string,
    initiator: string,
    initial_message: string,
    participants: string[] = []
): string {
    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();
    
    const conversation: Conversation = {
        id,
        schema_version: 1,
        started_at: now,
        region_id,
        participants: [
            {
                ref: initiator,
                name: initiator.split(".")[1] || initiator,
                joined_at: now,
                role: "active"
            },
            ...participants.map(p => ({
                ref: p,
                name: p.split(".")[1] || p,
                joined_at: now,
                role: "passive" as const
            }))
        ],
        messages: [],
        topics_discussed: [],
        unresolved_points: [],
        agreements_reached: [],
        conflicts_raised: [],
        status: "active",
        last_activity: now
    };
    
    const data = read_conversations(slot);
    data.conversations.push(conversation);
    write_conversations(slot, data);
    
    debug_log("ConversationManager", "Started conversation", { id, region_id, initiator });
    return id;
}

// Add a message to a conversation
export function add_message_to_conversation(
    slot: number,
    conversation_id: string,
    message: ConversationMessage
): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation) {
        debug_error("ConversationManager", "Conversation not found", { conversation_id });
        return false;
    }
    
    if (conversation.status !== "active") {
        debug_error("ConversationManager", "Cannot add message to inactive conversation", { 
            conversation_id, 
            status: conversation.status 
        });
        return false;
    }
    
    conversation.messages.push(message);
    conversation.last_activity = new Date().toISOString();
    
    // Update participant to active if they're speaking
    const participant = conversation.participants.find(p => p.ref === message.speaker);
    if (participant && participant.role === "passive") {
        participant.role = "active";
    }
    
    write_conversations(slot, data);
    return true;
}

// Get a conversation by ID
export function get_conversation(slot: number, conversation_id: string): Conversation | null {
    const data = read_conversations(slot);
    return data.conversations.find(c => c.id === conversation_id) || null;
}

// Get active conversations in a region
export function get_active_conversations_in_region(slot: number, region_id: string): Conversation[] {
    const data = read_conversations(slot);
    return data.conversations.filter(c => 
        c.region_id === region_id && c.status === "active"
    );
}

// Get conversations for a participant
export function get_conversations_for_participant(slot: number, participant_ref: string): Conversation[] {
    const data = read_conversations(slot);
    return data.conversations.filter(c =>
        c.participants.some(p => p.ref === participant_ref)
    );
}

// End a conversation
export function end_conversation(slot: number, conversation_id: string): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation) return false;
    
    conversation.status = "ended";
    conversation.ended_at = new Date().toISOString();
    
    write_conversations(slot, data);
    debug_log("ConversationManager", "Ended conversation", { conversation_id });
    return true;
}

// Pause a conversation (e.g., during combat)
export function pause_conversation(slot: number, conversation_id: string): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation || conversation.status !== "active") return false;
    
    conversation.status = "paused";
    write_conversations(slot, data);
    debug_log("ConversationManager", "Paused conversation", { conversation_id });
    return true;
}

// Resume a paused conversation
export function resume_conversation(slot: number, conversation_id: string): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation || conversation.status !== "paused") return false;
    
    conversation.status = "active";
    conversation.last_activity = new Date().toISOString();
    write_conversations(slot, data);
    debug_log("ConversationManager", "Resumed conversation", { conversation_id });
    return true;
}

// Add a participant to a conversation
export function add_participant(
    slot: number,
    conversation_id: string,
    participant_ref: string,
    role: "active" | "passive" | "eavesdropper" = "passive"
): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation) return false;
    
    // Check if already participating
    if (conversation.participants.some(p => p.ref === participant_ref)) {
        return true; // Already there, success
    }
    
    conversation.participants.push({
        ref: participant_ref,
        name: participant_ref.split(".")[1] || participant_ref,
        joined_at: new Date().toISOString(),
        role
    });
    
    write_conversations(slot, data);
    debug_log("ConversationManager", "Added participant", { conversation_id, participant_ref, role });
    return true;
}

// Remove a participant from a conversation
export function remove_participant(slot: number, conversation_id: string, participant_ref: string): boolean {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (!conversation) return false;
    
    const participant = conversation.participants.find(p => p.ref === participant_ref);
    if (participant) {
        participant.left_at = new Date().toISOString();
        participant.role = "passive"; // Can no longer speak
    }
    
    write_conversations(slot, data);
    debug_log("ConversationManager", "Removed participant", { conversation_id, participant_ref });
    return true;
}

// Add a topic to the conversation
export function add_topic(slot: number, conversation_id: string, topic: string): void {
    const data = read_conversations(slot);
    const conversation = data.conversations.find(c => c.id === conversation_id);
    
    if (conversation && !conversation.topics_discussed.includes(topic)) {
        conversation.topics_discussed.push(topic);
        write_conversations(slot, data);
    }
}

// Get conversation summary for AI context
export function get_conversation_summary(slot: number, conversation_id: string): string | null {
    const conversation = get_conversation(slot, conversation_id);
    if (!conversation) return null;
    
    const recent_messages = conversation.messages.slice(-5);
    
    return `
Conversation in ${conversation.region_id}
Participants: ${conversation.participants.map(p => p.name).join(", ")}
Status: ${conversation.status}
Messages: ${conversation.messages.length}

Recent exchanges:
${recent_messages.map(m => `  ${m.speaker}: ${m.text}`).join("\n")}

Topics: ${conversation.topics_discussed.join(", ") || "None yet"}
    `.trim();
}

// Clean up old conversations (call periodically)
export function cleanup_old_conversations(slot: number, max_age_days: number = 30): number {
    const data = read_conversations(slot);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - max_age_days);
    
    const initial_count = data.conversations.length;
    data.conversations = data.conversations.filter(c => {
        const last_activity = new Date(c.last_activity);
        return last_activity > cutoff || c.status === "active";
    });
    
    write_conversations(slot, data);
    const removed = initial_count - data.conversations.length;
    
    if (removed > 0) {
        debug_log("ConversationManager", "Cleaned up old conversations", { removed });
    }
    
    return removed;
}

// Conversation Archive System
// Stores full conversation data for long-term memory and AI processing

import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error } from "../shared/debug.js";

const CONVERSATIONS_DIR = "conversations";
const ARCHIVE_FILE = "conversation_archive.jsonc";

// In-memory cache for active conversations
const conversationCache = new Map<string, ConversationArchive>();

export type ParticipantRole = "active" | "passive" | "eavesdropper";

export type ConversationParticipant = {
    ref: string; // actor.<id> or npc.<id>
    joined_at: string; // ISO timestamp
    left_at?: string; // ISO timestamp if they left
    role: ParticipantRole;
};

export type ConversationMessage = {
    turn: number;
    speaker: string; // actor.<id> or npc.<id>
    text: string;
    timestamp: string; // ISO timestamp
    emotional_tone: string; // "calm", "heated", "friendly", "hostile", etc.
    action_verb?: string; // The action that triggered this message
    meta?: {
        is_significant?: boolean;
        contains_information?: boolean;
        is_greeting?: boolean;
        is_farewell?: boolean;
    };
};

export type ConversationArchive = {
    conversation_id: string;
    started_at: string;
    ended_at?: string;
    region_id: string;
    
    participants: ConversationParticipant[];
    messages: ConversationMessage[];
    
    // Conversation analysis
    topics_discussed: string[];
    unresolved_points: string[];
    agreements_reached: string[];
    conflicts_raised: string[];
    
    // Metadata
    stats: {
        message_count: number;
        participant_count: number;
        duration_seconds?: number;
        last_activity: string;
    };
    
    // Links to related conversations
    parent_conversation_id?: string; // If this branched from another
    child_conversation_ids: string[]; // Conversations that branched from this
    
    // Processing status
    processing: {
        is_formatted: boolean;
        is_summarized: boolean;
        summary_id?: string;
        formatted_at?: string;
        summarized_at?: string;
    };
};

function get_conversations_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), CONVERSATIONS_DIR);
}

function get_archive_path(slot: number): string {
    return path.join(get_conversations_dir(slot), ARCHIVE_FILE);
}

function ensure_conversations_dir(slot: number): void {
    const dir = get_conversations_dir(slot);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function ensure_archive_file(slot: number): void {
    ensure_conversations_dir(slot);
    const file_path = get_archive_path(slot);
    if (!fs.existsSync(file_path)) {
        const initial = { 
            schema_version: 1, 
            archived_at: new Date().toISOString(),
            conversations: [] 
        };
        fs.writeFileSync(file_path, JSON.stringify(initial, null, 2), "utf-8");
    }
}

/**
 * Start a new conversation archive
 */
export function start_conversation(
    slot: number,
    conversation_id: string,
    region_id: string,
    initial_participants: string[],
    parent_conversation_id?: string
): ConversationArchive {
    const now = new Date().toISOString();
    
    const participants: ConversationParticipant[] = initial_participants.map((ref, index) => ({
        ref,
        joined_at: now,
        role: index === 0 ? "active" : "passive" // First participant is the initiator
    }));
    
    const conversation: ConversationArchive = {
        conversation_id,
        started_at: now,
        region_id,
        participants,
        messages: [],
        topics_discussed: [],
        unresolved_points: [],
        agreements_reached: [],
        conflicts_raised: [],
        child_conversation_ids: [],
        parent_conversation_id,
        stats: {
            message_count: 0,
            participant_count: participants.length,
            last_activity: now
        },
        processing: {
            is_formatted: false,
            is_summarized: false
        }
    };
    
    // Cache it
    conversationCache.set(conversation_id, conversation);
    
    // Save to disk
    save_conversation(slot, conversation);
    
    // If this has a parent, update parent's child list
    if (parent_conversation_id) {
        const parent = load_conversation(slot, parent_conversation_id);
        if (parent) {
            parent.child_conversation_ids.push(conversation_id);
            save_conversation(slot, parent);
        }
    }
    
    debug_log("ConversationArchive", "Started conversation", {
        conversation_id,
        region_id,
        participants: initial_participants.length
    });
    
    return conversation;
}

/**
 * Add a message to a conversation
 */
export function add_message(
    slot: number,
    conversation_id: string,
    speaker: string,
    text: string,
    emotional_tone: string = "neutral",
    action_verb?: string
): void {
    let conversation = get_conversation(slot, conversation_id);
    
    if (!conversation) {
        debug_error("ConversationArchive", "Conversation not found", { conversation_id });
        return;
    }
    
    const now = new Date().toISOString();
    
    // Ensure speaker is in participants
    if (!conversation.participants.some(p => p.ref === speaker)) {
        conversation.participants.push({
            ref: speaker,
            joined_at: now,
            role: "active"
        });
        conversation.stats.participant_count = conversation.participants.length;
    }
    
    // Analyze message for metadata
    const meta = analyze_message(text);
    
    const message: ConversationMessage = {
        turn: conversation.messages.length + 1,
        speaker,
        text,
        timestamp: now,
        emotional_tone,
        action_verb,
        meta
    };
    
    conversation.messages.push(message);
    conversation.stats.message_count++;
    conversation.stats.last_activity = now;
    
    // Update topics if message contains information
    if (meta?.contains_information) {
        extract_topics(text, conversation.topics_discussed);
    }
    
    // Check for agreements/conflicts
    if (text.toLowerCase().includes("agree") || text.toLowerCase().includes("yes") || 
        text.toLowerCase().includes("deal") || text.toLowerCase().includes("promise")) {
        conversation.agreements_reached.push(text.slice(0, 100));
    }
    
    if (text.toLowerCase().includes("disagree") || text.toLowerCase().includes("no") || 
        text.toLowerCase().includes("never") || text.toLowerCase().includes("conflict")) {
        conversation.conflicts_raised.push(text.slice(0, 100));
    }
    
    // Save
    save_conversation(slot, conversation);
    conversationCache.set(conversation_id, conversation);
    
    debug_log("ConversationArchive", "Added message", {
        conversation_id,
        speaker,
        turn: message.turn
    });
}

/**
 * Analyze a message for metadata
 */
function analyze_message(text: string): ConversationMessage["meta"] {
    const lower = text.toLowerCase();
    
    const isGreeting = /\b(hello|hi|greetings|hey|good (morning|day|evening)|welcome)\b/.test(lower);
    const isFarewell = /\b(goodbye|bye|farewell|see you|later|until)\b/.test(lower);
    
    // Information detection (questions, statements with facts, etc.)
    const containsInformation = 
        /\?/.test(text) || // Questions
        /\b(know|heard|saw|found|learned|discovered|remember)\b/.test(lower) || // Information words
        /\b(because|since|therefore|however|but|although)\b/.test(lower) || // Complex statements
        text.length > 50; // Longer messages often contain information
    
    const isSignificant = 
        containsInformation ||
        isGreeting ||
        isFarewell ||
        /\b(agree|promise|deal|swear|never|always|must|will not)\b/.test(lower);
    
    return {
        is_significant: isSignificant,
        contains_information: containsInformation,
        is_greeting: isGreeting,
        is_farewell: isFarewell
    };
}

/**
 * Extract topics from message text
 */
function extract_topics(text: string, existing_topics: string[]): void {
    const lower = text.toLowerCase();
    
    // Topic keywords
    const topic_keywords: Record<string, string[]> = {
        "location": ["where", "place", "location", "area", "region", "map"],
        "quest": ["quest", "mission", "task", "job", "adventure"],
        "item": ["item", "weapon", "armor", "potion", "gold", "money", "treasure"],
        "person": ["who", "person", "npc", "character", "someone"],
        "combat": ["fight", "battle", "attack", "defend", "enemy", "monster"],
        "magic": ["magic", "spell", "mana", "arcane", "wizard", "sorcerer"],
        "lore": ["history", "legend", "story", "lore", "tale", "myth"],
        "trade": ["buy", "sell", "price", "cost", "trade", "shop", "merchant"],
        "faction": ["guild", "faction", "clan", "order", "group", "organization"]
    };
    
    for (const [topic, keywords] of Object.entries(topic_keywords)) {
        if (keywords.some(kw => lower.includes(kw)) && !existing_topics.includes(topic)) {
            existing_topics.push(topic);
        }
    }
}

/**
 * Mark a participant as leaving a conversation
 */
export function participant_leave(
    slot: number,
    conversation_id: string,
    participant_ref: string
): void {
    const conversation = get_conversation(slot, conversation_id);
    if (!conversation) return;
    
    const participant = conversation.participants.find(p => p.ref === participant_ref);
    if (participant) {
        participant.left_at = new Date().toISOString();
        save_conversation(slot, conversation);
        conversationCache.set(conversation_id, conversation);
    }
}

/**
 * End a conversation
 */
export function end_conversation(
    slot: number,
    conversation_id: string,
    unresolved_points?: string[]
): void {
    const conversation = get_conversation(slot, conversation_id);
    if (!conversation) return;
    
    const now = new Date().toISOString();
    conversation.ended_at = now;
    
    // Calculate duration
    const start = new Date(conversation.started_at).getTime();
    const end = new Date(now).getTime();
    conversation.stats.duration_seconds = Math.floor((end - start) / 1000);
    
    // Add any final unresolved points
    if (unresolved_points) {
        conversation.unresolved_points.push(...unresolved_points);
    }
    
    // Move to archive
    archive_conversation(slot, conversation);
    
    // Remove from active cache
    conversationCache.delete(conversation_id);
    
    debug_log("ConversationArchive", "Ended conversation", {
        conversation_id,
        duration_seconds: conversation.stats.duration_seconds,
        message_count: conversation.stats.message_count
    });
}

/**
 * Save conversation to disk
 */
function save_conversation(slot: number, conversation: ConversationArchive): void {
    ensure_conversations_dir(slot);
    const file_path = path.join(get_conversations_dir(slot), `${conversation.conversation_id}.jsonc`);
    fs.writeFileSync(file_path, JSON.stringify(conversation, null, 2), "utf-8");
}

/**
 * Load conversation from disk
 */
function load_conversation(slot: number, conversation_id: string): ConversationArchive | null {
    const file_path = path.join(get_conversations_dir(slot), `${conversation_id}.jsonc`);
    if (!fs.existsSync(file_path)) return null;
    
    try {
        const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
        return data as ConversationArchive;
    } catch (err) {
        debug_error("ConversationArchive", "Failed to load conversation", { conversation_id, error: err });
        return null;
    }
}

/**
 * Get conversation (from cache or disk)
 */
export function get_conversation(
    slot: number,
    conversation_id: string
): ConversationArchive | null {
    // Check cache first
    const cached = conversationCache.get(conversation_id);
    if (cached) return cached;
    
    // Load from disk
    const conversation = load_conversation(slot, conversation_id);
    if (conversation) {
        conversationCache.set(conversation_id, conversation);
    }
    return conversation;
}

/**
 * Archive a completed conversation
 */
function archive_conversation(slot: number, conversation: ConversationArchive): void {
    ensure_archive_file(slot);
    const archive_path = get_archive_path(slot);
    
    const data = JSON.parse(fs.readFileSync(archive_path, "utf-8"));
    
    // Check if already archived
    const existing_index = data.conversations.findIndex(
        (c: ConversationArchive) => c.conversation_id === conversation.conversation_id
    );
    
    if (existing_index >= 0) {
        data.conversations[existing_index] = conversation;
    } else {
        data.conversations.push(conversation);
    }
    
    fs.writeFileSync(archive_path, JSON.stringify(data, null, 2), "utf-8");
    
    // Also save individual file for easy access
    save_conversation(slot, conversation);
}

/**
 * List all conversations for a participant
 */
export function get_participant_conversations(
    slot: number,
    participant_ref: string,
    options?: {
        limit?: number;
        include_archived?: boolean;
    }
): ConversationArchive[] {
    const conversations: ConversationArchive[] = [];
    
    // Check active conversations in cache
    for (const conversation of conversationCache.values()) {
        if (conversation.participants.some(p => p.ref === participant_ref)) {
            conversations.push(conversation);
        }
    }
    
    // Check archived conversations if requested
    if (options?.include_archived) {
        ensure_archive_file(slot);
        const archive_path = get_archive_path(slot);
        const data = JSON.parse(fs.readFileSync(archive_path, "utf-8"));
        
        for (const conversation of data.conversations) {
            if (conversation.participants.some((p: ConversationParticipant) => p.ref === participant_ref)) {
                // Don't duplicate if already in active list
                if (!conversations.some(c => c.conversation_id === conversation.conversation_id)) {
                    conversations.push(conversation);
                }
            }
        }
    }
    
    // Sort by start time (newest first)
    conversations.sort((a, b) => 
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
    
    // Apply limit
    if (options?.limit) {
        return conversations.slice(0, options.limit);
    }
    
    return conversations;
}

/**
 * Get active (non-ended) conversations
 */
export function get_active_conversations(slot: number): ConversationArchive[] {
    const active: ConversationArchive[] = [];
    
    for (const conversation of conversationCache.values()) {
        if (!conversation.ended_at) {
            active.push(conversation);
        }
    }
    
    return active;
}

/**
 * Update conversation processing status
 */
export function mark_conversation_formatted(
    slot: number,
    conversation_id: string,
    formatted_content: string
): void {
    const conversation = get_conversation(slot, conversation_id);
    if (!conversation) return;
    
    conversation.processing.is_formatted = true;
    conversation.processing.formatted_at = new Date().toISOString();
    
    // Save formatted content to separate file
    const formatted_path = path.join(
        get_conversations_dir(slot), 
        `${conversation_id}_formatted.txt`
    );
    fs.writeFileSync(formatted_path, formatted_content, "utf-8");
    
    save_conversation(slot, conversation);
    conversationCache.set(conversation_id, conversation);
}

/**
 * Mark conversation as summarized
 */
export function mark_conversation_summarized(
    slot: number,
    conversation_id: string,
    summary_id: string
): void {
    const conversation = get_conversation(slot, conversation_id);
    if (!conversation) return;
    
    conversation.processing.is_summarized = true;
    conversation.processing.summary_id = summary_id;
    conversation.processing.summarized_at = new Date().toISOString();
    
    save_conversation(slot, conversation);
    conversationCache.set(conversation_id, conversation);
}

/**
 * Clean up old conversations (maintenance)
 */
export function cleanup_old_conversations(
    slot: number,
    max_age_days: number = 30
): number {
    ensure_archive_file(slot);
    const archive_path = get_archive_path(slot);
    const data = JSON.parse(fs.readFileSync(archive_path, "utf-8"));
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - max_age_days);
    const cutoff_time = cutoff.getTime();
    
    const before_count = data.conversations.length;
    data.conversations = data.conversations.filter((c: ConversationArchive) => {
        const end_time = c.ended_at 
            ? new Date(c.ended_at).getTime() 
            : new Date(c.started_at).getTime();
        return end_time > cutoff_time;
    });
    
    fs.writeFileSync(archive_path, JSON.stringify(data, null, 2), "utf-8");
    
    const removed = before_count - data.conversations.length;
    if (removed > 0) {
        debug_log("ConversationArchive", "Cleaned up old conversations", { removed });
    }
    
    return removed;
}

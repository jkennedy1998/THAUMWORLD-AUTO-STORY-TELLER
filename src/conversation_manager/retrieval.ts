// Conversation Retrieval System
// Query and search conversation history

import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error } from "../shared/debug.js";
import type { ConversationArchive, ConversationMessage, ConversationParticipant } from "./archive.js";

const CONVERSATIONS_DIR = "conversations";
const ARCHIVE_FILE = "conversation_archive.jsonc";

// Search result with relevance score
export type ConversationSearchResult = {
    conversation: ConversationArchive;
    relevance_score: number;
    matched_messages: ConversationMessage[];
    match_reason: string;
};

// Query options
export type ConversationQuery = {
    participant_ref?: string;
    region_id?: string;
    topic?: string;
    time_range?: {
        from?: string; // ISO timestamp
        to?: string; // ISO timestamp
    };
    has_unresolved?: boolean;
    is_active?: boolean;
    search_text?: string;
    limit?: number;
};

function get_conversations_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), CONVERSATIONS_DIR);
}

function get_archive_path(slot: number): string {
    return path.join(get_conversations_dir(slot), ARCHIVE_FILE);
}

/**
 * Search conversations by query criteria
 */
export function search_conversations(
    slot: number,
    query: ConversationQuery
): ConversationSearchResult[] {
    const results: ConversationSearchResult[] = [];
    
    // Load all conversations (active + archived)
    const conversations = load_all_conversations(slot);
    
    for (const conversation of conversations) {
        let relevance = 0;
        const matched_messages: ConversationMessage[] = [];
        const match_reasons: string[] = [];
        
        // Check participant
        if (query.participant_ref) {
            if (conversation.participants.some(p => p.ref === query.participant_ref)) {
                relevance += 10;
                match_reasons.push("participant match");
            } else {
                continue; // Required participant not found
            }
        }
        
        // Check region
        if (query.region_id) {
            if (conversation.region_id === query.region_id) {
                relevance += 5;
                match_reasons.push("region match");
            } else {
                continue; // Wrong region
            }
        }
        
        // Check topic
        if (query.topic) {
            if (conversation.topics_discussed.some(t => 
                t.toLowerCase().includes(query.topic!.toLowerCase())
            )) {
                relevance += 8;
                match_reasons.push("topic match");
            }
        }
        
        // Check time range
        if (query.time_range) {
            const conv_time = new Date(conversation.started_at).getTime();
            
            if (query.time_range.from) {
                const from_time = new Date(query.time_range.from).getTime();
                if (conv_time < from_time) continue;
            }
            
            if (query.time_range.to) {
                const to_time = new Date(query.time_range.to).getTime();
                if (conv_time > to_time) continue;
            }
            
            relevance += 3;
            match_reasons.push("time range match");
        }
        
        // Check unresolved points
        if (query.has_unresolved !== undefined) {
            const hasUnresolved = conversation.unresolved_points.length > 0;
            if (hasUnresolved === query.has_unresolved) {
                relevance += 5;
                match_reasons.push(query.has_unresolved ? "has unresolved" : "no unresolved");
            } else if (query.has_unresolved) {
                continue; // Require unresolved but none exist
            }
        }
        
        // Check active status
        if (query.is_active !== undefined) {
            const isActive = !conversation.ended_at;
            if (isActive === query.is_active) {
                relevance += 3;
                match_reasons.push(isActive ? "active" : "ended");
            } else {
                continue;
            }
        }
        
        // Search text in messages
        if (query.search_text) {
            const search_lower = query.search_text.toLowerCase();
            let text_matches = 0;
            
            for (const message of conversation.messages) {
                if (message.text.toLowerCase().includes(search_lower)) {
                    matched_messages.push(message);
                    text_matches++;
                }
            }
            
            if (text_matches > 0) {
                relevance += text_matches * 2;
                match_reasons.push(`text match (${text_matches} messages)`);
            } else if (!query.participant_ref && !query.topic) {
                // If only searching text and no matches, skip
                continue;
            }
        }
        
        // Only add if there's some relevance
        if (relevance > 0) {
            results.push({
                conversation,
                relevance_score: relevance,
                matched_messages,
                match_reason: match_reasons.join(", ")
            });
        }
    }
    
    // Sort by relevance (highest first)
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    
    // Apply limit
    if (query.limit && query.limit > 0) {
        return results.slice(0, query.limit);
    }
    
    return results;
}

/**
 * Get conversation history for a specific participant
 * Returns most recent conversations first
 */
export function get_conversation_history(
    slot: number,
    participant_ref: string,
    options?: {
        limit?: number;
        include_active?: boolean;
        include_archived?: boolean;
        min_messages?: number;
    }
): ConversationArchive[] {
    const conversations: ConversationArchive[] = [];
    
    // Load active conversations
    if (options?.include_active !== false) {
        const active = load_active_conversations(slot);
        for (const conversation of active) {
            if (conversation.participants.some(p => p.ref === participant_ref)) {
                if (!options?.min_messages || conversation.messages.length >= options.min_messages) {
                    conversations.push(conversation);
                }
            }
        }
    }
    
    // Load archived conversations
    if (options?.include_archived !== false) {
        const archived = load_archived_conversations(slot);
        for (const conversation of archived) {
            if (conversation.participants.some(p => p.ref === participant_ref)) {
                if (!options?.min_messages || conversation.messages.length >= options.min_messages) {
                    // Don't duplicate if already added from active
                    if (!conversations.some(c => c.conversation_id === conversation.conversation_id)) {
                        conversations.push(conversation);
                    }
                }
            }
        }
    }
    
    // Sort by start time (newest first)
    conversations.sort((a, b) => 
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
    
    // Apply limit
    if (options?.limit && options.limit > 0) {
        return conversations.slice(0, options.limit);
    }
    
    return conversations;
}

/**
 * Find related conversations (parent/child/same participants)
 */
export function find_related_conversations(
    slot: number,
    conversation_id: string
): {
    parent?: ConversationArchive;
    children: ConversationArchive[];
    related: ConversationArchive[]; // Same participants, different time
} {
    const conversation = load_conversation_file(slot, conversation_id);
    if (!conversation) {
        return { children: [], related: [] };
    }
    
    const result: {
        parent?: ConversationArchive;
        children: ConversationArchive[];
        related: ConversationArchive[];
    } = {
        children: [],
        related: []
    };
    
    // Get parent
    if (conversation.parent_conversation_id) {
        result.parent = load_conversation_file(slot, conversation.parent_conversation_id) || undefined;
    }
    
    // Get children
    for (const child_id of conversation.child_conversation_ids) {
        const child = load_conversation_file(slot, child_id);
        if (child) {
            result.children.push(child);
        }
    }
    
    // Find related (same participants, different conversation)
    const participant_refs = conversation.participants.map(p => p.ref);
    const all_conversations = load_all_conversations(slot);
    
    for (const other of all_conversations) {
        if (other.conversation_id === conversation_id) continue;
        
        // Check if shares at least 2 participants
        const shared_participants = other.participants.filter(p => 
            participant_refs.includes(p.ref)
        );
        
        if (shared_participants.length >= 2) {
            result.related.push(other);
        }
    }
    
    return result;
}

/**
 * Get conversation statistics
 */
export function get_conversation_stats(
    slot: number,
    participant_ref?: string
): {
    total_conversations: number;
    active_conversations: number;
    archived_conversations: number;
    total_messages: number;
    average_duration_seconds: number;
    most_common_topics: string[];
    unresolved_count: number;
} {
    const all = load_all_conversations(slot);
    
    let filtered = all;
    if (participant_ref) {
        filtered = all.filter(c => 
            c.participants.some(p => p.ref === participant_ref)
        );
    }
    
    const active = filtered.filter(c => !c.ended_at);
    const archived = filtered.filter(c => c.ended_at);
    
    const total_messages = filtered.reduce((sum, c) => sum + c.messages.length, 0);
    
    const durations = filtered
        .filter(c => c.stats.duration_seconds)
        .map(c => c.stats.duration_seconds!);
    
    const avg_duration = durations.length > 0
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length
        : 0;
    
    // Count topics
    const topic_counts = new Map<string, number>();
    for (const conversation of filtered) {
        for (const topic of conversation.topics_discussed) {
            topic_counts.set(topic, (topic_counts.get(topic) || 0) + 1);
        }
    }
    
    const most_common = Array.from(topic_counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic]) => topic);
    
    const unresolved = filtered.filter(c => c.unresolved_points.length > 0).length;
    
    return {
        total_conversations: filtered.length,
        active_conversations: active.length,
        archived_conversations: archived.length,
        total_messages,
        average_duration_seconds: Math.floor(avg_duration),
        most_common_topics: most_common,
        unresolved_count: unresolved
    };
}

/**
 * Get unresolved points across all conversations for a participant
 */
export function get_unresolved_points(
    slot: number,
    participant_ref: string
): Array<{
    conversation_id: string;
    points: string[];
    started_at: string;
}> {
    const conversations = get_conversation_history(slot, participant_ref, {
        include_archived: true
    });
    
    const unresolved: Array<{
        conversation_id: string;
        points: string[];
        started_at: string;
    }> = [];
    
    for (const conversation of conversations) {
        if (conversation.unresolved_points.length > 0) {
            unresolved.push({
                conversation_id: conversation.conversation_id,
                points: conversation.unresolved_points,
                started_at: conversation.started_at
            });
        }
    }
    
    return unresolved;
}

/**
 * Find conversations by topic
 */
export function find_conversations_by_topic(
    slot: number,
    topic: string,
    options?: {
        participant_ref?: string;
        limit?: number;
    }
): ConversationArchive[] {
    const results = search_conversations(slot, {
        topic,
        participant_ref: options?.participant_ref,
        limit: options?.limit
    });
    
    return results.map(r => r.conversation);
}

/**
 * Get the most recent conversation between specific participants
 */
export function get_most_recent_conversation(
    slot: number,
    participant_refs: string[]
): ConversationArchive | null {
    const all = load_all_conversations(slot);
    
    // Filter conversations that include ALL specified participants
    const matching = all.filter(c => {
        const conv_participants = c.participants.map(p => p.ref);
        return participant_refs.every(ref => conv_participants.includes(ref));
    });
    
    if (matching.length === 0) return null;
    
    // Sort by start time (newest first) and return first
    matching.sort((a, b) => 
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
    
    return matching[0];
}

/**
 * Check if two participants have ever spoken
 */
export function have_conversed(
    slot: number,
    participant_a: string,
    participant_b: string
): boolean {
    const all = load_all_conversations(slot);
    
    return all.some(c => {
        const participants = c.participants.map(p => p.ref);
        return participants.includes(participant_a) && participants.includes(participant_b);
    });
}

/**
 * Get conversation timeline (chronological order)
 */
export function get_conversation_timeline(
    slot: number,
    participant_ref: string,
    options?: {
        from?: string;
        to?: string;
    }
): Array<{
    conversation: ConversationArchive;
    role: string;
    message_count: number;
}> {
    const conversations = get_conversation_history(slot, participant_ref, {
        include_archived: true
    });
    
    // Filter by time range if specified
    let filtered = conversations;
    if (options?.from || options?.to) {
        filtered = conversations.filter(c => {
            const conv_time = new Date(c.started_at).getTime();
            
            if (options.from) {
                const from_time = new Date(options.from).getTime();
                if (conv_time < from_time) return false;
            }
            
            if (options.to) {
                const to_time = new Date(options.to).getTime();
                if (conv_time > to_time) return false;
            }
            
            return true;
        });
    }
    
    // Sort chronologically
    filtered.sort((a, b) => 
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );
    
    // Build timeline entries
    return filtered.map(c => {
        const participant = c.participants.find(p => p.ref === participant_ref);
        const message_count = c.messages.filter(m => m.speaker === participant_ref).length;
        
        return {
            conversation: c,
            role: participant?.role || "unknown",
            message_count
        };
    });
}

// ===== HELPER FUNCTIONS =====

function load_all_conversations(slot: number): ConversationArchive[] {
    const conversations: ConversationArchive[] = [];
    
    // Load active
    conversations.push(...load_active_conversations(slot));
    
    // Load archived
    const archived = load_archived_conversations(slot);
    for (const conv of archived) {
        if (!conversations.some(c => c.conversation_id === conv.conversation_id)) {
            conversations.push(conv);
        }
    }
    
    return conversations;
}

function load_active_conversations(slot: number): ConversationArchive[] {
    const conversations: ConversationArchive[] = [];
    const dir = get_conversations_dir(slot);
    
    if (!fs.existsSync(dir)) return conversations;
    
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith(".jsonc") && !file.includes("_archive")) {
            const file_path = path.join(dir, file);
            try {
                const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
                // Only include non-ended conversations
                if (!data.ended_at) {
                    conversations.push(data as ConversationArchive);
                }
            } catch (err) {
                debug_error("ConversationRetrieval", "Failed to load conversation file", { file, error: err });
            }
        }
    }
    
    return conversations;
}

function load_archived_conversations(slot: number): ConversationArchive[] {
    const archive_path = get_archive_path(slot);
    
    if (!fs.existsSync(archive_path)) return [];
    
    try {
        const data = JSON.parse(fs.readFileSync(archive_path, "utf-8"));
        return (data.conversations || []) as ConversationArchive[];
    } catch (err) {
        debug_error("ConversationRetrieval", "Failed to load archive", { error: err });
        return [];
    }
}

function load_conversation_file(slot: number, conversation_id: string): ConversationArchive | null {
    const file_path = path.join(get_conversations_dir(slot), `${conversation_id}.jsonc`);
    
    if (!fs.existsSync(file_path)) {
        // Try archive
        const archive_path = get_archive_path(slot);
        if (fs.existsSync(archive_path)) {
            try {
                const data = JSON.parse(fs.readFileSync(archive_path, "utf-8"));
                const conversation = data.conversations?.find(
                    (c: ConversationArchive) => c.conversation_id === conversation_id
                );
                if (conversation) return conversation;
            } catch (err) {
                debug_error("ConversationRetrieval", "Failed to search archive", { error: err });
            }
        }
        return null;
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
        return data as ConversationArchive;
    } catch (err) {
        debug_error("ConversationRetrieval", "Failed to parse conversation file", { conversation_id, error: err });
        return null;
    }
}

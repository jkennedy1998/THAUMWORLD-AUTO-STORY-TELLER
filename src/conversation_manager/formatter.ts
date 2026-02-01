// Conversation Formatter
// Pre-AI formatting and compression for efficient processing

import type { ConversationArchive, ConversationMessage, ConversationParticipant } from "./archive.js";

// Format options
export type FormatOptions = {
    include_timestamps?: boolean;
    include_emotional_tones?: boolean;
    compress_greetings?: boolean;
    compress_repetition?: boolean;
    max_messages?: number;
    focus_on_significant?: boolean;
    participant_filter?: string[]; // Only include these participants
};

// Default format options
const DEFAULT_OPTIONS: FormatOptions = {
    include_timestamps: false,
    include_emotional_tones: true,
    compress_greetings: true,
    compress_repetition: true,
    max_messages: 50,
    focus_on_significant: true
};

/**
 * Format a conversation for AI consumption
 * Removes redundant info, compresses repetitive exchanges
 */
export function format_for_ai(
    conversation: ConversationArchive,
    options: FormatOptions = {}
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    let messages = [...conversation.messages];
    
    // Filter participants if specified
    if (opts.participant_filter && opts.participant_filter.length > 0) {
        messages = messages.filter(m => 
            opts.participant_filter!.includes(m.speaker)
        );
    }
    
    // Compress greetings if enabled
    if (opts.compress_greetings) {
        messages = compress_greeting_exchanges(messages);
    }
    
    // Compress repetition if enabled
    if (opts.compress_repetition) {
        messages = compress_repetitive_exchanges(messages);
    }
    
    // Focus on significant messages if enabled
    if (opts.focus_on_significant) {
        messages = messages.filter(m => is_significant(m));
    }
    
    // Limit message count
    if (opts.max_messages && messages.length > opts.max_messages) {
        // Keep first few and last few, compress middle
        const keep_count = Math.floor(opts.max_messages / 2);
        const first_part = messages.slice(0, keep_count);
        const last_part = messages.slice(-keep_count);
        
        const middle_count = messages.length - (keep_count * 2);
        if (middle_count > 0) {
            messages = [
                ...first_part,
                {
                    turn: first_part[first_part.length - 1]?.turn || 0 + 1,
                    speaker: "system",
                    text: `[... ${middle_count} messages omitted ...]`,
                    timestamp: "",
                    emotional_tone: "neutral",
                    meta: { is_significant: false }
                } as ConversationMessage,
                ...last_part
            ];
        }
    }
    
    // Build formatted output
    const parts: string[] = [];
    
    // Header
    parts.push(format_header(conversation));
    
    // Participants
    parts.push(format_participants(conversation.participants));
    
    // Messages
    parts.push(format_messages(messages, opts));
    
    // Topics and unresolved
    parts.push(format_summary(conversation));
    
    return parts.join("\n\n");
}

/**
 * Format conversation header
 */
function format_header(conversation: ConversationArchive): string {
    const lines: string[] = [];
    
    lines.push(`CONVERSATION: ${conversation.conversation_id}`);
    lines.push(`Location: ${simplify_region_id(conversation.region_id)}`);
    
    if (conversation.stats.duration_seconds) {
        lines.push(`Duration: ${format_duration(conversation.stats.duration_seconds)}`);
    }
    
    lines.push(`Messages: ${conversation.messages.length}`);
    
    return lines.join("\n");
}

/**
 * Format participant list
 */
function format_participants(participants: ConversationParticipant[]): string {
    const lines: string[] = [];
    lines.push("PARTICIPANTS:");
    
    for (const p of participants) {
        const name = simplify_ref(p.ref);
        const role = p.role !== "active" ? ` (${p.role})` : "";
        lines.push(`- ${name}${role}`);
    }
    
    return lines.join("\n");
}

/**
 * Format messages
 */
function format_messages(
    messages: ConversationMessage[],
    opts: FormatOptions
): string {
    const lines: string[] = [];
    lines.push("DIALOGUE:");
    
    for (const message of messages) {
        const speaker = simplify_ref(message.speaker);
        
        let line = `${speaker}: "${message.text}"`;
        
        // Add emotional tone if enabled and not neutral
        if (opts.include_emotional_tones && message.emotional_tone !== "neutral") {
            line += ` [${message.emotional_tone}]`;
        }
        
        lines.push(line);
    }
    
    return lines.join("\n");
}

/**
 * Format summary section
 */
function format_summary(conversation: ConversationArchive): string {
    const lines: string[] = [];
    
    if (conversation.topics_discussed.length > 0) {
        lines.push(`Topics: ${conversation.topics_discussed.join(", ")}`);
    }
    
    if (conversation.agreements_reached.length > 0) {
        lines.push(`Agreements: ${conversation.agreements_reached.length} made`);
    }
    
    if (conversation.conflicts_raised.length > 0) {
        lines.push(`Conflicts: ${conversation.conflicts_raised.length} raised`);
    }
    
    if (conversation.unresolved_points.length > 0) {
        lines.push(`Unresolved:`);
        for (const point of conversation.unresolved_points.slice(0, 3)) {
            lines.push(`  - ${point.slice(0, 80)}${point.length > 80 ? "..." : ""}`);
        }
    }
    
    if (lines.length === 0) return "";
    
    return "SUMMARY:\n" + lines.join("\n");
}

/**
 * Compress greeting exchanges
 * "hello" "hi" "greetings" → [greeting exchange]
 */
function compress_greeting_exchanges(messages: ConversationMessage[]): ConversationMessage[] {
    const result: ConversationMessage[] = [];
    let in_greeting_block = false;
    let greeting_start_turn = 0;
    
    for (const message of messages) {
        const is_greeting = message.meta?.is_greeting || is_greeting_message(message.text);
        
        if (is_greeting && !in_greeting_block) {
            // Start of greeting block
            in_greeting_block = true;
            greeting_start_turn = message.turn;
        } else if (!is_greeting && in_greeting_block) {
            // End of greeting block
            in_greeting_block = false;
            result.push({
                turn: greeting_start_turn,
                speaker: "system",
                text: "[Greeting exchange]",
                timestamp: "",
                emotional_tone: "neutral",
                meta: { is_significant: false }
            } as ConversationMessage);
            result.push(message);
        } else if (!is_greeting) {
            result.push(message);
        }
        // If greeting and in block, skip (compressing)
    }
    
    // Handle case where conversation ends with greetings
    if (in_greeting_block) {
        result.push({
            turn: greeting_start_turn,
            speaker: "system",
            text: "[Greeting exchange]",
            timestamp: "",
            emotional_tone: "neutral",
            meta: { is_significant: false }
        } as ConversationMessage);
    }
    
    return result;
}

/**
 * Compress repetitive exchanges
 * Multiple similar messages from same speaker
 */
function compress_repetitive_exchanges(messages: ConversationMessage[]): ConversationMessage[] {
    const result: ConversationMessage[] = [];
    let last_speaker = "";
    let repeat_count = 0;
    let last_message: ConversationMessage | null = null;
    
    for (const message of messages) {
        if (message.speaker === last_speaker) {
            // Same speaker - check if repetitive
            const similarity = calculate_similarity(message.text, last_message?.text || "");
            
            if (similarity > 0.7) {
                // Repetitive, skip
                repeat_count++;
                continue;
            }
        }
        
        // If we had repeats, add a note
        if (repeat_count > 0 && last_message) {
            result.push({
                ...last_message,
                text: `${last_message.text} [repeated ${repeat_count + 1}x]`
            });
        } else if (last_message) {
            result.push(last_message);
        }
        
        last_speaker = message.speaker;
        last_message = message;
        repeat_count = 0;
    }
    
    // Don't forget the last message
    if (last_message) {
        if (repeat_count > 0) {
            result.push({
                ...last_message,
                text: `${last_message.text} [repeated ${repeat_count + 1}x]`
            });
        } else {
            result.push(last_message);
        }
    }
    
    return result;
}

/**
 * Check if a message is significant enough to include
 */
function is_significant(message: ConversationMessage): boolean {
    // System messages are always significant (like compression markers)
    if (message.speaker === "system") return true;
    
    // Check meta
    if (message.meta?.is_significant) return true;
    if (message.meta?.contains_information) return true;
    
    // Short messages (< 20 chars) are probably not significant
    if (message.text.length < 20) return false;
    
    // Questions are significant
    if (message.text.includes("?")) return true;
    
    // Statements with key words
    const significant_words = [
        "agree", "promise", "deal", "swear", "never", "always",
        "because", "therefore", "however", "important", "remember",
        "know", "learned", "discovered", "found", "believe"
    ];
    
    const lower = message.text.toLowerCase();
    if (significant_words.some(w => lower.includes(w))) return true;
    
    return false;
}

/**
 * Check if message is a greeting
 */
function is_greeting_message(text: string): boolean {
    const greetings = [
        "hello", "hi", "greetings", "hey", "good morning",
        "good day", "good evening", "welcome", "howdy"
    ];
    
    const lower = text.toLowerCase();
    return greetings.some(g => lower.includes(g));
}

/**
 * Calculate text similarity (0-1)
 */
function calculate_similarity(a: string, b: string): number {
    if (a === b) return 1.0;
    if (a.length === 0 || b.length === 0) return 0.0;
    
    // Simple word overlap similarity
    const words_a = new Set(a.toLowerCase().split(/\s+/));
    const words_b = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words_a].filter(x => words_b.has(x)));
    const union = new Set([...words_a, ...words_b]);
    
    return intersection.size / union.size;
}

/**
 * Simplify region ID for human readability
 */
function simplify_region_id(region_id: string): string {
    // Convert "region.0_0_5_3" to "Region (5, 3)"
    const match = region_id.match(/region\.(\d+)_(\d+)_(\d+)_(\d+)/);
    if (match) {
        return `Region (${match[3]}, ${match[4]})`;
    }
    return region_id;
}

/**
 * Simplify actor/npc ref for readability
 */
function simplify_ref(ref: string): string {
    // Convert "actor.henry_actor" to "Henry"
    // Convert "npc.grenda" to "Grenda"
    
    if (ref.startsWith("actor.")) {
        const id = ref.replace("actor.", "");
        // Convert snake_case to Title Case
        return id.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
    
    if (ref.startsWith("npc.")) {
        const id = ref.replace("npc.", "");
        return id.charAt(0).toUpperCase() + id.slice(1);
    }
    
    return ref;
}

/**
 * Format duration in human-readable form
 */
function format_duration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Create a minimal summary for quick reference
 */
export function create_quick_summary(conversation: ConversationArchive): string {
    const parts: string[] = [];
    
    parts.push(`Conversation with ${conversation.participants.length} participants`);
    parts.push(`${conversation.messages.length} messages`);
    
    if (conversation.topics_discussed.length > 0) {
        parts.push(`Topics: ${conversation.topics_discussed.slice(0, 3).join(", ")}`);
    }
    
    if (conversation.unresolved_points.length > 0) {
        parts.push(`${conversation.unresolved_points.length} unresolved`);
    }
    
    return parts.join(" | ");
}

/**
 * Format conversation for a specific NPC's perspective
 * Only includes what this NPC would remember
 */
export function format_for_npc_perspective(
    conversation: ConversationArchive,
    npc_ref: string,
    options?: FormatOptions
): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Filter to only messages this NPC participated in or witnessed
    const npc_messages = conversation.messages.filter(m => {
        // NPC's own messages
        if (m.speaker === npc_ref) return true;
        
        // Messages from others (NPC was present)
        return true; // For now, assume NPC remembers all
    });
    
    // Add emotional context from NPC's perspective
    const lines: string[] = [];
    lines.push(`YOUR MEMORY OF CONVERSATION:`);
    lines.push(`You spoke with ${conversation.participants
        .filter(p => p.ref !== npc_ref)
        .map(p => simplify_ref(p.ref))
        .join(", ")}`);
    
    if (conversation.stats.duration_seconds) {
        lines.push(`Duration: ${format_duration(conversation.stats.duration_seconds)}`);
    }
    
    lines.push("");
    lines.push("What was said:");
    
    for (const message of npc_messages.slice(-20)) { // Last 20 messages
        const speaker = message.speaker === npc_ref ? "You" : simplify_ref(message.speaker);
        lines.push(`${speaker}: "${message.text.slice(0, 100)}${message.text.length > 100 ? "..." : ""}"`);
    }
    
    if (conversation.unresolved_points.length > 0) {
        lines.push("");
        lines.push("Unresolved matters:");
        for (const point of conversation.unresolved_points.slice(0, 3)) {
            lines.push(`- ${point.slice(0, 80)}${point.length > 80 ? "..." : ""}`);
        }
    }
    
    return lines.join("\n");
}

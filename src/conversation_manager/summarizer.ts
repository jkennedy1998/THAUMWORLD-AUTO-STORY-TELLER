// Conversation Summarizer
// AI-powered summarization for long-term NPC memory

import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error } from "../shared/debug.js";
import { ollama_chat } from "../shared/ollama_client.js";
import type { ConversationArchive } from "./archive.js";
import { format_for_ai, format_for_npc_perspective } from "./formatter.js";

const SUMMARIES_DIR = "conversation_summaries";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const SUMMARIZER_MODEL = process.env.SUMMARIZER_MODEL ?? "llama3.2:latest";
const SUMMARIZER_TIMEOUT_MS = 30000;

// In-memory cache for summaries
const summaryCache = new Map<string, ConversationSummary>();

export type ConversationSummary = {
    summary_id: string;
    conversation_id: string;
    npc_ref: string; // Summary is from this NPC's perspective
    
    created_at: string;
    
    // Summary content
    memory: string; // 2-3 sentence summary
    emotion: string; // How NPC feels about it
    learned: string[]; // Key information gained
    decided: string[]; // Resolutions made
    
    // Relationship changes
    relationship_changes: Array<{
        target_ref: string;
        change: "improved" | "worsened" | "unchanged";
        reason: string;
    }>;
    
    // Topics and importance
    topics: string[];
    importance_score: number; // 1-10
    
    // Metadata
    model_used: string;
    duration_ms: number;
};

function get_summaries_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), SUMMARIES_DIR);
}

function ensure_summaries_dir(slot: number): void {
    const dir = get_summaries_dir(slot);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Summarize a conversation for an NPC's long-term memory
 */
export async function summarize_for_npc(
    slot: number,
    conversation: ConversationArchive,
    npc_ref: string,
    npc_name: string,
    npc_personality: string
): Promise<ConversationSummary | null> {
    const summary_id = `${conversation.conversation_id}_${npc_ref.replace(/\./g, "_")}`;
    
    // Check cache first
    const cached = summaryCache.get(summary_id);
    if (cached) return cached;
    
    // Format conversation from NPC's perspective
    const formatted = format_for_npc_perspective(conversation, npc_ref, {
        max_messages: 30,
        focus_on_significant: true
    });
    
    // Build prompt
    const prompt = build_summarization_prompt(npc_name, npc_personality, formatted);
    
    const start_time = Date.now();
    
    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: SUMMARIZER_MODEL,
            messages: [
                { 
                    role: "system", 
                    content: "You are a conversation analyzer. Create concise, meaningful summaries from an NPC's perspective." 
                },
                { role: "user", content: prompt }
            ],
            timeout_ms: SUMMARIZER_TIMEOUT_MS,
            options: { temperature: 0.7 }
        });
        
        const duration_ms = Date.now() - start_time;
        
        // Parse the response
        const parsed = parse_summary_response(response.content, npc_ref);
        
        const summary: ConversationSummary = {
            summary_id,
            conversation_id: conversation.conversation_id,
            npc_ref,
            created_at: new Date().toISOString(),
            memory: parsed.memory || "Had a conversation",
            emotion: parsed.emotion || "neutral",
            learned: parsed.learned || [],
            decided: parsed.decided || [],
            relationship_changes: parsed.relationship_changes || [],
            topics: conversation.topics_discussed,
            importance_score: calculate_importance(conversation, parsed),
            model_used: response.model,
            duration_ms
        };
        
        // Save to disk
        save_summary(slot, summary);
        
        // Cache it
        summaryCache.set(summary_id, summary);
        
        debug_log("ConversationSummarizer", "Created summary", {
            summary_id,
            npc_ref,
            importance: summary.importance_score,
            duration_ms
        });
        
        return summary;
        
    } catch (err) {
        debug_error("ConversationSummarizer", "Failed to summarize", { 
            conversation_id: conversation.conversation_id, 
            npc_ref,
            error: err 
        });
        return null;
    }
}

/**
 * Build the summarization prompt
 */
function build_summarization_prompt(
    npc_name: string,
    npc_personality: string,
    formatted_conversation: string
): string {
    return `You are ${npc_name}. ${npc_personality}

You just had this conversation:

${formatted_conversation}

Create a memory of this conversation from YOUR perspective. Focus on what matters to YOU.

Respond in this exact format:

MEMORY: [2-3 sentences summarizing what happened and your reaction]

EMOTION: [single word or short phrase describing how you feel about this conversation: "pleased", "angry", "suspicious", "grateful", "worried", etc.]

LEARNED:
- [key fact or information you learned, if any]
- [another fact, if any]

DECIDED:
- [any decision or resolution you made, if any]
- [another decision, if any]

RELATIONSHIPS:
- [person's name]: [improved/worsened/unchanged] - [brief reason]

Keep it concise and in character. If nothing significant happened, say so.`;
}

/**
 * Parse the AI's summary response
 */
function parse_summary_response(
    content: string,
    npc_ref: string
): Partial<ConversationSummary> {
    const result: Partial<ConversationSummary> = {};
    
    const lines = content.split("\n");
    let current_section: string | null = null;
    const learned: string[] = [];
    const decided: string[] = [];
    const relationship_changes: ConversationSummary["relationship_changes"] = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith("MEMORY:")) {
            result.memory = trimmed.replace("MEMORY:", "").trim();
            current_section = null;
        } else if (trimmed.startsWith("EMOTION:")) {
            result.emotion = trimmed.replace("EMOTION:", "").trim();
            current_section = null;
        } else if (trimmed.startsWith("LEARNED:")) {
            current_section = "learned";
        } else if (trimmed.startsWith("DECIDED:")) {
            current_section = "decided";
        } else if (trimmed.startsWith("RELATIONSHIPS:")) {
            current_section = "relationships";
        } else if (trimmed.startsWith("-") && current_section) {
            const item = trimmed.replace("-", "").trim();
            if (item && item !== "none" && item !== "n/a") {
                switch (current_section) {
                    case "learned":
                        learned.push(item);
                        break;
                    case "decided":
                        decided.push(item);
                        break;
                    case "relationships":
                        const relationship = parse_relationship_line(item);
                        if (relationship) {
                            relationship_changes.push(relationship);
                        }
                        break;
                }
            }
        }
    }
    
    result.learned = learned;
    result.decided = decided;
    result.relationship_changes = relationship_changes;
    
    return result;
}

/**
 * Parse a relationship change line
 */
function parse_relationship_line(line: string): ConversationSummary["relationship_changes"][0] | null {
    // Format: "Person Name: improved - reason" or "Person: worsened"
    const match = line.match(/^([^:]+):\s*(improved|worsened|unchanged)(?:\s*-\s*(.+))?$/i);
    
    if (match) {
        return {
            target_ref: match[1].trim().toLowerCase().replace(/\s+/g, "_"),
            change: match[2].toLowerCase() as "improved" | "worsened" | "unchanged",
            reason: match[3]?.trim() || ""
        };
    }
    
    return null;
}

/**
 * Calculate importance score for a summary
 */
function calculate_importance(
    conversation: ConversationArchive,
    parsed: Partial<ConversationSummary>
): number {
    let score = 5; // Base score
    
    // More messages = more important
    if (conversation.messages.length > 20) score += 1;
    if (conversation.messages.length > 50) score += 1;
    
    // Agreements and conflicts are important
    score += conversation.agreements_reached.length;
    score += conversation.conflicts_raised.length;
    
    // Unresolved points are important
    score += conversation.unresolved_points.length * 0.5;
    
    // Learned information is important
    score += (parsed.learned?.length || 0) * 0.5;
    
    // Decisions are important
    score += (parsed.decided?.length || 0);
    
    // Relationship changes are important
    score += (parsed.relationship_changes?.length || 0) * 1.5;
    
    // Emotional intensity
    const intense_emotions = ["angry", "furious", "ecstatic", "terrified", "heartbroken"];
    if (intense_emotions.some(e => parsed.emotion?.toLowerCase().includes(e))) {
        score += 1;
    }
    
    // Clamp to 1-10
    return Math.max(1, Math.min(10, Math.floor(score)));
}

/**
 * Save summary to disk
 */
function save_summary(slot: number, summary: ConversationSummary): void {
    ensure_summaries_dir(slot);
    const file_path = path.join(get_summaries_dir(slot), `${summary.summary_id}.jsonc`);
    fs.writeFileSync(file_path, JSON.stringify(summary, null, 2), "utf-8");
}

/**
 * Load summary from disk
 */
export function load_summary(
    slot: number,
    summary_id: string
): ConversationSummary | null {
    // Check cache first
    const cached = summaryCache.get(summary_id);
    if (cached) return cached;
    
    const file_path = path.join(get_summaries_dir(slot), `${summary_id}.jsonc`);
    if (!fs.existsSync(file_path)) return null;
    
    try {
        const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
        const summary = data as ConversationSummary;
        summaryCache.set(summary_id, summary);
        return summary;
    } catch (err) {
        debug_error("ConversationSummarizer", "Failed to load summary", { summary_id, error: err });
        return null;
    }
}

/**
 * Get all summaries for an NPC
 */
export function get_npc_summaries(
    slot: number,
    npc_ref: string,
    options?: {
        min_importance?: number;
        limit?: number;
        topic?: string;
    }
): ConversationSummary[] {
    const summaries: ConversationSummary[] = [];
    const dir = get_summaries_dir(slot);
    
    if (!fs.existsSync(dir)) return summaries;
    
    const files = fs.readdirSync(dir);
    const prefix = `${npc_ref.replace(/\./g, "_")}_`;
    
    for (const file of files) {
        if (file.endsWith(".jsonc")) {
            const summary_id = file.replace(".jsonc", "");
            // Check if this summary belongs to the NPC
            if (summary_id.includes(npc_ref.replace(/\./g, "_"))) {
                const summary = load_summary(slot, summary_id);
                if (summary) {
                    // Apply filters
                    if (options?.min_importance && summary.importance_score < options.min_importance) {
                        continue;
                    }
                    if (options?.topic && !summary.topics.includes(options.topic)) {
                        continue;
                    }
                    summaries.push(summary);
                }
            }
        }
    }
    
    // Sort by importance (highest first), then by date
    summaries.sort((a, b) => {
        if (b.importance_score !== a.importance_score) {
            return b.importance_score - a.importance_score;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
    // Apply limit
    if (options?.limit && options.limit > 0) {
        return summaries.slice(0, options.limit);
    }
    
    return summaries;
}

/**
 * Format summary for use in NPC prompts
 */
export function format_summary_for_prompt(summary: ConversationSummary): string {
    const parts: string[] = [];
    
    parts.push(`MEMORY: ${summary.memory}`);
    parts.push(`You felt: ${summary.emotion}`);
    
    if (summary.learned.length > 0) {
        parts.push(`You learned: ${summary.learned.join("; ")}`);
    }
    
    if (summary.decided.length > 0) {
        parts.push(`You decided: ${summary.decided.join("; ")}`);
    }
    
    if (summary.relationship_changes.length > 0) {
        const changes = summary.relationship_changes.map(r => 
            `${r.target_ref} (${r.change})`
        ).join(", ");
        parts.push(`Relationships changed: ${changes}`);
    }
    
    return parts.join("\n");
}

/**
 * Batch summarize multiple conversations
 */
export async function batch_summarize(
    slot: number,
    conversations: ConversationArchive[],
    npc_ref: string,
    npc_name: string,
    npc_personality: string
): Promise<ConversationSummary[]> {
    const summaries: ConversationSummary[] = [];
    
    for (const conversation of conversations) {
        // Skip short or insignificant conversations
        if (conversation.messages.length < 3) continue;
        
        const summary = await summarize_for_npc(
            slot,
            conversation,
            npc_ref,
            npc_name,
            npc_personality
        );
        
        if (summary) {
            summaries.push(summary);
        }
        
        // Small delay to avoid overwhelming the AI
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return summaries;
}

/**
 * Get the most important memories for an NPC
 */
export function get_important_memories(
    slot: number,
    npc_ref: string,
    limit: number = 5
): string[] {
    const summaries = get_npc_summaries(slot, npc_ref, {
        min_importance: 6,
        limit
    });
    
    return summaries.map(s => format_summary_for_prompt(s));
}

/**
 * Clear summary cache (for memory management)
 */
export function clear_summary_cache(): void {
    summaryCache.clear();
}

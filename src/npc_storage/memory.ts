// NPC Memory Storage
// Manages long-term memories for NPCs including conversation summaries

import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error } from "../shared/debug.js";
import type { ConversationSummary } from "../conversation_manager/summarizer.js";

const NPC_MEMORY_DIR = "npc_memories";

// In-memory cache for NPC memories
const memoryCache = new Map<string, NPCMemoryStore>();

export type NPCMemory = {
    memory_id: string;
    type: "conversation" | "event" | "observation" | "relationship";
    created_at: string;
    importance: number; // 1-10
    
    // Content
    summary: string; // Brief summary
    details?: string; // Full details if needed
    
    // Context
    related_entities: string[]; // actor.<id>, npc.<id>, item.<id>, etc.
    location?: string;
    
    // Emotional context
    emotional_tone: string;
    
    // For conversation memories
    conversation_id?: string;
    
    // For relationship memories
    relationship_target?: string;
    relationship_change?: "improved" | "worsened" | "unchanged";
    
    // Access tracking
    last_accessed: string;
    access_count: number;
};

export type NPCMemoryStore = {
    npc_ref: string;
    version: number;
    last_updated: string;
    
    // Categorized memories
    recent_memories: NPCMemory[]; // Last 10 memories (chronological)
    important_memories: NPCMemory[]; // High importance (5+)
    relationship_memories: NPCMemory[]; // Relationship changes
    
    // Quick lookup
    memory_index: Map<string, string>; // entity_ref -> memory_id
    
    // Stats
    stats: {
        total_memories: number;
        conversations_remembered: number;
        people_remembered: number;
        topics_known: string[];
    };
};

function get_memory_dir(slot: number): string {
    return path.join(get_data_slot_dir(slot), NPC_MEMORY_DIR);
}

function ensure_memory_dir(slot: number): void {
    const dir = get_memory_dir(slot);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function get_memory_path(slot: number, npc_ref: string): string {
    const safe_ref = npc_ref.replace(/\./g, "_");
    return path.join(get_memory_dir(slot), `${safe_ref}_memory.jsonc`);
}

/**
 * Initialize memory store for an NPC
 */
export function initialize_npc_memory(slot: number, npc_ref: string): NPCMemoryStore {
    const store: NPCMemoryStore = {
        npc_ref,
        version: 1,
        last_updated: new Date().toISOString(),
        recent_memories: [],
        important_memories: [],
        relationship_memories: [],
        memory_index: new Map(),
        stats: {
            total_memories: 0,
            conversations_remembered: 0,
            people_remembered: 0,
            topics_known: []
        }
    };
    
    save_memory_store(slot, store);
    memoryCache.set(npc_ref, store);
    
    debug_log("NPCMemory", `Initialized memory for ${npc_ref}`);
    
    return store;
}

/**
 * Load memory store for an NPC
 */
export function load_npc_memory(slot: number, npc_ref: string): NPCMemoryStore | null {
    // Check cache first
    const cached = memoryCache.get(npc_ref);
    if (cached) return cached;
    
    const file_path = get_memory_path(slot, npc_ref);
    if (!fs.existsSync(file_path)) {
        return null;
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
        
        // Reconstruct Map from plain object
        if (data.memory_index && typeof data.memory_index === "object") {
            data.memory_index = new Map(Object.entries(data.memory_index));
        } else {
            data.memory_index = new Map();
        }
        
        memoryCache.set(npc_ref, data as NPCMemoryStore);
        return data as NPCMemoryStore;
    } catch (err) {
        debug_error("NPCMemory", `Failed to load memory for ${npc_ref}`, err);
        return null;
    }
}

/**
 * Save memory store to disk
 */
function save_memory_store(slot: number, store: NPCMemoryStore): void {
    ensure_memory_dir(slot);
    const file_path = get_memory_path(slot, store.npc_ref);
    
    // Convert Map to plain object for JSON serialization
    const serialized = {
        ...store,
        memory_index: Object.fromEntries(store.memory_index)
    };
    
    fs.writeFileSync(file_path, JSON.stringify(serialized, null, 2), "utf-8");
}

/**
 * Add a memory to an NPC's store
 */
export function add_memory(
    slot: number,
    npc_ref: string,
    memory: Omit<NPCMemory, "memory_id" | "created_at" | "last_accessed" | "access_count">
): NPCMemory {
    let store = load_npc_memory(slot, npc_ref);
    if (!store) {
        store = initialize_npc_memory(slot, npc_ref);
    }
    
    const full_memory: NPCMemory = {
        ...memory,
        memory_id: generate_memory_id(),
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        access_count: 0
    };
    
    // Add to recent memories
    store.recent_memories.unshift(full_memory);
    if (store.recent_memories.length > 10) {
        store.recent_memories.pop();
    }
    
    // Add to important memories if high importance
    if (full_memory.importance >= 5) {
        store.important_memories.unshift(full_memory);
        // Keep only top 20 important memories
        if (store.important_memories.length > 20) {
            store.important_memories.pop();
        }
    }
    
    // Add to relationship memories if applicable
    if (full_memory.type === "relationship" && full_memory.relationship_target) {
        store.relationship_memories.unshift(full_memory);
        if (store.relationship_memories.length > 15) {
            store.relationship_memories.pop();
        }
    }
    
    // Update index
    for (const entity of full_memory.related_entities) {
        store.memory_index.set(entity, full_memory.memory_id);
    }
    
    // Update stats
    store.stats.total_memories++;
    if (full_memory.type === "conversation") {
        store.stats.conversations_remembered++;
    }
    for (const entity of full_memory.related_entities) {
        if (entity.startsWith("actor.") || entity.startsWith("npc.")) {
            if (!store.stats.people_remembered.includes(entity as any)) {
                store.stats.people_remembered++;
            }
        }
    }
    
    store.last_updated = new Date().toISOString();
    
    save_memory_store(slot, store);
    memoryCache.set(npc_ref, store);
    
    debug_log("NPCMemory", `Added memory to ${npc_ref}`, {
        memory_id: full_memory.memory_id,
        type: full_memory.type,
        importance: full_memory.importance
    });
    
    return full_memory;
}

/**
 * Add a conversation summary as a memory
 */
export function add_conversation_memory(
    slot: number,
    npc_ref: string,
    summary: ConversationSummary,
    related_entities: string[]
): NPCMemory {
    const memory = add_memory(slot, npc_ref, {
        type: "conversation",
        importance: summary.importance_score,
        summary: summary.memory,
        details: format_summary_details(summary),
        related_entities,
        emotional_tone: summary.emotion,
        conversation_id: summary.conversation_id
    });
    
    return memory;
}

/**
 * Format summary details for storage
 */
function format_summary_details(summary: ConversationSummary): string {
    const parts: string[] = [];
    
    if (summary.learned.length > 0) {
        parts.push(`Learned: ${summary.learned.join("; ")}`);
    }
    
    if (summary.decided.length > 0) {
        parts.push(`Decided: ${summary.decided.join("; ")}`);
    }
    
    if (summary.relationship_changes.length > 0) {
        parts.push("Relationships:");
        for (const change of summary.relationship_changes) {
            parts.push(`  - ${change.target_ref}: ${change.change}`);
        }
    }
    
    return parts.join("\n");
}

/**
 * Get memories relevant to a specific entity
 */
export function get_memories_about(
    slot: number,
    npc_ref: string,
    entity_ref: string,
    options?: {
        limit?: number;
        min_importance?: number;
    }
): NPCMemory[] {
    const store = load_npc_memory(slot, npc_ref);
    if (!store) return [];
    
    const memories: NPCMemory[] = [];
    
    // Check all memory categories
    const all_memories = [
        ...store.recent_memories,
        ...store.important_memories,
        ...store.relationship_memories
    ];
    
    for (const memory of all_memories) {
        if (memory.related_entities.includes(entity_ref)) {
            if (options?.min_importance && memory.importance < options.min_importance) {
                continue;
            }
            memories.push(memory);
        }
    }
    
    // Remove duplicates
    const unique = memories.filter((m, i, arr) => 
        arr.findIndex(t => t.memory_id === m.memory_id) === i
    );
    
    // Sort by importance (descending), then by date (newest first)
    unique.sort((a, b) => {
        if (b.importance !== a.importance) {
            return b.importance - a.importance;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
    // Update access stats
    for (const memory of unique.slice(0, options?.limit || unique.length)) {
        memory.access_count++;
        memory.last_accessed = new Date().toISOString();
    }
    
    save_memory_store(slot, store);
    
    if (options?.limit) {
        return unique.slice(0, options.limit);
    }
    
    return unique;
}

/**
 * Get all memories for an NPC formatted for AI prompt
 */
export function get_formatted_memories(
    slot: number,
    npc_ref: string,
    options?: {
        limit?: number;
        include_details?: boolean;
        focus_on?: string[]; // entity refs to focus on
    }
): string {
    const store = load_npc_memory(slot, npc_ref);
    if (!store) return "No memories.";
    
    const memories: NPCMemory[] = [];
    
    // If focusing on specific entities, get those memories first
    if (options?.focus_on && options.focus_on.length > 0) {
        for (const entity of options.focus_on) {
            const about = get_memories_about(slot, npc_ref, entity, { limit: 3 });
            memories.push(...about);
        }
    }
    
    // Add important memories
    for (const memory of store.important_memories) {
        if (!memories.some(m => m.memory_id === memory.memory_id)) {
            memories.push(memory);
        }
    }
    
    // Add recent memories
    for (const memory of store.recent_memories) {
        if (!memories.some(m => m.memory_id === memory.memory_id)) {
            memories.push(memory);
        }
    }
    
    // Apply limit
    const limited = options?.limit ? memories.slice(0, options.limit) : memories;
    
    // Format
    const lines: string[] = [];
    lines.push("YOUR MEMORIES:");
    
    for (const memory of limited) {
        let line = `- ${memory.summary}`;
        
        if (options?.include_details && memory.details) {
            line += `\n  Details: ${memory.details.replace(/\n/g, "\n  ")}`;
        }
        
        if (memory.emotional_tone && memory.emotional_tone !== "neutral") {
            line += ` [felt ${memory.emotional_tone}]`;
        }
        
        lines.push(line);
    }
    
    return lines.join("\n");
}

/**
 * Check if NPC remembers a specific entity
 */
export function remembers_entity(
    slot: number,
    npc_ref: string,
    entity_ref: string
): boolean {
    const store = load_npc_memory(slot, npc_ref);
    if (!store) return false;
    
    return store.memory_index.has(entity_ref);
}

/**
 * Get relationship status between NPC and entity
 */
export function get_relationship_status(
    slot: number,
    npc_ref: string,
    entity_ref: string
): {
    status: "friendly" | "hostile" | "neutral" | "unknown";
    last_interaction?: string;
    memory_count: number;
} {
    const memories = get_memories_about(slot, npc_ref, entity_ref);
    
    if (memories.length === 0) {
        return { status: "unknown", memory_count: 0 };
    }
    
    // Analyze relationship memories
    let friendly = 0;
    let hostile = 0;
    let last_interaction: string | undefined;
    
    for (const memory of memories) {
        if (memory.type === "relationship" && memory.relationship_target === entity_ref) {
            if (memory.relationship_change === "improved") friendly++;
            if (memory.relationship_change === "worsened") hostile++;
        }
        
        // Check emotional tone
        const tone = memory.emotional_tone.toLowerCase();
        if (["happy", "pleased", "grateful", "friendly"].some(t => tone.includes(t))) {
            friendly++;
        }
        if (["angry", "hostile", "suspicious", "afraid"].some(t => tone.includes(t))) {
            hostile++;
        }
        
        // Track last interaction
        if (!last_interaction || new Date(memory.created_at) > new Date(last_interaction)) {
            last_interaction = memory.created_at;
        }
    }
    
    let status: "friendly" | "hostile" | "neutral" | "unknown" = "neutral";
    if (friendly > hostile) status = "friendly";
    if (hostile > friendly) status = "hostile";
    
    return {
        status,
        last_interaction,
        memory_count: memories.length
    };
}

/**
 * Prune old/low-importance memories
 */
export function prune_memories(
    slot: number,
    npc_ref: string,
    max_memories: number = 50
): number {
    const store = load_npc_memory(slot, npc_ref);
    if (!store) return 0;
    
    const before_count = store.stats.total_memories;
    
    // Combine all memories
    let all_memories = [
        ...store.recent_memories,
        ...store.important_memories,
        ...store.relationship_memories
    ];
    
    // Remove duplicates
    all_memories = all_memories.filter((m, i, arr) => 
        arr.findIndex(t => t.memory_id === m.memory_id) === i
    );
    
    if (all_memories.length <= max_memories) return 0;
    
    // Sort by importance and recency
    all_memories.sort((a, b) => {
        const score_a = a.importance * 10 + a.access_count;
        const score_b = b.importance * 10 + b.access_count;
        return score_b - score_a;
    });
    
    // Keep top memories
    const keep = all_memories.slice(0, max_memories);
    
    // Rebuild categories
    store.recent_memories = keep.slice(0, 10);
    store.important_memories = keep.filter(m => m.importance >= 5).slice(0, 20);
    store.relationship_memories = keep.filter(m => m.type === "relationship").slice(0, 15);
    
    // Update stats
    store.stats.total_memories = keep.length;
    
    save_memory_store(slot, store);
    memoryCache.set(npc_ref, store);
    
    const removed = before_count - keep.length;
    debug_log("NPCMemory", `Pruned ${removed} memories from ${npc_ref}`);
    
    return removed;
}

/**
 * Generate unique memory ID
 */
function generate_memory_id(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clear memory cache (for memory management)
 */
export function clear_memory_cache(): void {
    memoryCache.clear();
}

/**
 * Get memory statistics for an NPC
 */
export function get_memory_stats(
    slot: number,
    npc_ref: string
): NPCMemoryStore["stats"] | null {
    const store = load_npc_memory(slot, npc_ref);
    return store?.stats || null;
}

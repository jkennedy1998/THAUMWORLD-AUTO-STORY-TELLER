// Context Manager Service
// Manages working memory for timed events and provides context to AI services

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { get_data_slot_dir } from "../engine/paths.js";
import { debug_log, debug_error, debug_pipeline } from "../shared/debug.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { load_region } from "../world_storage/store.js";
import { SERVICE_CONFIG, MEMORY_BUDGETS } from "../shared/constants.js";
import type { Region } from "../world_storage/store.js";

const WORKING_MEMORY_FILE = "working_memory.jsonc";

// In-memory cache for active working memories
const workingMemoryCache = new Map<string, WorkingMemory>();

export type WorkingMemory = {
    event_id: string;
    event_type: "combat" | "conversation" | "exploration";
    created_at: string;
    last_updated: string;
    ttl_seconds: number;
    
    region: {
        id: string;
        name: string;
        description: string;
        atmosphere: string;
        conditions: string[]; // e.g., "dim_light", "rain", "chaos"
    };
    
    participants: ParticipantMemory[];
    recent_events: RecentEvent[];
    conversation_context?: ConversationContext;
    
    // Memory budget tracking
    stats: {
        participant_count: number;
        event_count: number;
        last_pruned: string;
    };
};

export type ParticipantMemory = {
    ref: string; // actor.henry_actor or npc.grenda
    name: string;
    role: "ally" | "enemy" | "neutral" | "unknown";
    
    // Observable traits (no exact stats)
    visible_equipment: string[]; // What you can see them carrying/wearing
    notable_features: string[]; // "limping", "angry", "casting spell"
    current_status: string[]; // "wounded", "defending", "invisible"
    
    // Behavioral context
    personality_summary: string; // "Gruff but honorable guard"
    relationship_to_viewer: string; // "friendly", "hostile", "wary"
    emotional_state: string; // "calm", "angry", "frightened"
    
    // Recent activity
    last_action?: string; // "ATTACK: hit goblin for 5 damage"
    turns_since_last_action: number;
    
    // For AI decision making
    threat_assessment?: "none" | "low" | "medium" | "high" | "extreme";
    likely_intentions?: string[]; // What they might do next
};

export type RecentEvent = {
    turn: number;
    timestamp: string;
    actor: string;
    action: string; // Verb only: "ATTACK", "COMMUNICATE", etc.
    target?: string;
    outcome: string; // Narrative outcome, not mechanical
    emotional_tone: string; // "tense", "triumphant", "desperate"
};

export type ConversationContext = {
    conversation_id: string;
    current_topic?: string;
    tension_level: "calm" | "heated" | "hostile";
    speaker_order: string[]; // Who spoke last
    unresolved_issues: string[];
};

function get_working_memory_path(slot: number): string {
    return path.join(get_data_slot_dir(slot), WORKING_MEMORY_FILE);
}

function ensure_working_memory_file(slot: number): void {
    const file_path = get_working_memory_path(slot);
    if (!fs.existsSync(file_path)) {
        const initial = { schema_version: 1, memories: [] };
        fs.writeFileSync(file_path, JSON.stringify(initial, null, 2), "utf-8");
    }
}

// Build working memory from region and participants
export async function build_working_memory(
    slot: number,
    event_id: string,
    event_type: "combat" | "conversation" | "exploration",
    region_id: string,
    participant_refs: string[]
): Promise<WorkingMemory> {
    const now = new Date().toISOString();
    
    // Load region data
    const region_result = load_region(slot, region_id);
    if (!region_result.ok) {
        debug_error("ContextManager", "Failed to load region", { region_id, error: region_result.error });
        throw new Error(`Region not found: ${region_id}`);
    }
    const region_data = region_result.region;
    
    // Build participant memories
    const participants: ParticipantMemory[] = [];
    for (const ref of participant_refs) {
        const participant = await build_participant_memory(slot, ref);
        if (participant) {
            participants.push(participant);
        }
    }
    
    const memory: WorkingMemory = {
        event_id,
        event_type,
        created_at: now,
        last_updated: now,
        ttl_seconds: MEMORY_BUDGETS.TTL_SECONDS,
        
        region: {
            id: region_id,
            name: region_data.name,
            description: region_data.description.short,
            atmosphere: region_data.description.atmosphere,
            conditions: detect_environmental_conditions(region_data)
        },
        
        participants,
        recent_events: [],
        
        stats: {
            participant_count: participants.length,
            event_count: 0,
            last_pruned: now
        }
    };
    
    // Cache it
    workingMemoryCache.set(event_id, memory);
    
    // Persist to disk
    save_working_memory(slot, memory);
    
    debug_log("ContextManager", "Built working memory", {
        event_id,
        event_type,
        region_id,
        participant_count: participants.length
    });
    
    return memory;
}

// Build memory for a single participant
async function build_participant_memory(
    slot: number,
    ref: string
): Promise<ParticipantMemory | null> {
    const parts = ref.split(".");
    const type = parts[0];
    const id = parts[1];
    
    if (type === "actor") {
        const result = load_actor(slot, id);
        if (!result.ok) return null;
        
        const actor = result.actor;
        const equipment = extract_visible_equipment(actor);
        
        return {
            ref,
            name: String(actor.name || id),
            role: "ally", // Player characters are allies by default
            visible_equipment: equipment,
            notable_features: extract_notable_features(actor),
            current_status: extract_status_effects(actor),
            personality_summary: extract_personality(actor),
            relationship_to_viewer: "self", // When viewing your own character
            emotional_state: "focused",
            turns_since_last_action: 0
        };
    } else if (type === "npc") {
        const result = load_npc(slot, id);
        if (!result.ok) return null;
        
        const npc = result.npc;
        const equipment = extract_visible_equipment(npc);
        
        return {
            ref,
            name: String(npc.name || id),
            role: "unknown", // Will be updated based on context
            visible_equipment: equipment,
            notable_features: extract_notable_features(npc),
            current_status: extract_status_effects(npc),
            personality_summary: extract_personality(npc),
            relationship_to_viewer: "unknown", // Will be determined by context
            emotional_state: "neutral",
            turns_since_last_action: 0
        };
    }
    
    return null;
}

// Extract visible equipment (not inventory)
function extract_visible_equipment(entity: Record<string, unknown>): string[] {
    const equipment: string[] = [];
    
    // Check equipped items
    const body_slots = (entity.body_slots || {}) as Record<string, unknown>;
    for (const [slot, item] of Object.entries(body_slots)) {
        if (item && typeof item === "object" && item !== null) {
            const item_name = (item as Record<string, unknown>).name;
            if (item_name) {
                equipment.push(String(item_name));
            }
        }
    }
    
    // Check hand slots
    const hand_slots = (entity.hand_slots || {}) as Record<string, unknown>;
    for (const [hand, item] of Object.entries(hand_slots)) {
        if (item && typeof item === "string") {
            equipment.push(item.split(".").pop() || item);
        }
    }
    
    return equipment.slice(0, 5); // Limit to 5 visible items
}

// Extract notable physical/behavioral features
function extract_notable_features(entity: Record<string, unknown>): string[] {
    const features: string[] = [];
    
    // Appearance-based
    const appearance = (entity.appearance || {}) as Record<string, unknown>;
    if (appearance.distinguishing_features) {
        features.push(String(appearance.distinguishing_features));
    }
    
    // Status-based
    const tags = (entity.tags || []) as Array<Record<string, unknown>>;
    for (const tag of tags) {
        if (tag.name && tag.name !== "AWARENESS") {
            features.push(String(tag.name).toLowerCase());
        }
    }
    
    // Wound status
    const health = (entity.resources?.health || {}) as Record<string, number>;
    if (health.current !== undefined && health.max !== undefined) {
        const ratio = health.current / health.max;
        if (ratio < 0.25) features.push("critically wounded");
        else if (ratio < 0.5) features.push("wounded");
        else if (ratio < 0.75) features.push("lightly wounded");
    }
    
    return features.slice(0, 3); // Limit to 3 features
}

// Extract status effects
function extract_status_effects(entity: Record<string, unknown>): string[] {
    const tags = (entity.tags || []) as Array<Record<string, unknown>>;
    return tags
        .filter(tag => tag.name && tag.name !== "AWARENESS")
        .map(tag => String(tag.name).toLowerCase())
        .slice(0, 3);
}

// Extract personality summary
function extract_personality(entity: Record<string, unknown>): string {
    const personality = (entity.personality || {}) as Record<string, unknown>;
    
    // Build from key traits
    const traits: string[] = [];
    
    if (personality.story_goal) {
        traits.push(String(personality.story_goal).slice(0, 50));
    }
    
    if (personality.fear) {
        traits.push(`fears: ${String(personality.fear).slice(0, 30)}`);
    }
    
    if (personality.flaw) {
        traits.push(`flaw: ${String(personality.flaw).slice(0, 30)}`);
    }
    
    if (traits.length === 0) {
        return "No notable personality traits observed";
    }
    
    return traits.join("; ").slice(0, 100);
}

// Detect environmental conditions from region
function detect_environmental_conditions(region: Region): string[] {
    const conditions: string[] = [];
    
    // Lighting
    conditions.push(region.environment.lighting);
    
    // Temperature
    if (region.environment.temperature_mag > 1) conditions.push("hot");
    if (region.environment.temperature_mag < -1) conditions.push("cold");
    
    // Weather
    if (region.environment.weather) {
        conditions.push(region.environment.weather);
    }
    
    // Atmosphere keywords
    const atmosphere = region.description.atmosphere.toLowerCase();
    if (atmosphere.includes("danger")) conditions.push("dangerous");
    if (atmosphere.includes("safe")) conditions.push("safe");
    if (atmosphere.includes("mysterious")) conditions.push("mysterious");
    
    return conditions.slice(0, 4);
}

// Save working memory to disk
function save_working_memory(slot: number, memory: WorkingMemory): void {
    ensure_working_memory_file(slot);
    const file_path = get_working_memory_path(slot);
    
    const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
    
    // Update or add
    const existing_index = data.memories.findIndex((m: WorkingMemory) => m.event_id === memory.event_id);
    if (existing_index >= 0) {
        data.memories[existing_index] = memory;
    } else {
        data.memories.push(memory);
    }
    
    fs.writeFileSync(file_path, JSON.stringify(data, null, 2), "utf-8");
}

// Get working memory (from cache or disk)
export function get_working_memory(slot: number, event_id: string): WorkingMemory | null {
    // Check cache first
    const cached = workingMemoryCache.get(event_id);
    if (cached) {
        // Check TTL
        const age_seconds = (Date.now() - new Date(cached.last_updated).getTime()) / 1000;
        if (age_seconds < cached.ttl_seconds) {
            return cached;
        }
        // Expired, remove from cache
        workingMemoryCache.delete(event_id);
    }
    
    // Load from disk
    ensure_working_memory_file(slot);
    const file_path = get_working_memory_path(slot);
    const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
    const memory = data.memories.find((m: WorkingMemory) => m.event_id === event_id);
    
    if (memory) {
        // Check TTL
        const age_seconds = (Date.now() - new Date(memory.last_updated).getTime()) / 1000;
        if (age_seconds < memory.ttl_seconds) {
            workingMemoryCache.set(event_id, memory);
            return memory;
        }
    }
    
    return null;
}

// Update working memory with a new event
export function add_event_to_memory(
    slot: number,
    event_id: string,
    event: Omit<RecentEvent, "timestamp">
): void {
    const memory = get_working_memory(slot, event_id);
    if (!memory) return;
    
    const full_event: RecentEvent = {
        ...event,
        timestamp: new Date().toISOString()
    };
    
    memory.recent_events.push(full_event);
    memory.stats.event_count++;
    memory.last_updated = new Date().toISOString();
    
    // Prune if needed
    if (memory.recent_events.length > MEMORY_BUDGETS.MAX_RECENT_EVENTS) {
        prune_memory_events(memory);
    }
    
    // Update participant last actions
    const participant = memory.participants.find(p => p.ref === event.actor);
    if (participant) {
        participant.last_action = `${event.action}: ${event.outcome}`;
        participant.turns_since_last_action = 0;
    }
    
    // Increment turns since action for others
    for (const p of memory.participants) {
        if (p.ref !== event.actor) {
            p.turns_since_last_action++;
        }
    }
    
    // Save
    save_working_memory(slot, memory);
    workingMemoryCache.set(event_id, memory);
    
    debug_pipeline("ContextManager", "Added event to memory", {
        event_id,
        actor: event.actor,
        action: event.action
    });
}

// Prune old events from memory
function prune_memory_events(memory: WorkingMemory): void {
    const before_count = memory.recent_events.length;
    
    // Keep last N events
    memory.recent_events = memory.recent_events.slice(-MEMORY_BUDGETS.MAX_RECENT_EVENTS);
    
    // Update turn numbers to be sequential
    memory.recent_events.forEach((event, index) => {
        event.turn = index + 1;
    });
    
    memory.stats.last_pruned = new Date().toISOString();
    
    debug_log("ContextManager", "Pruned memory events", {
        event_id: memory.event_id,
        removed: before_count - memory.recent_events.length,
        remaining: memory.recent_events.length
    });
}

// Prune old participants (haven't acted in a while)
export function prune_inactive_participants(memory: WorkingMemory): void {
    const before_count = memory.participants.length;
    
    // Remove participants who haven't acted in 5+ turns
    memory.participants = memory.participants.filter(p => 
        p.turns_since_last_action < 5 || p.ref.startsWith("actor.") // Keep player characters
    );
    
    memory.stats.participant_count = memory.participants.length;
    
    if (memory.participants.length < before_count) {
        debug_log("ContextManager", "Pruned inactive participants", {
            event_id: memory.event_id,
            removed: before_count - memory.participants.length
        });
    }
}

// Get memory as formatted string for AI prompts
export function format_memory_for_ai(memory: WorkingMemory, viewer_ref?: string): string {
    const viewer = viewer_ref 
        ? memory.participants.find(p => p.ref === viewer_ref)
        : null;
    
    let output = `SITUATION: You are in ${memory.region.name}. ${memory.region.description}
Atmosphere: ${memory.region.atmosphere}
Conditions: ${memory.region.conditions.join(", ") || "normal"}

`;
    
    // Participants (from viewer's perspective)
    output += "PRESENT:\n";
    for (const p of memory.participants.slice(0, MEMORY_BUDGETS.MAX_PARTICIPANTS)) {
        if (p.ref === viewer_ref) continue; // Don't describe self
        
        const relation = viewer 
            ? p.relationship_to_viewer 
            : p.relationship_to_viewer;
        
        output += `- ${p.name} (${relation})`;
        
        if (p.visible_equipment.length > 0) {
            output += ` carrying ${p.visible_equipment.join(", ")}`;
        }
        
        if (p.notable_features.length > 0) {
            output += ` - appears ${p.notable_features.join(", ")}`;
        }
        
        if (p.last_action && p.turns_since_last_action === 0) {
            output += ` - just ${p.last_action}`;
        }
        
        output += "\n";
    }
    
    // Recent events
    if (memory.recent_events.length > 0) {
        output += "\nRECENTLY:\n";
        for (const event of memory.recent_events.slice(-5)) {
            output += `- ${event.actor}: ${event.action} (${event.emotional_tone})\n`;
        }
    }
    
    return output;
}

// Update participant relationships based on actions
export function update_participant_relationships(
    memory: WorkingMemory,
    actor_ref: string,
    target_ref: string,
    action: string
): void {
    const actor = memory.participants.find(p => p.ref === actor_ref);
    const target = memory.participants.find(p => p.ref === target_ref);
    
    if (!actor || !target) return;
    
    // Update based on action type
    if (action === "ATTACK" || action === "GRAPPLE") {
        actor.relationship_to_viewer = "hostile";
        target.relationship_to_viewer = "hostile";
        target.threat_assessment = "high";
    } else if (action === "HELP" || action === "DEFEND") {
        actor.relationship_to_viewer = "friendly";
        target.relationship_to_viewer = "friendly";
    } else if (action === "COMMUNICATE") {
        // Communication is neutral unless tone indicates otherwise
        if (actor.emotional_state === "angry") {
            target.relationship_to_viewer = "wary";
        }
    }
}

// Clean up all expired memories
export function cleanup_expired_memories(slot: number): number {
    ensure_working_memory_file(slot);
    const file_path = get_working_memory_path(slot);
    const data = JSON.parse(fs.readFileSync(file_path, "utf-8"));
    
    const before_count = data.memories.length;
    const now = Date.now();
    
    data.memories = data.memories.filter((m: WorkingMemory) => {
        const age_seconds = (now - new Date(m.last_updated).getTime()) / 1000;
        return age_seconds < m.ttl_seconds;
    });
    
    fs.writeFileSync(file_path, JSON.stringify(data, null, 2), "utf-8");
    
    // Also clean cache
    for (const [event_id, memory] of workingMemoryCache.entries()) {
        const age_seconds = (now - new Date(memory.last_updated).getTime()) / 1000;
        if (age_seconds >= memory.ttl_seconds) {
            workingMemoryCache.delete(event_id);
        }
    }
    
    const removed = before_count - data.memories.length;
    if (removed > 0) {
        debug_log("ContextManager", "Cleaned up expired memories", { removed });
    }
    
    return removed;
}

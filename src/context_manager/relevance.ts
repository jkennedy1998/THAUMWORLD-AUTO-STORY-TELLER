// Relevance Filtering System
// Determines what information to load into working memory based on action context

import type { WorkingMemory, ParticipantMemory, RecentEvent } from "../context_manager/index.js";
import type { ActionVerb } from "../shared/constants.js";

// Action context rules - what to load for each action type
export const ACTION_RELEVANCE_RULES: Record<ActionVerb, {
    load_participant_fields: (keyof ParticipantMemory)[];
    load_recent_events: boolean;
    event_lookback_turns: number;
    ignore_if_not_visible: boolean;
    special_context: string[];
}> = {
    "USE": {
        load_participant_fields: [
            "visible_equipment",
            "notable_features",
            "current_status",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: true,
        special_context: ["item_effects", "skill_level"]
    },
    
    "ATTACK": {
        load_participant_fields: [
            "visible_equipment",
            "notable_features",
            "current_status",
            "last_action",
            "threat_assessment"
        ],
        load_recent_events: true,
        event_lookback_turns: 5,
        ignore_if_not_visible: false,
        special_context: ["combat_stance", "wounds", "defensive_position"]
    },
    
    "HELP": {
        load_participant_fields: [
            "name",
            "relationship_to_viewer",
            "emotional_state",
            "current_status",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: false,
        special_context: ["ally_needs", "team_dynamics"]
    },
    
    "DEFEND": {
        load_participant_fields: [
            "visible_equipment",
            "current_status",
            "last_action",
            "threat_assessment"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: false,
        special_context: ["incoming_threats", "protective_position"]
    },
    
    "GRAPPLE": {
        load_participant_fields: [
            "visible_equipment",
            "notable_features",
            "current_status",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: false,
        special_context: ["physical_proximity", "grappling_skill"]
    },
    
    "INSPECT": {
        load_participant_fields: [
            "name",
            "visible_equipment",
            "notable_features",
            "personality_summary"
        ],
        load_recent_events: false,
        event_lookback_turns: 0,
        ignore_if_not_visible: true,
        special_context: ["hidden_details", "lore", "expertise_required"]
    },
    
    "COMMUNICATE": {
        load_participant_fields: [
            "name",
            "personality_summary",
            "relationship_to_viewer",
            "emotional_state",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 10, // Longer history for conversations
        ignore_if_not_visible: false,
        special_context: ["conversation_history", "social_dynamics", "unresolved_topics"]
    },
    
    "DODGE": {
        load_participant_fields: [
            "notable_features",
            "current_status",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 2,
        ignore_if_not_visible: false,
        special_context: ["incoming_attack", "escape_route"]
    },
    
    "CRAFT": {
        load_participant_fields: [
            "visible_equipment",
            "notable_features",
            "last_action"
        ],
        load_recent_events: false,
        event_lookback_turns: 0,
        ignore_if_not_visible: true,
        special_context: ["materials_available", "crafting_skill", "time_required"]
    },
    
    "SLEEP": {
        load_participant_fields: [
            "name",
            "current_status",
            "notable_features"
        ],
        load_recent_events: false,
        event_lookback_turns: 0,
        ignore_if_not_visible: true,
        special_context: ["rest_quality", "safety", "vigor_recovery"]
    },
    
    "REPAIR": {
        load_participant_fields: [
            "visible_equipment",
            "notable_features",
            "last_action"
        ],
        load_recent_events: false,
        event_lookback_turns: 0,
        ignore_if_not_visible: true,
        special_context: ["damaged_items", "repair_skill", "time_required"]
    },
    
    "MOVE": {
        load_participant_fields: [
            "name",
            "visible_equipment",
            "notable_features",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: false,
        special_context: ["destination", "terrain", "obstacles"]
    },
    
    "WORK": {
        load_participant_fields: [
            "name",
            "visible_equipment",
            "last_action"
        ],
        load_recent_events: false,
        event_lookback_turns: 0,
        ignore_if_not_visible: true,
        special_context: ["task_requirements", "progress_made", "time_required"]
    },
    
    "GUARD": {
        load_participant_fields: [
            "name",
            "visible_equipment",
            "current_status",
            "last_action",
            "threat_assessment"
        ],
        load_recent_events: true,
        event_lookback_turns: 5,
        ignore_if_not_visible: false,
        special_context: ["area_coverage", "suspicious_activity", "shift_duration"]
    },
    
    "HOLD": {
        load_participant_fields: [
            "name",
            "visible_equipment",
            "current_status",
            "last_action"
        ],
        load_recent_events: true,
        event_lookback_turns: 3,
        ignore_if_not_visible: false,
        special_context: ["readied_action", "trigger_condition", "vigilance"]
    }
};

// Filter working memory based on action context
export function filter_memory_for_action(
    memory: WorkingMemory,
    action: ActionVerb,
    actor_ref: string,
    target_ref?: string
): FilteredMemory {
    const rules = ACTION_RELEVANCE_RULES[action];
    
    // Filter participants
    const filtered_participants = memory.participants
        .filter(p => {
            // Always include actor
            if (p.ref === actor_ref) return true;
            
            // Include target if specified
            if (target_ref && p.ref === target_ref) return true;
            
            // If ignore_if_not_visible, only include if they've acted recently
            if (rules.ignore_if_not_visible && p.turns_since_last_action > 2) {
                return false;
            }
            
            return true;
        })
        .map(p => filter_participant_fields(p, rules.load_participant_fields));
    
    // Filter events
    let filtered_events: RecentEvent[] = [];
    if (rules.load_recent_events) {
        filtered_events = memory.recent_events
            .slice(-rules.event_lookback_turns)
            .map(e => ({
                ...e,
                // Remove exact mechanical details, keep narrative
                outcome: simplify_outcome(e.outcome)
            }));
    }
    
    return {
        region: memory.region,
        participants: filtered_participants,
        recent_events: filtered_events,
        action_context: rules.special_context,
        viewer_ref: actor_ref
    };
}

// Filter participant to only relevant fields
function filter_participant_fields(
    participant: ParticipantMemory,
    fields_to_keep: (keyof ParticipantMemory)[]
): Partial<ParticipantMemory> {
    const filtered: Partial<ParticipantMemory> = {};
    
    for (const field of fields_to_keep) {
        const value = participant[field];
        
        // Simplify certain fields
        if (field === "visible_equipment" && Array.isArray(value)) {
            // Only show 3 most notable items
            filtered[field] = value.slice(0, 3);
        } else if (field === "notable_features" && Array.isArray(value)) {
            // Only show 2 most notable features
            filtered[field] = value.slice(0, 2);
        } else if (field === "personality_summary" && typeof value === "string") {
            // Truncate long summaries
            filtered[field] = value.slice(0, 80) + (value.length > 80 ? "..." : "");
        } else {
            filtered[field] = value as any;
        }
    }
    
    // Always include ref and name for identification
    filtered.ref = participant.ref;
    filtered.name = participant.name;
    
    return filtered;
}

// Simplify mechanical outcomes to narrative descriptions
function simplify_outcome(outcome: string): string {
    // Remove exact numbers, keep qualitative descriptions
    return outcome
        .replace(/\d+ damage/g, "damage")
        .replace(/\d+ health/g, "health")
        .replace(/CR \d+/g, "challenging")
        .replace(/\d+ turns/g, "several turns")
        .replace(/\d+%/g, "significant")
        .slice(0, 100); // Limit length
}

// Filtered memory structure for AI consumption
export type FilteredMemory = {
    region: WorkingMemory["region"];
    participants: Partial<ParticipantMemory>[];
    recent_events: RecentEvent[];
    action_context: string[];
    viewer_ref: string;
};

// Format filtered memory as string for AI prompts
export function format_filtered_memory(filtered: FilteredMemory): string {
    let output = `SITUATION: ${filtered.region.name}
${filtered.region.description}
Atmosphere: ${filtered.region.atmosphere}
Conditions: ${filtered.region.conditions.join(", ") || "normal"}

`;
    
    // Participants
    if (filtered.participants.length > 0) {
        output += "OTHERS PRESENT:\n";
        for (const p of filtered.participants) {
            if (p.ref === filtered.viewer_ref) continue; // Skip self
            
            const parts: string[] = [];
            
            if (p.visible_equipment && p.visible_equipment.length > 0) {
                parts.push(`has ${p.visible_equipment.join(", ")}`);
            }
            
            if (p.notable_features && p.notable_features.length > 0) {
                parts.push(`appears ${p.notable_features.join(", ")}`);
            }
            
            if (p.current_status && p.current_status.length > 0) {
                parts.push(`currently ${p.current_status.join(", ")}`);
            }
            
            if (p.relationship_to_viewer) {
                parts.push(`relationship: ${p.relationship_to_viewer}`);
            }
            
            if (p.emotional_state) {
                parts.push(`seems ${p.emotional_state}`);
            }
            
            if (p.last_action && p.turns_since_last_action === 0) {
                parts.push(`just ${p.last_action}`);
            }
            
            output += `- ${p.name}${parts.length > 0 ? " - " + parts.join("; ") : ""}\n`;
        }
    }
    
    // Recent events
    if (filtered.recent_events.length > 0) {
        output += "\nRECENTLY:\n";
        for (const event of filtered.recent_events) {
            output += `- ${event.actor} ${event.action.toLowerCase()} (${event.emotional_tone})\n`;
        }
    }
    
    // Special context
    if (filtered.action_context.length > 0) {
        output += `\nCONTEXT: ${filtered.action_context.join(", ")}\n`;
    }
    
    return output;
}

// Check if a participant can perceive another (for visibility checks)
export function can_perceive(
    viewer: ParticipantMemory,
    target: ParticipantMemory,
    region_conditions: string[]
): {
    can_see: boolean;
    clarity: "clear" | "obscured" | "hidden";
    reason: string;
} {
    // Check for invisibility
    if (target.current_status?.includes("invisible")) {
        return {
            can_see: false,
            clarity: "hidden",
            reason: "target is invisible"
        };
    }
    
    // Check lighting
    if (region_conditions.includes("pitch_black")) {
        return {
            can_see: false,
            clarity: "hidden",
            reason: "pitch black conditions"
        };
    }
    
    if (region_conditions.includes("dark")) {
        return {
            can_see: true,
            clarity: "obscured",
            reason: "dim lighting"
        };
    }
    
    // Check distance (simplified - in real system would use actual coordinates)
    if (target.turns_since_last_action > 3) {
        return {
            can_see: true,
            clarity: "obscured",
            reason: "target is distant"
        };
    }
    
    // Default: clear visibility
    return {
        can_see: true,
        clarity: "clear",
        reason: "clear line of sight"
    };
}

// Determine what an NPC can overhear
export function determine_overhearing_npcs(
    memory: WorkingMemory,
    speaker_ref: string,
    volume: "whisper" | "normal" | "shout" = "normal"
): ParticipantMemory[] {
    const speaker = memory.participants.find(p => p.ref === speaker_ref);
    if (!speaker) return [];
    
    return memory.participants.filter(p => {
        // Can't overhear yourself
        if (p.ref === speaker_ref) return false;
        
        // Check perception
        const perception = can_perceive(p, speaker, memory.region.conditions);
        
        if (!perception.can_see) return false;
        
        // Volume affects range
        switch (volume) {
            case "whisper":
                // Only adjacent participants (simplified)
                return p.turns_since_last_action <= 1 && perception.clarity === "clear";
            case "normal":
                // Most participants in clear view
                return perception.clarity !== "hidden";
            case "shout":
                // Everyone can hear
                return true;
            default:
                return false;
        }
    });
}

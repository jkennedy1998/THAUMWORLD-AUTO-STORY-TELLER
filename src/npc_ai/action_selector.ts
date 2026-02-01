// NPC Action Selector - Determines available actions for NPCs
// Based on their equipment, status, and current situation

import type { ActionVerb } from "../shared/constants.js";

// Available action with requirements
export type AvailableAction = {
    verb: ActionVerb;
    targets: string[]; // Who/what can be targeted
    reason: string; // Why this action is available
    priority: number; // 1-10, higher = more likely
    requirements: {
        min_health?: number; // Minimum health percentage
        max_health?: number; // Maximum health percentage (for fleeing)
        equipment_needed?: string[]; // Required equipment
        status_required?: string[]; // Required status effects
        status_forbidden?: string[]; // Forbidden status effects
        min_allies?: number; // Minimum allies nearby
        max_enemies?: number; // Maximum enemies nearby
        personality_traits?: string[]; // Required personality traits
    };
};

// NPC state for action determination
export type NPCState = {
    id: string;
    health_percent: number;
    equipment: string[];
    status_effects: string[];
    personality: string;
    role: string;
    nearby_allies: number;
    nearby_enemies: number;
    is_in_combat: boolean;
    has_ranged_weapon: boolean;
    has_shield: boolean;
    has_healing_items: boolean;
};

// Action definitions with requirements
const ACTION_DEFINITIONS: Record<ActionVerb, {
    base_priority: number;
    requirements: AvailableAction["requirements"];
    target_types: string[];
}> = {
    "USE": {
        base_priority: 5,
        requirements: {},
        target_types: ["item", "object"]
    },
    "ATTACK": {
        base_priority: 7,
        requirements: {
            min_health: 20,
            status_forbidden: ["stunned", "paralyzed", "restrained"]
        },
        target_types: ["enemy", "hostile"]
    },
    "HELP": {
        base_priority: 6,
        requirements: {
            min_allies: 1,
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["ally", "friend"]
    },
    "DEFEND": {
        base_priority: 6,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["self", "ally"]
    },
    "GRAPPLE": {
        base_priority: 5,
        requirements: {
            min_health: 30,
            status_forbidden: ["stunned", "paralyzed", "restrained"]
        },
        target_types: ["enemy"]
    },
    "INSPECT": {
        base_priority: 3,
        requirements: {},
        target_types: ["object", "person", "area"]
    },
    "COMMUNICATE": {
        base_priority: 4,
        requirements: {
            status_forbidden: ["silenced", "gagged"]
        },
        target_types: ["any"]
    },
    "DODGE": {
        base_priority: 8,
        requirements: {
            max_health: 40,
            status_forbidden: ["stunned", "paralyzed", "restrained"]
        },
        target_types: ["self"]
    },
    "CRAFT": {
        base_priority: 2,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["item", "object"]
    },
    "SLEEP": {
        base_priority: 1,
        requirements: {
            max_enemies: 0,
            status_forbidden: ["stunned", "paralyzed", "combat"]
        },
        target_types: ["self"]
    },
    "REPAIR": {
        base_priority: 2,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["item", "object"]
    },
    "MOVE": {
        base_priority: 5,
        requirements: {
            status_forbidden: ["stunned", "paralyzed", "restrained"]
        },
        target_types: ["location"]
    },
    "WORK": {
        base_priority: 2,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["task", "object"]
    },
    "GUARD": {
        base_priority: 5,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["area", "person"]
    },
    "HOLD": {
        base_priority: 4,
        requirements: {
            status_forbidden: ["stunned", "paralyzed"]
        },
        target_types: ["self"]
    }
};

// Role-specific action modifiers
const ROLE_ACTION_MODIFIERS: Record<string, Partial<Record<ActionVerb, number>>> = {
    "guard": {
        "ATTACK": 2,
        "DEFEND": 2,
        "GUARD": 3
    },
    "shopkeeper": {
        "COMMUNICATE": 2,
        "ATTACK": -2
    },
    "villager": {
        "DODGE": 2,
        "ATTACK": -1
    },
    "soldier": {
        "ATTACK": 2,
        "DEFEND": 1,
        "HELP": 1
    },
    "healer": {
        "HELP": 3,
        "USE": 2,
        "ATTACK": -2
    },
    "thief": {
        "DODGE": 2,
        "MOVE": 1,
        "INSPECT": 1
    },
    "noble": {
        "COMMUNICATE": 2,
        "ATTACK": -1
    }
};

// Personality trait modifiers
const PERSONALITY_MODIFIERS: Record<string, Partial<Record<ActionVerb, number>>> = {
    "aggressive": {
        "ATTACK": 3,
        "DEFEND": -1,
        "DODGE": -2
    },
    "defensive": {
        "DEFEND": 3,
        "ATTACK": -1,
        "DODGE": 1
    },
    "cowardly": {
        "DODGE": 3,
        "ATTACK": -3,
        "DEFEND": -1
    },
    "brave": {
        "ATTACK": 2,
        "HELP": 1,
        "DODGE": -2
    },
    "helpful": {
        "HELP": 3,
        "COMMUNICATE": 1
    },
    "curious": {
        "INSPECT": 2,
        "COMMUNICATE": 1
    },
    "cautious": {
        "DEFEND": 2,
        "DODGE": 1,
        "ATTACK": -1
    },
    "talkative": {
        "COMMUNICATE": 3
    },
    "silent": {
        "COMMUNICATE": -2,
        "ATTACK": 1
    }
};

/**
 * Check if requirements are met for an action
 */
function checkRequirements(
    action: ActionVerb,
    state: NPCState,
    requirements: AvailableAction["requirements"]
): boolean {
    // Health checks
    if (requirements.min_health !== undefined && 
        state.health_percent < requirements.min_health) {
        return false;
    }
    if (requirements.max_health !== undefined && 
        state.health_percent > requirements.max_health) {
        return false;
    }
    
    // Equipment checks
    if (requirements.equipment_needed && requirements.equipment_needed.length > 0) {
        const hasEquipment = requirements.equipment_needed.some(eq => 
            state.equipment.some(e => e.toLowerCase().includes(eq.toLowerCase()))
        );
        if (!hasEquipment) return false;
    }
    
    // Status checks
    if (requirements.status_required && requirements.status_required.length > 0) {
        const hasRequired = requirements.status_required.some(status =>
            state.status_effects.some(s => s.toLowerCase().includes(status.toLowerCase()))
        );
        if (!hasRequired) return false;
    }
    
    if (requirements.status_forbidden && requirements.status_forbidden.length > 0) {
        const hasForbidden = requirements.status_forbidden.some(status =>
            state.status_effects.some(s => s.toLowerCase().includes(status.toLowerCase()))
        );
        if (hasForbidden) return false;
    }
    
    // Combat status special check
    if (requirements.status_forbidden?.includes("combat") && state.is_in_combat) {
        return false;
    }
    
    // Ally/Enemy checks
    if (requirements.min_allies !== undefined && 
        state.nearby_allies < requirements.min_allies) {
        return false;
    }
    if (requirements.max_enemies !== undefined && 
        state.nearby_enemies > requirements.max_enemies) {
        return false;
    }
    
    // Personality checks
    if (requirements.personality_traits && requirements.personality_traits.length > 0) {
        const hasTrait = requirements.personality_traits.some(trait =>
            state.personality.toLowerCase().includes(trait.toLowerCase())
        );
        if (!hasTrait) return false;
    }
    
    return true;
}

/**
 * Calculate priority for an action based on role and personality
 */
function calculatePriority(
    basePriority: number,
    action: ActionVerb,
    state: NPCState
): number {
    let priority = basePriority;
    
    // Apply role modifiers
    const roleMods = ROLE_ACTION_MODIFIERS[state.role.toLowerCase()];
    if (roleMods && roleMods[action] !== undefined) {
        priority += roleMods[action]!;
    }
    
    // Apply personality modifiers
    const personalityLower = state.personality.toLowerCase();
    for (const [trait, mods] of Object.entries(PERSONALITY_MODIFIERS)) {
        if (personalityLower.includes(trait)) {
            if (mods[action] !== undefined) {
                priority += mods[action]!;
            }
        }
    }
    
    // Context adjustments
    if (action === "ATTACK" && state.nearby_enemies === 0) {
        priority -= 5; // No enemies to attack
    }
    
    if (action === "DODGE" && state.nearby_enemies === 0) {
        priority -= 5; // Nothing to dodge from
    }
    
    if (action === "HELP" && state.nearby_allies === 0) {
        priority -= 5; // No allies to help
    }
    
    // Clamp to 1-10 range
    return Math.max(1, Math.min(10, priority));
}

/**
 * Get all available actions for an NPC in their current state
 */
export function getAvailableActions(state: NPCState): AvailableAction[] {
    const available: AvailableAction[] = [];
    
    for (const [verb, definition] of Object.entries(ACTION_DEFINITIONS)) {
        const actionVerb = verb as ActionVerb;
        
        // Check if requirements are met
        if (!checkRequirements(actionVerb, state, definition.requirements)) {
            continue;
        }
        
        // Calculate adjusted priority
        const priority = calculatePriority(definition.base_priority, actionVerb, state);
        
        // Build reason string
        let reason = getActionReason(actionVerb, state);
        
        available.push({
            verb: actionVerb,
            targets: definition.target_types,
            reason,
            priority,
            requirements: definition.requirements
        });
    }
    
    // Sort by priority (highest first)
    return available.sort((a, b) => b.priority - a.priority);
}

/**
 * Get a human-readable reason for why an action is available
 */
function getActionReason(action: ActionVerb, state: NPCState): string {
    const reasons: Record<ActionVerb, string> = {
        "USE": "Can use items",
        "ATTACK": state.nearby_enemies > 0 
            ? `Hostile targets present (${state.nearby_enemies})` 
            : "Combat capable",
        "HELP": state.nearby_allies > 0 
            ? `Allies nearby (${state.nearby_allies})` 
            : "Can assist others",
        "DEFEND": state.is_in_combat 
            ? "Combat situation" 
            : "Can protect self/others",
        "GRAPPLE": "Can engage in close combat",
        "INSPECT": "Can examine surroundings",
        "COMMUNICATE": "Can speak",
        "DODGE": state.health_percent < 40 
            ? "Low health - defensive option" 
            : "Can avoid attacks",
        "CRAFT": "Can create items",
        "SLEEP": "Can rest",
        "REPAIR": "Can fix items",
        "MOVE": "Can relocate",
        "WORK": "Can perform tasks",
        "GUARD": state.role === "guard" 
            ? "Guard duty" 
            : "Can stand watch",
        "HOLD": "Can ready an action"
    };
    
    return reasons[action] || "Available";
}

/**
 * Get the best action for an NPC (highest priority available)
 */
export function getBestAction(state: NPCState): AvailableAction | null {
    const actions = getAvailableActions(state);
    return actions[0] || null;
}

/**
 * Check if a specific action is available
 */
export function isActionAvailable(
    state: NPCState,
    action: ActionVerb
): boolean {
    const actions = getAvailableActions(state);
    return actions.some(a => a.verb === action);
}

/**
 * Build NPC state from character data
 */
export function buildNPCState(
    npc: {
        id: string;
        stats?: { health?: { current: number; max: number } };
        body_slots?: Record<string, unknown>;
        hand_slots?: Record<string, string>;
        tags?: Array<{ name: string }>;
        personality?: string;
        role?: string;
    },
    context: {
        nearby_allies: number;
        nearby_enemies: number;
        is_in_combat: boolean;
    }
): NPCState {
    const health = npc.stats?.health;
    const healthPercent = health ? (health.current / health.max) * 100 : 100;
    
    // Extract equipment
    const equipment: string[] = [];
    if (npc.body_slots) {
        for (const [slot, item] of Object.entries(npc.body_slots)) {
            if (item && typeof item === "object" && item !== null) {
                const itemName = (item as Record<string, unknown>).name;
                if (itemName) equipment.push(String(itemName));
            }
        }
    }
    if (npc.hand_slots) {
        for (const item of Object.values(npc.hand_slots)) {
            equipment.push(item.split(".").pop() || item);
        }
    }
    
    // Extract status effects
    const statusEffects = (npc.tags || [])
        .filter(tag => tag.name && tag.name !== "AWARENESS")
        .map(tag => tag.name.toLowerCase());
    
    // Check for specific equipment types
    const hasRanged = equipment.some(e => 
        /bow|crossbow|throw|dart|sling/i.test(e)
    );
    const hasShield = equipment.some(e => 
        /shield/i.test(e)
    );
    const hasHealing = equipment.some(e => 
        /potion|herb|medicine|bandage/i.test(e)
    );
    
    return {
        id: npc.id,
        health_percent: healthPercent,
        equipment,
        status_effects: statusEffects,
        personality: npc.personality || "neutral",
        role: npc.role || "unknown",
        nearby_allies: context.nearby_allies,
        nearby_enemies: context.nearby_enemies,
        is_in_combat: context.is_in_combat,
        has_ranged_weapon: hasRanged,
        has_shield: hasShield,
        has_healing_items: hasHealing
    };
}

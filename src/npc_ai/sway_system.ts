// NPC Sway System - Influence NPC decisions without forcing them
// Player actions can modify action priorities but NPCs retain agency

import type { AvailableAction } from "./action_selector.js";
import type { ActionVerb } from "../shared/constants.js";

// Types of influence/sway
export type SwayType = 
    | "intimidation" 
    | "persuasion" 
    | "bribe" 
    | "threat" 
    | "friendship"
    | "authority"
    | "charm"
    | "deception";

// Sway factor applied to NPC decision making
export type SwayFactor = {
    type: SwayType;
    magnitude: number; // -10 to +10, negative = discourages, positive = encourages
    source: string; // Who is applying sway (actor.npc id)
    reason: string; // Why this sway applies
    duration_turns: number; // How many turns this sway lasts
    applied_at?: string; // ISO timestamp (added when applied)
};

// Sway effects on specific actions
export type SwayEffect = {
    action: ActionVerb;
    modifier: number; // Priority modifier
    conditions?: {
        min_magnitude?: number;
        max_magnitude?: number;
    };
};

// Sway configuration for each sway type
const SWAY_CONFIG: Record<SwayType, {
    description: string;
    effects: SwayEffect[];
    resistance_traits: string[]; // Personality traits that resist this sway
    susceptibility_traits: string[]; // Personality traits that are vulnerable
}> = {
    "intimidation": {
        description: "Using fear or threats to influence behavior",
        effects: [
            { action: "DODGE", modifier: 3 },
            { action: "DEFEND", modifier: 2 },
            { action: "ATTACK", modifier: -2 },
            { action: "COMMUNICATE", modifier: -1 }
        ],
        resistance_traits: ["brave", "fearless", "proud", "stubborn"],
        susceptibility_traits: ["cowardly", "cautious", "timid"]
    },
    
    "persuasion": {
        description: "Using logic and reason to influence behavior",
        effects: [
            { action: "COMMUNICATE", modifier: 2 },
            { action: "HELP", modifier: 2 },
            { action: "ATTACK", modifier: -3 }
        ],
        resistance_traits: ["stubborn", "suspicious", "paranoid"],
        susceptibility_traits: ["reasonable", "open-minded", "curious"]
    },
    
    "bribe": {
        description: "Using money or goods to influence behavior",
        effects: [
            { action: "COMMUNICATE", modifier: 3 },
            { action: "HELP", modifier: 2 },
            { action: "DEFEND", modifier: 1 }
        ],
        resistance_traits: ["honorable", "proud", "noble", "honest"],
        susceptibility_traits: ["greedy", "poor", "corrupt", "opportunistic"]
    },
    
    "threat": {
        description: "Explicit threat of violence or harm",
        effects: [
            { action: "DODGE", modifier: 4 },
            { action: "DEFEND", modifier: 3 },
            { action: "ATTACK", modifier: -1 },
            { action: "COMMUNICATE", modifier: -2 }
        ],
        resistance_traits: ["brave", "fearless", "desperate", "fanatical"],
        susceptibility_traits: ["cowardly", "cautious", "protective"]
    },
    
    "friendship": {
        description: "Leveraging positive relationship",
        effects: [
            { action: "HELP", modifier: 4 },
            { action: "DEFEND", modifier: 3 },
            { action: "COMMUNICATE", modifier: 2 },
            { action: "ATTACK", modifier: -4 }
        ],
        resistance_traits: ["suspicious", "paranoid", "betrayed"],
        susceptibility_traits: ["loyal", "friendly", "trusting", "grateful"]
    },
    
    "authority": {
        description: "Using position or rank to command",
        effects: [
            { action: "DEFEND", modifier: 2 },
            { action: "GUARD", modifier: 2 },
            { action: "COMMUNICATE", modifier: 1 },
            { action: "DODGE", modifier: -1 }
        ],
        resistance_traits: ["rebellious", "anarchist", "proud", "independent"],
        susceptibility_traits: ["loyal", "lawful", "respectful", "subordinate"]
    },
    
    "charm": {
        description: "Using charisma and appeal",
        effects: [
            { action: "COMMUNICATE", modifier: 3 },
            { action: "HELP", modifier: 2 },
            { action: "ATTACK", modifier: -2 }
        ],
        resistance_traits: ["suspicious", "cynical", "asexual", "focused"],
        susceptibility_traits: ["romantic", "lonely", "flattered", "impressionable"]
    },
    
    "deception": {
        description: "Using lies and misdirection",
        effects: [
            { action: "COMMUNICATE", modifier: 2 },
            { action: "DODGE", modifier: 1 },
            { action: "INSPECT", modifier: -2 }
        ],
        resistance_traits: ["perceptive", "suspicious", "wise", "experienced"],
        susceptibility_traits: ["gullible", "trusting", "naive"]
    }
};

// Active sway storage (in-memory, per NPC)
const activeSway = new Map<string, SwayFactor[]>();

/**
 * Apply sway to an NPC
 */
export function applySway(
    npcId: string,
    sway: Omit<SwayFactor, "applied_at">
): void {
    const fullSway: SwayFactor = {
        ...sway,
        applied_at: new Date().toISOString()
    };
    
    const npcSway = activeSway.get(npcId) || [];
    
    // Remove expired sway first
    const now = Date.now();
    const validSway = npcSway.filter(s => {
        const applied_at = s.applied_at ?? new Date(0).toISOString();
        const age = (now - new Date(applied_at).getTime()) / 1000;
        // Assume 30 seconds per turn
        const turnsElapsed = age / 30;
        return turnsElapsed < s.duration_turns;
    });
    
    // Add new sway
    validSway.push(fullSway);
    activeSway.set(npcId, validSway);
}

/**
 * Get active sway factors for an NPC
 */
export function getActiveSway(npcId: string): SwayFactor[] {
    const npcSway = activeSway.get(npcId) || [];
    
    // Filter out expired sway
    const now = Date.now();
    const validSway = npcSway.filter(s => {
        const applied_at = s.applied_at ?? new Date(0).toISOString();
        const age = (now - new Date(applied_at).getTime()) / 1000;
        const turnsElapsed = age / 30;
        return turnsElapsed < s.duration_turns;
    });
    
    // Update storage if some expired
    if (validSway.length !== npcSway.length) {
        if (validSway.length === 0) {
            activeSway.delete(npcId);
        } else {
            activeSway.set(npcId, validSway);
        }
    }
    
    return validSway;
}

/**
 * Clear all sway for an NPC
 */
export function clearSway(npcId: string): void {
    activeSway.delete(npcId);
}

/**
 * Calculate resistance multiplier based on personality
 */
function calculateResistance(
    personality: string,
    swayType: SwayType
): number {
    const config = SWAY_CONFIG[swayType];
    const personalityLower = personality.toLowerCase();
    
    // Check resistance traits
    for (const trait of config.resistance_traits) {
        if (personalityLower.includes(trait)) {
            return 0.5; // 50% reduction in sway effect
        }
    }
    
    // Check susceptibility traits
    for (const trait of config.susceptibility_traits) {
        if (personalityLower.includes(trait)) {
            return 1.5; // 50% increase in sway effect
        }
    }
    
    return 1.0; // Normal effect
}

/**
 * Apply sway to available actions, modifying their priorities
 */
export function applySwayToActions(
    actions: AvailableAction[],
    swayFactors: SwayFactor[],
    personality: string
): AvailableAction[] {
    if (swayFactors.length === 0) return actions;
    
    return actions.map(action => {
        let totalModifier = 0;
        
        for (const sway of swayFactors) {
            const config = SWAY_CONFIG[sway.type];
            const resistance = calculateResistance(personality, sway.type);
            
            // Find matching effect for this action
            const effect = config.effects.find(e => e.action === action.verb);
            if (effect) {
                // Check magnitude conditions
                if (effect.conditions?.min_magnitude !== undefined &&
                    sway.magnitude < effect.conditions.min_magnitude) {
                    continue;
                }
                if (effect.conditions?.max_magnitude !== undefined &&
                    sway.magnitude > effect.conditions.max_magnitude) {
                    continue;
                }
                
                // Calculate modifier based on sway magnitude and resistance
                const magnitudeFactor = sway.magnitude / 10;
                const modifier = effect.modifier * magnitudeFactor * resistance;
                totalModifier += modifier;
            }
        }
        
        // Apply modifier to priority (clamped to 1-10)
        const newPriority = Math.max(1, Math.min(10, action.priority + totalModifier));
        
        return {
            ...action,
            priority: newPriority
        };
    }).sort((a, b) => b.priority - a.priority);
}

/**
 * Create sway from player communication
 * Parses player input to determine sway type
 */
export function createSwayFromCommunication(
    playerInput: string,
    playerRef: string,
    npcPersonality: string
): SwayFactor | null {
    const input = playerInput.toLowerCase();
    
    // Intimidation detection
    if (/\b(fear me|be afraid|tremble|kneel|bow|or else|you'll regret|watch yourself)\b/.test(input) ||
        (/\b(kill|destroy|crush|break you)\b/.test(input) && !input.includes("?"))) {
        return {
            type: "intimidation",
            magnitude: 5,
            source: playerRef,
            reason: "Player used intimidating language",
            duration_turns: 3
        };
    }
    
    // Threat detection
    if (/\b(i will|i'll|you will|you'll).*(hurt|harm|kill|destroy|attack)\b/.test(input) ||
        /\b(last warning|final warning|or die|or else)\b/.test(input)) {
        return {
            type: "threat",
            magnitude: 7,
            source: playerRef,
            reason: "Player issued explicit threat",
            duration_turns: 5
        };
    }
    
    // Persuasion detection
    if (/\b(please|consider|think about|reasonable|makes sense|logical|benefit)\b/.test(input) ||
        (/\b(if you|you could|you would|why not)\b/.test(input) && input.includes("?"))) {
        return {
            type: "persuasion",
            magnitude: 4,
            source: playerRef,
            reason: "Player used persuasive reasoning",
            duration_turns: 2
        };
    }
    
    // Bribe detection
    if (/\b(gold|coin|money|pay|payment|reward|rich|wealth)\b/.test(input) ||
        /\b(i'll give|i will give|here's|take this)\b/.test(input)) {
        return {
            type: "bribe",
            magnitude: 6,
            source: playerRef,
            reason: "Player offered payment/reward",
            duration_turns: 4
        };
    }
    
    // Friendship/appeal
    if (/\b(friend|ally|help|aid|assist|together|we can|trust me)\b/.test(input) &&
        !/\b(kill|attack|hurt|harm)\b/.test(input)) {
        return {
            type: "friendship",
            magnitude: 3,
            source: playerRef,
            reason: "Player appealed to camaraderie",
            duration_turns: 3
        };
    }
    
    // Authority
    if (/\b(order|command|demand|as your|by the authority|by order|i command)\b/.test(input)) {
        return {
            type: "authority",
            magnitude: 5,
            source: playerRef,
            reason: "Player asserted authority",
            duration_turns: 2
        };
    }
    
    // Charm/Flattery
    if (/\b(beautiful|handsome|wonderful|amazing|impressive|clever|wise|kind)\b/.test(input) ||
        /\b(you're so|you are so|i admire|i appreciate)\b/.test(input)) {
        return {
            type: "charm",
            magnitude: 3,
            source: playerRef,
            reason: "Player used flattery",
            duration_turns: 2
        };
    }
    
    // Deception (harder to detect, usually requires context)
    if (/\b(trust me|i swear|i promise|believe me|i assure you)\b/.test(input) &&
        npcPersonality.toLowerCase().includes("suspicious")) {
        return {
            type: "deception",
            magnitude: 2,
            source: playerRef,
            reason: "Player's assurances seem suspicious",
            duration_turns: 2
        };
    }
    
    return null;
}

/**
 * Get description of sway effects for debugging/logging
 */
export function describeSwayEffects(
    swayFactors: SwayFactor[],
    personality: string
): string {
    if (swayFactors.length === 0) return "No active sway";
    
    const descriptions: string[] = [];
    
    for (const sway of swayFactors) {
        const config = SWAY_CONFIG[sway.type];
        const resistance = calculateResistance(personality, sway.type);
        
        let resistanceText = "";
        if (resistance < 1) resistanceText = " (resisted)";
        if (resistance > 1) resistanceText = " (vulnerable)";
        
        descriptions.push(
            `${sway.type} (${sway.magnitude}/10) from ${sway.source}${resistanceText}: ${sway.reason}`
        );
    }
    
    return descriptions.join("; ");
}

/**
 * Check if NPC will resist sway based on personality and situation
 */
export function willResistSway(
    npcPersonality: string,
    swayType: SwayType,
    swayMagnitude: number,
    situation: {
        is_combat: boolean;
        health_percent: number;
        has_been_betrayed: boolean;
    }
): boolean {
    let resistanceChance = 0;
    
    // Base resistance from personality
    const config = SWAY_CONFIG[swayType];
    const personalityLower = npcPersonality.toLowerCase();
    
    for (const trait of config.resistance_traits) {
        if (personalityLower.includes(trait)) {
            resistanceChance += 0.3;
        }
    }
    
    for (const trait of config.susceptibility_traits) {
        if (personalityLower.includes(trait)) {
            resistanceChance -= 0.2;
        }
    }
    
    // Situation modifiers
    if (situation.is_combat) {
        resistanceChance += 0.2; // Combat makes NPCs more resistant
    }
    
    if (situation.health_percent < 25) {
        resistanceChance -= 0.3; // Low health makes NPCs more susceptible
    }
    
    if (situation.has_been_betrayed) {
        resistanceChance += 0.4; // Betrayed NPCs are very resistant to trust-based sway
    }
    
    // Magnitude modifier (stronger sway is harder to resist)
    resistanceChance -= (swayMagnitude / 10) * 0.2;
    
    // Clamp to 0-1
    resistanceChance = Math.max(0, Math.min(1, resistanceChance));
    
    // Roll to determine resistance
    return Math.random() < resistanceChance;
}

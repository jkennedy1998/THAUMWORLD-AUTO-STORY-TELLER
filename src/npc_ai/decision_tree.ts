// NPC Decision Tree - Scripted responses for common situations
// Provides immediate responses without AI calls for frequent scenarios

import type { ActionVerb } from "../shared/constants.js";

// Decision context passed to the tree
export type DecisionContext = {
    npc_id: string;
    npc_name: string;
    npc_role: string;
    npc_personality: string;
    player_input: string;
    action_verb?: ActionVerb;
    target_ref?: string;
    is_combat: boolean;
    health_percent: number;
    nearby_hostiles: number;
    nearby_allies: number;
    has_been_attacked: boolean;
    is_greeting: boolean;
    is_question: boolean;
    is_threat: boolean;
    player_tone: "friendly" | "neutral" | "hostile" | "unknown";
};

// Scripted response result
export type MatchedScriptedResponse = {
    matched: true;
    action: ActionVerb;
    target?: string;
    dialogue: string;
    reasoning: string;
    priority: number; // 1-10, higher = more urgent
};

export type ScriptedResponse = MatchedScriptedResponse | {
    matched: false;
};

// Decision node in the tree
export type DecisionNode = {
    condition: (ctx: DecisionContext) => boolean;
    response: ScriptedResponse | ((ctx: DecisionContext) => ScriptedResponse);
    priority: number;
};

// ===== EMERGENCY RESPONSES (Priority 10) =====

const emergencyResponses: DecisionNode[] = [
    // Critical health - flee or surrender
    {
        condition: (ctx) => ctx.health_percent < 15 && ctx.is_combat,
        response: (ctx) => ({
            matched: true,
            action: "DODGE",
            dialogue: ctx.npc_personality.includes("proud") 
                ? "I yield! Spare me!"
                : "Mercy! I surrender!",
            reasoning: "Critical health, must escape or surrender",
            priority: 10
        }),
        priority: 10
    },
    
    // Just attacked - immediate counter-attack for aggressive NPCs
    {
        condition: (ctx) => ctx.has_been_attacked && ctx.is_combat && ctx.npc_personality.includes("aggressive"),
        response: (ctx) => ({
            matched: true,
            action: "ATTACK",
            target: ctx.target_ref,
            dialogue: "You dare strike me?!",
            reasoning: "Aggressive personality responds to attacks immediately",
            priority: 10
        }),
        priority: 10
    },
    
    // Guard duty + threat detected
    {
        condition: (ctx) => ctx.npc_role === "guard" && ctx.is_threat && ctx.is_combat,
        response: (ctx) => ({
            matched: true,
            action: "DEFEND",
            dialogue: "Halt! None shall pass!",
            reasoning: "Guard duty requires defending against threats",
            priority: 10
        }),
        priority: 10
    }
];

// ===== SOCIAL RESPONSES (Priority 7-9) =====

const socialResponses: DecisionNode[] = [
    // Greeting the player
    {
        condition: (ctx) => ctx.is_greeting && !ctx.is_combat && ctx.player_tone !== "hostile",
        response: (ctx) => {
            const greetings = {
                shopkeeper: ["Welcome! Looking for anything specific?", "Greetings! Come to browse my wares?"],
                guard: ["Move along.", "What do you want?"],
                villager: ["Hello there!", "Good day to you!"],
                noble: ["*nods* Yes?", "Do I know you?"],
                default: ["Hello.", "Greetings.", "What do you need?"]
            } as const;

            const options = (greetings as any)[ctx.npc_role] ?? greetings.default;
            const dialogue = options[Math.floor(Math.random() * options.length)] ?? "Hello.";
            return {
                matched: true,
                action: "COMMUNICATE",
                dialogue,
                reasoning: "Responding to player greeting",
                priority: 8
            };
        },
        priority: 8
    },
    
    // Answering a question (shopkeeper)
    {
        condition: (ctx) => ctx.is_question && ctx.npc_role === "shopkeeper" && ctx.player_input.includes("price"),
        response: (ctx) => ({
            matched: true,
            action: "COMMUNICATE",
            dialogue: "Everything's priced fairly. What catches your eye?",
            reasoning: "Shopkeeper answering price inquiry",
            priority: 7
        }),
        priority: 7
    },
    
    // Responding to threats
    {
        condition: (ctx) => ctx.is_threat && !ctx.is_combat,
        response: (ctx) => {
            if (ctx.npc_personality.includes("coward")) {
                return {
                    matched: true,
                    action: "DODGE",
                    dialogue: "P-please, I don't want trouble!",
                    reasoning: "Cowardly personality avoids confrontation",
                    priority: 9
                };
            } else if (ctx.npc_personality.includes("brave")) {
                return {
                    matched: true,
                    action: "DEFEND",
                    dialogue: "You threaten me? I've faced worse!",
                    reasoning: "Brave personality stands ground against threats",
                    priority: 9
                };
            }
            return { matched: false };
        },
        priority: 9
    },
    
    // Friendly player in combat - offer help
    {
        condition: (ctx) => ctx.is_combat && ctx.player_tone === "friendly" && ctx.nearby_hostiles > 0,
        response: (ctx) => ({
            matched: true,
            action: "HELP",
            target: ctx.target_ref,
            dialogue: "I've got your back!",
            reasoning: "Friendly player in combat, offer assistance",
            priority: 8
        }),
        priority: 8
    }
];

// ===== COMBAT RESPONSES (Priority 5-7) =====

const combatResponses: DecisionNode[] = [
    // Low health - defensive stance
    {
        condition: (ctx) => ctx.health_percent < 40 && ctx.is_combat && ctx.nearby_hostiles > 0,
        response: (ctx) => ({
            matched: true,
            action: "DEFEND",
            dialogue: "I need to regroup...",
            reasoning: "Low health, prioritize defense",
            priority: 7
        }),
        priority: 7
    },
    
    // Outnumbered - call for help
    {
        condition: (ctx) => ctx.is_combat && ctx.nearby_hostiles > ctx.nearby_allies + 1,
        response: (ctx) => ({
            matched: true,
            action: "COMMUNICATE",
            dialogue: "To me! I need aid!",
            reasoning: "Outnumbered, calling for reinforcements",
            priority: 6
        }),
        priority: 6
    },
    
    // Standard combat - attack if healthy
    {
        condition: (ctx) => ctx.is_combat && ctx.health_percent > 50 && ctx.nearby_hostiles > 0,
        response: (ctx) => ({
            matched: true,
            action: "ATTACK",
            target: ctx.target_ref,
            dialogue: "Have at you!",
            reasoning: "Healthy and enemies present, attack",
            priority: 5
        }),
        priority: 5
    }
];

// ===== DEFAULT/FALLBACK RESPONSES (Priority 1-4) =====

const fallbackResponses: DecisionNode[] = [
    // Generic acknowledgment
    {
        condition: (ctx) => true, // Always matches
        response: (ctx) => ({
            matched: true,
            action: "COMMUNICATE",
            dialogue: ctx.is_question 
                ? "I'm not sure what you mean."
                : "I see.",
            reasoning: "No specific scripted response matched",
            priority: 1
        }),
        priority: 1
    }
];

// Combine all decision nodes, ordered by priority
const allDecisionNodes: DecisionNode[] = [
    ...emergencyResponses,
    ...socialResponses,
    ...combatResponses,
    ...fallbackResponses
].sort((a, b) => b.priority - a.priority);

// ===== PUBLIC API =====

/**
 * Check if a scripted response exists for this context
 * Returns the response if found, or { matched: false } if AI should be used
 */
export function checkScriptedResponse(context: DecisionContext): ScriptedResponse {
    for (const node of allDecisionNodes) {
        if (node.condition(context)) {
            const response = typeof node.response === "function" 
                ? node.response(context) 
                : node.response;
            
            if (response.matched) {
                return response;
            }
        }
    }
    
    return { matched: false };
}

/**
 * Check if this situation requires AI or can use scripted response
 * Returns true if AI should be called
 */
export function shouldUseAI(context: DecisionContext): boolean {
    const response = checkScriptedResponse(context);
    return !response.matched || response.priority < 5;
}

/**
 * Helper to build decision context from available data
 */
export function buildDecisionContext(
    npc: {
        id: string;
        name: string;
        role?: string;
        personality?: string;
        stats?: { health?: { current: number; max: number } };
    },
    playerInput: string,
    situation: {
        is_combat: boolean;
        has_been_attacked: boolean;
        nearby_hostiles: number;
        nearby_allies: number;
        action_verb?: ActionVerb;
        target_ref?: string;
    }
): DecisionContext {
    const health = npc.stats?.health;
    const healthPercent = health ? (health.current / health.max) * 100 : 100;
    
    const input = playerInput.toLowerCase();
    const isGreeting = /\b(hello|hi|greetings|hey|good (morning|day|evening))\b/.test(input);
    const isQuestion = /\?|\b(what|where|who|why|how|when|is|are|can|do|does)\b/.test(input);
    const isThreat = /\b(threat|kill|attack|die|destroy|hurt|harm)\b/.test(input);
    
    // Simple tone detection
    let playerTone: "friendly" | "neutral" | "hostile" | "unknown" = "neutral";
    if (/\b(please|thank|kind|help|friend)\b/.test(input)) {
        playerTone = "friendly";
    } else if (/\b(stupid|idiot|damn|hell|bastard)\b/.test(input) || isThreat) {
        playerTone = "hostile";
    }
    
    return {
        npc_id: npc.id,
        npc_name: npc.name,
        npc_role: npc.role || "unknown",
        npc_personality: npc.personality || "neutral",
        player_input: playerInput,
        action_verb: situation.action_verb,
        target_ref: situation.target_ref,
        is_combat: situation.is_combat,
        health_percent: healthPercent,
        nearby_hostiles: situation.nearby_hostiles,
        nearby_allies: situation.nearby_allies,
        has_been_attacked: situation.has_been_attacked,
        is_greeting: isGreeting,
        is_question: isQuestion,
        is_threat: isThreat,
        player_tone: playerTone
    };
}

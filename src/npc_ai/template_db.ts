// NPC Template Database - Cached responses for common NPC archetypes
// Reduces AI calls by using pre-written templates for frequent scenarios

import type { ActionVerb } from "../shared/constants.js";

// Template entry with variations
export type NPCTemplate = {
    id: string;
    archetype: string; // "shopkeeper", "guard", "villager", etc.
    situation: string; // "greeting", "question", "combat", etc.
    action: ActionVerb;
    responses: string[]; // Multiple variations for variety
    conditions?: {
        min_health?: number;
        max_health?: number;
        requires_combat?: boolean;
        requires_peace?: boolean;
        time_of_day?: "day" | "night";
    };
    priority: number; // 1-10, higher = more specific/important
};

// ===== SHOPKEEPER TEMPLATES =====

const shopkeeperTemplates: NPCTemplate[] = [
    {
        id: "shopkeeper_greeting",
        archetype: "shopkeeper",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Welcome to my shop! Looking for anything specific?",
            "Greetings! Come to browse my wares?",
            "Ah, a customer! What can I interest you in today?",
            "Welcome, welcome! Best prices in town, I guarantee it!"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "shopkeeper_question_price",
        archetype: "shopkeeper",
        situation: "question_about_prices",
        action: "COMMUNICATE",
        responses: [
            "Everything's priced fairly. What catches your eye?",
            "I offer competitive rates. See anything you like?",
            "Quality goods at honest prices. Interested in something?",
            "Browse around! I'm sure you'll find something in your range."
        ],
        conditions: { requires_peace: true },
        priority: 6
    },
    {
        id: "shopkeeper_question_location",
        archetype: "shopkeeper",
        situation: "question_about_location",
        action: "COMMUNICATE",
        responses: [
            "I just sell goods, friend. Try asking at the inn.",
            "Can't help you there, but the tavern keeper knows everything.",
            "You want directions? I'm no guide, but the guard station might help.",
            "Sorry, I keep to my shop. The locals at the market know more."
        ],
        conditions: { requires_peace: true },
        priority: 4
    },
    {
        id: "shopkeeper_threat",
        archetype: "shopkeeper",
        situation: "threatened",
        action: "COMMUNICATE",
        responses: [
            "P-please! Take what you want, just don't hurt me!",
            "Help! Guards! Someone help!",
            "I don't want trouble! Here, take the money!",
            "Mercy! I have a family!"
        ],
        conditions: { requires_peace: true },
        priority: 9
    },
    {
        id: "shopkeeper_haggle_success",
        archetype: "shopkeeper",
        situation: "haggle_success",
        action: "COMMUNICATE",
        responses: [
            "Fine, fine. You've got a silver tongue. Deal.",
            "You're driving a hard bargain, but I'll accept.",
            "*sigh* You win. It's yours at that price.",
            "I must be getting soft. Agreed!"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "shopkeeper_haggle_fail",
        archetype: "shopkeeper",
        situation: "haggle_fail",
        action: "COMMUNICATE",
        responses: [
            "That's my final offer. Take it or leave it.",
            "I can't go lower. These goods cost me plenty.",
            "No deal. I'd be losing money at that price.",
            "Sorry, friend. My prices are firm."
        ],
        conditions: { requires_peace: true },
        priority: 5
    }
];

// ===== GUARD TEMPLATES =====

const guardTemplates: NPCTemplate[] = [
    {
        id: "guard_greeting",
        archetype: "guard",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Move along. Nothing to see here.",
            "What do you want? State your business.",
            "Keep walking if you've got no business here.",
            "*eyes you suspiciously* Yes?"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "guard_question_directions",
        archetype: "guard",
        situation: "question_about_directions",
        action: "COMMUNICATE",
        responses: [
            "The inn's down the road, left at the fountain.",
            "Market's that way. Don't cause trouble.",
            "Keep to the main roads. The alleys aren't safe.",
            "The temple? East gate, can't miss it."
        ],
        conditions: { requires_peace: true },
        priority: 4
    },
    {
        id: "guard_question_crime",
        archetype: "guard",
        situation: "question_about_crime",
        action: "COMMUNICATE",
        responses: [
            "Haven't seen anything. Try the captain.",
            "Not my beat. Ask at the station.",
            "Plenty of crime lately. Stay vigilant.",
            "Report it to the authorities if you know something."
        ],
        conditions: { requires_peace: true },
        priority: 4
    },
    {
        id: "guard_threat",
        archetype: "guard",
        situation: "threatened",
        action: "DEFEND",
        responses: [
            "You threaten the law? Big mistake.",
            "Last warning. Back down now.",
            "Drawing steel on a guard? You're under arrest!",
            "Call for backup! Hostile individual!"
        ],
        conditions: { requires_peace: true },
        priority: 10
    },
    {
        id: "guard_combat_attacked",
        archetype: "guard",
        situation: "attacked",
        action: "ATTACK",
        responses: [
            "Assaulting an officer! You're done!",
            "To arms! Criminal attacking!",
            "You'll pay for that, scum!",
            "For the city!"
        ],
        conditions: { requires_combat: true },
        priority: 10
    },
    {
        id: "guard_combat_ally",
        archetype: "guard",
        situation: "player_fighting_enemy",
        action: "HELP",
        responses: [
            "I've got your back!",
            "For the city! To me!",
            "Stand down, criminal!",
            "The law is with you, citizen!"
        ],
        conditions: { requires_combat: true },
        priority: 8
    }
];

// ===== VILLAGER TEMPLATES =====

const villagerTemplates: NPCTemplate[] = [
    {
        id: "villager_greeting",
        archetype: "villager",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Hello there! Lovely day, isn't it?",
            "Good day to you, traveler!",
            "Well met! Passing through?",
            "*nods* Not often we see strangers here."
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "villager_question_rumors",
        archetype: "villager",
        situation: "question_about_rumors",
        action: "COMMUNICATE",
        responses: [
            "People are whispering again. Trouble has a way of finding this place.",
            "I've heard talk of dangers on the roads. Best keep your eyes open.",
            "Rumors travel faster than carts. I wouldn't stake my life on any of them.",
            "Nothing solid. Just uneasy talk and a lot of looking over shoulders."
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "villager_question_general",
        archetype: "villager",
        situation: "question",
        action: "COMMUNICATE",
        responses: [
            "Hard to say. What exactly are you asking?",
            "Maybe. Maybe not. Say it plain for me.",
            "I don't know about all that. What do you need?",
            "I've got my own worries. What's this about?"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "villager_threat",
        archetype: "villager",
        situation: "threatened",
        action: "DODGE",
        responses: [
            "P-please, I don't want trouble!",
            "Mercy! I'm just a simple farmer!",
            "Help! Someone help!",
            "*flees in terror*"
        ],
        conditions: { requires_peace: true },
        priority: 9
    },
    {
        id: "villager_combat",
        archetype: "villager",
        situation: "combat_nearby",
        action: "DODGE",
        responses: [
            "Get away from here!",
            "Run for your lives!",
            "Someone call the guards!",
            "*screams and runs*"
        ],
        conditions: { requires_combat: true },
        priority: 8
    }
];

// ===== ELDER TEMPLATES (for sages, elders, lorekeepers) =====

const elderTemplates: NPCTemplate[] = [
    {
        id: "elder_greeting",
        archetype: "elder",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Ah. Another set of footsteps at the crossroads. Speak, and be quick about it.",
            "Evening, traveler. The valley listens more than people do.",
            "If you've come for a story, sit. If you've come for truth, stand."
        ],
        conditions: { requires_peace: true },
        priority: 6
    },
    {
        id: "elder_question",
        archetype: "elder",
        situation: "question",
        action: "COMMUNICATE",
        responses: [
            "You're asking the right shape of question. Now tell me what you're really after.",
            "Goals change with the wind. Whose goals do you mean?",
            "If you want my counsel, give me the details you won't say out loud.",
            "I've watched this place long enough to know: intent matters more than words."
        ],
        conditions: { requires_peace: true },
        priority: 6
    },
    {
        id: "elder_question_about_rumors",
        archetype: "elder",
        situation: "question_about_rumors",
        action: "COMMUNICATE",
        responses: [
            "Rumors are smoke. Still... smoke comes from somewhere.",
            "People whisper. The land whispers too. Listen for the difference.",
            "If you hear fear in a rumor, look for the hand that profits from it."
        ],
        conditions: { requires_peace: true },
        priority: 6
    }
];

// ===== NOBLE TEMPLATES =====

const nobleTemplates: NPCTemplate[] = [
    {
        id: "noble_greeting",
        archetype: "noble",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "*nods curtly* Yes?",
            "Do I know you?",
            "State your business. I haven't much time.",
            "*looks you up and down* Hmm."
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "noble_question_favor",
        archetype: "noble",
        situation: "question_about_favor",
        action: "COMMUNICATE",
        responses: [
            "Why should I help you? What's in it for me?",
            "Perhaps. What are you offering in return?",
            "I might be persuaded... for the right price.",
            "My influence isn't free, you understand."
        ],
        conditions: { requires_peace: true },
        priority: 6
    },
    {
        id: "noble_threat",
        archetype: "noble",
        situation: "threatened",
        action: "COMMUNICATE",
        responses: [
            "Do you know who I am? My guards will hear of this!",
            "How dare you! I'll have your head!",
            "Guards! Guards!",
            "You'll regret this, peasant!"
        ],
        conditions: { requires_peace: true },
        priority: 9
    }
];

// ===== INNKEEPER TEMPLATES =====

const innkeeperTemplates: NPCTemplate[] = [
    {
        id: "innkeeper_greeting",
        archetype: "innkeeper",
        situation: "greeting",
        action: "COMMUNICATE",
        responses: [
            "Welcome, traveler! Room and board available.",
            "Ah, a new face! Come for the famous stew?",
            "Looking for a room? Best beds in town!",
            "Welcome to my humble establishment!"
        ],
        conditions: { requires_peace: true },
        priority: 5
    },
    {
        id: "innkeeper_question_room",
        archetype: "innkeeper",
        situation: "question_about_room",
        action: "COMMUNICATE",
        responses: [
            "5 gold a night. Includes breakfast.",
            "I've got one room left. 4 gold.",
            "For you? Special rate: 3 gold.",
            "Rooms are 5 gold. Stables included."
        ],
        conditions: { requires_peace: true },
        priority: 6
    },
    {
        id: "innkeeper_question_rumors",
        archetype: "innkeeper",
        situation: "question_about_rumors",
        action: "COMMUNICATE",
        responses: [
            "I hear everything here. What do you want to know?",
            "Buy a round for the house and I'll tell you what I know.",
            "The merchant who stayed last night was asking about the caves...",
            "Keep your ears open in my common room. You'll learn plenty."
        ],
        conditions: { requires_peace: true },
        priority: 5
    }
];

// Combine all templates
const allTemplates: NPCTemplate[] = [
    ...shopkeeperTemplates,
    ...guardTemplates,
    ...villagerTemplates,
    ...elderTemplates,
    ...nobleTemplates,
    ...innkeeperTemplates
];

// ===== PUBLIC API =====

/**
 * Find a matching template for an NPC archetype and situation
 */
export function findTemplate(
    archetype: string,
    situation: string,
    context: {
        is_combat: boolean;
        health_percent: number;
        time_of_day?: "day" | "night";
    }
): NPCTemplate | null {
    // Filter by archetype and situation
    let matches = allTemplates.filter(t => 
        t.archetype === archetype && 
        t.situation === situation
    );
    
    // If no exact match, allow fallback to less-specific templates.
    // IMPORTANT: Never match a more-specific template when the detected situation is generic.
    // Example: situation="question" should NOT match "question_about_rumors".
    if (matches.length === 0) {
        matches = allTemplates.filter(t =>
            t.archetype === archetype &&
            (situation.startsWith(t.situation) || t.situation === "general")
        );
    }
    
    // Filter by conditions
    matches = matches.filter(t => {
        if (!t.conditions) return true;
        
        if (t.conditions.requires_combat && !context.is_combat) return false;
        if (t.conditions.requires_peace && context.is_combat) return false;
        
        if (t.conditions.min_health !== undefined && 
            context.health_percent < t.conditions.min_health) return false;
        if (t.conditions.max_health !== undefined && 
            context.health_percent > t.conditions.max_health) return false;
        
        if (t.conditions.time_of_day && 
            t.conditions.time_of_day !== context.time_of_day) return false;
        
        return true;
    });
    
    // Sort by priority (highest first)
    matches.sort((a, b) => b.priority - a.priority);
    
    return matches[0] || null;
}

/**
 * Get a random response from a template
 */
export function getTemplateResponse(template: NPCTemplate): string {
    const index = Math.floor(Math.random() * template.responses.length);
    return template.responses[index] ?? template.responses[0] ?? "...";
}

/**
 * Detect situation from player input
 */
export function detectSituation(playerInput: string): string {
    const input = playerInput.toLowerCase();
    
    // Greeting detection
    if (/\b(hello|hi|greetings|hey|good (morning|day|evening))\b/.test(input)) {
        return "greeting";
    }
    
    // Question detection
    if (/\?/.test(input) || /\b(what|where|who|why|how|when|is|are|can|do|does)\b/.test(input)) {
        if (/\b(price|cost|how much|gold|money|buy|sell)\b/.test(input)) {
            return "question_about_prices";
        }
        if (/\b(where|direction|how do I get|way to|path)\b/.test(input)) {
            return "question_about_directions";
        }
        if (/\b(room|bed|sleep|stay|inn)\b/.test(input)) {
            return "question_about_room";
        }
        if (/\b(rumor|hear|news|gossip|what's happening)\b/.test(input)) {
            return "question_about_rumors";
        }
        if (/\b(help|favor|aid|assist)\b/.test(input)) {
            return "question_about_favor";
        }
        if (/\b(crime|thief|stolen|murder|attack)\b/.test(input)) {
            return "question_about_crime";
        }
        return "question";
    }
    
    // Threat detection
    if (/\b(threat|kill|attack|die|destroy|hurt|harm|rob|steal)\b/.test(input)) {
        return "threatened";
    }
    
    // Haggle detection
    if (/\b(cheaper|lower|discount|too much|expensive|deal|offer)\b/.test(input)) {
        return "haggle_attempt";
    }
    
    return "general";
}

/**
 * Check if a template exists for this archetype and situation
 */
export function hasTemplate(
    archetype: string,
    situation: string,
    context: {
        is_combat: boolean;
        health_percent: number;
    }
): boolean {
    return findTemplate(archetype, situation, context) !== null;
}

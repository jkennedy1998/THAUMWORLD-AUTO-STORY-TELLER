// Reaction System
// Handles held actions and reactions outside normal turn order

import type { ActionVerb } from "../shared/constants.js";

export type ReactionType = 
    | "OPPORTUNITY_ATTACK"
    | "DEFEND_ALLY"
    | "COUNTER_SPELL"
    | "READY_ACTION"
    | "INTERRUPT"
    | "EVADE"
    | "WARNING";

export type ReactionTrigger = {
    type: ReactionType;
    condition: string;
    priority: number; // 1-10, higher = resolves first
};

export type ReactionRequest = {
    reactor_ref: string;
    reaction_type: ReactionType;
    action: ActionVerb;
    target_ref?: string;
    trigger: string;
    priority: number;
};

export type ReactionResult = {
    reactor_ref: string;
    action: ActionVerb;
    target_ref?: string;
    success: boolean;
    message: string;
    resolved_at: string;
};

export type HeldActionState = {
    actor_ref: string;
    action: ActionVerb;
    trigger: ReactionTrigger;
    held_since: string;
    turn_number: number;
    expires_at_turn?: number; // Some held actions expire
};

// Reaction priority rankings
const REACTION_PRIORITIES: Record<ReactionType, number> = {
    "COUNTER_SPELL": 10, // Highest - interrupts magic
    "INTERRUPT": 9,      // High - stops actions
    "EVADE": 8,          // High - defensive
    "DEFEND_ALLY": 7,    // Medium-high - protect others
    "OPPORTUNITY_ATTACK": 6, // Medium - free attack
    "READY_ACTION": 5,   // Medium - prepared action
    "WARNING": 3         // Low - just alerts
};

// In-memory storage for held actions
const heldActions = new Map<string, HeldActionState>(); // event_id -> held action

/**
 * Hold an action for later
 */
export function hold_action(
    event_id: string,
    actor_ref: string,
    action: ActionVerb,
    trigger: ReactionTrigger,
    current_turn: number,
    duration_turns?: number
): HeldActionState {
    const held: HeldActionState = {
        actor_ref,
        action,
        trigger,
        held_since: new Date().toISOString(),
        turn_number: current_turn,
        expires_at_turn: duration_turns ? current_turn + duration_turns : undefined
    };
    
    const key = `${event_id}:${actor_ref}`;
    heldActions.set(key, held);
    
    return held;
}

/**
 * Release a held action (use it)
 */
export function release_held_action(
    event_id: string,
    actor_ref: string
): HeldActionState | null {
    const key = `${event_id}:${actor_ref}`;
    const held = heldActions.get(key);
    
    if (held) {
        heldActions.delete(key);
        return held;
    }
    
    return null;
}

/**
 * Cancel a held action
 */
export function cancel_held_action(
    event_id: string,
    actor_ref: string
): boolean {
    const key = `${event_id}:${actor_ref}`;
    return heldActions.delete(key);
}

/**
 * Get held action for an actor
 */
export function get_held_action(
    event_id: string,
    actor_ref: string
): HeldActionState | undefined {
    const key = `${event_id}:${actor_ref}`;
    return heldActions.get(key);
}

/**
 * Check if actor has a held action
 */
export function has_held_action(
    event_id: string,
    actor_ref: string
): boolean {
    const key = `${event_id}:${actor_ref}`;
    return heldActions.has(key);
}

/**
 * Check all held actions for triggers
 */
export function check_triggers(
    event_id: string,
    trigger_event: string,
    current_turn: number,
    context: {
        actor_ref?: string;
        target_ref?: string;
        action?: string;
        location?: { x: number; y: number };
    }
): ReactionRequest[] {
    const reactions: ReactionRequest[] = [];
    
    // Check all held actions for this event
    for (const [key, held] of heldActions.entries()) {
        if (!key.startsWith(`${event_id}:`)) continue;
        
        // Check if expired
        if (held.expires_at_turn && current_turn > held.expires_at_turn) {
            heldActions.delete(key);
            continue;
        }
        
        // Check if trigger matches
        if (matches_trigger(held.trigger, trigger_event, context)) {
            reactions.push({
                reactor_ref: held.actor_ref,
                reaction_type: held.trigger.type,
                action: held.action,
                target_ref: context.actor_ref, // React to the actor causing the trigger
                trigger: trigger_event,
                priority: held.trigger.priority
            });
        }
    }
    
    // Sort by priority (highest first)
    reactions.sort((a, b) => b.priority - a.priority);
    
    return reactions;
}

/**
 * Check if a trigger matches the event
 */
function matches_trigger(
    trigger: ReactionTrigger,
    event: string,
    context: {
        actor_ref?: string;
        target_ref?: string;
        action?: string;
        location?: { x: number; y: number };
    }
): boolean {
    const event_lower = event.toLowerCase();
    const condition_lower = trigger.condition.toLowerCase();
    
    // Simple string matching for now
    // In a full implementation, this would use more sophisticated matching
    
    switch (trigger.type) {
        case "OPPORTUNITY_ATTACK":
            // Triggered when enemy moves away
            return event_lower.includes("moves") || event_lower.includes("retreats");
            
        case "DEFEND_ALLY":
            // Triggered when ally is attacked
            return event_lower.includes("attacks") && 
                   (event_lower.includes("ally") || (context.target_ref?.includes("ally") ?? false));
            
        case "COUNTER_SPELL":
            // Triggered when spell is cast
            return event_lower.includes("casts") || event_lower.includes("spell");
            
        case "INTERRUPT":
            // Triggered when specific action happens
            return event_lower.includes(condition_lower);
            
        case "EVADE":
            // Triggered when area effect happens
            return event_lower.includes("explosion") || 
                   event_lower.includes("area") ||
                   event_lower.includes("trap");
            
        case "WARNING":
            // Triggered when enemy approaches
            return event_lower.includes("approaches") || 
                   event_lower.includes("enters") ||
                   event_lower.includes("nearby");
            
        case "READY_ACTION":
            // General trigger based on condition
            return event_lower.includes(condition_lower);
            
        default:
            return false;
    }
}

/**
 * Process a reaction
 */
export function process_reaction(
    request: ReactionRequest,
    validator: (actor_ref: string, action: ActionVerb, target_ref?: string) => boolean
): ReactionResult {
    const resolved_at = new Date().toISOString();
    
    // Validate the reaction is still possible
    if (!validator(request.reactor_ref, request.action, request.target_ref)) {
        return {
            reactor_ref: request.reactor_ref,
            action: request.action,
            target_ref: request.target_ref,
            success: false,
            message: "Reaction no longer valid",
            resolved_at
        };
    }
    
    // In a full implementation, this would resolve the action
    // For now, return success
    return {
        reactor_ref: request.reactor_ref,
        action: request.action,
        target_ref: request.target_ref,
        success: true,
        message: `${request.reactor_ref} reacts with ${request.action}`,
        resolved_at
    };
}

/**
 * Create common reaction triggers
 */
export function create_trigger(
    type: ReactionType,
    custom_condition?: string
): ReactionTrigger {
    const default_conditions: Record<ReactionType, string> = {
        "OPPORTUNITY_ATTACK": "enemy moves away",
        "DEFEND_ALLY": "ally is attacked",
        "COUNTER_SPELL": "spell is cast",
        "READY_ACTION": "condition is met",
        "INTERRUPT": "action begins",
        "EVADE": "area effect triggers",
        "WARNING": "enemy approaches"
    };
    
    return {
        type,
        condition: custom_condition || default_conditions[type],
        priority: REACTION_PRIORITIES[type]
    };
}

/**
 * Get default reaction for an action type
 */
export function get_default_reaction(
    action_being_interrupted: ActionVerb
): ReactionType | null {
    switch (action_being_interrupted) {
        case "ATTACK":
            return "DEFEND_ALLY";
        case "USE":
            return "INTERRUPT"; // Could be counter-spell if magic
        case "MOVE":
            return "OPPORTUNITY_ATTACK";
        case "GRAPPLE":
            return "EVADE";
        default:
            return null;
    }
}

/**
 * Check if a reaction can interrupt an action
 */
export function can_interrupt(
    reaction: ReactionType,
    action: ActionVerb
): boolean {
    switch (reaction) {
        case "COUNTER_SPELL":
            return action === "USE" || action === "ATTACK"; // Assuming magic
        case "INTERRUPT":
            return true; // Can interrupt anything
        case "EVADE":
            return action === "ATTACK" || action === "GRAPPLE";
        default:
            return false; // Other reactions happen after
    }
}

/**
 * Clear all held actions for an event
 */
export function clear_event_reactions(event_id: string): void {
    for (const key of heldActions.keys()) {
        if (key.startsWith(`${event_id}:`)) {
            heldActions.delete(key);
        }
    }
}

/**
 * Get all held actions for an event
 */
export function get_event_held_actions(event_id: string): HeldActionState[] {
    const actions: HeldActionState[] = [];
    
    for (const [key, held] of heldActions.entries()) {
        if (key.startsWith(`${event_id}:`)) {
            actions.push(held);
        }
    }
    
    return actions;
}

/**
 * Get reaction description
 */
export function get_reaction_description(reaction: ReactionRequest): string {
    const descriptions: Record<ReactionType, string> = {
        "OPPORTUNITY_ATTACK": "opportunity attack",
        "DEFEND_ALLY": "defend ally",
        "COUNTER_SPELL": "counter spell",
        "READY_ACTION": "readied action",
        "INTERRUPT": "interrupt",
        "EVADE": "evade",
        "WARNING": "warning"
    };
    
    return `${reaction.reactor_ref} uses ${descriptions[reaction.reaction_type]} (${reaction.action})`;
}

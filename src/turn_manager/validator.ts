// Action Validator
// Validates actions before execution

import type { ActionVerb } from "../shared/constants.js";

export type ActionCost = "FULL" | "PARTIAL" | "EXTENDED" | "FREE";

export type ValidationResult = {
    valid: boolean;
    error?: string;
    warnings?: string[];
};

export type ActorState = {
    ref: string;
    health_percent: number;
    action_points: number; // For action cost system
    max_action_points: number;
    status_effects: string[];
    equipment: string[];
    location: {
        x: number;
        y: number;
        region_id: string;
    };
    stats: {
        str: number;
        dex: number;
        con: number;
        int: number;
        wis: number;
        cha: number;
    };
};

export type ActionValidationContext = {
    actor: ActorState;
    action: ActionVerb;
    target_ref?: string;
    target_state?: ActorState;
    item_ref?: string;
    working_memory?: {
        participants: Array<{ ref: string; location?: { x: number; y: number } }>;
        region_conditions: string[];
    };
};

// Action cost definitions
const ACTION_COSTS: Record<ActionVerb, ActionCost> = {
    "USE": "PARTIAL",
    "ATTACK": "FULL",
    "HELP": "PARTIAL",
    "DEFEND": "PARTIAL",
    "GRAPPLE": "FULL",
    "INSPECT": "FREE",
    "COMMUNICATE": "FREE",
    "DODGE": "PARTIAL",
    "CRAFT": "EXTENDED",
    "SLEEP": "EXTENDED",
    "REPAIR": "PARTIAL",
    "MOVE": "PARTIAL",
    "WORK": "EXTENDED",
    "GUARD": "PARTIAL",
    "HOLD": "FREE"
};

// Action requirements
const ACTION_REQUIREMENTS: Record<ActionVerb, {
    min_health?: number;
    forbidden_statuses?: string[];
    required_statuses?: string[];
    required_equipment?: string[];
    range?: number; // Maximum range in tiles
    line_of_sight?: boolean;
}> = {
    "USE": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "ATTACK": {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed", "restrained", "prone"],
        range: 1, // Melee default
        line_of_sight: true
    },
    "HELP": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed"],
        range: 1
    },
    "DEFEND": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "GRAPPLE": {
        min_health: 30,
        forbidden_statuses: ["stunned", "paralyzed", "restrained"],
        range: 1,
        line_of_sight: true
    },
    "INSPECT": {
        min_health: 0,
        forbidden_statuses: ["blinded"],
        range: 5,
        line_of_sight: true
    },
    "COMMUNICATE": {
        min_health: 0,
        forbidden_statuses: ["silenced", "gagged"],
        range: 10
    },
    "DODGE": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed", "restrained", "prone"]
    },
    "CRAFT": {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "SLEEP": {
        min_health: 0,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "REPAIR": {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "MOVE": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed", "restrained"]
    },
    "WORK": {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "GUARD": {
        min_health: 20,
        forbidden_statuses: ["stunned", "paralyzed"]
    },
    "HOLD": {
        min_health: 10,
        forbidden_statuses: ["stunned", "paralyzed"]
    }
};

/**
 * Validate an action
 */
export function validate_action(context: ActionValidationContext): ValidationResult {
    const warnings: string[] = [];
    
    // Check action cost
    const cost_validation = validate_action_cost(context);
    if (!cost_validation.valid) {
        return cost_validation;
    }
    
    // Check health requirements
    const health_validation = validate_health_requirement(context);
    if (!health_validation.valid) {
        return health_validation;
    }
    
    // Check status effects
    const status_validation = validate_status_requirements(context);
    if (!status_validation.valid) {
        return status_validation;
    }
    
    // Check equipment requirements
    const equipment_validation = validate_equipment_requirements(context);
    if (!equipment_validation.valid) {
        return equipment_validation;
    }
    
    // Check range and visibility
    if (context.target_state) {
        const range_validation = validate_range_and_visibility(context);
        if (!range_validation.valid) {
            return range_validation;
        }
        
        if (range_validation.warnings) {
            warnings.push(...range_validation.warnings);
        }
    }
    
    // Check specific action rules
    const action_validation = validate_action_specific_rules(context);
    if (!action_validation.valid) {
        return action_validation;
    }
    
    return {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined
    };
}

/**
 * Validate action cost
 */
function validate_action_cost(context: ActionValidationContext): ValidationResult {
    const cost = ACTION_COSTS[context.action];
    
    switch (cost) {
        case "FULL":
            if (context.actor.action_points < context.actor.max_action_points) {
                return {
                    valid: false,
                    error: `Action ${context.action} requires full action points. Current: ${context.actor.action_points}/${context.actor.max_action_points}`
                };
            }
            break;
            
        case "PARTIAL":
            if (context.actor.action_points < 1) {
                return {
                    valid: false,
                    error: `Action ${context.action} requires at least 1 action point. Current: ${context.actor.action_points}`
                };
            }
            break;
            
        case "EXTENDED":
            // Extended actions take multiple turns, check if already performing one
            if (context.actor.status_effects.includes("performing_extended_action")) {
                return {
                    valid: false,
                    error: "Already performing an extended action"
                };
            }
            break;
            
        case "FREE":
            // Free actions always valid
            break;
    }
    
    return { valid: true };
}

/**
 * Validate health requirement
 */
function validate_health_requirement(context: ActionValidationContext): ValidationResult {
    const requirements = ACTION_REQUIREMENTS[context.action];
    
    if (requirements.min_health !== undefined) {
        if (context.actor.health_percent < requirements.min_health) {
            return {
                valid: false,
                error: `Health too low for ${context.action}. Required: ${requirements.min_health}%, Current: ${context.actor.health_percent}%`
            };
        }
    }
    
    return { valid: true };
}

/**
 * Validate status effect requirements
 */
function validate_status_requirements(context: ActionValidationContext): ValidationResult {
    const requirements = ACTION_REQUIREMENTS[context.action];
    
    // Check forbidden statuses
    if (requirements.forbidden_statuses) {
        for (const status of requirements.forbidden_statuses) {
            if (context.actor.status_effects.some(s => s.toLowerCase().includes(status.toLowerCase()))) {
                return {
                    valid: false,
                    error: `Cannot ${context.action} while ${status}`
                };
            }
        }
    }
    
    // Check required statuses
    if (requirements.required_statuses) {
        for (const status of requirements.required_statuses) {
            if (!context.actor.status_effects.some(s => s.toLowerCase().includes(status.toLowerCase()))) {
                return {
                    valid: false,
                    error: `Must be ${status} to ${context.action}`
                };
            }
        }
    }
    
    return { valid: true };
}

/**
 * Validate equipment requirements
 */
function validate_equipment_requirements(context: ActionValidationContext): ValidationResult {
    const requirements = ACTION_REQUIREMENTS[context.action];
    
    if (requirements.required_equipment && requirements.required_equipment.length > 0) {
        const has_equipment = requirements.required_equipment.some(eq =>
            context.actor.equipment.some(e => e.toLowerCase().includes(eq.toLowerCase()))
        );
        
        if (!has_equipment) {
            return {
                valid: false,
                error: `Missing required equipment for ${context.action}. Need: ${requirements.required_equipment.join(", ")}`
            };
        }
    }
    
    return { valid: true };
}

/**
 * Validate range and visibility
 */
function validate_range_and_visibility(context: ActionValidationContext): ValidationResult {
    const requirements = ACTION_REQUIREMENTS[context.action];
    const warnings: string[] = [];
    
    if (!context.target_state) {
        return { valid: true };
    }
    
    // Check range
    if (requirements.range !== undefined) {
        const distance = calculate_distance(
            context.actor.location,
            context.target_state.location
        );
        
        if (distance > requirements.range) {
            return {
                valid: false,
                error: `Target out of range. Distance: ${distance}, Max: ${requirements.range}`
            };
        }
        
        // Warning if at edge of range
        if (distance === requirements.range) {
            warnings.push("Target at maximum range");
        }
    }
    
    // Check line of sight
    if (requirements.line_of_sight) {
        const has_los = check_line_of_sight(context);
        
        if (!has_los) {
            return {
                valid: false,
                error: "No line of sight to target"
            };
        }
        
        // Check for obscured vision
        if (context.working_memory?.region_conditions.includes("dark") ||
            context.working_memory?.region_conditions.includes("obscured")) {
            warnings.push("Vision obscured - attack may have disadvantage");
        }
    }
    
    return {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined
    };
}

/**
 * Validate action-specific rules
 */
function validate_action_specific_rules(context: ActionValidationContext): ValidationResult {
    switch (context.action) {
        case "ATTACK":
            // Cannot attack self
            if (context.target_ref === context.actor.ref) {
                return {
                    valid: false,
                    error: "Cannot attack yourself"
                };
            }
            break;
            
        case "HELP":
            // Must have a target to help
            if (!context.target_ref) {
                return {
                    valid: false,
                    error: "Must specify who to help"
                };
            }
            break;
            
        case "GRAPPLE":
            // Cannot grapple if target is too large (simplified check)
            if (context.target_state) {
                // Would check size category here
            }
            break;
            
        case "MOVE":
            // Cannot move if already at destination
            if (context.target_state && 
                context.actor.location.x === context.target_state.location.x &&
                context.actor.location.y === context.target_state.location.y) {
                return {
                    valid: false,
                    error: "Already at destination"
                };
            }
            break;
    }
    
    return { valid: true };
}

/**
 * Calculate distance between two points
 */
function calculate_distance(
    a: { x: number; y: number },
    b: { x: number; y: number }
): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check line of sight
 */
function check_line_of_sight(context: ActionValidationContext): boolean {
    if (!context.target_state) return true;
    
    // Simple check - in a full implementation, this would check for obstacles
    // For now, assume LOS exists if in range
    return true;
}

/**
 * Get action cost
 */
export function get_action_cost(action: ActionVerb): ActionCost {
    return ACTION_COSTS[action];
}

/**
 * Check if actor can perform action (quick check)
 */
export function can_perform_action(
    actor: ActorState,
    action: ActionVerb
): boolean {
    const result = validate_action({
        actor,
        action
    });
    return result.valid;
}

/**
 * Get validation error message
 */
export function get_validation_error(context: ActionValidationContext): string | null {
    const result = validate_action(context);
    return result.error || null;
}

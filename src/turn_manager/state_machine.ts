// Turn State Machine
// Manages turn phases and state transitions for timed events

export type TurnPhase = 
    | "INITIATIVE_ROLL"
    | "TURN_START"
    | "ACTION_SELECTION"
    | "ACTION_RESOLUTION"
    | "TURN_END"
    | "EVENT_END_CHECK"
    | "EVENT_END";

export type TurnState = {
    phase: TurnPhase;
    current_turn: number;
    current_actor_ref: string | null;
    initiative_order: string[];
    completed_actors: Set<string>;
    held_actions: Map<string, HeldAction>;
    reactions_queue: Reaction[];
    turn_start_time: string;
    action_start_time?: string;
    
    // Event context
    event_id: string;
    event_type: "combat" | "conversation" | "exploration";
    round_number: number;
    
    // Timing
    turn_duration_limit_ms?: number; // Optional turn timer
    turn_time_remaining_ms?: number;
};

export type HeldAction = {
    actor_ref: string;
    action_verb: string;
    trigger_condition: string;
    priority: number;
    held_at_turn: number;
};

export type Reaction = {
    actor_ref: string;
    action_verb: string;
    target_ref?: string;
    trigger: string;
    priority: number;
    reaction_to_turn: number;
};

// State machine transitions
const VALID_TRANSITIONS: Record<TurnPhase, TurnPhase[]> = {
    "INITIATIVE_ROLL": ["TURN_START"],
    "TURN_START": ["ACTION_SELECTION", "TURN_END"],
    "ACTION_SELECTION": ["ACTION_RESOLUTION", "TURN_END"],
    "ACTION_RESOLUTION": ["TURN_END", "ACTION_SELECTION"], // Can chain actions
    "TURN_END": ["TURN_START", "EVENT_END_CHECK"],
    "EVENT_END_CHECK": ["TURN_START", "EVENT_END"],
    "EVENT_END": [] // Terminal state
};

// In-memory state storage
const turnStates = new Map<string, TurnState>();

/**
 * Initialize turn state for a new timed event
 */
export function initialize_turn_state(
    event_id: string,
    event_type: "combat" | "conversation" | "exploration",
    participants: string[],
    options?: {
        turn_duration_limit_ms?: number;
    }
): TurnState {
    const state: TurnState = {
        phase: "INITIATIVE_ROLL",
        current_turn: 0,
        current_actor_ref: null,
        initiative_order: participants,
        completed_actors: new Set(),
        held_actions: new Map(),
        reactions_queue: [],
        turn_start_time: new Date().toISOString(),
        event_id,
        event_type,
        round_number: 1,
        turn_duration_limit_ms: options?.turn_duration_limit_ms
    };
    
    turnStates.set(event_id, state);
    return state;
}

/**
 * Roll initiative and set turn order
 */
export function roll_initiative(
    state: TurnState,
    initiative_scores: Map<string, number>
): TurnState {
    // Sort by initiative score (highest first)
    state.initiative_order.sort((a, b) => {
        const score_a = initiative_scores.get(a) || 50;
        const score_b = initiative_scores.get(b) || 50;
        return score_b - score_a;
    });
    
    // Handle ties (same initiative score)
    // Keep original order for ties (stable sort)
    
    state.phase = "TURN_START";
    state.current_turn = 1;
    state.current_actor_ref = state.initiative_order[0];
    state.turn_start_time = new Date().toISOString();
    
    return state;
}

/**
 * Transition to next phase
 */
export function transition_phase(
    state: TurnState,
    new_phase: TurnPhase
): { success: boolean; error?: string } {
    // Check if transition is valid
    const valid_transitions = VALID_TRANSITIONS[state.phase];
    if (!valid_transitions.includes(new_phase)) {
        return {
            success: false,
            error: `Invalid transition from ${state.phase} to ${new_phase}`
        };
    }
    
    state.phase = new_phase;
    
    // Phase-specific initialization
    switch (new_phase) {
        case "TURN_START":
            state.turn_start_time = new Date().toISOString();
            if (state.turn_duration_limit_ms) {
                state.turn_time_remaining_ms = state.turn_duration_limit_ms;
            }
            break;
            
        case "ACTION_SELECTION":
            state.action_start_time = new Date().toISOString();
            break;
            
        case "ACTION_RESOLUTION":
            // Action is being resolved
            break;
            
        case "TURN_END":
            // Mark current actor as completed
            if (state.current_actor_ref) {
                state.completed_actors.add(state.current_actor_ref);
            }
            break;
            
        case "EVENT_END_CHECK":
            // Check if all actors have completed
            if (state.completed_actors.size >= state.initiative_order.length) {
                // New round
                state.round_number++;
                state.completed_actors.clear();
                state.current_turn = 1;
                state.current_actor_ref = state.initiative_order[0];
                state.phase = "TURN_START";
            } else {
                // Next actor's turn
                const next_index = state.initiative_order.findIndex(
                    ref => !state.completed_actors.has(ref)
                );
                if (next_index >= 0) {
                    state.current_turn++;
                    state.current_actor_ref = state.initiative_order[next_index];
                    state.phase = "TURN_START";
                }
            }
            break;
            
        case "EVENT_END":
            // Clean up
            turnStates.delete(state.event_id);
            break;
    }
    
    return { success: true };
}

/**
 * Get current turn state
 */
export function get_turn_state(event_id: string): TurnState | undefined {
    return turnStates.get(event_id);
}

/**
 * Check if it's a specific actor's turn
 */
export function is_actor_turn(state: TurnState, actor_ref: string): boolean {
    return state.current_actor_ref === actor_ref && state.phase === "ACTION_SELECTION";
}

/**
 * Hold an action for later use
 */
export function hold_action(
    state: TurnState,
    actor_ref: string,
    action_verb: string,
    trigger_condition: string,
    priority: number = 5
): void {
    const held: HeldAction = {
        actor_ref,
        action_verb,
        trigger_condition,
        priority,
        held_at_turn: state.current_turn
    };
    
    state.held_actions.set(actor_ref, held);
}

/**
 * Release a held action
 */
export function release_held_action(
    state: TurnState,
    actor_ref: string
): HeldAction | undefined {
    const held = state.held_actions.get(actor_ref);
    state.held_actions.delete(actor_ref);
    return held;
}

/**
 * Check for triggered held actions
 */
export function check_held_action_triggers(
    state: TurnState,
    trigger_event: string
): HeldAction[] {
    const triggered: HeldAction[] = [];
    
    for (const held of state.held_actions.values()) {
        // Simple string matching for triggers
        // In a full implementation, this would use more sophisticated matching
        if (trigger_event.toLowerCase().includes(held.trigger_condition.toLowerCase()) ||
            held.trigger_condition.toLowerCase().includes(trigger_event.toLowerCase())) {
            triggered.push(held);
        }
    }
    
    // Sort by priority (highest first)
    triggered.sort((a, b) => b.priority - a.priority);
    
    return triggered;
}

/**
 * Add a reaction to the queue
 */
export function queue_reaction(
    state: TurnState,
    reaction: Omit<Reaction, "reaction_to_turn">
): void {
    const full_reaction: Reaction = {
        ...reaction,
        reaction_to_turn: state.current_turn
    };
    
    state.reactions_queue.push(full_reaction);
    
    // Sort by priority
    state.reactions_queue.sort((a, b) => b.priority - a.priority);
}

/**
 * Get and clear the reactions queue
 */
export function get_reactions(state: TurnState): Reaction[] {
    const reactions = [...state.reactions_queue];
    state.reactions_queue = [];
    return reactions;
}

/**
 * Check if turn timer has expired
 */
export function is_turn_timer_expired(state: TurnState): boolean {
    if (!state.turn_duration_limit_ms || !state.turn_start_time) {
        return false;
    }
    
    const start = new Date(state.turn_start_time).getTime();
    const now = Date.now();
    const elapsed = now - start;
    
    state.turn_time_remaining_ms = Math.max(0, state.turn_duration_limit_ms - elapsed);
    
    return elapsed >= state.turn_duration_limit_ms;
}

/**
 * Get remaining turn time
 */
export function get_turn_time_remaining(state: TurnState): number | undefined {
    if (!state.turn_duration_limit_ms || !state.turn_start_time) {
        return undefined;
    }
    
    const start = new Date(state.turn_start_time).getTime();
    const elapsed = Date.now() - start;
    
    return Math.max(0, state.turn_duration_limit_ms - elapsed);
}

/**
 * Skip an actor's turn
 */
export function skip_turn(state: TurnState, actor_ref: string): void {
    state.completed_actors.add(actor_ref);
    
    // If skipping current actor, move to next
    if (state.current_actor_ref === actor_ref) {
        transition_phase(state, "TURN_END");
    }
}

/**
 * End the timed event
 */
export function end_event(state: TurnState): void {
    state.phase = "EVENT_END";
    turnStates.delete(state.event_id);
}

/**
 * Get turn summary for display
 */
export function get_turn_summary(state: TurnState): {
    round: number;
    turn: number;
    current_actor: string | null;
    phase: TurnPhase;
    completed_count: number;
    total_count: number;
    time_remaining?: number;
} {
    return {
        round: state.round_number,
        turn: state.current_turn,
        current_actor: state.current_actor_ref,
        phase: state.phase,
        completed_count: state.completed_actors.size,
        total_count: state.initiative_order.length,
        time_remaining: get_turn_time_remaining(state)
    };
}

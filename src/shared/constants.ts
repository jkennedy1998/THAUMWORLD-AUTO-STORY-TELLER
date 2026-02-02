// Shared constants for THAUMWORLD Auto Story Teller
// Centralized configuration to prevent drift across services

// Action verbs supported by the system
export const ACTION_VERBS = [
    "USE",
    "ATTACK", 
    "HELP",
    "DEFEND",
    "GRAPPLE",
    "INSPECT",
    "COMMUNICATE",
    "DODGE",
    "CRAFT",
    "SLEEP",
    "REPAIR",
    "MOVE",
    "WORK",
    "GUARD",
    "HOLD"
] as const;

export type ActionVerb = typeof ACTION_VERBS[number];

// Verbs that require a tool argument
export const TOOL_REQUIRED_VERBS: ActionVerb[] = [
    "USE",
    "ATTACK",
    "HELP",
    "DEFEND",
    "GRAPPLE",
    "INSPECT",
    "COMMUNICATE",
    "DODGE",
    "CRAFT",
    "SLEEP",
    "REPAIR",
    "MOVE",
    "WORK",
    "GUARD",
    "HOLD"
];

// Message stages in the pipeline
export const MESSAGE_STAGES = {
    // Input stages
    USER_INPUT: "user_input",
    
    // Processing stages
    INTERPRETED: "interpreted",
    BROKERED: "brokered",
    RULING: "ruling",
    APPLIED: "applied",
    
    // Output stages
    RENDERED: "rendered",
    NPC_RESPONSE: "npc_response"
} as const;

export type MessageStage = typeof MESSAGE_STAGES[keyof typeof MESSAGE_STAGES];

// Message statuses
export const MESSAGE_STATUSES = {
    PENDING: "pending",
    SENT: "sent",
    PROCESSING: "processing",
    DONE: "done",
    ERROR: "error"
} as const;

export type MessageStatus = typeof MESSAGE_STATUSES[keyof typeof MESSAGE_STATUSES];

// Timed event types
export const TIMED_EVENT_TYPES = {
    COMBAT: "combat",
    CONVERSATION: "conversation",
    EXPLORATION: "exploration"
} as const;

export type TimedEventType = typeof TIMED_EVENT_TYPES[keyof typeof TIMED_EVENT_TYPES];

// Action costs
export const ACTION_COSTS = {
    FREE: "FREE",
    FULL: "FULL",
    PARTIAL: "PARTIAL",
    EXTENDED: "EXTENDED"
} as const;

export type ActionCost = typeof ACTION_COSTS[keyof typeof ACTION_COSTS];

// Reference types
export const REFERENCE_TYPES = {
    ACTOR: "actor",
    NPC: "npc",
    ITEM: "item",
    WORLD_TILE: "world_tile",
    REGION_TILE: "region_tile",
    TILE: "tile",
    REGION: "region"
} as const;

export type ReferenceType = typeof REFERENCE_TYPES[keyof typeof REFERENCE_TYPES];

// System effect verbs
export const SYSTEM_EFFECTS = {
    APPLY_DAMAGE: "SYSTEM.APPLY_DAMAGE",
    APPLY_HEAL: "SYSTEM.APPLY_HEAL",
    APPLY_TAG: "SYSTEM.APPLY_TAG",
    REMOVE_TAG: "SYSTEM.REMOVE_TAG",
    ADJUST_INVENTORY: "SYSTEM.ADJUST_INVENTORY",
    ADJUST_RESOURCE: "SYSTEM.ADJUST_RESOURCE",
    ADJUST_STAT: "SYSTEM.ADJUST_STAT",
    SET_AWARENESS: "SYSTEM.SET_AWARENESS",
    ADVANCE_TIME: "SYSTEM.ADVANCE_TIME"
} as const;

// Working memory budgets
export const MEMORY_BUDGETS = {
    MAX_PARTICIPANTS: 20,
    MAX_RECENT_EVENTS: 10,
    MAX_CONVERSATION_HISTORY: 20,
    TTL_SECONDS: 300, // 5 minutes
    ARCHIVE_AFTER_DAYS: 30
} as const;

// Service configuration
export const SERVICE_CONFIG = {
    // Default data slot
    DEFAULT_DATA_SLOT: 1,
    
    // Polling intervals (ms)
    POLL_MS: {
        INTERFACE: 2000,
        INTERPRETER: 800,
        DATA_BROKER: 800,
        RULES_LAWYER: 800,
        STATE_APPLIER: 800,
        RENDERER: 800,
        NPC_AI: 800,
        ROLLER: 800,
        TURN_MANAGER: 500
    },
    
    // Retry configuration
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
    
    // Message limits
    MAX_OUTBOX_MESSAGES: 100,
    MAX_INBOX_MESSAGES: 50,
    MAX_LOG_MESSAGES: 1000,
    
    // Iteration limits
    MAX_INTERPRETER_ITERATIONS: 5,
    MAX_BROKER_ITERATIONS: 5
} as const;

// Debug levels
export const DEBUG_LEVELS = {
    NONE: 0,
    ERRORS: 1,
    WARNINGS: 2,
    INFO: 3,
    VERBOSE: 4,
    TRACE: 5
} as const;

// Default data slot
export const DEFAULT_DATA_SLOT = 1;

// File extensions
export const FILE_EXTENSIONS = {
    JSONC: ".jsonc",
    JSON: ".json",
    LOG: ".log"
} as const;

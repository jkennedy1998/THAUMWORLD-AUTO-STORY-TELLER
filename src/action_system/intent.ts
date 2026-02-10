// Action Intent System
// Unified interface for both Player and NPC actions

import type { ActionVerb, ActionCost } from "../shared/constants.js";
import type { TargetType } from "./registry.js";

// Location reference for spatial awareness
export interface Location {
  world_x: number;
  world_y: number;
  region_x: number;
  region_y: number;
  x?: number;  // Tile coords within region
  y?: number;
  place_id?: string;  // Place system identifier
}

// Action intent status
export type IntentStatus = 
  | "pending"      // Created but not processed
  | "validating"   // Currently validating
  | "validated"    // Passed validation
  | "executing"    // Currently executing
  | "executed"     // Successfully executed
  | "failed";      // Failed at some stage

// Source of the action intent
export type IntentSource = 
  | "player_input"     // From player text input
  | "ui_command"       // From UI button/command
  | "ai_decision"      // From NPC AI
  | "system_trigger"   // From game system
  | "reaction";        // Reactive action (opportunity attack, etc.)

// Main Action Intent interface
export interface ActionIntent {
  // Unique identification
  id: string;
  timestamp: number;
  
  // Actor performing the action
  actorType: "player" | "npc";
  actorRef: string;              // e.g., "actor.player_123" or "npc.glenda"
  actorLocation: Location;       // Where the actor is when acting
  
  // Action details
  verb: ActionVerb;
  actionCost: ActionCost;
  
  // Target (optional based on action type)
  targetRef?: string;            // Resolved target reference
  targetType?: TargetType;       // Type of target
  targetLocation?: Location;     // Where target is
  
  // Tool/Equipment
  toolRef?: string;              // Tool being used
  
  // Additional parameters
  parameters: Record<string, any>;
  
  // Source tracking
  source: IntentSource;
  originalInput?: string;        // Original text for player inputs
  
  // State tracking
  status: IntentStatus;
  failureReason?: string;
  
  // Pipeline tracking
  currentStage?: string;
  stagesCompleted: string[];
}

// Result of action execution
export interface ActionResult {
  success: boolean;
  intentId: string;
  actorRef: string;
  verb: ActionVerb;
  effects: ActionEffect[];
  failureReason?: string;
  summary?: string;              // Human-readable summary
  
  // Perception info
  observedBy: string[];          // Characters who perceived this action
  perceptionRadius: number;
}

// Individual effect from an action
export interface ActionEffect {
  type: string;
  targetRef: string;
  parameters: Record<string, any>;
  applied: boolean;
  error?: string;
}

// Factory for creating action intents
export function createIntent(
  actorRef: string,
  verb: ActionVerb,
  source: IntentSource,
  options: {
    actorType?: "player" | "npc";
    actorLocation?: Location;
    targetRef?: string;
    targetType?: TargetType;
    targetLocation?: Location;
    toolRef?: string;
    actionCost?: ActionCost;
    parameters?: Record<string, any>;
    originalInput?: string;
  } = {}
): ActionIntent {
  const now = Date.now();
  const id = `intent_${now}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Determine actor type from ref
  const actorType = options.actorType ?? (actorRef.startsWith("actor.") ? "player" : "npc");
  
  return {
    id,
    timestamp: now,
    actorType,
    actorRef,
    actorLocation: options.actorLocation ?? { world_x: 0, world_y: 0, region_x: 0, region_y: 0 },
    verb,
    actionCost: options.actionCost ?? "FULL",
    targetRef: options.targetRef,
    targetType: options.targetType,
    targetLocation: options.targetLocation,
    toolRef: options.toolRef,
    parameters: options.parameters ?? {},
    source,
    originalInput: options.originalInput,
    status: "pending",
    stagesCompleted: []
  };
}

// Create intent from player input
export function createPlayerIntent(
  actorRef: string,
  parsed: {
    verb: ActionVerb;
    targetRef?: string;
    toolRef?: string;
    actionCost?: ActionCost;
    parameters?: Record<string, any>;
  },
  uiOverrides: {
    targetRef?: string;
    actionCost?: ActionCost;
    toolRef?: string;
  } = {},
  originalText: string = ""
): ActionIntent {
  // UI overrides take precedence
  const targetRef = uiOverrides.targetRef ?? parsed.targetRef;
  const actionCost = uiOverrides.actionCost ?? parsed.actionCost ?? "FULL";
  const toolRef = uiOverrides.toolRef ?? parsed.toolRef;
  
  return createIntent(actorRef, parsed.verb, "player_input", {
    targetRef,
    actionCost,
    toolRef,
    parameters: parsed.parameters,
    originalInput: originalText
  });
}

// Create intent from NPC AI decision
export function createNPCIntent(
  npcRef: string,
  decision: {
    verb: ActionVerb;
    targetRef?: string;
    targetType?: TargetType;
    toolRef?: string;
    actionCost?: ActionCost;
    parameters?: Record<string, any>;
    priority?: number;
  },
  npcLocation: Location
): ActionIntent {
  return createIntent(npcRef, decision.verb, "ai_decision", {
    actorType: "npc",
    actorLocation: npcLocation,
    targetRef: decision.targetRef,
    targetType: decision.targetType,
    toolRef: decision.toolRef,
    actionCost: decision.actionCost,
    parameters: {
      ...decision.parameters,
      aiPriority: decision.priority ?? 50
    }
  });
}

// Create a reaction intent (opportunity attacks, etc.)
export function createReactionIntent(
  actorRef: string,
  verb: ActionVerb,
  triggerIntentId: string,
  targetRef: string,
  options: {
    actorType?: "player" | "npc";
    actorLocation?: Location;
    toolRef?: string;
  } = {}
): ActionIntent {
  return createIntent(actorRef, verb, "reaction", {
    ...options,
    targetRef,
    actionCost: "FREE",  // Reactions are free
    parameters: {
      triggerIntentId,
      isReaction: true
    }
  });
}

// Helper functions for intent manipulation
export function markIntentFailed(intent: ActionIntent, reason: string): ActionIntent {
  return {
    ...intent,
    status: "failed",
    failureReason: reason
  };
}

export function markIntentStageComplete(intent: ActionIntent, stage: string): ActionIntent {
  return {
    ...intent,
    stagesCompleted: [...intent.stagesCompleted, stage],
    currentStage: undefined
  };
}

export function setIntentStage(intent: ActionIntent, stage: string): ActionIntent {
  return {
    ...intent,
    currentStage: stage
  };
}

// Validation helpers
export function isIntentValid(intent: ActionIntent): boolean {
  return intent.status !== "failed" && !intent.failureReason;
}

export function canIntentProceed(intent: ActionIntent): boolean {
  return ["pending", "validated"].includes(intent.status);
}

// Result factory
export function createActionResult(
  intent: ActionIntent,
  success: boolean,
  effects: ActionEffect[] = [],
  options: {
    failureReason?: string;
    summary?: string;
    observedBy?: string[];
  } = {}
): ActionResult {
  return {
    success,
    intentId: intent.id,
    actorRef: intent.actorRef,
    verb: intent.verb,
    effects,
    failureReason: options.failureReason,
    summary: options.summary ?? (success ? `${intent.verb} succeeded` : `${intent.verb} failed: ${options.failureReason}`),
    observedBy: options.observedBy ?? [],
    perceptionRadius: 0
  };
}

// Effect factory
export function createActionEffect(
  type: string,
  targetRef: string,
  parameters: Record<string, any> = {}
): ActionEffect {
  return {
    type,
    targetRef,
    parameters,
    applied: false
  };
}

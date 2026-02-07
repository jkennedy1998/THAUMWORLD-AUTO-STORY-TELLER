// Action System Integration
// Bridges the unified action system with existing THAUMWORLD infrastructure

import {
  ActionPipeline,
  createActionPipeline,
  createPlayerIntent,
  createNPCIntent,
  createActionResult,
  type ActionIntent,
  type ActionResult,
  type PipelineDependencies,
  type AvailableTarget,
  type Location,
  type ActionEffect,
  getActionDefinition,
  perceptionMemory,
  getRecentPerceptions,
  calculateDistance
} from "../action_system/index.js";

import { load_actor, save_actor } from "../actor_storage/store.js";
import { load_npc, find_npcs, type NpcSearchHit } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { is_timed_event_active, get_timed_event_state, get_region_by_coords } from "../world_storage/store.js";
import { debug_log, debug_warn } from "../shared/debug.js";
import type { ActionVerb, ActionCost } from "../shared/constants.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;

// ============================================================================
// Pipeline Dependencies Implementation
// ============================================================================

/**
 * Creates pipeline dependencies wired to existing storage systems
 */
export function createPipelineDependencies(): PipelineDependencies {
  return {
    // Get available targets from actor/npc storage
    getAvailableTargets: async (location: Location, radius: number) => {
      const targets: AvailableTarget[] = [];
      
      // Get all NPCs
      const npcs = find_npcs(data_slot_number, {});
      
      for (const npc of npcs) {
        // Load full NPC data to get location
        const npc_result = load_npc(data_slot_number, npc.id);
        if (!npc_result.ok || !npc_result.npc) continue;
        
        const npc_loc_data = get_npc_location(npc_result.npc);
        if (!npc_loc_data) continue;
        
        const npc_loc: Location = {
          world_x: npc_loc_data.world_tile?.x ?? 0,
          world_y: npc_loc_data.world_tile?.y ?? 0,
          region_x: npc_loc_data.region_tile?.x ?? 0,
          region_y: npc_loc_data.region_tile?.y ?? 0,
          x: npc_loc_data.tile?.x ?? 0,
          y: npc_loc_data.tile?.y ?? 0
        };
        
        const distance = calculateDistance(location, npc_loc);
        if (distance <= radius) {
          targets.push({
            ref: `npc.${npc.id}`,
            type: "character",
            name: npc.name || npc.id,
            location: npc_loc,
            distance,
            isHostile: false,  // Would check faction system
            isFriendly: false
          });
        }
      }
      
      return targets;
    },
    
    // Get actor location from storage
    getActorLocation: async (actorRef: string) => {
      const actor_id = actorRef.replace(/^actor\./, "");
      const result = load_actor(data_slot_number, actor_id);
      
      if (!result.ok || !result.actor) return null;
      
      const actor = result.actor;
      const loc = actor.location as Record<string, any> | undefined;
      
      if (!loc) return null;
      
      return {
        world_x: (loc.world_tile as any)?.x ?? 0,
        world_y: (loc.world_tile as any)?.y ?? 0,
        region_x: (loc.region_tile as any)?.x ?? 0,
        region_y: (loc.region_tile as any)?.y ?? 0,
        x: loc.x ?? 0,
        y: loc.y ?? 0
      };
    },
    
    // Check if actor is aware of target
    checkActorAwareness: async (actorRef: string, targetRef: string) => {
      // TODO: Implement awareness system check
      // For now, assume everyone is aware of everyone in the same place
      return true;
    },
    
    // Check if actor can afford action cost
    checkActionCost: async (actorRef: string, cost: ActionCost) => {
      // Only relevant during timed events (combat)
      if (!is_timed_event_active(data_slot_number)) return true;
      
      const actor_id = actorRef.replace(/^actor\./, "");
      const result = load_actor(data_slot_number, actor_id);
      
      if (!result.ok || !result.actor) return false;
      
      // Check action points/resources
      // TODO: Implement action point system
      return true;
    },
    
    // Consume action cost
    consumeActionCost: async (actorRef: string, cost: ActionCost) => {
      if (!is_timed_event_active(data_slot_number)) return true;

      const actor_id = actorRef.replace(/^actor\./, "");
      const result = load_actor(data_slot_number, actor_id);

      if (!result.ok || !result.actor) return false;

      // TODO: Consume action points
      return true;
    },

    // Get actor data for tool validation
    getActorData: async (actorRef: string) => {
      const actor_id = actorRef.replace(/^actor\./, "");
      const result = load_actor(data_slot_number, actor_id);

      if (!result.ok || !result.actor) return null;

      const actor = result.actor;
      return {
        ref: actorRef,
        body_slots: actor.body_slots as Record<string, { name: string; critical?: boolean; item?: string | { ref: string; name: string; mag: number; tags: string[] } }> | undefined,
        hand_slots: actor.hand_slots as Record<string, string> | undefined,
        inventory: actor.inventory as Record<string, unknown> | undefined
      };
    },

    // Execute effects
    executeEffect: async (effect: ActionEffect) => {
      debug_log("ActionSystem", `Executing effect: ${effect.type}`, effect);
      
      // Route to appropriate effect handler
      switch (effect.type) {
        case "APPLY_DAMAGE":
          return await executeApplyDamage(effect);
        case "APPLY_HEAL":
          return await executeApplyHeal(effect);
        case "SET_AWARENESS":
          return await executeSetAwareness(effect);
        case "SET_OCCUPANCY":
          return await executeSetOccupancy(effect);
        case "INSPECT":
          return await executeInspect(effect);
        default:
          debug_warn("ActionSystem", `Unknown effect type: ${effect.type}`);
          return false;
      }
    },
    
    // Check if in combat
    isInCombat: () => {
      return is_timed_event_active(data_slot_number);
    },
    
    // Get whose turn it is
    getCurrentActor: () => {
      const state = get_timed_event_state(data_slot_number);
      return (state as any)?.current_actor || (state as any)?.current_turn || null;
    },
    
    // Logging
    log: (message: string, data?: any) => {
      debug_log("ActionPipeline", message, data);
    }
  };
}

// ============================================================================
// Effect Handlers
// ============================================================================

async function executeApplyDamage(effect: ActionEffect): Promise<boolean> {
  const { amount } = effect.parameters;
  debug_log("ActionSystem", `Applying damage`, effect.parameters);
  
  // TODO: Implement actual damage application
  // Load target, apply damage, check for death, etc.
  
  return true;
}

async function executeApplyHeal(effect: ActionEffect): Promise<boolean> {
  debug_log("ActionSystem", `Healing`, effect.parameters);
  
  // TODO: Implement healing
  
  return true;
}

async function executeSetAwareness(effect: ActionEffect): Promise<boolean> {
  const { target, of } = effect.parameters;
  debug_log("ActionSystem", `${target} is now aware of ${of}`);
  
  // TODO: Update awareness tracking
  
  return true;
}

async function executeSetOccupancy(effect: ActionEffect): Promise<boolean> {
  const { actor, location } = effect.parameters;
  debug_log("ActionSystem", `Moving ${actor} to ${location}`);
  
  // TODO: Update actor location
  
  return true;
}

async function executeInspect(effect: ActionEffect): Promise<boolean> {
  const { inspector, target, requested_keywords, max_features } = effect.parameters;
  debug_log("ActionSystem", `Inspecting ${target}`, { inspector, requested_keywords });
  
  // TODO: Load inspector data (senses, stats, location)
  // TODO: Load target data
  // TODO: Call inspect_target() from data_service
  // TODO: Store/display result
  
  return true;
}

// ============================================================================
// Singleton Pipeline Instance
// ============================================================================

let pipelineInstance: ActionPipeline | null = null;

export function getActionPipeline(): ActionPipeline {
  if (!pipelineInstance) {
    const deps = createPipelineDependencies();
    pipelineInstance = createActionPipeline(deps, {
      debug: process.env.DEBUG_ACTIONS === "true",
      enablePerception: true,
      enableValidation: true,
      enableCostCheck: true,
      enableRulesCheck: true
    });
    debug_log("ActionSystem", "ActionPipeline initialized");
  }
  return pipelineInstance;
}

// ============================================================================
// Player Action Integration
// ============================================================================

/**
 * Process player action through the unified pipeline
 * Called from UI when player submits an action
 */
export async function processPlayerAction(
  actorRef: string,
  text: string,
  uiContext: {
    targetRef?: string;
    actionCost?: ActionCost;
    intentVerb?: ActionVerb;
    actorLocation?: Location;
  }
): Promise<ActionResult> {
  const pipeline = getActionPipeline();
  
  // Parse the intent from text + UI overrides
  const parsedVerb = uiContext.intentVerb || inferVerbFromText(text);
  
  // Get actor location if not provided
  let actorLocation = uiContext.actorLocation;
  if (!actorLocation) {
    const loc = await createPipelineDependencies().getActorLocation(actorRef);
    if (loc) actorLocation = loc;
  }
  
  if (!actorLocation) {
    const failedIntent: ActionIntent = { 
      id: `failed_${Date.now()}`, 
      timestamp: Date.now(), 
      actorType: "player", 
      actorRef, 
      actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0 },
      verb: parsedVerb, 
      actionCost: uiContext.actionCost || "FULL", 
      parameters: {}, 
      source: "player_input", 
      status: "failed", 
      stagesCompleted: [] 
    };
    return createActionResult(
      failedIntent,
      false,
      [],
      { failureReason: "Could not determine actor location" }
    );
  }
  
  // Create the intent
  const intent = createPlayerIntent(
    actorRef,
    {
      verb: parsedVerb,
      targetRef: uiContext.targetRef,
      toolRef: `${actorRef}.hands`,  // Default tool
      actionCost: uiContext.actionCost || "FULL",
      parameters: {
        text: text,
        uiSelectedTarget: uiContext.targetRef
      }
    },
    {
      targetRef: uiContext.targetRef,
      actionCost: uiContext.actionCost,
      toolRef: `${actorRef}.hands`
    },
    text
  );
  
  // Override location
  (intent as any).actorLocation = actorLocation;
  
  // Process through pipeline
  debug_log("ActionSystem", `Processing player action: ${parsedVerb}`, { actor: actorRef, text });
  const result = await pipeline.process(intent);
  
  return result;
}

// Simple verb inference from text
function inferVerbFromText(text: string): ActionVerb {
  const lowered = text.toLowerCase();
  
  if (/\b(attack|hit|strike|stab|shoot|punch|slash)\b/.test(lowered)) return "ATTACK";
  if (/\b(say|ask|tell|speak|talk|hello|hi|hey|greet)\b/.test(lowered)) return "COMMUNICATE";
  if (/\b(move|go|walk|run|travel|head|approach|enter)\b/.test(lowered)) return "MOVE";
  if (/\b(use|equip|wield|wear|consume)\b/.test(lowered)) return "USE";
  if (/\b(help|assist|aid)\b/.test(lowered)) return "HELP";
  if (/\b(defend|block|parry)\b/.test(lowered)) return "DEFEND";
  if (/\b(grapple|grab|wrestle)\b/.test(lowered)) return "GRAPPLE";
  if (/\b(inspect|look|examine|search|check)\b/.test(lowered)) return "INSPECT";
  if (/\b(dodge|evade|duck)\b/.test(lowered)) return "DODGE";
  if (/\b(craft|make|build|forge)\b/.test(lowered)) return "CRAFT";
  if (/\b(sleep|rest|nap)\b/.test(lowered)) return "SLEEP";
  if (/\b(repair|fix|mend)\b/.test(lowered)) return "REPAIR";
  if (/\b(work|labor)\b/.test(lowered)) return "WORK";
  if (/\b(guard|watch)\b/.test(lowered)) return "GUARD";
  if (/\b(hold|ready|prepare)\b/.test(lowered)) return "HOLD";
  
  return "COMMUNICATE";  // Default
}

// ============================================================================
// NPC Action Integration
// ============================================================================

/**
 * Process NPC action through the unified pipeline
 * Called when NPC AI decides to take an action
 */
export async function processNPCAction(
  npcRef: string,
  decision: {
    verb: ActionVerb;
    targetRef?: string;
    toolRef?: string;
    priority: number;
    parameters?: Record<string, any>;
  }
): Promise<ActionResult> {
  const pipeline = getActionPipeline();
  
  // Get NPC location
  const npc_id = npcRef.replace(/^npc\./, "");
  const npc_result = load_npc(data_slot_number, npc_id);
  
  if (!npc_result.ok || !npc_result.npc) {
    const failedIntent: ActionIntent = { 
      id: `failed_${Date.now()}`, 
      timestamp: Date.now(), 
      actorType: "npc", 
      actorRef: npcRef,
      actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0 },
      verb: decision.verb, 
      actionCost: "FULL", 
      parameters: {}, 
      source: "ai_decision", 
      status: "failed", 
      stagesCompleted: [] 
    };
    return createActionResult(
      failedIntent,
      false,
      [],
      { failureReason: "NPC not found" }
    );
  }
  
  const location_data = get_npc_location(npc_result.npc);
  const npcLocation: Location = location_data ? {
    world_x: location_data.world_tile?.x ?? 0,
    world_y: location_data.world_tile?.y ?? 0,
    region_x: location_data.region_tile?.x ?? 0,
    region_y: location_data.region_tile?.y ?? 0,
    x: location_data.tile?.x ?? 0,
    y: location_data.tile?.y ?? 0
  } : { world_x: 0, world_y: 0, region_x: 0, region_y: 0 };
  
  // Create the intent
  const intent = createNPCIntent(
    npcRef,
    {
      verb: decision.verb,
      targetRef: decision.targetRef,
      toolRef: decision.toolRef,
      priority: decision.priority,
      parameters: decision.parameters
    },
    npcLocation
  );
  
  // Process through pipeline
  debug_log("ActionSystem", `Processing NPC action: ${decision.verb}`, { npc: npcRef });
  const result = await pipeline.process(intent);
  
  return result;
}

// ============================================================================
// Perception Integration
// ============================================================================

/**
 * Check if NPC should react to recent perceptions
 * Returns an action decision if they should react
 */
export function checkNPCPerceptionReactions(
  npcRef: string,
  personality: {
    aggression: number;
    caution: number;
    curiosity: number;
  }
): { verb: ActionVerb; targetRef?: string; priority: number } | null {
  // Get recent perceptions
  const recent = getRecentPerceptions(npcRef, {
    since: Date.now() - 30000  // Last 30 seconds
  });
  
  // Check for combat
  const combatEvents = recent.filter(p => 
    p.verb === "ATTACK" && p.threatLevel > 50
  );
  
  if (combatEvents.length > 0) {
    const event = combatEvents[combatEvents.length - 1];
    
    if (personality.caution > 60) {
      // Flee from combat
      return {
        verb: "MOVE",
        targetRef: "away_from_combat",  // Would calculate safe location
        priority: 90
      };
    }
    
    if (personality.aggression > 70 && event && event.targetRef) {
      // Join combat against the target
      return {
        verb: "ATTACK",
        targetRef: event.targetRef,
        priority: 85
      };
    }
  }
  
  // Check for suspicious activity
  const suspiciousEvents = recent.filter(p => 
    p.actorVisibility === "obscured" || p.verb === "MOVE"
  );
  
  if (suspiciousEvents.length > 0 && personality.curiosity > 50) {
    return {
      verb: "INSPECT",
      targetRef: suspiciousEvents[suspiciousEvents.length - 1]?.actorRef,
      priority: 50
    };
  }
  
  return null;
}

// ============================================================================
// Adapter for Existing Message Pipeline
// ============================================================================

/**
 * Adapter to process brokered messages through the action pipeline
 * This allows gradual migration from the existing message-based system
 */
export async function processBrokeredCommand(
  actorRef: string,
  command: {
    verb: ActionVerb;
    args: Record<string, any>;
    target?: string;
    tool?: string;
  }
): Promise<ActionResult> {
  const pipeline = getActionPipeline();
  
  // Get actor info
  const deps = createPipelineDependencies();
  const location = await deps.getActorLocation(actorRef);
  
  if (!location) {
    const failedIntent: ActionIntent = { 
      id: `failed_${Date.now()}`, 
      timestamp: Date.now(), 
      actorType: "player", 
      actorRef,
      actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0 },
      verb: command.verb, 
      actionCost: "FULL", 
      parameters: {}, 
      source: "system_trigger", 
      status: "failed", 
      stagesCompleted: [] 
    };
    return createActionResult(
      failedIntent,
      false,
      [],
      { failureReason: "Actor location not found" }
    );
  }
  
  // Create intent
  const intent = createPlayerIntent(
    actorRef,
    {
      verb: command.verb,
      targetRef: command.target,
      toolRef: command.tool,
      actionCost: command.args.action_cost || "FULL",
      parameters: command.args
    },
    {},
    ""
  );
  
  (intent as any).actorLocation = location;
  
  return await pipeline.process(intent);
}

// Export the perception memory for NPC AI usage
export { perceptionMemory, getRecentPerceptions };

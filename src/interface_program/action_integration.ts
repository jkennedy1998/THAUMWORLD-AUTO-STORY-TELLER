// Action System Integration
// Simplified interface for Interface Program to use ActionPipeline

import { ActionPipeline, type ActionIntent, type ActionResult } from "../action_system/index.js";
import { load_actor } from "../actor_storage/store.js";
import { find_npcs, load_npc } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { debug_log, debug_warn } from "../shared/debug.js";

let pipeline: ActionPipeline | null = null;

/**
 * Create dependencies for the Action Pipeline
 * These connect the pipeline to game storage
 */
function createPipelineDependencies(dataSlot: number) {
  return {
    // Get available targets at a location
    getAvailableTargets: async (location: any, radius: number) => {
      // TODO: Implement proper target resolution
      return [];
    },
    
    // Get actor location
    getActorLocation: async (actorRef: string) => {
      if (actorRef.startsWith("actor.")) {
        const actor = load_actor(dataSlot, actorRef.replace("actor.", ""));
        if (actor.ok && actor.actor) {
          const loc = actor.actor.location as any;
          return {
            world_x: loc?.world_x ?? 0,
            world_y: loc?.world_y ?? 0,
            region_x: loc?.region_x ?? 0,
            region_y: loc?.region_y ?? 0
          };
        }
      }
      return null;
    },
    
    // Check if actor is aware of target
    checkActorAwareness: async (actorRef: string, targetRef: string) => {
      // TODO: Implement awareness check
      return true; // Default to aware for now
    },
    
    // Check if actor can afford action cost
    checkActionCost: async (actorRef: string, cost: any) => {
      // TODO: Implement action cost check
      return true; // Default to affordable for now
    },
    
    // Consume action cost
    consumeActionCost: async (actorRef: string, cost: any) => {
      // TODO: Implement action cost consumption
      return true; // Default to success for now
    },
    
    // Get actor data for tool validation
    getActorData: async (actorRef: string) => {
      if (actorRef.startsWith("actor.")) {
        const result = load_actor(dataSlot, actorRef.replace("actor.", ""));
        if (result.ok && result.actor) {
          const actor = result.actor as any;
          return {
            ref: actorRef,
            body_slots: actor.body_slots as Record<string, any> | undefined,
            hand_slots: actor.hand_slots as Record<string, string> | undefined,
            inventory: actor.inventory as Record<string, unknown> | undefined
          };
        }
      }
      return null;
    },
    
    // Execute effect
    executeEffect: async (effect: any) => {
      // TODO: Implement effect execution
      debug_log("ActionPipeline", "Executing effect", effect);
      return true;
    },
    
    // Combat checks
    isInCombat: () => false,
    getCurrentActor: () => null,
    
    // Logging
    log: (message: string, data?: any) => {
      debug_log("ActionPipeline", message, data);
    }
  };
}

/**
 * Initialize the Action Pipeline with dependencies
 */
export function initializeActionPipeline(dataSlot: number): ActionPipeline {
  if (pipeline) return pipeline;
  
  const deps = createPipelineDependencies(dataSlot);
  pipeline = new ActionPipeline(deps, {
    enablePerception: true,
    enableValidation: true,
    enableCostCheck: false, // Disabled until implemented
    enableRulesCheck: true,
    requireAwareness: false, // Disabled until implemented
    debug: process.env.DEBUG_ACTIONS === "1"
  });
  
  debug_log("ActionPipeline", "Initialized", { dataSlot });
  return pipeline;
}

/**
 * Process a player action through the ActionPipeline
 * Returns the result of the action
 */
export async function processPlayerAction(
  dataSlot: number,
  intent: ActionIntent
): Promise<ActionResult> {
  const actionPipeline = initializeActionPipeline(dataSlot);
  
  debug_log("ActionPipeline", "Processing player action", {
    verb: intent.verb,
    actor: intent.actorRef,
    target: intent.targetRef
  });
  
  try {
    const result = await actionPipeline.process(intent);
    
    debug_log("ActionPipeline", "Action completed", {
      success: result.success,
      verb: intent.verb,
      effectsCount: result.effects.length
    });
    
    return result;
  } catch (error) {
    debug_warn("ActionPipeline", "Action failed", {
      verb: intent.verb,
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Return a failure result
    return {
      success: false,
      intentId: intent.id,
      actorRef: intent.actorRef,
      verb: intent.verb,
      effects: [],
      failureReason: error instanceof Error ? error.message : "Pipeline error",
      observedBy: [],
      perceptionRadius: 0
    };
  }
}

/**
 * Check if ActionPipeline should handle this command
 * Returns true for simple commands that don't need LLM interpretation
 */
export function shouldUseActionPipeline(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  
  // List of action verbs that ActionPipeline handles well
  const actionPatterns = [
    /^(move|go|walk)\s+/,
    /^(say|shout|yell|whisper)\s+/,
    /^(attack|hit|strike|shoot)\s+/,
    /^(look|inspect|examine)\s*/,
    /^(use|activate)\s+/,
    /^help\s*/,
    /^(north|south|east|west|up|down)$/,
  ];
  
  return actionPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Format action result for display
 */
export function formatActionResult(result: ActionResult): string {
  if (!result.success) {
    return `Failed: ${result.failureReason || "Unknown error"}`;
  }
  
  if (result.summary) {
    return result.summary;
  }
  
  // Build summary from effects
  const effectDescriptions = result.effects
    .filter(e => e.applied)
    .map(e => {
      switch (e.type) {
        case "DAMAGE": return `dealt ${e.parameters.damage} damage to ${e.targetRef}`;
        case "HEAL": return `healed ${e.parameters.amount} HP for ${e.targetRef}`;
        case "MOVE": return `moved to ${e.parameters.destination}`;
        case "COMMUNICATE": return `said "${e.parameters.message}"`;
        case "EQUIP": return `equipped ${e.parameters.item}`;
        default: return `${e.type} on ${e.targetRef}`;
      }
    });
  
  if (effectDescriptions.length > 0) {
    return effectDescriptions.join("; ");
  }
  
  return "Action completed successfully";
}

// Action System Integration
// Simplified interface for Interface Program to use ActionPipeline

import { ActionPipeline, type ActionIntent, type ActionResult } from "../action_system/index.js";
import { load_actor } from "../actor_storage/store.js";
import { find_npcs, load_npc } from "../npc_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { getAvailableTargets } from "../action_system/target_resolution.js";
import { debug_log, debug_warn } from "../shared/debug.js";
import { can_actor_afford_action_cost, can_actor_afford_movement_cost, consume_actor_action_cost, consume_actor_movement_cost, finalize_timed_event_turn_if_exhausted, get_active_actor_ref, is_timed_event_active } from "../world_storage/store.js";

let pipeline: ActionPipeline | null = null;

/**
 * Create dependencies for the Action Pipeline
 * These connect the pipeline to game storage
 */
function createPipelineDependencies(dataSlot: number) {
  const classifyUseCost = (intent: ActionIntent | undefined): "movement" | "action" => {
    if (!intent || intent.verb !== "USE") return "action";

    const subtype = String(intent.parameters?.subtype ?? "").toUpperCase();
    if (subtype === "IMPACT_SINGLE" || subtype === "PROJECTILE_SINGLE") return "action";

    const original = String(intent.originalInput ?? "").toLowerCase();
    if (/\b(attack|hit|strike|stab|shoot|throw at|harm|injure|damage|kill|punch|slash|swing)\b/.test(original)) {
      return "action";
    }

    if (/\b(pick up|pickup|drop|equip|unequip|wear|wield|put on|take off|transfer|move item|stash|store|withdraw|deposit|press|push|pull|open|close|activate|use|drink|eat|consume|light|ignite)\b/.test(original)) {
      return "movement";
    }

    return "movement";
  };

  return {
    // Get available targets at a location
    getAvailableTargets: async (location: any, radius: number) => {
      // Use the shared target resolution system
      return getAvailableTargets(location, radius);
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
            region_y: loc?.region_y ?? 0,
            x: loc?.tile?.x ?? loc?.x,
            y: loc?.tile?.y ?? loc?.y,
            place_id: loc?.place_id
          };
        }
      }
      return null;
    },
    
    // Check if actor is aware of target
    checkActorAwareness: async (actorRef: string, targetRef: string) => {
      // Not implemented: awareness gating.
      // Current behavior assumes awareness is handled elsewhere (or always true).
      return true; // Default to aware for now
    },
    
    // Check if actor can afford action cost
    checkActionCost: async (actorRef: string, cost: any, intent?: ActionIntent) => {
      if (!is_timed_event_active(dataSlot)) return true;

      if (intent?.verb === "USE" && classifyUseCost(intent) === "movement") {
        return can_actor_afford_movement_cost(dataSlot, actorRef, 1);
      }

      return can_actor_afford_action_cost(dataSlot, actorRef, cost);
    },
    
    // Consume action cost
    consumeActionCost: async (actorRef: string, cost: any, intent?: ActionIntent) => {
      if (!is_timed_event_active(dataSlot)) return true;

      if (intent?.verb === "USE" && classifyUseCost(intent) === "movement") {
        const ok = consume_actor_movement_cost(dataSlot, actorRef, 1);
        if (ok) void finalize_timed_event_turn_if_exhausted(dataSlot, actorRef);
        return ok;
      }

      const ok = consume_actor_action_cost(dataSlot, actorRef, cost);
      if (ok) void finalize_timed_event_turn_if_exhausted(dataSlot, actorRef);
      return ok;
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
      // Not implemented: persistent effect execution.
      // The ActionPipeline currently provides validation + perception/witness hooks;
      // state mutations are handled by other systems.
      debug_log("ActionPipeline", "Executing effect", effect);
      return true;
    },
    
    // Combat checks
    isInCombat: () => is_timed_event_active(dataSlot),
    getCurrentActor: () => get_active_actor_ref(dataSlot),
    
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
    enableCostCheck: true,
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
    
    // If this is a successful COMMUNICATE action with a target, immediately face the target.
    // This provides immediate feedback before the NPC_AI service processes the witness event.
    if (result.success && intent.verb === "COMMUNICATE" && intent.targetRef && intent.targetRef.startsWith("npc.")) {
      const { send_face_command } = await import("../npc_ai/movement_command_sender.js");
      send_face_command(intent.targetRef, intent.actorRef, "Face speaker immediately on communication");
      debug_log("ActionPipeline", "Sent immediate face command", { npc: intent.targetRef, actor: intent.actorRef });
    }

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

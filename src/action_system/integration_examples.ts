// Integration Examples for Action System
// This file shows how to integrate the unified action system into existing code

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
  type Location
} from "./index.js";

// ============================================================================
// EXAMPLE 1: UI Integration (app_state.ts)
// ============================================================================

/**
 * Example integration in canvas_app/app_state.ts
 * 
 * Replace the current processPlayerInput with this:
 */
export async function exampleUIIntegration() {
  // Create pipeline dependencies
  const pipelineDeps: PipelineDependencies = {
    // Get available targets from actor/npc storage
    getAvailableTargets: async (location: Location, radius: number) => {
      // Query your existing storage system
      // Example:
      // const npcs = await npc_storage.getInRange(location, radius);
      // const actors = await actor_storage.getInRange(location, radius);
      // return [...npcs, ...actors];
      return [];
    },
    
    // Get actor location
    getActorLocation: async (actorRef: string) => {
      // Load from your storage
      // Example:
      // const actor = await load_actor(data_slot, actorId);
      // return actor.location;
      return null;
    },
    
    // Check awareness
    checkActorAwareness: async (actorRef: string, targetRef: string) => {
      // Check your awareness system
      return true;
    },
    
    // Check action cost
    checkActionCost: async (actorRef: string, cost: string) => {
      // Check if actor can afford action during combat
      return true;
    },
    
    // Consume action cost
    consumeActionCost: async (actorRef: string, cost: string) => {
      // Consume the action cost
      return true;
    },

    // Get actor data for tool validation
    getActorData: async (actorRef: string) => {
      // Load actor data from storage for tool validation
      // Should return: { ref, body_slots, hand_slots, inventory }
      // Example:
      // const actor = await load_actor(data_slot, actorId);
      // return {
      //   ref: actorRef,
      //   body_slots: actor.body_slots,
      //   hand_slots: actor.hand_slots,
      //   inventory: actor.inventory
      // };
      return null;
    },

    // Execute effects
    executeEffect: async (effect) => {
      // Apply the effect to game state
      // This would call your existing state applier
      console.log(`Executing effect: ${effect.type} on ${effect.targetRef}`);
      return true;
    },
    
    // Combat checks
    isInCombat: () => {
      // Check if combat is active
      return false;
    },
    
    getCurrentActor: () => {
      // Get whose turn it is
      return null;
    },
    
    // Logging
    log: (message: string, data?: any) => {
      if (process.env.DEBUG_ACTIONS) {
        console.log(`[ActionPipeline] ${message}`, data);
      }
    }
  };
  
  // Create the pipeline
  const pipeline = createActionPipeline(pipelineDeps, {
    debug: true,
    enablePerception: true,
    enableValidation: true
  });
  
  // Example: Process player input
  async function processPlayerInput(
    text: string,
    actorRef: string,
    uiOverrides: {
      targetRef?: string;
      actionCost?: string;
      intentVerb?: string;
    }
  ): Promise<ActionResult> {
    // Step 1: Parse with interpreter (existing code)
    const parsed = {
      verb: (uiOverrides.intentVerb || "COMMUNICATE") as any,
      targetRef: uiOverrides.targetRef,
      toolRef: `${actorRef}.hands`,
      actionCost: (uiOverrides.actionCost || "FULL") as any,
      parameters: {
        text: text,
        uiSelectedTarget: uiOverrides.targetRef
      }
    };
    
    // Step 2: Create intent
    const intent = createPlayerIntent(
      actorRef,
      parsed,
      uiOverrides as any,
      text
    );
    
    // Step 3: Process through pipeline
    const result = await pipeline.process(intent);
    
    // Step 4: Handle result
    if (result.success) {
      console.log("Action succeeded:", result.summary);
      // Flash success message
      // Update UI
    } else {
      console.log("Action failed:", result.failureReason);
      // Flash error message
    }
    
    return result;
  }
  
  return { pipeline, processPlayerInput };
}

// ============================================================================
// EXAMPLE 2: NPC AI Integration
// ============================================================================

/**
 * Example integration in npc_ai/main.ts
 * 
 * Modify the NPC decision processing to use the pipeline:
 */
export async function exampleNPCIntegration() {
  const pipelineDeps: PipelineDependencies = {
    getAvailableTargets: async (location, radius) => {
      // Query nearby entities
      return [];
    },
    
    getActorLocation: async (npcRef) => {
      // Load NPC location from storage
      return null;
    },
    
    checkActorAwareness: async (npcRef, targetRef) => {
      // Check NPC awareness
      return true;
    },
    
    checkActionCost: async () => true,
    consumeActionCost: async () => true,

    getActorData: async (npcRef) => {
      // Load NPC data from storage for tool validation
      return null;
    },

    executeEffect: async (effect) => {
      console.log(`[NPC] Executing: ${effect.type}`);
      return true;
    },
    
    isInCombat: () => false,
    getCurrentActor: () => null,
    
    log: (msg, data) => console.log(`[NPC] ${msg}`, data)
  };
  
  const pipeline = createActionPipeline(pipelineDeps);
  
  // Example: Process NPC turn
  async function processNPCTurn(
    npcRef: string,
    npcDecision: {
      verb: string;
      targetRef?: string;
      priority: number;
    },
    npcLocation: Location
  ): Promise<ActionResult> {
    // Create intent from NPC AI decision
    const intent = createNPCIntent(
      npcRef,
      {
        verb: npcDecision.verb as any,
        targetRef: npcDecision.targetRef,
        priority: npcDecision.priority,
        parameters: {
          aiPriority: npcDecision.priority
        }
      },
      npcLocation
    );
    
    // Process through pipeline (same as players!)
    const result = await pipeline.process(intent);
    
    return result;
  }
  
  return { pipeline, processNPCTurn };
}

// ============================================================================
// EXAMPLE 3: Processing Multiple NPCs (Round-based)
// ============================================================================

import { processBatch } from "./index.js";

export async function exampleRoundProcessing() {
  const { pipeline } = await exampleNPCIntegration();
  
  // Process all NPCs in parallel
  async function processRound(npcDecisions: Array<{
    npcRef: string;
    decision: { verb: string; targetRef?: string; priority: number };
    location: Location;
  }>) {
    // Convert decisions to intents
    const intents: ActionIntent[] = npcDecisions.map(({ npcRef, decision, location }) =>
      createNPCIntent(npcRef, {
        verb: decision.verb as any,
        targetRef: decision.targetRef,
        priority: decision.priority
      }, location)
    );
    
    // Process all at once
    const results = await processBatch(pipeline, intents, {
      respectOrder: false,  // Parallel processing
      onProgress: (completed, total) => {
        console.log(`Processed ${completed}/${total} NPCs`);
      }
    });
    
    // Check results
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`Round complete: ${successful.length} succeeded, ${failed.length} failed`);
    
    return results;
  }
  
  return { processRound };
}

// ============================================================================
// EXAMPLE 4: Perception-based NPC Reactions
// ============================================================================

import { perceptionMemory, getRecentPerceptions } from "./index.js";

export async function examplePerceptionReactions() {
  /**
   * Example: NPC responds to observed combat
   */
  function checkForCombatResponse(npcRef: string, personality: {
    aggression: number;
    caution: number;
  }) {
    // Get recent perceptions
    const recent = getRecentPerceptions(npcRef, {
      since: Date.now() - 30000,  // Last 30 seconds
      minThreat: 50
    });
    
    // Check if NPC observed combat
    const combatObserved = recent.some(p => 
      p.verb === "ATTACK" && p.actorVisibility !== "obscured"
    );
    
    if (combatObserved && personality.caution > 60) {
      // Cautious NPC flees or hides
      return {
        verb: "MOVE",
        targetRef: "safe_location",  // Would be calculated
        priority: 90
      };
    }
    
    if (combatObserved && personality.aggression > 70) {
      // Aggressive NPC joins combat
      return {
        verb: "ATTACK",
        targetRef: recent[0]?.targetRef,  // Attack the target
        priority: 85
      };
    }
    
    return null;
  }
  
  /**
   * Example: NPC investigates suspicious activity
   */
  function checkForInvestigation(npcRef: string, personality: {
    curiosity: number;
  }) {
    // Look for vague/obscured actions
    const vagueObservations = getRecentPerceptions(npcRef, {
      since: Date.now() - 60000  // Last minute
    }).filter(p => p.actorVisibility === "obscured" || p.actorVisibility === "vague");
    
    if (vagueObservations.length > 0 && personality.curiosity > 50) {
      // Move to investigate
      const lastObservation = vagueObservations[vagueObservations.length - 1];
      if (!lastObservation) return null;
      return {
        verb: "MOVE",
        targetRef: `tile.${lastObservation.location.world_x}.${lastObservation.location.world_y}.${lastObservation.location.region_x}.${lastObservation.location.region_y}`,
        priority: 60
      };
    }
    
    return null;
  }
  
  return { checkForCombatResponse, checkForInvestigation };
}

// ============================================================================
// EXAMPLE 5: Reaction System (Opportunity Attacks)
// ============================================================================

import { createReactionIntent } from "./index.js";

export async function exampleReactionSystem() {
  const { pipeline } = await exampleUIIntegration();
  
  /**
   * Example: Trigger opportunity attack when enemy moves away
   */
  async function checkOpportunityAttack(
    observerRef: string,
    movingActorRef: string,
    observerLocation: Location,
    movingActorLocation: Location
  ) {
    // Check if they're adjacent
    const distance = Math.sqrt(
      Math.pow(observerLocation.x! - movingActorLocation.x!, 2) +
      Math.pow(observerLocation.y! - movingActorLocation.y!, 2)
    );
    
    if (distance > 1.5) return null;  // Not adjacent
    
    // Check if observer is hostile to moving actor
    // (would check faction/hostility system)
    const isHostile = true;
    
    if (isHostile) {
      // Create reaction intent
      const reaction = createReactionIntent(
        observerRef,
        "ATTACK",  // Opportunity attack
        `move_${movingActorRef}_${Date.now()}`,  // Trigger intent ID
        movingActorRef,
        {
          actorLocation: observerLocation
        }
      );
      
      // Process immediately
      const result = await pipeline.process(reaction);
      
      return result;
    }
    
    return null;
  }
  
  return { checkOpportunityAttack };
}

// ============================================================================
// MIGRATION GUIDE
// ============================================================================

/**
 * Steps to migrate existing code:
 * 
 * 1. **Create Pipeline Dependencies** (one-time setup)
 *    - Implement all required dependency functions
 *    - Wire up to your existing storage systems
 * 
 * 2. **UI Migration** (src/canvas_app/app_state.ts)
 *    - Find where player input is processed
 *    - Replace interpreter/data_broker/rules_lawyer calls
 *    - Use createPlayerIntent + pipeline.process()
 *    - Handle ActionResult instead of multiple message stages
 * 
 * 3. **NPC Migration** (src/npc_ai/main.ts)
 *    - Find where NPC actions are executed
 *    - Use createNPCIntent + pipeline.process()
 *    - NPCs now go through same validation as players
 * 
 * 4. **Add Perception** (optional but recommended)
 *    - Check perceptionMemory for recent events
 *    - Use getRecentPerceptions() in NPC AI decision-making
 *    - Add reactive behaviors based on observations
 * 
 * 5. **Test Everything**
 *    - Player actions work as before
 *    - NPC actions work as before
 *    - Both use same validation rules
 *    - Actions are observable
 * 
 * Benefits after migration:
 * - Single source of truth for action definitions
 * - Consistent validation for players and NPCs
 * - Automatic perception broadcasting
 * - Easier to add new action types
 * - Easier to debug (central pipeline)
 */

console.log("Action System Integration Examples loaded");
console.log("See the comments in this file for usage examples");

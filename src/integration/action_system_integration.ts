// Integration Helper - Connect Action System to Place/Input Modules
// Shows how to wire up the action system with existing game modules

import { ActionPipeline, type PipelineDependencies } from "../action_system/pipeline.js";
import { createIntent, type ActionIntent, type Location } from "../action_system/intent.js";
import { debugLogger, logSeparator } from "../action_system/debug_logger.js";
import { initializeDefaultRules } from "../tag_system/index.js";
import { initializeDefaultEffectors } from "../effectors/index.js";

// Initialize systems
initializeDefaultRules();
initializeDefaultEffectors();

/**
 * Integration with Place Module
 * 
 * The Place module manages:
 * - Player location
 * - NPC locations
 * - Movement
 * - Region/world coordinates
 */
export function createPlaceIntegratedPipeline(
  placeModule: {
    getPlayerLocation: () => Location;
    getNPCLocations: () => Array<{ ref: string; location: Location; name: string }>;
    movePlayer: (x: number, y: number) => boolean;
    getNPC: (ref: string) => { ref: string; name: string; location: Location } | null;
  }
): { pipeline: ActionPipeline; deps: PipelineDependencies } {
  
  const deps: PipelineDependencies = {
    async getAvailableTargets(location, radius) {
      // Get NPCs from place module
      const npcs = placeModule.getNPCLocations();
      
      return npcs
        .map(npc => {
          const dx = (npc.location.x || 0) - (location.x || 0);
          const dy = (npc.location.y || 0) - (location.y || 0);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          return {
            ref: npc.ref,
            type: "character" as const,
            name: npc.name,
            location: npc.location,
            distance
          };
        })
        .filter(npc => npc.distance <= radius);
    },
    
    async getActorLocation(actorRef) {
      if (actorRef === "actor.player") {
        return placeModule.getPlayerLocation();
      }
      
      const npc = placeModule.getNPC(actorRef);
      return npc?.location || null;
    },
    
    async checkActorAwareness(actorRef, targetRef) {
      // Simple awareness - check if within 10 tiles
      const actorLoc = await this.getActorLocation(actorRef);
      const targetLoc = await this.getActorLocation(targetRef);
      
      if (!actorLoc || !targetLoc) return false;
      
      const dx = (actorLoc.x || 0) - (targetLoc.x || 0);
      const dy = (actorLoc.y || 0) - (targetLoc.y || 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      return dist <= 10;
    },
    
    async checkActionCost(actorRef, cost) {
      // Place module would track action points
      // For now, always allow
      debugLogger.debug(`Checking action cost for ${actorRef}: ${cost}`);
      return true;
    },
    
    async consumeActionCost(actorRef, cost) {
      debugLogger.debug(`Consuming action cost for ${actorRef}: ${cost}`);
      return true;
    },
    
    async getActorData(actorRef) {
      // This would come from actor/npc storage
      // For now, return mock data
      return {
        ref: actorRef,
        hand_slots: {},
        body_slots: {}
      };
    },
    
    async executeEffect(effect) {
      debugLogger.info(`Executing effect: ${effect.type}`, {
        target: effect.targetRef
      });
      
      // Handle movement effects
      if (effect.type === "MOVE") {
        const params = effect.parameters;
        if (params.to && params.to.x !== undefined && params.to.y !== undefined) {
          placeModule.movePlayer(params.to.x, params.to.y);
          debugLogger.info(`Player moved to (${params.to.x}, ${params.to.y})`);
        }
      }
      
      return true;
    },
    
    isInCombat: () => false,
    getCurrentActor: () => null,
    log: (msg, data) => debugLogger.debug(`[Pipeline] ${msg}`, data)
  };
  
  const pipeline = new ActionPipeline(deps, {
    enablePerception: true,
    enableValidation: true,
    enableCostCheck: true,
    enableRulesCheck: true,
    requireAwareness: true,
    debug: true
  });
  
  return { pipeline, deps };
}

/**
 * Integration with Input Module
 * 
 * The Input module handles:
 * - Text commands
 * - Target selection
 * - UI interactions
 */
export function createInputHandlers(
  pipeline: ActionPipeline,
  placeModule: {
    getPlayerLocation: () => Location;
    getNPC: (ref: string) => { ref: string; name: string } | null;
    getNPCsInRange: (range: number) => Array<{ ref: string; name: string; location: Location }>;
  }
) {
  return {
    /**
     * Handle "move" command
     * Example: "move north 3" or "move to 5 5"
     */
    async handleMoveCommand(direction: string, distance: number = 1): Promise<string> {
      const playerLoc = placeModule.getPlayerLocation();
      let targetX = playerLoc.x || 0;
      let targetY = playerLoc.y || 0;
      
      // Parse direction
      switch (direction.toLowerCase()) {
        case "north":
        case "n":
          targetY -= distance;
          break;
        case "south":
        case "s":
          targetY += distance;
          break;
        case "east":
        case "e":
          targetX += distance;
          break;
        case "west":
        case "w":
          targetX -= distance;
          break;
      }
      
      const intent = createIntent("actor.player", "MOVE", "player_input", {
        actorLocation: playerLoc,
        targetLocation: { ...playerLoc, x: targetX, y: targetY },
        parameters: {
          subtype: "WALK",
          distance
        }
      });
      
      const result = await pipeline.process(intent);
      
      if (result.success) {
        return `You move ${direction} ${distance} tile(s).`;
      } else {
        return `You cannot move there. ${result.failureReason || ""}`;
      }
    },
    
    /**
     * Handle "say" command
     * Example: "say Hello!" or "say hi to guard"
     */
    async handleSayCommand(message: string, targetName?: string): Promise<string> {
      const playerLoc = placeModule.getPlayerLocation();
      let targetRef: string | undefined;
      let targetLoc: Location | undefined;
      
      // Find target by name
      if (targetName) {
        const npcs = placeModule.getNPCsInRange(10);
        const target = npcs.find(npc => 
          npc.name.toLowerCase().includes(targetName.toLowerCase())
        );
        
        if (target) {
          targetRef = target.ref;
          targetLoc = target.location;
        }
      }
      
      // Determine subtype based on context
      let subtype: string = "NORMAL";
      if (message.toUpperCase() === message && message.length > 3) {
        subtype = "SHOUT";
      } else if (targetRef) {
        // Check distance for whisper
        if (targetLoc) {
          const dx = (targetLoc.x || 0) - (playerLoc.x || 0);
          const dy = (targetLoc.y || 0) - (playerLoc.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist <= 1) {
            subtype = "WHISPER";
          }
        }
      }
      
      const intent = createIntent("actor.player", "COMMUNICATE", "player_input", {
        actorLocation: playerLoc,
        targetRef,
        targetLocation: targetLoc,
        parameters: {
          subtype,
          message
        }
      });
      
      const result = await pipeline.process(intent);
      
      if (result.success) {
        if (subtype === "WHISPER") {
          return `You whisper to ${targetName}: "${message}"`;
        } else if (subtype === "SHOUT") {
          return `You shout: "${message}"`;
        } else {
          return `You say: "${message}"`;
        }
      } else {
        return `You try to speak but ${result.failureReason || "something prevents you"}.`;
      }
    },
    
    /**
     * Handle "attack" command
     * Example: "attack guard" or "shoot bandit"
     */
    async handleAttackCommand(targetName: string, useRanged: boolean = false): Promise<string> {
      const playerLoc = placeModule.getPlayerLocation();
      
      // Find target
      const npcs = placeModule.getNPCsInRange(useRanged ? 50 : 2);
      const target = npcs.find(npc => 
        npc.name.toLowerCase().includes(targetName.toLowerCase())
      );
      
      if (!target) {
        return `You don't see ${targetName} nearby.`;
      }
      
      const intent = createIntent("actor.player", "USE", "player_input", {
        actorLocation: playerLoc,
        targetRef: target.ref,
        targetLocation: target.location,
        parameters: {
          subtype: useRanged ? "PROJECTILE_SINGLE" : "IMPACT_SINGLE"
        }
      });
      
      const result = await pipeline.process(intent);
      
      if (result.success) {
        // Get the attack effect
        const attackEffect = result.effects.find(e => 
          e.type === "ATTACK" || e.type === "PROJECTILE_ATTACK"
        );
        
        if (attackEffect) {
          const params = attackEffect.parameters;
          if (params.hit) {
            return `You ${useRanged ? "shoot" : "attack"} ${targetName} and hit! Damage: ${params.damage_mag} MAG`;
          } else {
            return `You ${useRanged ? "shoot" : "swing at"} ${targetName} but miss!`;
          }
        }
        
        return `You ${useRanged ? "shoot" : "attack"} ${targetName}!`;
      } else {
        return `You cannot attack ${targetName}. ${result.failureReason || ""}`;
      }
    },
    
    /**
     * Handle "inspect" or "look at" command
     * Example: "inspect guard" or "look at sword"
     */
    async handleInspectCommand(targetName: string): Promise<string> {
      const playerLoc = placeModule.getPlayerLocation();
      
      // Find target
      const npcs = placeModule.getNPCsInRange(10);
      const target = npcs.find(npc => 
        npc.name.toLowerCase().includes(targetName.toLowerCase())
      );
      
      if (!target) {
        return `You don't see ${targetName} nearby.`;
      }
      
      const intent = createIntent("actor.player", "INSPECT", "player_input", {
        actorLocation: playerLoc,
        targetRef: target.ref,
        targetLocation: target.location,
        parameters: {}
      });
      
      const result = await pipeline.process(intent);
      
      if (result.success) {
        const inspectEffect = result.effects.find(e => e.type === "INSPECT");
        if (inspectEffect) {
          const params = inspectEffect.parameters;
          return `You inspect ${targetName}:\n` +
                 `Distance: ${params.distance.toFixed(1)} tiles\n` +
                 `Clarity: ${params.clarity}\n` +
                 params.details?.join("\n") || "";
        }
        return `You look at ${targetName}.`;
      } else {
        return `You cannot inspect ${targetName}. ${result.failureReason || ""}`;
      }
    }
  };
}

/**
 * Example: Complete integration setup
 */
export function setupCompleteIntegration() {
  // Mock place module (replace with actual place module)
  const mockPlaceModule = {
    playerLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 5, y: 5 },
    npcs: new Map([
      ["npc.guard", { ref: "npc.guard", name: "Guard", location: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 7, y: 5 } }],
      ["npc.merchant", { ref: "npc.merchant", name: "Merchant", location: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 5 } }]
    ]),
    
    getPlayerLocation() {
      return this.playerLocation;
    },
    
    getNPCLocations() {
      return Array.from(this.npcs.values());
    },
    
    getNPC(ref: string) {
      return this.npcs.get(ref) || null;
    },
    
    getNPCsInRange(range: number) {
      return this.getNPCLocations().filter(npc => {
        const dx = (npc.location.x || 0) - (this.playerLocation.x || 0);
        const dy = (npc.location.y || 0) - (this.playerLocation.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= range;
      });
    },
    
    movePlayer(x: number, y: number) {
      this.playerLocation.x = x;
      this.playerLocation.y = y;
      return true;
    }
  };
  
  // Create integrated pipeline
  const { pipeline, deps } = createPlaceIntegratedPipeline(mockPlaceModule);
  
  // Create input handlers
  const inputHandlers = createInputHandlers(pipeline, mockPlaceModule);
  
  logSeparator(debugLogger, "INTEGRATION SETUP COMPLETE");
  debugLogger.info("Systems ready:");
  debugLogger.info("- Action Pipeline with 7 stages");
  debugLogger.info("- Place module integration");
  debugLogger.info("- Input command handlers");
  debugLogger.info("- Roll system (D20 + proficiencies)");
  debugLogger.info("- Effector system (SHIFT/SCALE)");
  debugLogger.info("- Debug logging enabled");
  
  return {
    pipeline,
    deps,
    inputHandlers,
    placeModule: mockPlaceModule,
    
    // Test function
    async runDemo() {
      logSeparator(debugLogger, "RUNNING DEMO COMMANDS");
      
      debugLogger.info("Command: move north 2");
      let result = await inputHandlers.handleMoveCommand("north", 2);
      debugLogger.info(`Result: ${result}`);
      
      debugLogger.info("\nCommand: say Hello!");
      result = await inputHandlers.handleSayCommand("Hello!");
      debugLogger.info(`Result: ${result}`);
      
      debugLogger.info("\nCommand: say hi to guard");
      result = await inputHandlers.handleSayCommand("Hi there!", "guard");
      debugLogger.info(`Result: ${result}`);
      
      debugLogger.info("\nCommand: inspect merchant");
      result = await inputHandlers.handleInspectCommand("merchant");
      debugLogger.info(`Result: ${result}`);
      
      debugLogger.info("\nCommand: attack guard");
      result = await inputHandlers.handleAttackCommand("guard", false);
      debugLogger.info(`Result: ${result}`);
    }
  };
}

// Functions already exported above

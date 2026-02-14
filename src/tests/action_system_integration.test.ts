// Action System Integration Tests
// Test scenarios for the complete action pipeline

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ActionPipeline, DEFAULT_PIPELINE_CONFIG, type PipelineDependencies } from "../action_system/pipeline.js";
import { createIntent, type ActionIntent, type Location } from "../action_system/intent.js";
import { debugLogger, logActionIntent, logToolValidation, logRoll, logActionResult, logSeparator, logPipelineStage, printTestScenario, printTestSummary, createTestActor, createTestTool, createTestNPC } from "../action_system/debug_logger.js";
import { initializeDefaultRules } from "../tag_system/index.js";
import { initializeDefaultEffectors } from "../effectors/index.js";
import { choose_follow_tile } from "../interface_program/conversation_follow.js";

// Initialize systems
initializeDefaultRules();
initializeDefaultEffectors();

// Test configuration
const TEST_CONFIG = {
  enableDebug: true,
  verbose: true
};

/**
 * Create mock pipeline dependencies for testing
 */
function createMockDependencies(): PipelineDependencies {
  // Store for test data
  const actors = new Map<string, any>();
  const npcs = new Map<string, any>();
  const locations = new Map<string, Location>();

  const deps: any = {
    async getAvailableTargets(location: Location, radius: number) {
      debugLogger.debug(`Getting targets within ${radius} tiles of (${location.x},${location.y})`);
      
      // Return NPCs within range
      const targets = [];
      for (const [ref, npc] of npcs) {
        const npcLoc = locations.get(ref);
        if (npcLoc) {
          const dx = (npcLoc.x || 0) - (location.x || 0);
          const dy = (npcLoc.y || 0) - (location.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist <= radius) {
            targets.push({
              ref,
              type: "character" as const,
              name: npc.name,
              location: npcLoc,
              distance: dist
            });
          }
        }
      }
      
      debugLogger.debug(`Found ${targets.length} targets`);
      return targets;
    },
    
    async getActorLocation(actorRef: string) {
      return locations.get(actorRef) || null;
    },
    
    async checkActorAwareness(actorRef: string, targetRef: string) {
      // Simple awareness check - always aware for testing
      return true;
    },
    
    async checkActionCost(actorRef: string, cost: string) {
      debugLogger.debug(`Checking action cost for ${actorRef}: ${cost}`);
      return true; // Always can afford in tests
    },
    
    async consumeActionCost(actorRef: string, cost: string) {
      debugLogger.debug(`Consuming action cost for ${actorRef}: ${cost}`);
      return true;
    },
    
    async getActorData(actorRef: string) {
      const actor = actors.get(actorRef);
      debugLogger.debug(`Getting actor data for ${actorRef}`, { found: !!actor });
      return actor || null;
    },
    
    async executeEffect(effect: any) {
      debugLogger.info(`Executing effect: ${effect.type}`, {
        target: effect.targetRef,
        parameters: Object.keys(effect.parameters || {})
      });
      return true;
    },
    
    isInCombat() {
      return false; // Not in combat for tests
    },
    
    getCurrentActor() {
      return null; // Freeform mode
    },
    
    log: (message: string, data?: any) => {
      debugLogger.debug(`[Pipeline] ${message}`, data);
    }
  };

  // Expose stores for test setup.
  deps.actors = actors;
  deps.npcs = npcs;
  deps.locations = locations;

  return deps as PipelineDependencies;
}

/**
 * Test Scenario 1: Move through a place
 * 
 * Player starts at (0,0) and moves to (3,4)
 */
async function testMoveThroughPlace(): Promise<boolean> {
  printTestScenario(debugLogger, "Move Through Place", [
    "Player starts at position (0,0)",
    "Player moves to position (3,4)",
    "System calculates distance (5 tiles)",
    "Action succeeds"
  ]);
  
  const deps = createMockDependencies();
  const pipeline = new ActionPipeline(deps, { ...DEFAULT_PIPELINE_CONFIG, debug: true });
  
  // Create player
  const player = createTestActor("actor.player", {
    name: "Test Player",
    stats: { STR: 12, DEX: 14 }
  });
  
  // Register player
  (deps as any).actors.set("actor.player", player);
  (deps as any).locations.set("actor.player", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0
  });
  
  // Create move intent
  const intent = createIntent("actor.player", "MOVE", "player_input", {
    actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0 },
    targetRef: "tile.0.0.0.0.3.4",
    targetLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4 },
    parameters: {
      subtype: "WALK",
      distance: 5
    }
  });
  
  logActionIntent(debugLogger, intent, "Move Intent");
  
  // Process action
  const result = await pipeline.process(intent);
  
  logActionResult(debugLogger, result, "Move Result");
  
  // Update location if successful
  if (result.success) {
    (deps as any).locations.set("actor.player", {
      world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4
    });
    debugLogger.info("✓ Player moved to (3,4)");
  }
  
  return result.success;
}

/**
 * Test Scenario 2: Say hi to an NPC
 * 
 * Player is near an NPC and communicates
 */
async function testSayHiToNPC(): Promise<boolean> {
  printTestScenario(debugLogger, "Say Hi to NPC", [
    "Player is at position (3,4)",
    "NPC 'Guard' is at position (5,5) - 2.2 tiles away",
    "Player uses COMMUNICATE.NORMAL to say 'Hello!'",
    "System validates range (within 5 tiles)",
    "Action succeeds, NPC hears message"
  ]);
  
  const deps = createMockDependencies();
  const pipeline = new ActionPipeline(deps, { ...DEFAULT_PIPELINE_CONFIG, debug: true });
  
  // Create player at (3,4)
  const player = createTestActor("actor.player", {
    name: "Test Player",
    stats: { CHA: 12 }
  });
  
  // Create NPC Guard at (5,5)
  const guard = createTestNPC("npc.guard", { x: 5, y: 5 }, {
    name: "Guard",
    hostile: false
  });
  
  // Register entities
  (deps as any).actors.set("actor.player", player);
  (deps as any).npcs.set("npc.guard", guard);
  (deps as any).locations.set("actor.player", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4
  });
  (deps as any).locations.set("npc.guard", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 5, y: 5
  });
  
  // Calculate distance
  const dx = 5 - 3;
  const dy = 5 - 4;
  const distance = Math.sqrt(dx * dx + dy * dy);
  debugLogger.info(`Distance to NPC: ${distance.toFixed(2)} tiles`);
  
  // Create communicate intent
  const intent = createIntent("actor.player", "COMMUNICATE", "player_input", {
    actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4 },
    targetRef: "npc.guard",
    targetLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 5, y: 5 },
    parameters: {
      subtype: "NORMAL",
      message: "Hello!",
      distance: distance
    }
  });
  
  logActionIntent(debugLogger, intent, "Communicate Intent");
  
  // Process action
  const result = await pipeline.process(intent);
  
  logActionResult(debugLogger, result, "Communicate Result");
  
  return result.success;
}

/**
 * Test Scenario 2b: COMMUNICATE out of range should fail
 *
 * Mirrors in-game behavior where intents often have targetRef but no targetLocation.
 * The pipeline must resolve target location and enforce COMMUNICATE.NORMAL pressure range.
 */
async function testCommunicateOutOfRangeFails(): Promise<boolean> {
  printTestScenario(debugLogger, "Communicate Out of Range", [
    "Player is at position (0,0)",
    "NPC 'Guard' is at position (7,0) - 7 tiles away",
    "Player uses COMMUNICATE.NORMAL to say 'Hello!'",
    "Pipeline resolves targetLocation from available targets",
    "System validates range (COMMUNICATE.NORMAL pressure range)",
    "Action fails (out of range)"
  ]);

  const deps = createMockDependencies();
  const pipeline = new ActionPipeline(deps, { ...DEFAULT_PIPELINE_CONFIG, debug: true });

  const player = createTestActor("actor.player", {
    name: "Test Player",
    stats: { CHA: 12 }
  });

  const guard = createTestNPC("npc.guard", { x: 7, y: 0 }, {
    name: "Guard",
    hostile: false
  });

  (deps as any).actors.set("actor.player", player);
  (deps as any).npcs.set("npc.guard", guard);
  (deps as any).locations.set("actor.player", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0
  });
  (deps as any).locations.set("npc.guard", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 7, y: 0
  });

  const distance = 7;
  debugLogger.info(`Distance to NPC: ${distance.toFixed(2)} tiles`);

  const intent = createIntent("actor.player", "COMMUNICATE", "player_input", {
    actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 0, y: 0 },
    targetRef: "npc.guard",
    // Intentionally omit targetLocation (pipeline must resolve)
    parameters: {
      subtype: "NORMAL",
      message: "Hello!",
      distance: distance
    }
  });

  logActionIntent(debugLogger, intent, "Communicate Intent");
  const result = await pipeline.process(intent);
  logActionResult(debugLogger, result, "Communicate Result");

  return result.success === false;
}

/**
 * Test Scenario 3: Target NPC with projectile
 * 
 * Player shoots bow at NPC
 */
async function testTargetNPCWithProjectile(): Promise<boolean> {
  printTestScenario(debugLogger, "Target NPC with Projectile", [
    "Player equips a Longbow (MAG 3)",
    "NPC 'Bandit' is at position (8,8) - 7.1 tiles away",
    "Player uses USE.PROJECTILE_SINGLE to shoot arrow",
    "System validates tool (bow)",
    "System validates range (within 30 tiles)",
    "System performs result roll (D20)",
    "System performs potency roll (damage)",
    "Action succeeds with hit/miss result"
  ]);
  
  const deps = createMockDependencies();
  const pipeline = new ActionPipeline(deps, { ...DEFAULT_PIPELINE_CONFIG, debug: true });
  
  // Create bow
  const bow = createTestTool("Longbow", 3, [
    { name: "bow", stacks: 3 },
    { name: "projectile", stacks: 1 },
    { name: "damage", stacks: 1, value: "piercing" }
  ], { weight: 12 });
  
  // Create arrow ammo
  const arrow = createTestTool("Arrow", 1, [
    { name: "projectile", stacks: 1, value: "arrow" },
    { name: "piercing", stacks: 1 }
  ], { weight: 1, ref: "item.arrow_1" });
  
  // Create player with bow
  const player = createTestActor("actor.player", {
    name: "Test Player",
    proficiencies: { Accuracy: 3, Brawn: 1 },
    stats: { DEX: 16, STR: 12 },
    equippedTool: bow
  });
  
  // Add arrow to inventory
  player.inventory = { "item.arrow_1": arrow };
  
  // Create NPC Bandit at (8,8)
  const bandit = createTestNPC("npc.bandit", { x: 8, y: 8 }, {
    name: "Bandit",
    hostile: true
  });
  
  // Register entities
  (deps as any).actors.set("actor.player", player);
  (deps as any).npcs.set("npc.bandit", bandit);
  (deps as any).locations.set("actor.player", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4
  });
  (deps as any).locations.set("npc.bandit", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 8, y: 8
  });
  
  // Calculate distance
  const dx = 8 - 3;
  const dy = 8 - 4;
  const distance = Math.sqrt(dx * dx + dy * dy);
  debugLogger.info(`Distance to target: ${distance.toFixed(2)} tiles`);
  debugLogger.info(`Bow range: 30 tiles (base) + 6 tiles (MAG 3 × 2) = 36 tiles`);
  
  // Create projectile intent
  const intent = createIntent("actor.player", "USE", "player_input", {
    actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4 },
    targetRef: "npc.bandit",
    targetLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 8, y: 8 },
    parameters: {
      subtype: "PROJECTILE_SINGLE",
      ammo: arrow,
      distance: distance
    }
  });
  
  logActionIntent(debugLogger, intent, "Projectile Intent");
  
  // Process action
  const result = await pipeline.process(intent);
  
  logActionResult(debugLogger, result, "Projectile Result");
  
  return result.success;
}

/**
 * Test Scenario 4: Melee attack with effectors
 * 
 * Player swings sword with masterwork tag
 */
async function testMeleeWithEffectors(): Promise<boolean> {
  printTestScenario(debugLogger, "Melee Attack with Effectors", [
    "Player equips a Masterwork Sword (MAG 2)",
    "NPC 'Goblin' is at position (4,4) - adjacent",
    "Sword has 'masterwork' tag (+1 SHIFT to rolls)",
    "Player uses USE.IMPACT_SINGLE to attack",
    "System applies effector to damage",
    "Action succeeds"
  ]);
  
  const deps = createMockDependencies();
  const pipeline = new ActionPipeline(deps, { ...DEFAULT_PIPELINE_CONFIG, debug: true });
  
  // Create masterwork sword
  const sword = createTestTool("Masterwork Sword", 2, [
    { name: "sword", stacks: 2 },
    { name: "slashing", stacks: 1 },
    { name: "masterwork", stacks: 1 }  // +1 SHIFT
  ], { weight: 10 });
  
  // Create player with sword
  const player = createTestActor("actor.player", {
    name: "Test Player",
    proficiencies: { Brawn: 2 },
    stats: { STR: 14 },
    equippedTool: sword
  });
  
  // Create Goblin adjacent (orthogonal)
  const goblin = createTestNPC("npc.goblin", { x: 4, y: 4 }, {
    name: "Goblin",
    hostile: true
  });
  
  // Register entities
  (deps as any).actors.set("actor.player", player);
  (deps as any).npcs.set("npc.goblin", goblin);
  (deps as any).locations.set("actor.player", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4
  });
  (deps as any).locations.set("npc.goblin", {
    world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 4, y: 4
  });
  
  // Calculate distance
  const dx = 4 - 3;
  const dy = 4 - 4;
  const distance = Math.sqrt(dx * dx + dy * dy);
  debugLogger.info(`Distance to target: ${distance.toFixed(2)} tiles (melee range)`);
  
  // Create melee intent
  const intent = createIntent("actor.player", "USE", "player_input", {
    actorLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 3, y: 4 },
    targetRef: "npc.goblin",
    targetLocation: { world_x: 0, world_y: 0, region_x: 0, region_y: 0, x: 4, y: 4 },
    parameters: {
      subtype: "IMPACT_SINGLE",
      distance: distance
    }
  });
  
  logActionIntent(debugLogger, intent, "Melee Intent");
  
  // Process action
  const result = await pipeline.process(intent);
  
  logActionResult(debugLogger, result, "Melee Result");
  
  return result.success;
}

async function testConversationFollowTileSelection(): Promise<boolean> {
  printTestScenario(debugLogger, "Conversation Follow Tile Selection", [
    "Follower chooses a tile adjacent to actor",
    "Never targets the actor tile",
    "Respects bounds + occupied tiles"
  ]);

  const occupied = new Set<string>(["1,0"]);
  const best = choose_follow_tile({
    npc_tile: { x: 2, y: 2 },
    actor_tile: { x: 0, y: 0 },
    bounds: { width: 3, height: 3 },
    occupied,
  });
  if (!best) throw new Error("expected a follow tile");
  if (best.x === 0 && best.y === 0) throw new Error("follow tile must not be actor tile");
  if (best.x < 0 || best.y < 0 || best.x >= 3 || best.y >= 3) throw new Error("follow tile must be in bounds");
  if (occupied.has(`${best.x},${best.y}`)) throw new Error("follow tile must not be occupied");

  const none = choose_follow_tile({
    npc_tile: { x: 0, y: 0 },
    actor_tile: { x: 0, y: 0 },
    bounds: { width: 1, height: 1 },
    occupied: new Set<string>(),
  });
  if (none !== null) throw new Error("expected no follow tile in 1x1 bounds");

  return true;
}

/**
 * Run all tests
 */
async function runAllTests(): Promise<void> {
  logSeparator(debugLogger, "ACTION SYSTEM INTEGRATION TESTS");
  debugLogger.info("Starting test suite...\n");
  
  const results: Array<{ step: string; passed: boolean; error?: string }> = [];
  
  try {
    results.push({
      step: "Move Through Place",
      passed: await testMoveThroughPlace()
    });
  } catch (error) {
    results.push({
      step: "Move Through Place",
      passed: false,
      error: String(error)
    });
  }
  
  debugLogger.info("\n");
  
  try {
    results.push({
      step: "Say Hi to NPC",
      passed: await testSayHiToNPC()
    });
  } catch (error) {
    results.push({
      step: "Say Hi to NPC",
      passed: false,
      error: String(error)
    });
  }
  
  debugLogger.info("\n");

  try {
    results.push({
      step: "Communicate Out of Range",
      passed: await testCommunicateOutOfRangeFails()
    });
  } catch (error) {
    results.push({
      step: "Communicate Out of Range",
      passed: false,
      error: String(error)
    });
  }
  
  debugLogger.info("\n");
  
  try {
    results.push({
      step: "Target NPC with Projectile",
      passed: await testTargetNPCWithProjectile()
    });
  } catch (error) {
    results.push({
      step: "Target NPC with Projectile",
      passed: false,
      error: String(error)
    });
  }
  
  debugLogger.info("\n");
  
  try {
    results.push({
      step: "Melee Attack with Effectors",
      passed: await testMeleeWithEffectors()
    });
  } catch (error) {
    results.push({
      step: "Melee Attack with Effectors",
      passed: false,
      error: String(error)
    });
  }

  debugLogger.info("\n");

  try {
    results.push({
      step: "Conversation Follow Tile Selection",
      passed: await testConversationFollowTileSelection()
    });
  } catch (error) {
    results.push({
      step: "Conversation Follow Tile Selection",
      passed: false,
      error: String(error)
    });
  }
  
  debugLogger.info("\n");
  printTestSummary(debugLogger, results);
  
  // Export logs
  if (TEST_CONFIG.verbose) {
    console.log("\n\n" + "=".repeat(70));
    console.log("COMPLETE LOG OUTPUT:");
    console.log("=".repeat(70));
    console.log(debugLogger.export());
  }
}

// Run tests if this file is executed directly (ESM-safe)
const is_main = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return argv1.length > 0 && path.resolve(self) === argv1;
  } catch {
    return false;
  }
})();

if (is_main) {
  runAllTests().catch((error) => {
    console.error("Test suite failed:", error);
    process.exit(1);
  });
}

export { runAllTests, testMoveThroughPlace, testSayHiToNPC, testCommunicateOutOfRangeFails, testTargetNPCWithProjectile, testMeleeWithEffectors, testConversationFollowTileSelection };

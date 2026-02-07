// Action Handlers - Core Actions Implementation
// Phase 3 & 5: Core Actions with Effector Integration

import type { Location } from "../action_system/intent.js";
import type { TaggedItem, ActionCapability } from "../tag_system/index.js";
import {
  effectorRegistry,
  applyEffectors,
  calculateModifiedRange,
  calculateModifiedRoll,
  type Effector,
  type EffectorResult
} from "../effectors/index.js";

/**
 * Action execution context
 */
export interface ActionContext {
  actorRef: string;
  actorLocation: Location;
  targetRef?: string;
  targetLocation?: Location;
  tool?: TaggedItem;
  capability?: ActionCapability;
  parameters: Record<string, any>;
}

/**
 * Action execution result
 */
export interface ActionResult {
  success: boolean;
  effects: ActionEffect[];
  messages: string[];
  projectiles?: ProjectileResult[];
}

/**
 * Action effect
 */
export interface ActionEffect {
  type: string;
  target: string;
  parameters: Record<string, any>;
}

/**
 * Projectile result
 */
export interface ProjectileResult {
  item: TaggedItem;
  hit: boolean;
  sticks: boolean;
  landingLocation: Location;
  inTarget: boolean;
  scatterDistance?: number;
  damage?: number;
}

/**
 * COMMUNICATE Action Handler
 * 
 * Subtypes:
 * - WHISPER: 1 tile range
 * - NORMAL: 3 tiles range  
 * - SHOUT: 10 tiles range
 * - TELEPATHY: Unlimited (future)
 */
export async function handleCommunicate(
  context: ActionContext,
  subtype: "WHISPER" | "NORMAL" | "SHOUT" | "TELEPATHY" = "NORMAL"
): Promise<ActionResult> {
  const { actorRef, targetRef, parameters } = context;
  const message = parameters.message || "";
  
  // Determine range based on subtype
  const ranges: Record<string, number> = {
    WHISPER: 1,
    NORMAL: 3,
    SHOUT: 10,
    TELEPATHY: Infinity
  };
  const range = ranges[subtype] || 3;
  
  // Determine who can hear based on range
  const audibleRange = subtype === "WHISPER" ? 1 : range;
  
  return {
    success: true,
    effects: [{
      type: "COMMUNICATE",
      target: targetRef || "area",
      parameters: {
        speaker: actorRef,
        message,
        subtype,
        range: audibleRange,
        volume: subtype
      }
    }],
    messages: [`${actorRef} ${subtype.toLowerCase()}s: "${message}"`]
  };
}

/**
 * MOVE Action Handler
 * 
 * Movement types:
 * - WALK: Standard movement using legs
 * - CLIMB: Vertical surfaces (future)
 * - SWIM: Water movement (future)
 * - FLY: Aerial movement (future)
 */
export async function handleMove(
  context: ActionContext,
  subtype: "WALK" | "CLIMB" | "SWIM" | "FLY" = "WALK"
): Promise<ActionResult> {
  const { actorRef, targetLocation, parameters } = context;
  
  if (!targetLocation) {
    return {
      success: false,
      effects: [],
      messages: ["No destination specified"]
    };
  }
  
  const distance = parameters.distance || 1;
  
  return {
    success: true,
    effects: [{
      type: "MOVE",
      target: actorRef,
      parameters: {
        from: context.actorLocation,
        to: targetLocation,
        distance,
        subtype,
        speed_cost: distance
      }
    }],
    messages: [`${actorRef} moves ${distance} tile(s)`]
  };
}

/**
 * USE.IMPACT_SINGLE Action Handler
 * 
 * Melee attack on single adjacent target
 */
export async function handleImpactSingle(
  context: ActionContext
): Promise<ActionResult> {
  const { actorRef, targetRef, tool, capability, parameters } = context;
  
  if (!targetRef) {
    return {
      success: false,
      effects: [],
      messages: ["No target specified"]
    };
  }
  
  // Get damage from tool capability
  const toolMAG = tool?.tags?.find(t => 
    capability?.source_tag && t.name === capability.source_tag
  )?.stacks || 1;
  
  const baseDamageMAG = parameters.damageMAG || toolMAG;
  
  // Apply effectors to damage (Phase 5)
  let finalDamageMAG = baseDamageMAG;
  let damageEffectors: Effector[] = [];
  
  if (tool) {
    damageEffectors = effectorRegistry.getItemEffectors(tool);
    const modified = calculateModifiedRoll(baseDamageMAG, damageEffectors);
    finalDamageMAG = modified.finalValue;
  }
  
  // Calculate damage dice based on MAG
  const damageDice = getDamageDice(finalDamageMAG);
  
  return {
    success: true,
    effects: [{
      type: "ATTACK",
      target: targetRef,
      parameters: {
        attacker: actorRef,
        weapon: tool?.ref,
        damage_dice: damageDice,
        damage_mag: finalDamageMAG,
        base_damage_mag: baseDamageMAG,
        effectors: damageEffectors.map(e => ({ type: e.type, value: e.value, source: e.source })),
        range: "MELEE"
      }
    }],
    messages: [`${actorRef} attacks ${targetRef} with ${tool?.name || "unarmed"} (MAG ${finalDamageMAG}${baseDamageMAG !== finalDamageMAG ? `, base ${baseDamageMAG}` : ""})`]
  };
}

/**
 * USE.PROJECTILE_SINGLE Action Handler
 * 
 * Throw or shoot projectile at target
 * Handles hit/miss/scatter
 */
export async function handleProjectileSingle(
  context: ActionContext,
  ammo?: TaggedItem
): Promise<ActionResult> {
  const { actorRef, targetRef, targetLocation, tool, capability, parameters } = context;
  
  if (!targetRef || !targetLocation) {
    return {
      success: false,
      effects: [],
      messages: ["No target specified"]
    };
  }
  
  // Determine if thrown or projectile weapon
  const rangeCategory = capability?.range?.category || "THROWN";
  const isThrown = rangeCategory === "THROWN";
  
  // Get the projectile (thrown item or ammo)
  const projectile = isThrown ? tool : ammo;
  
  if (!projectile) {
    return {
      success: false,
      effects: [],
      messages: ["No projectile available"]
    };
  }
  
  // Apply effectors to range (Phase 5)
  const baseRange = capability?.range?.base || 5;
  let rangeEffectors: Effector[] = [];
  if (tool) {
    rangeEffectors = effectorRegistry.getItemEffectors(tool);
  }
  const modifiedRange = calculateModifiedRange(baseRange, rangeEffectors);
  const finalRange = modifiedRange.finalValue;
  
  // Calculate hit/miss (simplified - actual roll done in rules_lawyer)
  // Apply effectors to attack roll
  const baseRoll = parameters.roll || 10;
  let attackEffectors: Effector[] = [];
  if (tool) {
    attackEffectors = effectorRegistry.getItemEffectors(tool);
  }
  const modifiedAttack = calculateModifiedRoll(baseRoll, attackEffectors);
  const roll = modifiedAttack.finalValue;
  const cr = parameters.cr || 10;
  
  // Calculate scatter on miss
  let scatterDistance = 0;
  const hit = roll >= cr; // Simplified hit calculation
  if (!hit) {
    const missBy = cr - roll;
    scatterDistance = Math.ceil(missBy / 3);
  }
  
  // Determine if projectile sticks
  const sticks = hit && parameters.sticks !== false;
  
  // Calculate damage
  const toolMAG = tool?.tags?.find(t => 
    capability?.source_tag && t.name === capability.source_tag
  )?.stacks || 1;
  
  const ammoMAG = ammo?.tags?.find(t => t.name === "projectile")?.stacks || 
                 (isThrown ? 0 : 1);
  
  const baseTotalMAG = toolMAG + ammoMAG;
  
  // Apply effectors to damage
  let damageEffectors: Effector[] = [];
  if (tool) {
    damageEffectors = effectorRegistry.getItemEffectors(tool);
  }
  const modifiedDamage = calculateModifiedRoll(baseTotalMAG, damageEffectors);
  const totalMAG = modifiedDamage.finalValue;
  
  const damageDice = getDamageDice(totalMAG);
  
  // Determine landing location
  const landingLocation = hit && sticks 
    ? targetLocation 
    : calculateScatterLocation(targetLocation, scatterDistance);
  
  const projectileResult: ProjectileResult = {
    item: projectile,
    hit,
    sticks,
    landingLocation,
    inTarget: hit && sticks,
    scatterDistance: hit ? 0 : scatterDistance,
    damage: hit ? totalMAG : 0
  };
  
  // Build effector info for response
  const allEffectors = [...rangeEffectors, ...attackEffectors, ...damageEffectors];
  const uniqueEffectors = allEffectors.filter((eff, idx, arr) => 
    arr.findIndex(e => e.source === eff.source && e.type === eff.type) === idx
  );
  
  return {
    success: true,
    effects: [{
      type: "PROJECTILE_ATTACK",
      target: targetRef,
      parameters: {
        attacker: actorRef,
        projectile: projectile.ref,
        hit,
        roll: baseRoll,
        modified_roll: roll,
        cr,
        damage_dice: damageDice,
        damage_mag: totalMAG,
        base_damage_mag: baseTotalMAG,
        range_category: rangeCategory,
        range: finalRange,
        base_range: baseRange,
        sticks,
        landing_location: landingLocation,
        effectors: uniqueEffectors.map(e => ({ 
          type: e.type, 
          value: e.value, 
          source: e.source 
        }))
      }
    }],
    messages: hit 
      ? [`${actorRef} hits ${targetRef} with ${projectile.name}! (Range: ${finalRange}, Damage MAG: ${totalMAG})`]
      : [`${actorRef} misses ${targetRef}! Projectile scatters ${scatterDistance} tiles.`],
    projectiles: [projectileResult]
  };
}

/**
 * Calculate scatter location
 */
function calculateScatterLocation(
  targetLocation: Location,
  distance: number
): Location {
  // Simple scatter: random direction
  const angle = Math.random() * 2 * Math.PI;
  const dx = Math.round(Math.cos(angle) * distance);
  const dy = Math.round(Math.sin(angle) * distance);
  
  return {
    world_x: targetLocation.world_x,
    world_y: targetLocation.world_y,
    region_x: targetLocation.region_x,
    region_y: targetLocation.region_y,
    x: (targetLocation.x || 0) + dx,
    y: (targetLocation.y || 0) + dy
  };
}

/**
 * Get damage dice based on MAG
 */
function getDamageDice(mag: number): string {
  if (mag <= 0) return "1";
  if (mag === 1) return "1d2";
  if (mag === 2) return "1d4";
  if (mag === 3) return "1d6";
  if (mag === 4) return "1d8";
  if (mag === 5) return "2d4";
  if (mag === 6) return "1d10";
  return `${Math.floor(mag / 2)}d6`;
}

/**
 * Main action handler router
 */
export async function handleAction(
  actionType: string,
  context: ActionContext
): Promise<ActionResult> {
  // Parse action type and subtype
  const [baseType, subtype] = actionType.split(".") as [string, string | undefined];
  
  switch (baseType) {
    case "COMMUNICATE":
      return handleCommunicate(context, (subtype || "NORMAL") as any);
      
    case "MOVE":
      return handleMove(context, (subtype || "WALK") as any);
      
    case "USE":
      if (subtype === "IMPACT_SINGLE") {
        return handleImpactSingle(context);
      } else if (subtype === "PROJECTILE_SINGLE") {
        return handleProjectileSingle(context, context.parameters.ammo);
      }
      return {
        success: false,
        effects: [],
        messages: [`Unknown USE subtype: ${subtype}`]
      };
      
    case "INSPECT":
      return handleInspect(context);
      
    default:
      return {
        success: false,
        effects: [],
        messages: [`Unknown action type: ${actionType}`]
      };
  }
}

// Import inspect handler
import { 
  handleInspect,
  getBestSenseForDistance,
  calculateInspectRange,
  isInspectable,
  formatInspectRange
} from "./inspect.js";

/**
 * Apply effectors to an action context
 * Central function for applying effectors to rolls, damage, and range
 */
export function applyEffectorsToAction(
  context: ActionContext
): {
  rollEffectors: Effector[];
  damageEffectors: Effector[];
  rangeEffectors: Effector[];
} {
  const rollEffectors: Effector[] = [];
  const damageEffectors: Effector[] = [];
  const rangeEffectors: Effector[] = [];
  
  if (context.tool) {
    const itemEffectors = effectorRegistry.getItemEffectors(context.tool);
    
    for (const eff of itemEffectors) {
      // Categorize effectors based on type and description
      if (eff.type === "SHIFT" && eff.description?.includes("range")) {
        rangeEffectors.push(eff);
      } else if (eff.type === "SCALE" && eff.description?.includes("range")) {
        rangeEffectors.push(eff);
      } else if (eff.type === "SHIFT" && eff.description?.includes("damage")) {
        damageEffectors.push(eff);
      } else if (eff.type === "SCALE" && eff.description?.includes("damage")) {
        damageEffectors.push(eff);
      } else if (eff.type === "SHIFT" && eff.description?.includes("roll")) {
        rollEffectors.push(eff);
      } else {
        // Default: apply to rolls
        rollEffectors.push(eff);
      }
    }
  }
  
  return { rollEffectors, damageEffectors, rangeEffectors };
}

// Export individual handlers for testing
export {
  getDamageDice,
  calculateScatterLocation,
  handleInspect,
  getBestSenseForDistance,
  calculateInspectRange,
  isInspectable,
  formatInspectRange
};

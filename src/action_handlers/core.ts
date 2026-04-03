// Action Handlers - Core Actions Implementation
// Phase 3 & 5: Core Actions with Effector Integration

import type { Location } from "../action_system/intent.js";
import type { TaggedItem } from "../tag_system/registry.js";
import type { ActionCapability } from "../tag_system/capabilities.js";
import { get_resolved_tag_stored_mag } from "../tag_system/canonical_readers.js";
import { get_damage_dice_from_mag } from "../mag/damage.js";
import { performPotencyRoll } from "../roll_system/index.js";
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

function get_runtime_tag_power(entity: TaggedItem | undefined, tag_name: string): number {
  if (!entity) return 0;
  const resolved_mag = get_resolved_tag_stored_mag(entity as any, tag_name);
  if (resolved_mag > 0) return resolved_mag;
  const raw_match = Array.isArray(entity.tags)
    ? entity.tags.find((tag) => String(tag?.name ?? '').trim().toUpperCase() === String(tag_name ?? '').trim().toUpperCase())
    : null;
  return raw_match ? Math.max(0, Math.floor(Number(raw_match.mag ?? 0) || 0)) : 0;
}

function get_target_kind(targetRef: string | undefined): "character" | "item" | "tile" | "unknown" {
  const ref = String(targetRef ?? "").trim();
  if (ref.startsWith("actor.") || ref.startsWith("npc.")) return "character";
  if (ref.startsWith("item.")) return "item";
  if (ref.startsWith("tile.") || ref.startsWith("place_tile.") || ref.startsWith("region_tile.") || ref.startsWith("world_tile.")) return "tile";
  return "unknown";
}

function get_tool_base_mag(tool: TaggedItem | undefined, capability: ActionCapability | undefined): number {
  return capability?.source_tag ? Math.max(1, get_runtime_tag_power(tool, capability.source_tag)) : 1;
}

function get_projectile_ammo_mag(ammo: TaggedItem | undefined): number {
  if (!ammo) return 0;
  const tag_bonus = Math.max(0, get_runtime_tag_power(ammo, "PROJECTILE"));
  return tag_bonus > 0 ? tag_bonus : 1;
}

async function handleTransferItem(_context: ActionContext): Promise<ActionResult> {
  return {
    success: true,
    effects: [],
    messages: ["Transfer item action resolved through legality pipeline"],
  };
}

async function handleEquipItem(_context: ActionContext): Promise<ActionResult> {
  return {
    success: true,
    effects: [],
    messages: ["Equip item action resolved through legality pipeline"],
  };
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
  const hit = parameters.hit !== false;
  const targetKind = get_target_kind(targetRef);
  const toolMAG = get_tool_base_mag(tool, capability);
  const baseDamageMAG = parameters.damageMAG || toolMAG;
  
  // Apply effectors to damage (Phase 5)
  let damageEffectors: Effector[] = [];
  
  if (tool) {
    damageEffectors = effectorRegistry.getItemEffectors(tool);
  }
  
  const potency = hit ? performPotencyRoll(baseDamageMAG, damageEffectors) : null;
  const damageDice = potency?.dice ?? get_damage_dice_from_mag(baseDamageMAG);
  const totalDamage = potency?.total ?? 0;
  
  return {
    success: true,
    effects: [{
      type: "ATTACK",
      target: targetRef,
      parameters: {
        attacker: actorRef,
        weapon: tool?.ref,
        hit,
        target_kind: targetKind,
        damage_dice: damageDice,
        damage_mag: totalDamage,
        base_damage_mag: baseDamageMAG,
        potency_roll_total: totalDamage,
        potency_roll_nat: potency?.roll ?? 0,
        effectors: damageEffectors.map(e => ({ type: e.type, value: e.value, source: e.source })),
        range: "MELEE"
      }
    }],
    messages: hit
      ? [`${actorRef} attacks ${targetRef} with ${tool?.name || "unarmed"} (${damageDice}${targetKind !== 'character' ? ', damage stub only' : ''})`]
      : [`${actorRef} attacks ${targetRef} with ${tool?.name || "unarmed"} and misses.`]
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
  
  const baseRoll = parameters.roll || 10;
  let attackEffectors: Effector[] = [];
  if (tool) {
    attackEffectors = effectorRegistry.getItemEffectors(tool);
  }
  const modifiedAttack = calculateModifiedRoll(baseRoll, attackEffectors);
  const roll = modifiedAttack.finalValue;
  const cr = parameters.cr || 10;
  
  const hit = parameters.hit !== false;
  let scatterDistance = 0;
  if (!hit) {
    const missBy = cr - roll;
    scatterDistance = Math.ceil(missBy / 3);
  }
  
  // Determine if projectile sticks
  const sticks = hit && parameters.sticks !== false;
  
  const toolMAG = get_tool_base_mag(tool, capability);
  const ammoMAG = get_projectile_ammo_mag(ammo);
  const baseTotalMAG = toolMAG + ammoMAG;
  
  let damageEffectors: Effector[] = [];
  if (tool) {
    damageEffectors = effectorRegistry.getItemEffectors(tool);
  }
  const potency = hit ? performPotencyRoll(baseTotalMAG, damageEffectors) : null;
  const damageDice = potency?.dice ?? get_damage_dice_from_mag(baseTotalMAG);
  
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
    damage: hit ? (potency?.total ?? baseTotalMAG) : 0
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
        damage_mag: hit ? (potency?.total ?? baseTotalMAG) : 0,
        base_damage_mag: baseTotalMAG,
        potency_roll_total: hit ? (potency?.total ?? baseTotalMAG) : 0,
        potency_roll_nat: potency?.roll ?? 0,
        target_kind: get_target_kind(targetRef),
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
      ? [`${actorRef} hits ${targetRef} with ${projectile.name}! (Range: ${finalRange}, Potency: ${damageDice})`]
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
      } else if (subtype === "TRANSFER_ITEM") {
        return handleTransferItem(context);
      } else if (subtype === "EQUIP_ITEM") {
        return handleEquipItem(context);
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
  calculateScatterLocation,
  handleInspect,
  getBestSenseForDistance,
  calculateInspectRange,
  isInspectable,
  formatInspectRange
};

// Target Resolution System
// Unified target resolution for both Players and NPCs

import type { ActionVerb } from "../shared/constants.js";
import type { TargetType, ActionDefinition } from "./registry.js";
import { ACTION_REGISTRY, isValidTargetType } from "./registry.js";
import type { ActionIntent, Location } from "./intent.js";
import { get_entities_in_place } from "../place_storage/entity_index.js";
import { load_npc } from "../npc_storage/store.js";
import { load_actor } from "../actor_storage/store.js";
import { get_npc_location } from "../npc_storage/location.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

// Context for target resolution
export interface TargetResolutionContext {
  actorRef: string;
  actorLocation: Location;
  verb: ActionVerb;
  availableTargets: AvailableTarget[];
  lastTarget?: string;
  messageText?: string;
  impliedTarget?: string;
}

// Available target from UI/API
export interface AvailableTarget {
  ref: string;
  type: TargetType;
  name: string;
  location: Location;
  distance?: number;
  isHostile?: boolean;
  isFriendly?: boolean;
}

// Target resolution result
export interface TargetResolutionResult {
  ref: string;
  type: TargetType;
  location: Location;
  resolutionMethod: "explicit" | "ui_selection" | "mention" | "context" | "default" | "auto";
  confidence: number;  // 0-1, for debugging/AI uncertainty
}

// Validation result
export interface TargetValidationResult {
  valid: boolean;
  reason?: string;
  type?: TargetType;
  distance?: number;
}

// Parse @mention from text
export function parseMentionTarget(
  text: string,
  availableTargets: AvailableTarget[]
): { ref: string; type: TargetType } | null {
  // Match @Name or @"Multi Word Name"
  const mentionMatch = text.match(/@(?:"([^"]+)"|(\S+))/);
  if (!mentionMatch) return null;
  
  const mentionName = (mentionMatch[1] ?? mentionMatch[2] ?? "").toLowerCase();
  if (!mentionName) return null;
  
  // Find matching target
  const match = availableTargets.find(t => 
    t.name.toLowerCase() === mentionName ||
    t.name.toLowerCase().includes(mentionName) ||
    t.ref.toLowerCase().includes(mentionName)
  );
  
  if (match) {
    return { ref: match.ref, type: match.type };
  }
  
  return null;
}

// Calculate distance between two locations
export function calculateDistance(loc1: Location, loc2: Location): number {
  // If same region, use tile distance
  if (loc1.world_x === loc2.world_x && 
      loc1.world_y === loc2.world_y &&
      loc1.region_x === loc2.region_x && 
      loc1.region_y === loc2.region_y) {
    if (loc1.x !== undefined && loc1.y !== undefined && 
        loc2.x !== undefined && loc2.y !== undefined) {
      return Math.sqrt(
        Math.pow(loc1.x - loc2.x, 2) + 
        Math.pow(loc1.y - loc2.y, 2)
      );
    }
  }
  
  // Different region - use world distance (approximate)
  const world_dx = (loc1.world_x - loc2.world_x) * 1000;  // Assume regions are ~1000 units apart
  const world_dy = (loc1.world_y - loc2.world_y) * 1000;
  return Math.sqrt(world_dx * world_dx + world_dy * world_dy);
}

// Validate a target reference
export async function validateTarget(
  targetRef: string,
  actionDef: ActionDefinition,
  actorLocation: Location,
  actorRef: string
): Promise<TargetValidationResult> {
  // Determine target type from ref
  let targetType: TargetType | null = null;
  
  if (targetRef.startsWith("actor.")) targetType = "character";
  else if (targetRef.startsWith("npc.")) targetType = "character";
  else if (targetRef.startsWith("item.")) targetType = "item";
  else if (targetRef.startsWith("tile.")) targetType = "tile";
  else if (targetRef.startsWith("region_tile.")) targetType = "region_tile";
  else if (targetRef.startsWith("place.")) targetType = "place";
  else if (targetRef.startsWith("place_tile.")) targetType = "place_tile";
  else if (targetRef.startsWith("actor.") && targetRef.includes("body_slots")) {
    targetType = "body_slot";
  }
  
  if (!targetType) {
    return { valid: false, reason: `Unknown target type for: ${targetRef}` };
  }
  
  // Check if target type is valid for this action
  if (!isValidTargetType(actionDef.verb, targetType)) {
    return { 
      valid: false, 
      reason: `Target type "${targetType}" not valid for ${actionDef.verb}` 
    };
  }
  
  // Check range (would need to load target location from storage in real implementation)
  // For now, assume it's valid if within range
  
  return { valid: true, type: targetType };
}

// Resolve implied target based on context
export async function resolveImpliedTarget(
  intent: ActionIntent,
  context: TargetResolutionContext
): Promise<TargetResolutionResult | null> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  if (!actionDef) return null;
  
  // Priority 1: UI explicit target (highest priority for players)
  if (intent.source === "player_input" && context.impliedTarget) {
    const validation = await validateTarget(
      context.impliedTarget, 
      actionDef, 
      intent.actorLocation,
      intent.actorRef
    );
    if (validation.valid) {
      return {
        ref: context.impliedTarget,
        type: validation.type!,
        location: context.actorLocation,  // Would need to load actual location
        resolutionMethod: "ui_selection",
        confidence: 1.0
      };
    }
  }
  
  // Priority 2: @mention in message text
  if (intent.originalInput) {
    const mentionTarget = parseMentionTarget(intent.originalInput, context.availableTargets);
    if (mentionTarget) {
      const target = context.availableTargets.find(t => t.ref === mentionTarget.ref);
      if (target) {
        return {
          ref: mentionTarget.ref,
          type: mentionTarget.type,
          location: target.location,
          resolutionMethod: "mention",
          confidence: 0.95
        };
      }
    }
  }
  
  // Priority 3: Context-based for NPCs
  if (intent.source === "ai_decision") {
    return resolveNPCContextTarget(intent, context, actionDef);
  }
  
  // Priority 4: Default targeting based on action type
  return resolveDefaultTarget(intent, actionDef, context);
}

// Resolve target based on NPC context
function resolveNPCContextTarget(
  intent: ActionIntent,
  context: TargetResolutionContext,
  actionDef: ActionDefinition
): TargetResolutionResult | null {
  // For NPCs, the AI should have already provided a target
  // This is mainly for validation and fallback
  
  if (intent.targetRef) {
    const target = context.availableTargets.find(t => t.ref === intent.targetRef);
    if (target) {
      return {
        ref: intent.targetRef,
        type: target.type,
        location: target.location,
        resolutionMethod: "context",
        confidence: 0.9
      };
    }
  }
  
  // Fallback: find best target based on action type
  const candidates = context.availableTargets.filter(t => {
    if (!isValidTargetType(intent.verb, t.type)) return false;
    
    // Check distance
    const distance = calculateDistance(intent.actorLocation, t.location);
    if (distance > actionDef.targetRange) return false;
    
    // Check hostility requirements
    if (actionDef.requiresHostileTarget && !t.isHostile) return false;
    if (actionDef.requiresFriendlyTarget && !t.isFriendly) return false;
    
    return true;
  });
  
  if (candidates.length > 0) {
    // Pick closest valid target
    const closest = candidates.reduce((best, current) => {
      const bestDist = calculateDistance(intent.actorLocation, best.location);
      const currentDist = calculateDistance(intent.actorLocation, current.location);
      return currentDist < bestDist ? current : best;
    });
    
    return {
      ref: closest.ref,
      type: closest.type,
      location: closest.location,
      resolutionMethod: "auto",
      confidence: 0.7
    };
  }
  
  return null;
}

// Resolve default target based on action type
function resolveDefaultTarget(
  intent: ActionIntent,
  actionDef: ActionDefinition,
  context: TargetResolutionContext
): TargetResolutionResult | null {
  // COMMUNICATE: Can target area (no specific target needed)
  if (intent.verb === "COMMUNICATE" && !actionDef.targetRequired) {
    return {
      ref: `region_tile.${intent.actorLocation.world_x}.${intent.actorLocation.world_y}.${intent.actorLocation.region_x}.${intent.actorLocation.region_y}`,
      type: "region_tile",
      location: intent.actorLocation,
      resolutionMethod: "default",
      confidence: 0.8
    };
  }
  
  // MOVE: Use last known destination or current location
  if (intent.verb === "MOVE") {
    // For MOVE, the target should always be specified
    // Return null to require explicit target
    return null;
  }
  
  // DEFEND: Default to self if not targeting ally
  if (intent.verb === "DEFEND" && actionDef.allowSelf) {
    return {
      ref: intent.actorRef,
      type: "self",
      location: intent.actorLocation,
      resolutionMethod: "default",
      confidence: 0.9
    };
  }
  
  // ATTACK/HELP: Use last target if still valid
  if (context.lastTarget && (intent.verb === "ATTACK" || intent.verb === "HELP")) {
    const lastTarget = context.availableTargets.find(t => t.ref === context.lastTarget);
    if (lastTarget) {
      const distance = calculateDistance(intent.actorLocation, lastTarget.location);
      if (distance <= actionDef.targetRange) {
        return {
          ref: lastTarget.ref,
          type: lastTarget.type,
          location: lastTarget.location,
          resolutionMethod: "context",
          confidence: 0.75
        };
      }
    }
  }
  
  return null;
}

// Main target resolution function
export async function resolveTarget(
  intent: ActionIntent,
  availableTargets: AvailableTarget[],
  options: {
    uiSelectedTarget?: string;
    lastTarget?: string;
  } = {}
): Promise<ActionIntent> {
  const actionDef = ACTION_REGISTRY[intent.verb];
  
  // If action doesn't require target, return as-is
  if (!actionDef || !actionDef.targetRequired) {
    return intent;
  }
  
  // If target already specified in intent, validate it
  if (intent.targetRef) {
    const validation = await validateTarget(
      intent.targetRef,
      actionDef,
      intent.actorLocation,
      intent.actorRef
    );
    
    if (validation.valid) {
      return {
        ...intent,
        targetType: validation.type
      };
    }
    
    // Target invalid, try to resolve
  }
  
  // Build resolution context
  const context: TargetResolutionContext = {
    actorRef: intent.actorRef,
    actorLocation: intent.actorLocation,
    verb: intent.verb,
    availableTargets,
    lastTarget: options.lastTarget,
    messageText: intent.originalInput,
    impliedTarget: options.uiSelectedTarget
  };
  
  // Try to resolve implied target
  const resolved = await resolveImpliedTarget(intent, context);
  
  if (resolved) {
    return {
      ...intent,
      targetRef: resolved.ref,
      targetType: resolved.type,
      targetLocation: resolved.location,
      parameters: {
        ...intent.parameters,
        targetResolution: resolved.resolutionMethod,
        targetConfidence: resolved.confidence
      }
    };
  }
  
  // Failed to resolve target
  return {
    ...intent,
    status: "failed",
    failureReason: `Could not resolve target for ${intent.verb}`
  };
}

// Get available targets for a location
// Queries the entity index to find NPCs and actors in the same place
export async function getAvailableTargets(
  location: Location,
  radius: number = 50
): Promise<AvailableTarget[]> {
  const data_slot = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
  const targets: AvailableTarget[] = [];
  
  // Need place_id to look up entities
  const place_id = (location as any).place_id;
  if (!place_id) {
    return targets;
  }
  
  // Get all entities in this place from the index
  const entities = get_entities_in_place(data_slot, place_id);
  
  // Process NPCs
  for (const npc_ref of entities.npcs) {
    const npc_id = npc_ref.replace("npc.", "");
    
    const npc_result = load_npc(data_slot, npc_id);
    
    if (!npc_result.ok || !npc_result.npc) {
      continue;
    }
    
    const npc_location = get_npc_location(npc_result.npc);
    if (!npc_location) {
      continue;
    }
    
    // Calculate distance (in tile space within the place)
    const npc_tile_pos = npc_location.tile;
    const actor_tile_pos = { x: location.x ?? 0, y: location.y ?? 0 };
    const distance = Math.sqrt(
      Math.pow(npc_tile_pos.x - actor_tile_pos.x, 2) +
      Math.pow(npc_tile_pos.y - actor_tile_pos.y, 2)
    );
    
    if (distance <= radius) {
      targets.push({
        ref: npc_ref,
        type: "character",
        name: (npc_result.npc.name as string) || npc_id,
        location: {
          world_x: npc_location.world_tile.x,
          world_y: npc_location.world_tile.y,
          region_x: npc_location.region_tile.x,
          region_y: npc_location.region_tile.y,
          x: npc_tile_pos.x,
          y: npc_tile_pos.y,
          place_id: place_id
        },
        distance
      });
    }
  }
  
  // Process Actors
  for (const actor_ref of entities.actors) {
    const actor_id = actor_ref.replace("actor.", "");
    const actor_result = load_actor(data_slot, actor_id);
    
    if (!actor_result.ok || !actor_result.actor) {
      continue;
    }
    
    const actor_loc = (actor_result.actor as any).location;
    if (!actor_loc?.tile) {
      continue;
    }
    
    // Calculate distance
    const actor_tile_pos = { x: location.x ?? 0, y: location.y ?? 0 };
    const other_tile_pos = actor_loc.tile;
    const distance = Math.sqrt(
      Math.pow(other_tile_pos.x - actor_tile_pos.x, 2) +
      Math.pow(other_tile_pos.y - actor_tile_pos.y, 2)
    );
    
    if (distance <= radius) {
      targets.push({
        ref: actor_ref,
        type: "character",
        name: (actor_result.actor.name as string) || actor_id,
        location: {
          world_x: actor_loc.world_tile?.x ?? 0,
          world_y: actor_loc.world_tile?.y ?? 0,
          region_x: actor_loc.region_tile?.x ?? 0,
          region_y: actor_loc.region_tile?.y ?? 0,
          x: other_tile_pos.x,
          y: other_tile_pos.y,
          place_id: place_id
        },
        distance
      });
    }
  }
  
  console.log(`[getAvailableTargets] COMPLETE: Returning ${targets.length} targets`);
  for (const t of targets) {
    console.log(`[getAvailableTargets]   - ${t.ref} at (${t.location.x}, ${t.location.y}) distance=${t.distance}`);
  }
  
  return targets;
}

// Check if actor is aware of target
export async function checkAwareness(
  actorRef: string,
  targetRef: string
): Promise<boolean> {
  // This would check the awareness system
  // For now, return true
  return true;
}

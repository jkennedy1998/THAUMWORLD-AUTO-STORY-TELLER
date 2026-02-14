// Action Handlers - INSPECT Action
// Phase 4: INSPECT System Integration
// Uses existing src/inspection system

import type { Location } from "../action_system/intent.js";
import type { TaggedItem } from "../tag_system/index.js";
import type { ActionContext, ActionResult } from "./core.js";
import { inspect_target, type InspectorData, type InspectionTarget, type InspectionResult } from "../inspection/data_service.js";
import {
  calculate_clarity,
  calculate_distance,
  get_best_inspection_sense,
  type SenseType,
  type ClarityLevel
} from "../inspection/clarity_system.js";

/**
 * INSPECT Action Handler
 * 
 * Single INSPECT action with detail determined by distance MAG.
 * Uses the best available sense from body slots.
 * 
 * Senses:
 * - light (sight): Best for most inspection
 * - pressure (hearing/touch): Good for movement/vibration
 * - aroma (smell): Good for tracking/substances
 * - thaumic (magic sense): Detects magical auras
 * 
 * Distance MAG Table:
 * - MAG 0 = within 1 tile (clear detail)
 * - MAG 1 = 1 tile (clear detail)
 * - MAG 2 = 3 tiles (clear detail)
 * - MAG 3 = 5 tiles (clear detail)
 * - MAG 4 = 10 tiles (vague/obscured)
 * - MAG 5+ = beyond inspect range
 */
export async function handleInspect(
  context: ActionContext
): Promise<ActionResult> {
  const { actorRef, targetRef, actorLocation, targetLocation, parameters } = context;
  
  if (!targetRef) {
    return {
      success: false,
      effects: [],
      messages: ["No target to inspect"]
    };
  }

  const inspector = parameters.inspector_data as InspectorData | undefined;
  if (!inspector || !inspector.location || !inspector.senses) {
    return {
      success: false,
      effects: [],
      messages: ["Missing inspector data"]
    };
  }

  // Build an InspectionTarget for the inspection data service.
  const target: InspectionTarget = (() => {
    if (targetRef.startsWith("npc.")) {
      return { type: "npc", ref: targetRef, place_id: actorLocation.place_id };
    }
    if (targetRef.startsWith("actor.")) {
      return { type: "character", ref: targetRef, place_id: actorLocation.place_id };
    }
    if (targetRef.startsWith("item.")) {
      return { type: "item", ref: targetRef, place_id: actorLocation.place_id };
    }
    if (targetRef.startsWith("tile.")) {
      const tile_id = targetRef.slice("tile.".length);
      const tp = targetLocation && typeof targetLocation.x === 'number' && typeof targetLocation.y === 'number'
        ? { x: targetLocation.x, y: targetLocation.y }
        : undefined;
      return { type: "tile", ref: tile_id, place_id: actorLocation.place_id, tile_position: tp };
    }
    // Fallback: treat unknown refs as item-like.
    return { type: "item", ref: targetRef, place_id: actorLocation.place_id };
  })();

  // Ensure target_location is present for distance/clarity.
  let resolved_target_location = targetLocation;
  if (!resolved_target_location && target.type === 'tile' && target.tile_position) {
    resolved_target_location = {
      ...inspector.location,
      x: target.tile_position.x,
      y: target.tile_position.y,
    };
  }

  const requested_keywords = Array.isArray(parameters.requested_keywords)
    ? (parameters.requested_keywords as any[]).filter((k) => typeof k === 'string')
    : undefined;

  const max_features = typeof parameters.max_features === 'number' ? parameters.max_features : 5;
  const target_size_mag = typeof parameters.target_size_mag === 'number' ? parameters.target_size_mag : 0;

  let result: InspectionResult;
  try {
    result = await inspect_target(inspector, target, {
      requested_keywords,
      max_features,
      target_location: resolved_target_location,
      target_size_mag,
    });
  } catch {
    return {
      success: false,
      effects: [],
      messages: ["Inspection failed"]
    };
  }

  return {
    success: true,
    effects: [{
      type: "INSPECT",
      target: targetRef,
      parameters: {
        inspector: actorRef,
        inspection_result: result,
      }
    }],
    messages: [`INSPECT ${targetRef}: ${result.clarity} (${result.sense_used})`]
  };
}

/**
 * Get inspection details based on clarity level
 */
function getInspectionDetails(
  clarity: ClarityLevel,
  targetRef: string,
  senseType: SenseType
): string[] {
  const details: string[] = [];
  
  switch (clarity) {
    case "clear":
      details.push(`You can see ${targetRef} clearly.`);
      details.push("- Physical appearance: Visible in detail");
      details.push("- Equipment: Can be identified");
      details.push("- Condition: Apparent");
      if (senseType === "thaumic") {
        details.push("- Magical aura: Detected and identifiable");
      }
      break;
      
    case "vague":
      details.push(`You can see ${targetRef}, but details are obscured.`);
      details.push("- Physical appearance: General shape only");
      details.push("- Equipment: Indistinct");
      details.push("- Condition: Hard to determine");
      if (senseType === "thaumic") {
        details.push("- Magical aura: Detected but not identifiable");
      }
      break;
      
    case "obscured":
      details.push(`You can barely perceive ${targetRef}.`);
      details.push("- Physical appearance: Just a shape");
      details.push("- Equipment: Not visible");
      details.push("- Condition: Unknown");
      break;
      
    case "none":
      details.push(`You cannot perceive ${targetRef} at this distance.`);
      break;
  }
  
  return details;
}

/**
 * Get the best sense for a given distance
 * Returns the sense with highest clarity at this distance
 */
export function getBestSenseForDistance(
  distance: number,
  senses: Array<{ type: SenseType; mag: number }>
): { type: SenseType; mag: number; clarity: ClarityLevel } | null {
  let bestSense: { type: SenseType; mag: number; clarity: ClarityLevel } | null = null;
  let bestClarityRank = -1;
  
  const clarityRanks: Record<ClarityLevel, number> = {
    clear: 3,
    vague: 2,
    obscured: 1,
    none: 0
  };
  
  for (const sense of senses) {
    const clarity = calculate_clarity(distance, sense.type, sense.mag, 0);
    const rank = clarityRanks[clarity];
    
    if (rank > bestClarityRank) {
      bestClarityRank = rank;
      bestSense = { ...sense, clarity };
    }
  }
  
  return bestSense;
}

/**
 * Calculate INSPECT range for an actor
 * Based on their best sense
 */
export function calculateInspectRange(actor: {
  body_slots?: Record<string, { name: string; item?: TaggedItem }>;
}): number {
  // Default: 10 tiles (sight MAG 3)
  let maxRange = 10;
  
  // Check body slots for enhanced senses
  if (actor.body_slots) {
    for (const slot of Object.values(actor.body_slots)) {
      if (slot.item && typeof slot.item === "object") {
        const item = slot.item as TaggedItem;
        
        // Check for sense-enhancing items
        const hasSightEnhancement = item.tags?.some(t => 
          t.name === "spyglass" || t.name === "eagle_eye"
        );
        
        if (hasSightEnhancement) {
          maxRange += 5; // +5 tiles per enhancement
        }
      }
    }
  }
  
  return maxRange;
}

/**
 * Check if target is inspectable at given distance
 */
export function isInspectable(
  distance: number,
  senses: Array<{ type: SenseType; mag: number }>
): boolean {
  const bestSense = getBestSenseForDistance(distance, senses);
  return bestSense !== null && bestSense.clarity !== "none";
}

/**
 * Format inspection range for display
 */
export function formatInspectRange(range: number): string {
  if (range <= 1) return "touch range";
  if (range <= 3) return "close range";
  if (range <= 10) return "medium range";
  if (range <= 30) return "long range";
  return "very long range";
}

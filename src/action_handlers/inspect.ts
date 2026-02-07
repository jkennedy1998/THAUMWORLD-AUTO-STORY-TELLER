// Action Handlers - INSPECT Action
// Phase 4: INSPECT System Integration
// Uses existing src/inspection system

import type { Location } from "../action_system/intent.js";
import type { TaggedItem } from "../tag_system/index.js";
import type { ActionContext, ActionResult } from "./core.js";
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
  
  if (!targetRef || !targetLocation) {
    return {
      success: false,
      effects: [],
      messages: ["No target to inspect"]
    };
  }
  
  // Calculate distance
  const distance = calculate_distance(actorLocation, targetLocation);
  
  // Get inspector's senses from body slots
  // Convert array format to Record format expected by clarity system
  const senseArray: Array<{ type: SenseType; mag: number }> = parameters.senses || [
    { type: "light", mag: 3 },      // Human sight
    { type: "pressure", mag: 2 },   // Hearing/touch
    { type: "aroma", mag: 1 }       // Smell
  ];
  
  // Convert to Record format
  const senses: Record<SenseType, number> = {
    light: 0,
    pressure: 0,
    aroma: 0,
    thaumic: 0
  };
  
  for (const sense of senseArray) {
    senses[sense.type] = sense.mag;
  }
  
  // Find the best sense for this distance
  const bestSense = get_best_inspection_sense(distance, senses);
  
  if (!bestSense) {
    return {
      success: false,
      effects: [],
      messages: [`${targetRef} is too far to inspect (distance: ${distance.toFixed(1)} tiles)`]
    };
  }
  
  // Calculate clarity
  const targetSizeMag = parameters.targetSizeMag || 0; // Default size
  const clarity = calculate_clarity(
    distance,
    bestSense.sense,
    senses[bestSense.sense],
    targetSizeMag
  );
  
  // Build inspection result based on clarity
  const inspectionDetails = getInspectionDetails(clarity, targetRef, bestSense.sense);
  
  return {
    success: true,
    effects: [{
      type: "INSPECT",
      target: targetRef,
      parameters: {
        inspector: actorRef,
        distance,
        sense_type: bestSense.sense,
        sense_mag: senses[bestSense.sense],
        clarity,
        details: inspectionDetails
      }
    }],
    messages: [
      `${actorRef} inspects ${targetRef} using ${bestSense.sense} sense (${clarity} clarity)`,
      ...inspectionDetails
    ]
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

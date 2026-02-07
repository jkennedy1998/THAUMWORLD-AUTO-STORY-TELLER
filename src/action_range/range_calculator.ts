// Action Range System - Range Calculator (Tag System Integration)
// Calculates effective ranges using the tag resolver

import type { Location } from "../action_system/intent.js";
import {
  TagResolver,
  tagRegistry,
  initializeDefaultRules,
  calculateWeightMAG,
  type TaggedItem,
  type ActionCapability
} from "../tag_system/index.js";

// Initialize default rules
initializeDefaultRules();

// Create resolver
const resolver = new TagResolver(tagRegistry);

/**
 * Range types
 */
export type RangeType = 
  | "TOUCH"
  | "MELEE"
  | "THROWN"
  | "PROJECTILE"
  | "SIGHT"
  | "UNLIMITED";

/**
 * Range categories
 */
export interface RangeCategory {
  type: RangeType;
  baseRange: number;
  maxRange: number;
  penaltyPerTile: number;
}

export const RANGE_CATEGORIES: Record<RangeType, RangeCategory> = {
  TOUCH: {
    type: "TOUCH",
    baseRange: 1,
    maxRange: 1,
    penaltyPerTile: 0
  },
  MELEE: {
    type: "MELEE",
    baseRange: 1,
    maxRange: 2,
    penaltyPerTile: 0
  },
  THROWN: {
    type: "THROWN",
    baseRange: 5,
    maxRange: 20,
    penaltyPerTile: 2
  },
  PROJECTILE: {
    type: "PROJECTILE",
    baseRange: 30,
    maxRange: 120,
    penaltyPerTile: 1
  },
  SIGHT: {
    type: "SIGHT",
    baseRange: 60,
    maxRange: 120,
    penaltyPerTile: 0.5
  },
  UNLIMITED: {
    type: "UNLIMITED",
    baseRange: Infinity,
    maxRange: Infinity,
    penaltyPerTile: 0
  }
};

/**
 * Calculate effective range using tag resolver
 * 
 * @param tool - The tool being used
 * @param actionType - Action type (e.g., "USE.PROJECTILE_SINGLE")
 * @param throwerSTR - Thrower's strength (for thrown weapons)
 * @returns Effective range in tiles
 */
export function calculateEffectiveRange(
  tool: TaggedItem,
  actionType: string,
  throwerSTR?: number
): number {
  const capability = resolver.getActionCapability(tool, actionType);
  
  if (!capability) {
    // Default to THROWN if no capability found
    return RANGE_CATEGORIES.THROWN.baseRange;
  }
  
  let range = capability.range.effective;
  
  // Apply strength bonus for thrown weapons
  if (capability.range.category === "THROWN" && throwerSTR !== undefined) {
    // Strength increases thrown range
    range = Math.floor(range * (1 + (throwerSTR - 10) / 20));
  }
  
  return range;
}

/**
 * Calculate distance between two locations
 */
export function calculateDistance(loc1: Location, loc2: Location): number {
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
  
  const world_dx = (loc1.world_x - loc2.world_x) * 1000;
  const world_dy = (loc1.world_y - loc2.world_y) * 1000;
  
  let region_dx = 0;
  let region_dy = 0;
  
  if (loc1.region_x !== undefined && loc2.region_x !== undefined) {
    region_dx = (loc1.region_x - loc2.region_x) * 100;
    region_dy = (loc1.region_y - loc2.region_y) * 100;
  }
  
  return Math.sqrt(
    Math.pow(world_dx + region_dx, 2) + 
    Math.pow(world_dy + region_dy, 2)
  );
}

/**
 * Calculate range penalty for extended distances
 */
export function calculateRangePenalty(
  distance: number,
  baseRange: number,
  rangeType: RangeType
): number {
  const category = RANGE_CATEGORIES[rangeType];
  
  if (distance <= baseRange) {
    return 0;
  }
  
  if (distance > category.maxRange) {
    return -Infinity;
  }
  
  const excessDistance = distance - baseRange;
  return -(excessDistance * category.penaltyPerTile);
}

/**
 * Determine range type from tool capability
 */
export function getRangeType(
  tool: TaggedItem,
  actionType: string
): RangeType {
  const capability = resolver.getActionCapability(tool, actionType);
  
  if (!capability) {
    return "THROWN"; // Default
  }
  
  return capability.range.category as RangeType;
}

/**
 * Check if target is within range
 */
export function isWithinRange(
  actorLocation: Location,
  targetLocation: Location,
  maxRange: number
): boolean {
  const distance = calculateDistance(actorLocation, targetLocation);
  return distance <= maxRange;
}

/**
 * Get optimal range for action
 */
export function getOptimalRange(
  tool: TaggedItem,
  actionType: string
): number {
  const capability = resolver.getActionCapability(tool, actionType);
  
  if (!capability) {
    return RANGE_CATEGORIES.THROWN.baseRange;
  }
  
  const category = RANGE_CATEGORIES[capability.range.category as RangeType];
  
  // Optimal is usually 80-90% of max for ranged, close for melee
  if (capability.range.category === "PROJECTILE") {
    return Math.floor(capability.range.effective * 0.8);
  }
  
  if (capability.range.category === "THROWN") {
    return Math.floor(capability.range.effective * 0.9);
  }
  
  return category.baseRange;
}

/**
 * Format range for display
 */
export function formatRange(range: number): string {
  if (range === Infinity) return "∞ tiles";
  return `${Math.round(range)} tiles`;
}

/**
 * Get range description
 */
export function getRangeDescription(range: number): string {
  if (range === Infinity) return "unlimited";
  if (range <= 1) return "touch";
  if (range <= 5) return "very close";
  if (range <= 15) return "close";
  if (range <= 30) return "medium";
  if (range <= 60) return "long";
  if (range <= 120) return "very long";
  return "extreme";
}

/**
 * Validate if target is within range
 * Simple validation for action pipeline
 */
export function validateRange(
  actorLocation: Location,
  targetLocation: Location,
  baseRange: number,
  actionVerb: string,
  toolData?: { mag: number; tags: string[] }
): { valid: boolean; reason?: string; penalty: number; distance: number } {
  const distance = calculateDistance(actorLocation, targetLocation);
  
  if (distance > baseRange) {
    return {
      valid: false,
      reason: `Target out of range (${distance.toFixed(1)} > ${baseRange})`,
      penalty: -Infinity,
      distance
    };
  }
  
  return {
    valid: true,
    penalty: 0,
    distance
  };
}

export { calculateWeightMAG };
export type { TaggedItem, ActionCapability };

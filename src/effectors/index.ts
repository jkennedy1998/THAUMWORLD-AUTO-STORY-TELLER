// Effector System - SHIFT and SCALE Modifiers
// Phase 5: Effector application for rolls and ranges
// Integrates with existing rules_lawyer effector system

import type { TaggedItem, TagInstance } from "../tag_system/index.js";

/**
 * Effector types
 */
export type EffectorType = "SHIFT" | "SCALE";

/**
 * Effector definition
 */
export interface Effector {
  type: EffectorType;
  value: number;
  source: string;  // What applied this effector (tag, perk, condition, etc.)
  description?: string;
}

/**
 * Effector application context
 */
export interface EffectorContext {
  actorRef: string;
  actionType: string;
  tool?: TaggedItem;
  targetRef?: string;
  distance?: number;
  baseValue: number;
}

/**
 * Effector calculation result
 */
export interface EffectorResult {
  originalValue: number;
  finalValue: number;
  shift: number;
  scale: number;
  effectors: Effector[];
}

/**
 * Effector Registry
 * Stores all effector sources and their values
 */
export class EffectorRegistry {
  private effectorSources: Map<string, Effector[]> = new Map();

  /**
   * Register effectors from a tag
   */
  registerTagEffectors(tagName: string, effectors: Effector[]): void {
    this.effectorSources.set(`tag:${tagName}`, effectors);
  }

  /**
   * Get effectors for a specific source
   */
  getEffectors(source: string): Effector[] {
    return this.effectorSources.get(source) || [];
  }

  /**
   * Get all effectors from an item's tags
   */
  getItemEffectors(item: TaggedItem): Effector[] {
    const allEffectors: Effector[] = [];
    
    for (const tag of item.tags) {
      const tagEffectors = this.getEffectors(`tag:${tag.name}`);
      allEffectors.push(...tagEffectors);
      
      // Add stack-based effectors (more stacks = stronger effect)
      if (tag.stacks > 1) {
        for (const eff of tagEffectors) {
          allEffectors.push({
            ...eff,
            value: eff.value * (tag.stacks - 1),  // Additional stacks add more
            source: `${eff.source} (stack ${tag.stacks})`
          });
        }
      }
    }
    
    return allEffectors;
  }
}

// Singleton instance
export const effectorRegistry = new EffectorRegistry();

/**
 * Default tag effectors
 * These define what effectors tags provide
 */
export function initializeDefaultEffectors(): void {
  // Range-modifying effectors
  effectorRegistry.registerTagEffectors("long_shot", [
    { type: "SHIFT", value: 2, source: "tag:long_shot", description: "+2 tiles range" }
  ]);
  
  effectorRegistry.registerTagEffectors("far_reach", [
    { type: "SHIFT", value: 1, source: "tag:far_reach", description: "+1 tile melee range" }
  ]);
  
  effectorRegistry.registerTagEffectors("giant_strength", [
    { type: "SCALE", value: 1.5, source: "tag:giant_strength", description: "Throw range ×1.5" }
  ]);
  
  // Damage/roll effectors
  effectorRegistry.registerTagEffectors("masterwork", [
    { type: "SHIFT", value: 1, source: "tag:masterwork", description: "+1 to result rolls" }
  ]);
  
  effectorRegistry.registerTagEffectors("accurate", [
    { type: "SHIFT", value: 2, source: "tag:accurate", description: "+2 to attack rolls" }
  ]);
  
  effectorRegistry.registerTagEffectors("deadly", [
    { type: "SCALE", value: 1.2, source: "tag:deadly", description: "×1.2 damage" }
  ]);
  
  // Negative effectors (conditions)
  effectorRegistry.registerTagEffectors("nearsighted", [
    { type: "SHIFT", value: -3, source: "tag:nearsighted", description: "-3 tiles inspect range" }
  ]);
  
  effectorRegistry.registerTagEffectors("deafened", [
    { type: "SCALE", value: 0.5, source: "tag:deafened", description: "Communicate range halved" }
  ]);
  
  effectorRegistry.registerTagEffectors("wind_boost", [
    { type: "SCALE", value: 2, source: "tag:wind_boost", description: "Projectile range ×2" }
  ]);
}

/**
 * Calculate effector-modified value
 * 
 * Applies all SHIFT effectors first (additive), then SCALE effectors (multiplicative)
 * Formula: (base + total_shift) × total_scale
 */
export function applyEffectors(
  baseValue: number,
  effectors: Effector[]
): EffectorResult {
  let totalShift = 0;
  let totalScale = 1;
  
  // Apply all SHIFT effectors (additive)
  for (const eff of effectors) {
    if (eff.type === "SHIFT") {
      totalShift += eff.value;
    }
  }
  
  // Apply all SCALE effectors (multiplicative)
  for (const eff of effectors) {
    if (eff.type === "SCALE") {
      totalScale *= eff.value;
    }
  }
  
  const finalValue = Math.floor((baseValue + totalShift) * totalScale);
  
  return {
    originalValue: baseValue,
    finalValue,
    shift: totalShift,
    scale: totalScale,
    effectors
  };
}

/**
 * Get effectors for a specific action context
 * Gathers effectors from:
 * - Tool/item tags
 * - Actor perks/conditions
 * - Environmental effects
 */
export function getEffectorsForContext(
  context: EffectorContext,
  itemEffectors: Effector[] = [],
  actorEffectors: Effector[] = [],
  environmentEffectors: Effector[] = []
): Effector[] {
  const allEffectors: Effector[] = [
    ...itemEffectors,
    ...actorEffectors,
    ...environmentEffectors
  ];
  
  // Filter effectors based on context
  // Some effectors only apply to specific action types
  return allEffectors.filter(eff => {
    // Most effectors apply universally
    // Could add filtering logic here for action-specific effectors
    return true;
  });
}

/**
 * Calculate modified range with effectors
 */
export function calculateModifiedRange(
  baseRange: number,
  effectors: Effector[]
): EffectorResult {
  // For ranges, only apply relevant effectors
  const rangeEffectors = effectors.filter(eff => {
    // Filter out effectors that don't affect range
    // (In a full implementation, effectors would have tags indicating what they modify)
    return true;
  });
  
  return applyEffectors(baseRange, rangeEffectors);
}

/**
 * Calculate modified roll with effectors
 */
export function calculateModifiedRoll(
  baseRoll: number,
  effectors: Effector[]
): EffectorResult {
  return applyEffectors(baseRoll, effectors);
}

/**
 * Format effector result for display
 */
export function formatEffectorResult(result: EffectorResult): string {
  const parts: string[] = [];
  
  parts.push(`Base: ${result.originalValue}`);
  
  if (result.shift !== 0) {
    const sign = result.shift > 0 ? "+" : "";
    parts.push(`Shift: ${sign}${result.shift}`);
  }
  
  if (result.scale !== 1) {
    parts.push(`Scale: ×${result.scale.toFixed(2)}`);
  }
  
  parts.push(`Final: ${result.finalValue}`);
  
  if (result.effectors.length > 0) {
    parts.push("Sources:");
    for (const eff of result.effectors) {
      parts.push(`  - ${eff.source}: ${eff.type} ${eff.value}`);
    }
  }
  
  return parts.join("\n");
}

/**
 * Create effector object for rules_lawyer compatibility
 * Converts to the format expected by the rules_lawyer effector system
 */
export function toRulesLawyerFormat(effectors: Effector[]): Array<{
  type: "object";
  value: {
    type: { type: "identifier"; value: string };
    value: { type: "number"; value: number };
  };
}> {
  return effectors.map(eff => ({
    type: "object",
    value: {
      type: { type: "identifier", value: eff.type },
      value: { type: "number", value: eff.value }
    }
  }));
}

/**
 * Check if an item has specific effector-providing tags
 */
export function hasEffectorTag(item: TaggedItem, effectorType: EffectorType): boolean {
  return item.tags.some(tag => {
    const tagEffectors = effectorRegistry.getEffectors(`tag:${tag.name}`);
    return tagEffectors.some(eff => eff.type === effectorType);
  });
}

/**
 * Get all effectors that would apply to a roll
 * Combines item, actor, and environmental effectors
 */
export function getRollEffectors(
  actorRef: string,
  tool?: TaggedItem,
  perks: string[] = [],
  conditions: string[] = []
): Effector[] {
  const effectors: Effector[] = [];
  
  // Tool effectors
  if (tool) {
    effectors.push(...effectorRegistry.getItemEffectors(tool));
  }
  
  // Perk effectors (would be loaded from actor data in real implementation)
  for (const perk of perks) {
    // In real implementation, look up perk effectors from perk definitions
  }
  
  // Condition effectors
  for (const condition of conditions) {
    const conditionEffectors = effectorRegistry.getEffectors(`condition:${condition}`);
    effectors.push(...conditionEffectors);
  }
  
  return effectors;
}

// Initialize default effectors
initializeDefaultEffectors();

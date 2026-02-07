// Roll System Integration (Phase 6)
// Integrates tag system proficiencies with existing rules_lawyer roll system
// D20 result rolls + MAG potency rolls + CR calculation

import { roll_expr, type DiceRoll } from "../rules_lawyer/dice.js";
import { effectorRegistry, applyEffectors, type Effector } from "../effectors/index.js";
import type { TaggedItem, ActionCapability } from "../tag_system/index.js";

/**
 * Proficiency levels
 */
export type ProficiencyType = 
  | "Accuracy"      // Ranged attacks, precision
  | "Brawn"         // Melee attacks, strength
  | "Instinct"      // Awareness, reactions
  | "Hearth"        // Fire, temperature
  | "Pain"          // Damage resistance
  | "Mechanics"     // Crafting, repair
  | "Lore"          // Knowledge, history
  | "Deception"     // Lying, stealth
  | "Conversation"; // Talking, persuasion

/**
 * Roll result
 */
export interface RollResult {
  nat: number;           // Natural die roll (1-20)
  total: number;         // Total after bonuses
  base: number;          // Base value (nat + prof + stat)
  prof_bonus: number;    // Proficiency bonus
  stat_bonus: number;    // Stat bonus
  effector_shift: number; // Total SHIFT from effectors
  effector_scale: number; // Total SCALE from effectors
  success: boolean;      // Did it meet/exceed CR?
  cr: number;            // Challenge rating
  margin: number;        // How much succeeded/failed by
}

/**
 * Potency roll result (MAG-based)
 */
export interface PotencyResult {
  mag: number;           // Base MAG
  dice: string;          // Dice expression (e.g., "1d6")
  roll: number;          // Actual roll result
  total: number;         // Total damage/effect
  effector_shift: number;
  effector_scale: number;
}

/**
 * Roll context
 */
export interface RollContext {
  actorRef: string;
  actionType: string;
  tool?: TaggedItem;
  capability?: ActionCapability;
  proficiencies: Record<ProficiencyType, number>; // Actor's proficiency levels
  stats: Record<string, number>; // Actor's stats (STR, DEX, etc.)
  effectors: Effector[];
  difficulty?: number; // Optional difficulty modifier
}

/**
 * Challenge Rating (CR) calculation
 * 
 * CR determines how hard an action is to succeed at.
 * Base CR 10, modified by:
 * - Distance (for ranged)
 * - Target defense
 * - Environmental conditions
 * - Difficulty modifier
 */
export function calculateCR(
  baseCR: number = 10,
  modifiers: {
    distance?: number;
    maxRange?: number;
    targetDefense?: number;
    environmental?: number;
    difficulty?: number;
  } = {}
): number {
  let cr = baseCR;
  
  // Distance penalty: +1 CR per 10% beyond effective range
  if (modifiers.distance && modifiers.maxRange && modifiers.maxRange > 0) {
    const rangeRatio = modifiers.distance / modifiers.maxRange;
    if (rangeRatio > 1) {
      cr += Math.floor((rangeRatio - 1) * 10);
    }
  }
  
  // Target defense
  if (modifiers.targetDefense) {
    cr += modifiers.targetDefense;
  }
  
  // Environmental conditions
  if (modifiers.environmental) {
    cr += modifiers.environmental;
  }
  
  // Difficulty modifier
  if (modifiers.difficulty) {
    cr += modifiers.difficulty;
  }
  
  return Math.max(1, cr); // Minimum CR 1
}

/**
 * Get proficiency bonus for an action
 * 
 * Tool determines which proficiencies apply.
 * Actor chooses highest applicable proficiency.
 */
export function getProficiencyBonus(
  capability: ActionCapability | undefined,
  proficiencies: Record<ProficiencyType, number>
): { bonus: number; proficiency: ProficiencyType | null } {
  if (!capability || !capability.proficiencies || capability.proficiencies.length === 0) {
    return { bonus: 0, proficiency: null };
  }
  
  let bestBonus = 0;
  let bestProf: ProficiencyType | null = null;
  
  for (const prof of capability.proficiencies) {
    const profKey = prof as ProficiencyType;
    const bonus = proficiencies[profKey] || 0;
    if (bonus > bestBonus) {
      bestBonus = bonus;
      bestProf = profKey;
    }
  }
  
  return { bonus: bestBonus, proficiency: bestProf };
}

/**
 * Get stat bonus for an action
 */
export function getStatBonus(
  actionType: string,
  stats: Record<string, number>
): number {
  // Map action types to stats
  const statMap: Record<string, string> = {
    "USE.IMPACT_SINGLE": "STR",
    "USE.PROJECTILE_SINGLE": "DEX",
    "MOVE": "STR",
    "COMMUNICATE": "CHA",
    "INSPECT": "PER"
  };
  
  const stat = statMap[actionType] || "STR";
  const statValue = stats[stat] || 10;
  
  // Convert stat to bonus (10 = 0, 12 = +1, 8 = -1, etc.)
  return Math.floor((statValue - 10) / 2);
}

/**
 * Perform D20 result roll
 * 
 * 1. Roll D20
 * 2. Add proficiency bonus
 * 3. Add stat bonus
 * 4. Apply effectors
 * 5. Compare to CR
 */
export function performResultRoll(
  context: RollContext,
  cr: number
): RollResult {
  // Roll D20
  const diceRoll = roll_expr("d20");
  const nat = diceRoll?.base || 10;
  
  // Get bonuses
  const { bonus: profBonus, proficiency } = getProficiencyBonus(
    context.capability,
    context.proficiencies
  );
  const statBonus = getStatBonus(context.actionType, context.stats);
  
  // Base value before effectors
  const base = nat + profBonus + statBonus;
  
  // Apply effectors
  const modified = applyEffectors(base, context.effectors);
  
  // Calculate total
  const total = modified.finalValue;
  
  // Determine success
  const success = total >= cr;
  const margin = total - cr;
  
  return {
    nat,
    total,
    base,
    prof_bonus: profBonus,
    stat_bonus: statBonus,
    effector_shift: modified.shift,
    effector_scale: modified.scale,
    success,
    cr,
    margin
  };
}

/**
 * Perform MAG-based potency roll
 * 
 * Rolls damage/effect dice based on MAG level
 */
export function performPotencyRoll(
  mag: number,
  effectors: Effector[] = []
): PotencyResult {
  // Get dice for MAG level
  const dice = getDamageDice(mag);
  
  // Roll the dice
  const rollResult = roll_expr(dice);
  const roll = rollResult?.base || 0;
  
  // Apply effectors
  const modified = applyEffectors(roll, effectors);
  
  return {
    mag,
    dice,
    roll,
    total: modified.finalValue,
    effector_shift: modified.shift,
    effector_scale: modified.scale
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
 * Format roll result for display
 */
export function formatRollResult(result: RollResult): string {
  const parts: string[] = [];
  
  parts.push(`Roll: ${result.nat} (D20)`);
  
  if (result.prof_bonus > 0) {
    parts.push(`Proficiency: +${result.prof_bonus}`);
  }
  
  if (result.stat_bonus !== 0) {
    const sign = result.stat_bonus > 0 ? "+" : "";
    parts.push(`Stat: ${sign}${result.stat_bonus}`);
  }
  
  if (result.effector_shift !== 0) {
    const sign = result.effector_shift > 0 ? "+" : "";
    parts.push(`Effectors: ${sign}${result.effector_shift}`);
  }
  
  if (result.effector_scale !== 1) {
    parts.push(`Scale: ×${result.effector_scale.toFixed(2)}`);
  }
  
  parts.push(`Total: ${result.total} vs CR ${result.cr}`);
  parts.push(result.success ? "SUCCESS!" : "FAILED");
  
  if (result.margin !== 0) {
    const marginText = result.margin > 0 
      ? `(${result.margin} above CR)` 
      : `(${Math.abs(result.margin)} below CR)`;
    parts.push(marginText);
  }
  
  return parts.join(" | ");
}

/**
 * Format potency result for display
 */
export function formatPotencyResult(result: PotencyResult): string {
  const parts: string[] = [];
  
  parts.push(`MAG ${result.mag}: ${result.dice} = ${result.roll}`);
  
  if (result.effector_shift !== 0) {
    const sign = result.effector_shift > 0 ? "+" : "";
    parts.push(`Effectors: ${sign}${result.effector_shift}`);
  }
  
  if (result.effector_scale !== 1) {
    parts.push(`Scale: ×${result.effector_scale.toFixed(2)}`);
  }
  
  parts.push(`Total: ${result.total} damage`);
  
  return parts.join(" | ");
}

/**
 * Create roll context from action context
 * Gathers all needed data for rolling
 */
export function createRollContext(
  actorRef: string,
  actionType: string,
  tool: TaggedItem | undefined,
  capability: ActionCapability | undefined,
  actorData: {
    proficiencies?: Record<ProficiencyType, number>;
    stats?: Record<string, number>;
  }
): RollContext {
  // Get effectors from tool
  const effectors = tool ? effectorRegistry.getItemEffectors(tool) : [];
  
  // Default proficiencies and stats
  const defaultProfs: Record<ProficiencyType, number> = {
    Accuracy: 0,
    Brawn: 0,
    Instinct: 0,
    Hearth: 0,
    Pain: 0,
    Mechanics: 0,
    Lore: 0,
    Deception: 0,
    Conversation: 0
  };
  
  const defaultStats = {
    STR: 10,
    DEX: 10,
    CON: 10,
    INT: 10,
    WIS: 10,
    CHA: 10,
    PER: 10
  };
  
  return {
    actorRef,
    actionType,
    tool,
    capability,
    proficiencies: { ...defaultProfs, ...actorData.proficiencies },
    stats: { ...defaultStats, ...actorData.stats },
    effectors
  };
}

// Re-export from dice module for convenience
export { roll_expr, type DiceRoll } from "../rules_lawyer/dice.js";

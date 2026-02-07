// Tag System - MAG Budget
// Calculates and validates MAG budgets for item creation
// Based on THAUMWORLD tag generation costs

import { TagRegistry, calculateItemMAG, type TagInstance } from "./registry.js";

/**
 * Tag cost information
 */
export interface TagCost {
  /** Base cost per stack of this tag */
  base_cost: number;
  /** Cost per additional stack (scaling) */
  per_stack_cost: number;
  /** Maximum stacks allowed (budget-wise) */
  max_stacks?: number;
  /** Description of what the cost represents */
  description?: string;
}

/**
 * Budget calculation result
 */
export interface BudgetResult {
  /** Whether the budget is valid */
  valid: boolean;
  /** Total MAG budget */
  total_budget: number;
  /** MAG spent on tags */
  spent: number;
  /** MAG remaining for core function */
  remaining: number;
  /** Breakdown by tag */
  tag_costs: Array<{
    tag_name: string;
    stacks: number;
    cost: number;
  }>;
  /** Error message if invalid */
  error?: string;
  /** Core function MAG (damage, etc.) */
  core_function_mag: number;
}

/**
 * MAG Budget Calculator
 * 
 * Manages the MAG budget system where:
 * - Item MAG = Total budget
 * - Tag costs are deducted from budget
 * - Remaining MAG = Core function (damage, range, etc.)
 */
export class MAGBudgetCalculator {
  constructor(private registry: TagRegistry) {}

  /**
   * Get the generation cost of a tag
   * 
   * Looks for ["generation_cost"] meta tag on the tag rule
   * Returns cost info or default cost of 1
   */
  getTagCost(tagName: string): TagCost {
    const rule = this.registry.get(tagName);
    
    if (!rule) {
      // Unknown tag - assume default cost
      return {
        base_cost: 1,
        per_stack_cost: 1,
        description: "Unknown tag (default cost)"
      };
    }

    // Check for generation_cost in meta tags or scaling
    // Format: "generation_cost:X" where X is the cost
    const costMeta = rule.meta_tags?.find(t => t.startsWith("generation_cost:"));
    
    if (costMeta) {
      const cost = parseInt(costMeta.split(":")[1] || "1", 10);
      return {
        base_cost: cost,
        per_stack_cost: cost,
        max_stacks: rule.scaling?.max_stacks,
        description: `${tagName} tag (costs ${cost} MAG per stack)`
      };
    }

    // Check for cost in behaviors or other properties
    // Default: cost = 1 per stack
    return {
      base_cost: 1,
      per_stack_cost: 1,
      max_stacks: rule.scaling?.max_stacks,
      description: `${tagName} tag (default cost)`
    };
  }

  /**
   * Calculate budget for an item
   * 
   * @param itemMAG - Total MAG budget for the item
   * @param tags - Tags to be applied to the item
   * @returns Budget calculation result
   */
  calculateBudget(
    itemMAG: number,
    tags: TagInstance[]
  ): BudgetResult {
    const tag_costs: Array<{ tag_name: string; stacks: number; cost: number }> = [];
    let total_spent = 0;

    for (const tag of tags) {
      const costInfo = this.getTagCost(tag.name);
      const stacks = tag.stacks || 1;
      
      // Calculate cost: base + (stacks - 1) * per_stack
      const cost = costInfo.base_cost + ((stacks - 1) * costInfo.per_stack_cost);
      
      tag_costs.push({
        tag_name: tag.name,
        stacks: stacks,
        cost: cost
      });
      
      total_spent += cost;
    }

    const remaining = itemMAG - total_spent;
    const valid = remaining >= 0;

    return {
      valid,
      total_budget: itemMAG,
      spent: total_spent,
      remaining: Math.max(0, remaining),
      tag_costs,
      core_function_mag: Math.max(0, remaining),
      error: valid ? undefined : 
        `Over budget: spent ${total_spent} MAG but only have ${itemMAG} MAG`
    };
  }

  /**
   * Validate if an item's tags fit within its MAG budget
   */
  validateItemBudget(item: {
    mag?: number;
    tags: TagInstance[];
  }): BudgetResult {
    // If item has explicit MAG, use it; otherwise calculate from tags
    const itemMAG = item.mag || calculateItemMAG(item as any);
    return this.calculateBudget(itemMAG, item.tags);
  }

  /**
   * Calculate maximum possible stacks of a tag within budget
   */
  calculateMaxStacks(
    tagName: string,
    availableMAG: number
  ): number {
    const costInfo = this.getTagCost(tagName);
    
    // How many can we afford?
    // cost = base + (stacks - 1) * per_stack
    // available = base + (max - 1) * per_stack
    // max = ((available - base) / per_stack) + 1
    
    if (availableMAG < costInfo.base_cost) {
      return 0;
    }
    
    const maxByBudget = Math.floor(
      ((availableMAG - costInfo.base_cost) / costInfo.per_stack_cost) + 1
    );
    
    // Respect max_stacks limit if set
    if (costInfo.max_stacks !== undefined) {
      return Math.min(maxByBudget, costInfo.max_stacks);
    }
    
    return maxByBudget;
  }

  /**
   * Calculate remaining MAG for core function
   * 
   * Core function = what's left after paying for tags
   * Used for: damage, range, effects, etc.
   */
  getCoreFunctionMAG(item: {
    mag?: number;
    tags: TagInstance[];
  }): number {
    const budget = this.validateItemBudget(item);
    return budget.core_function_mag;
  }

  /**
   * Build an item within budget
   * 
   * @param itemMAG - Total MAG budget
   * @param requiredTags - Tags that must be included
   * @param optionalTags - Tags to add if budget allows
   * @returns Built item tags or error
   */
  buildItem(
    itemMAG: number,
    requiredTags: TagInstance[],
    optionalTags: TagInstance[] = []
  ): { 
    success: boolean; 
    tags: TagInstance[]; 
    remaining: number;
    error?: string;
  } {
    // First, calculate cost of required tags
    const requiredBudget = this.calculateBudget(itemMAG, requiredTags);
    
    if (!requiredBudget.valid) {
      return {
        success: false,
        tags: [],
        remaining: 0,
        error: `Cannot afford required tags: ${requiredBudget.error}`
      };
    }

    let currentTags = [...requiredTags];
    let remainingMAG = requiredBudget.remaining;

    // Try to add optional tags within remaining budget
    for (const optTag of optionalTags) {
      const costInfo = this.getTagCost(optTag.name);
      const stacks = optTag.stacks || 1;
      const cost = costInfo.base_cost + ((stacks - 1) * costInfo.per_stack_cost);

      if (cost <= remainingMAG) {
        currentTags.push(optTag);
        remainingMAG -= cost;
      }
      // If can't afford, skip (optional)
    }

    return {
      success: true,
      tags: currentTags,
      remaining: remainingMAG
    };
  }

  /**
   * Get budget breakdown as readable string
   */
  formatBudgetReport(result: BudgetResult): string {
    const lines: string[] = [];
    lines.push(`MAG Budget Report`);
    lines.push(`=================`);
    lines.push(`Total Budget: ${result.total_budget} MAG`);
    lines.push(`Spent on Tags: ${result.spent} MAG`);
    lines.push(`Remaining (Core Function): ${result.remaining} MAG`);
    lines.push(``);
    lines.push(`Tag Costs:`);
    
    for (const tc of result.tag_costs) {
      lines.push(`  - ${tc.tag_name} ×${tc.stacks}: ${tc.cost} MAG`);
    }
    
    if (result.error) {
      lines.push(``);
      lines.push(`ERROR: ${result.error}`);
    }
    
    return lines.join("\n");
  }
}

/**
 * Tag cost definitions for common tags
 * 
 * These define how much MAG each tag costs during item generation
 */
export const TAG_GENERATION_COSTS: Record<string, number> = {
  // Weapons (high cost - they're tools)
  "bow": 2,           // 2 MAG per bow stack
  "crossbow": 2,      // 2 MAG per crossbow stack
  "sword": 2,         // 2 MAG per sword stack
  "axe": 2,
  "dagger": 1,        // Cheaper weapon
  "spear": 2,
  
  // Damage types (low cost)
  "damage": 1,        // Base damage tag
  "piercing": 1,      // Damage subtype
  "slashing": 1,
  "bludgeoning": 1,
  "fire": 1,
  "cold": 1,
  
  // Ammunition (low cost - consumable)
  "projectile": 1,
  "arrow": 1,
  "bolt": 1,
  
  // Armor (medium cost)
  "armor": 2,
  "shield": 2,
  "helmet": 1,
  
  // Properties (variable)
  "heavy": 1,         // Weight property
  "light": 1,         // Weight property
  "masterwork": 3,    // Quality boost
  "magical": 3,       // Enchantment slot
  
  // Consumables
  "potion": 1,
  "scroll": 1,
  "food": 1,
  
  // Materials
  "steel": 1,
  "iron": 1,
  "wood": 0,          // Free
  "leather": 1,
  "cloth": 0,         // Free
  
  // Special
  "enchanted": 2,     // Has magic effects
  "broken": 0         // Free (debuff)
};

/**
 * Create tag cost from generation cost number
 */
export function createTagCost(baseCost: number): TagCost {
  return {
    base_cost: Math.max(0, baseCost),
    per_stack_cost: Math.max(0, baseCost),
    description: baseCost < 0 ? 
      `Refunds ${Math.abs(baseCost)} MAG` : 
      `Costs ${baseCost} MAG per stack`
  };
}

// Export singleton
export const magBudget = new MAGBudgetCalculator(
  // Will be initialized with registry
  null as any
);

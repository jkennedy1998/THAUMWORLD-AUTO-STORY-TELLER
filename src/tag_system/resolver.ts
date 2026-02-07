// Tag System - Resolver
// Resolves what actions items enable and validates ammo compatibility

import {
  TagRegistry,
  calculateWeightMAG,
  calculateItemMAG,
  type TagInstance,
  type TagRule,
  type TagAction,
  type TaggedItem
} from "./registry.js";

/**
 * Action capability - what an item can do
 */
export interface ActionCapability {
  /** Action type (e.g., "USE.PROJECTILE_SINGLE") */
  action_type: string;
  /** Range information */
  range: {
    category: string;
    base: number;
    effective: number;
  };
  /** Damage calculation */
  damage?: {
    formula: string;
    base_mag: number;
    bonus_mag: number;
  };
  /** Valid proficiencies */
  proficiencies: string[];
  /** Ammo requirements (null = any item) */
  ammo_requirement: {
    tag?: string;
    tag_value?: string;
  } | null;
  /** Source tag */
  source_tag: string;
}

/**
 * Ammo compatibility result
 */
export interface AmmoCompatibility {
  compatible: boolean;
  reason?: string;
}

/**
 * Throw validation result
 */
export interface ThrowValidation {
  can_throw: boolean;
  reason?: string;
  max_range: number;
}

/**
 * Tag Resolver - Interprets tags and resolves capabilities
 */
export class TagResolver {
  constructor(private registry: TagRegistry) {}

  /**
   * Get all actions enabled by an item
   */
  getEnabledActions(item: TaggedItem): ActionCapability[] {
    const capabilities: ActionCapability[] = [];

    for (const tagInstance of item.tags) {
      const rule = this.registry.get(tagInstance.name);
      if (!rule) continue;

      for (const action of rule.actions) {
        const effectiveRange = this.calculateEffectiveRange(
          action.base_range,
          action.range_category,
          rule,
          tagInstance.stacks
        );

        capabilities.push({
          action_type: action.action_type,
          range: {
            category: action.range_category,
            base: action.base_range,
            effective: effectiveRange
          },
          damage: {
            formula: action.damage_formula,
            base_mag: tagInstance.stacks,
            bonus_mag: this.calculateBonusMAG(rule, tagInstance.stacks)
          },
          proficiencies: action.proficiencies,
          ammo_requirement: action.requirements || null,
          source_tag: tagInstance.name
        });
      }
    }

    return capabilities;
  }

  /**
   * Get specific action capability
   */
  getActionCapability(
    item: TaggedItem,
    actionType: string
  ): ActionCapability | null {
    const actions = this.getEnabledActions(item);
    return actions.find(a => a.action_type === actionType) || null;
  }

  /**
   * Check if ammo is compatible with tool
   */
  checkAmmoCompatibility(
    tool: TaggedItem,
    ammo: TaggedItem,
    actionType: string = "USE.PROJECTILE_SINGLE"
  ): AmmoCompatibility {
    const capability = this.getActionCapability(tool, actionType);
    
    if (!capability) {
      return {
        compatible: false,
        reason: `Tool does not support ${actionType}`
      };
    }

    // No requirements = any item can be used
    if (capability.ammo_requirement === null) {
      return { compatible: true };
    }

    // Check if ammo has required tag
    const req = capability.ammo_requirement;
    const hasTag = ammo.tags.some(tag => {
      if (tag.name !== req.tag) return false;
      if (req.tag_value && tag.value !== req.tag_value) return false;
      return true;
    });

    if (!hasTag) {
      return {
        compatible: false,
        reason: `Requires ${req.tag}${req.tag_value ? ":" + req.tag_value : ""} ammunition`
      };
    }

    return { compatible: true };
  }

  /**
   * Validate if actor can throw an item
   */
  validateThrow(
    throwerSTR: number,
    item: TaggedItem,
    tool?: TaggedItem
  ): ThrowValidation {
    const weightMAG = calculateWeightMAG(item.weight ?? 0);
    const requiredSTR = Math.max(0, weightMAG - 2);

    if (throwerSTR < requiredSTR) {
      return {
        can_throw: false,
        reason: `Too heavy (requires STR ${requiredSTR}, have ${throwerSTR})`,
        max_range: 0
      };
    }

    // Calculate max range
    const toolToUse = tool || this.getDefaultHand();
    const capability = this.getActionCapability(toolToUse, "USE.PROJECTILE_SINGLE");
    
    if (!capability) {
      return {
        can_throw: false,
        reason: "No throwing capability",
        max_range: 0
      };
    }

    const baseRange = capability.range.base;
    const maxRange = Math.floor(baseRange * (throwerSTR / Math.max(1, weightMAG)));

    return {
      can_throw: true,
      max_range: maxRange
    };
  }

  /**
   * Check if item is a tool (has [tool] meta tag)
   */
  isTool(item: TaggedItem): boolean {
    return item.tags.some(tag => 
      this.registry.hasMetaTag(tag.name, "tool")
    );
  }

  /**
   * Get tool action for specific action type
   */
  getToolAction(
    item: TaggedItem,
    actionType: string
  ): { rule: TagRule; action: TagAction; tagStacks: number } | null {
    for (const tagInstance of item.tags) {
      const rule = this.registry.get(tagInstance.name);
      if (!rule) continue;

      const action = rule.actions.find(a => a.action_type === actionType);
      if (action) {
        return {
          rule,
          action,
          tagStacks: tagInstance.stacks
        };
      }
    }
    return null;
  }

  /**
   * Calculate effective range with bonuses
   */
  private calculateEffectiveRange(
    baseRange: number,
    category: string,
    rule: TagRule,
    stacks: number
  ): number {
    let range = baseRange;

    if (rule.scaling?.per_stack?.range) {
      const bonus = (stacks - 1) * rule.scaling.per_stack.range;
      range += bonus;
    }

    return range;
  }

  /**
   * Calculate bonus MAG from scaling
   */
  private calculateBonusMAG(rule: TagRule, stacks: number): number {
    if (!rule.scaling?.per_stack) return 0;
    
    let bonus = 0;
    if (rule.scaling.per_stack.damage) {
      bonus += (stacks - 1) * rule.scaling.per_stack.damage;
    }
    if (rule.scaling.per_stack.range) {
      // Range bonuses don't add to damage MAG
    }
    
    return bonus;
  }

  /**
   * Get default hand tool
   */
  private getDefaultHand(): TaggedItem {
    return {
      ref: "body.hand",
      name: "Hand",
      weight: 0,
      tags: [{ name: "hand", stacks: 1 }]
    };
  }
}

/**
 * Calculate total damage MAG for projectile attack
 */
export function calculateProjectileDamageMAG(
  toolMAG: number,
  ammoMAG: number,
  strBonus: number = 0
): number {
  return toolMAG + ammoMAG + strBonus;
}

/**
 * Determine where projectile lands
 */
export function calculateProjectileLanding(
  hit: boolean,
  sticks: boolean,
  targetLocation: any,
  scatterDistance: number = 0
): { location: any; inTarget: boolean } {
  if (hit && sticks) {
    return { location: targetLocation, inTarget: true };
  }
  
  if (hit && !sticks) {
    // Hit but bounced - adjacent tile
    return { 
      location: { ...targetLocation, x: targetLocation.x + 1 }, // Simplified
      inTarget: false 
    };
  }
  
  // Miss - scatter
  return {
    location: {
      ...targetLocation,
      x: targetLocation.x + scatterDistance,
      y: targetLocation.y + scatterDistance
    },
    inTarget: false
  };
}

// Export singleton
export const tagResolver = new TagResolver(
  // This will be initialized with the registry
  // In practice, import from registry.ts
  null as any
);

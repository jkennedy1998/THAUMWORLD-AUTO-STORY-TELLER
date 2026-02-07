// Tag System - Registry
// Central storage for tag rules and definitions
// Based on THAUMWORLD tag system architecture

/**
 * Tag instance as stored on items/characters/tiles
 */
export interface TagInstance {
  /** Tag identifier (e.g., "bow", "fire!", "sword") */
  name: string;
  /** Stack count / MAG level (default: 1) */
  stacks: number;
  /** Tracked variable/data (optional) */
  value?: any;
  /** Source of the tag (optional) */
  source?: string;
  /** Expiry timestamp (optional) */
  expiry?: number;
}

/**
 * Action definition within a tag rule
 */
export interface TagAction {
  /** Action type (e.g., "USE.PROJECTILE_SINGLE") */
  action_type: string;
  /** Ammunition/projectile requirements */
  requirements?: {
    /** Required tag on projectile */
    tag?: string;
    /** Specific tag value required */
    tag_value?: string;
  } | null;
  /** Range category for this action */
  range_category: "TOUCH" | "MELEE" | "THROWN" | "PROJECTILE" | "SIGHT" | "UNLIMITED";
  /** Base range in tiles */
  base_range: number;
  /** Formula for calculating damage */
  damage_formula: string;
  /** Proficiencies that apply to this action */
  proficiencies: string[];
}

/**
 * Tag rule definition - stored in registry
 */
export interface TagRule {
  /** Tag identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Meta tags this tag has (e.g., ["tool", "weapon"]) */
  meta_tags: string[];
  /** Actions this tag enables */
  actions: TagAction[];
  /** Effectors that modify rolls/stats */
  effectors?: any[];
  /** Special behaviors */
  behaviors?: {
    on_equip?: string;
    on_use?: string;
    on_hit?: string;
    tick?: string;
  };
  /** Scaling per stack */
  scaling?: {
    per_stack?: {
      range?: number;
      damage?: number;
      [key: string]: any;
    };
    max_stacks?: number;
  };
}

/**
 * Item interface for tag resolution
 */
export interface TaggedItem {
  ref: string;
  name: string;
  weight?: number;
  tags: TagInstance[];
  /** Calculated: sum of tag stacks */
  mag?: number;
}

/**
 * Tag Registry - Central storage for all tag rules
 */
export class TagRegistry {
  private rules: Map<string, TagRule> = new Map();

  /**
   * Register a new tag rule
   */
  register(rule: TagRule): void {
    this.rules.set(rule.name, rule);
  }

  /**
   * Get a tag rule by name
   */
  get(name: string): TagRule | undefined {
    return this.rules.get(name);
  }

  /**
   * Check if a tag rule exists
   */
  has(name: string): boolean {
    return this.rules.has(name);
  }

  /**
   * Get all registered rules
   */
  getAll(): TagRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get all rules with a specific meta tag
   */
  getByMetaTag(metaTag: string): TagRule[] {
    return this.getAll().filter(rule => rule.meta_tags.includes(metaTag));
  }

  /**
   * Check if a tag has a meta tag
   */
  hasMetaTag(tagName: string, metaTag: string): boolean {
    const rule = this.get(tagName);
    return rule ? rule.meta_tags.includes(metaTag) : false;
  }

  /**
   * Clear all rules (for testing)
   */
  clear(): void {
    this.rules.clear();
  }
}

// Singleton instance
export const tagRegistry = new TagRegistry();

/**
 * Calculate weight MAG from item weight
 */
export function calculateWeightMAG(weight: number): number {
  if (weight <= 5) return 1;      // Light: rock, dagger, arrow
  if (weight <= 15) return 2;     // Medium: sword, mace, helmet
  if (weight <= 30) return 3;     // Heavy: greatsword, armor
  if (weight <= 50) return 4;     // Very Heavy: anvil, chest
  return 5;                        // Extreme: furniture, boulders
}

/**
 * Calculate item MAG from tag stacks
 */
export function calculateItemMAG(item: TaggedItem): number {
  return item.tags.reduce((sum, tag) => sum + (tag.stacks || 1), 0);
}

/**
 * Default tag rules for core items
 */
export const DEFAULT_TAG_RULES: TagRule[] = [
  {
    name: "bow",
    description: "A ranged weapon that fires projectiles",
    meta_tags: ["tool", "weapon", "ranged", "generation_cost:2"],
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: {
        tag: "projectile",
        tag_value: "arrow"
      },
      range_category: "PROJECTILE",
      base_range: 30,
      damage_formula: "bow_stacks + ammo_mag",
      proficiencies: ["Accuracy"]
    }],
    scaling: {
      per_stack: {
        range: 2,
        damage: 1
      },
      max_stacks: 10
    }
  },
  {
    name: "crossbow",
    description: "High-power ranged weapon",
    meta_tags: ["tool", "weapon", "ranged", "generation_cost:3"],
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: {
        tag: "projectile",
        tag_value: "bolt"
      },
      range_category: "PROJECTILE",
      base_range: 45,
      damage_formula: "crossbow_stacks + bolt_mag",
      proficiencies: ["Accuracy"]
    }],
    scaling: {
      per_stack: {
        range: 3,
        damage: 1
      },
      max_stacks: 10
    }
  },
  {
    name: "sword",
    description: "Melee weapon for cutting and thrusting",
    meta_tags: ["tool", "weapon", "melee", "generation_cost:2"],
    actions: [
      {
        action_type: "USE.IMPACT_SINGLE",
        requirements: null,
        range_category: "MELEE",
        base_range: 1,
        damage_formula: "sword_stacks",
        proficiencies: ["Brawn", "Accuracy"]
      },
      {
        action_type: "USE.PROJECTILE_SINGLE",
        requirements: null,
        range_category: "THROWN",
        base_range: 5,
        damage_formula: "sword_stacks + str_bonus",
        proficiencies: ["Accuracy"]
      }
    ],
    scaling: {
      per_stack: {
        damage: 1
      },
      max_stacks: 10
    }
  },
  {
    name: "hand",
    description: "Default body part for throwing",
    meta_tags: ["tool", "body_part"],
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: null,
      range_category: "THROWN",
      base_range: 5,
      damage_formula: "item_mag + str_bonus",
      proficiencies: ["Brawn"]
    }]
  },
  {
    name: "projectile",
    description: "Marks item as usable ammunition",
    meta_tags: ["ammunition", "generation_cost:1"],
    actions: []
  },
  {
    name: "arrow",
    description: "Ammunition for bows",
    meta_tags: ["ammunition", "projectile", "generation_cost:1"],
    actions: []
  },
  {
    name: "bolt",
    description: "Ammunition for crossbows",
    meta_tags: ["ammunition", "projectile", "generation_cost:1"],
    actions: []
  },
  {
    name: "javelin",
    description: "Weapon designed for throwing",
    meta_tags: ["tool", "weapon", "ranged", "generation_cost:2"],
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: null,
      range_category: "THROWN",
      base_range: 10,
      damage_formula: "javelin_stacks + str_bonus",
      proficiencies: ["Accuracy", "Brawn"]
    }],
    scaling: {
      per_stack: {
        range: 1,
        damage: 1
      }
    }
  }
];

/**
 * Initialize registry with default rules
 */
export function initializeDefaultRules(): void {
  DEFAULT_TAG_RULES.forEach(rule => tagRegistry.register(rule));
}

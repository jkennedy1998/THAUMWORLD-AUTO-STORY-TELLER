// Action System Registry
// Central definitions for all game actions used by both Players and NPCs

import type { ActionVerb, ActionCost } from "../shared/constants.js";

export type TargetType = 
  | "character"      // actor.* or npc.*
  | "body_slot"      // actor.*.body_slots.*
  | "item"          // actor.*.inventory.item_* or item.*
  | "tile"          // tile.<wx>.<wy>.<rx>.<ry>.<x>.<y>
  | "region_tile"   // region_tile.<wx>.<wy>.<rx>.<ry>
  | "place"         // place.<region>.<place>
  | "place_tile"    // place_tile.<region>.<place>.<x>.<y>
  | "self"          // The actor themselves
  | "ground"        // Items on the ground
  | "any";          // Any valid target

export type ActionCategory = "combat" | "social" | "movement" | "utility" | "crafting" | "defense";

export interface PerceptibilityConfig {
  visual: boolean;         // Can be seen?
  auditory: boolean;       // Can be heard?
  radius: number;         // Perception range in tiles
  stealthAllowed: boolean; // Can be done stealthily?
  visualObscurable: boolean; // Can be hidden by cover?
}

export interface ActionDefinition {
  verb: ActionVerb;
  category: ActionCategory;
  
  // Target requirements
  targetTypes: TargetType[];
  targetRequired: boolean;
  targetRange: number;      // Max distance in tiles (0 = self only)
  allowSelf: boolean;
  allowMultipleTargets: boolean;
  
  // Cost
  defaultCost: ActionCost;
  
  // Tool requirements
  requiresTool: boolean;
  defaultTool?: string;     // e.g., "hands", "voice"
  validToolTypes?: string[]; // Equipment slots or item types
  
  // Perception
  perceptibility: PerceptibilityConfig;
  
  // System effect template
  effectTemplate: string;
  
  // AI/NPC configuration
  aiPriority: number;       // Base priority (0-100)
  aiConditions?: string[];  // Conditions for NPC selection
  requiresHostileTarget?: boolean;
  requiresFriendlyTarget?: boolean;
  
  // Combat timing
  isReaction?: boolean;     // Can be used as a reaction?
  provokesOpportunity?: boolean; // Provokes attacks of opportunity?
  
  // Additional validation
  requiresAwareness: boolean; // Actor must be aware of target
  requiresLineOfSight: boolean;
  canUseInCombat: boolean;
  canUseOutOfCombat: boolean;
}

// Helper for creating action definitions with defaults
function createAction(def: Omit<ActionDefinition, 
  'requiresAwareness' | 'requiresLineOfSight' | 'canUseInCombat' | 'canUseOutOfCombat' | 'allowMultipleTargets'
> & {
  verb: ActionVerb;
  requiresAwareness?: boolean;
  requiresLineOfSight?: boolean;
  canUseInCombat?: boolean;
  canUseOutOfCombat?: boolean;
  allowMultipleTargets?: boolean;
}): ActionDefinition {
  return {
    requiresAwareness: def.requiresAwareness ?? true,
    requiresLineOfSight: def.requiresLineOfSight ?? false,
    canUseInCombat: def.canUseInCombat ?? true,
    canUseOutOfCombat: def.canUseOutOfCombat ?? true,
    allowMultipleTargets: def.allowMultipleTargets ?? false,
    ...def
  } as ActionDefinition;
}

// Action Registry - Central source of truth for all actions
export const ACTION_REGISTRY: Record<ActionVerb, ActionDefinition> = {
  // === COMBAT ACTIONS ===
  
  ATTACK: createAction({
    verb: "ATTACK",
    category: "combat",
    targetTypes: ["character", "body_slot"],
    targetRequired: true,
    targetRange: 1,  // Melee default, can be overridden by tool
    allowSelf: false,
    allowMultipleTargets: false,
    defaultCost: "FULL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "weapon", "body_slots.main_hand", "body_slots.off_hand"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 15,
      stealthAllowed: false,
      visualObscurable: true
    },
    effectTemplate: "SYSTEM.APPLY_DAMAGE(target={target}, source={actor}, tool={tool}, potency={potency})",
    aiPriority: 100,
    aiConditions: ["has_hostile_target", "in_combat", "can_reach_target"],
    requiresHostileTarget: true,
    provokesOpportunity: true
  }),

  GRAPPLE: createAction({
    verb: "GRAPPLE",
    category: "combat",
    targetTypes: ["character"],
    targetRequired: true,
    targetRange: 1,
    allowSelf: false,
    defaultCost: "FULL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "body_slots.main_hand"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 10,
      stealthAllowed: false,
      visualObscurable: true
    },
    effectTemplate: "SYSTEM.APPLY_GRAPPLE(actor={actor}, target={target})",
    aiPriority: 60,
    aiConditions: ["has_hostile_target", "in_combat", "close_range", "grappler_build"],
    requiresHostileTarget: true,
    provokesOpportunity: true
  }),

  // === DEFENSE ACTIONS ===
  
  DEFEND: createAction({
    verb: "DEFEND",
    category: "defense",
    targetTypes: ["character", "self"],
    targetRequired: false,
    targetRange: 1,
    allowSelf: true,
    defaultCost: "FULL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "shield", "body_slots.off_hand", "weapon"],
    perceptibility: {
      visual: true,
      auditory: false,
      radius: 8,
      stealthAllowed: true,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.APPLY_DEFENSE(actor={actor}, target={target}, tool={tool})",
    aiPriority: 70,
    aiConditions: ["in_combat", "low_health", "defensive_stance"],
    requiresHostileTarget: false
  }),

  DODGE: createAction({
    verb: "DODGE",
    category: "defense",
    targetTypes: ["self"],
    targetRequired: false,
    targetRange: 0,
    allowSelf: true,
    defaultCost: "PARTIAL",
    requiresTool: false,
    perceptibility: {
      visual: true,
      auditory: false,
      radius: 8,
      stealthAllowed: true,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.APPLY_DODGE(actor={actor})",
    aiPriority: 65,
    aiConditions: ["in_combat", "ranged_threat", "agile_build"],
    isReaction: true
  }),

  HOLD: createAction({
    verb: "HOLD",
    category: "defense",
    targetTypes: ["any"],
    targetRequired: false,
    targetRange: 10,
    allowSelf: false,
    defaultCost: "FULL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "weapon", "item"],
    perceptibility: {
      visual: true,
      auditory: false,
      radius: 12,
      stealthAllowed: true,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.HOLD_ACTION(actor={actor}, tool={tool}, trigger={trigger})",
    aiPriority: 40,
    aiConditions: ["waiting_for_opportunity", "ranged_weapon_ready"],
    isReaction: true
  }),

  // === SOCIAL ACTIONS ===
  
  COMMUNICATE: createAction({
    verb: "COMMUNICATE",
    category: "social",
    targetTypes: ["character", "region_tile"],
    targetRequired: false,  // Can shout to area
    targetRange: 10,
    allowSelf: false,
    allowMultipleTargets: true,
    defaultCost: "FREE",
    requiresTool: false,
    defaultTool: "voice",
    validToolTypes: ["voice", "item"],
    perceptibility: {
      visual: false,
      auditory: true,
      radius: 20,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.SET_AWARENESS(target={target}, of={actor}, context={message})",
    aiPriority: 50,
    aiConditions: ["player_nearby", "not_hostile", "has_information"],
    requiresAwareness: false  // Can communicate without being aware
  }),

  HELP: createAction({
    verb: "HELP",
    category: "social",
    targetTypes: ["character"],
    targetRequired: true,
    targetRange: 1,
    allowSelf: false,
    defaultCost: "FULL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "item", "body_slots.main_hand"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 12,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.HELP(target={target}, helper={actor}, tool={tool})",
    aiPriority: 55,
    aiConditions: ["ally_wounded", "medic_role", "in_combat"],
    requiresFriendlyTarget: true
  }),

  // === UTILITY ACTIONS ===
  
  INSPECT: createAction({
    verb: "INSPECT",
    category: "utility",
    targetTypes: ["character", "item", "tile", "place", "body_slot"],
    targetRequired: true,
    targetRange: 5,
    allowSelf: true,
    defaultCost: "PARTIAL",
    requiresTool: false,
    perceptibility: {
      visual: true,
      auditory: false,
      radius: 8,
      stealthAllowed: true,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.INSPECT(inspector={actor}, target={target})",
    aiPriority: 30,
    aiConditions: ["unknown_entity_nearby", "investigator_role"],
    canUseInCombat: false
  }),

  USE: createAction({
    verb: "USE",
    category: "utility",
    targetTypes: ["character", "item", "tile", "body_slot"],
    targetRequired: true,
    targetRange: 1,
    allowSelf: true,
    defaultCost: "PARTIAL",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "item", "body_slots.main_hand"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 10,
      stealthAllowed: true,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.USE_ITEM(user={actor}, item={target}, tool={tool})",
    aiPriority: 45,
    aiConditions: ["usable_item_available", "needs_light", "needs_healing"]
  }),

  // === MOVEMENT ACTIONS ===
  
  MOVE: createAction({
    verb: "MOVE",
    category: "movement",
    targetTypes: ["place", "region_tile", "place_tile", "tile"],
    targetRequired: true,
    targetRange: 100,  // Can move far
    allowSelf: false,
    defaultCost: "FULL",
    requiresTool: false,
    defaultTool: "hands",  // Informational only (no tool validation for MOVE)
    validToolTypes: ["hands", "item"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 15,
      stealthAllowed: true,
      visualObscurable: true
    },
    effectTemplate: "SYSTEM.SET_OCCUPANCY(actor={actor}, location={target})",
    aiPriority: 80,
    aiConditions: ["needs_to_reach", "fleeing", "patrol_route"],
    provokesOpportunity: true
  }),

  // === CRAFTING/REST ACTIONS ===
  
  CRAFT: createAction({
    verb: "CRAFT",
    category: "crafting",
    targetTypes: ["item", "self"],
    targetRequired: false,
    targetRange: 0,
    allowSelf: true,
    defaultCost: "EXTENDED",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "tool", "item"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 8,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.CRAFT_ITEM(crafter={actor}, recipe={recipe}, tool={tool})",
    aiPriority: 20,
    aiConditions: ["has_materials", "crafting_station", "merchant_role"],
    canUseInCombat: false
  }),

  REPAIR: createAction({
    verb: "REPAIR",
    category: "crafting",
    targetTypes: ["item"],
    targetRequired: true,
    targetRange: 1,
    allowSelf: false,
    defaultCost: "EXTENDED",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "tool"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 8,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.REPAIR_ITEM(repairer={actor}, item={target}, tool={tool})",
    aiPriority: 25,
    aiConditions: ["damaged_equipment", "repair_kit_available"],
    canUseInCombat: false
  }),

  SLEEP: createAction({
    verb: "SLEEP",
    category: "utility",
    targetTypes: ["self"],
    targetRequired: false,
    targetRange: 0,
    allowSelf: true,
    defaultCost: "EXTENDED",
    requiresTool: false,
    perceptibility: {
      visual: false,
      auditory: false,
      radius: 5,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.APPLY_HEAL(target={actor}, type=rest, amount={restoration})",
    aiPriority: 10,
    aiConditions: ["exhausted", "safe_location", "night_time"],
    canUseInCombat: false
  }),

  // === WORK ACTIONS ===
  
  WORK: createAction({
    verb: "WORK",
    category: "utility",
    targetTypes: ["tile", "place", "item"],
    targetRequired: false,
    targetRange: 5,
    allowSelf: true,
    defaultCost: "EXTENDED",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "tool"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 12,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.WORK(actor={actor}, task={task}, tool={tool})",
    aiPriority: 35,
    aiConditions: ["work_hours", "work_station"],
    canUseInCombat: false
  }),

  GUARD: createAction({
    verb: "GUARD",
    category: "defense",
    targetTypes: ["place", "tile", "character"],
    targetRequired: false,
    targetRange: 10,
    allowSelf: false,
    defaultCost: "EXTENDED",
    requiresTool: true,
    defaultTool: "hands",
    validToolTypes: ["hands", "weapon"],
    perceptibility: {
      visual: true,
      auditory: true,
      radius: 15,
      stealthAllowed: false,
      visualObscurable: false
    },
    effectTemplate: "SYSTEM.GUARD(actor={actor}, post={target})",
    aiPriority: 40,
    aiConditions: ["guard_role", "assigned_post", "night_hours"]
  })
};

// Utility functions
export function getActionDefinition(verb: ActionVerb): ActionDefinition | undefined {
  return ACTION_REGISTRY[verb];
}

export function isValidTargetType(verb: ActionVerb, targetType: TargetType): boolean {
  const action = ACTION_REGISTRY[verb];
  if (!action) return false;
  return action.targetTypes.includes(targetType) || action.targetTypes.includes("any");
}

export function getDefaultCost(verb: ActionVerb): ActionCost {
  return ACTION_REGISTRY[verb]?.defaultCost ?? "FULL";
}

export function requiresTool(verb: ActionVerb): boolean {
  return ACTION_REGISTRY[verb]?.requiresTool ?? false;
}

export function getPerceptionRadius(verb: ActionVerb): number {
  return ACTION_REGISTRY[verb]?.perceptibility.radius ?? 10;
}

export function isObservable(verb: ActionVerb): boolean {
  const action = ACTION_REGISTRY[verb];
  if (!action) return false;
  return action.perceptibility.visual || action.perceptibility.auditory;
}

// Get all actions in a category
export function getActionsByCategory(category: ActionCategory): ActionDefinition[] {
  return Object.values(ACTION_REGISTRY).filter(a => a.category === category);
}

// Get all observable actions
export function getObservableActions(): ActionDefinition[] {
  return Object.values(ACTION_REGISTRY).filter(a => 
    a.perceptibility.visual || a.perceptibility.auditory
  );
}

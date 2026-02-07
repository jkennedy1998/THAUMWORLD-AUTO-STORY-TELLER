// Tag System - Index
// Exports all tag system functionality

export {
  TagRegistry,
  tagRegistry,
  calculateWeightMAG,
  calculateItemMAG,
  initializeDefaultRules,
  DEFAULT_TAG_RULES,
  type TagInstance,
  type TagRule,
  type TagAction,
  type TaggedItem
} from "./registry.js";

export {
  TagResolver,
  tagResolver,
  calculateProjectileDamageMAG,
  calculateProjectileLanding,
  type ActionCapability,
  type AmmoCompatibility,
  type ThrowValidation
} from "./resolver.js";

export {
  MAGBudgetCalculator,
  magBudget,
  TAG_GENERATION_COSTS,
  createTagCost,
  type TagCost,
  type BudgetResult
} from "./budget.js";

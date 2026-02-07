// Tag System - Integration Example
// Shows how to use the new tag-based tool and range system

import {
  tagRegistry,
  TagResolver,
  initializeDefaultRules,
  calculateWeightMAG,
  type TaggedItem
} from "./index.js";

import {
  validateToolRequirement,
  validateAmmo,
  validateThrow,
  getEnabledActions
} from "../tool_system/tool_validator.js";

import {
  calculateEffectiveRange,
  calculateDistance,
  getRangeType
} from "../action_range/range_calculator.js";

// Initialize the system
initializeDefaultRules();
const resolver = new TagResolver(tagRegistry);

// Example 1: Create items
const longbow: TaggedItem = {
  ref: "item.longbow_1",
  name: "Longbow",
  weight: 12,
  tags: [
    { name: "bow", stacks: 3 },  // MAG 3 bow
    { name: "damage", value: "piercing", stacks: 1 }
  ]
};

const arrow: TaggedItem = {
  ref: "item.arrow_1",
  name: "Arrow",
  weight: 1,
  tags: [
    { name: "projectile", value: "arrow", stacks: 1 }
  ]
};

const sword: TaggedItem = {
  ref: "item.sword_1",
  name: "Steel Sword",
  weight: 10,
  tags: [
    { name: "sword", stacks: 2 }  // MAG 2 sword
  ]
};

const rock: TaggedItem = {
  ref: "item.rock_1",
  name: "Rock",
  weight: 3,
  tags: []  // No tags needed!
};

// Example 2: Check what actions a tool enables
console.log("=== Longbow Actions ===");
const bowActions = resolver.getEnabledActions(longbow);
for (const action of bowActions) {
  console.log(`- ${action.action_type}: ${action.range.effective} tiles`);
  console.log(`  Proficiencies: ${action.proficiencies.join(", ")}`);
  if (action.ammo_requirement) {
    console.log(`  Requires: ${action.ammo_requirement.tag}:${action.ammo_requirement.tag_value}`);
  } else {
    console.log(`  Requires: Any item (no restriction)`);
  }
}

// Example 3: Check ammo compatibility
console.log("\n=== Ammo Compatibility ===");
const arrowCompatible = resolver.checkAmmoCompatibility(longbow, arrow, "USE.PROJECTILE_SINGLE");
console.log(`Bow + Arrow: ${arrowCompatible.compatible ? "✅ Compatible" : "❌ " + arrowCompatible.reason}`);

const rockCompatible = resolver.checkAmmoCompatibility(longbow, rock, "USE.PROJECTILE_SINGLE");
console.log(`Bow + Rock: ${rockCompatible.compatible ? "✅ Compatible" : "❌ " + rockCompatible.reason}`);

// Example 4: Calculate ranges
console.log("\n=== Range Calculations ===");
const bowRange = calculateEffectiveRange(longbow, "USE.PROJECTILE_SINGLE");
console.log(`Longbow range: ${bowRange} tiles`);

// For thrown items, need strength
const heroSTR = 14;
const swordThrownRange = calculateEffectiveRange(sword, "USE.PROJECTILE_SINGLE", heroSTR);
console.log(`Sword thrown (STR ${heroSTR}): ${swordThrownRange} tiles`);

// Example 5: Validate throwing
console.log("\n=== Throw Validation ===");
const swordThrow = resolver.validateThrow(heroSTR, sword);
console.log(`Can throw sword: ${swordThrow.can_throw ? "✅ Yes" : "❌ " + swordThrow.reason}`);
console.log(`Max range: ${swordThrow.max_range} tiles`);

const anvil: TaggedItem = {
  ref: "item.anvil",
  name: "Anvil",
  weight: 45,  // MAG 4
  tags: []
};
const anvilThrow = resolver.validateThrow(heroSTR, anvil);
console.log(`Can throw anvil: ${anvilThrow.can_throw ? "✅ Yes" : "❌ " + anvilThrow.reason}`);

// Example 6: Actor with equipped items
console.log("\n=== Actor Equipment ===");
const hero = {
  ref: "actor.hero",
  hand_slots: {
    main_hand: longbow,
    off_hand: null
  },
  body_slots: {
    back: {
      name: "quiver",
      item: arrow
    }
  }
};

// Validate tool requirement
const toolValidation = validateToolRequirement(hero as any, "USE", "PROJECTILE_SINGLE");
console.log(`Can use projectile: ${toolValidation.valid ? "✅ Yes" : "❌ " + toolValidation.error}`);
if (toolValidation.valid && toolValidation.tool) {
  console.log(`Using: ${toolValidation.tool.item.name}`);
  console.log(`Range: ${toolValidation.tool.capability.range.effective} tiles`);
}

// Example 7: Get all enabled actions
console.log("\n=== All Enabled Actions ===");
const enabledActions = resolver.getEnabledActions(longbow);
for (const action of enabledActions) {
  console.log(`- ${action.action_type}`);
  console.log(`  Range: ${action.range.category} (${action.range.effective} tiles)`);
  console.log(`  Damage formula: ${action.damage?.formula}`);
}

// Example 8: Distance calculation
console.log("\n=== Distance Calculation ===");
const location1 = {
  world_x: 0,
  world_y: 0,
  region_x: 0,
  region_y: 0,
  x: 5,
  y: 5
};

const location2 = {
  world_x: 0,
  world_y: 0,
  region_x: 0,
  region_y: 0,
  x: 10,
  y: 10
};

const distance = calculateDistance(location1, location2);
console.log(`Distance from (5,5) to (10,10): ${distance.toFixed(2)} tiles`);

// Example 9: Weight MAG calculation
console.log("\n=== Weight MAG ===");
console.log(`Arrow (weight 1): MAG ${calculateWeightMAG(1)}`);
console.log(`Rock (weight 3): MAG ${calculateWeightMAG(3)}`);
console.log(`Sword (weight 10): MAG ${calculateWeightMAG(10)}`);
console.log(`Anvil (weight 45): MAG ${calculateWeightMAG(45)}`);

console.log("\n=== Examples Complete ===");

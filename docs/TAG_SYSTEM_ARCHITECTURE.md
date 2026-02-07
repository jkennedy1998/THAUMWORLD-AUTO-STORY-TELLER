# Tag System Architecture v2

**Date:** February 6, 2026  
**Status:** Planning Phase  
**Goal:** Clarify tag system before implementation

## Core Principles (Corrected Understanding)

### 1. Universal Projectiles
**All items can be thrown.** No special tag required.
- Any item in hand can be thrown using `USE.PROJECTILE_SINGLE`
- The tool (hand) determines if/what can be thrown

### 2. Tags Are Declarative, Not Prescriptive
Tags label what something IS, not what it can DO.
- `bow` tag means "this is a bow"
- The bow tag's RULES determine what actions it enables
- Meta tags are stored in the tag rules, not on the item

### 3. Tag Format
```
[tagname : tracked_variables]
```
- **tagname**: Identifier for the tag type
- **tracked_variables**: Data tracked by this tag instance
- Rules stored separately in tag resolver

### 4. Tags Stack for MAG
Multiple instances of the same tag = higher MAG/level.
```
[bow : 1]  = MAG 1 bow
[bow : 2]  = MAG 2 bow (better stats)
[bow : 1], [bow : 1] = Two separate bows (or MAG 2 if stacked)
```

---

## Tag Data Structure

### On Items/Characters/Tiles

Tags are stored as an array of tag instances:

```typescript
interface TagInstance {
  name: string;        // e.g., "bow", "fire!", "disease"
  value?: any;         // Tracked variable (number, string, object)
  stacks?: number;     // How many times this tag is stacked (default: 1)
  source?: string;     // Where did this tag come from
  expiry?: number;     // When does it expire (if temporary)
}

// Example: Item with tags
const longbow = {
  ref: "item.longbow_1",
  name: "Longbow",
  mag: 3,  // Base MAG (sum of tag stacks)
  weight: 12,  // Weight in arbitrary units (determines weight MAG)
  tags: [
    { name: "bow", value: "masterwork", stacks: 3 },  // MAG 3 bow
    { name: "damage", value: "piercing" }
  ]
};

// Example: Character with status
const character = {
  ref: "actor.hero",
  name: "Hero",
  tags: [
    { name: "fire!", stacks: 2 },  // On fire, MAG 2
    { name: "awareness", value: "npc.guard_1" },
    { name: "proficiency", value: { type: "bow", level: 2 } }
  ]
};
```

### Tag Rules (Stored Separately)

Tag rules define what a tag DOES. Stored in a central registry:

```typescript
interface TagRule {
  name: string;                    // Tag identifier
  description: string;             // Human-readable description
  meta_tags: string[];             // Meta tags this tag has (e.g., ["tool"])
  
  // What actions this tag enables when equipped
  actions?: {
    action_type: string;           // e.g., "USE.PROJECTILE_SINGLE"
    requirements?: {               // What ammo/projectiles it needs
      tag?: string;                // Required projectile tag
      tag_value?: string;          // Specific value (e.g., "arrow")
    };
    range_category?: string;       // THROWN, PROJECTILE, etc.
    base_range?: number;           // Base range in tiles
    damage_formula?: string;       // How to calculate damage
    proficiencies?: string[];      // Which proficiencies apply (e.g., ["Accuracy", "Brawn"])
  }[];
  
  // Effects that modify stats/rolls
  effectors?: Effector[];
  
  // Special behaviors
  behaviors?: {
    on_equip?: string;             // Behavior when equipped
    on_use?: string;               // Behavior when used
    on_hit?: string;               // Behavior on successful hit
    tick?: string;                 // Behavior each turn/tick
  };
  
  // How the tag scales with MAG/stacks
  scaling?: {
    per_stack?: {                  // Bonus per additional stack
      range?: number;              // +X tiles per stack
      damage?: number;             // +X MAG damage per stack
      [key: string]: any;
    };
    max_stacks?: number;           // Maximum stackable amount
  };
}

// Example Tag Rules
const TAG_RULES: Record<string, TagRule> = {
  "bow": {
    name: "bow",
    description: "A ranged weapon that fires projectiles",
    meta_tags: ["tool", "weapon", "ranged"],
    
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: {
        tag: "projectile",
        tag_value: "arrow"  // Can only fire items with "projectile:arrow"
      },
      range_category: "PROJECTILE",
      base_range: 30,
      damage_formula: "bow_mag + ammo_mag",
      proficiencies: ["Accuracy"]  // Tool determines proficiency!
    }],
    
    scaling: {
      per_stack: {
        range: 2,        // +2 tiles per MAG
        damage: 1        // +1 damage MAG per bow MAG
      },
      max_stacks: 10
    }
  },
  
  "thrown_weapon": {
    name: "thrown_weapon",
    description: "Weapon designed for throwing",
    meta_tags: ["tool", "weapon"],
    
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: null,  // No specific ammo required
      range_category: "THROWN",
      base_range: 5,
      damage_formula: "item_mag + str_bonus",
      proficiencies: ["Accuracy", "Brawn"]  // Can use either!
    }],
    
    scaling: {
      per_stack: {
        range: 1,
        damage: 1
      }
    }
  },
  
  "projectile": {
    name: "projectile",
    description: "Meta tag: Marks item as usable ammunition",
    meta_tags: ["ammunition"],
    
    // This tag doesn't enable actions on its own
    // It just marks items as valid ammo for tools
    actions: []
  },
  
  "arrow": {
    name: "arrow",
    description: "Ammunition for bows",
    meta_tags: ["ammunition", "projectile"],
    
    // Inherits "projectile" behavior
    // Can be used by any tool that requires "projectile:arrow"
    actions: []
  },
  
  "crossbow": {
    name: "crossbow",
    description: "High-power ranged weapon",
    meta_tags: ["tool", "weapon", "ranged"],
    
    actions: [{
      action_type: "USE.PROJECTILE_SINGLE",
      requirements: {
        tag: "projectile",
        tag_value: "bolt"
      },
      range_category: "PROJECTILE",
      base_range: 45,
      damage_formula: "crossbow_mag + bolt_mag"
    }],
    
    scaling: {
      per_stack: {
        range: 3,
        damage: 1
      }
    }
  },
  
  "sword": {
    name: "sword",
    description: "Melee weapon for cutting and thrusting",
    meta_tags: ["tool", "weapon", "melee"],
    
    actions: [
      {
        action_type: "USE.IMPACT_SINGLE",
        range_category: "MELEE",
        base_range: 1,
        damage_formula: "sword_mag",
        proficiencies: ["Brawn", "Accuracy"]  // Choose based on fighting style
      },
      {
        action_type: "USE.PROJECTILE_SINGLE",  // Can throw swords!
        range_category: "THROWN",
        base_range: 3,  // Shorter than dedicated thrown weapons
        damage_formula: "sword_mag + str_bonus - 1",  // Penalty for improvised
        proficiencies: ["Accuracy"]  // Throwing uses accuracy
      }
    ],
    
    scaling: {
      per_stack: {
        damage: 1
      }
    }
  }
};
```

---

## Tool-Projectile Relationship

### How It Works

1. **Tool has requirements** (defined in tag rules)
   - "I can fire items with [projectile : arrow] tag"
   
2. **Ammunition has marker tags**
   - "I am [projectile : arrow]"
   
3. **System matches them up**
   - Check if ammo tags satisfy tool requirements

### Example Scenarios

**Scenario 1: Bow and Arrow**
```typescript
// Tool: Longbow
{
  tags: [
    { name: "bow", stacks: 3 }  // MAG 3 bow
  ]
}
// Tag Rule: "bow" requires "projectile:arrow"

// Ammunition: Arrow
{
  tags: [
    { name: "projectile", value: "arrow" },  // Can be used by bows
    { name: "damage", value: "piercing" }
  ],
  mag: 1
}

// Result:
// - Bow can fire arrow (requirements met)
// - Range: 30 + (3 * 2) = 36 tiles
// - Damage: 3 (bow MAG) + 1 (arrow MAG) = MAG 4 total
```

**Scenario 2: Crossbow and Bolt**
```typescript
// Tool: Heavy Crossbow
{
  tags: [
    { name: "crossbow", stacks: 2 }
  ]
}
// Tag Rule: "crossbow" requires "projectile:bolt"

// Ammunition: Bolt
{
  tags: [
    { name: "projectile", value: "bolt" }
  ],
  mag: 1
}

// Result: Works! Crossbow fires bolt
// Range: 45 + (2 * 3) = 51 tiles
// Damage: 2 + 1 = MAG 3
```

**Scenario 3: Throwing Any Item**
```typescript
// Tool: Hand (default tool)
{
  tags: [
    { name: "hand", stacks: 1 }  // Default body part
  ]
}
// Tag Rule: "hand" can throw ANY item

// Projectile: Rock (no special tags)
{
  name: "Rock",
  mag: 1,
  tags: []  // Just a rock
}

// Result:
// - Hand can throw rock (no requirements)
// - Range: 5 tiles (THROWN category)
// - Damage: 1 + STR bonus
```

**Scenario 4: Throwing Sword**
```typescript
// Tool: Sword (in hand)
{
  tags: [
    { name: "sword", stacks: 2 }
  ]
}
// Tag Rule: "sword" has built-in throwing action

// Result:
// - Can swing (USE.IMPACT_SINGLE, MELEE)
// - Can throw (USE.PROJECTILE_SINGLE, THROWN)
// - Thrown range: 3 tiles (less than dedicated thrown weapons)
// - Damage: 2 + STR - 1 = MAG 2 + STR - 1
// - Proficiency: Accuracy (for throwing)
```

---

## Tool Determines Proficiency

**Critical Rule:** The tool (via its tag rules) determines which proficiencies apply to an action.

### How It Works

1. Actor performs action with equipped tool
2. System looks up tool's tag rules
3. Tag rule specifies which proficiencies apply
4. System checks actor's proficiency levels
5. Bonuses applied to result roll and potency roll

### Examples

**Bow (Ranged Weapon):**
```typescript
// Bow tag rule:
{
  actions: [{
    action_type: "USE.PROJECTILE_SINGLE",
    proficiencies: ["Accuracy"],  // Bow uses Accuracy proficiency
    // ...
  }]
}

// Actor with Accuracy 2:
// Result Roll: D20 + 2 (Accuracy MAG)
// Potency Roll: Weapon MAG + 2 (Accuracy MAG)
```

**Sword (Melee Weapon):**
```typescript
// Sword tag rule:
{
  actions: [
    {
      action_type: "USE.IMPACT_SINGLE",
      proficiencies: ["Brawn", "Accuracy"],  // Can use either!
      // Actor chooses which proficiency to apply
    },
    {
      action_type: "USE.PROJECTILE_SINGLE",
      proficiencies: ["Accuracy"],  // Throwing always uses Accuracy
      // ...
    }
  ]
}

// Actor uses sword melee:
// Option 1: Brawn 3 → D20 + 3
// Option 2: Accuracy 1 → D20 + 1
// Actor picks Brawn (higher)

// Actor throws sword:
// Must use: Accuracy 1 → D20 + 1
```

**Hand (Default):**
```typescript
// Hand tag rule:
{
  actions: [{
    action_type: "USE.PROJECTILE_SINGLE",
    proficiencies: ["Brawn"],  // Throwing uses Brawn (strength)
    // ...
  }]
}

// Actor throws rock:
// Result Roll: D20 + Brawn MAG
```

### Multiple Proficiencies

Tools can specify multiple valid proficiencies:

```typescript
// Javelin (designed for throwing):
{
  proficiencies: ["Accuracy", "Brawn"]  // Can use either!
}

// Longbow:
{
  proficiencies: ["Accuracy"]  // Only Accuracy
}

// Greatsword:
{
  proficiencies: ["Brawn", "Accuracy"]  // Brawn for power, Accuracy for finesse
}
```

When multiple proficiencies are listed, the actor **chooses** which to apply (usually the higher one).

---

## Tag Resolver System

### Purpose
Central system that:
1. Stores tag rules
2. Resolves what actions a tool enables
3. Validates tool-ammo compatibility
4. Calculates bonuses from tag stacks

### Interface

```typescript
interface TagResolver {
  // Register a new tag rule
  registerTagRule(rule: TagRule): void;
  
  // Get rule for a tag
  getTagRule(tagName: string): TagRule | undefined;
  
  // Check if item has a meta tag
  hasMetaTag(item: Item, metaTag: string): boolean;
  
  // Get all actions enabled by an item
  getEnabledActions(item: Item): ActionCapability[];
  
  // Check if ammo is compatible with tool
  isAmmoCompatible(tool: Item, ammo: Item): boolean;
  
  // Calculate effective stats from tags
  calculateTagBonuses(item: Item): TagBonuses;
}

interface ActionCapability {
  action_type: string;
  subtype?: string;
  range: {
    category: string;
    base: number;
    effective: number;
  };
  damage?: {
    formula: string;
    mag: number;
  };
  requirements?: {
    tag?: string;
    tag_value?: string;
  };
}

interface TagBonuses {
  range_bonus: number;
  damage_bonus: number;
  effectors: Effector[];
}
```

### Usage Example

```typescript
const resolver = new TagResolver();

// Register all tag rules
resolver.registerTagRule(TAG_RULES["bow"]);
resolver.registerTagRule(TAG_RULES["arrow"]);

// Check what a bow can do
const bow = {
  tags: [{ name: "bow", stacks: 2 }]
};

const actions = resolver.getEnabledActions(bow);
// Returns: [{
//   action_type: "USE.PROJECTILE_SINGLE",
//   range: { category: "PROJECTILE", base: 30, effective: 34 },
//   requirements: { tag: "projectile", tag_value: "arrow" }
// }]

// Check if arrow works with bow
const arrow = {
  tags: [{ name: "projectile", value: "arrow" }]
};

const compatible = resolver.isAmmoCompatible(bow, arrow);
// Returns: true

// Calculate bonuses
const bonuses = resolver.calculateTagBonuses(bow);
// Returns: { range_bonus: 4, damage_bonus: 2, effectors: [] }
```

---

## Clarifications (Addressed)

### 1. Throwing Rules ✅
**Q: What can be thrown?**  
**A:** Anything, but effectiveness depends on:
- Thrower's STR
- Projectile's weight MAG

**Draft Rules:**
```
Can Throw If: Thrower STR ≥ Projectile Weight MAG - 2

Max Range = Base Range × (STR / Required STR)

Example:
- Rock (weight MAG 1)
- Thrower STR 3
- Required: 1 - 2 = -1 (always throwable)
- Range: 5 tiles × (3 / 1) = 15 tiles

Example:
- Anvil (weight MAG 5)
- Thrower STR 2
- Required: 5 - 2 = 3
- 2 < 3 = Cannot throw (too heavy)
```

### 2. Tools Are Items with Tool-Meta Tags ✅
**Q: What makes something a tool?**  
**A:** An item with a tag that has `[tool]` meta tag.

```typescript
// Tag Rule:
"bow": {
  meta_tags: ["tool", "weapon", "ranged"],  // Makes it a tool!
  actions: [...]
}

// Item:
{ tags: [{ name: "bow", stacks: 2 }] }  // This is now a tool
```

### 3. MAG vs Stacks ✅
**Q: Relationship between item MAG and tag stacks?**  
**A:**
- **Item MAG** = Total tag budget/sum
- **Tag stacks** = Tag's level/potency
- MAG 2 item could be: `[bow: 2]` or `[bow: 1] + [sword: 1]`

```typescript
// MAG 2 Longbow:
{
  mag: 2,  // Total (not stored, calculated from tags)
  tags: [
    { name: "bow", stacks: 2 }  // MAG 2 bow
  ]
}

// MAG 2 Multi-tool:
{
  tags: [
    { name: "sword", stacks: 1 },
    { name: "dagger", stacks: 1 }
  ]
}
```

### 4. Projectile Tag Requirement ✅
**Q: When is [projectile] tag required?**  
**A:** Only for tools that need specific ammo types.

```typescript
// Bow requires "projectile:arrow"
// Arrow must have: { name: "projectile", value: "arrow" }

// Hand requires: nothing
// Can throw: any item (rocks, swords, pots)

// Thrown weapon (javelin) requires: nothing special
// Can throw: itself (no ammo needed)
```

### 5. Tag Resolver Location ✅
**Q: Where does tag resolution live?**  
**A:** In the Rules Lawyer system.

```
Tag Registry → Tag Resolver → Rules Lawyer
     ↓              ↓              ↓
  Stores      Interprets     Validates &
  Rules       Tags           Applies Rules
```

### 6. Complex Tag Values ✅
**Q: Tag value format?**  
**A:** Complex objects when needed, simple strings otherwise.

```typescript
// Simple:
{ name: "projectile", value: "arrow" }

// Complex (when tracking multiple things):
{ 
  name: "charm", 
  value: { 
    target: "npc.villager_1",
    duration: 5,
    strength: 2
  }
}

// Item composition (arrow hardness):
// Not in tag value - part of item creation!
// Arrow item has: [steel_tip] tag + [wood_shaft] tag
```

---

## Updated Questions

1. **Throwing Penalties**
   - Improvised throwing (sword): -2 to hit, -1 damage MAG?
   - Dedicated thrown weapon (javelin): No penalty?
   - Or all through USE.PROJECTILE_SINGLE with tool bonuses?

2. **Weight MAG**
   - Is weight a tag? `[weight: 3]`?
   - Or calculated from item MAG + material tags?

3. **Ammo Consumption**
   - Arrows consumed on use?
   - Rocks not consumed?
   - Tag-based: `[consumable]`?

**A:** No consumable tag needed. Projectiles change location when used:
- Hit (sticks): In target's inventory/body_slot
- Hit (bounces): On floor near target
- Miss: On floor at scatter location

---

## Weight System

Items have a `weight` property (number), not a tag. Weight MAG is calculated from weight thresholds:

```typescript
function calculateWeightMAG(weight: number): number {
  if (weight <= 5) return 1;      // Light: rock, dagger, arrow
  if (weight <= 15) return 2;     // Medium: sword, mace, helmet
  if (weight <= 30) return 3;     // Heavy: greatsword, armor
  if (weight <= 50) return 4;     // Very Heavy: anvil, large chest
  return 5;                        // Extreme: furniture, boulders
}

// Examples:
// Arrow: weight 1 → MAG 1
// Rock: weight 3 → MAG 1
// Sword: weight 10 → MAG 2
// Greatsword: weight 25 → MAG 3
// Anvil: weight 45 → MAG 4
```

### Weight Limits for Throwing

```
Can Throw If: STR ≥ (Weight MAG - 2)

Examples:
- Rock (MAG 1), STR 1: 1 ≥ (1-2) → 1 ≥ -1 ✅ Can throw
- Sword (MAG 2), STR 1: 1 ≥ 0 ✅ Can throw
- Anvil (MAG 4), STR 2: 2 ≥ 2 ✅ Can throw (barely)
- Anvil (MAG 4), STR 1: 1 ≥ 2 ❌ Too heavy
```

---

## Projectile Location System

When USE.PROJECTILE_SINGLE is executed, the projectile item changes location:

### Hit (Projectile Sticks)
```typescript
// Arrow hits target
if (projectileCanStick(tool, target)) {
  // Move projectile to target's body slot
  target.body_slots.wounds.push(projectile);
  // Or add to inventory
  target.inventory[projectile.ref] = projectile;
}
```

### Hit (Projectile Bounces)
```typescript
// Projectile hits but doesn't stick (blunt object, armor deflects, etc.)
// Lands on random adjacent tile
const landingTile = getAdjacentTile(targetLocation);
placeItemOnGround(projectile, landingTile);
```

### Miss (Scatter)
```typescript
// Projectile misses entirely
// Calculate scatter based on how much roll missed by
const scatterDistance = Math.ceil(missAmount / 3);
const scatterTile = calculateScatter(targetLocation, scatterDistance);
placeItemOnGround(projectile, scatterTile);
```

### Implementation Notes

1. **Before Action:** Projectile is in thrower's hand_slot or inventory
2. **After Action:** Projectile is:
   - In target (if hit and sticks)
   - On ground (if hit and bounces, or miss)
3. **No deletion:** Projectiles are never destroyed, only moved
4. **Retrieval:** Can pick up from ground or target's body

### Example Flow

```typescript
// Hero throws sword at Goblin
const sword = hero.hand_slots.main_hand;  // Get sword

// Execute USE.PROJECTILE_SINGLE
const result = await executeProjectileAction({
  actor: hero,
  tool: hand,  // Using hand to throw
  projectile: sword,
  target: goblin
});

// Remove from hero
hero.hand_slots.main_hand = null;

// Place based on result
if (result.hit && result.sticks) {
  // Sword lodged in goblin
  goblin.body_slots.wounds.push({
    item: sword,
    damage: result.potency
  });
} else {
  // Sword on ground
  const landingTile = result.hit ? 
    getAdjacentTile(goblin.location) : 
    result.scatterLocation;
  world.placeItem(sword, landingTile);
}

// Hero no longer has sword!
```

---

## Implementation Plan

### Phase A: Tag Registry
- Create `src/tag_system/registry.ts`
- Define TagRule interface
- Implement tag rule storage and lookup

### Phase B: Tag Resolver
- Create `src/tag_system/resolver.ts`
- Implement action capability resolution
- Implement ammo compatibility checking

### Phase C: Integration
- Update tool system to use tag resolver
- Update range system to use tag rules
- Migrate existing tags to new format

### Phase D: Content
- Define all tag rules in data file
- Create default tag library
- Document tag creation workflow

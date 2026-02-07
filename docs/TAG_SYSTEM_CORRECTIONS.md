# Tag System: Initial vs Corrected Understanding

## What I Got Wrong Initially

### ❌ Wrong: Items need tags to be thrown
**My Initial Thought:**
- Items need `[thrown]` or `[projectile]` tag to be thrown
- Tag enables the action

**Correct Understanding:**
- **All items can be thrown by default**
- The **tool** (hand/bow) determines what can be thrown
- Tags on items mark them as specific ammo types

---

### ❌ Wrong: Tags are requirements
**My Initial Thought:**
```typescript
// I thought:
{
  tags: ["thrown"],  // This enables throwing
  tags: ["projectile"]  // This enables projectile weapons
}
```

**Correct Understanding:**
```typescript
// Tags label what something IS:
{
  tags: [
    { name: "bow", stacks: 2 }  // This IS a bow (MAG 2)
  ]
}

// The bow's RULES determine what it can do:
// - "bow" tag rules: "I fire items with [projectile : arrow]"
```

---

### ❌ Wrong: Meta tags on items
**My Initial Thought:**
```typescript
// I thought items carry meta tags:
{
  tags: ["tool", "weapon", "bow"]
}
```

**Correct Understanding:**
```typescript
// Items only carry instance tags:
{
  tags: [
    { name: "bow", stacks: 2 }  // Just the bow tag
  ]
}

// Meta tags are in the RULES:
// Tag Rule "bow": {
//   meta_tags: ["tool", "weapon", "ranged"]  // Stored in registry
// }
```

---

### ❌ Wrong: Tool checks tag presence
**My Initial Thought:**
```typescript
// Tool validates: "Does item have [thrown] tag?"
if (item.tags.includes("thrown")) {
  canThrow = true;
}
```

**Correct Understanding:**
```typescript
// Tool validates: "Do my requirements match item's tags?"
// Bow requirements: "projectile : arrow"
// Arrow tags: [{ name: "projectile", value: "arrow" }]
// Match! Bow can fire arrow.

// Hand requirements: null (no specific ammo)
// Rock tags: [] (no tags)
// Match! Hand can throw rock.
```

---

## Correct Architecture

### Items Are Labeled

```typescript
// Item: Longbow
{
  ref: "item.longbow",
  name: "Longbow",
  mag: 3,
  tags: [
    { name: "bow", stacks: 3, value: "masterwork" }
  ]
}

// Item: Arrow
{
  ref: "item.arrow",
  name: "Arrow",
  mag: 1,
  tags: [
    { name: "projectile", value: "arrow" },
    { name: "damage", value: "piercing" }
  ]
}

// Item: Rock
{
  ref: "item.rock",
  name: "Rock",
  mag: 1,
  tags: []  // No tags needed to be thrown!
}
```

### Tag Rules Are Separate

```typescript
// In Tag Registry (not on items):
const TAG_RULES = {
  "bow": {
    name: "bow",
    meta_tags: ["tool", "weapon", "ranged"],  // Not on item!
    actions: [{
      type: "USE.PROJECTILE_SINGLE",
      ammo_requirement: { tag: "projectile", value: "arrow" },
      range: { category: "PROJECTILE", base: 30 }
    }]
  },
  
  "hand": {
    name: "hand",
    meta_tags: ["tool", "body_part"],
    actions: [{
      type: "USE.PROJECTILE_SINGLE",
      ammo_requirement: null,  // No requirement = any item
      range: { category: "THROWN", base: 5 }
    }]
  },
  
  "projectile": {
    name: "projectile",
    meta_tags: ["ammunition_marker"],  // Marks usable ammo
    actions: []  // Doesn't enable actions itself
  }
};
```

### Resolution Flow

```
1. Actor wants to USE.PROJECTILE_SINGLE
   ↓
2. System checks equipped tool (hand, bow, etc.)
   ↓
3. Look up tool's tag rules
   ↓
4. Does tool have USE.PROJECTILE_SINGLE action?
   ↓
5. Does tool require specific ammo?
   ├─ No: Can throw any item
   └─ Yes: Check if held item matches requirement
      ↓
      Does item have tag "projectile" with value "arrow"?
      ├─ Yes: Can fire!
      └─ No: Cannot fire
```

---

## Examples

### Example 1: Throw Rock
```typescript
// Actor holds: Rock (no tags)
// Equipped: Hand (default tool)

// Hand rules:
// - Action: USE.PROJECTILE_SINGLE
// - Requirement: null (no ammo restriction)

// Result: ✅ Can throw rock
// Range: THROWN (5 tiles)
// Damage: Rock MAG + STR
```

### Example 2: Shoot Arrow from Bow
```typescript
// Actor holds: Arrow (tag: "projectile : arrow")
// Equipped: Bow (tag: "bow")

// Bow rules:
// - Action: USE.PROJECTILE_SINGLE
// - Requirement: "projectile : arrow"

// Arrow tags match requirement: ✅

// Result: ✅ Can shoot arrow
// Range: PROJECTILE (30 + bow bonuses)
// Damage: Bow MAG + Arrow MAG
```

### Example 3: Try to Shoot Rock from Bow
```typescript
// Actor holds: Rock (no tags)
// Equipped: Bow (tag: "bow")

// Bow rules require: "projectile : arrow"
// Rock has: no matching tags

// Result: ❌ Cannot shoot rock from bow
// Error: "Bow requires arrow ammunition"
```

### Example 4: Throw Sword
```typescript
// Actor holds: Sword (tag: "sword")
// Equipped: Sword (in hand)

// Sword rules:
// - Action 1: USE.IMPACT_SINGLE (melee swing)
// - Action 2: USE.PROJECTILE_SINGLE (throw)
//   Requirement: null (sword can be thrown!)
//   Range: THROWN (3 tiles - shorter than dedicated)
//   Damage: Sword MAG + STR - 1 (penalty)

// Result: ✅ Can throw sword
// But range and damage are worse than dedicated thrown weapons
```

---

## Key Takeaways

1. **All items are throwable** - No tag required
2. **Tools determine what's possible** - Not item tags
3. **Item tags label ammo type** - For tools that require specific ammo
4. **Meta tags are in rules** - Not on item instances
5. **Tags stack for MAG** - Multiple instances = higher level
6. **Tag resolver is the brain** - Items are just data
7. **Tool determines proficiency** - Tag rules specify which proficiencies apply

---

## Clarifications Addressed ✓

**Q: What can hands throw?**  
**A:** Anything, limited by STR vs weight MAG (see throwing rules in architecture doc)

**Q: What makes something a tool?**  
**A:** Item has a tag with `[tool]` meta tag in the tag rules

**Q: MAG vs tag stacks?**  
**A:** Item MAG = sum of tag stacks. Tag stacks = tag level

**Q: When is [projectile] tag required?**  
**A:** Only for tools needing specific ammo (bows, guns)

**Q: Where do meta tags go?**  
**A:** On tag rules, never on items

**Q: Tool determines proficiency?**  
**A:** Yes! Tag rules specify which proficiencies apply (e.g., Bow → Accuracy)

---

## Remaining Questions (For You) - ANSWERED ✓

1. **Improvised Throwing Penalty** ✓
   - **A:** No penalty! You're just throwing a sword.
   - If hit: Deals damage, sword ends up in/on target
   - If miss: Sword lands on ground per scatter rules

2. **Weight MAG** ✓
   - **A:** Items have a `weight` property (not a tag)
   - Weight MAG is derived from weight thresholds:
     - Weight 0-5 = MAG 1
     - Weight 6-15 = MAG 2
     - Weight 16-30 = MAG 3
     - (etc.)

3. **Ammo Consumption** ✓
   - **A:** No `[consumable]` tag needed
   - Projectiles change location when used:
     - **Hit (sticks):** In target's inventory/body slot
     - **Hit (bounces):** On floor near target
     - **Miss:** On floor at landing tile
   - Sword thrown → Sword now on ground
   - Arrow shot → Arrow now somewhere (target or ground)

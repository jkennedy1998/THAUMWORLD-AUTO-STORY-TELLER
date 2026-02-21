# Armor System Implementation TODO

**Date:** 2026-02-19  
**Status:** ⏳ PENDING (Blocked on Damage System)  
**Priority:** Medium  
**Dependencies:** Damage system must be implemented first

---

## Overview

The inventory system currently supports equipping items to body slots, but the **armor mechanic is not functional** because the underlying damage system has not been implemented.

This TODO tracks what needs to be built once damage is in place.

---

## Current State

✅ **Implemented:**
- Items can be equipped to body slots (TORSO, LEFT LEG, RIGHT LEG, etc.)
- Armor tags exist on items (`ARMOR` tag)
- Body slot structure supports equipped items

❌ **Not Implemented:**
- Damage reduction calculation from armor
- Armor durability/condition degradation
- Armor penetration mechanics
- Armor type bonuses (light vs heavy)

---

## Implementation Checklist

### Phase 1: Damage System Prerequisite
- [ ] Implement base damage calculation
- [ ] Implement hit location determination
- [ ] Implement health/damage tracking on actors
- [ ] Implement death/damage effects

### Phase 2: Armor Mechanics
- [ ] Calculate armor rating from equipped items
- [ ] Apply damage reduction from armor
- [ ] Handle armor coverage (partial vs full)
- [ ] Implement armor piercing/resistance

### Phase 3: Armor Properties
- [ ] Add armor rating field to ItemDefinition
- [ ] Add armor type field (light/medium/heavy)
- [ ] Add coverage percentage field
- [ ] Add armor condition degradation on hit

### Phase 4: Advanced Armor Features
- [ ] Armor penetration calculation
- [ ] Layered armor (under armor + over armor)
- [ ] Armor specific damage types (slashing/piercing/blunt)
- [ ] Armor set bonuses

---

## Related Items

Currently tagged with ARMOR but non-functional:
- `tunic.jsonc` - Has ARMOR tag (currently just clothing)
- `pants.jsonc` - Has ARMOR tag (currently just clothing)  
- `shoes.jsonc` - Has ARMOR tag (currently just clothing)

When armor is implemented:
1. Update these items with proper `armor_rating`
2. Update `valid_body_slots` to differentiate armor vs clothing
3. Add armor-specific tags (ARMOR_LIGHT, ARMOR_MEDIUM, ARMOR_HEAVY)

---

## Technical Notes

**Body Slots for Armor:**
- HEAD: Helmets, hats, crowns
- TORSO: Chest armor, tunics, robes
- LEFT LEG / RIGHT LEG: Leg armor, pants, greaves (includes feet for simplicity)
- LEFT ARM / RIGHT ARM: Gauntlets, bracers

**Armor Calculation:**
```typescript
// Pseudo-code for future implementation
function calculate_damage_reduction(
  body_slots: BodySlots,
  hit_location: string,
  damage_type: string
): number {
  const equipped = get_equipped_item(body_slots, hit_location);
  if (!equipped) return 0;
  
  const armor_rating = equipped.armor_rating ?? 0;
  const coverage = equipped.armor_coverage ?? 1.0;
  
  return armor_rating * coverage;
}
```

---

## Blocked By

- Damage system design document
- Health tracking implementation
- Combat action system

**Do not start this until damage system is complete!**

---

**Created:** February 19, 2026

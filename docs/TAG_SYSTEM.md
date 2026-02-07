# THAUMWORLD Tag System

**Documentation Date:** February 6, 2026  
**Source:** thaumworld.xyz/tags/, thaumworld.xyz/tag-table/, thaumworld.xyz/items-n-inventory/

## Overview

TAGS are the core rule-modification system in THAUMWORLD. They are flags attached to **ITEMS**, **CHARACTERS**, **TILES**, or even other **TAGS** that add rules, change existing rules, or attach EFFECTORs.

## Key Concepts

### What is a TAG?

A TAG is always attached to an entity (ITEM, CHARACTER, TILE, or TAG). If something has a TAG, it has:
- An **extra rule**
- A **changed rule**  
- An **added EFFECTOR**

### TAG Format

```
[TAGNAME : information to be tracked]
```

**Example:**
- `[FIRE!]` - Item/character/tile is on fire
- `[DISEASE : 15]` - Disease with CR 15
- `[AWARENESS : npc.guard_1]` - Aware of specific target

### TAG Stacking

TAGS of the same type can be given multiple times. The ruling for stacking is determined by the specific TAG.

**Example:**
```
Character has [FIRE! : 3] - On fire with magnitude 3
Character has [FIRE! : 2] more - Now [FIRE! : 5]
```

## META TAGs

META TAGs go onto other TAGs and give them default properties.

### [DISPERSING]

Causes the tagged TAG to decrease by 1 at the end of each TURN.

**Applies to:** TAGs on CHARACTERS, ITEMS, or TILES  
**Effect:** `-1 (TAG) at end of TURN`

**Use Case:** Fast-paced effects that go away quickly

### [DISEASE : CR]

Marks a biological disease that affects creatures.

**Applies to:** TAGs on CHARACTERS  
**Effect:** `-1 (TAG) on passed RESULT ROLL : (DISEASE CR) during SLEEP`

## Action System TAGs

### [TOOL]

**Proficiency:** Determined by the TAG this is on

Marks an item that can be EQUIPPED in a HAND SLOT and used for ACTIONS.

**CHARACTER:** Could happen if grabbed by larger creature  
**ITEM:** 
- Can be EQUIPPED in a HAND
- Used like a TOOL for ACTIONS specified on the TAG
- Gains default TARGETER GLYPH set by the TAG

**Critical for Action System:** Items MUST have [TOOL] tag to be equipped and used for actions.

### [DAMAGE]

Marks a DAMAGE type. Procs rules about this DAMAGE TAG when the item is used to deal DAMAGE.

**Use Case:** Weaknesses, resistances, damage type tracking

## Standard TAGs

### Status TAGs

**[OVERENCUMBERED]**
- Set from overloaded carry capacity
- Movement speed and evasion decreased by 1 per TAG MAG

**[KNOCKED]** [DISPERSING]
- Set when HEALTH drops below 1
- All movement limited to 1, limited to 1 USE PARTIAL ACTION per turn
- Decreases by 1 TAG MAG per HEALTH recovered

**[SLEEPING]**
- Set during EXTENDED ACTION: SLEEP
- Cannot move or act, -1 TAG MAG per DAMAGE taken

**[AWARENESS : TARGET]**
- Tracks who a character is aware of
- Prerequisite for TARGETING

**[GRAPPLED : TARGET, CR]**
- Being grappled by someone
- Movement limits based on size delta
- -1 TAG on passed GRAPPLE RESULT ROLL

**[FLINCH]**
- Set from surprises or intense senses
- Trades ACTIONS for TAG MAG at turn start

### Item Condition TAGs

**[BROKEN]**
- Cannot EQUIP if BROKEN MAG ≥ ITEM MAG
- Decreases functional MAG by 1 per TAG MAG
- Removed by CRAFT RESULT ROLL : (CR 10 + ITEM MAG)

**[FIRE!]** [DISPERSING]
- Things on fire
- Spreads to [FLAMMABLE] adjacent targets
- Deals damage, causes BROKEN on items/tiles

**[FLAMMABLE]**
- Can catch fire automatically
- Converts to [FIRE!] when adjacent to fire

## Item MAG Budget System

Items use a budget system for balancing:

### Budget Formula
```
Base Item MAG
- Tag Costs (each tag consumes MAG)
= Remaining MAG (for core function)
```

### Example: MAG 3 Sword
```
MAG 3 Sword:
- 1 MAG → [sword] tag (enables sword actions)
= 2 MAG → Damage calculation (MAG 2 = 1d4)
```

### Example: MAG 4 Healing Potion
```
MAG 4 Potion:
- 1 MAG → [potion] tag (drinkable container)
- 2 MAG → [alchemy:healing] ×2 (healing effect)
= 1 MAG → Effect potency
```

### MAG 1 Item Bounds

Properties for MAG 1 items:

| Property | MAG 1 Value |
|----------|-------------|
| ROLL | MAG 0-1 (flat 1 or 1d2) |
| DAMAGE | Correlates with ROLL |
| HARDNESS | MAG 0-1 (paper to light armor) |
| CONDUCTIVITY | MAG 0 |
| WEIGHT | -1 to 1 (feather to chestplate) |
| SIZE | -1 to 1 (grape to chestplate) |
| DISTANCE | -1 to 1 (inches to adjacent tile) |
| SPEED | MAG 0-1 (+1 per round/action) |
| TIME | 0 (instant) |

## Tool Tags for Actions

Tools use TAGS to specify which actions they enable:

### Action-Enabling Tags

| Tag | Enables Action | Range Type | Notes |
|-----|---------------|------------|-------|
| `[melee]` | USE.IMPACT_SINGLE | MELEE | Close combat |
| `[reach : X]` | USE.IMPACT_SINGLE | MELEE | +X tile range |
| `[thrown]` | USE.PROJECTILE_SINGLE | THROWN | 5 tile base, uses STR |
| `[projectile]` | USE.PROJECTILE_SINGLE | PROJECTILE | 30+ tile base |
| `[bow]` | USE.PROJECTILE_SINGLE | PROJECTILE | Specific bow rules |
| `[crossbow]` | USE.PROJECTILE_SINGLE | PROJECTILE | Higher range |
| `[ammunition]` | — | — | Consumable ammo |

### Unified USE.PROJECTILE_SINGLE

One action subtype, tool tags determine behavior:

**Thrown (Hand-Thrown):**
- Tags: `[thrown]`
- Range: THROWN (5 tiles)
- Damage: Tool MAG + STR bonus

**Projectile (Weapon-Propelled):**
- Tags: `[projectile] [bow]` or `[projectile] [crossbow]`
- Range: PROJECTILE (30-45 tiles)
- Damage: Tool MAG + Ammunition MAG

**Example Comparison:**

| Scenario | Tool Tags | Range | Damage Calc |
|----------|-----------|-------|-------------|
| Throw arrow by hand | `[thrown]` | 5 tiles | MAG 1 (arrow) + STR |
| Shoot arrow from bow | `[projectile] [bow]` | 30 tiles | MAG 1 (bow) + MAG 1 (arrow) |
| Throw rock | `[thrown]` | 5 tiles | MAG 1 (rock) + STR |
| Shoot crossbow bolt | `[projectile] [crossbow]` | 45 tiles | MAG 2 (crossbow) + MAG 1 (bolt) |

## Tag-Based Tool Implementation

### Tool Item Structure

```typescript
interface ToolItem {
  ref: string;
  name: string;
  mag: number;        // Base MAG budget
  tags: string[];     // Action and property tags
  // Tag MAGs tracked separately if needed
}
```

### Tool Validation Flow

1. Check if item has `[TOOL]` tag (can equip)
2. Check if item has action-enabling tags (can use for action)
3. Determine range type from tags (`[thrown]` vs `[projectile]`)
4. Calculate effective range from tool MAG + tag bonuses
5. Calculate damage from remaining MAG budget

### Multiple Actions Per Tool

Tools can enable multiple actions:

```typescript
// Sword that can swing OR throw
{
  name: "Throwing Knife",
  mag: 2,
  tags: ["tool", "melee", "thrown", "damage:piercing"]
}
// Enables: USE.IMPACT_SINGLE (melee) AND USE.PROJECTILE_SINGLE (thrown)
```

## Integration with Action System

### Current Implementation

- **Phase 1 Complete:** Tool validation checks `[tool]` tag presence
- **Phase 2 Complete:** Range calculation uses tool tags to determine range type

### Files Modified

- `src/tool_system/tool_requirements.ts` - Tag-based requirements
- `src/action_range/range_calculator.ts` - Tag-based range determination

### Next Steps

- Implement MAG budget calculation (tag costs vs remaining MAG)
- Calculate damage from remaining MAG after tag costs
- Handle ammunition (bow + arrow) MAG stacking

## References

- **Tags Overview:** https://www.thaumworld.xyz/tags/
- **Tag Table:** https://www.thaumworld.xyz/tag-table/
- **Items & Inventory:** https://www.thaumworld.xyz/items-n-inventory/
- **Action Range Plan:** `docs/plans/2026_02_06_action_range_system.md`

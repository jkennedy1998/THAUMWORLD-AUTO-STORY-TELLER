# Action Range System Implementation Plan

**Date:** 2026-02-06  
**Status:** 🟡 PHASES 1-6 COMPLETE (Tool, Range, Actions, Inspect, Effectors, Rolls)  
**Priority:** High  
**File:** `docs/plans/2026_02_06_action_range_system.md`

> **Dependencies:** Place Module Phase 5.2 complete (click-to-move working)

---

## Overview

Implement range validation and action mechanics for the 4 core action types. Each action uses a tool (equipped item in body slot), has defined ranges, and integrates with THAUMWORLD's MAG, proficiency, and roll systems.

**Core Actions:** COMMUNICATE, MOVE, USE, INSPECT

**Key Mechanics:**
- Tools from body slots
- Action economy (full/partial actions in timed events)
- Result rolls (D20 vs CR) for success/failure
- Potency rolls (MAG-based) for effect magnitude
- Effectors modify rolls and ranges

---

## Tools & Body Slots

Every action requires a tool from the actor's body slots:

### Action Default Tools

| Action | Default Tool | Body Slot | Notes |
|--------|--------------|-----------|-------|
| **COMMUNICATE** | Mouth | Head (Critical Slot) | All NPCs have mouth for speaking |
| **USE** | Hand | Hand Slot(s) | Actors/NPCs can have multiple hands |
| **MOVE** | Leg | Leg Slot(s) | Typically 2 legs for walking |
| **INSPECT** | Best Sense | Varies | Highest MAG sense from body slots |

### Tool Examples

**COMMUNICATE:**
- Default: `mouth` (on head)
- Alternative: `voice_amplifier` (item), `telepathy_crown` (magical)

**USE:**
- Empty hand: Unarmed impact
- Holding sword: `sword.use_impact_single` or `sword.use_impact_arc`
- Holding bow: `bow.use_projectile_single` (requires arrows)
- Holding potion: `potion.use_projectile_single` (thrown)

**MOVE:**
Each character has 4 movement types with separate speed pools:

**MOVE.WALK**
- **Tool:** Legs (×2 for typical characters)
- **Minimum:** 0 = can't stand
- **Action Cost:** PARTIAL (1 tile) or FULL (replenish speed)

**MOVE.CLIMB** (TODO)
- **Tool:** Hands and feet
- **Minimum:** 0 = can't hold on
- **Action Cost:** PARTIAL (1 tile) or FULL (replenish speed)

**MOVE.SWIM** (TODO)
- **Tool:** Body (fins, flippers, or natural ability)
- **Minimum:** 0 = sinks
- **Action Cost:** PARTIAL (1 tile) or FULL (replenish speed)

**MOVE.FLY** (TODO)
- **Tool:** Wings, flight magic, or levitation device
- **Minimum:** 0 = falls
- **Action Cost:** PARTIAL (1 tile) or FULL (replenish speed)

**INSPECT:**
- Default: Best available sense (usually `light` from head)
- Senses from body slots: `light` (sight), `pressure` (hearing), `aroma` (smell)

### Tool Requirements

```typescript
interface ToolRequirement {
  slot_type: 'hand' | 'leg' | 'head' | 'any_sense';
  specific_item?: string;  // e.g., 'item.bow'
  tags?: string[];  // e.g., ['weapon', 'ranged']
  minimum_mag?: number;  // Tool must be MAG N or higher
}

// Example: Using a sword
const sword_requirement: ToolRequirement = {
  slot_type: 'hand',
  tags: ['weapon', 'melee']
};

// Example: Communicating
const voice_requirement: ToolRequirement = {
  slot_type: 'head',
  specific_item: 'mouth'  // Critical slot - all characters have this
};
```

---

## Action Economy (Timed Events)

During timed events (combat, initiative mode), actors have limited actions:

### Action Types

| Action Cost | Description | Roll Type |
|-------------|-------------|-----------|
| **FULL** | Complete action with all bonuses | Full roll (proficiency + stats + effectors) |
| **PARTIAL** | Rushed action | NAT roll only (no bonuses) |
| **FREE** | Instant action | Full roll |
| **EXTENDED** | Takes multiple rounds | Special timing |

### Action Refresh

- Actions refresh each new turn
- Typical character: 1 FULL + 1 PARTIAL per turn
- Some characters may have different action budgets

### Movement vs Actions

**Critical Distinction:** Movement and Actions are separate systems.

**Actions (FULL/PARTIAL/FREE):**
- Used for: COMMUNICATE, USE, INSPECT
- Refreshed each turn
- Cannot be used for movement

**Movement Speed:**
- Used for: MOVE.WALK, MOVE.CLIMB, etc.
- Costs speed points (1 per tile)
- Depletes all movement types by 1 when used
- Replenished by using FULL action
- Independent of action budget

**Example Turn:**
```
Start: walk_speed=6, actions=1 FULL + 1 PARTIAL

Movement: Walk 2 tiles (speed→4) - costs no actions
Action: Attack with sword (FULL action)
Movement: Walk 1 more tile (speed→3) - still no action cost
Action: Not used (PARTIAL remains)

End: walk_speed=3, 1 PARTIAL action unused
```

### Roll Types

**Full Roll (FULL actions):**
```
Result = D20 + PROF MAG (if relevant) + STAT BONUS + EFFECTORS
Potency = MAG ROLL + PROF MAG (if relevant) + EFFECTORS
```

**NAT Roll (PARTIAL actions):**
```
Result = D20 (raw)
Potency = MAG ROLL (raw)
```

**Example:**
```
Player attacks with sword (FULL action):
  Result Roll: D20 + 2 (sword prof) + 3 (strength) + 1 (perk)
  Target CR: 15
  Roll: 12 + 2 + 3 + 1 = 18 ≥ 15 → HIT
  
  Potency Roll: MAG 3 (sword) = 1d6 + 2 (sword prof)
  Roll: 4 + 2 = 6 damage

Player attacks rushed (PARTIAL action):
  Result Roll: D20 (raw)
  Roll: 14 ≥ 15 → MISS (no bonuses)
```

---

## Core Actions & Subtypes

### COMMUNICATE

**Tool:** Mouth (default, on head)
**Action Cost:** FREE (talking is free) or FULL (complex communication)

**Subtypes (Loudness Control):**

| Subtype | Range | Action Cost | Detection |
|---------|-------|-------------|-----------|
| **COMMUNICATE.WHISPER** | 1 tile | FREE | Only adjacent hear |
| **COMMUNICATE** | 3 tiles | FREE | Normal hearing range |
| **COMMUNICATE.SHOUT** | 10 tiles | FREE | Long range, may attract enemies |
| **COMMUNICATE.TELEPATHY** | ∞ | FREE | No physical detection |

**TODO:** Telepathy system (requires psychic ability)

---

### MOVE

**Movement Types & Tools:**
Each character has 4 movement types with separate speed pools. Using one depletes all others by 1.

| Subtype | Tool | Speed Pool | Minimum | Notes |
|---------|------|------------|---------|-------|
| **MOVE.WALK** | Legs (×2) | walk_speed | 0 = can't stand | Default movement |
| **MOVE.CLIMB** | Hands + Feet | climb_speed | 0 = can't hold | Vertical surfaces |
| **MOVE.SWIM** | Body/fins | swim_speed | 0 = sinks | Water movement |
| **MOVE.FLY** | Wings/magic | fly_speed | 0 = falls | Aerial movement |

**Movement Mechanics:**

**Speed Pool System:**
- Each character has separate pools: walk_speed, climb_speed, swim_speed, fly_speed
- Moving 1 tile costs 1 speed point from ALL pools (using walk reduces climb, swim, fly too)
- Prevents chaining movement types (can't walk then fly in same turn)
- Movement is independent of action economy

**Movement Cost vs Action Cost:**
- **Movement:** Costs speed points (1 per tile), NOT actions
- **Replenish Speeds:** Costs FULL action to restore all speeds to max
- **World Travel:** EXTENDED action (~2 hours for 1 world tile)

**Key Distinction:**
```
Actions (FULL/PARTIAL/FREE): Used for COMMUNICATE, USE, INSPECT
Movement Speed: Used for MOVE (walking, climbing, etc.)

Example:
- Player has: 1 FULL action, 1 PARTIAL action, walk_speed=6
- Can: Walk 6 tiles (costs speed, not actions)
- Can: Attack with sword (costs FULL action)
- Can: Walk 2 more tiles if speed > 0
- Can: Replenish speeds (costs FULL action)
```

**Timed Events (Combat):**
```
Player has: walk=6, climb=3, swim=0, fly=0
Movement: Walk 1 tile
Cost: 1 speed point (walk=5, climb=2, swim=0, fly=0)
Action: None (movement is free, just costs speed)
Result: All movement pools reduced by 1

Can continue walking until walk_speed=0
Next turn: pools reset to max
```

**Out of Combat:**
```
Movement: 1 tile (costs 1 speed, no action required)
Or: Travel entire world tile in ~2 hours (EXTENDED action)
```

**Minimum Capabilities:**
- **WALK 0:** Can't stand (must crawl or be carried)
- **CLIMB 0:** Can't hold on (falls off surfaces)
- **SWIM 0:** Sinks (drowning without flotation)
- **FLY 0:** Falls (gravity applies)

**Example Scenarios:**

**Scenario A: Walking**
```
Player has walk_speed=6, actions: 1 FULL, 1 PARTIAL
Tool: legs (×2)
Movement: Walk to adjacent tile (1 speed point)
Action Cost: None (just costs speed)
Speed Result: walk=5, climb-1, swim-1, fly-1
Action Budget: Still has 1 FULL, 1 PARTIAL
Can continue moving as long as walk_speed > 0
```

**Scenario B: Complex Turn (Movement + Actions)**
```
Start of turn: walk_speed=6, actions: 1 FULL, 1 PARTIAL

Step 1: Walk 3 tiles to approach enemy
- Cost: 3 speed points
- Speeds: walk=3, others reduced by 3
- Actions remaining: 1 FULL, 1 PARTIAL

Step 2: Attack with sword (FULL action)
- Cost: 1 FULL action
- Actions remaining: 0 FULL, 1 PARTIAL
- Speeds unchanged: walk=3

Step 3: Walk away 2 tiles
- Cost: 2 speed points
- Speeds: walk=1
- Actions unchanged: 0 FULL, 1 PARTIAL

End of turn: walk_speed=1, 1 PARTIAL action unused
```

**Scenario C: Exhausted Movement**
```
Player has walk_speed=0 (exhausted)
Cannot move (no speed remaining)

Option 1: Use FULL action to replenish
- Action: "catch your breath" (FULL)
- Result: All speeds reset to max
- Can now move again

Option 2: Use PARTIAL action for something else
- Action: Look around (PARTIAL INSPECT)
- Movement: Still cannot move (speed=0)
- Must replenish next turn to move
```

**Current Implementation Scope:**
- ✅ **WALK:** Fully implement with leg-based movement
- 🟡 **CLIMB:** Plan for future (hands+feet)
- 🟡 **SWIM:** Plan for future (body/fins)
- 🟡 **FLY:** Plan for future (wings/magic)
- ❌ **BURROW:** Skip for now (requires tool hardness ≥ terrain)

**TODO Movement Subtypes:**
- [ ] MOVE.CLIMB - Vertical wall climbing
- [ ] MOVE.SWIM - Water surface and underwater
- [ ] MOVE.FLY - Aerial movement and levitation
- [ ] MOVE.BURROW - Underground (requires tool hardness system)

---

### USE

**Tool:** Hand (holding item) or Body Part
**Action Cost:** Varies by subtype

**Active Subtypes:**

**USE.IMPACT_SINGLE**
- **Description:** Direct impact on single adjacent target
- **Range:** 1 tile (must be adjacent)
- **Action Cost:** FULL
- **Examples:** Sword thrust, punch, dagger stab
- **Tool:** Hand holding melee weapon, or unarmed
- **Rolls:** 
  - Result: D20 vs target defense CR
  - Potency: Weapon MAG roll
- **Target:** Single tile

**USE.PROJECTILE_SINGLE**
- **Description:** Throw or launch an item/projectile
- **Range:** 5 tiles (base), modified by tool
- **Action Cost:** FULL
- **Examples:** Shoot bow, throw potion, cast fireball
- **Tool:** Hand holding projectile weapon/item
- **Rolls:**
  - Result: D20 + accuracy prof vs distance CR
  - Potency: Projectile MAG roll
- **Mechanics:**
  1. Select target tile/character
  2. Calculate trajectory
  3. Result roll determines hit/miss
  4. **If Hit:** Projectile lands on target, impact occurs
  5. **If Miss:** Scatters to nearby tile (see scatter rules)
  6. **Item Location:** Projectile remains at landing tile

**TODO Subtypes (Future):**
- [ ] USE.IMPACT_ARC - Melee arc hitting multiple adjacent
- [ ] USE.AREA - Area effect (bombs, spells)

---

### INSPECT

**Tool:** Best Sense from body slots
**Action Cost:** FREE (glance) or PARTIAL (detailed inspection)
**Range:** 10 tiles (base)

**Simplified System:**
Single INSPECT action with detail determined by distance MAG.

**Distance MAG Table:**
- MAG 0 = within 1 tile (clear detail)
- MAG 1 = 2 tiles (clear detail)
- MAG 2 = 3 tiles (clear detail)
- MAG 3 = 5 tiles (clear detail)
- MAG 4 = 10 tiles (vague/obscured)
- MAG 5+ = beyond inspect range

**Obscurity System:**
```
Inspector Sight MAG = 3

Target at 2 tiles (MAG 1):
  MAG 1 ≤ (3 + 2) = 5 → CLEAR detail
  
Target at 8 tiles (MAG 4):
  MAG 4 = (3 + 2) + 1 → VAGUE detail (N+1 obscured)
  
Target at 12 tiles (MAG 5):
  MAG 5 > (3 + 2) + 1 → UNSEEN (too far)
```

---

## Range System

### Base Ranges

| Action/Subtype | Base Range | Range Modifier Sources |
|----------------|------------|----------------------|
| COMMUNICATE.WHISPER | 1 tile | — |
| COMMUNICATE | 3 tiles | — |
| COMMUNICATE.SHOUT | 10 tiles | — |
| MOVE | ∞ | — |
| USE.IMPACT_SINGLE | 1 tile | `effect.far_reach` (+1) |
| USE.PROJECTILE_SINGLE | 5 tiles | Tool MAG, `perk.long_shot` (+2) |
| INSPECT | 10 tiles | Sense MAG, `item.spyglass` (+5) |

### Effectors That Modify Range

**SHIFT (Additive):**
- `perk.long_shot` → PROJECTILE_SINGLE +2 tiles
- `effect.far_reach` → IMPACT_* +1 tile
- `condition.nearsighted` → INSPECT -3 tiles (min 1)
- `condition.deafened` → COMMUNICATE ranges halved (round down)

**SCALE (Multiplicative):**
- `effect.giant_strength` → Throw range ×1.5
- `spell.wind_boost` → Projectile range ×2

---

## Effectors System

Effectors modify actions through perks, tags, buffs, and debuffs.

### Effector Types

**SHIFT (+/-):** Addition/subtraction
**SCALE (×/÷):** Multiplication/division

### Application Order

1. Base value (NAT ROLL)
2. SHIFT effectors (additive)
3. SCALE effectors (multiplicative)
4. Rules/caps

### Example Effectors

```typescript
// Range effectors
const long_shot: Effector = {
  type: 'SHIFT',
  target: 'range',
  value: +2,
  condition: 'action_subtype === PROJECTILE_SINGLE'
};

// Result roll effectors  
const sharp_aim: Effector = {
  type: 'SHIFT',
  target: 'result_roll',
  value: +2,
  condition: 'action_type === USE && tool.tags.includes("ranged")'
};

// Potency effectors
const powerful_blow: Effector = {
  type: 'SCALE',
  target: 'potency_roll',
  value: 1.5,  // ×1.5 damage
  condition: 'action_subtype === IMPACT_SINGLE && roll_nat === 20'
};

// Tag-based debuff
const blinded: Effector = {
  type: 'SHIFT',
  target: 'result_roll',
  value: -5,
  condition: 'action_type === USE && action_subtype === PROJECTILE_SINGLE'
};
```

---

## Projectile System (USE.PROJECTILE_SINGLE)

### Hit/Miss Calculation

**Result Roll:** D20 + accuracy prof + effectors vs Distance CR

**Distance Challenge Ratings:**
- 1 tile: CR 5 (intuitive)
- 2 tiles: CR 10 (takes concentration)
- 3 tiles: CR 12
- 4 tiles: CR 15 (not easy)
- 5 tiles: CR 18 (very hard)

**Outcome:**
- **Hit (≥ CR):** Projectile lands on target
- **Miss (< CR):** Projectile scatters

### Scatter Rules

On miss, calculate scatter distance and direction:

```typescript
function calculate_scatter(
  target: TilePosition,
  miss_by: number  // How much roll missed CR by
): TilePosition {
  // Scatter distance: 1 tile per 3 points missed
  const scatter_tiles = Math.ceil(miss_by / 3);
  
  // Random direction
  const angle = Math.random() * 2 * Math.PI;
  const dx = Math.round(Math.cos(angle) * scatter_tiles);
  const dy = Math.round(Math.sin(angle) * scatter_tiles);
  
  return {
    x: target.x + dx,
    y: target.y + dy
  };
}
```

### Item Persistence

After landing:
- **Retrievable:** Arrows, daggers, rocks (item remains)
- **Consumed:** Potions (break), bombs (explode), fireballs (dissipate)
- **Stuck:** Arrows in bodies (must be removed)

**Example Scenarios:**

**Scenario A: Direct Hit**
```
Player shoots arrow at Goblin (3 tiles away)
CR: 12, Roll: 15 + 2 (accuracy) = 17 ≥ 12
Result: HIT
Arrow lands on Goblin's tile
Goblin takes 1d6 damage
Arrow can be retrieved from Goblin's body
```

**Scenario B: Miss with Scatter**
```
Player throws bomb at Bandit (5 tiles away)
CR: 18, Roll: 12 + 2 = 14 < 18 (missed by 4)
Scatter: 2 tiles away from Bandit
Bomb lands at (7, 5) - empty tile
Bomb explodes, affects radius around (7,5)
Bandit takes 50% splash damage
```

**Scenario C: Miss Hits Ally**
```
Player shoots arrow at Orc (4 tiles away)
CR: 15, Roll: 11 + 2 = 13 < 15 (missed by 2)
Scatter: 1 tile past Orc
Arrow lands on tile with Grenda (ally)
Grenda takes 1d6 damage
Arrow remains on ground (can be retrieved)
```

---

## Roll Integration

### Result Rolls (D20)

**When:** Determining success/failure of action
**Formula:** `D20 + PROF MAG + STAT BONUS + EFFECTORS`

**Relevant Stats by Action:**
- COMMUNICATE: Charisma
- USE (melee): Strength or Dexterity
- USE (ranged): Dexterity (accuracy)
- INSPECT: Wisdom (instinct)
- MOVE: Constitution or Dexterity

**Challenge Ratings:**
- Adjacent target: CR 5
- 2-3 tiles: CR 10-12
- 4-5 tiles: CR 15-18
- Moving target: +5 CR
- Obscured: +3 CR

### Potency Rolls (MAG-based)

**When:** Determining magnitude of effect
**Formula:** `MAG ROLL + PROF MAG + EFFECTORS`

**MAG to Dice:**
- MAG -2: 1d4 (average 2.5)
- MAG 0: 1
- MAG 1: 1d2
- MAG 2: 1d4
- MAG 3: 1d6
- MAG 4: 1d8
- MAG 5: 2d4
- MAG 6: 1d10

**Examples:**
```
Sword (MAG 3 damage):
  Roll: 1d6
  Average: 3.5 damage

Bow (MAG 3 damage):
  Roll: 1d6
  Average: 3.5 damage

Potion explosion (MAG 4):
  Roll: 1d8
  Average: 4.5 damage in radius
```

---

## Proficiency Integration

Each action type has associated proficiencies:

| Action | Relevant Proficiencies | Primary Stat |
|--------|----------------------|--------------|
| **COMMUNICATE** | Communication, Performance, Deception, Power | Charisma |
| **USE (melee)** | Brawn, Accuracy | Strength/Dexterity |
| **USE (ranged)** | Accuracy | Dexterity |
| **INSPECT** | Instinct | Wisdom |
| **MOVE** | Speed, Quiet | Dexterity |

**Proficiency Bonus:**
- 1 proficiency: MAG 1 = +1.5 average
- 2 proficiencies: MAG 2 = +2.5 average
- Applied to: Result rolls and Potency rolls

---

## Implementation Phases

### Phase 1: Tool System ✅ COMPLETE
**Files Created:**
- `src/tool_system/tool_requirements.ts` - Tool requirement definitions
- `src/tool_system/tool_resolver.ts` - Body slot tool resolution
- `src/tool_system/tool_validator.ts` - Tool validation logic
- `src/tool_system/index.ts` - Module exports

**Features Implemented:**
- [x] Tool requirements structure for all 4 core actions (COMMUNICATE, MOVE, USE, INSPECT)
- [x] Body slot checking (hand_slots, body_slots)
- [x] Default tool assignment (mouth, legs, hands, senses)
- [x] Tool validation with detailed error messages
- [x] Integration with action pipeline (PipelineDependencies.getActorData)

**Tool Requirements Defined:**
| Action | Slot | Requirements |
|--------|------|--------------|
| COMMUNICATE | head | mouth (critical) |
| MOVE | leg | 2 legs for walking |
| USE.IMPACT_SINGLE | hand | melee weapon or unarmed |
| USE.PROJECTILE_SINGLE | hand | ranged weapon |
| INSPECT | any_sense | best available sense |

### Phase 2: Action Range System ✅ COMPLETE
**Files Created:**
- `src/action_range/range_calculator.ts` - Range calculation with MAG modifiers
- `src/action_range/range_validator.ts` - Range validation with environmental factors
- `src/action_range/index.ts` - Module exports

**Features Implemented:**
- [x] Range types: TOUCH, MELEE, THROWN, PROJECTILE, SIGHT, UNLIMITED
- [x] Range calculation with tool MAG bonuses
- [x] Distance calculation between locations (world & tile coordinates)
- [x] Range penalties for extended distances
- [x] Environmental modifiers (light, weather, terrain)
- [x] Integration with action pipeline validation stage
- [x] Range penalty tracking for dice rolls

**Range Categories:**
| Type | Base Range | Max Range | Penalty/Tile |
|------|------------|-----------|--------------|
| TOUCH | 1 | 1 | 0 |
| MELEE | 1 | 2 | 0 |
| THROWN | 5 | 20 | -2 |
| PROJECTILE | 30 | 120 | -1 |
| SIGHT | 60 | 120 | -0.5 |

## TAG System Integration (v2 - Corrected)

Based on THAUMWORLD tag documentation and clarifications:

### Core Principles

1. **All Items Are Throwable** - No tag required to throw something
2. **Tools Determine Capabilities** - The equipped tool defines what actions are possible
3. **Tags Label Properties** - Tags describe what something IS, not what it can DO
4. **Meta Tags on Tag Rules** - `[tool]` meta tag is on the tag definition, not the item
5. **Rules Lawyer Integration** - Tag resolution happens in the rules system

### Tag Structure

**On Items:**
```typescript
interface TagInstance {
  name: string;        // e.g., "bow", "projectile", "fire!"
  stacks: number;      // MAG level of this tag (default: 1)
  value?: any;         // Tracked data (optional)
}

// Example: MAG 2 Longbow
{
  ref: "item.longbow",
  name: "Longbow",
  tags: [
    { name: "bow", stacks: 2 }  // This IS a MAG 2 bow
  ]
}

// Example: Arrow ammunition
{
  ref: "item.arrow",
  name: "Arrow",
  tags: [
    { name: "projectile", value: "arrow" },  // Marks as arrow-type ammo
    { name: "damage", value: "piercing" }
  ]
}
```

**Tag Rules (Separate Registry):**
```typescript
interface TagRule {
  name: string;
  meta_tags: string[];     // e.g., ["tool", "weapon", "ranged"]
  actions: ActionDefinition[];
  // ... other properties
}

// "bow" tag rule:
{
  name: "bow",
  meta_tags: ["tool", "weapon", "ranged"],  // Makes items with this tag into tools!
  actions: [{
    type: "USE.PROJECTILE_SINGLE",
    ammo_requirement: { tag: "projectile", value: "arrow" },
    range_category: "PROJECTILE",
    base_range: 30,
    damage_formula: "bow_stacks + ammo_mag"
  }]
}
```

### MAG System

**Item MAG** = Sum of all tag stacks  
**Tag Stacks** = Level/potency of that specific tag

```
MAG 3 Sword:
- [sword: 2] (2 stacks)
- [sharp: 1] (1 stack)
= Total MAG 3

MAG 3 Longbow:
- [bow: 3] (3 stacks)
= Total MAG 3
```

### Tool-Projectile Relationships

**Scenario 1: Throwing Any Item (Hand)**
```
Tool: Hand (default body part)
Rules: {
  actions: [{
    type: "USE.PROJECTILE_SINGLE",
    ammo_requirement: null,  // No restriction!
    range_category: "THROWN",
    base_range: 5
  }]
}

Projectile: Rock (no tags needed)
Result: ✅ Can throw rock
Range: 5 tiles × (STR / weight_mag)
Damage: item_mag + STR_bonus
```

**Scenario 2: Bow + Arrow**
```
Tool: Longbow with [bow: 3]
Rules: {
  ammo_requirement: { tag: "projectile", value: "arrow" }
}

Projectile: Arrow with [projectile: "arrow"]
Result: ✅ Match! Can fire arrow
Range: 30 + (3 × 2) = 36 tiles
Damage: 3 (bow) + 1 (arrow) = MAG 4
```

**Scenario 3: Throwing Sword**
```
Tool: Sword with [sword: 2]
Rules: {
  actions: [
    { type: "USE.IMPACT_SINGLE", range: "MELEE" },
    { type: "USE.PROJECTILE_SINGLE", range: "THROWN", penalty: -2 }
  ]
}

Projectile: Itself (sword is both tool and projectile)
Result: ✅ Can swing OR throw
Thrown: 5 tiles, damage MAG 2 - 1 (penalty)
```

**Scenario 4: Cannot Shoot Rock from Bow**
```
Tool: Bow requires "projectile:arrow"
Projectile: Rock (no [projectile] tag)
Result: ❌ Incompatible
Error: "Bow requires arrow ammunition"
```

### Tool Determines Proficiency

The equipped tool specifies which proficiencies apply to the action:

```
Bow: {
  proficiencies: ["Accuracy"]
  // Result: D20 + Accuracy MAG
}

Sword: {
  actions: [
    { proficiencies: ["Brawn", "Accuracy"] },  // Choose one
    { proficiencies: ["Accuracy"] }  // Throwing
  ]
}

Hand: {
  proficiencies: ["Brawn"]  // Throwing uses strength
}
```

**Rule:** When tool lists multiple proficiencies, actor chooses which to apply (usually highest).

---

## Documentation Complete ✓

### Clarified Concepts:
- ✓ Tag structure (name + stacks + optional value)
- ✓ Meta tags on tag rules (not items)
- ✓ Tool determines actions and proficiencies
- ✓ All items throwable (limited by STR vs weight)
- ✓ MAG system (item MAG = sum of tag stacks)
- ✓ Projectile tag only for specific ammo requirements
- ✓ **No improvised penalties** - Throwing sword is same as throwing rock
- ✓ **Weight is item property** - Weight MAG derived from weight thresholds
- ✓ **Projectiles move, not consumed** - Change location based on hit/miss

### All Questions Answered ✓

**1. Improvised Throwing:** No penalties. Sword throws same as javelin.

**2. Weight MAG:** Derived from `item.weight` property:
```
Weight ≤ 5 = MAG 1, Weight ≤ 15 = MAG 2, etc.
```

**3. Ammo Consumption:** Items change location, never deleted:
- Hit: In target's body or inventory
- Miss: On ground at scatter location

---

### Throwing Rules (Final)

**What Can Be Thrown:**
- Anything, if: `Thrower STR ≥ (Projectile Weight MAG - 2)`

**Weight MAG Calculation:**
```typescript
// Items have a 'weight' property (not a tag)
// Weight MAG is derived from weight thresholds:

function calculateWeightMAG(weight: number): number {
  if (weight <= 5) return 1;      // Light (rock, dagger)
  if (weight <= 15) return 2;     // Medium (sword, helmet)
  if (weight <= 30) return 3;     // Heavy (greatsword, armor)
  if (weight <= 50) return 4;     // Very Heavy (anvil, chest)
  return 5;                        // Extreme (furniture, boulders)
}

// Examples:
// Rock: weight 2 → MAG 1
// Sword: weight 10 → MAG 2
// Anvil: weight 45 → MAG 4
```

**Range Calculation:**
```
Base Range = Tool base range (5 for hands, varies for tools)
Effective Range = Base Range × (STR / Required STR)

Example:
- Rock (weight MAG 1)
- Thrower STR 3
- Required: max(0, 1 - 2) = 0
- Range: 5 × (3/1) = 15 tiles

Example:
- Anvil (weight MAG 5)
- Thrower STR 2
- Required: 5 - 2 = 3
- 2 < 3 = ❌ Too heavy to throw
```

**No Improvised Penalties:**
- No penalty for throwing swords, rocks, or any item
- All items thrown the same way through USE.PROJECTILE_SINGLE
- Tool bonuses (if any) apply based on tool type

### Roll System Integration

**Note:** A roll system already exists in the codebase:
- **Dice rolling:** `src/rules_lawyer/dice.ts` - Basic dice expressions (d20, 2d6, etc.)
- **Roll computation:** `src/rules_lawyer/effects.ts` - Handles SHIFT and SCALE effectors
- **Roller UI:** `src/mono_ui/modules/roller_module.js` - UI for rolling

The MAG budget system integrates with this existing roll system:
- **Result Roll:** D20 + proficiency MAG + stat bonus + effectors
- **Potency Roll:** Based on remaining MAG (core function MAG)
- **Effectors:** SHIFT (+/-) and SCALE (×/÷) applied in rules_lawyer

---

## MAG Budget System

### Overview

MAG (Magnitude) is the currency of power in THAUMWORLD. Every item has a MAG budget that determines:
- What tags it can have
- How powerful those tags are
- Remaining power for core function (damage, range, effects)

### Tag Generation Costs

Each tag has a **["generation_cost:X"]** meta tag that defines its MAG cost:

```typescript
// Tag Rule with generation cost:
{
  name: "bow",
  meta_tags: [
    "tool",
    "weapon",
    "generation_cost:2"  // Costs 2 MAG per bow stack
  ],
  actions: [...]
}

{
  name: "sword",
  meta_tags: [
    "tool",
    "weapon",
    "generation_cost:2"  // Costs 2 MAG per sword stack
  ],
  actions: [...]
}

{
  name: "piercing",
  meta_tags: [
    "damage_type",
    "generation_cost:1"  // Damage types cost 1 MAG
  ]
}
```

### Standard Costs

| Tag Type | Generation Cost | Examples |
|----------|----------------|----------|
| **Weapons** | 2 MAG | bow, sword, axe, crossbow |
| **Armor** | 2 MAG | armor, shield |
| **Damage Types** | 1 MAG | piercing, slashing, fire, cold |
| **Ammunition** | 1 MAG | projectile, arrow, bolt |
| **Quality** | 3 MAG | masterwork, magical |
| **Materials** | 0-1 MAG | steel (1), wood (0), leather (1) |

### Budget Calculation

```
Item MAG Budget = Total available MAG
- Tag Costs = Deducted based on generation_cost
= Remaining MAG = Core function (damage, range, etc.)
```

**Example: MAG 3 Longbow**
```
Budget: 3 MAG
- bow ×1 (cost 2) = 2 MAG
- damage:piercing ×1 (cost 1) = 1 MAG
= Remaining: 0 MAG for core damage

Wait! That's only MAG 1 bow damage. Let's recalculate:

Budget: 3 MAG
- bow ×1 (cost 2) = 2 MAG
= Remaining: 1 MAG for core damage

Better: MAG 4 Longbow
Budget: 4 MAG
- bow ×1 (cost 2) = 2 MAG
- damage:piercing ×1 (cost 1) = 1 MAG
= Remaining: 1 MAG for core damage
Bow acts as MAG 1 for damage
```

**Example: MAG 3 Sword**
```
Budget: 3 MAG
- sword ×1 (cost 2) = 2 MAG
= Remaining: 1 MAG for core damage
Sword acts as MAG 1 weapon

Better: MAG 5 Sword
Budget: 5 MAG
- sword ×2 (cost 4) = 4 MAG
- damage:slashing ×1 (cost 1) = 1 MAG
= Remaining: 0 MAG
Sword acts as MAG 2 weapon
```

### Scaling with Stacks

Higher MAG items can have more tag stacks:

```
MAG 6 Bow:
- bow ×3 (cost 6) = 6 MAG
= Remaining: 0 MAG
Bow acts as MAG 3 (higher damage, longer range)

MAG 6 Alternative:
- bow ×2 (cost 4) = 4 MAG
- damage:piercing ×1 (cost 1) = 1 MAG
- masterwork ×1 (cost 3) = 3 MAG
= Total spent: 8 MAG ❌ Over budget!

Must reduce:
- bow ×2 (cost 4) = 4 MAG
- masterwork ×1 (cost 3) = 3 MAG
= Total spent: 7 MAG ❌ Still over!

Final:
- bow ×1 (cost 2) = 2 MAG
- masterwork ×1 (cost 3) = 3 MAG
= Total spent: 5 MAG
= Remaining: 1 MAG
MAG 1 masterwork bow
```

### Core Function MAG

Remaining MAG after tag costs determines:
- **Damage:** Higher MAG = more damage dice
- **Range:** Higher MAG = longer range
- **Effects:** Higher MAG = stronger effects

**Damage Formula:**
```typescript
// Remaining MAG determines damage dice
function getDamageDice(mag: number): string {
  if (mag <= 0) return "1";        // Flat 1 damage
  if (mag === 1) return "1d2";     // MAG 1
  if (mag === 2) return "1d4";     // MAG 2
  if (mag === 3) return "1d6";     // MAG 3
  if (mag === 4) return "1d8";     // MAG 4
  if (mag === 5) return "2d4";     // MAG 5
  if (mag === 6) return "1d10";    // MAG 6
  return `${Math.floor(mag/2)}d6`; // Higher MAG
}
```

### Implementation

**File:** `src/tag_system/budget.ts`

```typescript
// Calculate if item fits within MAG budget
const budget = calculator.calculateBudget(3, [
  { name: "bow", stacks: 1 },
  { name: "piercing", stacks: 1 }
]);

// Result:
// valid: true/false
// spent: 3 MAG
// remaining: 0 MAG
// core_function_mag: 0
```

### Economy Integration

The MAG budget system drives:
- **Loot generation:** Monsters drop items with MAG based on difficulty
- **Crafting:** Players spend MAG budget when creating items
- **Trading:** Item value scales with MAG
- **Balancing:** Powerful tags cost more MAG

**Loot Table Example:**
```typescript
// Goblin (easy enemy):
// Drops MAG 1-2 items
// Small chance of MAG 3

// Dragon (hard enemy):
// Drops MAG 5-8 items
// Guaranteed magical properties
```

### Phase 3: Core Actions ✅ COMPLETE

**Files Created:**
```
src/action_handlers/
├── core.ts    # Action handler implementations
└── index.ts   # Exports
```

**Implemented Handlers:**

**1. COMMUNICATE Action**
- WHISPER: 1 tile range
- NORMAL: 3 tiles range
- SHOUT: 10 tiles range
- TELEPATHY: Unlimited (placeholder)

**2. MOVE Action**
- WALK: Standard movement
- CLIMB, SWIM, FLY: Placeholders for future
- Speed cost tracking

**3. USE.IMPACT_SINGLE (Melee)**
- Adjacent range only
- Damage based on tool MAG
- Damage dice: MAG 1=1d2, MAG 2=1d4, MAG 3=1d6, etc.

**4. USE.PROJECTILE_SINGLE (Ranged)**
- Thrown items (hand throwing)
- Projectile weapons (bow, crossbow)
- Hit/miss calculation
- Scatter on miss
- Projectile sticks or bounces
- Item location changes after throw

**Integration:**
- Pipeline uses new handlers for core actions
- Legacy execution for other actions
- ActionContext provides all needed data
- Effects converted to pipeline format

### Phase 4: INSPECT System ✅ COMPLETE

**File Created:**
```
src/action_handlers/inspect.ts
```

**Features:**
- Single INSPECT action (no subtypes needed)
- Distance MAG determines clarity
- Best sense auto-selected (sight, hearing, smell, magic)
- Clarity levels: clear, vague, obscured, none
- Detail varies by distance:
  - Clear: Full appearance, equipment, condition
  - Vague: General shape only
  - Obscured: Just a blur
  - None: Can't perceive

**Distance MAG Table:**
- MAG 0-1: Within 1 tile (clear)
- MAG 2: 3 tiles (clear)
- MAG 3: 5 tiles (clear)
- MAG 4: 10 tiles (vague)
- MAG 5+: Beyond range

**Integration:**
- Uses existing `src/inspection` system
- Pipeline routes INSPECT verb to handler
- Actor senses from body slots

### Phase 5: Effectors ✅ COMPLETE

**File Created:**
```
src/effectors/
└── index.ts    # Effector system
```

**Features:**
- **SHIFT Effectors**: Additive modifiers (+/-)
  - Example: `masterwork` tag → SHIFT +1 to rolls
  - Example: `accurate` tag → SHIFT +2 to attack rolls
  - Example: `nearsighted` → SHIFT -3 to inspect range

- **SCALE Effectors**: Multiplicative modifiers (×/÷)
  - Example: `giant_strength` → SCALE ×1.5 to throw range
  - Example: `wind_boost` → SCALE ×2 to projectile range
  - Example: `deadly` → SCALE ×1.2 to damage

**Applied To:**
- Damage rolls (USE.IMPACT_SINGLE, USE.PROJECTILE_SINGLE)
- Attack rolls (hit/miss calculation)
- Range calculations (throw and projectile range)
- Future: Will apply to all rolls and ranges

**Integration:**
- Action handlers apply effectors from tool tags
- Effector registry stores tag-based effectors
- Formula: `(base + total_SHIFT) × total_SCALE`
- Effector info included in action results

### Phase 6: Roll Integration ✅ COMPLETE

**File Created:**
```
src/roll_system/
└── index.ts    # Roll system integration
```

**Features:**
- **D20 Result Rolls**: Natural roll (1-20) + proficiency + stat + effectors
- **CR Calculation**: Challenge Rating based on distance, defense, difficulty
- **Proficiency Integration**: Tool determines applicable proficiencies
  - Actor uses highest applicable proficiency
  - Proficiencies: Accuracy, Brawn, Instinct, Hearth, Pain, Mechanics, Lore, Deception, Conversation
- **Stat Bonuses**: STR, DEX, CON, INT, WIS, CHA, PER
- **MAG Potency Rolls**: Damage/effect dice based on MAG level
  - MAG 1 = 1d2, MAG 2 = 1d4, MAG 3 = 1d6, etc.
- **Success/Failure**: Roll total vs CR

**Roll Formula:**
```
Total = (D20 + Proficiency + Stat + SHIFT) × SCALE
Success = Total >= CR
```

**Integration:**
- Pipeline performs rolls during action execution
- Roll results passed to action handlers
- Roll info logged for debugging
- Uses existing rules_lawyer dice system
- Uses existing UI roller module

### Next Phases (Ready to Start)
- Phase 7: UI Integration (range circles, indicators)

**TODO (Future):**
- [ ] USE.IMPACT_ARC (melee cleave)
- [ ] USE.AREA (bombs/spells)
- [ ] COMMUNICATE.TELEPATHY (psychic)

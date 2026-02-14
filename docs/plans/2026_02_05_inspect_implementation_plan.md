# INSPECT Action Implementation Plan

**Status:** 🟡 PARTIALLY IMPLEMENTED - Phases 1-2 complete, Phases 3-7 pending  
**Date:** 2026-02-05  
**File:** `docs/plans/inspect_implementation_plan.md`

> **NOTE:** Implementation in progress. See `src/inspection/` for current progress (4 of 7 phases).

## Overview
Implement the INSPECT action for text and click-based interactions through the place module. Inspect reveals perceivable details about characters, tiles, and items based on sense range and specificity.

---

## Design Decisions (ANSWERED)

### Q1: Sense System - THAUMWORLD Tabletop Rules
Using actual tabletop rules from https://www.thaumworld.xyz/senses/

**Distance MAG Table:**
- MAG 0 = within 1 tile
- MAG 1 = adjacent tile  
- MAG 2 = 3 tiles away
- MAG 3 = 5 tiles away
- MAG 4 = 10 tiles away
- MAG 5 = 30 tiles away

**SENSE RANGES:**
- **LIGHT (Sight)**: DISTANCE MAG = LIGHT MAG + 2
  - MAG 3 Human sight: Can see clearly to MAG 5 (30 tiles)
  - MAG 4 Low-light: Clear to MAG 6 (100 tiles)
  - Obscurity at N+1: MAG 3 sight sees vague at MAG 6 (100 tiles)
  - Line of sight only, walls block entirely

- **PRESSURE (Hearing)**: DISTANCE MAG = PRESSURE MAG + 1
  - MAG 3 Human hearing: Clear to MAG 4 (10 tiles)
  - Can penetrate walls at higher MAG
  - Obscurity = muffled/muted

- **AROMA (Smell)**: DISTANCE MAG = AROMA MAG + 1
  - MAG 3 Trackable scent: Clear to MAG 4 (10 tiles)
  - Follows air currents

- **THAUMIC (Magic sense)**: DISTANCE MAG = THAUMIC MAG
  - MAG 3 Sense life: Clear to MAG 3 (5 tiles)
  - Location only, not identity
  - Walls reduce MAG: thin wall -1, thick wall -2

**CLARITY LEVELS:**
- **Clear**: Within range formula result - Full details
- **Vague**: At range+1 - Basic info, missing details
- **Obscured**: At range+2 or blocked - Presence only, minimal info
- **None**: Beyond range+2 - Cannot detect

### Q2: Data Storage
- **Item/Templates**: `local_data/shared/items/` (shared database)
- **Tile Instances**: Per-place in place files (tile references with coordinates)

### Q3: Expanded Word Recognition

**Equipment/Appearance:**
- "clothes", "armor", "equipment", "weapon", "wearing", "holding", "gear"
- "outfit", "attire", "garments", "vestments"
- "sheathed", "drawn", "stowed", "brandished"

**Physical:**
- "appearance", "face", "body", "build", "hair", "eyes", "features"
- "stature", "figure", "physique", "complexion"
- "scars", "marks", "tattoos", "blemishes"

**Status:**
- "health", "wounds", "injured", "status", "condition", "hurt"
- "bleeding", "fatigued", "exhausted", "winded"
- "poisoned", "cursed", "afflicted", "ailing"

**Inventory (VISIBLE ONLY):**
- "carrying", "inventory", "items", "pockets", "bag", "pack"
- "satchel", "pouch", "belt", "backpack"
- "equipped", "worn", "held"
- *Excludes container items on person, items inside containers*

**Identity:**
- "name", "who", "what", "race", "kind", "profession"
- "occupation", "title", "background", "lineage"
- "affiliation", "faction", "allegiance", "allegiance"

**Behavior:**
- "doing", "action", "activity", "intent", "plan"
- "mannerisms", "posture", "stance", "gait"
- "demeanor", "attitude", "mood", "temperament"

### Q4: Hidden Items & CR System
Hidden items require a **passed INSPECT action** with CR (Challenge Rating) check.

**Rules:**
- Roll D20 + effectors vs CR
- Default hidden item CR: 10 ("takes concentration")
- No blunder/peak ratings for inspect (simplified)
- Effectors: 1 proficiency (relevant skill), 1 stat bonus, infinite situational

**Example:** Trap requiring instinct roll CR 10
- Player: "inspect floor for traps"
- System: Roll instinct (prof) + wisdom (stat) + any effectors
- Result >= 10: Discover trap
- Result < 10: Miss it (but can retry with different approach)

### Q5: Click Controls - Right-Click Cycling
**Right-click cycles through targets on the SAME tile:**
1. Characters (NPCs/Actors on tile)
2. Items (on ground, visible)
3. Tile itself (terrain, features)

**Excluded from cycling:**
- Items inside containers
- Items inside character inventories
- Container items worn by characters

**Flow:**
- Right-click tile → Select first target (NPC/Item/Tile)
- Right-click same tile again → Cycle to next target
- Shift+Right-click → Force tile inspection (skip entities)

---

## Implementation Plan

### Phase 1: Data Infrastructure (Prerequisites)

#### 1.1 Create Tile Databank Schema

**File**: `local_data/shared/tiles/default_tiles.jsonc`

```jsonc
{
  "schema_version": 1,
  "tiles": [
    {
      "id": "wooden_floor",
      "name": "Wooden Floor",
      "category": "floor",  // floor, wall, obstacle, terrain, water
      "display": {
        "char": ".",
        "color": "#8B4513",  // Saddle brown
        "variant_chars": ["·", "▪"],  // For visual variety
        "animation": null  // or "shimmer", "flicker", etc.
      },
      "walkable": true,
      "blocks_sight": false,
      "blocks_sound": false,
      "inspection": {
        "short": "Rough wooden planks worn smooth by countless footsteps.",
        "full": "The floor is made of oak planks, weathered and stained with age. 
                 You can see scratches and scuff marks from furniture being moved. 
                 Some boards creak slightly underfoot.",
        "features": [
          {
            "id": "floor_scratches",
            "name": "Scratches",
            "keywords": ["scratches", "marks", "scuffs"],
            "description": "Deep gouges suggest heavy furniture was dragged recently.",
            "requires_sense": "sight",
            "min_clarity": "clear"
          },
          {
            "id": "loose_board",
            "name": "Loose Board",
            "keywords": ["board", "plank", "loose", "creak"],
            "description": "One board creaks ominously when stepped on. It might be hiding something beneath.",
            "requires_sense": "pressure",
            "min_clarity": "vague",
            "hidden": true,  // Requires specific mention or high perception
            "discovery_dc": 12  // Difficulty class to notice
          }
        ],
        "sensory": {
          "sight": ["Wooden planks", "Nail heads", "Dust in corners"],
          "sound": ["Creaking underfoot", "Hollow thud when knocked"],
          "touch": ["Smooth grain", "Slight splinters at edges"],
          "smell": ["Wood polish", "Dust"]
        }
      },
      "interactions": [
        {
          "verb": "SEARCH",
          "description": "Search the floor for hidden compartments",
          "yields": ["floor_loose_board_secret"],  // Reference to hidden feature
          "time_seconds": 30
        }
      ],
      "tags": ["wooden", "indoor", "flammable"]
    }
  ]
}
```

#### 1.2 Extend Existing Item Schema with Inspection Data

**Note**: Items already exist in the system. We extend the schema, not rebuild.

**Items exist in:**
1. **Character/NPC inventory** - `inventory: []` array in actor/npc JSON
2. **Character equipment** - `equipment.body_slots` and `equipment.hand_slots`
3. **Place files** - `contents.items_on_ground` as `PlaceItem[]`
4. **Within other items** - Container items hold other items

**Extend item entries with inspection field:**

```jsonc
// Example item in inventory or on ground
{
  "id": "item_iron_sword_001",
  "name": "Iron Longsword",
  "category": "weapon",
  "tags": ["metal", "iron", "sharp", "two-handed"],
  "size_mag": 2,
  "weight": 3.5,
  "value": 1500,
  "display": {
    "char": "/",
    "color": "#C0C0C0"
  },
  // NEW: Inspection data
  "inspection": {
    "short": "A well-balanced iron longsword with a leather-wrapped hilt.",
    "full": "This longsword measures about three feet from pommel to tip...",
    "features": [
      {
        "id": "blade_condition",
        "name": "Blade Condition",
        "keywords": ["blade", "edge", "sharp", "condition", "nicks"],
        "description": "The blade has several small nicks along the edge...",
        "requires_sense": "light",
        "min_clarity": "vague"
      },
      {
        "id": "maker_mark",
        "name": "Maker's Mark",
        "keywords": ["mark", "signature", "maker", "smith"],
        "description": "A small symbol stamped near the crossguard...",
        "requires_sense": "light",
        "min_clarity": "clear",
        "hidden": true,
        "discovery_cr": 15  // Uses existing roll system
      }
    ],
    "sensory": {
      "sight": ["Metallic gleam", "Leather grip"],
      "pressure": ["Ringing when tapped"],
      "touch": ["Cold metal", "Sharp edge"]
    }
  },
  "condition": 85,  // Percentage
  "container_contents": []  // If this is a container
}
```

**Item locations:**
- **Ground**: `place.contents.items_on_ground`
- **Inventory**: `actor.inventory[]` or `npc.inventory[]`
- **Equipped**: `actor.equipment.body_slots` or `actor.equipment.hand_slots`
- **Container**: Inside another item's `container_contents`

**Visible inventory rule**: Only items not in container items that player has in hand or on person are visible on inspection.
            "description": "The sword feels well-balanced in your hand, suggesting quality craftsmanship.",
            "requires_sense": "touch",
            "min_clarity": "vague"
          }
        ],
        "sensory": {
          "sight": ["Metallic gleam", "Leather grip", "Crossguard design"],
          "sound": ["Ringing when tapped", "Metallic scrape when drawn"],
          "touch": ["Cold metal", "Textured leather", "Sharp edge"],
          "smell": ["Oiled steel", "Leather"]
        },
        "condition": {
          "current": 85,  // Percentage
          "max": 100,
          "effects": [
            { "condition_below": 50, "description": "The blade shows significant wear." },
            { "condition_below": 25, "description": "The sword is in poor condition and may break." }
          ]
        }
      },
      "stats": {
        "damage_dice": "1d8",
        "damage_type": "slashing",
        "critical_range": [19, 20],
        "critical_multiplier": 2
      },
      "body_slot_requirement": "main_hand",  // or "off_hand", "two_hands", etc.
      "interactions": [
        {
          "verb": "USE",
          "description": "Swing the sword",
          "requirements": ["wielded"]
        },
        {
          "verb": "INSPECT",
          "description": "Examine the sword closely",
          "time_seconds": 5
        }
      ],
      "container_properties": null,  // or { "capacity": 10, "accepted_tags": ["small"] }
      "pickup_requirements": {
        "min_strength": 8,
        "hands_required": 1
      }
    }
  ]
}
```

#### 1.3 Create Item Instance Schema (for placed items)

**File**: Example placed item instance

```jsonc
{
  "schema_version": 1,
  "id": "item_sword_001",  // Unique instance ID
  "template_id": "iron_longsword",  // Reference to databank
  "instance_data": {
    "condition": 85,  // Override template condition
    "custom_name": "Father's Blade",  // Optional custom name
    "description_addendum": "This sword has been in your family for generations.",
    "container_contents": [  // If this item is a container
      {
        "item_ref": "item_healing_potion_001",
        "quantity": 2
      }
    ],
    "location": {
      "type": "place_tile",  // place_tile, inventory, container
      "place_id": "tavern_common",
      "tile": { "x": 5, "y": 10 }
    },
    "hidden": false,  // or true (requires search to find)
    "locked": false,  // For containers
    "owner": "npc.blacksmith"  // Who owns this item
  }
}
```

### Phase 2: Storage Layer

#### 2.1 Create Tile Storage Module

**File**: `src/tile_storage/store.ts`

```typescript
export type TileDefinition = {
  id: string;
  name: string;
  category: "floor" | "wall" | "obstacle" | "terrain" | "water";
  display: {
    char: string;
    color: string;
    variant_chars?: string[];
    animation?: string | null;
  };
  walkable: boolean;
  blocks_sight: boolean;
  blocks_sound: boolean;
  inspection: {
    short: string;
    full: string;
    features: TileFeature[];
    sensory: Record<string, string[]>;
  };
  interactions: TileInteraction[];
  tags: string[];
};

export type TileFeature = {
  id: string;
  name: string;
  keywords: string[];
  description: string;
  requires_sense: "light" | "pressure" | "aroma" | "thaumic";
  min_clarity: "clear" | "vague" | "obscured";
  hidden?: boolean;
  discovery_cr?: number;  // Challenge Rating to discover (D20 + effectors)
};

export function load_tile_definition(tile_id: string): TileDefinition | null;
export function get_tile_variant(tile_id: string, x: number, y: number): string;  // Deterministic variant based on position
```

#### 2.2 Use Existing Item System (No Rebuild)

**Items already exist in these locations:**

1. **Actor/NPC files** (`actor_storage`, `npc_storage`):
   ```typescript
   // From default_actor.jsonc / default_npc.jsonc
   {
     "inventory": [],  // Array of items
     "equipment": {
       "body_slots": {},  // Equipped items by slot
       "hand_slots": {}
     }
   }
   ```

2. **Place files** (`place_storage`):
   ```typescript
   // From Place type in types/place.ts
   {
     "contents": {
       "items_on_ground": [
         {
           "item_ref": "item.iron_sword",
           "tile_position": { "x": 5, "y": 10 },
           "quantity": 1
         }
       ]
     }
   }
   ```

**Extend items with inspection field:**
```typescript
// Add to existing item structure
interface Item {
  id: string;
  name: string;
  // ... existing fields ...
  
  // NEW: Inspection data
  inspection?: {
    short: string;
    full: string;
    features: InspectionFeature[];
    sensory: Record<string, string[]>;
  };
  
  // For containers
  container_contents?: Item[];
  hidden?: boolean;
}

interface InspectionFeature {
  id: string;
  name: string;
  keywords: string[];
  description: string;
  requires_sense: "light" | "pressure" | "aroma" | "thaumic";
  min_clarity: "clear" | "vague" | "obscured";
  hidden?: boolean;
  discovery_cr?: number;  // Uses existing roll system
}
```

**Helper functions for existing system:**
```typescript
// src/inspection/item_helpers.ts

export function get_item_from_inventory(
  owner_ref: string, 
  item_id: string
): Item | null;

export function get_item_from_place(
  place_id: string,
  tile_x: number,
  tile_y: number,
  item_ref: string
): Item | null;

export function get_equipped_item(
  character_ref: string,
  slot: string
): Item | null;

export function get_visible_inventory(
  character_ref: string
): Item[];  // Excludes container contents, includes only worn/held

export function is_item_visible(
  item: Item,
  context: "ground" | "worn" | "held" | "container"
): boolean;
```

#### 2.3 Create Inspection Data Service

**File**: `src/inspection/data_service.ts`

```typescript
export type InspectionTarget =
  | { type: "character"; ref: string; body_slot?: string }
  | { type: "tile"; place_id: string; tile: { x: number; y: number } }
  | { type: "item"; instance_id: string };

export type InspectionResult = {
  target: InspectionTarget;
  success: boolean;
  clarity: "clear" | "vague" | "obscured";
  distance: number;
  requested_features: string[];  // Features specifically asked for
  random_features: string[];     // Random additional features
  content: {
    short_description: string;
    full_description: string;
    features: InspectedFeature[];
    sensory_details: Record<string, string[]>;
  };
};

export type InspectedFeature = {
  id: string;
  name: string;
  description: string;
  discovered: boolean;
  hidden: boolean;
  quality: "clear" | "vague" | "obscured";
};

export function inspect_target(
  inspector_ref: string,
  target: InspectionTarget,
  options: {
    requested_keywords?: string[];  // From text parsing
    max_features?: number;          // How many features to return
    force_random_selection?: boolean;  // If no keywords, pick random
  }
): InspectionResult;

export function calculate_inspection_clarity(
  inspector_location: Location,
  target_location: Location,
  sense_type: "light" | "pressure" | "aroma" | "thaumic",
  inspector_sense_mag: number,
  target_size_mag: number,
  wall_penalties?: number  // For thaumic sense wall reduction
): "clear" | "vague" | "obscured" | "none";

// CR (Challenge Rating) roll for hidden features
export function roll_inspection_cr(
  inspector_ref: string,
  relevant_prof: string,      // e.g., "instinct", "accuracy", "quiet"
  relevant_stat: string,      // e.g., "wis", "dex", "con"
  cr: number,                 // Challenge rating to beat
  effectors?: number[]        // Additional modifiers
): {
  roll: number;              // D20 result
  total: number;             // Roll + prof + stat + effectors
  success: boolean;          // total >= cr
  margin: number;            // How much exceeded/failed by
};

// Check if a hidden feature is discovered
export function check_hidden_feature_discovery(
  inspector_ref: string,
  feature: { hidden: boolean; discovery_cr?: number },
  clarity: "clear" | "vague" | "obscured"
): boolean;

export function parse_inspection_text(text: string): {
  target_hint?: string;
  feature_keywords: string[];
};
```

#### 2.4 MAG-Based Clarity Calculation System

**File**: `src/inspection/clarity_system.ts`

```typescript
// Distance MAG Table (tiles)
const DISTANCE_MAG_TABLE: Record<number, number> = {
  [-2]: 0,    // Pinpoint
  [-1]: 1,    // Few inches
  0: 1,       // Within 1 tile
  1: 1,       // Adjacent tile
  2: 3,       // 3 tiles away
  3: 5,       // 5 tiles away
  4: 10,      // 10 tiles away
  5: 30,      // 30 tiles away
  6: 100,     // 100 tiles away
  7: 300,     // Within 1 region tile
};

// Calculate max clear range for a sense
export function get_clear_range_magnitude(
  sense_type: "light" | "pressure" | "aroma" | "thaumic",
  sense_mag: number
): number {
  switch (sense_type) {
    case "light":
      return sense_mag + 2;  // DISTANCE MAG = LIGHT MAG + 2
    case "pressure":
    case "aroma":
      return sense_mag + 1;  // DISTANCE MAG = PRESSURE/AROMA MAG + 1
    case "thaumic":
      return sense_mag;      // DISTANCE MAG = THAUMIC MAG
  }
}

// Calculate clarity based on distance and sense
export function calculate_clarity(
  distance_tiles: number,
  sense_type: "light" | "pressure" | "aroma" | "thaumic",
  sense_mag: number,
  target_size_mag: number,
  wall_penalties: number = 0
): "clear" | "vague" | "obscured" | "none" {
  
  // Get the max clear distance MAG
  let max_clear_mag = get_clear_range_magnitude(sense_type, sense_mag);
  
  // Apply wall penalties (for thaumic)
  if (sense_type === "thaumic") {
    max_clear_mag -= wall_penalties;
  }
  
  // Size modifier: larger targets easier to see
  // Each size MAG above 0 extends clear range by 1 MAG
  max_clear_mag += Math.max(0, target_size_mag);
  
  // Convert to tiles
  const clear_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag] || 1;
  const vague_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag + 1] || 5;
  const obscured_range_tiles = DISTANCE_MAG_TABLE[max_clear_mag + 2] || 10;
  
  // Determine clarity
  if (distance_tiles <= clear_range_tiles) {
    return "clear";
  } else if (distance_tiles <= vague_range_tiles) {
    return "vague";
  } else if (distance_tiles <= obscured_range_tiles) {
    return "obscured";
  } else {
    return "none";
  }
}

// Example calculations:
// Human (MAG 3 sight) looking at normal chest (MAG 2 size) 8 tiles away:
// - Clear range MAG = 3 + 2 = 5 (30 tiles) + size bonus 0 = 5
// - Clear range tiles = 30, Vague = 100, Obscured = 300
// - At 8 tiles: CLEAR (8 < 30)

// Human (MAG 3 hearing) listening at door 2 tiles away:
// - Clear range MAG = 3 + 1 = 4 (10 tiles)
// - At 2 tiles: CLEAR

// Human (MAG 0 thaumic) sensing through 1 thin wall (-1 penalty):
// - Clear range MAG = 0 - 1 = -1 (1 tile)
// - At 3 tiles: NONE (beyond 1 tile)
```

#### 2.5 Use Existing CR Roll System (No Rebuild)

**CR/Roll system already exists in:** `src/rules_lawyer/effects.ts`

```typescript
// Existing functions (from rules_lawyer/effects.ts):

function roll_passes_check(command: CommandNode): boolean {
    const roll_node = command.args.roll;
    if (!roll_node || roll_node.type !== "object") return true;
    const result = get_number(roll_node.value.result as ValueNode | undefined);
    const target_cr = get_number(roll_node.value.target_cr as ValueNode | undefined);
    if (result === null) return true;
    if (target_cr === null) return true;
    return result >= target_cr;  // Roll >= CR = success
}

function compute_roll(roll_node: ValueNode | undefined): ValueNode | undefined {
    // Computes roll with effectors
    // Structure: { type: "RESULT", dice: "D20", effectors: [], target_cr: 10 }
}
```

**For INSPECT actions, use existing roll structure:**
```typescript
// Machine text format for inspection roll:
// actor.player.INSPECT(
//   target=tile.x.y,
//   roll={type=RESULT, dice="D20", effectors=[...], target_cr=10},
//   tool=actor.player.senses
// )

// The roll object includes:
// - dice: "D20" (always D20 for result rolls)
// - effectors: Array of bonus values (proficiency, stat, situational)
// - target_cr: Challenge rating to beat
// - result: Computed total after roll

// Default CR values:
const CR_TABLE = {
  IRRELEVANTLY_EASY: 0,
  INTUITIVE: 5,
  TAKES_CONCENTRATION: 10,  // Default for hidden features
  NOT_EASY: 15,
  VERY_HARD: 20,
  ONLY_SKILLED: 25,
  MAGIC_AND_HELP: 30
};

// Example hidden feature:
// {
//   "hidden": true,
//   "discovery_cr": 10,  // CR to discover
//   "relevant_prof": "instinct",  // Which prof applies
//   "relevant_stat": "wis"        // Which stat applies
// }
```

**Integration with rules_lawyer:**
- INSPECT command flows through existing pipeline
- Roll requests handled by existing roller system
- No blunder/peak ratings (simplified as requested)

### Phase 3: Place Module Integration

#### 3.1 Add Click-to-Inspect

**Modify**: `src/mono_ui/modules/place_module.ts`

Add new callback to config:
```typescript
export type PlaceModuleConfig = {
  // ... existing config ...
  
  // Inspection callback
  on_inspect?: (target: {
    type: "entity" | "tile" | "item";
    ref?: string;  // For entities/items
    place_id?: string;  // For tiles
    tile_position?: TilePosition;  // For tiles/items on ground
  }) => void;
  
  // Modifier keys for different inspect modes
  inspect_key_modifiers?: {
    entity: "none" | "ctrl" | "shift" | "alt";  // Default: none (left click)
    tile: "none" | "ctrl" | "shift" | "alt";     // Default: shift
    item: "none" | "ctrl" | "shift" | "alt";     // Default: alt
  };
};
```

Add to OnContextMenu handler (Right-click cycles through targets on same tile):
```typescript
// Get all inspectable targets at this tile
const inspectable_targets = get_inspectable_targets_at_tile(tile.x, tile.y, place);

// Check if we're continuing a cycle on this tile
const tile_key = `${tile.x},${tile.y}`;
let cycle_index = inspect_cycle_state.get(tile_key) || 0;

// Shift+Right-click forces tile inspection (skip entities)
if (e.shift) {
  const tile_target = {
    type: "tile" as const,
    place_id: place.id,
    tile_position: { x: tile.x, y: tile.y }
  };
  config.on_inspect?.(tile_target);
  return;
}

// Normal right-click: cycle through entities -> items -> tile
if (inspectable_targets.length > 0) {
  const target = inspectable_targets[cycle_index % inspectable_targets.length];
  
  config.on_inspect?.(target);
  
  // Advance cycle for next click
  inspect_cycle_state.set(tile_key, (cycle_index + 1) % inspectable_targets.length);
}

// Helper function to get inspectable targets
function get_inspectable_targets_at_tile(x: number, y: number, place: Place): InspectionTarget[] {
  const targets: InspectionTarget[] = [];
  
  // 1. Characters (NPCs/Actors) - priority first
  const entities = get_all_entities_at(x, y, place);
  for (const entity of entities) {
    const is_npc = "npc_ref" in entity;
    targets.push({
      type: is_npc ? "npc" : "actor",
      ref: is_npc ? (entity as PlaceNPC).npc_ref : (entity as PlaceActor).actor_ref,
      tile_position: { x, y }
    });
  }
  
  // 2. Items on ground (visible only - excludes containers on characters)
  const items = get_items_at_tile(x, y, place).filter(item => 
    item.location.type === "place_tile" && !item.hidden
  );
  for (const item of items) {
    targets.push({
      type: "item",
      ref: item.id,
      tile_position: { x, y }
    });
  }
  
  // 3. Tile itself (terrain, features)
  targets.push({
    type: "tile",
    place_id: place.id,
    tile_position: { x, y }
  });
  
  return targets;
}
```

#### 3.2 Add Visual Feedback for Inspectable Objects

Add to draw_place function:
```typescript
// When hovering over inspectable object
if (hovered && config.on_inspect) {
  // Show inspect cursor hint
  const inspect_hint = get_inspect_hint(hovered, place);
  if (inspect_hint) {
    draw_inspect_hint(canvas, inspect_hint, inner);
  }
}
```

### Phase 4: Text Input Integration

#### 4.1 Update Text Parser

**Modify**: `src/interface_program/main.ts` (input -> intent) or create `src/inspection/text_parser.ts`

```typescript
// Parse inspection commands from text
export function parse_inspect_command(text: string): {
  is_inspect: boolean;
  target_name?: string;
  feature_keywords: string[];
} {
  const lowered = text.toLowerCase();
  
  // Check for inspect verbs
  const inspect_verbs = ["inspect", "examine", "look at", "check", "survey", "study", "observe"];
  const is_inspect = inspect_verbs.some(verb => lowered.includes(verb));
  
  if (!is_inspect) return { is_inspect: false, feature_keywords: [] };
  
  // Extract target (after inspect verb)
  // Example: "inspect the guard" -> target: "guard"
  // Example: "look at the sword" -> target: "sword"
  
  // Extract feature keywords
  const feature_keywords = extract_feature_keywords(lowered);
  
  return {
    is_inspect,
    target_name: extract_target_name(lowered),
    feature_keywords
  };
}

function extract_feature_keywords(text: string): string[] {
  const keyword_map: Record<string, string[]> = {
    "equipment": [
      "clothes", "armor", "equipment", "weapon", "wearing", "holding", "gear",
      "outfit", "attire", "garments", "vestments",
      "sheathed", "drawn", "stowed", "brandished"
    ],
    "physical": [
      "appearance", "face", "body", "build", "hair", "eyes", "features",
      "stature", "figure", "physique", "complexion",
      "scars", "marks", "tattoos", "blemishes"
    ],
    "status": [
      "health", "wounds", "injured", "status", "condition", "hurt",
      "bleeding", "fatigued", "exhausted", "winded",
      "poisoned", "cursed", "afflicted", "ailing"
    ],
    "inventory": [
      "carrying", "inventory", "items", "pockets", "bag", "pack",
      "satchel", "pouch", "belt", "backpack",
      "equipped", "worn", "held"
      // NOTE: Only visible inventory - excludes containers on person
    ],
    "identity": [
      "name", "who", "what", "race", "kind", "profession", "job",
      "occupation", "title", "background", "lineage",
      "affiliation", "faction", "allegiance"
    ],
    "behavior": [
      "doing", "action", "activity", "intent", "plan",
      "mannerisms", "posture", "stance", "gait",
      "demeanor", "attitude", "mood", "temperament"
    ]
  };
  
  const found: string[] = [];
  for (const [category, keywords] of Object.entries(keyword_map)) {
    if (keywords.some(kw => text.includes(kw))) {
      found.push(category);
    }
  }
  return found;
}
```

#### 4.2 Update app_state.ts Send Handler

**Modify**: `src/canvas_app/app_state.ts`

In the `send_to_interpreter` function, before sending to interpreter:

```typescript
import { parse_inspect_command } from "../inspection/text_parser.js";
import { inspect_target } from "../inspection/data_service.js";

// In send_to_interpreter:
const inspect_parse = parse_inspect_command(outgoing);

if (inspect_parse.is_inspect) {
  // Resolve target from text or selected target
  const target_ref = resolve_inspect_target(
    inspect_parse.target_name,
    ui_state.controls.selected_target,
    ui_state.controls.targets
  );
  
  if (target_ref) {
    // Perform inspection locally
    const inspection_result = await perform_inspection(
      `actor.${APP_CONFIG.input_actor_id}`,
      target_ref,
      {
        requested_keywords: inspect_parse.feature_keywords,
        max_features: 3  // Limit to prevent spam
      }
    );
    
    // Display result in text window instead of sending to interpreter
    display_inspection_result(inspection_result);
    return;  // Don't send to interpreter
  }
}
```

### Phase 5: Character Inspection Enhancement

#### 5.1 Extend NPC Schema for Inspection

Add to NPC schema:
```jsonc
{
  "inspection": {
    "visibility": {
      "apparent_size_mag": 0,  // May differ from actual
      "apparent_sex": "",
      "apparent_age": 0
    },
    "features": [
      {
        "id": "scar_cheek",
        "category": "physical",
        "name": "Scar on left cheek",
        "keywords": ["scar", "cheek", "face", "mark"],
        "description": "A jagged scar runs down the left cheek, suggesting a past battle.",
        "always_visible": false,
        "discovery_dc": 12,  // Perception check to notice
        "clarity_required": "clear"
      }
    ],
    "equipment_visible": {
      "body_slots": {
        "main_hand": { "visible": true, "apparent_quality": "fine" },
        "armor": { "visible": true, "apparent_condition": 80 }
      }
    },
    "current_activity": {
      "description": "Whittling a piece of wood",
      "keywords": ["whittling", "carving", "wood"]
    }
  }
}
```

#### 5.2 Create Character Inspection Logic

**File**: `src/inspection/character_inspector.ts`

```typescript
export function inspect_character(
  inspector_ref: string,
  target_ref: string,
  options: {
    body_slot?: string;  // Specific slot to inspect
    feature_keywords?: string[];
    clarity: "clear" | "vague" | "obscured";
  }
): InspectionResult {
  // Load target data
  const target_data = load_character_data(target_ref);
  
  // Determine visible features based on clarity
  const visible_features = filter_features_by_clarity(
    target_data.inspection.features,
    options.clarity
  );
  
  // If specific keywords requested, prioritize matching features
  let selected_features: Feature[];
  if (options.feature_keywords && options.feature_keywords.length > 0) {
    selected_features = prioritize_features_by_keywords(
      visible_features,
      options.feature_keywords
    );
  } else {
    // Random selection + largest/most obvious features
    selected_features = select_random_and_obvious_features(visible_features, 3);
  }
  
  // If body slot specified, add equipment details
  if (options.body_slot) {
    const equipment = get_equipment_in_slot(target_ref, options.body_slot);
    if (equipment) {
      selected_features.push({
        id: `equipment_${options.body_slot}`,
        category: "equipment",
        name: `${options.body_slot}: ${equipment.name}`,
        description: get_equipment_description(equipment, options.clarity)
      });
    }
  }
  
  return build_inspection_result(target_ref, selected_features, options.clarity);
}
```

### Phase 6: Renderer Integration

#### 6.1 Format Inspection for AI Narrator

**File**: `src/inspection/renderer_formatter.ts`

```typescript
export function format_inspection_for_renderer(
  result: InspectionResult
): string {
  let output = `INSPECTION RESULT:\n`;
  output += `Target: ${get_target_name(result.target)}\n`;
  output += `Clarity: ${result.clarity} (${result.distance} tiles away)\n\n`;
  
  output += `${result.content.short_description}\n\n`;
  
  if (result.clarity === "clear") {
    output += `${result.content.full_description}\n\n`;
  }
  
  if (result.content.features.length > 0) {
    output += `NOTABLE FEATURES:\n`;
    for (const feature of result.content.features) {
      const quality_prefix = feature.quality === "vague" 
        ? "You vaguely make out: " 
        : "";
      output += `- ${quality_prefix}${feature.description}\n`;
    }
  }
  
  if (result.clarity === "clear" && Object.keys(result.content.sensory_details).length > 0) {
    output += `\nSENSORY DETAILS:\n`;
    for (const [sense, details] of Object.entries(result.content.sensory_details)) {
      if (details.length > 0) {
        output += `${sense}: ${details.join(", ")}\n`;
      }
    }
  }
  
  return output;
}
```

### Phase 7: Integration with Existing Systems

#### 7.1 Wire into Action Pipeline

**Modify**: `src/integration/action_system_adapter.ts`

Add to executeEffect:
```typescript
case "INSPECT":
  return await executeInspect(effect);
```

```typescript
async function executeInspect(effect: ActionEffect): Promise<boolean> {
  const { inspector, target, requested_keywords } = effect.parameters;
  
  const result = inspect_target(inspector, target, {
    requested_keywords: requested_keywords || [],
    max_features: 3
  });
  
  // Store result for renderer
  await store_inspection_result(result);
  
  // If clear inspection, trigger perception event for observers
  if (result.clarity === "clear") {
    broadcast_perception({
      type: "INSPECT",
      actor: inspector,
      target: target,
      visible_to_others: true
    });
  }
  
  return true;
}
```

---

## Implementation Order

1. **Week 1**: Data Infrastructure
   - Create tile and item JSON schemas
   - Implement storage modules (tile_storage, item_storage)
   - Create sample data files

2. **Week 2**: Core Inspection Logic
   - Implement inspection data service
   - Create clarity calculation system
   - Build character inspection logic

3. **Week 3**: UI Integration
   - Add click-to-inspect to place module
   - Implement text parser
   - Wire into app_state.ts

4. **Week 4**: Polish & Integration
   - Renderer formatter
   - Visual feedback in place module
   - Testing and refinement

---

## Design Decisions Summary (ANSWERED)

✅ **Sense System**: Using THAUMWORLD tabletop MAG rules
- LIGHT (sight): DISTANCE MAG = LIGHT MAG + 2
- PRESSURE (hearing): DISTANCE MAG = PRESSURE MAG + 1  
- AROMA (smell): DISTANCE MAG = AROMA MAG + 1
- THAUMIC (magic): DISTANCE MAG = THAUMIC MAG (walls reduce MAG)

✅ **Storage**: 
- Item templates: Shared database (`local_data/shared/items/`)
- Tile instances: Per-place in place files

✅ **Keywords**: 6 categories expanded to ~10 keywords each
- Equipment, Physical, Status, Inventory (visible only), Identity, Behavior

✅ **Hidden Items**: Require passed INSPECT with CR check (D20 + prof + stat)
- Default CR 10 ("takes concentration")
- No blunder/peak ratings (simplified)

✅ **Click Controls**: Right-click cycles targets on same tile
- Order: Characters → Items → Tile
- Shift+Right-click forces tile inspection
- Excludes: Items in containers, items in character inventories

---

## Success Criteria

- [ ] Player can click any entity to inspect it
- [ ] Player can type "inspect [target]" with specific keywords
- [~] Inspection detail varies by distance and sense type (MAG-based) (core handler exists; UI + content depth pending)
- [ ] Random features shown when no specifics requested
- [ ] Equipment inspection works for body slots
- [ ] Tile inspection reveals environmental details
- [ ] Item inspection shows condition and features
- [ ] Hidden features require CR roll to discover
- [ ] AI narrator receives formatted inspection data
- [ ] Visual feedback shows what's inspectable

---

## Next Steps

1. **Review this plan** - Check if it aligns with game vision
2. **Approve/refine** - Make any adjustments needed
3. **Begin implementation** - Start with Phase 1 (Data Infrastructure)

**Plan is ready for review!**

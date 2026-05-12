# Clean Item System Data Templates

This document provides templates for the cleaned item system with inline storage.

## Clean Item Definition Template

**Location:** `local_data/data_slot_default/items/<item_name>.jsonc`

```json
{
  "id": "item_id_here",
  "name": "Item Name",
  "description": "Description of the item.",
  "weight": 100,
  "weight_mag": 1,
  "mag": 1,
  "size_mag": 1,
  "hardness_mag": 1,
  "conductivity_mag": 1,
  "max_stack_size": 1,
  "display_char": "?",
  "tags": []
}
```

### Tag Examples:

**TOOL (weapon/tool):**
```json
"tags": [
  {
    "name": "TOOL",
    "mag": 1,
    "meta": ["weapon"],
    "info": [2]
  }
]
```

**ARMOR:**
```json
"tags": [
  {
    "name": "ARMOR",
    "mag": 1,
    "meta": ["head"],
    "info": [3]
  }
]
```

**GARB (clothing):**
```json
"tags": [
  {
    "name": "GARB",
    "mag": 1,
    "meta": ["torso"],
    "info": [1]
  }
]
```

**CONTAINER (sack/bag):**
```json
"tags": [
  {
    "name": "CONTAINER",
    "mag": 1
  },
  {
    "name": "GARB",
    "mag": 1,
    "meta": ["leg_left", "leg_right"],
    "info": [1]
  }
]
```

## Clean Actor Template

**Location:** `local_data/data_slot_<N>/actors/<actor_id>.jsonc`

```json
{
  "schema_version": 2,
  "id": "actor_id_here",
  "name": "Actor Name",
  "title": "",
  "kind": "KIND_HERE",
  "size_mag": 0,
  "sex": "",
  "age": 0,
  "sexual_orientation": "",
  "sleep_type": "SLEEP",
  "sleep_required_per_day": 4,
  "languages": [
    {
      "name": "apish",
      "understood_senses": [
        { "sense": "pressure", "mag": 3 },
        { "sense": "light", "mag": 2 }
      ]
    }
  ],
  "lore": {
    "backstory": "",
    "family": "",
    "relationship": ""
  },
  "appearance": {
    "size_mag": 0,
    "build": "",
    "hair_fur_shell_skin_color": "",
    "eye_color": "",
    "distinguishing_features": "",
    "clothing_style": "",
    "accessories": ""
  },
  "personality": {
    "story_goal": "",
    "fear": "",
    "flaw": "",
    "hobby": "",
    "passion": "",
    "happy_triggers": "",
    "favorite_food_drink": "",
    "sad_triggers": "",
    "angry_triggers": "",
    "temptations": ""
  },
  "senses": {
    "light": 0,
    "aroma": 0,
    "pressure": 0,
    "thaumic": 0
  },
  "temperature_range": {
    "low": 0,
    "high": 0
  },
  "stats": {
    "con": 50,
    "str": 50,
    "dex": 50,
    "wis": 50,
    "int": 50,
    "cha": 50
  },
  "profs": {
    "pain": 0,
    "brawn": 0,
    "accuracy": 0,
    "speed": 0,
    "quiet": 0,
    "hearth": 0,
    "beasts": 0,
    "instinct": 0,
    "resonation": 0,
    "arcana": 0,
    "golemancy": 0,
    "history": 0,
    "organica": 0,
    "mechanics": 0,
    "dietic": 0,
    "stability": 0,
    "deception": 0,
    "power": 0,
    "performance": 0,
    "communication": 0
  },
  "movement": {
    "walk": 0,
    "climb": 0,
    "swim": 0,
    "fly": 0
  },
  "location": {
    "world_tile": { "x": 0, "y": 0 },
    "region_tile": { "x": 0, "y": 0 },
    "tile": { "x": 0, "y": 0 }
  },
  "resources": {
    "health": { "current": 1, "max": 1 },
    "vigor": { "current": 1, "max": 1, "mag": 1 },
    "actions": { "current": 1, "max": 1 },
    "partial_actions": { "current": 1, "max": 1 },
    "thaum": { "current": 1, "max": 1 },
    "thaum_capacity": { "current": 0, "max": 0 },
    "thaum_regen": { "current": 1, "max": 1 },
    "calls": { "current": 0, "max": 0 },
    "spell_slots": { "current": 0, "max": 0 }
  },
  "derived": {
    "evasion": 0,
    "naked_evasion": 0,
    "fortitude": 0,
    "carry_capacity": 0,
    "weight_penalty": 0
  },
  "derived_overrides": {},
  "derived_effectors": {},
  "body_slots": {
    "head": {
      "name": "head",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    },
    "torso": {
      "name": "torso",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    },
    "hand_left": {
      "name": "hand_left",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    },
    "hand_right": {
      "name": "hand_right",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    },
    "leg_left": {
      "name": "leg_left",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    },
    "leg_right": {
      "name": "leg_right",
      "critical": true,
      "armor": null,
      "garb": [],
      "tool": null
    }
  },
  "equipped_items": {},
  "inventory": [],
  "equipment_weight": 0,
  "inventory_weight": 0,
  "tags": [],
  "character_mag": 1,
  "perks": [],
  "perk_points": { "current": 7, "total": 7 },
  "memory": []
}
```

### Key Differences from Old Format:

1. **schema_version**: Changed from 1 to 2
2. **body_slots**: Now has `armor`, `garb` (array), and `tool` fields
3. **equipped_items**: New section for inline item storage (references only in body_slots)
4. **inventory**: For unequipped items
5. **equipment**: Removed deprecated object

## Equipped Item Example

```json
"equipped_items": {
  "inst_sword_001": {
    "instance": {
      "id": "inst_sword_001",
      "def_id": "test_iron_sword",
      "qty": 1,
      "condition": "good",
      "tags": []
    },
    "definition": {
      "id": "test_iron_sword",
      "name": "Iron Sword",
      "weight": 600,
      "max_stack_size": 1,
      "display_char": "/",
      "tags": [
        {
          "name": "TOOL",
          "mag": 1,
          "meta": ["weapon"],
          "info": [2]
        }
      ]
    }
  }
}
```

## Container Item Example (Sack with Contents)

```json
"equipped_items": {
  "inst_sack_001": {
    "instance": {
      "id": "inst_sack_001",
      "def_id": "small_sack",
      "qty": 1,
      "condition": "good",
      "tags": [],
      "container_data": {
        "capacity": {
          "max_slots": 10,
          "max_weight": 5000
        },
        "contents": [
          {
            "instance": {
              "id": "inst_apple_001",
              "def_id": "apple",
              "qty": 3
            },
            "definition": {
              "id": "apple",
              "name": "Apple",
              "weight": 100,
              "max_stack_size": 10,
              "display_char": "a"
            },
            "grid_x": 0,
            "grid_y": 0
          }
        ],
        "is_open": false,
        "is_locked": false
      }
    },
    "definition": {
      "id": "small_sack",
      "name": "Small Sack",
      "weight": 200,
      "max_stack_size": 1,
      "display_char": "s",
      "tags": [
        {
          "name": "CONTAINER",
          "mag": 1
        },
        {
          "name": "GARB",
          "mag": 1,
          "meta": ["leg_left", "leg_right"],
          "info": [1]
        }
      ]
    }
  }
}
```

## Deprecated Fields Removed

### From Item Definitions:
- ❌ `valid_body_slots` - Use ARMOR/GARB/TOOL tags instead
- ❌ `occupies_slots` - Slots determined by tag meta
- ❌ `slot_shape` - Always single slot now
- ❌ `fits_actor_kind` - No race restrictions
- ❌ `stackable` - Use `max_stack_size > 1` instead
- ❌ `notes` - Keep only in default_item.jsonc template

### From Actor Files:
- ❌ `equipment.body_slots` - Use top-level body_slots
- ❌ `equipment.hand_slots` - Merged into body_slots
- ❌ Old body_slots format with `item_instance_id` - Use armor/garb/tool structure

### From ItemInstance (inline storage):
- ❌ `container_id` - Location implicit in equipped_items
- ❌ `owner_ref` - Ownership implicit in actor file structure

## File Organization

```
local_data/
├── data_slot_default/
│   ├── items/              # Item definitions (templates)
│   │   ├── default_item.jsonc
│   │   ├── test_iron_sword.jsonc
│   │   └── ...
│   └── actors/
│       └── default_actor.jsonc  # Template actor
└── data_slot_1/
    ├── actors/
    │   └── henry_actor.jsonc    # Actor with equipped items
    ├── places/
    │   └── ...
    └── ...
```

## Next Steps

1. Clean all item definition files (remove deprecated fields)
2. Create clean actor files with new body_slots format
3. Add equipped items inline in actor files
4. Test in-game to verify everything works
5. Remove deprecated code from TypeScript as you encounter it

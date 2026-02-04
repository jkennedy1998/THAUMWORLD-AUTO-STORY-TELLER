# Place System: Visual Overview

**Quick Reference Guide** for understanding the Place system architecture

---

## Concept: From Regions to Places

### BEFORE (Current System)
```
World Tile (0, 0)
    └── Region: Eden Crossroads
        ├── NPCs: Gunther, Grenda (all mixed together)
        └── Everything happens everywhere

Problem: Gunther at the waystone hears whisper in Grenda's shop
```

### AFTER (Place System)
```
World Tile (0, 0)
    └── Region: Eden Crossroads
        ├── Place: Town Square [DEFAULT]
        │   ├── Gunther (at waystone)
        │   └── Tiles: 30x30 grid
        │
        ├── Place: Tavern - Common Room
        │   ├── Tables, bar, fireplace
        │   └── Connected to: Kitchen, Private Rooms
        │
        ├── Place: Tavern - Kitchen
        │   └── Connected to: Common Room
        │
        ├── Place: Grenda's Shop
        │   └── Grenda (behind counter)
        │
        └── Place: Alley (behind tavern)
            └── Secret meeting spot

Solution: Gunther only hears things in the square!
```

---

## Scale Visualization

### Tile Size
```
One Tile = 2.5 feet x 2.5 feet

Visual representation:
┌───┬───┬───┐
│ ● │   │   │  ● = Player standing here
├───┼───┼───┤
│   │ ◆ │   │  ◆ = NPC (Gunther)
├───┼───┼───┤
│   │   │ ■ │  ■ = Table (obstacle)
└───┴───┴───┘

Small Room:  10x10 tiles = 25ft x 25ft  (bedroom)
Medium Room: 20x20 tiles = 50ft x 50ft  (tavern common)
Large Hall:  40x40 tiles = 100ft x 100ft (church nave)
```

### Distance Examples
```
Talking distance:     2-3 tiles  (5-7 feet)
Shouting distance:    15 tiles   (37 feet)
Eavesdropping:        5 tiles    (12 feet)
Arrow range:          60 tiles   (150 feet)

Gunther at bar (tile 5,5):
  - Can hear player at tile 5,8 (3 tiles away) ✓
  - Can't hear whisper at tile 5,20 (15 tiles away) ✗
```

---

## Place Connections (Graph System)

### Eden Crossroads Places
```
┌─────────────────────────────────────┐
│           TOWN SQUARE               │
│  [Default Place - Where you arrive] │
│                                     │
│  🗿 Waystone (Gunther here)         │
│  🌸 Flower patch                    │
└──────────────┬──────────────────────┘
               │ "A path leads west"
               │ (5 second walk)
               ▼
┌─────────────────────────────────────┐
│     THE SINGING SWORD TAVERN        │
│         [Common Room]               │
│                                     │
│  🪑 Tables                          │
│  🔥 Fireplace                       │
│  🚪 Door to Kitchen ────────────────┼──▶ Kitchen
│  🚪 Door to Rooms ──────────────────┼──▶ Private Rooms
└─────────────────────────────────────┘
```

### Multi-Level Example (Church)
```
ABOVE (Elevation +1):
┌─────────────┐
│ Bell Tower  │
└──────┬──────┘
       │ Ladder down
       ▼
SURFACE (Elevation 0):
┌─────────────┐      ┌──────────────┐
│ Church Nave │──────│ Churchyard   │
└──────┬──────┘      └──────────────┘
       │ Stairs down
       ▼
BELOW (Elevation -1):
┌─────────────┐
│  Basement   │
│ (Storage)   │
└──────┬──────┘
       │ Secret tunnel
       ▼
┌─────────────┐
│ Catacombs   │
│ (creepy!)   │
└─────────────┘
```

---

## Awareness & Detection

### BEFORE (Everyone hears everything)
```
Player: [whispers to Grenda] "I want to steal the gem"
Gunther (at waystone, 100ft away): "I heard that! Guards!"
```

### AFTER (Local awareness)
```
Player (at tile 5,5): [whispers to Grenda at tile 5,6]
┌──────────────────────────────────────────────┐
│ Grenda (2 tiles): "Shh, keep your voice down"│
│ Bar patron (3 tiles): *looks suspicious*      │
│ Bartender (8 tiles): *doesn't notice*        │
└──────────────────────────────────────────────┘

Gunther (in different place, Town Square): *unaware*
```

### Sound Travel
```
Volume Level    | Distance    | Who Hears It?
────────────────|─────────────|─────────────────
Whisper         | 2 tiles     | Adjacent only
Normal Speech   | 8 tiles     | Same room
Shouting        | 20 tiles    | Adjacent places
Banging/Combat  | 40 tiles    | Whole region

Obstacles (walls, doors): Reduce distance by 50%
```

---

## Travel Examples

### Within a Place (Tile Movement)
```
Player: "walk to the bar"
System: Moving from (5,5) to (15,5)...
        "You walk across the common room, 
         weaving between tables, and arrive 
         at the polished wooden bar."
Time: 2 seconds (8 tiles × 0.25s per tile)
```

### Between Places (Same Region)
```
Player: "go to the kitchen"
System: Exiting Common Room → Entering Kitchen
        "You push through the swinging door 
         into the kitchen. Heat from the stove 
         washes over you, and the smell of 
         roasting meat fills the air."
Time: 1 second (place transition)
```

### Between Regions
```
Player: "travel to the Whispering Woods"
System: Leaving Eden Crossroads → Entering region
        "You walk east along the forest path. 
         The trees grow denser, and the sounds 
         of the crossroads fade behind you. 
         After a few minutes, you arrive at 
         the edge of the Whispering Woods."
Time: 5 minutes (regional travel)
```

---

## Biome Example: Forest Wilderness

### World Tile Without Region (Uses Biome)
```
World Tile: (5, 3) - Forest Biome

Generated Places:
┌─────────────────────────────────────┐
│        FOREST CAMPSITE              │
│   [Default Place - Clearing]        │
│                                     │
│   🔥 Fire pit (cold)               │
│   = Fallen logs (seats)           │
│   🎒 Abandoned backpack?           │
└──────────────┬──────────────────────┘
               │ "A trail leads north"
               ▼
┌─────────────────────────────────────┐
│       FOREST STREAM                 │
│                                     │
│   💧 Fresh water                   │
│   🐾 Animal tracks                 │
│   🌿 Medicinal herbs               │
└──────────────┬──────────────────────┘
               │ "The path continues"
               ▼
┌─────────────────────────────────────┐
│        DARK GROVE                   │
│                                     │
│   🌲 Ancient trees                 │
│   👁️  Feeling of being watched     │
│   ⚠️  Danger: Wolves?              │
└─────────────────────────────────────┘
```

---

## Storage Visualization

### File Structure
```
local_data/data_slot_1/
│
├── regions/
│   └── eden_crossroads.jsonc
│       { places: ["tavern_common", "tavern_kitchen", ...] }
│
├── places/
│   ├── eden_crossroads_tavern_common.jsonc
│   ├── eden_crossroads_tavern_kitchen.jsonc
│   ├── eden_crossroads_square.jsonc
│   └── eden_crossroads_grendas_shop.jsonc
│
├── place_tiles/  [Phase 7]
│   └── eden_crossroads_tavern_common_tiles.jsonc
│       { grid: [[wall, wall, floor, ...], ...] }
│
└── npcs/
    └── gunther.jsonc
        { location: { place_id: "eden_crossroads_square", tile: {x: 5, y: 5} } }
```

### Memory Flow
```
1. Player enters "Tavern Common"
   ↓
2. System loads place file
   ↓
3. Working Memory tracks:
   - event_id: "conv_abc123"
   - place_id: "eden_crossroads_tavern_common"
   - participants: [actor.henry_actor, npc.bartender]
   ↓
4. NPC Bartender remembers:
   - "Player was in MY place (tavern)"
   - "We talked at the bar"
   - "They ordered ale"
```

---

## Implementation Roadmap

### Phase 1-2: Foundation ✅ (Week 1)
- Create place storage
- Update references
- Basic positioning

### Phase 3: NPC Awareness ✅ (Week 2)
- NPCs track place_id
- Local reactions only
- Proximity detection

### Phase 4-5: Travel ✅ (Week 3)
- Move within places
- Between places
- Regional travel

### Phase 6: Enhanced Awareness ✅ (Week 4)
- Line of sight
- Sound propagation
- Stealth mechanics

### Phase 7: Tiles ✅ (Week 5)
- Tile maps
- Pathfinding
- Obstacles

### Phase 8: Polish ✅ (Week 6)
- Full integration
- Testing
- Documentation

**Total: 6 weeks to complete Place System**

---

## Quick Reference

### New Reference Formats
```
place.<region>.<place>              → place.eden_crossroads.tavern_common
place_tile.<region>.<place>.x.y     → place_tile.eden_crossroads.tavern.10.15
```

### Commands
```
INSPECT place.eden_crossroads.tavern_common
MOVE target=place_tile.eden_crossroads.tavern.15.10
COMMUNICATE targets=[npc.gunther] text="Hello"
```

### Key Metrics
- **Tile Size:** 2.5 feet
- **Small Room:** 10×10 tiles (25×25 ft)
- **Awareness Range:** 8 tiles (20 ft) for normal speech
- **Sound Travel:** Through walls ×0.5, Through doors ×0.5

---

## Benefits Summary

✅ **Realistic:** Characters have actual positions  
✅ **Tactical:** Stealth, cover, line of sight  
✅ **Atmospheric:** Each place feels unique  
✅ **Scalable:** Unlimited places per region  
✅ **Narrative:** Context-aware NPC responses  
✅ **Future-proof:** Ready for graphics, pathfinding  

---

**See PLACE_SYSTEM_PLAN.md for full technical specification**

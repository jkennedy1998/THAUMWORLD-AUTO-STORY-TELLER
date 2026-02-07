# Place System Implementation: Ready to Begin

**Date:** February 2, 2026  
**Status:** Planning Complete  
**Decision Required:** Which phase to start?

---

## 📋 What You Now Have

### Complete Documentation
1. **PLACE_SYSTEM_PLAN.md** - Full technical specification (8 phases, ~25 pages)
2. **PLACE_SYSTEM_VISUAL_GUIDE.md** - Visual overview with examples
3. **INDEX.md** - Updated to include new documentation

### Key Features Designed
✅ **Place Graph System** - Rooms connected like nodes  
✅ **Tile Grid** - 2.5ft tiles for granular positioning  
✅ **Local Awareness** - NPCs only react to their place  
✅ **3D World** - Surface, above, below elevations  
✅ **Biome System** - Preset wilderness places  
✅ **Travel System** - Within place, between places, between regions  
✅ **Pathfinding** - Framework for future graphics  

---

## 🎯 Implementation Overview

### Architecture Change
```
BEFORE:
World → Region → [Scattered entities]

AFTER:
World → Region → Places (rooms) → Tiles (2.5ft grid) → Entities
```

### Example Use Cases
1. **Tavern** - Common room, kitchen, private rooms, basement
2. **Church** - Nave, bell tower (above), catacombs (below)
3. **Wilderness** - Biome generates campsite, stream, grove
4. **Stealth** - Hide behind tables, sneak past guards
5. **Eavesdropping** - NPCs hear adjacent conversations

---

## 📊 Implementation Breakdown

### Phase 1: Foundation (Days 1-3)
**Scope:** Type definitions, storage system, basic CRUD
- Place type definitions
- Place storage (load/save)
- Place directory structure
- Region schema updates
- **Deliverable:** Can create/load/save places

### Phase 2: References (Days 4-6)
**Scope:** Reference resolution, data broker integration
- Update reference resolver
- Add place reference types
- Place utility functions
- Data broker commands
- **Deliverable:** Can reference places in commands

### Phase 3: NPC AI (Days 7-10)
**Scope:** Local awareness, place-based detection
- Update NPC location format
- Place-based detection (not region-wide)
- Proximity awareness (tiles)
- NPC movement within/between places
- **Deliverable:** Gunther only reacts to tavern events

### Phase 4: Travel (Days 11-14)
**Scope:** Movement system
- Tile-level movement (within place)
- Place-to-place movement
- Regional travel
- Travel narratives
- **Deliverable:** Can walk around, enter rooms, travel

### Phase 5: Migration (Days 15-17)
**Scope:** Convert existing data
- Migration script
- Create places for existing regions
- Assign NPCs to places
- Biome system
- **Deliverable:** All existing content works with places

### Phase 6: Awareness (Days 18-21)
**Scope:** Line of sight, sound, stealth
- Obstacle detection
- Sound propagation
- Lighting effects
- Stealth mechanics
- **Deliverable:** Realistic detection, cover, hiding

### Phase 7: Tiles (Days 22-24)
**Scope:** Tile maps, pathfinding
- Tile type definitions
- Place tile maps
- A* pathfinding
- Graphics-ready framework
- **Deliverable:** NPCs pathfind around furniture

### Phase 8: Integration (Days 25-28)
**Scope:** Full system integration
- Update all services
- Documentation updates
- Testing suite
- Performance optimization
- **Deliverable:** Production-ready place system

---

## ⚡ Quick Start Options

### Option A: Full Implementation (Recommended)
**Timeline:** 4-6 weeks  
**Approach:** Implement all 8 phases sequentially  
**Result:** Complete place system with all features  
**Best for:** Major release, foundational change

### Option B: MVP Implementation (Fast)
**Timeline:** 1-2 weeks  
**Approach:** Phases 1-4 only
- Basic places and storage
- NPC positioning
- Simple travel
- Skip: Awareness radius, tiles, biomes
**Result:** Places work but without advanced features  
**Best for:** Quick prototype, testing concept

### Option C: Incremental Rollout
**Timeline:** Ongoing (1 phase per week)
**Approach:** Implement one phase at a time
- Deploy Phase 1 → Test → Stabilize
- Deploy Phase 2 → Test → Stabilize
- Continue...
**Result:** Gradual improvement, lower risk  
**Best for:** Production environment, minimal disruption

---

## 🎮 Gameplay Impact Examples

### Before Place System
```
Player: [in Grenda's shop] "I want to steal something"
Gunther (outside at waystone): "I heard that!"
```

### After Place System
```
Player: [in Grenda's shop] "I want to steal something"
Grenda (3 tiles away): *narrows eyes* "Excuse me?"
Shop patron (8 tiles away): *looks up from browsing*
Gunther (different place entirely): *continues whittling, unaware*
```

### Tactical Combat Example
```
Place: Tavern Common Room

Player: "hide behind the bar"
System: Moving to cover position...
        "You duck behind the bar, 
         using it as cover."

Bandit: "where did they go?"
System: Bandit doesn't have line of sight
        Bandit moves to investigate

Player: [whispers] "sneak attack"
System: Attack from cover!
        Bandit surprised!
```

---

## 📁 New Files Created

### Documentation
```
docs/
├── PLACE_SYSTEM_PLAN.md          ← Full technical spec
├── PLACE_SYSTEM_VISUAL_GUIDE.md  ← Visual overview
└── INDEX.md                      ← Updated with links
```

### Next: Implementation Files
```
src/
├── types/place.ts               ← Type definitions
├── place_storage/
│   ├── store.ts                 ← Load/save places
│   └── utils.ts                 ← Utility functions
├── travel/
│   └── place_travel.ts          ← Travel system
├── pathfinding/
│   └── a_star.ts                ← Tile pathfinding
└── biome_system/
    └── presets.ts               ← Biome definitions
```

---

## ✅ Checklist Before Starting

- [ ] Review PLACE_SYSTEM_PLAN.md
- [ ] Decide on implementation approach (A, B, or C)
- [ ] Backup existing data (especially NPC files)
- [ ] Determine priority features
- [ ] Allocate development time
- [ ] Create development branch

---

## 🚀 Next Steps

### To Begin Implementation:

1. **Choose Approach**
   - Full (4-6 weeks)
   - MVP (1-2 weeks)
   - Incremental (weekly phases)

2. **Phase 1 Setup**
   ```bash
   # Create new branch
   git checkout -b feature/place-system
   
   # Create directories
   mkdir -p src/place_storage
   mkdir -p src/types
   mkdir -p local_data/data_slot_1/places
   ```

3. **Start Coding**
   - Begin with `src/types/place.ts`
   - Then `src/place_storage/store.ts`
   - See PLACE_SYSTEM_PLAN.md for detailed specs

---

## 📊 Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complex migration | High | Comprehensive migration script, backups |
| Performance issues | Medium | Caching, lazy loading |
| Breaking existing saves | High | Backward compatibility, gradual rollout |
| Over-complication | Low | Start simple, iterate |
| Development time | Medium | MVP option available |

**Overall Risk:** Medium  
**Confidence:** High (well-documented, phased approach)

---

## 💡 Recommendations

### For Immediate Start:
1. Begin with **Phase 1: Foundation** (3 days)
2. Create place storage and types
3. Don't touch existing data yet

### For Testing:
1. Create one test region with 2-3 places
2. Move test NPCs to places
3. Verify awareness boundaries

### For Production:
1. Use **Option C: Incremental Rollout**
2. One phase per week
3. Test thoroughly between phases
4. Maintain backward compatibility

---

## 📝 Summary

You now have a **complete, detailed plan** for implementing the Place system that will:

- ✅ Make positioning granular and realistic
- ✅ Enable local NPC awareness (no more omniscient NPCs)
- ✅ Support tactical gameplay (stealth, cover, line of sight)
- ✅ Scale to unlimited places per region
- ✅ Provide framework for future tile graphics
- ✅ Maintain backward compatibility during migration

**The plan is ready. The decision is yours.**

### Ready to Start Phase 1?
```
1. Choose approach (A, B, or C)
2. Create development branch
3. Begin with src/types/place.ts
4. Follow PLACE_SYSTEM_PLAN.md
```

**Or would you like to:**
- Adjust any part of the plan?
- Start with a specific phase?
- Create mock data for testing?
- Modify the approach?

Let me know how you'd like to proceed!

# Development Roadmap

**Last Updated:** February 13, 2026  
**Status:** Active Development  
**Current Phase:** Core Systems Operational - Feature Development

---

## System Status ✅

**The core system is operational and playable!** Recent testing (Feb 13, 2026) confirms:

### Working Correctly
- ✅ **Working Memory** - Events recorded properly (`ContextManager Built working memory`)
- ✅ **Message Pipeline** - No duplication, proper flow through all services
- ✅ **Conversation Threading** - Session IDs consistent across messages
- ✅ **Place System** - NPCs correctly check locations (Grenda responds, Gunther ignored when not present)
- ✅ **NPC Autonomy** - Grenda wanders autonomously, makes decisions
- ✅ **Click-to-Move** - Player movement working with path visualization
- ✅ **AI Integration** - NPCs generate contextual responses using llama3.2
- ✅ **COMMUNICATE as Action** - ActionPipeline validates range + perception; witness drives conversation state
- ✅ **Multi-NPC Witness** - Nearby NPCs can join/eavesdrop/ignore based on personality and perception

### Minor Issues (Polish, Not Critical)
- Message cleanup/garbage collection needed (old messages accumulate)
- Log verbosity could be reduced
- Performance optimization opportunities

---

## Current Priorities

### 🟠 HIGH PRIORITY - Active Development

#### 1. Advanced NPC Interactions (1-2 weeks)
**Plan:** `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`
**Status:** Draft (active)
**Impact:** Sequential multi-NPC replies, witnessed-action follow-ups, perf/edge-case hardening

**Already Done:**
- ✅ Single pipeline for COMMUNICATE (only participants respond)
- ✅ Multi-NPC in same place tested (Grenda + assistant)

**Remaining:**
- Reply sequencing (avoid pile-on)
- Edge cases + performance checks

---

#### 2. Complete Place Module Phase 5 (1-2 weeks)
**Plan:** `PLACE_MODULE_PLAN.md`  
**Status:** Phase 5.2 Complete, 5.3-5.4 In Progress  
**Impact:** Visual feedback, player movement, NPC autonomy

**Already Done:**
- ✅ Border rendering
- ✅ Entity positioning  
- ✅ Right-click targeting
- ✅ Tile cycling
- ✅ Door rendering and interaction
- ✅ Click-to-move system
- ✅ Particle system for path visualization
- ✅ NPC free movement (wandering)

**Remaining:**
- Phase 5.3: Range system for actions
- Phase 5.4: NPC/Actor free movement polish

**Why:** Visual module makes the game feel alive. Already has momentum.

---

#### 3. Region Travel System (3-4 weeks)
**Plan:** `docs/plans/2026_02_06_region_travel_system.md`  
**Status:** Phase 0 Complete  
**Impact:** World exploration, travel between regions

**Phase 1:** Region system foundation
- Region definitions and storage
- Region connections  
- World map structure

**Phase 2:** Basic travel system
- Travel commands
- Travel time calculation
- Arrival events

**Dependencies:** Place system working (✅ Done)

---

### 🟡 MEDIUM PRIORITY - Enhancement

#### 4. Tabletop Pacing & Intent System (2-3 weeks)
**Plan:** `docs/plans/2026_02_02_tabletop_pacing_intent_targeting.md`  
**Status:** Draft (Approved Direction)  
**Impact:** Core UX improvement - one message = one action

**Key Features:**
- UI mention parsing (@Name tokens)
- Action packet propagation
- Intent override buttons (FREE, PARTIAL, FULL, EXTENDED)
- Clarification workflow

---

#### 5. INSPECT Action System (4 weeks)
**Plan:** `docs/plans/2026_02_05_inspect_implementation_plan.md`  
**Status:** Planning/Ready  
**Impact:** Core gameplay mechanic - exploration and discovery

**Dependencies:** Place system (✅ Done), Place module (In Progress)

---

### 🟢 FUTURE - Architecture

#### 6. Unified Action System (6-8 weeks)
**Plan:** `docs/archive/2026_02_05_action_system_plan_IMPLEMENTED.md` (core implemented; extensions ongoing)
**Status:** Ongoing extensions
**Impact:** Architecture improvement for maintainability

**Dependencies:** All foundation work complete (✅ Done)

---

## Recommended Development Order

### Week 1-2: Polish & Travel
```
Week 1: Complete Place Module Phase 5.3-5.4
        - Range system for actions
        - NPC movement polish
        
Week 2: Region Travel Phase 1
        - Region definitions
        - Basic travel commands
```

### Week 3-4: Features
```
Week 3: Region Travel Phase 2
        - Travel time calculation
        - Arrival events
        
Week 4: INSPECT system foundation
        - Tile inspection
        - Item inspection
```

### Week 5+: Advanced Features
```
Week 5-6: Tabletop Pacing implementation
Week 7-8: INSPECT system completion
Week 9+: Advanced features, polish
```

---

## Success Criteria

**Current Status (Feb 6, 2026):**
- [x] Working memory returns correct data
- [x] No duplicate messages
- [x] Conversations thread properly
- [x] NPCs react only to local events
- [x] Can walk around places
- [x] Visual module shows movement
- [x] NPCs move autonomously

**Week 4 Goals:**
- [ ] Can travel between regions
- [ ] Range system for actions
- [ ] INSPECT system basic functionality

**Week 8 Goals:**
- [ ] Intent targeting works
- [ ] Pacing feels natural
- [ ] Can inspect environment

---

## Immediate Next Actions

### Today:
1. **Review Place Module Phase 5.3** - Range system implementation
2. **Test current gameplay** - Verify all core systems working

### This Week:
1. Complete Place Module Phase 5.3 (Range system)
2. Begin Region Travel Phase 1
3. Test NPC autonomy features

### Next Week:
1. Complete Place Module Phase 5.4
2. Continue Region Travel implementation
3. Begin INSPECT system design

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Place system complexity | Medium | Medium | Already working, just polish |
| Travel system integration | Medium | High | Test early with place system |
| AI behavior changes | Low | Medium | Current system stable |
| Performance at scale | Medium | Medium | Monitor and optimize |

---

**Document:** Development Roadmap  
**Location:** `docs/ROADMAP.md`  
**Last Updated:** February 6, 2026  
**Next Review:** February 13, 2026

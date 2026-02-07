# Implementation Roadmap - Next Steps

**Date:** 2026-02-06  
**Status:** 🔵 ACTIVE  
**Priority:** Critical  
**File:** `docs/plans/2026_02_06_implementation_roadmap.md`

> **Executive Summary:** Three focused implementation tracks based on current system state. Core systems operational, now building features.

---

## Current System State (Feb 6, 2026)

### ✅ Working Correctly
- Working memory records events
- Message pipeline flows without duplication
- Place system filters NPCs by location
- NPCs move autonomously (wandering)
- Click-to-move functional
- AI generates contextual responses
- Conversation threading works

### ⚠️ Current Limitations
- Actions have no range validation
- Players cannot travel between regions
- INSPECT system incomplete
- UI targeting needs refinement

---

## Three Implementation Tracks

### Track 1: Action Range System (Priority: HIGH)
**Duration:** 1 week  
**Goal:** Complete Place Module Phase 5

**Why First:**
- Already in progress (Phases 5.1-5.2 done)
- Blocks INSPECT system (needs range)
- Creates tactical gameplay layer
- Quick win - finish what's started

**Implementation Order:**

**Day 1-2: Range Calculator**
- [ ] Create `src/action_system/range_calculator.ts`
- [ ] Define base ranges for all action types
- [ ] Implement distance calculation (Manhattan)
- [ ] Add modifier support (perks/items)

**Day 3-4: Validation Integration**
- [ ] Integrate into Rules Lawyer
- [ ] Block out-of-range actions
- [ ] Generate helpful error messages
- [ ] Create range suggestions

**Day 5-6: UI Indicators**
- [ ] Add range circle to place module
- [ ] Highlight valid targets (green)
- [ ] Gray out invalid targets (red)
- [ ] Show range info in action panel

**Day 7: Testing & Polish**
- [ ] Test melee attacks (1 tile)
- [ ] Test ranged attacks (5 tiles)
- [ ] Test communication (3 tiles)
- [ ] Verify modifiers work

**Deliverable:** Actions validate range, UI shows indicators, tactical positioning works.

---

### Track 2: Region Travel System (Priority: HIGH)
**Duration:** 2 weeks  
**Goal:** Enable world exploration

**Why Second:**
- Currently players are trapped in starting region
- Logs show: "move to town square" → narrative only, no actual travel
- Place system working, so regions are the next layer
- Opens up world for quests and exploration

**Implementation Order:**

**Week 1: Foundation**

**Day 1-2: Region Registry**
- [ ] Create `src/region_system/registry.ts`
- [ ] Define Eden Crossroads region
- [ ] Define Whispering Woods region
- [ ] Define region connections

**Day 3-4: Travel Events**
- [ ] Create TravelEvent structure
- [ ] Implement `initiate_travel()`
- [ ] Process travel over time
- [ ] Handle completion/cancellation

**Day 5-7: Region Loader**
- [ ] Load existing regions
- [ ] Generate new regions procedurally
- [ ] Biome-based content
- [ ] Place NPCs and items

**Week 2: Integration**

**Day 8-9: Interpreter Updates**
- [ ] Detect travel intent
- [ ] Check region connections
- [ ] Create TRAVEL action type
- [ ] Suggest paths

**Day 10-12: UI Integration**
- [ ] World map display
- [ ] Region click handlers
- [ ] Travel progress UI
- [ ] Arrival notifications

**Day 13-14: Testing**
- [ ] Travel Eden → Woods
- [ ] Verify region loads correctly
- [ ] Check NPCs appear
- [ ] Test cancellation

**Deliverable:** Player can travel between regions, world opens up, exploration enabled.

---

### Track 3: INSPECT System Completion (Priority: MEDIUM)
**Duration:** 2 weeks  
**Goal:** Complete Phases 3-7

**Why Third:**
- Phases 1-2 already implemented
- Depends on range system (INSPECT has range 10)
- Adds exploration depth
- Less critical than travel

**Implementation Order:**

**Week 1: Core Functionality**

**Day 1-3: Sense System**
- [ ] Implement THAUMWORLD MAG rules
- [ ] Sight (MAG + 2 range)
- [ ] Hearing (MAG + 1 range)
- [ ] Pressure/Touch/Essence senses

**Day 4-6: Perception Checks**
- [ ] Range-based visibility
- [ ] Obstacle blocking (line of sight)
- [ ] Hidden feature detection
- [ ] Challenge Rating system

**Week 2: UI & Polish**

**Day 7-9: Inspection UI**
- [ ] Click to inspect tiles
- [ ] Right-click menu options
- [ ] Detail panels
- [ ] Hidden feature reveals

**Day 10-12: Advanced Features**
- [ ] Character inspection
- [ ] Item inspection
- [ ] Multiple senses
- [ ] Perception check rolls

**Day 13-14: Testing**
- [ ] Inspect nearby objects
- [ ] Detect hidden items
- [ ] Verify sense ranges
- [ ] Check CR system

**Deliverable:** INSPECT action fully functional, hidden items discoverable, exploration rewarded.

---

## Parallel Development Strategy

### Week 1: Foundation

**Developer A (Action Range):**
- Days 1-2: Range calculator
- Days 3-4: Validation integration
- Days 5-7: UI indicators

**Developer B (Region System):**
- Days 1-2: Region registry
- Days 3-4: Travel events
- Days 5-7: Region loader

### Week 2: Integration

**Developer A (Range Polish + INSPECT Start):**
- Days 8: Range testing
- Days 9-10: INSPECT sense system
- Days 11-14: INSPECT UI

**Developer B (Region Integration):**
- Days 8-9: Interpreter updates
- Days 10-12: Region UI
- Days 13-14: Testing

### Week 3: Completion

**Both Developers:**
- Finish INSPECT system
- Integration testing
- Bug fixes
- Performance optimization

---

## Testing Milestones

### Milestone 1: Action Range (End of Week 1)
**Test Scenario:**
```
Player at (5, 5)
Grenda at (7, 5) - 2 tiles away
Action: ATTACK (range 1)
Expected: "Grenda is out of range (2 tiles). Move closer?"
```

**Success Criteria:**
- [ ] Range circle appears on action selection
- [ ] Out-of-range targets grayed out
- [ ] Helpful error messages
- [ ] Arc attacks hit correct tiles

### Milestone 2: Region Travel (End of Week 2)
**Test Scenario:**
```
Current: Eden Crossroads
Command: "travel to whispering woods"
Expected: 
  - Travel initiated (15 min)
  - Progress shown
  - Arrival in Whispering Woods
  - Forest Clearing loaded
  - NPCs present
```

**Success Criteria:**
- [ ] Travel between connected regions works
- [ ] Time passes appropriately
- [ ] New region loads with content
- [ ] World map shows location

### Milestone 3: INSPECT System (End of Week 3)
**Test Scenario:**
```
Location: Grenda's Shop
Command: "inspect shelf"
Range: 2 tiles (within INSPECT range 10)
Expected:
  - Shelf details revealed
  - Hidden potion detected (CR passed)
  - Description generated
```

**Success Criteria:**
- [ ] Can inspect tiles/items
- [ ] Hidden features detectable
- [ ] Sense ranges respected
- [ ] CR system functional

---

## Risk Management

### Risk 1: Range System Complexity
**Probability:** Medium  
**Impact:** High  
**Mitigation:** Start with simple Manhattan distance, add modifiers later

### Risk 2: Region Generation Performance
**Probability:** Medium  
**Impact:** Medium  
**Mitigation:** Lazy load regions, cache generated content

### Risk 3: Integration Issues
**Probability:** High  
**Impact:** High  
**Mitigation:** Daily integration tests, feature branches

---

## Success Criteria

### Week 1 Success (Action Range)
- [ ] Actions validate range
- [ ] UI shows range indicators
- [ ] Tactical positioning works
- [ ] Arc attacks functional

### Week 2 Success (Region Travel)
- [ ] Can travel between regions
- [ ] Regions load correctly
- [ ] NPCs appear in new regions
- [ ] World map functional

### Week 3 Success (INSPECT)
- [ ] INSPECT action works
- [ ] Hidden items discoverable
- [ ] Sense system operational
- [ ] All systems integrated

---

## Daily Standup Questions

**For each track:**
1. What did you complete yesterday?
2. What are you working on today?
3. Any blockers or dependencies?

**Integration Check:**
- Are we on track for the week's milestone?
- Any breaking changes to coordinate?
- Testing completed for finished features?

---

## Post-Implementation

After completing these three tracks:

**Next Features:**
1. Tabletop Pacing system (UI targeting)
2. Advanced action subtypes (combat special moves)
3. Quest system (requires regions)
4. Crafting system (requires INSPECT)

**Technical Debt:**
1. Optimize region loading
2. Add caching for calculations
3. Improve error handling
4. Add metrics/logging

---

**Document:** Implementation Roadmap - Next Steps  
**Location:** `docs/plans/2026_02_06_implementation_roadmap.md`  
**Total Duration:** 3 weeks  
**Last Updated:** February 6, 2026

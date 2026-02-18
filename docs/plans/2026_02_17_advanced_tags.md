# Advanced Tags System Plan

**Date:** 2026-02-17 (Branched from completed Tag Unification)  
**Status:** PLANNING - Advanced features and deferred mechanics  
**Priority:** MEDIUM - Builds on completed tag foundation  
**Related:** See archived `2026_02_17_tag_unification.md` for completed base system

---

## Overview

This plan extends the completed tag system unification with advanced features that were deferred during initial implementation. The base tag system (TagInstance, MetaTagProcessor, Event Bridge) is complete and production-ready. This plan focuses on:

- Complex tag interactions and mechanics
- Deferred FIRE! effects (damage, spreading, BROKEN)
- Advanced meta tags beyond [DISPERSING]
- Performance optimizations
- Full tag definitions coverage

---

## 1) Complex FIRE! Effects (DEFERRED FROM BASE)

### Status: NOT IMPLEMENTED

The base FIRE! tag implements:
- ✅ Visual color changes based on MAG
- ✅ Auto-dispersal via [DISPERSING] meta tag
- ✅ Event-driven updates via Event Bridge

**These advanced effects are DEFERRED:**

### 1.1 Fire Damage to Health

**Description:** Characters on fire take damage over time based on MAG.

**Mechanics:**
- Damage per tick = MAG × base_damage (e.g., MAG 5 = 5 damage/6s)
- Damage type: "fire" (can be resisted)
- Applies to: Actors, NPCs (not items, not tiles directly)

**Implementation:**
- Hook into MetaTagProcessor after dispersing
- Check if entity has health system
- Apply damage and emit health change event
- Log: `FIRE_DAMAGE: actor=henry, damage=5, remaining_health=45`

**Files to modify:**
- `src/tag_system/meta_processor.ts` - Add fire damage processing
- `src/actor_storage/store.ts` - May need health modification methods

**Acceptance:**
- [ ] Character with FIRE! tag takes damage every dispersing tick
- [ ] Damage amount scales with MAG (higher MAG = more damage)
- [ ] Death occurs if health reaches 0
- [ ] Debug logs show damage calculations

### 1.2 Fire Spreading to Adjacent Entities

**Description:** Fire can jump to nearby flammable entities (tiles, items, other characters).

**Mechanics:**
- Spread chance = MAG × base_spread_chance (e.g., 5% per MAG per tick)
- Only spreads to entities with [flammable] tag
- Range: Adjacent tiles (1 tile radius)
- New fire starts at MAG 1 (not full MAG of source)

**Implementation:**
- After dispersing, check adjacent tiles in place
- Find flammable entities (check tags for "flammable")
- Roll spread chance for each
- Add FIRE! tag (MAG 1) to successful spreads
- Emit SPREAD event for visual effects

**Files to modify:**
- `src/tag_system/meta_processor.ts` - Add spread logic
- `src/place_storage/entity_index.ts` - Query adjacent entities
- `src/shared/event_emitter.ts` - Add TAG_SPREAD event type

**Acceptance:**
- [ ] Fire spreads to adjacent flammable tiles
- [ ] Fire spreads to adjacent characters with flammable items
- [ ] Spread chance scales with MAG
- [ ] New fires start at MAG 1
- [ ] Visual effect shows spread animation

### 1.3 Item BROKEN Condition from Fire

**Description:** Items with [flammable] tag can be destroyed by fire.

**Mechanics:**
- When item receives FIRE! tag, roll destruction chance
- Chance = (FIRE_MAG × item_flammability) / item_durability
- Destroyed items get [BROKEN] tag and become unusable
- Can be repaired (future feature)

**Implementation:**
- Check items when fire spreads to them
- Add item durability to item data
- Add [BROKEN] meta tag to tag_definitions.jsonc
- Modify item usage checks to reject [BROKEN] items

**Files to modify:**
- `local_data/data_slot_default/tag_definitions.jsonc` - Add [BROKEN] definition
- `src/item_storage/store.ts` - Add durability/flammability fields
- `src/action_handlers/` - Check for [BROKEN] before using items

**Acceptance:**
- [ ] Items can catch fire and be destroyed
- [ ] Destroyed items get [BROKEN] tag
- [ ] BROKEN items cannot be used
- [ ] Repair system (optional for this phase)

### 1.4 Tile Temperature Changes

**Description:** Tiles heat up when on fire, affecting other entities.

**Mechanics:**
- Tiles have temperature attribute (ambient, warm, hot, burning)
- Fire raises tile temperature
- High temperatures can ignite adjacent tiles
- Temperature decays over time

**Implementation:**
- Add temperature field to tile data
- Update temperature based on FIRE! tags present
- Temperature affects spread chance
- Visual: Hot tiles glow orange/red

**Files to modify:**
- `src/types/place.ts` - Add temperature to tile type
- `src/place_storage/store.ts` - Temperature persistence
- Renderer - Visual temperature indicators

**Acceptance:**
- [ ] Tiles track temperature state
- [ ] Fire increases tile temperature
- [ ] Temperature affects fire spread
- [ ] Visual feedback for hot tiles

---

## 2) Advanced Meta Tags

### 2.1 [DISEASE] Meta Tag

**Description:** Tags that spread between entities and worsen over time.

**Variants:**
- `[DISEASE:POISON]` - Health drain, curable
- `[DISEASE:CURSE]` - Stat penalties, requires magic to cure
- `[DISEASE:PLAGUE]` - Highly contagious, spreads quickly

**Mechanics:**
- Spread via proximity (like fire)
- Worsen over time (MAG increases, not decreases)
- Can be cured by specific actions/tags
- Affect stats (STR, DEX, etc.)

**Implementation:**
- Add disease processing to MetaTagProcessor
- Create disease progression rules
- Add cure mechanics (items, actions)
- Health system integration

**Acceptance:**
- [ ] Diseases spread between entities
- [ ] Diseases worsen over time
- [ ] Diseases affect character stats
- [ ] Diseases can be cured

### 2.2 [TEMPORARY] Meta Tag

**Description:** Tags that expire after a set duration.

**Mechanics:**
- Tag has expiry timestamp
- Auto-removed when time expires
- Can be refreshed by reapplying
- Examples: Buffs, debuffs, timed effects

**Implementation:**
- Add expiry field to TagInstance (already exists!)
- Check expiries in MetaTagProcessor
- Remove expired tags

**Acceptance:**
- [ ] Tags with expiry auto-remove
- [ ] Expiry can be refreshed
- [ ] Debug logs show expiry events

### 2.3 [STACKABLE] Meta Tag

**Description:** Tags that can have multiple instances on same entity.

**Mechanics:**
- Multiple copies of same tag allowed
- Each copy has independent MAG
- Examples: Multiple wounds, stacking buffs
- Display: Show count in UI

**Implementation:**
- Modify tag operations to allow duplicates
- Update cache logic to handle stacks
- UI changes to show stacks

**Acceptance:**
- [ ] Multiple instances of same tag allowed
- [ ] Each instance tracked independently
- [ ] UI shows stack count

### 2.4 [PROTECTED] Meta Tag

**Description:** Tags that cannot be removed by normal means.

**Mechanics:**
- Immune to dispersing
- Immune to cure effects
- Can only be removed by specific conditions
- Examples: Curses, permanent traits

**Implementation:**
- Add protected check to tag removal logic
- Bypass dispersing for protected tags
- Add specific removal conditions

**Acceptance:**
- [ ] Protected tags don't disperse
- [ ] Protected tags resist removal
- [ ] Specific conditions can remove them

---

## 3) Tag Interactions

### 3.1 Tag Synergies

**Description:** Multiple tags interact to create enhanced effects.

**Examples:**
- `[FIRE!] + [WET]` = Steam (different damage type)
- `[POISON] + [FIRE!]` = Toxic smoke (AoE effect)
- `[COLD] + [WET]` = Ice (immobilize)

**Implementation:**
- Define synergy rules in tag definitions
- Check for synergies in MetaTagProcessor
- Apply combined effects

**Acceptance:**
- [ ] Synergy rules defined for tag pairs
- [ ] Combined effects apply when both tags present
- [ ] Visual feedback shows synergy

### 3.2 Tag Immunities and Resistances

**Description:** Entities can resist or be immune to certain tag effects.

**Mechanics:**
- Immunity: Tag cannot be applied
- Resistance: Reduced MAG or duration
- Vulnerability: Increased MAG or duration

**Implementation:**
- Add resistance/immunity fields to entity data
- Modify tag application logic
- Scale effects based on resistance

**Acceptance:**
- [ ] Entities can have tag immunities
- [ ] Resistances reduce tag effects
- [ ] Vulnerabilities increase tag effects

---

## 4) Performance Optimizations

### 4.1 Tag Indexing

**Description:** Optimize tag queries for large entity counts.

**Current:** O(n) scan of all entities every tick
**Target:** O(1) lookup using index

**Implementation:**
- Create TagIndex class
- Index entities by tag name
- Update index on tag add/remove
- Use index for dispersing queries

**Files:**
- `src/tag_system/tag_index.ts` (NEW)
- `src/tag_system/meta_processor.ts` - Use index

**Acceptance:**
- [ ] Tag queries use index
- [ ] Performance acceptable with 1000+ entities
- [ ] Index updates correctly on changes

### 4.2 Event Batching

**Description:** Batch multiple tag events to reduce WebSocket overhead.

**Current:** Each tag change = 1 WebSocket message
**Target:** Batch multiple changes into 1 message

**Implementation:**
- Add event queue to Event Bridge
- Flush queue every 100ms or when full
- Send batch of events in one message
- Renderer processes batch

**Acceptance:**
- [ ] Events batch correctly
- [ ] Latency remains < 200ms
- [ ] Reduced network overhead

---

## 5) Full Tag Definitions

### 5.1 Complete Tag Database

**Description:** Define all tags in tag_definitions.jsonc with full metadata.

**Current:** Only FIRE! fully defined
**Target:** All existing tags defined

**Tags to define:**
- Status tags: [POISON], [STUN], [SLOW], [HASTE], etc.
- Item tags: [SHARP], [DULL], [FRAGILE], [DURABLE], etc.
- Character tags: [BRAVE], [COWARDLY], [STRONG], [WEAK], etc.
- Environmental tags: [WET], [DRY], [WINDY], [CALM], etc.

**Implementation:**
- Update `local_data/data_slot_default/tag_definitions.jsonc`
- Add descriptions, meta tags, effects for each
- Validate all tags load correctly

**Acceptance:**
- [ ] All existing tags defined
- [ ] Descriptions and metadata complete
- [ ] System loads without errors

---

## 6) Testing Strategy

### Integration Testing

**Test scenarios:**
1. Fire damage + spreading in closed room
2. Disease outbreak in crowded place
3. Multiple synergies (fire + poison + wet)
4. Performance test with 1000 burning entities
5. Tag immunity against spreading effects

### Performance Benchmarks

**Targets:**
- Tag processing: < 10ms for 1000 entities
- Event latency: < 100ms end-to-end
- Memory: < 100MB for tag system

---

## 7) Implementation Priority

### Phase 1: Fire Effects (High Priority)
- Fire damage to health
- Fire spreading
- Item destruction

### Phase 2: Advanced Meta Tags (Medium Priority)
- Disease system
- Temporary tags
- Protected tags

### Phase 3: Interactions (Medium Priority)
- Tag synergies
- Immunities/resistances

### Phase 4: Performance (Low Priority)
- Tag indexing
- Event batching
- Full definitions

---

## 8) Dependencies

**Requires:**
- ✅ Completed base tag system (archived 2026_02_17)
- ✅ Event Bridge service
- ✅ MetaTagProcessor framework
- ⏳ Health system (for damage)
- ⏳ Item durability system
- ⏳ Place temperature system

---

## Summary

This plan extends the solid tag foundation with advanced mechanics. The base system is complete and working. These features add depth and complexity for richer gameplay.

**Estimated Timeline:**
- Phase 1 (Fire Effects): 2-3 days
- Phase 2 (Meta Tags): 2-3 days
- Phase 3 (Interactions): 2-3 days
- Phase 4 (Performance): 1-2 days

**Total:** ~1-2 weeks for full advanced system

**Recommendation:** Start with Phase 1 (Fire Effects) as it builds naturally on the working FIRE! proof-of-concept.

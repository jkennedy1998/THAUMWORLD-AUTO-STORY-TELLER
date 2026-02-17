# Tag System Unification Plan

**Date:** 2026-02-17
**Status:** ACTIVE

Checkbox legend:
- `[ ]` not_started
- `[~]` implemented
- `[x]` tested

## Goal

Unify the tag system across all entity types (items, characters/NPCs, tiles) with a single consistent mechanic where:

- All entities use the same `TagInstance` structure: name, magnitude (MAG), meta tags, tracked info
- Meta tags like `[DISPERSING]` automatically modify tag behavior over time
- Entity-specific tag effects work through a unified system
- The `[FIRE!]` tag serves as proof-of-concept demonstrating: visual changes, auto-dispersal, and debug logging
- Implementation can be tested live with `npm run dev:logs` to verify each step

**What's Already Built:**
- Core tag infrastructure exists (`TagInstance`, `TagRule`, `TagRegistry` in `src/tag_system/`)
- Tag definitions database with `meta` tags and scopes (`tag_definitions.jsonc`)
- Time system for turn/real-time tracking (`src/time_system/tracker.ts`)
- NPCs already have tag arrays (though different format)
- Items already use `TagInstance` format

## Implementation Clarifications

**Approach: Minimal, viable system - delete old unused code, extend what works**

### 1. MetaTagProcessor Location
**NEW FILE**: `src/tag_system/meta_processor.ts`
- Create as standalone class in new file
- Keep `src/tag_system/registry.ts` and other existing files, extend them as needed
- Delete any old/unused tag-related systems that are superseded by this implementation

### 2. Migration Strategy
**Direct file edits only - NO runtime migration, NO backwards compatibility**
- One save slot exists with test data only
- Edit tile files directly: `tags: string[]` → `tags: TagInstance[]`
- Edit NPC/actor files directly: convert tag format to `TagInstance`
- No migration script needed (test data only)
- No old format support (clean, minimal codebase)
- Delete old tag system code that is no longer used

### 3. Visual Effect Trigger
**Event-driven approach (NOT polling)**
- When tags change, emit `TagChangeEvent`
- Renderer listens for tag change events on entities it displays
- On event: re-read entity tags, update visual state
- **Rationale**: Efficient, allows tags to affect rendering/movement/senses/actions throughout the system
- Add event emitter to `TaggedEntity` operations

### 4. Time System Hook
**Investigate existing time system for single source of truth**
- Review `src/time_system/tracker.ts` and any `turn_manager` documentation
- Find where turn/tick boundaries occur
- Hook meta tag processing at the appropriate boundary
- Call `MetaTagProcessor.processDispersingTags()` at end of turn/tick
- Ensure both real-time and turn-based modes trigger processing
- **Goal**: Time system is the single authority for when tags should disperse

### 5. Dev UI Button Location
**`interface_program.ts` debug panel with other buttons**
- Add button: "Add [FIRE! : 5] to Actor"
- Place alongside existing debug buttons
- Remove button after testing phase is complete
- Use existing UI module pattern

### 6. FIRE! Tag Definition
**Search for existing definition first**
- Check `local_data/data_slot_default/tag_definitions.jsonc` for FIRE! tag
- If half-implemented or missing: add complete definition with [DISPERSING] meta tag
- Definition must include:
  ```json
  {
    "name": "FIRE!",
    "meta": ["DISPERSING"],
    "scope": ["CHARACTER", "ITEM", "TILE"]
  }
  ```

### 7. Color Values
**Use existing indexed color system**
- Do NOT use hex values or Phaser constants directly
- Investigate current indexed color system in codebase
- Use system colors: likely indices like `color_red`, `color_yellow`, etc.
- Get color mapping from existing system
- Document which indices correspond to "bright red" and "vivid yellow"

Related plans:
- `docs/plans/2026_02_14_item_system_unification.md`
- `docs/specs/TAG_SYSTEM.md`

## Current Problems

- **Inconsistent data structures**: Items use full `TagInstance` with stacks/value/source/expiry, NPCs use `{name, info, created_at}`, tiles use plain strings
- **Missing entity operations**: No common `TaggedEntity` interface with standardized addTag/removeTag methods
- **Meta tag system incomplete**: Meta tags defined but no processing system to apply them (e.g., `[DISPERSING]` doesn't auto-remove tags)
- **No entity-specific effect system**: Tag definitions specify entity scopes but no system applies entity-specific effects
- **Tag operations scattered**: Different code paths for tag operations across entity types

## Design Rules

- Single `TagInstance` interface used by **all** entities (items, characters, tiles)
- Tags stored as objects with: name, mag, meta[], info[], source, expiry, scope
- Meta tags can be applied to tag instances to modify their behavior
- Tag operations (add, remove, has, get) use unified functions
- Renderer reads tag state from entities, cannot modify tags directly

## Canonical Data Model

### A) TagInstance (Unified Interface)

**IMPORTANT: Rename existing `stacks` field to `mag`**

```typescript
export interface TagInstance {
  /** Tag identifier (e.g., "fire!", "awareness", "broken") */
  name: string;
  
  /** Magnitude / stack count (default: 1) - NOTE: renamed from `stacks` to `mag` */
  mag: number;
  
  /** Meta tags applied to this tag instance (e.g., ["dispersing"]) */
  meta: string[];
  
  /** Tracked information / variables */
  info?: any[];
  
  /** Source of the tag (optional) */
  source?: string;
  
  /** Expiry timestamp in milliseconds (optional) */
  expiry?: number;
  
  /** Valid scopes for this tag instance */
  scope?: ("CHARACTER" | "ITEM" | "TILE")[];
}
```

**Migration Note**: All existing code using `tag.stacks` must be updated to `tag.mag`. The field name change reflects that tag magnitude can do different things at different levels (e.g., FIRE! renders differently at mag >3 vs mag ≤3).

### B) TaggedEntity Interface

```typescript
export interface TaggedEntity {
  id: string;
  tags: TagInstance[];
  
  // Standardized operations
  getTag(name: string): TagInstance | undefined;
  hasTag(name: string): boolean;
  addTag(tag: TagInstance): void;
  removeTag(name: string, amount?: number): void;
  addStacks(name: string, amount: number): void;
}
```

### C) TagRule (Enhanced)

```typescript
export interface TagRule {
  name: string;
  description: string;
  meta_tags: string[];        // Meta tags this rule has
  actions: TagAction[];
  effectors?: any[];
  behaviors?: {
    on_equip?: string;
    on_use?: string;
    on_hit?: string;
    tick?: string;
  };
  scaling?: {
    per_stack?: { range?: number; damage?: number; [key: string]: any };
    max_stacks?: number;
  };
  // NEW: Entity-specific effect definitions
  entity_effects?: {
    character?: TagEffect[];
    item?: TagEffect[];
    tile?: TagEffect[];
  };
}
```

## Work Items

### 1) Core Infrastructure

**Note: Delete unused old systems, keep and extend what works**

**IMPORTANT: Rename `stacks` → `mag` throughout codebase**
- Existing `TagInstance` uses `stacks` field
- **Rename to `mag`** (magnitude) to reflect that tag levels have different behaviors
- Example: FIRE! renders bright red at mag >3, vivid yellow at mag ≤3

- [~] **ALREADY EXISTS**: `TagInstance`, `TagRule`, `TagAction`, `TaggedItem` interfaces in `src/tag_system/registry.ts` (uses `stacks`, rename to `mag`)
- [~] **ALREADY EXISTS**: `TagRegistry` class with `hasMetaTag()` and `getByMetaTag()` methods
- [~] **ALREADY EXISTS**: `tagRegistry` singleton instance
- [~] **ALREADY EXISTS**: `[FIRE!]` tag definition in `tag_definitions.jsonc` (lines 175-190)
- [ ] **Rename `stacks` → `mag`**: Update all tag-related code to use `mag` instead of `stacks`
- [ ] Review existing registry - delete old/unused tag systems, extend what's viable
- [ ] Add `TaggedEntity` interface to `src/tag_system/registry.ts` for standardized operations
- [ ] Update `TagRule` interface with optional `entity_effects` field
- [ ] Enhance registry to parse and store entity-specific effects from definitions

Acceptance:
- [ ] All entities (tiles, characters, items) use compatible tag structures
- [ ] `FIRE!` tag definition exists with [DISPERSING] meta tag
- [ ] **Field renamed: `stacks` → `mag` throughout codebase**
- [ ] **DEBUG mode enabled for all tag operations**
- [ ] No old/unused tag code remains (minimal, viable system only)

### 2) Meta Tag System (SIMPLIFIED)

**Location: Create new file `src/tag_system/meta_processor.ts`**

**FIRE! EFFECTS: Implement ONLY visual + dispersing for this phase (per plan)**
- Do NOT implement the full existing effects (damage, BROKEN, temperature, spreading)
- Those effects are deferred for future work
- Focus on barebones testing first

- [~] **ALREADY EXISTS**: Meta tag definitions in `tag_definitions.jsonc`
- [ ] Create `MetaTagProcessor` class - NEW FILE: `src/tag_system/meta_processor.ts`
- [ ] Implement `[DISPERSING]`: auto-remove 1 MAG per turn at end of turn/tick
- [ ] Create `processDispersingTags(entity)` method - called by time system
- [~] **DEFERRED**: `[DISEASE:CR]` and other complex meta tags for future work
- [ ] **DEFERRED**: FIRE! damage, spreading, BROKEN, temperature effects
- [ ] Add debug logging throughout meta tag processing
- [ ] Use existing debug standard in project for all log statements

Acceptance:
- [ ] `MetaTagProcessor` processes dispersing tags correctly
- [ ] `[FIRE!]` with `[DISPERSING]` meta auto-decreases over time (visual only)
- [ ] Meta tag effects trigger in both real-time and turn-based modes
- [ ] Debug logs visible in `npm run dev:logs` using project debug standard

### 3) Entity Migration

**Strategy: Direct file edits (no runtime migration, no backwards compatibility)**

**Migration Scope: Tiles, NPCs, and Places**
- [~] **Items**: Already use `TagInstance` format (verify compatibility)
- [ ] **Tiles**: Convert `tags: string[]` to `tags: TagInstance[]` - EDIT TILE FILES DIRECTLY
- [ ] **Characters/NPCs**: Convert tag objects to `TagInstance` format - EDIT ACTOR/NPC FILES DIRECTLY  
- [ ] **Places**: Add tag support if not yet implemented (place tags may not exist yet)
- [ ] **No migration script needed** - only one save slot, data is test data only
- [ ] **No old format support** - delete old format code, not needed
- [ ] Add debug logging to verify successful conversions on load

**IMPORTANT**: Search for all places where tags exist:
- Check tile definitions
- Check NPC files  
- Check place files
- Convert all to unified `TagInstance` format

Acceptance:
- [ ] All entities (tiles, NPCs, places, items) load and save tags in unified format
- [ ] No backwards compatibility code (clean, minimal system)
- [ ] Test save slot data converted correctly
- [ ] Debug logs show successful tag conversions per entity type

### 4) Tag Effect System Integration (SIMPLIFIED)

**Approach: Event-driven visual updates using NEW event emitter**

**Event System Status: Does not exist yet - must be created**
- No existing EventEmitter pattern found in codebase
- No action system events that add tags exist yet
- **Must create new event emitter** for tag changes

- [~] **SIMPLIFIED**: Skip complex effect system for this phase
- [ ] Create basic `EventEmitter` class for tag change events
- [ ] Tag operations (`addTag`, `removeTag`) emit `TagChangeEvent`
- [ ] Renderer listens for `TagChangeEvent` on displayed entities
- [ ] Apply character visual effects from tag definitions (color changes only)
- [ ] **DEFERRED**: Item damage, tile temperature for future work
- [ ] Add debug logging for effect applications using project debug standard

**Rationale**: Event-driven is more efficient than polling, allows tags to affect rendering, movement, senses, actions throughout the system

Acceptance:
- [ ] New EventEmitter created for tag changes
- [ ] `FIRE!` on character changes visual color (red/yellow)
- [ ] Visual updates triggered by tag change events
- [ ] Renderer reads colors from indexed color system (existing)
- [ ] Debug logs show effect applications

### 5) Time System Integration

**Single source of truth for time: Time advances in multiple ways**

Time advancement modes:
1. **Real-time when not in timed events** - use this to proc tag timed effects
2. **Per round/turn during timed events** - proc tag effects per turn
3. **When moving places** - different per place, proc tag effects then too

- [~] **ALREADY EXISTS**: `src/time_system/tracker.ts` and `src/turn_manager/main.ts`
- [ ] Review time systems to find optimal hook point
- [ ] **Hook meta tag processing into action completion AND place movement**
- [ ] Call `MetaTagProcessor.processDispersingTags()` at appropriate boundaries
- [ ] Ensure both real-time (5-second intervals) and turn-based modes work
- [ ] **DEBUG**: Add time tick logging with mode and processing info using project debug standard
- [ ] Test all three time advancement modes

**Hook Investigation:**
- Find `advance_time()` or equivalent in time_system
- Find turn boundaries in turn_manager
- Hook into action pipeline after actions complete
- Hook into place movement handlers
- Call meta tag processor at these points

Acceptance:
- [ ] `FIRE!` disperses correctly in real-time mode (every 5 seconds)
- [ ] `FIRE!` disperses correctly per turn during timed events
- [ ] `FIRE!` disperses correctly when moving between places
- [ ] Meta tag processing happens at correct time boundaries
- [ ] Debug logs show time mode, tick count, and dispersing operations

### 6) Testing Infrastructure

**Dev UI button location: In module with other buttons (interface_program debug panel)**

- [~] Manual test steps already documented below
- [ ] Add developer UI button: "Add [FIRE! : 5] to Actor" 
- [ ] **Location**: `interface_program.ts` debug panel with other debug buttons
- [ ] Add debug console commands for tag manipulation
- [ ] Add visual indicators in renderer for debugging
- [ ] **Color values**: Use existing indexed color system (investigate current color system)
- [ ] Document how to run `npm run dev:logs` to see debug output

Acceptance:
- [ ] Manual test can be performed following documented steps
- [ ] Debug logs visible in `npm run dev:logs` show all tag operations
- [ ] Visual feedback matches expected behavior (bright red/yellow using indexed colors)
- [ ] Dispersing mechanics work correctly in both time modes

## Test Plan: FIRE! Tag End-to-End

### Test Scenario Overview

Use `[FIRE!]` as a simple, observable test case to validate the unified tag system:

1. **Visual feedback** - Actor color changes based on fire MAG (bright red >3, vivid yellow ≤3)
2. **Auto-dispersal** - Fire decreases by 1 MAG per turn via [DISPERSING] meta tag
3. **Time mode compatibility** - Works in both real-time and turn-based modes
4. **Debug visibility** - All operations logged to console for verification via `npm run dev:logs`

**What We're NOT Testing (Deferred):**
- Fire damage to health
- Fire spreading to adjacent tiles
- Item destruction from fire
- Complex meta tag interactions

### Manual Test Steps

#### A) Add Fire Button (Development UI)

- [ ] Add temporary button to developer UI: "Add [FIRE! : 5] to Actor"
- [ ] Button located in `interface_program` debug panel
- [ ] Clicking button adds `FIRE!` tag with 5 MAG to `actor.henry_actor`
- [ ] Tag appears in actor data with correct structure
- [ ] **DEBUG**: Console shows: `FIRE_ADDED: actor=henry_actor, tag=fire!, mag=5`

#### B) Visual Feedback in Renderer

- [ ] Renderer reads actor tags from unified interface
- [ ] When actor has `FIRE!` tag:
  - **Bright red** when MAG > 3 (intense fire)
  - **Vivid yellow** when MAG ≤ 3 (moderate fire)
  - Visual updates immediately when MAG changes
- [ ] Visuals clear when `FIRE!` tag removed
- [ ] **DEBUG**: Log to console: `FIRE_VISUAL: actor={id}, mag={mag}, color={color}`

#### C) Fire Damage Application (DEFERRED FOR FUTURE)

- [~] **SIMPLIFIED FOR THIS TEST**: Skip damage mechanics for now
- [ ] Focus on tag system working correctly first
- [ ] Fire damage will be implemented after tag system is validated

#### D) Dispersing Meta Tag

- [ ] `[FIRE!]` tag has `[DISPERSING]` meta tag applied
- [ ] At each turn end (or 5 seconds real-time):
  - `FIRE!` MAG decreases by 1
  - When MAG reaches 0, tag is removed
  - Visual intensity decreases accordingly
- [ ] **DEBUG**: Log to console: `FIRE_DISPERSING: tag={name}, mag={old_mag}→{new_mag}, actor={actor_id}`
- [ ] Can observe fire dying out over ~5 turns (starting from MAG 5)
- [ ] Visual changes from bright red to vivid yellow at MAG 3 threshold

#### E) Multiple Time Modes

**Real-time Mode (Non-Paused):**
- [ ] Time ticks every 5 seconds
- [ ] `FIRE!` disperses every 5 seconds
- [ ] **DEBUG**: Log to console: `TIME_TICK: mode=realtime, tick_count={n}, processing_dispersing_tags`

**Turn-based Mode (Paused / Timed Event):**
- [ ] Time ticks only when player takes an action
- [ ] `FIRE!` disperses per turn
- [ ] **DEBUG**: Log to console: `TIME_TICK: mode=turn, action={action_type}, processing_dispersing_tags`
- [ ] Test with movement actions to verify timing

### How to Verify with `npm run dev:logs`

Run `npm run dev:logs` and look for these debug messages in order:

1. **When adding fire:**
   ```
   FIRE_ADDED: actor=henry_actor, tag=fire!, mag=5
   FIRE_VISUAL: actor=henry_actor, mag=5, color=bright_red
   ```

2. **Each turn (turn-based mode):**
   ```
   TIME_TICK: mode=turn, action=MOVE, processing_dispersing_tags
   FIRE_DISPERSING: tag=fire!, mag=5→4, actor=henry_actor
   FIRE_VISUAL: actor=henry_actor, mag=4, color=bright_red
   ```

3. **At MAG 3 threshold (turn 3):**
   ```
   TIME_TICK: mode=turn, action=ATTACK, processing_dispersing_tags
   FIRE_DISPERSING: tag=fire!, mag=3→2, actor=henry_actor, color=vivid_yellow
   FIRE_VISUAL: actor=henry_actor, mag=2, color=vivid_yellow
   ```

4. **When fire goes out:**
   ```
   FIRE_DISPERSING: tag=fire!, mag=1→0, actor=henry_actor
   FIRE_REMOVED: fire! removed from actor=henry_actor
   FIRE_VISUAL: actor=henry_actor, mag=0, color=normal
   ```

If you see these logs in order, the tag system is working correctly!

### Expected Outcome Sequence

Starting state: Actor has `[FIRE! : 5]` (test both visual states)

| Time Unit | Fire MAG | Visual State  | Debug Log Output | Log Message |
|-----------|----------|---------------|------------------|-------------|
| Start     | 5        | Bright red    | `FIRE_VISUAL: actor=henry_actor, mag=5, color=bright_red` | "You are on fire! [FIRE! : 5]" |
| Turn 1    | 5→4      | Bright red    | `FIRE_DISPERSING: fire! mag 5→4` | "Fire disperses: [FIRE! : 4]" |
| Turn 2    | 4→3      | Bright red    | `FIRE_DISPERSING: fire! mag 4→3` | "Fire disperses: [FIRE! : 3]" |
| Turn 3    | 3→2      | Vivid yellow  | `FIRE_DISPERSING: fire! mag 3→2, color=vivid_yellow` | "Fire disperses: [FIRE! : 2]" |
| Turn 4    | 2→1      | Vivid yellow  | `FIRE_DISPERSING: fire! mag 2→1` | "Fire disperses: [FIRE! : 1]" |
| Turn 5    | 1→0      | Normal        | `FIRE_REMOVED: fire! removed from actor` | "Fire goes out." |

**Note**: Heavy fire (>3) shows bright red, moderate fire (≤3) shows vivid yellow

## Implementation Status Summary

### ALREADY BUILT (~) - Do Not Re-implement
- `TagInstance`, `TagRule`, `TagAction`, `TaggedItem` interfaces (`src/tag_system/registry.ts`)
- `TagRegistry` class with meta tag methods (`hasMetaTag()`, `getByMetaTag()`)
- Tag definitions database with meta tags and scopes (`tag_definitions.jsonc`)
- Time system for tracking game time (`src/time_system/tracker.ts`)
- NPC tags array structure (will need format migration)
- Item tags already use `TagInstance` format

### TO BUILD - New Implementation Required
- `TaggedEntity` interface for standardized operations
- `MetaTagProcessor` class for applying DISPERSING mechanics
- Entity migration (tiles: string[] → TagInstance[], NPCs: format update)
- Integration hooks between meta tag processor and time system
- Visual feedback system in renderer reading unified tag interface
- Developer UI button for testing
- Comprehensive debug logging throughout system

### DEFERRED - Future Work Beyond This Plan
- Fire damage mechanics
- Fire spreading to adjacent entities
- Item BROKEN condition from fire
- Tile temperature changes
- Complex meta tags beyond DISPERSING  
- Disease and other status tag mechanics

### TESTING STRATEGY
All implementation must be testable via `npm run dev:logs` with visible debug output at each step:
1. Button click → `FIRE_ADDED: actor=henry_actor, mag=5`
2. Turn end → `TIME_TICK: mode=turn, processing_dispersing_tags`
3. Dispersing → `FIRE_DISPERSING: mag 5→4`
4. Visual update → `FIRE_VISUAL: mag=4, color=bright_red`

---

## Rollout Strategy

**Note**: Core tag infrastructure already exists from previous work. This plan focuses on unification and testing.

- **Phase 1**: Assessment + Unification (1 day)
  - Survey existing tag system implementation
  - Review existing interfaces (TagInstance, TagRule, TagRegistry)
  - Identify gaps between current state and unified vision
  - Add `TaggedEntity` interface to existing registry
  - Verify FIRE! tag definition exists

- **Phase 2**: Meta Tag Processing (2 days)
  - Create `MetaTagProcessor` class
  - Implement DISPERSING meta tag mechanic
  - Hook into turn_manager or time_system
  - Add comprehensive debug logging
  - Manual test: watch FIRE! disperse in real-time

- **Phase 3**: Entity Migration (1 day)
  - Convert tiles: `string[]` → `TagInstance[]`
  - Convert characters/NPCs to unified format
  - Create migration script for existing saves
  - Add debug logging for migrations
  - Test backward compatibility

- **Phase 4**: Visual Integration + Testing (1 day)
  - Renderer reads tags via unified interface
  - Add FIRE! visual states (bright red >3, vivid yellow ≤3)
  - Add developer UI button: "Add [FIRE! : 5] to Actor"
  - Manual testing with `npm run dev:logs`
  - Document debug output interpretation

- **Phase 5**: Validation (0.5 days)
  - Test both time modes (real-time and turn-based)
  - Verify dispersing works correctly
  - Document any edge cases or limitations

## Non-Goals (for this plan)

- Fire damage mechanics (deferred for future work)
- Fire spreading to adjacent tiles/entities (deferred)
- Item BROKEN condition from fire (deferred)
- Tile temperature changes (deferred)
- Full tag definitions for all existing tags (focus on FIRE! proof of concept)
- Complex meta tag chains beyond DISPERSING
- Performance optimization for large tag counts
- Network synchronization of tag state
- Save state versioning beyond current migration

---

## User Questions - Implementation Clarifications (All Addressed)

### 1. TagInstance field name: `stacks` → `mag`
**RESOLVED**: Rename existing `stacks` field to `mag` throughout codebase
- Action: Update `TagInstance` interface, all tag operations, and all references
- Rationale: Reflects that tag magnitude can have different behaviors at different levels
- Done in: Core Infrastructure section

### 2. FIRE! effects: Only visual + dispersing, not full effects
**RESOLVED**: Implement ONLY visual + dispersing for this phase
- Discovery: FIRE! definition exists in tag_definitions.jsonc (lines 175-190) with full effects
- Action: IGNORE existing damage/spreading/temperature effects for now
- Implement: Visual color changes + dispersing meta tag only
- Deferred: All other effects for future work
- Done in: Meta Tag System section

### 3. Time system hook: Multiple advancement modes
**RESOLVED**: Hook into all three time advancement modes
- Real-time waiting (5-second intervals when not in timed events)
- Per round/turn during timed events
- When moving between places
- Action: Call `MetaTagProcessor.processDispersingTags()` at each boundary
- Implementation in: Time System Integration section

### 4. Event system: Does not exist, must be created
**RESOLVED**: Create new EventEmitter for tag changes
- Discovery: No existing EventEmitter pattern in codebase
- Action: Create new EventEmitter class, emit events on tag operations
- Renderer will listen for `TagChangeEvent` to update visuals
- Done in: Tag Effect System Integration section

### 5. MetaTagProcessor location: NEW FILE
**RESOLVED**: `src/tag_system/meta_processor.ts`
- Action: Create new file with `MetaTagProcessor` class
- Keep existing registry files, extend as needed
- Delete unused old tag systems after implementation
- Done in: Meta Tag System section

### 6. Migration strategy: Direct file edits
**RESOLVED**: Edit files directly, no runtime migration
- One save slot with test data only
- Edit tile, NPC, actor, and place files directly
- No backwards compatibility needed
- Delete old format code (clean, minimal system)
- Done in: Entity Migration section

### 7. FIRE! tag definition: Already EXISTS
**RESOLVED**: Found existing FIRE! definition
- Location: `tag_definitions.jsonc` lines 175-190
- Already has `[DISPERSING]` meta tag
- Has complex effects (ignored for this phase)
- No need to add, just reference existing definition
- Done in: Core Infrastructure and Meta Tag System sections

### 8. Color values: Use existing indexed color system
**RESOLVED**: Use indexed colors, not hex/Phaser constants
- Action: Investigate current indexed color system in codebase
- Use system colors like `color_red`, `color_yellow`
- Map to "bright red" and "vivid yellow" based on MAG threshold
- Done in: Testing Infrastructure section

### Summary
All implementation questions have been clarified and documented in the plan. No conflicting ideas - all answers are consistent with the minimal, viable system approach.

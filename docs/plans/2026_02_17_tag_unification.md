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

```typescript
export interface TagInstance {
  /** Tag identifier (e.g., "fire!", "awareness", "broken") */
  name: string;
  
  /** Magnitude / stack count (default: 1) */
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

- [~] **ALREADY EXISTS**: `TagInstance`, `TagRule`, `TagAction`, `TaggedItem` interfaces in `src/tag_system/registry.ts`
- [~] **ALREADY EXISTS**: `TagRegistry` class with `hasMetaTag()` and `getByMetaTag()` methods
- [~] **ALREADY EXISTS**: `tagRegistry` singleton instance
- [ ] Review existing registry to ensure unified interface works for all entity types
- [ ] Add `TaggedEntity` interface specification to existing registry
- [ ] Update `TagRule` interface with optional `entity_effects` field
- [ ] Enhance registry to parse and store entity-specific effects from definitions

Acceptance:
- [ ] All entities (tiles, characters, items) use compatible tag structures
- [ ] `FIRE!` tag definition exists with entity-specific effects
- [ ] **DEBUG mode enabled for all tag operations**

### 2) Meta Tag System (SIMPLIFIED)

- [~] **ALREADY EXISTS**: Meta tag definitions in `tag_definitions.jsonc`
- [ ] Create `MetaTagProcessor` class for applying meta-tag mechanics
- [ ] Implement `[DISPERSING]`: auto-remove 1 MAG per turn (focus on this only)
- [~] **DEFERRED**: `[DISEASE:CR]` and other complex meta tags for future work
- [ ] Add debug logging to meta tag processing

Acceptance:
- [ ] `[FIRE!]` with `[DISPERSING]` meta tag auto-decreases over time
- [ ] Meta tag effects trigger correctly in both time modes
- [ ] Debug logs visible in `npm run dev:logs` showing dispersing mechanics

### 3) Entity Migration

- [~] **Items**: Already use `TagInstance` format (verify compatibility)
- [ ] **Tiles**: Convert `tags: string[]` to `tags: TagInstance[]`
- [ ] **Characters/NPCs**: Convert tag objects to `TagInstance` format
- [ ] Create migration script for existing save data
- [ ] Add debug logging during migration to track tag conversions

Acceptance:
- [ ] All entities load and save tags in unified format
- [ ] Legacy data migrates without loss
- [ ] Debug logs show successful tag conversions per entity type

### 4) Tag Effect System Integration (SIMPLIFIED)

- [~] **SIMPLIFIED**: Skip complex effect system for this phase
- [ ] Create basic `TagEffectApplicator` skeleton (future expansion)
- [ ] Focus on visual effects only (color changes)
- [ ] Apply character visual effects from tag definitions
- [ ] **DEFERRED**: Item damage, tile temperature for future work
- [ ] Add debug logging for any effect applications

Acceptance:
- [ ] `FIRE!` on character changes visual color (red/yellow)
- [ ] Visual updates appear in renderer
- [ ] Debug logs show effect applications

### 5) Time System Integration

- [~] **ALREADY EXISTS**: `src/time_system/tracker.ts` manages game time
- [ ] Review existing time system integration points
- [ ] Hook meta tag processing to turn transitions
- [ ] Add `processDispersingTags()` call to turn end
- [ ] **DEBUG**: Add time tick logging with mode and processing info
- [ ] Test both real-time and turn-based modes

Acceptance:
- [ ] `FIRE!` disperses correctly in real-time mode (every 5 sec)
- [ ] `FIRE!` disperses correctly per turn in paused mode
- [ ] Debug logs show time mode, tick count, and dispersing operations

### 6) Testing Infrastructure

- [ ] Create manual test checklist document
- [ ] Add developer UI button: "Add [FIRE! : 5] to Actor"
- [ ] Add debug console commands for tag manipulation
- [ ] Create test scenario with expected output sequence
- [ ] Add visual indicators in renderer for debugging
- [ ] Document how to run `npm run dev:logs` to see debug output

Acceptance:
- [ ] Manual test can be performed following documented steps
- [ ] Debug logs visible in `npm run dev:logs` show all tag operations
- [ ] Visual feedback matches expected behavior
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

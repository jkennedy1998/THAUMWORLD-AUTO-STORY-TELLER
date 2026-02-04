# Changelog

All notable changes and fixes to the THAUMWORLD AUTO STORY TELLER project.

## [Unreleased] - February 2, 2026

### Continuity Fixes - Critical

#### Fixed
- **Working Memory System** - Events now correctly recorded to working memory
  - Fixed correlation_id vs event_id mismatch in state_applier
  - State applier now checks for active timed events and uses correct lookup key
  - File: `src/state_applier/main.ts`

- **Conversation Threading** - Single conversation ID per session/region
  - Removed primary_npc_id from conversation ID generation
  - All participants in same session/region now share one conversation thread
  - File: `src/interpreter_ai/main.ts`

- **Message Deduplication** - Eliminated ~40% message duplication
  - Implemented atomic file locking in outbox_store
  - Centralized deduplication logic
  - File: `src/engine/outbox_store.ts`

#### Changed
- **Removed Duplicate Functions** - All services now use centralized storage
  - Removed custom update_outbox_message from: data_broker, interpreter_ai, renderer_ai, rules_lawyer, roller
  - All services now import from `src/engine/outbox_store.ts`
  - Ensures consistent file locking and error handling

### NPC Data Fixes

#### Fixed
- **Gunther Location Data** - Added missing location field
  - Gunther now has proper coordinates (region_tile 0,0)
  - Standardized NPC data structure to match other NPCs
  - Added: kind, size_mag, sex, age, languages, lore, senses, stats, profs, movement, location, resources
  - File: `local_data/data_slot_1/npcs/gunther.jsonc`

#### Fixed
- **NPC Response Duplication** - Gunther no longer responds 3 times
  - Moved responded_npcs tracking to BEFORE response generation
  - Added check to skip messages already being processed
  - File: `src/npc_ai/main.ts`

### System Improvements

#### Added
- **Memory Wipe Script** - `npm run wipe`
  - Clears working memory, conversations, NPC memories

### Place System Implementation (IN PROGRESS)

#### Phase 1: Foundation ✅ COMPLETE
- **Type Definitions** - Complete data model
  - Place, PlaceCoordinates, TileGrid types
  - PlaceConnection graph structure
  - Entity positioning (NPCs, actors, items on tiles)
  - Environment properties (lighting, terrain, cover)
  - File: `src/types/place.ts`

- **Storage System** - File-based place storage
  - Load/save places from JSONC files
  - List places by region
  - Default place management
  - Files: `src/place_storage/store.ts`

- **Utility Functions** - Place operations
  - Tile distance calculations
  - Entity positioning in places
  - Proximity detection (nearby entities)
  - Place connections and navigation
  - Entity movement between places
  - Files: `src/place_storage/utils.ts`

- **Default Places** - Generated for existing regions
  - Eden Crossroads: Square, Tavern, Grenda's Shop
  - Eden Whispering Woods: Clearing
  - Eden Stone Circle: Stone Circle
  - Eden Commons: Village Green
  - File: `scripts/create_default_places.ts`

- **Documentation** - Phase 1 complete
  - PLACE_SYSTEM_PHASE1_COMPLETE.md

#### Phase 2: Reference Resolution ✅ COMPLETE
- **Reference Resolver Updates**
  - Added `place` and `place_tile` reference types
  - `resolve_place_ref()` - Resolves `place.<region>.<place_id>`
  - `resolve_place_tile_ref()` - Resolves specific tile coordinates
  - Validates place existence and tile bounds
  - Files: `src/reference_resolver/resolver.ts`, `src/reference_resolver/types.ts`

- **Data Broker Integration**
  - Place loading in `create_missing_entities()`
  - Handles "place_not_found" errors
  - Logs missing places for manual creation
  - File: `src/data_broker/main.ts`

- **Supported Reference Formats**
  - `place.eden_crossroads.tavern_common`
  - `place_tile.eden_crossroads.tavern_common.10.15`
  - Full validation and error handling

#### Phase 3: NPC Place Awareness ✅ COMPLETE
- **NPC Location Utilities**
  - `src/npc_storage/location.ts` - 20+ place-aware functions
  - `get_npc_place_id()` - Get NPC's current place
  - `is_npc_in_place()` - Check place membership  
  - `get_distance_between_npcs()` - Calculate distance in same place
  - `migrate_npc_location_to_place()` - Migration helpers

- **NPC AI Place Filtering**
  - Updated `can_npc_perceive_player()` - Now checks place_id first
  - Distance-based perception (≤2 clear, ≤8 normal, ≤15 obscured)
  - Updated `process_communication()` - Filters NPCs by place
  - Different places = NPCs can't perceive each other
  - Debug logging for place-based filtering decisions

- **Migration Script**
  - `scripts/migrate_npcs_to_places.ts` - Bulk migration tool
  - Auto-assigns NPCs to default places by region
  - Specific mappings: Gunther→Square, Grenda→Shop
  - Detailed reporting and validation

- **Backward Compatibility**
  - Legacy NPCs without place_id still work
  - Falls back to region-based detection
  - Warning logs for unmigrated NPCs

#### Phase 4: Time, Schedules & Movement ✅ COMPLETE
- **Global Time Tracking**
  - `src/time_system/tracker.ts` - Complete game time system
  - Minutes, hours, days, months, years
  - 6-month calendar (Thawmelt through Deepwinter)
  - Time advancement and formatting functions
  - Time of day categories (dawn, morning, afternoon, dusk, evening, night)

- **NPC Schedule System**
  - `src/npc_storage/schedule_types.ts` - Schedule data model
  - `src/npc_storage/schedule_manager.ts` - Schedule execution
  - 5-6 daily activities per NPC (sleep, work, meals, social)
  - Time-based place transitions
  - Schedule overrides for emergencies/events
  - Schedule update system (job changes, lifestyle changes)

- **Movement & Travel System**
  - `src/travel/movement.ts` - Complete travel mechanics
  - Tile-level movement (walk, run, sneak, crawl speeds)
  - Place-to-place travel (validates connections)
  - Regional travel (advances time)
  - Schedule-based automatic NPC movement
  - Travel time calculations

- **Schedule Documentation**
  - `docs/SCHEDULE_SYSTEM_TODO.md` - Comprehensive expansion plans
  - Schedule templates (profession-based)
  - Dynamic schedule generation plans
  - Interruption and emergency handling
  - Schedule coordination (NPC meetings)

#### Phase 5-8: (See PLACE_SYSTEM_PLAN.md)
- Travel system
- Migration & Biomes
- Awareness & perception
- Tiles & pathfinding
- Integration & polish

### Code Quality

#### Cleaned
- **TODO Comments** - Cleared completed TODOs
  - Removed: save_actor TODO (function exists)
  - Updated: Data broker and interpreter comments to reflect working architecture
  - Created: TODO_CLEANUP_SUMMARY.md tracking 17 remaining TODOs
  - Files: `src/state_applier/main.ts`, `src/data_broker/main.ts`, `src/interpreter_ai/main.ts`
  - Resets message queues for clean testing
  - File: `scripts/wipe_memory.js`

#### Enhanced
- **NPC Memory Persistence** - Conversations now saved to NPC memory_sheet
  - Recent memories tracked with timestamps
  - Known actors list maintained per NPC
  - Files: `local_data/data_slot_1/npcs/*.jsonc`

## [Phase 7] - January 31 - February 1, 2026

### Session Analysis Results
Based on analysis of session logs from February 1, 2026:

**Working Memory:** FAILED
- Issue: correlation_id vs event_id mismatch
- Events not recorded due to lookup key mismatch
- Impact: NPCs had no context from previous actions

**Conversation Threading:** BROKEN  
- Issue: Multiple conversation IDs per interaction
- Root cause: primary_npc_id included in hash
- Impact: Context fragmentation across messages

**Message Duplication:** HIGH
- Issue: ~40% duplicate messages
- Root cause: Race conditions, inconsistent deduplication
- Impact: Cluttered logs, wasted processing

**Resolution:** All issues fixed in February 2, 2026 update

## [Phase 6] - January 30-31, 2026

### Implementation Complete
- NPC AI service operational
- Conversation management system
- Memory persistence layer
- Multi-NPC dialogue support

## [Phase 5] - January 29-30, 2026

### Implementation Complete
- State machine for actions
- Effect application system
- Working memory for context
- Turn management system

## [Phase 4] - January 28-29, 2026

### Implementation Complete
- Data broker service
- Reference resolution
- Entity creation on-demand
- Auto-correction for NPC refs

## [Phase 3] - January 27-28, 2026

### Implementation Complete
- Interpreter AI service
- Machine text parsing
- Command resolution
- Error handling

## [Phase 2] - January 26-27, 2026

### Implementation Complete
- Rules lawyer service
- Action resolution
- Effect generation
- Ruling system

## [Phase 1] - January 25-26, 2026

### Implementation Complete
- Message display fix
- Conversation threading foundation
- Message schema enhancement
- Pipeline establishment

---

## Legend

- **Added** - New features
- **Changed** - Changes to existing functionality
- **Fixed** - Bug fixes
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Security** - Security-related changes

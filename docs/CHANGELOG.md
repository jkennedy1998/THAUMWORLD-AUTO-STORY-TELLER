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

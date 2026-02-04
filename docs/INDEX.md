# Project Documentation Index

**Last Updated:** February 2, 2026

## Quick Navigation

### For AI Agents
1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System overview with diagrams
2. **[SERVICES.md](./SERVICES.md)** - All 8 services documented  
3. **[STAGES.md](./STAGES.md)** - Message flow and contracts
4. **[AI_AGENT_GUIDE.md](./AI_AGENT_GUIDE.md)** - Quick reference for AI agents

### For Developers
1. **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** - Complete developer guide
2. **[README.md](./README.md)** - Project overview and setup
3. **[MACHINE_TEXT_SYNTAX.md](./MACHINE_TEXT_SYNTAX.md)** - Syntax specification
4. **[examples/README.md](./examples/README.md)** - Code examples
5. **[TODO_CLEANUP_SUMMARY.md](./TODO_CLEANUP_SUMMARY.md)** - TODO status and cleanup record

### Recent Changes
- **[CHANGELOG.md](./CHANGELOG.md)** - Recent fixes and improvements (Feb 2026)
- **[PLACE_SYSTEM_PLAN.md](./PLACE_SYSTEM_PLAN.md)** - NEW: Place system implementation plan
- **[archive/](./archive/)** - Historical phase summaries and old documents

## Documentation Cleanup (Feb 2, 2026)

### Consolidated Files
The following files were consolidated into this index:

**Phase Summaries** → Moved to `archive/`
- PHASE1_SUMMARY.md through PHASE7_FIXES.md
- These document the historical development of the system

**Fix Documentation** → Consolidated into CHANGELOG.md
- CONTINUITY_FIXES_SUMMARY.md
- NPC_CONSISTENCY_FIX.md
- SESSION_ANALYSIS_2026-02-01.md
- CLEANUP_SUMMARY.md

**Implementation Docs** → Moved to `archive/`
- IMPLEMENTATION_PLAN.md
- IMPLEMENTATION_SUMMARY.md
- PHASE1_IMPLEMENTATION.md

### Active Core Documentation
- ARCHITECTURE.md - System design and data flow
- SERVICES.md - Service definitions and contracts
- STAGES.md - Pipeline stage definitions
- DEVELOPER_GUIDE.md - Development guide
- AI_AGENT_GUIDE.md - AI agent quick reference
- MACHINE_TEXT_SYNTAX.md - Command syntax
- EFFECTS.md - Effect system (WIP)
- TIMED_EVENTS.md - Timed event system
- ERROR_HANDLING.md - Error handling standards
- TROUBLESHOOTING.md - Common issues and solutions
- AI_PROMPTS.md - AI prompt templates

## Project Status

**Current Phase:** Phase 7 - Continuity & Polish  
**Status:** NPC AI working, continuity fixes complete, system stable

### Recent Achievements (Feb 2, 2026)
✅ Fixed working memory system (correlation_id/event_id alignment)  
✅ Fixed conversation threading (unified conversation IDs)  
✅ Fixed message deduplication (atomic file operations)  
✅ Fixed Gunther location data  
✅ Removed duplicate update_outbox_message functions  
✅ NPCs respond correctly without duplication  

See [CHANGELOG.md](./CHANGELOG.md) for full details.

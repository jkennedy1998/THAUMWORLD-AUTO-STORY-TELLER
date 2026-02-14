# Project Documentation Index

**Last Updated:** February 13, 2026

## Quick Start

New to the project? Start here:
1. **[README.md](./README.md)** - Project overview and setup
2. **[ROADMAP.md](./ROADMAP.md)** - Current development priorities and next steps
3. **[CHANGELOG.md](./CHANGELOG.md)** - Historical changes (may be stale)
4. **[guides/AI_AGENT_GUIDE.md](./guides/AI_AGENT_GUIDE.md)** - Quick reference for AI agents

---

## System Status ✅ (Feb 13, 2026)

**The core system is operational and playable!**

### Working Correctly
- ✅ **Working Memory** - Events recorded properly
- ✅ **Message Pipeline** - No duplication, proper flow
- ✅ **Conversation Threading** - Session IDs consistent
- ✅ **Place System** - NPCs check locations correctly
- ✅ **NPC Autonomy** - Wandering and decision-making working
- ✅ **Click-to-Move** - Player movement with pathfinding
- ✅ **AI Integration** - NPCs generate contextual responses
- ✅ **Communication Action System** - COMMUNICATE validated + perceived (single pipeline)
- ✅ **NPC Witness Reactions** - NPCs stop/face/join/eavesdrop based on perception

### Current Focus
1. 🟠 **Advanced NPC Interactions** - Scheduling + sequencing ([plans/2026_02_13_advanced_npc_interactions_scheduler.md](./plans/2026_02_13_advanced_npc_interactions_scheduler.md))
2. 🟠 **NPC Archetypes + Phases** - Defaults + prompting ([plans/2026_02_12_npc_archetypes_and_interaction_phases.md](./plans/2026_02_12_npc_archetypes_and_interaction_phases.md))
3. 🟠 **Region Travel** - Travel between regions ([plans/2026_02_06_region_travel_system.md](./plans/2026_02_06_region_travel_system.md))
4. 🟡 **INSPECT System** - Environmental inspection ([plans/2026_02_05_inspect_implementation_plan.md](./plans/2026_02_05_inspect_implementation_plan.md))

See **[ROADMAP.md](./ROADMAP.md)** and **[Implementation Roadmap](./plans/2026_02_06_implementation_roadmap.md)** for detailed next steps.

---

## Documentation Structure

| Folder | Contents |
|--------|----------|
| **[design/](./design/)** | System architecture, services, and design decisions |
| **[guides/](./guides/)** | Developer guides, troubleshooting, and AI references |
| **[specs/](./specs/)** | Technical specifications and system standards |
| **[plans/](./plans/)** | Active development plans |
| **[todos/](./todos/)** | Active TODO lists and task tracking |
| **[analysis/](./analysis/)** | Bug fixes, session analysis, and post-mortems |
| **[archive/](./archive/)** | Completed documentation and historical records |
| **[examples/](./examples/)** | Code examples and usage patterns |

---

## Core Documentation

### System Design ([design/](./design/))
- **[ARCHITECTURE.md](./design/ARCHITECTURE.md)** - System overview with diagrams
- **[SERVICES.md](./design/SERVICES.md)** - Service contracts (interpreter_ai is archived in this build)
- **[STAGES.md](./design/STAGES.md)** - Message flow and contracts
- **[assumptions.md](./design/assumptions.md)** - Project assumptions and constraints

### Guides ([guides/](./guides/))
- **[DEVELOPER_GUIDE.md](./guides/DEVELOPER_GUIDE.md)** - Complete developer guide
- **[AI_AGENT_GUIDE.md](./guides/AI_AGENT_GUIDE.md)** - AI agent quick reference
- **[AI_PROMPTS.md](./guides/AI_PROMPTS.md)** - Prompt templates and patterns
- **[PROJECT_SETUP_AND_LLM_CONTEXT.md](./guides/PROJECT_SETUP_AND_LLM_CONTEXT.md)** - Minimal project setup + LLM context guidance
- **[TROUBLESHOOTING.md](./guides/TROUBLESHOOTING.md)** - Common issues and solutions

### Specifications ([specs/](./specs/))
- **[EFFECTS.md](./specs/EFFECTS.md)** - Effect system specification
- **[TIMED_EVENTS.md](./specs/TIMED_EVENTS.md)** - Timed event system
- **[ERROR_HANDLING.md](./specs/ERROR_HANDLING.md)** - Error handling standards
- **[MACHINE_TEXT_SYNTAX.md](./specs/MACHINE_TEXT_SYNTAX.md)** - Command syntax specification

---

## Active Development

### High Priority ([plans/](./plans/))
- **2026_02_06_action_range_system.md** - Range validation for all actions (COMPLETE Phase 5)
- **2026_02_06_region_travel_system.md** - Region loading and travel system
- **2026_02_06_implementation_roadmap.md** - Next steps and implementation order
- **2026_02_02_place_system_plan.md** - Place system architecture (reference)

- **2026_02_13_advanced_npc_interactions_scheduler.md** - Sequencing + scheduling layer (new)
- **2026_02_13_ui_improvements_log_time_audio_shaders.md** - UI: log readability, time, SFX architecture, output texture (new)
- **2026_02_12_npc_archetypes_and_interaction_phases.md** - Archetypes + interaction phases (new)

### Medium Priority ([plans/](./plans/))
- **2026_02_05_inspect_implementation_plan.md** - INSPECT action implementation (Phases 3-7)
- **(Archived)** `2026_02_02_phased_implementation_plan.md` - Superseded roadmap
- **2026_02_02_tabletop_pacing_intent_targeting.md** - UI targeting and pacing
- **2026_02_03_place_system_visual_guide.md** - Visual place system guide

### TODOs ([todos/](./todos/))
- **2026_02_02_action_verbs_todo.md** - Remaining action verbs to implement
- **2026_02_02_schedule_system_todo.md** - Schedule system expansion plans

### Analysis ([analysis/](./analysis/))
- **2026_02_01_session_analysis_report.md** - Session analysis and findings
- **2026_02_01_phase7_critical_bug_fixes.md** - Phase 7 bug fixes
- **2026_02_02_continuity_fixes_summary.md** - Continuity fixes documentation
- **2026_02_02_npc_data_consistency_fix.md** - NPC consistency improvements
- **2026_02_09_conversation_debugging_retrospective.md** - Conversation debugging retrospective
- **2026_02_10_communication_message_display_bugfix_summary.md** - Communication message display bugfix summary
- **2026_02_12_npc_movement_dual_authority_bug.md** - NPC movement dual-authority bug notes

---

## Historical Documentation

### Archive ([archive/](./archive/))
Completed work organized by category:
- **Phase Completion Reports** - PHASE1-6 summaries and completion docs
- **Place System Phases** - PLACE_SYSTEM_PHASE1-4 completion docs
- **Progress Reports** - Status updates and milestones
- **Implementation Records** - Migration and implementation summaries
- **Cleanup Records** - Documentation and TODO cleanup summaries
- **Resolved Issues** - Fixed bugs and their solutions

See **[archive/README.md](./archive/README.md)** for complete index.

---

## Project Status

**Current Phase:** Feature Development  
**Status:** Core systems operational, adding features

### What's Working (Feb 6, 2026)
- ✅ Working memory records events correctly
- ✅ No message duplication
- ✅ Conversations thread properly
- ✅ NPCs react only to local events
- ✅ Click-to-move functional
- ✅ NPC autonomous movement
- ✅ AI generates contextual responses

### Current Focus
🟠 **Complete Place Module** - Range system, NPC movement polish  
🟠 **Region Travel** - Travel between regions  
🟡 **INSPECT System** - Environmental inspection

### Next Steps
1. Complete Place Module Phase 5
2. Implement region travel
3. Add INSPECT action system
4. Polish and optimize

---

## Finding Documentation

**Looking for...**
- **What's next?** → [ROADMAP.md](./ROADMAP.md)
- **How the system works?** → [design/ARCHITECTURE.md](./design/ARCHITECTURE.md)
- **How to develop?** → [guides/DEVELOPER_GUIDE.md](./guides/DEVELOPER_GUIDE.md)
- **Current plans?** → [plans/](./plans/) - Place module and travel system
- **What needs doing?** → [todos/](./todos/)
- **What was completed?** → [archive/](./archive/)
- **Bug fixes and analysis?** → [analysis/](./analysis/)

---

**Last Updated:** February 6, 2026

# Active Development Plans

Plans are the single source of truth for “what we’re doing next” and “what is actually implemented/tested”. The newest plan(s) win.

Keep plans small and executable. If something matters, it belongs as a checkbox item here (not in ad-hoc build logs).

## Naming

- `YYYY_MM_DD_<topic>.md`
- Example: `2026_02_05_inspect_implementation_plan.md`

## Checklist Legend

- `[ ]` not_started
- `[~]` implemented
- `[x]` tested

## Design Rules

- If plans overlap, cross-link them and declare a single source of truth.
- Move completed/superseded plans to `docs/archive/`.
- Prefer updating an existing plan over creating a new “log” file.

---

## Related Directories

- **docs/todos/** - Active TODO lists and task tracking
- **docs/archive/** - Completed, superseded, or implemented plans

---

## Recently Completed ✓

- `docs/plans/archive/2026_02_17_tag_unification.md` - ✅ COMPLETE - Base tag system with real-time updates via Event Bridge

## Current Active Plans

### Item System (Active Development)
These two plans work together. The Inventory Movement Plan is the **primary implementation guide**, while the Unification Plan provides architectural context.

- **`docs/plans/2026_02_19_inventory_movement_plan.md`** - **PRIMARY IMPLEMENTATION GUIDE**
  - Phase 1-7: Core drag-and-drop system ✅ COMPLETE
  - Phase 8: Module Gizmos Standard (close X, move #) - **NEXT UP**
  - Phase 9: NPC Character Module with trading - **IN PLANNING**
  
- `docs/plans/2026_02_14_item_system_unification.md` - **ARCHITECTURAL REFERENCE**
  - Container/item storage architecture ✅ IMPLEMENTED
  - API endpoints ✅ IMPLEMENTED  
  - **DEPRECATED:** Phase 6/7 UI modules (replaced by Phase 8-9 above)

### Other Active Plans
- `docs/plans/2026_04_27_multiplayer_connection_architecture_plan.md` - Source-of-truth plan for slot-scoped join persistence, preferred join targets by `content_ref`, direct IP remote play, and future Headscale-first remote transport growth
- `docs/plans/2026_04_29_ascii_painter_breath_group_animation_architecture_plan.md` - Source-of-truth plan for breath-driven painter animation, time-aware groups, content states, group location keys, and the reshaped groups/timeline authoring UI
- `docs/plans/2026_04_24_camera_target_unification_plan.md` - Engine interaction architecture plus renderer contract convergence for painter-grade interaction flow and game-grade render contracts
- `docs/plans/2026_04_18_ascii_painter_group_architecture_plan.md` - Source-of-truth architecture for replacing painter Z-slice layers with stable authored groups
- `docs/plans/2026_04_15_shared_controls_module_plan.md` - Shared persistent rebinding system for game and painter controls
- `docs/plans/2026_04_15_auto_input_debugging_plan.md` - Breath-relative scripted auto-input harness for repeatable gameplay debugging
- `docs/plans/2026_04_12_input_host_runtime_plan.md` - Platform input host + shared multiplayer-ready input runtime
- `docs/plans/2026_04_12_breath_scheduler_action_busy_plan.md` - Canonical breath scheduler, general busy cooldowns, input-before-physics timing
- `docs/plans/2026_03_23_action_pipeline_refinement_plan.md` - Breath-driven action economy + timed-event movement integration for current verbs
- `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md` - Breath/turn-driven NPC communication scheduling and reply ownership
- `docs/plans/2026_02_25_ascii_painter_and_logging_plan.md` - Shared renderer + ASCII painter mode + logging reliability
- `docs/plans/2026_02_17_advanced_tags.md` - Advanced tag features (fire damage, spreading, diseases, etc.)
- `docs/plans/2026_02_13_ui_improvements_log_time_audio_shaders.md`
- `docs/plans/2026_02_12_npc_archetypes_and_interaction_phases.md`
- `docs/plans/2026_02_06_action_range_system.md`
- `docs/plans/2026_02_05_inspect_implementation_plan.md`
- `docs/plans/2026_02_06_region_travel_system.md`
- `docs/plans/2026_02_06_implementation_roadmap.md`

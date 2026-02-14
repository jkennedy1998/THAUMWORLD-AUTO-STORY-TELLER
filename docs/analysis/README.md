# Analysis Notes (Preserved)

This folder holds short, dated writeups that explain *why* something was changed: root-cause analysis, debugging timelines, and fix retrospectives.

These notes are intentionally preserved even when stale.

## What This Folder Is (and Is Not)

- **Is:** post-mortems, “what broke + why”, debugging discoveries, fix summaries.
- **Is not:** an active roadmap. For active work, use `docs/plans/` and `docs/todos/`.

## Naming Convention

Match the plan docs style so these sort cleanly:

- `YYYY_MM_DD_<topic>_<type>.md`
- Examples: `2026_02_09_conversation_debugging_retrospective.md`, `2026_02_02_continuity_fixes_summary.md`

Keep titles specific and problem-shaped (what failed / what was fixed), not generic (“notes”, “misc”).

## Structure (Minimal, Repeatable)

Each file should start with:

- `# <Title>`
- `Date:` (ISO or written date)
- `Status:` `Retrospective` | `Complete` | `Reference`
- `Scope:` one sentence

Then keep it tight:

- `Problem` (symptoms)
- `Root Cause` (actual failure)
- `Fix` (what changed + where)
- `Follow-ups` (if any; point to a plan)

## Index (Stale but Useful)

- `docs/analysis/2026_02_01_session_analysis_report.md`
- `docs/analysis/2026_02_01_phase7_critical_bug_fixes.md`
- `docs/analysis/2026_02_02_continuity_fixes_summary.md`
- `docs/analysis/2026_02_02_npc_data_consistency_fix.md`
- `docs/analysis/2026_02_09_conversation_debugging_retrospective.md`
- `docs/analysis/2026_02_10_communication_message_display_bugfix_summary.md`
- `docs/analysis/2026_02_12_npc_movement_dual_authority_bug.md`

Related:
- `docs/plans/` (active intent)
- `docs/archive/` (completed/superseded plans)

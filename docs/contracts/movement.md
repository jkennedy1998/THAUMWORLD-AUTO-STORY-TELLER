# Movement Contract

This document defines how movement decisions and movement visuals are split between backend and renderer.

## Ownership

| Concern | Owner | Source of truth | Notes |
|--------|-------|------------------|------|
| "Should the NPC wander?" | Backend (npc_ai) | `src/npc_ai/movement_loop.ts` / goal selector | Backend decides goals and emits commands |
| "Where is the NPC drawn?" | Renderer | `src/mono_ui/modules/place_module.ts` | Renderer animates and draws the place |
| Step execution | Renderer | `src/mono_ui/modules/movement_command_handler.ts` | Consumes movement commands |
| Facing (visual) | Renderer | `NPC_FACE` + local follow rules | Renderer updates facing based on target movement |

## Command Channel

Backend -> Renderer uses `movement_command` messages in `outbox.jsonc`.

Renderer must:
- execute commands in order,
- be robust to stale place snapshots,
- keep a stable tracker for positions and conversation visual status.

## Conversation Facing Rule

When an NPC is visually in conversation (`NPC_STATUS: busy`), the renderer keeps them facing their conversation target as that target moves.

This is a renderer-side rule to avoid spamming backend `NPC_FACE` commands on every movement step.

## Action-System MOVE (No Roll By Default)

The action-system `MOVE` intent is treated as deterministic by default (no outcome roll).

If a future terrain/tile tag (e.g. `slippery`) should introduce a check, the pipeline can opt-in
by setting either:
- `intent.parameters.difficulty` (number)
- `intent.parameters.requires_roll = true`

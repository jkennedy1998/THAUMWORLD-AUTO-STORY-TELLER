# Conversation Contract

This document defines what a "conversation" is, who owns it, and how it is synced to the renderer.

## Definitions

- Conversation (logic): backend state used for timeouts, targets, and goal restoration.
- Engagement (attention): backend state used for "is paying attention" timeouts and bystander/participant tracking.
- Conversation visual state: renderer-facing boolean used for debug visuals and continuous facing.

## Ownership / Source Of Truth

| Concern | Owner | Source of truth | Notes |
|--------|-------|------------------|------|
| Conversation logic | Backend (npc_ai) | `src/npc_ai/conversation_state.ts` | In-memory map; ends by timeout/farewell/forced end |
| Witness reactions | Backend (npc_ai) | `src/npc_ai/witness_handler.ts` | Starts/extends/ends conversations based on perception events |
| Engagement tracking | Backend (npc_ai) | `src/npc_ai/engagement_service.ts` | In-memory; participant/bystander + attention spans |
| Conversation visuals | Renderer | `NPC_STATUS` events -> renderer map | Renderer cannot reliably read backend memory |

## Visual Sync Contract (Renderer)

Backend emits `NPC_STATUS` commands:
- `status: "busy"` means "this NPC is visually in conversation".
- `status: "present"` means "not in conversation".

Renderer stores this in a stable per-NPC map (do not trust place snapshot status on refresh).

Debug overlay:
- Toggle with `\\`.
- `o` (dim) when not busy.
- `O` (bright) when busy.

## Conversation Exit Rules

Conversation/engagement must end when:
- The player says farewell ("bye", "goodbye", etc.) to the NPC.
- The player leaves the place (travel between places).
- Timeout occurs (no activity for the configured window).

Implementation:
- Farewell detection is handled in `src/npc_ai/witness_handler.ts`.
- Leaving a place ends any conversations involving that actor via `src/travel/movement.ts`.

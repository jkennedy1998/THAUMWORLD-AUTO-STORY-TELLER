# Message Bus Contract (Outbox/Inbox)

This project uses file-backed message passing via `outbox.jsonc` and `inbox.jsonc`.

## Canonical Message Envelope

Every entry in `outbox.jsonc.messages[]` is a JSON object with these fields:

| Field | Type | Meaning |
|------|------|---------|
| `id` | string | Stable unique id (used for dedupe/processing) |
| `type` | string | High-level message type (example: `movement_command`) |
| `stage` | string | Routing bucket (example: `npc_movement`, `interpreter_ai` (legacy), `applied_COMMUNICATE`) |
| `status` | string | Lifecycle state (`sent`, `processing`, `done`, ...) |
| `sender` | string | Component name or entity ref |
| `recipient` | string | Component name (example: `renderer`) |
| `created_at` | string | ISO timestamp |
| `content` | string | JSON string payload (stringified object) |
| `meta` | object? | Optional flags (ex: `movement_command: true`, `npc_processed: true`) |

Notes:
- The payload is typically stored as a string in `content` and must be parsed by the consumer.
- Consumers should be robust to unknown fields and older payload shapes.

## Movement Command Messages

Movement commands are carried as messages with:
- `type: "movement_command"` OR `meta.movement_command === true`
- `content` is a JSON string with a `command` field.

Payload shape (inside `content`):

| Field | Type | Meaning |
|------|------|---------|
| `id` | string | Command id |
| `command` | object | The movement command |
| `sender` | string | Usually `npc_ai` |
| `recipient` | string | Usually `renderer` |
| `created_at` | string | ISO timestamp |

### Supported Command Types (Renderer)

| Command | Required Fields | Purpose |
|--------|------------------|---------|
| `NPC_STOP` | `npc_ref` | Stop movement |
| `NPC_MOVE` | `npc_ref`, `target_position` | Move toward a tile (`path` optional) |
| `NPC_WANDER` | `npc_ref` | Start wandering (`intensity`/`range` optional) |
| `NPC_FACE` | `npc_ref` | Face a position/entity/direction (`target`/`target_entity`/`direction`) |
| `NPC_STATUS` | `npc_ref`, `status` | Visual/status sync (ex: `busy`/`present`) |
| `UI_HIGHLIGHT` | ... | (Optional) UI effect hooks |
| `UI_TARGET` | ... | (Optional) UI effect hooks |
| `UI_SENSE_BROADCAST` | `npc_ref`, `verb` | Spawn sense broadcast particles (`subtype` optional) |

If you add a new command type:
- Update the TS type definition (`src/shared/movement_commands.ts`).
- Update the sender (`src/npc_ai/movement_command_sender.ts`).
- Update the renderer handler (`src/mono_ui/modules/movement_command_handler.ts`).

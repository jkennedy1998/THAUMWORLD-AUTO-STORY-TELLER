# Data Model and Databases

Date: 2026-03-10

This repo uses "definitions + deltas" (defs+deltas): persisted world state stays lean, and anything derivable (names, display glyphs, effective tags) is resolved at runtime from definitions.

## Data Slots

Runtime game data lives under `local_data/data_slot_<N>/`.

- `local_data/data_slot_1/actors/` actor instances
- `local_data/data_slot_1/places/` place instances (including tile grids)
- `local_data/data_slot_1/npcs/` npc instances
- `local_data/data_slot_1/world/` world/region state
- `local_data/data_slot_1/logs/` structured logs (see `AGENTS.md`)

Templates/defaults live under `local_data/data_slot_default/`.

## Item Definitions vs Item Instances

Definitions (static content):

- Primary: `local_data/items/**.jsonc`
- Slot-local overrides can also exist under `local_data/data_slot_<N>/items/`

Instances (dynamic state):

- Persisted inline on actors/places as "inline items".
- Inline items reference a definition by `def_id` and persist only instance deltas (qty/contents/custom tag instances).

Resolution:

- Server-side: `src/item_storage/resolve.ts` (`resolve_inline_item`) produces `effective_tags`, `display_char`, `display_color`, etc.
- API response-time augmentation may embed derived fields for UI compatibility, but these are not persisted.

Hygiene (defs+deltas enforcement):

- Sanitizer: `src/shared/defs_deltas_sanitize.ts`
- Save-time stripping is wired into actor/place save paths.
- Tools:
  - `npm run migrate:sanitize_defs_deltas:slot1`
  - `npm run check:defs_deltas_clean:slot1`

Containers:

- "Container items" are items tagged `CONTAINER`.
- Their contents live in the inline instance `contents` tree.
- UI opens them by tag (do not rely on legacy `container_data`).

## Tile Definitions vs Place Tile Instances

Tile definitions (static content):

- `local_data/shared/tiles/default_tiles.jsonc`
- `local_data/tiles/**.jsonc` (authored tiles used by places)

Place tile instances (dynamic state):

- Stored on the Place:
  - `tiles_z0` for world z=0
  - `tiles` for world z=1
- Persist only the minimal instance fields (`kind` + explicit deltas). Derived tags/display are resolved at runtime.

Semantics (current "zoo" rules):

- Movement blocking: `OCCUPIES` blocks movement
- Vision blocking: `COVER` blocks LOS

## Logs

Primary logs live under:

`local_data/data_slot_<N>/logs/YYYY-MM-DD/`

Use `latest.log` in that directory to find the active session log.

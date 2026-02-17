# Item System Unification Plan (Containers, Ownership, UI)

**Date:** 2026-02-14
**Status:** ACTIVE

Checkbox legend:
- `[ ]` not_started
- `[~]` implemented
- `[x]` tested

## Goal

Unify items into one consistent, tabletop-friendly system where:

- Every targetable thing is one of: `npc.*`, `item.*`, `tile.*`.
- Items exist as definitions + instances.
- Items always live inside a container owned by an `npc`, an `item` (a container item), or a `tile`.
- Actors/NPCs carry items either equipped (body/hand slots) or inside containers (default small sack).
- Ownership exists so shopkeepers can sell items they own across multiple containers.
- UI supports inspecting, transferring, equipping, and using items in a way that feels great.

Related plans:
- `docs/plans/2026_02_05_inspect_implementation_plan.md`
- `docs/plans/2026_02_13_ui_improvements_log_time_audio_shaders.md`

## Current Problems

- Item references drift (`item.<id>` vs `item_<id>`), and there is no canonical item loader in `src/`.
- Inventories are inconsistent (actors: `inventory: []`; tests sometimes use maps; NPCs embed item-like objects inline).
- Containers are not first-class; "inventory" is just a list, which blocks trading/loot/ownership workflows.
- INSPECT for items/characters is placeholder because we can’t reliably resolve item state.

## Design Rules

- Ground truth comes from code + data, not the renderer.
- Items shown to the player must be factual:
  - Renderer narration can only restate what the item/inspect systems provide.
- Default reference format for item definitions: `item.<def_id>`.
- Default reference format for item instances: `itemi.<instance_id>` (distinct from defs).
- Containers are addressable and queryable.

## Canonical Data Model

### A) Item Definition (static)

Stored in: `local_data/data_slot_<n>/items/<def_id>.jsonc`

Fields (existing + small additions allowed):
- `id`, `name`, `description`
- `weight`, `weight_mag`, `mag`, `size_mag`, `hardness_mag`, `conductivity_mag`
- `tags`: array of `{ name, mag, ... }`
- Optional: `stackable` (default true if consumable/currency)
- Optional: `container`: `{ capacity_weight?: number, capacity_slots?: number }` (only when item has CONTAINER tag)

### B) Item Instance (stateful)

Stored in: `local_data/data_slot_<n>/item_instances/<instance_id>.jsonc`

Fields:
- `id`: unique id (opaque)
- `def_id`: item definition id
- `qty`: integer (>= 1)
- `condition`: `pristine|good|worn|damaged|broken` (optional)
- `tags_override`: optional TagInstance[] (rare)
- `container_id`: where it currently is (see below)
- `owner_ref`: `npc.*|actor.*|system` (ownership for trading)

Notes:
- Stackable items use `qty` on an instance; non-stackable items are `qty=1`.
- Container items are always item instances (you need a unique container identity).

### C) Container

Stored in: `local_data/data_slot_<n>/containers/<container_id>.jsonc`

Container identity:
- `container.actor.<actor_id>.<name>` (ex: `container.actor.henry_actor.sack_default`)
- `container.npc.<npc_id>.<name>`
- `container.tile.<place_id>.<x>.<y>.<name>` (ground pile, chest-on-tile, etc.)
- `container.itemi.<instance_id>` (container items like sacks, safe, wallet)

Container fields:
- `id`
- `kind`: `actor|npc|tile|item`
- `owner_ref`: who owns the container’s contents for trading (often same as container controller)
- `capacity`:
  - `max_weight` (optional)
  - `max_slots` (optional)
- `contents`: array of `{ item_instance_id }`

Rules:
- Items are always in exactly one container.
- Tiles represent “ground containers” per tile position.
- Actors/NPCs can have multiple containers.

### D) Equipment Slots

Equipment is modeled as containers too:
- `container.actor.<actor_id>.hand_main`
- `container.actor.<actor_id>.hand_off`
- `container.actor.<actor_id>.body_<SLOT>`

Equipping = moving an item instance into an equipment container.

## Work Items

### 1) Canonical Reference + Loader Layer

- [ ] Create `src/item_storage/store.ts`:
  - `normalize_item_def_ref(ref: string): string` (accept `item.<id>`, `item_<id>`, `<id>`)
  - `load_item_def(slot, def_id)`
  - `save_item_def(slot, def_id, def)`
  - `ensure_item_def(slot, def_id, representative_if_missing)`
- [ ] Create `src/item_instances/store.ts`:
  - `create_item_instance(slot, def_id, qty, owner_ref)`
  - `load_item_instance(slot, instance_id)`
  - `save_item_instance(slot, instance)`
  - `delete_item_instance(slot, instance_id)` (only when empty/consumed)
- [ ] Create `src/container_storage/store.ts`:
  - `ensure_container(slot, container_id, defaults)`
  - `load_container(slot, container_id)`
  - `save_container(slot, container)`
  - `list_containers_for_owner(slot, owner_ref)`
  - `get_container_contents(slot, container_id)`

Acceptance:
- [ ] All item reads go through loaders (no direct ad-hoc JSON reads).
- [ ] A missing def returns representative (for legacy inline NPC inventory) without crashing.

### 2) Migration: Legacy Inventory -> Containers

- [ ] Create a one-shot migrator script `src/tools/migrate_inventory_to_containers.ts`:
  - Actors:
    - Create default container item instance `small_sack` (new def) if missing.
    - Move existing `inventory` entries into `container.itemi.<sack_instance_id>`.
  - NPCs:
    - Convert inline inventory objects to item defs + instances:
      - If `id` exists and def file missing, create representative def in slot.
      - Create instances owned by the NPC.
    - Create `wallet` container item instance with coin instances if needed.
- [ ] Add `coin` item definition (stackable).

Acceptance:
- [ ] After migration, `inventory` arrays are empty or ignored in favor of containers.
- [ ] No data loss: total counts match pre-migration.

### 3) Container Operations (Game Plumbing)

- [ ] Implement container transfer primitives (pure functions + storage writes):
  - `transfer_item_instance(slot, item_instance_id, from_container_id, to_container_id)`
  - `split_stack(slot, item_instance_id, qty)`
  - `merge_stacks(slot, to_container_id)`
  - Capacity enforcement (weight + slots)
- [ ] Update state applier to understand container-based inventory changes (new effect types):
  - `SYSTEM.TRANSFER_ITEM_INSTANCE`
  - `SYSTEM.SPLIT_STACK`
  - `SYSTEM.MERGE_STACKS`

Acceptance:
- [ ] Transfers are atomic (either fully applied or rejected).
- [ ] Capacity rules enforced and produce clear failure reasons.

### 4) Equip/Unequip as Container Moves

- [ ] Define canonical equipment container ids for actors/NPCs.
- [ ] Implement equip rules (lightweight for now):
  - item tags decide allowed slots (ex: `WEAPON` -> hands)
  - default deny if unknown
- [ ] Add effects:
  - `SYSTEM.EQUIP_ITEM`
  - `SYSTEM.UNEQUIP_ITEM`

Acceptance:
- [ ] Equipping shows up in the UI module and affects tool validation (hands now contain the equipped instance).

### 5) Targeting + Inspect Integration

- [ ] INSPECT item target uses item instance + def:
  - show name/shape at `vague`, show description/tags at `clear`.
- [ ] INSPECT npc target can optionally include visible equipped items and top-level containers (not contents unless clear).
- [ ] Ensure renderer INSPECT prompt only uses `inspect_result`.

Acceptance:
- [ ] Inspecting a ground item shows accurate name/desc based on clarity.

### 6) UI: Container Transfer Module

- [ ] Add `inventory_transfer_module`:
  - Two-pane view: left container contents, right container contents.
  - Actions: move 1, move all, split stack, merge.
  - Requires explicit selection; shows capacity bars.
  - Uses new backend endpoints (below).
- [ ] Add SFX hooks:
  - transfer success: `ui_release`
  - transfer fail: new `ui_error` sound id (placeholder)

Acceptance:
- [ ] Player can move items between sack <-> ground <-> NPC (when allowed).

### 7) UI: Body Slots + Hands Module

- [ ] Add `equipment_module`:
  - Displays actor’s body slots + both hands.
  - Selecting a slot selects a container (for transfer module).
  - Equip/unequip actions.

Acceptance:
- [ ] Player can equip an item to hand and see it reflected immediately.

### 8) Backend API / Commands

- [ ] Add endpoints (interface_program HTTP server):
  - `GET /api/containers?owner_ref=actor.henry_actor`
  - `GET /api/container?id=<container_id>`
  - `POST /api/transfer` (move/split/merge)
  - `POST /api/equip` / `POST /api/unequip`
- [ ] Permissions:
  - Actor can always manage own containers.
  - Trading requires owner rules (shopkeeper items sellable; theft later).

Acceptance:
- [ ] UI modules work without direct disk reads.

### 9) Shop Ownership Groundwork

- [ ] Define ownership rule:
  - Each item instance has `owner_ref`.
  - “Sellable inventory” for an NPC is any item instance with `owner_ref === npc.<id>` and located in a container within the same place (or marked as remote).
- [ ] Add query: `list_sellable_items(npc_ref, place_id)`.

Acceptance:
- [ ] Grenda can “own” items in multiple containers (wallet + safe + shelves) and UI can list them.

## Rollout Strategy

- Phase 1: loaders + instances + containers + migration, no UI yet.
- Phase 2: transfer UI + equipment UI, minimal actions.
- Phase 3: shop ownership + trading loop (coin + price fields).

## Non-Goals (for this plan)

- Full economy balancing.
- Crime/stealing rules.
- Nested containers-of-containers with complex recursion limits (we’ll support simple nesting first).

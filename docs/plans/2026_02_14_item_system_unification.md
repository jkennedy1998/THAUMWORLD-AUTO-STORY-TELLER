# Item System Unification Plan (Containers, Ownership, UI)

**Date:** 2026-02-14
**Status:** ACTIVE

Checkbox legend:
- `[ ]` not_started
- `[~]` implemented
- `[x]` tested

## Goal

Unify items into one consistent, tabletop-friendly system where:

- Every targetable thing is one of: `actor.<id>`, `npc.<id>`, `item.<id>`, `tile.<id>` (unified format).
- Items exist as definitions + instances using TagInstance system (see completed tag unification plan).
- Items always live inside a container owned by an `npc`, an `item` (container items), or (future) a `tile`.
- Actors/NPCs carry items either equipped (body/hand slots) or inside containers (default small sack).
- Ownership exists so shopkeepers can sell items they own across multiple containers.
- UI supports inspecting, transferring, equipping, and using items in a way that feels great.

**Tag System Integration:** This plan builds on the completed tag system (see `docs/plans/archive/2026_02_17_tag_unification.md`). Items use TagInstance for stateful properties (condition, enchantments, effects).

Related plans:
- `docs/plans/2026_02_05_inspect_implementation_plan.md`
- `docs/plans/2026_02_13_ui_improvements_log_time_audio_shaders.md`

## Current Problems

- Item references drift (`item.<id>` vs `item_<id>`), and there is no canonical item loader in `src/`.
- Inventories are inconsistent (actors: `inventory: []`; tests sometimes use maps; NPCs embed item-like objects inline).
- Containers are not first-class; "inventory" is just a list, which blocks trading/loot/ownership workflows.
- INSPECT for items/characters is placeholder because we can't reliably resolve item state.

## Design Rules

- Ground truth comes from code + data, not the renderer.
- Items shown to the player must be factual:
  - Renderer narration can only restate what the item/inspect systems provide.
- **Unified Reference Format**: All entities use `type.id` format (no underscores, no abbreviations):
  - Item definitions: `item.<def_id>` (e.g., `item.iron_sword`)
  - Item instances: `item.<instance_id>` (e.g., `item.abc-123-def`)
  - NPCs: `npc.<npc_id>` (e.g., `npc.grenda`)
  - Actors: `actor.<actor_id>` (e.g., `actor.henry`)
  - Tiles: `tile.<tile_id>` (future implementation)
  - Containers: `container.<container_id>` (see Container Identity below)
- Items use TagInstance system for stateful properties (tags array with name, mag, meta).
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
- `tags`: TagInstance[] (stateful tags: [DAMAGED], [ENCHANTED:fire], [POISONED], etc.)
- `container_id`: where it currently is (see below)
- `owner_ref`: `npc.<id>|actor.<id>|system` (ownership for trading)

Notes:
- Stackable items use `qty` on an instance; non-stackable items are `qty=1`.
- Container items are always item instances (you need a unique container identity).

### C) Container

Stored in: `local_data/data_slot_<n>/containers/<container_id>.jsonc`

Container identity (unified format):
- `container.<actor_id>.<name>` (ex: `container.henry.sack_default`)
- `container.<npc_id>.<name>` (ex: `container.grenda.wallet`)
- `container.<item_instance_id>` (container items like sacks, safe, wallet - ex: `container.abc-123-def`)
- **Future:** `container.<place_id>.<x>.<y>.<name>` (ground piles when tile system implemented)

Container fields:
- `id`
- `kind`: `actor|npc|item`
- `owner_ref`: who owns the container's contents for trading/law enforcement (often same as container controller)
- `capacity`:
  - `max_weight` (optional)
  - `max_slots` (optional)
- `contents`: array of `{ item_instance_id }`
- `tags`: TagInstance[] (optional, for container properties like [LOCKED], [TRAPPED])

Rules:
- Items are always in exactly one container.
- Items can BE containers (recursive nesting limited to reasonable depth).
- Actors/NPCs can have multiple containers.
- **Phase 1:** Start with item containers only (items containing other items). Tile containers deferred.

### D) Equipment Slots (Body Slots)

Equipment slots are containers defined by the actor's body type. For "naked ape" body type:
- `container.<actor_id>.hand_left`
- `container.<actor_id>.hand_right`
- `container.<actor_id>.head`
- `container.<actor_id>.torso`
- `container.<actor_id>.leg_left`
- `container.<actor_id>.leg_right`

**NOTE:** Body slots already exist on actors - they're set from `kind.parts` during actor creation (see `actor_storage/store.ts:apply_body_slots()`). The equipment system needs to use these existing slot names.

Equipment slots are derived from body slot definitions. The body slot info defines available slots (left hand, right hand, head, torso, left leg, right leg).

Equipping = moving an item instance into an equipment container. Items can define which slots they fit via tags (e.g., [WEAPON:hand], [ARMOR:torso]).

## Existing Systems (Can Build Upon)

**Already Built:**
- ✅ **Tag System** - Complete with TagInstance interface, registry, meta-processor
- ✅ **Storage Pattern** - Established in actor_storage, npc_storage, place_storage (copy this pattern)
- ✅ **Item Definition Paths** - `src/engine/paths.ts` has `get_item_dir()`, `get_item_path()`, `get_default_item_path()`
- ✅ **Default Item Template** - `local_data/data_slot_default/items/default_item.jsonc` exists
- ✅ **State Applier** - Effect system in `src/state_applier/apply.ts` (needs new effect types added)
- ✅ **UI Module Infrastructure** - Canvas-based system in `src/mono_ui/modules/` (place_module, button_module, etc.)
- ✅ **Body Slots** - Actors have `body_slots` from kind.parts (see actor_storage)
- ✅ **Inspection System** - Framework exists in `src/inspection/` (inspect_item is placeholder, needs item instance loading)

**Missing (Need to Build):**
- ❌ item_storage/store.ts (loader for item definitions)
- ❌ item_instances/store.ts (instance storage with tags)
- ❌ container_storage/store.ts (container storage)
- ❌ Path helpers for item_instances/ containers (add to paths.ts)
- ❌ State applier effects for TRANSFER_ITEM_INSTANCE, EQUIP_ITEM, etc.
- ❌ inventory_transfer_module.ts (two-pane UI)
- ❌ equipment_module.ts (body slots UI)
- ❌ HTTP endpoints for containers/transfers
- ❌ Generator script for default containers

## Work Items

### 1) Canonical Reference + Loader Layer

**NOTE:** Path helpers for items already exist in `src/engine/paths.ts`. Need to add paths for item_instances and containers.

- [ ] Add to `src/engine/paths.ts`:
  - `get_item_instances_dir(slot)`, `get_item_instance_path(slot, instance_id)`
  - `get_container_dir(slot)`, `get_container_path(slot, container_id)`
- [ ] Create `src/item_storage/store.ts`:
  - `normalize_item_ref(ref: string): string` (accept `item.<id>`, `item_<id>`, `<id>` - convert to unified `item.<id>`)
  - `load_item_def(slot, def_id)` - Returns def with normalized refs
  - `save_item_def(slot, def_id, def)`
  - `ensure_item_def(slot, def_id, representative_if_missing)`
- [ ] Create `src/item_instances/store.ts`:
  - `create_item_instance(slot, def_id, qty, owner_ref)` - Generates instance with TagInstance array
  - `load_item_instance(slot, instance_id)` - Returns instance with tags
  - `save_item_instance(slot, instance)`
  - `delete_item_instance(slot, instance_id)` (only when empty/consumed)
- [ ] Create `src/container_storage/store.ts`:
  - `ensure_container(slot, container_id, defaults)`
  - `load_container(slot, container_id)` - Returns container with contents and tags
  - `save_container(slot, container)`
  - `list_containers_for_owner(slot, owner_ref)`
  - `get_container_contents(slot, container_id)` - Returns item instances with tags

Acceptance:
- [ ] All item reads go through loaders (no direct ad-hoc JSON reads).
- [ ] A missing def returns representative (for legacy inline NPC inventory) without crashing.

### 2) Migration: Generate New Container System

**No preservation needed** - Generate fresh container/item system. Old inventory arrays can be ignored/deprecated.

- [ ] Create generator script `src/tools/generate_container_system.ts`:
  - Generate default item definitions:
    - `small_sack` container (capacity: 10 slots, 5kg weight)
    - `coin` stackable item (currency)
    - Basic equipment: `tunic`, `pants`, `shoes`
  - For each actor:
    - Create default container instance: `sack_default`
    - Place starter items inside (if applicable)
  - For each NPC:
    - Create wallet container with starting coin
    - Create shop inventory containers for merchants (future)
  - Create container files for all equipment slots
- [ ] Mark old `inventory` arrays as deprecated (do not delete, just ignore).

Acceptance:
- [ ] New container system generates cleanly from current actor/NPC definitions.
- [ ] No attempt to migrate old inventory data (clean slate approach).

### 3) Container Operations (Game Plumbing)

Uses TagInstance system for item state (weight, condition, enchantments).

- [ ] Implement container transfer primitives (pure functions + storage writes):
  - `transfer_item_instance(slot, item_instance_id, from_container_id, to_container_id)`
  - `split_stack(slot, item_instance_id, qty)` - creates new instance with split quantity
  - `merge_stacks(slot, to_container_id)` - merges compatible stacks automatically
  - Capacity enforcement (weight + slots)
- [ ] Update state applier with new effect types (payload structure follows tag system pattern):
  - `SYSTEM.TRANSFER_ITEM_INSTANCE`
    ```typescript
    {
      type: "SYSTEM.TRANSFER_ITEM_INSTANCE",
      item_ref: "item.<instance_id>",
      from_container: "container.<id>",
      to_container: "container.<id>",
      qty?: number  // for partial transfers
    }
    ```
  - `SYSTEM.SPLIT_STACK`
  - `SYSTEM.MERGE_STACKS`

**NOTE:** State applier system already exists in `src/state_applier/apply.ts` - just need to add new effect handlers.

Acceptance:
- [ ] Transfers are atomic (either fully applied or rejected).
- [ ] Capacity rules enforced and produce clear failure reasons.
- [ ] Item tags (TagInstance[]) preserved during transfers.

### 4) Equip/Unequip as Container Moves

**NOTE:** Body slots already exist on actors (set from kind.parts). Need to create containers for them.

- [ ] Define canonical equipment container ids for actors/NPCs (from body slot definitions).
- [ ] Implement equip rules (lightweight for now):
  - item tags decide allowed slots (ex: [WEAPON:hand] -> hands, [ARMOR:torso] -> torso)
  - default deny if unknown
- [ ] Add effects:
  - `SYSTEM.EQUIP_ITEM`
  - `SYSTEM.UNEQUIP_ITEM`

Acceptance:
- [ ] Equipping shows up in the UI module and affects tool validation (hands now contain the equipped instance).

### 5) Targeting + Inspect Integration

**NOTE:** Inspection system exists in `src/inspection/` but `inspect_item()` is placeholder. Need to integrate with item instance loading.

- [ ] Update `inspect_item()` in `src/inspection/data_service.ts` to use item instance + def:
  - show name/shape at `vague`, show description/tags at `clear`.
- [ ] INSPECT npc target can optionally include visible equipped items and top-level containers (not contents unless clear).
- [ ] Ensure renderer INSPECT prompt only uses `inspect_result`.

Acceptance:
- [ ] Inspecting a ground item shows accurate name/desc based on clarity.

### 6) UI: Container Transfer Module

**NOTE:** UI module infrastructure exists. Need to create new module following the pattern of place_module.ts.

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

**NOTE:** UI module infrastructure exists. Body slots already exist on actors (from kind.parts).

- [ ] Add `equipment_module`:
  - Displays actor's body slots + both hands (left hand, right hand, head, torso, left leg, right leg).
  - Selecting a slot selects a container (for transfer module).
  - Equip/unequip actions.

Acceptance:
- [ ] Player can equip an item to hand and see it reflected immediately.

### 8) Backend API / Commands

- [ ] Add endpoints (interface_program HTTP server):
  - `GET /api/containers?owner_ref=actor.henry`
  - `GET /api/container?id=<container_id>`
  - `POST /api/transfer` (move/split/merge)
  - `POST /api/equip` / `POST /api/unequip`
- [ ] Permissions:
  - Actor can always manage own containers.
  - Trading requires owner rules (shopkeeper items sellable; theft later).

Acceptance:
- [ ] UI modules work without direct disk reads.

### 9) Ownership & Trading Architecture

**Purpose:** Enable detecting theft vs legitimate purchase, support complex shop setups. Architecture only - actual trading mechanics in future plan.

**Ownership Model:**
- Each item instance has `owner_ref` field: `npc.<id>`, `actor.<id>`, or `system` (unowned/wilderness)
- Container has `controller_ref` (who can open it) and `owner_ref` (who owns contents)
- These can differ: a shopkeeper (controller) might manage items owned by the shop owner (owner_ref)

**Transaction States (Architecture):**
```typescript
interface TransactionIntent {
  type: "purchase" | "theft" | "gift" | "barter";
  item_ref: string;       // Item being transferred
  from_owner: string;     // Current owner
  to_owner: string;       // Intended new owner
  price?: number;         // Agreed price (if purchase)
  witnesses: string[];    // Who sees this happen (affects theft detection)
  timestamp: number;
}
```

**Architecture Components:**
- [ ] Define ownership queries:
  - `get_items_owned_by(owner_ref, place_id?)` - All items owned by entity
  - `get_items_controlled_by(controller_ref, place_id?)` - Items in containers they control
  - `get_shop_inventory(npc_ref)` - Items available for sale (owned by NPC, in accessible containers)
- [ ] Define transaction validation rules:
  - `can_transfer(item_ref, from_owner, to_owner, method)` - Check if transfer is valid
  - Methods: `purchase` (requires payment witness), `gift` (requires consent witness), `theft` (detected by witnesses)
- [ ] Define witness system hooks for future theft detection:
  - When item moves between containers with different owners
  - NPCs can detect "theft" if they witness transfer without valid transaction record

**Future Implementation:**
- UI: Show "BUY" / "STEAL" options based on ownership state
- NPCs: React to theft based on witness status and ownership
- Law enforcement: Track stolen items via ownership chain

Acceptance:
- [ ] Ownership model documented and implemented in data layer (owner_ref on items/containers).
- [ ] Query functions return correct ownership info.
- [ ] Architecture supports future theft/purchase/gift implementations.

## Rollout Strategy

- Phase 1: loaders + instances + containers + migration, no UI yet.
- Phase 2: transfer UI + equipment UI, minimal actions.
- Phase 3: shop ownership + trading loop (coin + price fields).

## Non-Goals (for this plan)

- Full economy balancing.
- Crime/stealing rules.
- Nested containers-of-containers with complex recursion limits (we'll support simple nesting first).
- Tile system integration (deferred until tile plan).

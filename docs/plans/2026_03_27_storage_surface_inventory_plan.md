# Storage Surface Inventory Plan

Date: 2026-03-27

## Status

- [ ] planned

## Intent

Unify body slots, container storage, and future slot-giving systems under one inventory model based on storage surfaces.

This plan is about consolidating how inventories are described and rendered for all entity owners:

- actors
- npcs
- tiles
- items
- structures

The target is not to erase the visual distinction between body slots and storage. The target is to make them one underlying system with owner-specific layout presets.

This plan should make the following cases work cleanly without ad hoc UI and legality paths:

- actor body slots plus first-layer equipped bags/pockets in one main inventory
- nested containers deeper than one step opening in separate panels
- tiles or items with multiple slot-giving contributors in one module
- future tag-based and perk-based slot grants
- future `GROW` surfaces and other specialized storage-like behaviors

## Related Files And Plans

- Character storage unification: `docs/plans/2026_03_27_character_storage_unification_plan.md`
- Character module rework: `docs/plans/2026_02_22_character_module_rework.md`
- Container format notes: `docs/plans/container_format_standardization.md`
- Current transfer legality: `src/transfer/legality.ts`
- Current API/inventory host: `src/interface_program/main.ts`
- Current actor UI state host: `src/canvas_app/app_state.ts`
- Current body slot resolver: `src/equipment/body_slot_resolver.ts`
- Current character module: `src/mono_ui/modules/character_module.ts`
- Current container module: `src/mono_ui/modules/container_module.ts`

If this plan conflicts with older assumptions that treat containers as the master inventory abstraction, this plan wins.

## Problem Statement

The current codebase already has several slot and storage systems that are individually useful but not unified:

- body slots for `tool`, `armor`, and `garb`
- inline container contents for items, tiles, and structures
- transfer legality that understands body slots and container items
- UI modules that separately render character slots and container grids

These systems are close enough that they should become one inventory language, but they still diverge in important ways:

- body slots and containers are rendered by different modules and speak different UI concepts
- UI code often uses synthetic container payloads for things that are not conceptually just containers
- target selection and legality are still heavily path-string-based
- special storage contributors such as tags and future perks do not have a first-class place in the model
- tiles and items with multiple storage contributors would currently require special-case UI and transfer paths

Without a unified model, implementing features like `GROW`, pockets from gear, or perk-granted storage keeps adding more exceptions.

## Product Direction

The canonical abstraction should become `storage surface`, not `container`.

This plan should be executed with a bias toward replacement, not indefinite compatibility layering.

The migration strategy in this document is intended to keep the game usable while work is in progress, but it must not leave behind long-lived parallel systems, adapter pyramids, or dead payload shapes.

### Core Concept Stack

- `owner`: the entity whose inventory view is being rendered or interacted with
- `contributor`: the thing that grants one or more surfaces to that owner
- `surface`: one slot-providing region with its own legality and rendering rules
- `slot`: one interaction point within a surface

Examples:

- actor body slot `hand_left.tool` is a surface
- actor body slot `torso.garb` is a surface
- an equipped satchel can contribute one or more attached storage surfaces
- a tile with `CONTAINER` contributes a storage surface
- a bush with `GROW` contributes a harvest surface
- a future perk can contribute a special quick-access surface

### Visual Direction

The system is unified conceptually, but layouts remain owner-specific.

- actors: body-slot region plus attached-storage region in one main inventory view
- tiles/items/structures: grouped vertical surfaces in one main inventory view
- deeper nested containers: separate panels

First implementation should use stable vertically stacked groups. Later work may introduce spatial anchoring for body-related groups inside the same inventory system.

## Canonical Rules

### Migration Must Be Short-Lived And Self-Cleaning

Migration scaffolding is allowed only when it directly shortens the path to cutover.

Rules:

- every compatibility layer added by this plan must have a named owner and removal phase
- new inventory code should prefer wrapping old legality temporarily rather than duplicating legality permanently
- new owner-view payloads should replace synthetic container DTO usage rather than sitting beside them forever
- once one owner type is fully migrated, dead UI wiring and dead payload shaping for that owner should be removed before moving on
- no new feature work should be added to legacy inventory abstractions after their replacement exists

If a migration step cannot name what old code will be deleted afterward, the step is too vague.

### One Owner View May Contain Many Surfaces

An owner inventory view may include multiple contributors and multiple surfaces.

Examples:

- actor main inventory: body slot contributors plus first-layer attached storage contributors
- tile inventory: `GROW` plus `CONTAINER`
- item inventory: multiple slot-giving tags on the same item

### Contributor Grouping Is First-Class

If a single contributor grants multiple surfaces, those surfaces render under one shared contributor header.

- header text should be the contributor name
- surfaces remain distinct inside the group
- ordering inside the group should be stable

### Depth Rules

Depth describes how many containment steps away from the owner a surface contributor is.

- `depth 0`: owner-native contributors
- `depth 1`: directly attached contributors
- `depth >= 2`: nested contributors

Display rule:

- `depth 0` and `depth 1` may appear in the owner's main inventory view
- `depth >= 2` must open in their own UI panels

For actors, this means:

- body slots are `depth 0`
- tag/perk surfaces on the actor are `depth 0`
- directly equipped or held container interiors are `depth 1`
- a bag inside a bag is `depth 2` and gets its own panel

### Layout Rules

Body slots and attached storage should remain visually distinct, even though they are powered by the same schema.

Recommended display regions:

- `body`
- `attached_storage`
- `main`
- `panel`

Actor main inventory uses `body` + `attached_storage`.

Tile/item/structure main inventory uses `main`.

### Legality Rules Must Stay Canonical

The existing legality behavior for equip targets, containers, and place interactions must not regress.

Current legality and transfer behavior should remain authoritative during migration:

- body slot compatibility
- body slot occupancy rules
- container deposit and withdrawal rules
- range and world placement rules
- tile/structure container aliasing and canonicalization

The new inventory surface system should initially adapt into the current legality system rather than replacing it outright.

## Proposed Data Model

The exact field names may change during implementation, but the model should support the following shape.

```ts
type StorageOwnerRef =
  | { kind: "actor"; id: string }
  | { kind: "npc"; id: string }
  | { kind: "tile"; place_id: string; x: number; y: number; z: number }
  | { kind: "structure"; place_id: string; structure_id: string }
  | { kind: "item"; owner_kind: "actor" | "npc" | "place"; owner_id: string; item_id: string };

type StorageContributorRef = {
  id: string;
  kind: "body_slot" | "equipped_item" | "held_item" | "tag" | "perk" | "owner_native" | "custom";
  name: string;
  depth: number;
  sort_key: string;
};

type StorageSurface = {
  id: string;
  owner: StorageOwnerRef;
  contributor: StorageContributorRef;
  surface_kind: "tool" | "armor" | "garb" | "container" | "grow" | "custom";
  display_region: "body" | "attached_storage" | "main" | "panel";
  label?: string;
  slot_count: number;
  min_visible_slots?: number;
  auto_expand?: boolean;
  accepts_player_insert: boolean;
  accepts_player_withdraw: boolean;
  accepts_system_insert: boolean;
  accepts_system_withdraw?: boolean;
  slots: StorageSlot[];
};

type StorageSlot = {
  id: string;
  surface_id: string;
  slot_index: number;
  grid_x: number;
  grid_y: number;
  slot_kind: "tool" | "armor" | "garb" | "container" | "grow" | "custom";
  occupied: boolean;
  is_placeholder?: boolean;
  item_id?: string;
};

type OwnerInventoryView = {
  owner: StorageOwnerRef;
  layout_mode: "actor_vertical_grouped" | "owner_vertical_grouped";
  groups: Array<{
    contributor: StorageContributorRef;
    surfaces: StorageSurface[];
  }>;
};
```

## Current System Mapping

### Actors

Current actor data already contains the raw ingredients for the new model:

- body slots in `src/types/inline_item.ts` and `src/types/body_slots.ts`
- equipped/held containers in inline items
- transfer legality for body slots and actor-owned container items in `src/transfer/legality.ts`

Planned actor mapping:

- body slot tool surface -> contributor kind `body_slot`
- body slot armor surface -> contributor kind `body_slot`
- body slot garb surface -> contributor kind `body_slot`
- first-layer equipped or held container interior -> contributor kind `equipped_item` or `held_item`
- future actor tag/perk surfaces -> contributor kind `tag` / `perk`

### Tiles / Structures

Current tile/structure data already supports inline storage-like content via `contents` and `container_capacity`.

Planned tile mapping:

- `CONTAINER` contributes a `container` surface
- `GROW` contributes a `grow` surface
- future tile tags contribute additional specialized surfaces

### Items

Items can already own nested container contents.

Planned item mapping:

- item-native interior storage -> `container` surface
- item tag-granted surfaces -> tag contributor surfaces
- nested item contents deeper than one step -> own panel view

## UI Direction

### Unified Inventory View System

The current `character_module` and `container_module` should evolve into one inventory rendering system with different layout presets.

This should likely be structured as:

- shared schema-driven inventory rendering core
- shared slot rendering primitives
- shared contributor header rendering
- owner/layout-specific composition layer

### First Layout Presets

#### Actor Main Inventory

- vertically stacked
- panning supported
- contributor groups ordered stably
- body region rendered first
- attached storage region rendered after body region

#### Tile / Item / Structure Inventory

- vertically stacked contributor groups
- same slot shapes as actor inventory
- surface-specific colors and labels

#### Nested Container Panels

- opened when selecting a surface or contributor deeper than `depth 1`
- rendered using the same grouped-inventory primitives, but isolated to that nested owner view

### Contributor Header Rules

- header label should use contributor name
- one contributor may contain multiple surfaces
- surfaces inside a contributor should remain visibly distinct, but grouped
- surface ordering should be deterministic

### Slot Visual Rules

- slot shape should be standardized across systems
- slot color and metadata should communicate slot kind and legality
- current body slot color language should remain a useful reference
- specialized surfaces like `grow` should get their own distinct slot type/color later

## API Direction

Add new owner-view endpoints instead of overloading existing container endpoints further.

Recommended initial endpoints:

- `GET /api/inventory/actor_view?actor_id=...`
- `GET /api/inventory/npc_view?npc_id=...`
- `GET /api/inventory/tile_view?place_id=...&x=...&y=...&z=...`
- `GET /api/inventory/item_view?...`

These endpoints should return `OwnerInventoryView` payloads rather than pretending the view is a single container.

Older container endpoints may remain temporarily as compatibility layers during migration.

## Transfer / Legality Migration Strategy

### Principle

Do not replace legality all at once.

Instead:

- let UI and new APIs target surfaces and slots
- resolve surface targets back into current legality targets internally
- keep current legality as the authoritative first implementation

### Bridge Phase

Introduce a surface-target adapter layer that can map:

- actor body surfaces -> current body slot legality targets
- actor/item/tile container surfaces -> current container legality targets
- future specialized surfaces -> new legality branches when needed

This allows migration of UI and API shape without re-implementing all legality up front.

Bridge constraints:

- the bridge must be thin and localized
- the bridge should resolve new surface ids into current legality targets in one place
- old call sites should be migrated onto the bridge rather than keeping many direct legacy paths alive
- once a path has been migrated to surface-targeting, its legacy targeting path should be queued for deletion immediately

### Later Surface-Native Legality

Once the surface model is stable, legality can gradually move from path-string parsing to native surface resolution.

That later phase should only happen after actor and tile inventory UIs are stable and verified.

## Non-Negotiable Invariants

- Body slot equip compatibility must not regress.
- Body slot occupancy rules must not regress.
- Container capacity, weight, and grid legality must not regress.
- Place interaction range and drop behavior must not regress.
- Nested container ownership remains inline under its owning item.
- Surface resolution must not create duplicate item ownership or ambiguous targets.
- Tile and structure canonicalization rules must continue to work.
- The migration must reduce total inventory-system complexity by the end of the plan.

## Major Risks

### Path Fragmentation

Current target parsing is spread across many string forms such as:

- `body_slots.*`
- `actor.item.*`
- `place.item.*`
- `place.tile.*`
- `place.ground.*`
- `place.pile.*`

This should be isolated behind the new surface resolver and compatibility layer instead of expanding further.

### Read Endpoints That Mutate Data

Some current open/load container flows normalize grid or capacity state and persist on read.

The new owner-view APIs should aim to become read-model hosts rather than mutation hosts, or at minimum isolate repair behavior clearly.

### UI Coupling To Fake Container Shapes

Current UI often treats many different inventory sources as if they were one container DTO.

The new owner-view model must replace that shared fiction with explicit contributor and surface semantics.

### Overloaded Body Slot Semantics

Current body slot targeting can mean either equip-to-slot or deposit-into-equipped-container depending on occupancy.

The new surface system should make these as separate surfaces or separate resolved interaction targets, even if the compatibility bridge still maps onto old rules at first.

## Implementation Phases

### Phase 1: Schema And Resolver Design

- add shared inventory schema types
- define owner, contributor, surface, slot, and view payloads
- define depth and display-region rules
- define stable ordering rules

Deliverable:

- shared types and resolver contract without UI cutover yet
- deletion list for the first legacy payload/helpers that will be removed once actor owner-view cutover lands

### Phase 2: Actor Owner View Read Model

- implement actor inventory resolver
- map body slots to body-region surfaces
- map first-layer equipped/held containers to attached-storage surfaces
- map contributor headers and depth values

Deliverable:

- actor owner-view payloads available from new endpoint(s)

Cleanup required before leaving this phase:

- identify actor-specific synthetic container shaping that becomes redundant
- stop adding new actor inventory behavior to old DTO shims

### Phase 3: Tile / Item Owner View Read Model

- implement tile and item inventory resolvers
- map tile/item container surfaces
- support multiple contributors within a single owner view

Deliverable:

- tile/item owner-view payloads available from new endpoint(s)

Cleanup required before leaving this phase:

- identify tile/item-specific synthetic container shaping that becomes redundant
- consolidate any duplicated contributor/surface ordering helpers

### Phase 4: Unified Inventory UI Foundation

- create grouped inventory rendering core
- add contributor header rendering
- add shared slot rendering for surface kinds
- support vertically stacked pannable layout

Deliverable:

- reusable grouped inventory renderer, still compatible with staged rollout

Cleanup required before leaving this phase:

- stop expanding the legacy split between character-slot rendering and container-grid rendering
- centralize shared slot drawing and contributor header rendering in the new UI layer

### Phase 5: Actor UI Migration

- migrate actor main inventory to owner-view payloads
- render body and attached-storage regions in one unified actor inventory module
- keep nested containers as separate panels

Deliverable:

- actor inventory no longer depends on separate character/container assumptions for first-layer storage display

Cleanup required before leaving this phase:

- remove actor-first-layer UI paths that depend on legacy synthetic container assumptions
- remove dead actor-specific rendering helpers superseded by the unified actor inventory module

### Phase 6: Tile / Item UI Migration

- migrate tile/item inventory windows to owner-view payloads
- support multiple contributors in one module
- preserve separate nested-panel behavior for deeper containers

Deliverable:

- bush/tile/item multi-surface views become first-class

Cleanup required before leaving this phase:

- remove tile/item UI paths that only existed to coerce owner views into legacy single-container payloads
- remove dead compatibility wiring for migrated tile/item windows

### Phase 7: Surface-Target Transfer Bridge

- add surface-id + slot-index targeting in UI and API
- resolve into current legality targets internally
- verify no regression in equip, deposit, withdraw, and place-drop behavior

Deliverable:

- new transfer path that speaks the surface model while preserving old legality

Cleanup required before leaving this phase:

- remove old UI callers that still target migrated paths directly by legacy container/body-slot strings where a surface target now exists
- collapse duplicate target parsing that is no longer needed after the bridge becomes the single entrypoint

### Phase 8: Specialized Surface Contributors

- implement `GROW` as a `grow` surface contributor
- add later tag/perk surface contributors using the same model

Deliverable:

- special storage-like mechanics no longer require custom one-off inventory systems

Cleanup required before leaving this phase:

- implement new mechanics only on the storage-surface model
- do not add new special cases to legacy container abstractions

### Phase 9: Legacy Removal Pass

After actor, tile, and item owner views are migrated and stable, perform an explicit deletion pass.

This phase should remove:

- dead synthetic container DTO shaping used only for pre-surface inventory views
- dead module wiring that assumed character slots and container grids were separate systems
- dead path-target parsing branches no longer reached after surface-target cutover
- dead compatibility endpoints or compatibility code that survived earlier phases without a clear owner

Deliverable:

- one canonical owner-view inventory path for active inventory UIs
- one canonical surface-target transfer entry path for migrated inventory interactions
- reduced inventory-system code volume compared with pre-plan state

## Verification Checklist

- [ ] actor body slot interactions still work for tool, armor, and garb
- [ ] actor first-layer equipped/held containers appear in main inventory view
- [ ] deeper nested containers open separately
- [ ] tile/item owners can display multiple contributors in one module
- [ ] contributor headers show contributor names correctly
- [ ] grouped surfaces remain stably ordered across refreshes
- [ ] transfer legality still blocks invalid equip/deposit/drop cases
- [ ] no duplicate item ownership is introduced during transfers
- [ ] old container behaviors still work during migration where compatibility is expected
- [ ] `GROW` can later plug in as a surface without inventing a new inventory model
- [ ] each migration phase deletes or retires code instead of only adding adapters
- [ ] no legacy inventory path remains ownerless or undocumented by the end of the plan

## Immediate Next Step

Before implementation, define the first concrete TypeScript schema and decide where the new shared inventory types and resolver helpers will live.

Recommended first implementation milestone:

- actor owner-view schema
- actor resolver
- read-only actor inventory endpoint
- grouped vertical actor inventory rendering using contributor headers

This is the smallest slice that validates the architecture without forcing `GROW` or deep transfer rewrites too early.

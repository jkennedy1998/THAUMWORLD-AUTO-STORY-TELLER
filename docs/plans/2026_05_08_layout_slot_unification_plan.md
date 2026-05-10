# Layout Slot Unification Plan

Date: 2026-05-08
Status: Proposed

## Goal

Unify game and painter UI layout persistence behind one shared engine/runtime system.

The new rule is:

- layouts live in a **layout slot**
- one layout slot is **active** for a given app/profile boot
- when that slot is open, all move/resize/show/hide changes save back into that slot
- for now, support only one slot with no slot-switching UX yet

This should replace the current split where:

- game uses shared `module_layout_store.ts` plus app-local boot/cache glue
- painter uses `module_position_storage.ts`

## Non-Goals

For this phase, do **not** build:

- slot switching UI
- preset management UI
- multiplayer layout sharing
- actor/class auto-switching
- docking/tabbing systems

Those should be enabled by the architecture, but not required now.

## Desired Product Behavior

### Boot

For both `thaum_world` and `thaum_painter`:

1. resolve active profile scope
2. resolve active layout slot id
3. load layout state for that slot
4. apply it to module runtime
5. continue normal module interaction

### Runtime

When the user:

- moves a module
- resizes a module
- closes/shows a module

that change saves to the currently active layout slot.

### Current UX simplification

The active layout slot is always:

- `default`

No user-facing switcher is needed yet.

## Architectural Rule

Treat UI layout as:

- **client-local**
- **profile-scoped**
- **app-specific**
- **slot-targeted**

This means layout is not world-authoritative multiplayer state.

## Terminology

To avoid confusion with world/data slots:

- `data slot` = existing save/world slot
- `layout slot` = active workspace layout target inside a profile

Optional future naming improvement:

- use `workspace slot` in UX
- keep `layout_slot_id` in storage/API if desired

## Proposed Storage Shape

Replace the current flat per-app layout blob with a slot-aware shape.

## File location

Original plan assumption:

- `profiles/<profile_id>/module_layouts.json`

Current implemented authority:

- `profiles/<profile_id>/apps/<app_id>/module_layouts.json`

Legacy profile-root `module_layouts.json` may still be read once for migration, but app-scoped files are now the intended live authority.

## Proposed shape

```json
{
  "version": 2,
  "apps": {
    "thaum_world": {
      "active_slot_id": "default",
      "slots": {
        "default": {
          "positions": {
            "character_module": { "x0": 1, "y0": 50, "x1": 39, "y1": 66 }
          },
          "visibility": {
            "character_module": true
          },
          "module_config": {}
        }
      }
    },
    "thaum_painter": {
      "active_slot_id": "default",
      "slots": {
        "default": {
          "positions": {
            "toolbox": { "x0": 6, "y0": 45, "x1": 22, "y1": 65 }
          },
          "visibility": {
            "toolbox": true
          },
          "module_config": {}
        }
      }
    }
  }
}
```

## Shape notes

- `active_slot_id` exists now even though only `default` is supported
- `slots` enables future preset expansion without another storage migration
- `module_config` is reserved for later per-module state
- `positions` and `visibility` remain the first-class supported data in this phase

## Type Direction

Recommended runtime types:

```ts
type ModulePositionData = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type ModulePositions = Record<string, ModulePositionData>;
type ModuleVisibility = Record<string, boolean>;

type ModuleConfigState = Record<string, unknown>;

type ModuleLayoutSlotState = {
  positions: ModulePositions;
  visibility: ModuleVisibility;
  module_config?: ModuleConfigState;
};

type AppLayoutSlotsState = {
  active_slot_id: string;
  slots: Record<string, ModuleLayoutSlotState>;
};

type ModuleLayoutFileV2 = {
  version: 2;
  apps: Partial<Record<CameraSettingsAppId, AppLayoutSlotsState>>;
};
```

## Canonical API Direction

Keep layout persistence under shared runtime/engine ownership.

Primary file to evolve:

- `src/mono_ui/runtime/module_layout_store.ts`

Painter-specific owner to retire:

- `src/ascii_painter/module_position_storage.ts`

That painter file may temporarily become a thin adapter during migration, but should stop being the true owner.

## Recommended API surface

```ts
type LayoutSlotId = string;

type ModuleLayoutState = {
  positions: ModulePositions;
  visibility: ModuleVisibility;
};

async function load_module_layout_slot(
  slot: number,
  app_id: CameraSettingsAppId,
  profile_scope?: ProfileScope | null,
  layout_slot_id?: LayoutSlotId,
): Promise<ModuleLayoutState>;

async function save_module_layout_slot(
  slot: number,
  app_id: CameraSettingsAppId,
  next: ModuleLayoutState,
  profile_scope?: ProfileScope | null,
  layout_slot_id?: LayoutSlotId,
): Promise<void>;

async function get_active_module_layout_slot_id(
  slot: number,
  app_id: CameraSettingsAppId,
  profile_scope?: ProfileScope | null,
): Promise<LayoutSlotId>;

async function set_active_module_layout_slot_id(
  slot: number,
  app_id: CameraSettingsAppId,
  layout_slot_id: LayoutSlotId,
  profile_scope?: ProfileScope | null,
): Promise<void>;
```

## Simpler first-pass API

If the above is too wide for the first implementation, keep a smaller initial surface:

```ts
async function load_active_module_layout(...): Promise<ModuleLayoutState>;
async function save_active_module_layout(...): Promise<void>;
```

with the active slot hardcoded to `default` internally for now.

That is acceptable if the storage shape is still slot-aware.

## Runtime Integration Model

## Shared behavior both apps should use

Each app should follow the same boot pattern:

1. resolve `active_profile_scope`
2. load cached local layout snapshot if available
3. build modules with cached/default rects
4. async load authoritative profile-scoped active layout slot
5. apply loaded positions/visibility to live modules
6. debounce future saves back to the active slot

The crucial rule is:

- async loaded layout must be reapplied to already-live modules

This is the behavior painter is currently missing.

## Game integration target

Primary file:

- `src/canvas_app/app_state.ts`

Game already has most of the right runtime shape:

- serialize/apply helpers
- debounced persistence
- runtime reapply behavior

Needed work:

- point it at the slot-aware shared API
- simplify local cache naming/ownership if needed
- stop treating world app as the special case

## Painter integration target

Primary file:

- `src/canvas_app/painter_app_state.ts`

Needed work:

- stop reading rects from painter-only persistence owner
- use the shared runtime layout boot/apply flow
- add the missing async runtime reapply step
- debounce save through the shared store

Painter should end up using the same conceptual flow as game, not a separate persistence model.

## Persistence Policy Guidance

The slot should persist only modules that are meant to be durable layout state.

### Good default candidates

- toolbox/palette/property panels
- character module
- transcript/status/debug panels
- camera control
- painter selectors and inspectors

### Likely special cases

- NPC-specific panels
n- entity-instance windows
- temporary picker overlays
- one-shot creation dialogs

These may still use the same store, but should be tagged by policy later:

- `workspace_persistent`
- `entity_scoped`
- `session_only`
- `transient`

For this phase, it is acceptable to keep current behavior and only avoid making transient module handling worse.

## Migration Plan

## Phase 1: Make store slot-aware and backward-compatible

Update:

- `src/mono_ui/runtime/module_layout_store.ts`

Tasks:

- add support for `version: 2` slot-aware structure
- continue reading old `version: 1` flat `{ positions, visibility }` app state
- auto-upgrade old state into:
  - `active_slot_id: "default"`
  - `slots.default = old_state`
- preserve profile-scoped file paths

## Phase 2: Introduce one shared active-layout API

Create a shared API that both apps can call.

Tasks:

- expose `load_active_module_layout(...)`
- expose `save_active_module_layout(...)`
- optionally expose `get_active_module_layout_slot_id(...)`
- keep current slot id fixed to `default`

## Phase 3: Migrate painter off local ownership

Update:

- `src/ascii_painter/module_position_storage.ts`
- `src/canvas_app/painter_app_state.ts`

Tasks:

- remove painter as layout persistence owner
- either delete the painter helper or reduce it to a temporary adapter
- boot painter from shared layout state
- apply async-loaded state to live modules after creation
- route all save calls through shared active-layout save path

## Phase 4: Align game on the same abstraction

Update:

- `src/canvas_app/app_state.ts`

Tasks:

- keep existing good runtime reapply behavior
- point save/load behavior to the same active-layout API painter uses
- keep optional local cache if it helps perceived boot speed

## Phase 5: Reserve extension points for preset UI

Do not build UI yet, but keep clean seams for later:

- active slot id getter/setter
- clone slot
- rename slot
- delete slot
- import/export slot

## Suggested File Changes

### Primary files

- `src/mono_ui/runtime/module_layout_store.ts`
- `src/canvas_app/app_state.ts`
- `src/canvas_app/painter_app_state.ts`

### Transitional file

- `src/ascii_painter/module_position_storage.ts`

### Optional future file split

If the store grows too much, split later into:

- `src/mono_ui/runtime/module_layout_store.ts`
- `src/mono_ui/runtime/module_layout_runtime.ts`

where:

- `store` handles persistence/schema/migration
- `runtime` handles cache/apply/debounce logic

## Migration Compatibility

The migration should preserve existing users’ layouts.

### Read compatibility

Current migration-compatible read order:

1. app-scoped `profiles/<profile_id>/apps/<app_id>/module_layouts.json`
2. legacy profile-root `profiles/<profile_id>/module_layouts.json`
3. no local cache authority

### Upgrade behavior

When older layout data is found:

- treat it as slot `default`
- write back upgraded `version: 2` shape on next save

## Local cache policy

Local cache is acceptable for startup responsiveness, but it should be only:

- a boot cache
- not the source of truth

Source of truth should remain:

- profile-scoped active layout slot file

## Multiplayer stance

Layout data should remain:

- local to the client/user/profile
- not broadcast as simulation state
- not required for shared world correctness

Possible future additions:

- export layout preset to file
- share a preset with another player
- recommended layout slot by actor/class/role

But those should be opt-in overlays, not the base authority model.

## Success Criteria

This work is complete when:

- painter and game both use one shared layout persistence system
- move/resize/show/hide persists across boots in both apps
- painter async-loads and reapplies layout to live modules
- the storage shape supports layout slots even with only `default`
- no UI is required yet to manage slots
- future preset/workspace expansion can happen without another schema reset

## Immediate Recommended Implementation Order

1. extend `module_layout_store.ts` to a slot-aware backward-compatible format
2. add shared `load_active_module_layout` / `save_active_module_layout` helpers
3. migrate painter to use them and add runtime reapply after async load
4. align game to the same API surface
5. verify persistence in both programs across restart

## Notes

The most important practical fix in this plan is not just schema work.

It is this runtime rule:

- **loaded layout state must be applied to already-created modules after async profile-scoped load completes**

That is the main functional gap behind the current painter persistence regression.

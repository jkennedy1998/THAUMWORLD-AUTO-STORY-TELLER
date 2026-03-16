# Place Painter Implementation Plan

Date: 2026-03-15

## Status

- [ ] planned

## Intent

Implement an in-game `place_painter` mode that replaces AI/code-authored place layout work with direct authoring inside the running game.

This mode should let us:

- pause the live place simulation and edit safely
- paint place tiles directly from the tile databanks
- place items directly from the item databanks
- move the current actor and other place entities directly on the map
- reuse the strongest parts of the existing ASCII painter module system instead of building a second editor stack from scratch

Longer term, this mode should become the foundation for broader world authoring inside THAUMWORLD, including NPC spawning and direct NPC information editing.

## Product Direction

The goal is not a debug toy. The goal is a canonical in-game world authoring workflow.

This feature is intended to replace the current habit of generating or hand-coding places externally. The target workflow is:

1. enter a place in the game
2. press `place_painter`
3. the place pauses
4. painter modules open
5. author the place directly from databank-backed tiles/items/entities
6. exit painter mode and continue simulation in the edited place

## Core Principles

- Reuse existing systems where they are already strong: place rendering, painter modules, databank loaders, active-place persistence.
- Do not fork a second place renderer for this mode.
- Do not make the standalone ASCII painter authoritative for place data.
- Keep server authority over saved place state and entity positions.
- Keep v1 focused on reliable authoring of places, not full generic content editing.
- Design the session model so NPC spawn/edit can be added without rewriting the mode.

## Prerequisite Work (Must Land Before Painter Authoring)

Place painter depends on two prerequisite capabilities being hardened first:

1. place persistence integrity
2. safe runtime augmentation + safe place pause/resume

These are not optional polish tasks. They are required so the painter does not write corrupted place payloads, leak runtime junk into saved JSON, or race the live breath simulation while editing.

Important note on current implementation state:

- The place-local pause foundation already exists in meaningful form.
- `PlaceBreathState` already has `time_scale` and `pause_sources`.
- The backend already exposes `/api/place/pause`.
- The frontend already has current-place pause controller helpers in `src/canvas_app/app_state.ts`.
- This prerequisite phase must harden and verify that existing pause path rather than rebuilding a second pause system.

This prerequisite work must align with the movement system design and implementation plans:

- movement simulation remains server-authoritative and breath-driven
- paused places stop simulation of movement/physics/time for that place
- runtime augmentation stays runtime-only and reproducible
- saved place JSON remains canonical authored/runtime-persistent data only
- place persistence consolidation follows `docs/plans/2026_03_16_place_persistence_consolidation_plan.md`

Blocking reason:

- We have already seen runtime save/refresh regressions where item placement or refresh causes visible place tiles to lose derived display data and render as `?`.
- That is a persistence/runtime-boundary failure and would make place painter unsafe if we proceed without hardening the pipeline first.

## Prerequisite Definition Of Done

Painter authoring work should not proceed past mode-toggle scaffolding until all of the following are true:

- Place save paths do not mutate live active place objects in place during persistence.
- Runtime-only tile/structure/entity augmentation never leaks into canonical saved place JSON.
- Active place state can be re-augmented safely after save/load/edit without producing raw `?` tiles.
- Place-local pause stops breaths for the edited place, including movement, tile physics, item gravity, and time-driven updates.
- Runtime mutations to tiles, actors, NPCs, items, and structures persist correctly across reboot.

## Prerequisite Deliverable

This plan depends on the persistence hardening work described below.

### Phase 0: Persistence + Pause Hardening (Prerequisite)

### Goal

Establish a safe canonical place persistence pipeline and a safe place-local simulation pause boundary before any authoritative in-game painting begins.

### Tasks

- Define canonical persisted place state vs runtime augmented place state.
- Ensure place saves use clone-then-sanitize rather than mutating live active place objects in place.
- Strip root/runtime-only fields from saved place JSON, including runtime augmentation sentinels and transient tile physics fields.
- Make runtime augmentation idempotent and safe to re-run after save, reload, mutation, and refresh.
- Unify place loading paths enough that painter-targeted mutations and regular gameplay refreshes read/write the same canonical place format.
- Ensure active place sync always rebuilds runtime-safe state after persistence writes.
- Reuse, harden, and verify the existing place-local pause/resume path so painter mode can freeze simulation for the edited place without corrupting state.
- Establish painter-safe mutation primitives for tile edits, item placement, entity moves, and structure moves that operate on canonical saved data and then refresh runtime state.

### Reuse Notes

- Reuse `src/interface_program/main.ts` as the active-place authority host.
- Reuse `src/place_storage/store.ts` and `src/shared/defs_deltas_sanitize.ts` as the persistence boundary, but harden them rather than adding a second save pipeline.
- Reuse the existing current-place pause controller plumbing in `src/canvas_app/app_state.ts` and active-place pause state in `src/interface_program/main.ts`.
- Do not let painter introduce a second local-only place-edit cache.

### Success Criteria

- Item placement, tile edits, actor/NPC moves, and structure edits persist across reboot without introducing raw `?` tiles.
- Entering painter mode can reuse the existing current-place pause path and stop simulation of that place safely.
- Exiting painter mode resumes the place from canonical edited state.
- The painter can build on hardened mutation/save helpers rather than whole-place runtime object writes.

## Definition Of Done

This plan is complete only when all of the following are true:

- A new in-game debug button toggles `place_painter` mode.
- Entering the mode pauses the current place simulation; exiting resumes it.
- The in-game place view switches from movement/interaction behavior to painting behavior.
- Painter-style UI modules appear in-game for tool selection, current selection, palette browsing, and layer selection.
- The palette is backed by THAUMWORLD databanks rather than a generic glyph list.
- Tiles can be painted and erased directly in the place.
- Items can be placed directly in the place.
- The current actor position can be moved by painting/placing its anchor, while guaranteeing only one current actor position exists.
- A move tool can pick up and move entities already present in the place, using drag-style interaction similar to the existing place item movement UX.
- Edits persist immediately into live place data and are visible without reloading the app.

## Current System Assessment

### Relevant Existing Systems

- `src/canvas_app/app_state.ts`
  - owns the main game module graph
  - defines debug buttons
  - wires the in-game place module
- `src/mono_ui/modules/place_module.ts`
  - owns click, inspect, movement, layer scroll, and DOM world-layer behavior for the place view
  - is the main interaction branch point for `place_painter`
- `src/interface_program/main.ts`
  - owns active place breath state and already has `time_scale` on `PlaceBreathState`
  - already contains place mutation helpers and debug mutation endpoints
- `src/canvas_app/painter_app_state.ts`
  - shows how painter modules are composed and wired together
  - is useful as a reference, but too standalone to drop into game mode unchanged
- `src/mono_ui/modules/painter_canvas_module.ts`
  - contains reusable painter interaction logic for brush-like operations, selection, and panning
- `src/ascii_painter/layer_palette_module.ts`
  - provides the existing layers UI
- `src/mono_ui/modules/toolbox_module.ts`
  - provides the toolkit UI
- `src/mono_ui/modules/character_selector_module.ts`
  - is not directly suitable for v1 because it is a static glyph browser, not a databank palette
- `src/tile_storage/store.ts` and `src/tile_storage/resolve.ts`
  - already provide databank lookup and display resolution for tiles
- `src/item_storage/store.ts` and `src/item_storage/resolve.ts`
  - already provide databank lookup and display resolution for items

### Current Constraints

- The place module currently treats left-click as movement/selection and wheel as layer focus changes.
- The server already supports single-tile mutation via `/api/place/debug/tile`, but that is too narrow for the editor we want.
- `time_scale` exists on active places, but there is no dedicated frontend/backend pause API for editing mode yet.
- Layer reordering is risky because multitile structures and world-z semantics are not yet cleanly separated.
- NPC placement is not required in this version.
- Entity moving is required in this version.

## Scope

## V1 In Scope

- Toggle `place_painter` mode from a new debug button
- Pause/resume current place simulation
- Reuse painter-style floating modules inside game mode
- Toolkit module
- Selected entry module / current brush display
- Databank-backed palette module
- Layer selection module
- Tile painting
- Tile erasing
- Item placement
- Actor anchor placement for the current player actor
- Entity move tool for dragging/moving actors, NPCs, and movable place entities to a different tile
- Immediate persistence and live refresh

## V1 Explicitly Out Of Scope

- Full NPC spawning workflow
- Full NPC sheet editing workflow
- Generic entity property editing UI
- Color painting support
- Layer rename support
- Layer reorder support
- Full standalone painter feature parity

## Architecture Direction

## Reuse-First Rule By Default

For every phase below, prefer extension over replacement.

Before building a new system piece, first check whether the requirement can be satisfied by extending one of these existing hosts:

- `src/canvas_app/app_state.ts` for UI state, debug buttons, module visibility, and place-module wiring
- `src/mono_ui/modules/place_module.ts` for place viewport interactions, hit-testing, wheel/layer behavior, and drag/drop routing
- `src/interface_program/main.ts` for active-place pause state, authoritative mutation helpers, actor/NPC persistence, and place save/sync flows
- `src/canvas_app/painter_app_state.ts` for how painter modules are assembled and persisted
- `src/mono_ui/modules/painter_canvas_module.ts` for tool semantics, drag behavior, brush-like interactions, and viewport ideas
- existing item drag/drop flow in `src/canvas_app/app_state.ts` for pickup/drop interaction patterns

New modules should only be introduced where there is a true gap, not where an existing host can be adapted cleanly.

## 1. Place Painter Session Model

Create a dedicated in-game editor session/controller rather than attempting to reuse the standalone ASCII painter app wholesale.

The place painter session should own:

- `active: boolean`
- current tool
- selected databank entry
- selected world-z / focused plane
- drag state
- selection state if needed later
- active place id and slot
- current actor ref
- panel visibility state

This controller should live in the game app layer and supply painter-mode callbacks to the place module.

## 2. Interaction Model

When `place_painter` is inactive:

- place view behaves exactly as it does now

When `place_painter` is active:

- movement clicking is disabled
- travel clicking is disabled
- normal target selection is disabled unless a painter tool explicitly needs it
- left click and drag route into the selected place-painter tool
- wheel still changes focused place layer/world-z
- painter-related modules become visible

## 3. Databank Palette Model

The character palette concept should be replaced in this mode by a databank palette.

Palette sections should be designed to support future growth:

- tiles
- items
- special tools
- future: NPC kinds
- future: entity edit targets

Each entry should normalize into a shared editor-facing shape:

```ts
type PlacePainterPaletteEntry = {
  id: string;
  type: 'tile' | 'item' | 'actor_anchor' | 'tool';
  label: string;
  glyph: string;
  color: string | null;
  source_id: string;
  tags?: string[];
};
```

The current actor anchor should appear as a special singleton placement entry.

## 4. Server Authority Model

The renderer can drive the editor UX, but the backend remains authoritative for:

- place tile changes
- item placement/removal
- actor position updates
- entity move commits
- pause/resume state for the active place

The editor should not silently maintain local-only authoring state that diverges from the server.

## Implementation Phases

## Phase 1: Add Place Painter Mode Toggle

### Goal

Create the mode switch and basic frontend state for entering/exiting place painter mode, after Phase 0 persistence/pause hardening is complete.

### Tasks

- Add a new debug button in `src/canvas_app/app_state.ts` labeled `PAINT` or `PLACE_PAINTER`.
- Add `ui_state.place_painter` to game app state.
- Add enter/exit helper functions in app state.
- On enter:
  - mark mode active
  - request backend pause for the current place
  - open the relevant painter modules
- On exit:
  - mark mode inactive
  - request backend resume for the current place
  - optionally hide place-painter-only modules

### Reuse Notes

- Reuse the existing debug button system in `src/canvas_app/app_state.ts`; do not create a second debug launcher framework.
- Reuse the existing app-level UI state structure; add a `place_painter` branch rather than introducing a separate global store.
- Reuse existing `flash_status(...)` and module visibility patterns for mode feedback.

### Success Criteria

- User can toggle place painter on/off from inside the running game.
- UI clearly reflects whether painter mode is active.

## Phase 2: Add Place Pause / Resume API

### Goal

Pause breaths for the edited place while authoring, using the hardened place-local pause semantics from Phase 0 rather than a painter-specific shortcut.

### Tasks

- Add a backend API for setting `time_scale` on the current place's active breath state.
- Add a small request path in the frontend for toggling pause/resume.
- Ensure pause operates only on the current edited place.
- Ensure exiting the mode restores normal simulation speed.

### Notes

- The implementation should use the existing `time_scale` field already present on `PlaceBreathState`.
- Pausing should freeze place breaths rather than inventing a new authoring-only snapshot model.

### Reuse Notes

- Extend active-place breath state in `src/interface_program/main.ts`; do not create a parallel editor simulation loop.
- Reuse the current place-touch / active-place infrastructure instead of inventing a second notion of editable active place.

### Success Criteria

- Entering place painter stops live breath advancement for the current place.
- Exiting place painter resumes the place normally.

## Phase 3: Build Place Painter Session Controller

### Goal

Create the in-game editor controller that owns tool/palette/session state.

### Tasks

- Create a dedicated place painter session module or helper in the frontend.
- Store selected tool, selected palette entry, current focused layer, and drag state.
- Expose callbacks that the place module can call when painter mode is active.
- Separate shared painter concepts from standalone-painter-only concerns.

### Reuse Notes

- This is new state, but it should live beside existing game app state and module wiring, not as a second app bootstrap.
- Use `src/canvas_app/painter_app_state.ts` as the wiring template, not as a runtime dependency to embed wholesale.
- Reuse existing persisted module-position patterns if the place-painter panels need saved layout.

### Success Criteria

- Game mode has a stable place-painter state model independent of the standalone ASCII painter app.

## Phase 4: Reuse Painter Modules In Game Mode

### Goal

Bring painter modules into the game as in-game authoring panels.

### Tasks

- Reuse the toolkit module.
- Reuse or adapt the current selected-entry display.
- Reuse the layers UI in selection-only mode.
- Omit color module entirely.
- Omit weight module unless a specific v1 use appears.
- Build module visibility rules for place painter mode.

### Reuse Notes

- Reuse `toolbox_module.ts` directly if possible.
- Reuse `layer_palette_module.ts` in a restricted mode instead of cloning it.
- Reuse any existing selected-brush/preview module that can represent a selected databank entry before building a new one.
- Do not port the entire standalone painter shell into game mode; only port the panels that are actually needed.

### Success Criteria

- Entering place painter exposes a usable set of authoring panels without leaving game mode.

## Phase 5: Build Databank Palette Module

### Goal

Replace the generic glyph selector with a databank-backed authoring palette.

### Tasks

- Create a new palette module for place painter entries.
- Load tile entries from tile storage.
- Load item entries from item storage.
- Resolve display glyphs/colors through the existing resolve helpers.
- Add category/filter/search behavior only if needed for usability in v1.
- Add a special singleton actor-anchor entry.

### Reuse Notes

- This is a true new module because `character_selector_module.ts` is a glyph browser, not a databank browser.
- Reuse existing databank loaders and resolve helpers; do not create duplicate tile/item catalog loaders inside the UI.
- Keep the palette entry model generic enough that future NPC-kind entries can plug in without another rewrite.

### Success Criteria

- The palette shows real game-authoring content rather than raw glyphs.
- The user can select tiles, items, and actor anchor directly from the databanks.

## Phase 6: Branch Place Module Interaction For Painter Mode

### Goal

Make the place viewport behave like an authoring surface while painter mode is active.

### Tasks

- Extend `make_place_module(...)` config with painter-mode hooks.
- Branch click handling in `src/mono_ui/modules/place_module.ts`.
- Disable movement and travel actions while painter mode is active.
- Route pointer events into the place painter session.
- Preserve layer scroll/focus behavior.
- Preserve camera/viewport behavior so large places remain authorable.

### Reuse Notes

- Extend the existing place module; do not build a second dedicated place-painter canvas renderer.
- Reuse existing place hit-testing, viewport math, focus-z logic, and drag/drop entry points.
- Borrow tool semantics from `painter_canvas_module.ts` only where they fit; do not replace the place module with the painter canvas.

### Success Criteria

- The place viewport becomes the authoring canvas without breaking normal game mode outside painter mode.

## Phase 7: Tile Paint And Erase Operations

### Goal

Support direct place tile authoring.

### Tasks

- Add backend endpoints for setting and clearing tiles at `x/y/z`.
- Reuse `set_place_tile_at_world_z(...)` as the low-level authority path.
- Add frontend tool actions for:
  - single-place tile
  - drag-paint tile
  - erase tile
- Ensure edits save and sync the active place immediately.

### Reuse Notes

- Extend the current mutation surface in `src/interface_program/main.ts`; do not create a separate place-authoring service.
- Reuse existing save helpers like `save_place_and_sync_active(...)` rather than inventing a second persistence path.
- If the existing `/api/place/debug/tile` path can be broadened cleanly, prefer extension before creating an all-new endpoint family.

### Success Criteria

- User can draw tiles directly into the current place and remove them again.

## Phase 8: Item Placement

### Goal

Support placing databank-backed items directly into the place.

### Tasks

- Add backend endpoint(s) for item placement in place painter mode.
- Reuse inline-item creation and item databank loading helpers.
- Define placement semantics clearly:
  - ground item at focused `x/y/z`
  - one click places one item stack/unit according to entry defaults
- Add frontend item placement tool behavior.

### Reuse Notes

- Reuse the existing `/api/place/spawn` path if it already covers the needed item spawn semantics cleanly enough.
- Reuse inline item structures and current place refresh flow.
- Do not build a separate item-authoring data model when the existing inline-ground model already fits.

### Success Criteria

- User can place items from the palette into the current place.

## Phase 9: Current Actor Anchor Placement

### Goal

Guarantee there is always one current actor position while allowing the user to move that position authorially.

### Tasks

- Add a dedicated actor-anchor palette entry/tool.
- Add backend move/update endpoint for the current actor anchor.
- On placement:
  - clear the old current actor location
  - set the new one
  - sync actor save and place snapshot together
- Reject operations that would duplicate the actor anchor.

### Reuse Notes

- Reuse the same actor save + place snapshot sync pattern already present in `src/interface_program/main.ts` when actor position is updated.
- Do not create a second actor-position authority separate from actor save data.
- The new work here is the singleton authoring rule and UI tool, not a new actor persistence system.

### Success Criteria

- The current actor can be repositioned reliably with singleton enforcement.

## Phase 10: Entity Move Tool

### Goal

Allow already-present entities to be picked up and moved to another tile in the place.

### Required Behavior

- This tool must support dragging/moving any existing entity we choose to allow in v1.
- At minimum this includes:
  - player actor
  - NPCs already present in the place
  - other place entities that already have position-backed interaction in the place view

### UX Direction

- Reuse the same drag interaction philosophy already used for place item moves where possible.
- Selecting the move tool should switch the place viewport into a pickup-and-drop interaction.
- The user should click/drag an entity from one tile to another tile and commit the move on drop.

### Tasks

- Define which entity types are valid move targets in v1.
- Add hit-testing and drag capture in painter mode.
- Add backend move endpoint(s) for authorial repositioning.
- Update place snapshots and persistent entity saves together.
- Ensure moved entities refresh cleanly in the renderer after the drop.

### Reuse Notes

- Reuse the existing ground item drag/drop UX in `src/canvas_app/app_state.ts` as the interaction model reference.
- Reuse existing place hit-testing and drop-target handling in `place_module.ts` where possible.
- Reuse existing actor/NPC save flows and place snapshot refresh paths in `src/interface_program/main.ts`.
- Do not build a generic scene graph drag system for v1; extend the current drag interaction style.

### Success Criteria

- Existing NPCs and other supported entities can be repositioned directly inside the place via the move tool.

## Phase 11: Persistence, Refresh, And Safety

### Goal

Keep edits authoritative, immediate, and visible.

### Tasks

- Persist every place-painter operation through backend save helpers.
- Refresh active place state immediately after each committed edit.
- Ensure paused places still display edits live.
- Validate bounds and databank ids.
- Decide whether legality is advisory or enforced during authoring.

### Reuse Notes

- Reuse current place refresh helpers already used after item drops/spawns and other mutations.
- Reuse current debug/event logging patterns instead of creating a separate editor log subsystem.

### Recommended Rule

- V1 should prefer free authoring with validation/warnings over hard legality blocking.

### Success Criteria

- No reload is required to see edits.
- Saved place state and live place state remain aligned.

## Phase 12: Verification

### Manual Verification Checklist

- Enter `place_painter` from the current place.
- Confirm breaths stop for the place while authoring.
- Paint tiles on multiple z layers.
- Erase placed tiles.
- Place items from the databank palette.
- Move the current actor anchor and verify only one current actor position exists.
- Move an NPC with the move tool.
- Exit `place_painter` and confirm the simulation resumes.
- Reload the place and verify edits persisted.

### Logging / Debugging Expectations

- Place painter actions should emit clear debug logs for:
  - mode enter/exit
  - pause/resume
  - tile set/erase
  - item placement
  - actor move
  - entity move

## Future Expansion

These are intentionally not part of the required v1 cut, but the design should leave room for them.

### Next Likely Additions

- NPC spawn from kind/NPC databanks
- NPC information editing panels
- edit-in-place entity inspection for authoring
- structure/body-model-aware placement helpers
- brush shapes, fill, line, and rectangle parity with more of the standalone painter
- batch stroke commits and undo/redo for place edits

## Advanced / Assess Later

These items should remain explicitly deferred until the base authoring workflow is stable.

### Layer Reorder

Layer reordering should not be part of the first implementation.

Reason:

- it introduces ambiguity around world-z versus render order
- it is likely to produce bad interactions with multitile structures
- it risks adding authoring complexity before the place-painter data model is stable

Assessment questions for later:

- Do we actually need reorder, or is world-z selection enough?
- If reorder exists, is it visual-only or persisted authoring data?
- How should reorder interact with multitile bodies and structures?

### Full Generic Entity Editing

Do not block the place-painter launch on full editable entity metadata.

Keep the session architecture open for it, but only tackle it after:

- place painting is stable
- item placement is stable
- actor/entity moving is stable
- databank palette UX is proven in real use

## Recommended Build Order

1. mode toggle
2. pause/resume API
3. place painter session controller
4. painter panel reuse in game mode
5. databank palette module
6. place-module interaction branch
7. tile paint/erase
8. item placement
9. current actor anchor
10. entity move tool
11. persistence and verification pass

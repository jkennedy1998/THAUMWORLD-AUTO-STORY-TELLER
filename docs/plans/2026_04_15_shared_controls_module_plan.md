# Shared Controls Module Plan

Date: 2026-04-15

## Intent

Add one shared persistent controls system for both:

- Thaumworld/game
- ASCII painter

The system should:

- unify input binding architecture across both programs
- support keyboard, pointer buttons, and wheel bindings
- allow rebinding through a shared UI module
- persist bindings locally per data slot
- later attach cleanly to user profiles inside a save slot
- avoid hardcoding shortcuts separately in game and painter

This plan is downstream of:

- `docs/plans/2026_04_15_auto_input_debugging_plan.md`
- `docs/plans/2026_04_12_input_host_runtime_plan.md`

This file is the source of truth for controls rebinding architecture.

## Architecture

1. Shared controls runtime
- owns action registry loading, active bindings, conflict checks, persistence, and lookup
- must not depend directly on game modules or painter modules

2. Shared controls UI module
- renders action rows
- allows rebinding by clicking a binding slot and pressing a new input
- shows current binding and conflicts
- reused in both programs

3. Per-system action registries
- global/shared controls
- game controls
- painter controls
- later text-mode/debug overrides

4. Persistent profile store
- saves bindings under local save data for the selected data slot
- later extends to per-user profile inside the slot

## Design Rules

- One controls architecture, multiple action registries.
- Action ids are stable and labels are editable.
- Pointer bindings should be semantic-first:
  - `primary`
  - `secondary`
  - `auxiliary`
  - `wheel_up`
  - `wheel_down`
- Persistence belongs to the controls runtime/store, not the UI module.
- Game and painter should consume bindings through the same runtime pattern.
- Context-specific overrides should be supported without forking the whole system.

## Binding Model

Suggested binding union:

```ts
type ControlBinding =
  | { kind: 'keyboard'; code: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { kind: 'pointer_button'; button: 'primary' | 'secondary' | 'auxiliary' }
  | { kind: 'pointer_gesture'; gesture: 'drag_primary' | 'drag_secondary' | 'hover' }
  | { kind: 'wheel'; direction: 'up' | 'down' | 'left' | 'right'; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
```

Suggested action definition:

```ts
type ControlActionDefinition = {
  id: string;
  label: string;
  category: string;
  system: 'global' | 'game' | 'painter';
  context?: string;
  default_binding: ControlBinding | null;
  allow_multiple?: boolean;
};
```

Suggested stored profile:

```ts
type ControlsProfile = {
  version: 1;
  bindings: Record<string, ControlBinding | null>;
};
```

## Persistence

Current target path:

- `local_data/data_slot_<N>/profiles/controls.json`

Later target path:

- `local_data/data_slot_<N>/profiles/<user_id>/controls.json`

Implementation goals:

- [ ] Load bindings on app boot for the selected data slot.
- [ ] Merge stored bindings over registry defaults.
- [ ] Save immediately on rebind.
- [ ] Ignore unknown actions safely when registries evolve.

## Shared Action Registries

### Global Controls

- [ ] Cancel / Back -> `Escape`
- [ ] UI Scale Up -> `=`
- [ ] UI Scale Down -> `-`
- [ ] Snapshot UI -> `Ctrl+.`
- [ ] Debug Capture -> `Ctrl+/`

### Game Controls

- [ ] Move Up -> `W`
- [ ] Move Down -> `S`
- [ ] Move Left -> `A`
- [ ] Move Right -> `D`
- [ ] Jump -> `Space`
- [ ] Cancel -> `Escape`
- [ ] Game Primary Interact -> `Primary Click`
- [ ] Game Secondary Interact -> `Secondary Click`
- [ ] Game Hover -> `Hover`
- [ ] Game Drag -> `Drag Primary`
- [ ] Game Wheel -> `Wheel`

### Painter Controls: Tool Shortcuts

- [ ] Select Pencil Tool -> `P`
- [ ] Select Eraser Tool -> `E`
- [ ] Select Bucket Tool -> `B`
- [ ] Select Eyedropper Tool -> `I`
- [ ] Select Line Tool -> `L`
- [ ] Select Rect Stroke Tool -> `R`
- [ ] Select Rect Fill Tool -> `S`
- [ ] Select Text Tool -> `T`
- [ ] Select Weight Tool -> `W`
- [ ] Select Color Tool -> `O`
- [ ] Select Rect Selection Tool -> `M`
- [ ] Select Lasso Selection Tool -> `N`
- [ ] Select Copy Tool -> `C`
- [ ] Select Paste Tool -> `V`

### Painter Controls: File / History

- [ ] New File -> `Ctrl+N`
- [ ] Save File -> `Ctrl+S`
- [ ] Load File -> `Ctrl+O`
- [ ] Undo -> `Ctrl+Z`
- [ ] Redo -> `Ctrl+Y`
- [ ] Alternate Redo -> `Ctrl+Shift+Z`
- [ ] Copy Selection -> `Ctrl+C`
- [ ] Clear Canvas -> unbound initially

### Painter Controls: Navigation / Interaction

- [ ] Pan Up -> `ArrowUp`
- [ ] Pan Down -> `ArrowDown`
- [ ] Pan Left -> `ArrowLeft`
- [ ] Pan Right -> `ArrowRight`
- [ ] Alternate Pan Up -> `W`
- [ ] Alternate Pan Down -> `S`
- [ ] Alternate Pan Left -> `A`
- [ ] Alternate Pan Right -> `D`
- [ ] Hold Pan Modifier -> `Space`
- [ ] Focus Plane Up -> `Wheel Up`
- [ ] Focus Plane Down -> `Wheel Down`
- [ ] Focus Voxel XY -> `Primary Click`
- [ ] Painter Primary Tool Use -> `Primary Click`
- [ ] Painter Secondary Tool Use -> `Secondary Click`
- [ ] Painter Primary Drag -> `Drag Primary`
- [ ] Painter Secondary Drag -> `Drag Secondary`
- [ ] Painter Hover -> `Hover`
- [ ] Painter Context Menu -> `Secondary Click`

### Painter Controls: Module Toggles

- [ ] Toggle Toolbox -> unbound
- [ ] Toggle Character Selector -> unbound
- [ ] Toggle Color Selector -> unbound
- [ ] Toggle Weight Selector -> unbound
- [ ] Toggle Brush Preview -> unbound
- [ ] Toggle Tool Properties -> unbound
- [ ] Toggle Layer Palette -> unbound
- [ ] Toggle Camera Panel -> unbound
- [ ] Reset Module Positions -> unbound
- [ ] Reset Camera -> unbound

### Painter Text Mode Controls

These should live in a context override profile:

- [ ] Text Confirm New Line -> `Enter`
- [ ] Exit Text Mode -> `Escape`
- [ ] Delete Backward -> `Backspace`
- [ ] Delete Forward -> `Delete`
- [ ] Text Cursor Left -> `ArrowLeft`
- [ ] Text Cursor Right -> `ArrowRight`
- [ ] Text Cursor Up -> `ArrowUp`
- [ ] Text Cursor Down -> `ArrowDown`
- [ ] Text Insert Space -> `Space`

## Files

Planned runtime files:

- `src/mono_ui/runtime/controls_registry.ts`
- `src/mono_ui/runtime/controls_profile_store.ts`
- `src/mono_ui/runtime/controls_runtime.ts`
- `src/mono_ui/runtime/controls_binding_matcher.ts`

Planned registry files:

- `src/mono_ui/runtime/global_controls_profile.ts`
- `src/mono_ui/runtime/game_controls_profile.ts`
- `src/mono_ui/runtime/painter_controls_profile.ts`
- later `src/mono_ui/runtime/text_mode_controls_profile.ts`

Planned UI file:

- `src/mono_ui/modules/controls_module.ts`

Planned app wiring files:

- `src/canvas_app/controls_wiring.ts`
- `src/canvas_app/painter_controls_wiring.ts`

Likely touched files:

- `src/mono_ui/runtime/input_actions.ts`
- `src/canvas_app/app_state.ts`
- `src/canvas_app/painter_app_state.ts`
- `src/mono_ui/modules/painter_toolbar_module.ts`
- `src/mono_ui/modules/painter_canvas_module.ts`

## Phases

### Phase 1: Controls Core

- [ ] Define action registries.
- [ ] Define binding types.
- [ ] Build shared controls runtime.
- [ ] Build per-slot persistent storage.
- [ ] Build conflict detection.

Acceptance:

- [ ] Defaults load for both programs.
- [ ] Stored bindings override defaults.
- [ ] Unknown bindings do not crash boot.

### Phase 2: Controls UI

- [ ] Build shared controls module.
- [ ] Render action rows by category.
- [ ] Click-to-rebind flow.
- [ ] Show binding conflicts.
- [ ] Allow clearing a binding.

Acceptance:

- [ ] A user can click a binding and remap it.
- [ ] Changes persist after restart.

### Phase 3: Game Wiring

- [ ] Route game movement bindings through controls runtime.
- [ ] Replace hardcoded default game key assumptions with registry-driven defaults.

Acceptance:

- [ ] Rebinding `Move Up` changes gameplay input.
- [ ] Existing TAS/game movement still works.

### Phase 4: Painter Tool Shortcuts

- [ ] Route painter tool shortcuts through controls runtime.
- [ ] Replace hardcoded toolbar shortcut checks.

Acceptance:

- [ ] Rebinding a painter tool shortcut changes tool selection.
- [ ] Toolbox click still works.

### Phase 5: Painter File / History / Navigation

- [ ] Route save/load/new/undo/redo through controls runtime.
- [ ] Route pan keys through controls runtime.
- [ ] Route focus-plane wheel actions through controls runtime.

Acceptance:

- [ ] Rebinding navigation/history actions works.
- [ ] Painter remains fully operable.

### Phase 6: Context Overrides

- [ ] Add painter text-mode controls profile.
- [ ] Add context-sensitive resolution rules.

Acceptance:

- [ ] Text mode uses its own bindings without breaking normal painter shortcuts.

## Testing Plan

- [ ] Load defaults in game mode.
- [ ] Load defaults in painter mode.
- [ ] Rebind one game movement key.
- [ ] Rebind one painter tool key.
- [ ] Persist bindings and reload app.
- [ ] Detect and display conflicts.
- [ ] Verify pointer semantic bindings render correctly in the controls UI.
- [ ] Verify unbound actions remain safe.

## Recommended First Milestone

Implement only:

1. controls registries
2. controls runtime
3. persistent storage
4. controls UI module
5. wire:
- game movement
- painter tool shortcuts

This is the highest-value first slice with the lowest risk.

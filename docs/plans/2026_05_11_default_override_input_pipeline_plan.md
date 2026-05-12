# Default → Override Input Pipeline Plan

Date: 2026-05-11

## Intent

Compare the current input architecture to the desired direction:

- stable default interactions
- explicit override layers
- fewer module-local raw-event interpretations
- clearer ownership of global vs app-default vs modal/tool input

This is a no-code architecture plan.

This plan is intended to fit THAUMWORLD specifically:

- game and painter share the mono UI runtime but do **not** share identical interaction needs
- painter has richer modal/editing interaction states than game
- game movement/jump/cancel currently use a specialized authoritative move-intent path
- existing TAI coverage and logs should be used to verify each cutover
- when a new input path replaces an old one, the old hot-path interpretation should be removed rather than left behind as a shadow fallback

Related docs:

- `docs/plans/2026_04_15_shared_controls_module_plan.md`
- `docs/plans/2026_05_08_unified_pan_runtime_plan.md`
- `docs/plans/2026_05_11_painter_nudge_control_matrix_plan.md`
- `docs/plans/2026_05_11_first_class_wheel_chord_input_plan.md`

---

## Problem Summary

The repo currently has improved bindings and wheel-chord matching, but input ownership is still split across multiple layers:

1. **Runtime-global input handling**
   - `src/mono_ui/runtime/canvas_runtime.ts`
2. **Semantic controls / binding matching**
   - `src/mono_ui/runtime/controls_runtime.ts`
   - `src/mono_ui/runtime/controls_binding_matcher.ts`
   - `src/mono_ui/runtime/painter_controls_profile.ts`
   - `src/mono_ui/runtime/game_controls_profile.ts`
3. **App-level semantic dispatch**
   - `src/canvas_app/painter_app_state.ts`
   - `src/canvas_app/app_state.ts`
4. **Module-local raw event interpretation**
   - `src/mono_ui/modules/painter_canvas_module.ts`
   - `src/mono_ui/modules/place_module.ts`
   - various UI/panel modules
5. **Separate gameplay-input runtime**
   - `src/mono_ui/runtime/shared_input_runtime.ts`
   - `src/mono_ui/runtime/input_actions.ts`

That means the same physical input can still be interpreted by different layers depending on context.

This makes the system feel uneven even when bindings themselves are correct.

---

## Target Direction

The preferred model is:

1. **Global default**
   - app-shell behaviors that should mean the same everywhere
2. **Active override**
   - explicit modal/tool/text/drag/preview ownership
3. **App-default semantic interaction**
   - painter defaults
   - game defaults
4. **Module-local fallback**
   - only for truly local unmatched behavior

Additional project rule:

5. **No replaced legacy hot paths remain active**
   - if a semantic/global/override path fully replaces an older raw interpretation path, the old path must be removed from active routing rather than kept as a hidden backup

In short:

- default meaning first
- override only when explicit
- local guessing last

---

## Current Architecture vs Target Architecture

## A. Runtime-global layer

### Current code

`src/mono_ui/runtime/canvas_runtime.ts` already owns several truly global concerns:

- focus ownership
- text-capture sink behavior
- pointer capture / drag routing
- held modifier state
- held key tracking for wheel chords
- global UI scale on `-` / `=`
- global UI scale on `Ctrl/Meta + Wheel`
- dispatch ordering around global keydown

Relevant areas:

- `dispatch_global_keydown(...)`
- wheel accumulation / routing
- focused owner `WantsTextCapture()` checks

### What is good here

This layer is appropriate for:

- global UI scale
- global focus/text-capture mechanics
- global event normalization
- shared held-state snapshots

### Current mismatch

This layer still contains behavior that is only partly represented in the semantic controls layer.

Example:

- global UI scale is runtime-owned and intentionally bypasses app/module semantics
- this is fine, but it should be treated as a first-class documented global action family

### Target state

Keep runtime-global ownership for:

- UI scale
- event normalization
- focus/text capture plumbing
- authoritative chord snapshot construction

Do **not** let modules or app-default layers re-implement these.

Also, when runtime-global ownership is declared final for an input family, remove superseded app/module equivalents from hot paths.

---

## B. Semantic controls / binding layer

### Current code

The controls system now supports:

- keyboard bindings
- wheel bindings
- held-key wheel chords
- binding persistence
- profile preferences

Relevant files:

- `src/mono_ui/runtime/controls_registry.ts`
- `src/mono_ui/runtime/controls_runtime.ts`
- `src/mono_ui/runtime/controls_binding_matcher.ts`
- `src/mono_ui/runtime/painter_controls_profile.ts`
- `src/mono_ui/runtime/game_controls_profile.ts`

### What is good here

This layer is now much better at describing intent than before.

Examples:

- painter timing actions
- painter position actions
- painter scroll primary/secondary actions
- painter pan wheel chords
- game depth wheel actions

### Current mismatch

The controls layer is still mostly a **matcher**, not a full **owner**.

Today it can answer:

- “does this binding match?”
- “which wheel action matched?”

But it does not yet fully own:

- dispatch precedence across global/app/override/local
- semantic action consumption rules across all input families
- a unified default interaction map per app mode

### Target state

The controls layer should remain the binding/matching description layer, but it should feed a clearer pipeline:

- global action resolution
- override action resolution
- app-default action resolution
- fallback eligibility

It should not be duplicated as:

- resolver in one place
- raw matcher in another
- local event inference in a third

When a binding/action family is promoted into this pipeline, legacy raw interpretation should be demoted to either:

- a clearly documented transitional shim with removal criteria, or
- complete removal

---

## C. App-level semantic dispatch

### Current code

Painter and game app states already do a lot of semantic work.

#### Painter

`src/canvas_app/painter_app_state.ts` currently owns:

- tool shortcut sequence handling
- early-commit buffering rules
- timing actions
- camera swing/roll/depth actions
- positional actions
- transport buffering and playback direction
- controls panel toggle
- leave/commit routing for pending placement
- app-level wheel action resolution via `resolvePainterWheelAction(...)`

#### Game

`src/canvas_app/app_state.ts` currently owns:

- game camera swing/roll/depth keyboard dispatch
- controls toggle
- game wheel action resolution for depth

### What is good here

This is the closest thing the repo already has to an **app-default semantic interaction layer**.

This is where the default interaction policy mostly belongs.

### Current mismatch

This layer is still hand-written per action family and per app.

Examples:

- painter keyboard dispatch is still a long ordered chain of manual checks
- game and painter do not yet share a common app-default dispatch pattern
- some semantic actions are resolved here, but others are still left to modules
- some special cases are still hardcoded to work around conflicts, such as painter `Space`

### Target state

The app layer should become the explicit home for:

- app-default keyboard semantics
- app-default wheel semantics
- app-default action precedence within that app mode

This layer should answer:

- “what does input X mean in painter by default?”
- “what does input X mean in game by default?”

without requiring modules to reinterpret common inputs.

---

## D. Module-local interpretation

### Current code

#### Painter canvas

`src/mono_ui/modules/painter_canvas_module.ts` now does semantic wheel resolution first, which is good.

But it still performs substantial local interpretation afterward:

- space-pan gesture behavior
- move-preview wheel depth behavior
- selection-drag wheel depth behavior
- shift-wheel fallback behavior
- text-mode keyboard ownership
- canvas-local preview/transform behaviors

#### Place module

`src/mono_ui/modules/place_module.ts` currently does:

1. resolved semantic wheel action
2. raw binding-match fallback
3. raw event depth fallback

This is a clear example of layered redundancy.

### What is good here

Modules do need to own some input behavior.

Good examples of true module ownership:

- text editing cursor motion in painter text mode
- selection drag specifics
- move/paste preview manipulation specifics
- place-tile click targeting logic
- local list/panel scrolling

### Current mismatch

Modules are still being asked to do too much interpretation for common/default inputs.

This causes:

- duplicated precedence logic
- semantic path + raw fallback path in the same handler
- different behavior shapes across painter vs game vs panels
- replaced behavior families lingering as shadow logic after a new semantic path is introduced

### Target state

Modules should mostly do one of three things:

1. execute a semantic action requested by higher layers
2. own a true local/modal override
3. provide final fallback for unmatched local UI behavior

Modules should do much less:

- guessing default meaning from raw key/wheel input
- duplicating binding checks after app-level resolution already happened
- retaining legacy parallel interpretations once an input family has a new owner

---

## E. Separate gameplay input runtime

### Current code

`src/mono_ui/runtime/shared_input_runtime.ts` and `src/mono_ui/runtime/input_actions.ts` power gameplay movement intent.

This is a separate abstraction from the controls profiles/bindings used for painter/game view controls.

### What is good here

The gameplay runtime is useful for:

- held movement intent
- movement press/release sequencing
- worker/bridge transport
- authoritative gameplay input posting

### Current mismatch

This creates a second input architecture in the same repo:

- gameplay input runtime for move/jump/cancel
- controls runtime for semantic bindings/actions

That split is not necessarily wrong, but it increases conceptual overhead.

### Target state

Near-term:

- keep gameplay intent runtime separate
- treat it as an intentional special-case subsystem for authoritative movement/jump/cancel transport
- document it clearly as a specialized subsystem

Longer-term:

- consider aligning naming, precedence, and context concepts with the controls/action pipeline
- avoid building a third parallel ownership model
- do **not** force painter-style action dispatch onto authoritative gameplay move-intent posting unless there is a strong reason

---

## Where Current Code Already Matches the Target

## 1. Global UI scale

This is now clearly global and consistent.

Good fit for target layer:

- **Global default**

## 2. Painter numeric tool sequences

These are app-level semantic behaviors and are not buried in the module anymore.

Good fit for target layer:

- **App-default semantic interaction**

## 3. Painter time nudge / view nudge / positional nudge

These are mostly app-level semantic actions now.

Good fit for target layer:

- **App-default semantic interaction**

## 4. Text-mode arrow ownership in painter

This remains a strong example of a true explicit override.

Good fit for target layer:

- **Active override**

## 5. Wheel chord matching with held keys

This is strong shared infrastructure.

Good fit for target layer:

- **Global normalization + semantic binding support**

---

## Where Current Code Still Diverges from the Target

## 1. Duplicate wheel resolution paths in modules

### Current

`place_module.ts` still does:

- resolved semantic action
- then `matches_wheel_binding(...)`
- then raw event fallback

### Desired

- resolved semantic action
- else explicit app/module-approved fallback only

No extra duplicate binding pass.

### Cleanup rule

When this is migrated, remove the duplicate `matches_wheel_binding(...)` hot path rather than leaving it behind as a backup.

## 2. Painter module still contains default-like wheel behavior

### Current

`painter_canvas_module.ts` semantic resolution is good, but local wheel fallback still covers some behavior that feels closer to app-default interaction policy.

Examples to evaluate:

- shift-wheel fallback to primary scroll mode
- space-pan local branch after semantic resolution
- move-preview depth wheel and selection-drag depth wheel, which may be true overrides rather than defaults

### Desired

Move stable default meanings to app-default dispatch.

Keep only truly modal/local canvas behaviors in module fallback.

### Cleanup rule

Any painter wheel branch classified as app-default should be removed from raw module fallback after promotion.

## 3. App-level keyboard dispatch is still bespoke long-form logic

### Current

`painter_app_state.ts` and `app_state.ts` each contain manual ordered action chains.

### Desired

Introduce a clearer internal structure such as:

- global actions
- override actions
- app-default action families
- local fallback delegation

without requiring a giant rewrite.

## 4. Module-local fallback rules are not yet standardized

### Current

Different modules answer unmatched input differently.

### Desired

Define explicit fallback policy:

- panels/lists may scroll locally
- canvas may run local modal interaction logic
- unmatched default inputs should not be re-guessed in multiple places

## 5. Gameplay input runtime remains conceptually separate

### Current

Movement intent lives in a different abstraction family.

### Desired

At minimum, document that split so future work does not accidentally create a third system.

---

## Proposed Default → Override Pipeline

## Stage 0: Normalize raw input once

Owned by runtime.

Responsibilities:

- normalize raw DOM input
- compute authoritative modifier state
- compute held-key snapshot
- identify focused owner
- identify typing/text-capture context
- identify active app mode

## Stage 1: Global default actions

Owned by runtime/app shell.

Examples:

- global UI scale
- global controls panel toggle if truly global
- other true shell-level actions

These should be consuming.

## Stage 2: Active override actions

Owned by app state, delegated to explicit interaction owners.

Examples:

- painter text capture
- painter move preview
n- painter paste preview
- painter selection drag
- game modal targeting if introduced later
- focused text field/panel capture

These should be explicit and queryable, not accidental raw-event branches.

Suggested shape:

- `get_active_input_override(): InputOverride | null`
- `override.try_handle_keydown(...)`
- `override.try_handle_wheel(...)`

## Stage 3: App-default semantic actions

Owned by app state.

Examples:

### Painter
- timing actions
- transport actions
- view nudge actions
- positional actions
- default scroll primary/secondary actions
- semantic wheel pan chords
- numeric tool sequence ownership

### Game
- view swing/roll/depth actions
- default depth wheel actions
- gameplay command shortcuts not handled by move-intent runtime

This should be the main stable meaning layer.

## Stage 4: Module-local fallback

Owned by module only when still unmatched.

Examples:

- list/panel scrolling
- local widget focus behavior
- niche interaction behavior not yet promoted

This should not re-run broad semantic matching if earlier layers already had that responsibility.

---

## Suggested Ownership by Input Family

## Keyboard

### Global
- UI scale if keyboard shortcuts remain global
- maybe shell-level controls toggle

### Override
- text capture
- modal preview/placement/transform modes

### App-default
- painter timing/view/position/tool-sequence actions
- game camera actions

### Local fallback
- focused widget-specific handling

## Wheel

### Global
- UI scale on `Ctrl/Meta + Wheel`

### Override
- modal preview/drag-specific wheel behavior
- focused panel/list wheel capture

### App-default
- painter primary/secondary scroll semantics
- painter semantic pan chords
- game depth wheel

### Local fallback
- unmatched widget scrolling only

## Pointer

### Global
- normalization
- capture
- drag threshold
- held button snapshot

### Override
- active drag/selection/move sessions

### App-default
- probably lighter here; pointer is more module-specific by nature

### Local fallback
- click/drag behavior in canvas/place/panels

---

## Migration Guidance

## Phase 1: document ownership explicitly

Add comments/docs naming the four layers for existing code.

Goal:

- stop accidental routing changes
- make future edits target the correct layer
- identify every currently active legacy/shadow interpretation that must be removed at cutover

## Phase 2: remove duplicate semantic checks from modules

Priority examples:

- `src/mono_ui/modules/place_module.ts`
  - remove post-resolver duplicate binding checks
- review painter canvas fallback branches and classify each as:
  - app-default
  - true override
  - local fallback

Rule:

- every promoted path needs a paired legacy-path deletion checklist entry
- no migration step is considered complete if old and new hot paths both still own the same gesture family

## Phase 3: introduce a lightweight override contract

No full rewrite required.

Possible small interface:

```ts
type InputOverride = {
  id: string;
  try_handle_keydown?: (e: KeyboardEvent) => boolean;
  try_handle_keyup?: (e: KeyboardEvent) => boolean;
  try_handle_wheel?: (e: WheelEvent) => boolean;
};
```

App state can expose the currently active override based on current mode/tool/session.

## Phase 4: formalize app-default dispatch helpers

Refactor long manual action chains into grouped dispatch helpers.

Examples:

- `tryHandlePainterDefaultKeyboardAction(e)`
- `tryHandlePainterDefaultWheelAction(e)`
- `tryHandleGameDefaultKeyboardAction(e)`
- `tryHandleGameDefaultWheelAction(e)`

## Phase 5: decide relationship with gameplay input runtime

Do not merge blindly.

Instead:

- document where gameplay intent is special
- align naming and precedence where useful

---

## Project Fit Notes

1. **This repo should keep gameplay move intent separate for now**
   - `shared_input_runtime` / `input_actions` are specialized for authoritative game movement transport
   - the default→override pipeline should coexist with that system, not pretend it already replaced it

2. **Painter is the strongest candidate for explicit override architecture**
   - text capture
   - move preview
   - paste preview
   - selection drag
   - future modal transforms

3. **Game should adopt the pipeline more conservatively**
   - default camera/depth semantics can move into clearer app-default handling
   - movement/jump/cancel should remain on the existing authoritative path until a dedicated plan changes that

4. **TAI should be part of each cutover**
   - whenever a legacy input path is removed, add or update focused automation coverage for the new owner path

## Recommended Near-Term Decisions

1. **Treat global UI scale as a locked global family**
   - not painter-specific
   - not game-specific

2. **Treat painter text mode and pending placement modes as explicit overrides**
   - not mere local fallbacks

3. **Treat painter timing/view/position/scroll defaults as app-default interaction**
   - app-level, not module-guessed

4. **Treat place/game default depth wheel as app-default interaction**
   - not duplicated in module-local raw fallback plus semantic path

5. **Reduce duplicate binding checks inside modules after semantic resolution exists**

---

## Short Comparison Table

| Area | Current Code | Target Direction |
|---|---|---|
| Global UI scale | Runtime-owned, now consistent | Keep global |
| Painter keyboard defaults | App-level but bespoke/manual | Keep app-level, formalize as default dispatch |
| Painter wheel defaults | Shared resolver + module fallback mix | App-default semantics first, module fallback only for true local cases |
| Game wheel depth | Resolver + matcher + raw fallback | Resolver/app-default + minimal fallback |
| Text mode | Module-owned implicit override | Keep, but label as explicit override |
| Move/paste/selection preview input | Mixed app/module behavior | Keep as explicit override family |
| Gameplay move intent | Separate runtime subsystem | Keep separate for now, document relationship |

---

## Conclusion

The repo is already moving toward the right model, especially in painter.

But the current code still mixes:

- global handling
- semantic action matching
- app-level dispatch
- module-local raw interpretation
- separate gameplay intent runtime

The next architectural improvement should not be a giant rewrite.

It should be a clearer pipeline:

- **global default**
- **active override**
- **app-default semantic interaction**
- **module-local fallback**

And for this project specifically, the migration standard should be:

- when a new owner replaces an old input path, the old hot path must be removed or explicitly marked transitional with a removal target
- no hidden legacy interpretation should remain active for the same gesture family after cutover

That direction matches both the current successful work and the desired future input feel.

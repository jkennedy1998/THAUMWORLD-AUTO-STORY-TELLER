# First-Class Wheel / Chord Input Plan

Date: 2026-05-11

## Intent

Promote scroll/wheel input to a first-class control trigger in the shared input system so wheel combos behave consistently across painter and game.

This plan focuses on:

- wheel as a first-class input source
- reliable combo/chord handling across keyboard, pointer, and wheel
- shared semantic action resolution before module-local behavior
- eliminating wheel fallthrough ambiguity

This plan is downstream of:

- `docs/plans/2026_04_15_shared_controls_module_plan.md`
- `docs/plans/2026_05_08_unified_pan_runtime_plan.md`
- `docs/plans/2026_05_11_painter_nudge_control_matrix_plan.md`

## Problem Statement

Current wheel behavior is still split across multiple layers:

- raw canvas/module `OnWheel(...)` handlers
- controls binding matching
- runtime modifier tracking
- module-local gesture fallbacks
- tool/mode-specific wheel branches

That split causes inconsistent combo behavior, especially for:

- `Ctrl+Scroll`
- `Meta+Scroll`
- `Alt+Scroll`
- `Space+Scroll`
- `Alt+Space+Scroll`

Current symptoms show that wheel is not yet a true first-class control path:

- manual `Ctrl+Scroll` behavior disagrees with expected zoom semantics
- wheel combos can depend on where held-state is read from
- if one wheel interpretation misses, another local interpretation may still run
- module-local fallthrough can cause wheel gestures to do edit/manipulation work instead of the intended semantic action

## Design Thesis

Wheel should be handled like every other major input family:

1. raw input is normalized once
2. held-state/chord state is resolved once
3. semantic action matching happens before module-local interpretation
4. matched actions are exclusive/consuming
5. modules execute actions rather than guessing at raw wheel meaning

The system should treat a wheel combo as:

- "user performed chord X in context Y"

not as:

- "module received a wheel event and inferred meaning locally"

## Locked Design Goals

### 1. Wheel is a first-class trigger

Wheel should be represented in the shared controls/input model at the same level as keyboard and pointer input.

### 2. Chord state is shared and authoritative

Wheel combos must resolve against one shared held-state snapshot, not against ad hoc local event truth.

That includes:

- modifiers: `Ctrl`, `Shift`, `Alt`, `Meta`
- non-modifier held keys used as gesture qualifiers, especially `Space`
- pointer button state where relevant
- focused owner/view
- app context
- interaction/tool context

### 3. Semantic action resolution comes before module-local wheel behavior

If a wheel chord matches a semantic action, that action owns the gesture.

Module-local fallback should not reinterpret the same wheel gesture.

### 4. Mixed wheel chords are first-class bindings

The controls system must support bindings such as:

- `Ctrl + WheelUp`
- `Space + WheelDown`
- `Alt + Space + WheelUp`

These should not require bespoke painter-only conditionals.

### 5. Precedence must be explicit

Recommended priority:

1. mixed wheel chord bindings with held non-modifier keys
2. wheel + modifier bindings
3. plain wheel bindings
4. only if unmatched, context-local wheel behavior

### 6. Matched wheel chords are consuming

Once the input system resolves a wheel action, lower-level wheel behaviors must not also run.

### 7. Painter and game share the same wheel-chord machinery

Painter may define richer wheel semantics than game, but the matcher/runtime path should be shared.

## Target Architecture

## A. Shared input snapshot

Introduce or extend a shared input snapshot object used during action resolution.

Suggested contents:

```ts
type InputChordSnapshot = {
  mods: {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  };
  held_keys: Set<string>;
  held_pointer_buttons: Set<'primary' | 'secondary' | 'auxiliary'>;
  focused_owner_id: string | null;
  focused_view_id: string | null;
  app_context: 'game' | 'painter' | 'global';
  interaction_context?: string;
  active_tool_id?: string | null;
};
```

Wheel matching must use this snapshot, not only raw wheel event fields.

## B. First-class wheel trigger model

Extend the binding model so wheel bindings can express both modifiers and held non-modifier keys.

Suggested direction:

```ts
type WheelHeldKey = 'Space' | string;

type ControlBinding =
  | { kind: 'keyboard'; code: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
  | { kind: 'pointer_button'; button: 'primary' | 'secondary' | 'auxiliary' }
  | { kind: 'pointer_gesture'; gesture: 'drag_primary' | 'drag_secondary' | 'hover' }
  | {
      kind: 'wheel';
      direction: 'up' | 'down' | 'left' | 'right';
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
      held_keys?: string[];
    };
```

Near-term required support:

- `held_keys: ['Space']`
- modifiers + held keys together

## C. Shared wheel action matcher

Add a shared matcher that evaluates:

- wheel direction
- shared modifier state
- shared held-key state
- active context

Suggested API shape:

```ts
resolve_wheel_action(runtime, snapshot, wheelEvent, candidateActionIds?)
  => { action_id: string; consume: true } | null
```

This should live beside existing controls matching utilities, not inside painter modules.

## D. Semantic dispatch layer

Painter/game should consume wheel through semantic actions, not raw wheel conditionals.

Example semantic actions:

### Painter

- `painter.view.zoom_in`
- `painter.view.zoom_out`
- `painter.scroll.primary_prev`
- `painter.scroll.primary_next`
- `painter.scroll.secondary_prev`
- `painter.scroll.secondary_next`
- `painter.scroll.pan_vertical_prev`
- `painter.scroll.pan_vertical_next`
- `painter.scroll.pan_horizontal_prev`
- `painter.scroll.pan_horizontal_next`

### Game

- `game.scroll.depth_prev`
- `game.scroll.depth_next`

Note: existing painter wheel actions under `painter.scroll.*` may remain, but the resolution path should become centralized and semantic.

## E. Module execution contract

Modules should expose semantic wheel/action handlers, not be forced to parse raw wheel combos directly.

For painter this may mean:

- app-level wheel action dispatch chooses semantic intent
- module methods execute zoom/pan/depth/breath actions
- raw `OnWheel(...)` becomes a thin forwarder or a final unmatched fallback path only

## Migration Plan

## Phase 0: document and instrument

Goals:

- stop guessing
- trace real wheel ownership and chord state

Tasks:

- add temporary diagnostics around wheel dispatch
- log shared held-state snapshot at wheel resolution time
- log matched action id vs unmatched fallback path
- log focused owner/view and active interaction/tool state

Exit condition:

- one known manual `Ctrl+Scroll` repro is traceable end-to-end

## Phase 1: make shared held-state authoritative for wheel

Goals:

- ensure wheel resolution sees the same chord truth as keyboard/pointer logic

Tasks:

- formalize shared chord snapshot in runtime
- ensure wheel matching reads runtime held-state, not only raw event modifier fields
- include held non-modifier keys needed for gesture chords, especially `Space`

Exit condition:

- wheel combo resolution can depend on held `Space` and modifiers without module-local hacks

## Phase 2: extend binding model for mixed wheel chords

Goals:

- represent wheel combos directly in controls data

Tasks:

- extend `ControlBinding` wheel shape with `held_keys?: string[]`
- update formatting, conflict keys, persistence, schema compatibility if needed
- update controls UI display strings for wheel chords
- decide whether controls UI rebinding can capture held non-modifier keys immediately or whether `Space` combos are temporarily seeded/default-only

Exit condition:

- controls runtime can store and match `Space + Wheel` style bindings

## Phase 3: centralize wheel action resolution

Goals:

- one shared wheel matching path before module-local behavior

Tasks:

- add shared `resolve_wheel_action(...)` helper/runtime path
- use ordered precedence for matching:
  1. wheel + held-key chords
  2. wheel + modifiers
  3. plain wheel
- return a consuming semantic action result when matched

Exit condition:

- wheel action resolution is app/shared-input owned, not painter-module owned

## Phase 4: migrate painter to semantic wheel dispatch

Goals:

- painter wheel behavior matches keyboard semantics and control bindings cleanly

Tasks:

- move painter wheel branching out of `painter_canvas_module.ts` hot-path conditionals
- route resolved wheel actions through app-level painter dispatch
- have dispatch call the same execution methods as keyboard where desired
- make `Ctrl/Meta+Scroll` resolve to the same zoom execution path as `-` / `=`
- keep unmatched painter-specific local wheel behaviors only where truly intentional

Important rule:

- matched wheel actions must consume the gesture and block lower-level reinterpretation

Exit condition:

- `Ctrl+Scroll` and `-` / `=` are visibly the same zoom path in live use

## Phase 5: migrate fixed gesture-style wheel chords into bindings where appropriate

Goals:

- reduce painter-only special cases

Candidate bindings:

- `Space + WheelUp` / `Space + WheelDown` for vertical pan
- `Alt + Space + WheelUp` / `Alt + Space + WheelDown` for horizontal pan

Decision note:

- if some gestures remain intentionally engine-reserved rather than user-remappable, document that explicitly
- otherwise express them as first-class controls bindings

Exit condition:

- wheel combos no longer depend on bespoke modifier branches in painter module code unless intentionally reserved

## Phase 6: align game wheel routing with the same machinery

Goals:

- reuse the same wheel-chord resolution path for game

Tasks:

- route game depth wheel through shared resolver
- keep game action set minimal for now
- ensure no painter-only assumptions leak into the shared wheel runtime

Exit condition:

- painter and game use the same shared wheel/chord resolution layer

## Phase 7: cleanup and remove ambiguous fallback paths

Goals:

- reduce future regressions from duplicate wheel logic

Tasks:

- remove redundant wheel combo checks that are superseded by shared resolution
- reduce module-local raw wheel interpretation to clearly documented unmatched behavior only
- audit all wheel fallthrough paths for accidental content mutation/manipulation behavior

Exit condition:

- no hot-path duplicate wheel combo interpreters remain

## Controls / UX Considerations

## Binding display

Wheel bindings should display clearly, for example:

- `Wheel Up`
- `Ctrl+Wheel Up`
- `Space+Wheel Down`
- `Alt+Space+Wheel Up`

## Rebinding capture

Open question:

- whether the controls UI should immediately support capturing held non-modifier keys for wheel chords

Recommended staged approach:

1. support persistence/matching/display first
2. seed initial bindings in code/defaults
3. add full UI capture once wheel chord matching is stable

## Context ownership

The wheel system should remain semantic-first, but may still allow context gating at dispatch time:

- text capture
n- active selection drag
- move preview
- paste preview

However, context should influence whether a resolved semantic action is allowed, not whether raw wheel input gets reinterpreted in multiple places.

## Testing Plan

## Required manual validations

- `Ctrl+Scroll` zoom matches `-` / `=`
- `Meta+Scroll` parity where applicable
- `Space+Scroll` vertical pan
- `Alt+Space+Scroll` horizontal pan
- `Alt+Scroll` alternate wheel mode
- plain scroll primary mode toggle behavior
- wheel combos during selection drag
- wheel combos during move preview
- wheel combos during paste preview
- wheel behavior during text capture

## Required TAI / regression coverage

Add focused coverage for:

- wheel chord matching using runtime held-state
- `Ctrl+Scroll` zoom parity with keyboard zoom path
- `Space+Scroll` / `Alt+Space+Scroll`
- painter plain/alternate scroll mode routing
- loop-aware wheel breath stepping
- game depth wheel routing
- unmatched wheel behavior not mutating content unexpectedly

## Open Questions

1. Should `Space + Wheel` and `Alt + Space + Wheel` be user-remappable controls or engine-reserved gestures?
2. Do we want wheel-left/wheel-right as first-class user-facing bindings now, or only vertical semantic direction plus held-modifier semantics?
3. Should wheel action matching expose context constraints directly in bindings, or should context remain app-level dispatch policy only?
4. How much of current move-preview / selection-drag wheel behavior should remain as local unmatched behavior once shared wheel resolution is in place?

## Recommended Near-Term Execution Order

1. instrument live wheel routing
2. add shared chord snapshot for wheel matching
3. extend wheel bindings with held keys
4. centralize wheel action resolution
5. migrate painter `Ctrl/Meta+Scroll` to shared semantic zoom path
6. migrate `Space+Scroll` and `Alt+Space+Scroll`
7. align game depth wheel on the same runtime
8. remove duplicate/raw fallback paths

## Success Criteria

This plan is successful when:

- wheel is treated as a first-class input trigger in the shared controls system
- wheel combos resolve from one authoritative chord state
- `Ctrl+Scroll` behaves identically to keyboard zoom semantics in painter
- matched wheel chords are consuming and do not fall through into edit/manipulation behavior
- painter and game share the same wheel/chord matching path
- future wheel combos can be added without bespoke module-local gesture code

# Painter Nudge / Time / View Control Matrix Plan

Date: 2026-05-11

## Intent

Lock in a production-oriented painter control matrix before implementation.

This plan replaces the current mixed model of:

- mapped controls for some painter actions
- legacy hardwired keyboard handling for other painter actions
- arrow/WASD pan behavior that bypasses the controls runtime
- tool-specific transform shortcuts that are not yet expressed as first-class control intents

The target is one integrated system where:

1. **time nudge** is a first-class controls category
2. **view nudge** is a first-class controls category
3. **positional nudge** is a first-class controls category
4. **double-tap secondary-hand behavior** is preserved and extended
5. **tool + hand + mode** decide how positional nudges apply
6. **no hot-path legacy hardwired painter keyboard controls remain** after migration

This plan must stay aligned with the existing shared controls runtime and current painter architecture.

---

## Design Thesis

The painter needs a stable, memorable control matrix based on what the user is trying to do, not on whichever module happens to currently own a hardcoded keyboard branch.

The three main nudge families are:

- **Time nudge**: move through animation timing
- **View nudge**: move or rotate the camera/view state
- **Positional nudge**: move or rotate authored content or tool-owned transforms

These should be permanently separated in the keyboard layout.

### Locked UX rules

1. **Camera controls should always be camera controls.**
   - Numpad camera cluster must never secretly become timeline or object movement.

2. **Arrow keys should always be time-adjacent.**
   - Arrows are not camera pan.
   - Arrows are not generic canvas pan.
   - Arrows drive timeline navigation and group-range jumps.

3. **Positional authoring keys should always be positional.**
   - WASD / Z X / Q E are for moving or rotating content/tool-owned transforms.
   - They should not be reused for camera pan.

4. **Space + drag remains the pan gesture.**
   - Keyboard pan is not a priority target for painter.
   - We should not preserve pan shortcuts that compete with higher-value animation/editing shortcuts.

5. **Double-tap remains part of the design.**
   - Existing deferred-single / confirmed-double behavior already exists for tool assignment.
   - The same interaction model should be reused for positional swing actions.

6. **No legacy hardwired painter keyboard paths remain in hot paths after migration.**
   - Keyboard behavior must route through the shared controls system and a unified painter control dispatcher.

---

## Proposed Default Control Matrix

## 1. Time nudge

These are always timing-oriented.

- `ArrowLeft` = previous frame
- `ArrowRight` = next frame
- `ArrowDown` = first breath of active group
- `ArrowUp` = last breath of active group

Future expansion can reserve double taps for larger timing motions later, but initial implementation should lock the above single-tap behavior first.

### User-facing action family

- `painter.time.nudge_back`
- `painter.time.nudge_forward`
- `painter.time.jump_active_group_start`
- `painter.time.jump_active_group_end`

These are timing actions, not group-edit actions and not camera actions.

---

## 2. View nudge

These are always camera/view-oriented.

- `Numpad8` = swing up
- `Numpad4` = swing left
- `Numpad6` = swing right
- `Numpad2` = swing down
- `Numpad7` = roll left
- `Numpad9` = roll right
- `Numpad1` = depth previous / traverse depth back
- `Numpad3` = depth next / traverse depth forward

### User-facing action family

- `painter.view.swing_up`
- `painter.view.swing_left`
- `painter.view.swing_right`
- `painter.view.swing_down`
- `painter.view.roll_left`
- `painter.view.roll_right`
- `painter.view.depth_prev`
- `painter.view.depth_next`

These remain camera actions regardless of tool.

---

## 3. Positional nudge

These are always tool-space/content-space actions.

- `W` = positional up
- `A` = positional left
- `S` = positional down
- `D` = positional right
- `Z` = positional backward
- `X` = positional forward
- `Q` = rotate left
- `E` = rotate right

### Double-tap positional swing

Retain the double-tap plan as part of the initial implementation.

- `W W` = positional swing up
- `A A` = positional swing left
- `S S` = positional swing down
- `D D` = positional swing right

Single-tap actions must remain deferred until the double-tap window expires, using the same basic model already present in `src/canvas_app/painter_tool_shortcut_interpreter.ts`.

### User-facing action family

Single tap:

- `painter.position.nudge_up`
- `painter.position.nudge_left`
- `painter.position.nudge_down`
- `painter.position.nudge_right`
- `painter.position.nudge_backward`
- `painter.position.nudge_forward`
- `painter.position.rotate_left`
- `painter.position.rotate_right`

Double tap:

- `painter.position.swing_up`
- `painter.position.swing_left`
- `painter.position.swing_down`
- `painter.position.swing_right`

These actions are semantic; their target behavior depends on tool + hand + mode.

---

## Handedness Model

A key requirement is a user-controlled **primary hand** model:

- **left hand** = primary click tool
- **right hand** = secondary click tool

This matters for:

- VR-friendly input mapping
- power users matching cross-program workflows
- allowing positional keys to affect the currently intended tool-hand, not just the globally selected left-click tool

## Locked handedness rule

Positional actions must route through a hand-aware dispatcher.

### Initial recommendation

Positional control actions should be defined as hand-scoped semantic actions at dispatch time, even if the stored bindings remain shared:

- `painter.position.primary_hand.nudge_left`
- `painter.position.primary_hand.nudge_right`
- ...
- `painter.position.secondary_hand.nudge_left`
- `painter.position.secondary_hand.nudge_right`
- ...

However, for the first implementation pass, we do **not** need two totally separate default key matrices.

Instead:

1. keep one default key family for positional actions
2. resolve whether those positional actions target the primary-hand tool or secondary-hand tool based on current interaction mode / explicit hand target state
3. keep the action model ready for a future per-hand rebind surface if desired

### Initial routing decision

For initial implementation, route positional keys to the **active tool hand context**:

- if the user is actively operating primary-hand tool state, positional actions affect primary-hand tool behavior
- if the user is actively operating secondary-hand tool state, positional actions affect secondary-hand tool behavior
- if there is no explicit active hand override, default to primary-hand tool context

A later UI pass can expose an explicit hand target toggle if needed.

---

## Tool Routing for Positional Actions

Positional actions should be meaningful for these tools first:

- **move tool**
- **paste tool**
- **text tool**
- **selection tools**

The user explicitly wants selection tools to map to **moving the selection only**.

### Initial routing matrix

#### Move tool

Single-tap positional actions:

- move active authored object/group/selection by 1 unit in tool space
- Z/X apply depth/back-forward positional movement if supported by tool/runtime
- Q/E rotate left/right if supported

Double-tap swing:

- apply positional swing transform to current move target

#### Paste tool

Single-tap positional actions:

- move paste preview / transform target in tool space
- Z/X shift paste transform depth/back-forward
- Q/E rotate paste transform

Double-tap swing:

- swing paste transform

This should absorb and replace current special-case paste transform keyboard branches once the semantic action dispatcher exists.

#### Text tool

Single-tap positional actions:

- move text cursor / text insertion anchor in tool space
- where a world/text anchor exists, movement should use that authored anchor rather than camera pan
- Z/X can adjust text plane/depth anchor only if that behavior is explicitly valid; otherwise no-op with status feedback
- Q/E rotate text insertion orientation only if text orientation support exists; otherwise no-op with status feedback

Double-tap swing:

- only if text orientation system supports it; otherwise explicitly unsupported in v1

#### Rect / lasso / selection-related tools

Single-tap positional actions:

- move current selection only
- do not re-interpret these as camera pan
- do not mutate non-selected world content directly

Double-tap swing:

- swing selected transform payload only if selection transform representation exists; otherwise defer to future work

---

## Current State Audit

Before implementation, the current painter hot-path keyboard behavior should be treated as follows.

### Existing mapped actions already in place

`src/mono_ui/runtime/painter_controls_profile.ts`

- camera swing / roll / depth actions
- timing step / play / document jump actions
- group nudge actions
- tool assignment actions

### Existing app-level routing already in place

`src/canvas_app/painter_app_state.ts`

- mapped keydown handling for camera swing/roll/depth
- mapped keydown handling for group nudges
- mapped keydown handling for timing actions
- special-case paste transform routing while invert is held

### Existing legacy hardwired keyboard handling still present

`src/mono_ui/modules/painter_canvas_module.ts`

Observed local hardwired key paths include:

- non-text-mode arrow/WASD camera pan
- move preview key nudges on numpad
- text-mode raw arrow cursor movement
- wheel modifier-based pan shortcuts

This module must end the migration with only:

- text-entry-local text behavior that truly belongs to text capture
- pointer/gesture handling
- calls into semantic action handlers when needed

It must not remain a second hidden keyboard controls system.

---

## Architecture Direction

## 1. Keep the shared controls runtime

This work must build on the current shared controls architecture, not bypass it.

Relevant foundation:

- `src/mono_ui/runtime/controls_registry.ts`
- `src/mono_ui/runtime/controls_binding_matcher.ts`
- `src/mono_ui/runtime/painter_controls_profile.ts`
- `src/canvas_app/painter_app_state.ts`

## 2. Move to semantic action families

Painter control definitions should be reorganized around stable user-facing families:

- **Time**
- **View**
- **Position**
- **Tools**
- **Global / Panels**

This is better than mixing implementation-target-specific actions into one flat list.

## 3. Add a unified painter keyboard dispatcher

App-level keyboard handling in `painter_app_state.ts` should become the single owner of painter keyboard shortcut routing.

That dispatcher should:

1. evaluate modal/text capture guards
2. resolve control binding match
3. route semantic action to painter runtime helper
4. emit status/debug logging if action is unsupported in current tool/mode

## 4. Introduce a semantic positional action router

Add a central helper family conceptually like:

- `routePainterPositionalAction(actionId, handContext)`
- `routePainterTimeAction(actionId)`
- `routePainterViewAction(actionId)`

Positional routing then branches by:

- current tool
- active hand context
- explicit mode constraints
- availability of tool-specific transform support

---

## Multi-Tap / Numeric Sequence Integration Plan

The current tool shortcut double-tap interpreter is proof that the product already accepts deferred-single / confirmed-double semantics.

Reference:

- `src/canvas_app/painter_tool_shortcut_interpreter.ts`

## Plan

Create a generalized multi-tap / buffered-sequence interpreter for painter keyboard actions.

This interpreter should support two related behaviors:

1. **double-tap semantic actions**
   - example: `W` single = nudge up, `W W` = swing up

2. **numeric tool sequence actions**
   - example: `1`, `2`, `9`, `10`, `11`, `12`
   - resolved tool token then feeds into primary-vs-secondary hand assignment behavior

### Shared buffer window

The numeric-sequence buffer window and the double-tap confirmation window should use the same timing source.

Reason:

- one product-wide "multi-tap / multi-press" feel
- easier tuning later
- easier user configurability later
- better consistency between tool assignment and positional double-tap semantics

This timing should be treated as a shared engine/runtime input parameter so it can later be reused by painter and game.

### Requirements

- must delay single-tap positional WASD action long enough to detect double tap
- must support buffered top-row digit sequences for tool selection
- must use the same timing window for numeric buffering and double-tap confirmation
- must remain automation-safe and deterministic
- must not produce both single and double action for one key burst
- must be disabled during text capture / type mode when numeric typing should remain literal
- must be designed for later reuse by game input flows as well

### Early commit assist for fast users

To avoid the system feeling laggy, single buffered actions should be allowed to commit **before** the timer expires when later user intent makes the action unambiguous.

Example:

- user presses `1`
- tool selection is pending inside the numeric buffer window
- user immediately performs a draw click or another non-digit bound action
- the pending `1` should commit immediately as tool 1 selection before the next action is processed

This avoids the user feeling blocked by the buffer when they are already clearly acting on the newly selected tool.

### Suggested rules

1. **top-row digits only for numeric tool sequences**
   - use `Digit0` - `Digit9`
   - do not use numpad digits for tool sequences

2. **sequence resolution happens before hand assignment interpretation**
   - `11` should resolve as tool 11
   - then the resolved tool token can be interpreted as primary or secondary assignment

3. **double-tap hand assignment happens on the resolved tool token**
   - single resolved tool token => assign/select primary-hand tool
   - repeated resolved same tool token inside buffer window => assign/select secondary-hand tool

4. **longest valid numeric match wins while buffer is still open**
   - if both `1` and `11` are valid, do not finalize `1` until the sequence either resolves or the buffer closes, unless early-commit rules apply

5. **early commit on next bound non-digit input**
   - if a pending numeric/tool action exists and the user triggers another bound input that depends on the current tool, commit the pending tool first
   - early commit should apply to clicks / pointer-down tool-use actions and non-tool-select key presses
   - early commit should **not** apply to pointer movement, hover, or passive mouse travel
   - early commit should **not** apply when the next input is another digit that could still extend the numeric sequence

6. **text capture disables numeric tool sequences**
   - top-row number typing must remain available in type mode
   - numpad should not become a text-mode tool shortcut path

### Suggested shape

A small runtime helper such as:

- `create_buffered_input_sequence_interpreter(...)`

which can support both:

- `KeyW` single => `painter.position.nudge_up`
- `KeyW` double => `painter.position.swing_up`
- `Digit1` => tool 1
- `Digit1, Digit0` => tool 10
- resolved tool token + second activation in buffer => secondary-hand tool assignment

This should integrate with the existing controls system rather than inventing a second independent shortcut matcher.
---

## Controls Profile Changes

## Painter controls profile

`src/mono_ui/runtime/painter_controls_profile.ts`

### Tool shortcut family change

Tool assignment defaults should move off letter keys and onto **top-row digit sequence bindings**.

Initial direction:

- core tools occupy `1` - `9`
- extended tools can occupy `10+`
- these are sequence-driven bindings, not numpad bindings
- these are disabled during text capture / type mode
- resolved tool token then flows into primary/secondary hand assignment logic

This numeric tool sequence model is intended to be reusable later by the game as well.

### Add or rename toward semantic families

#### Time

- `painter.time.nudge_back`
- `painter.time.nudge_forward`
- `painter.time.jump_active_group_start`
- `painter.time.jump_active_group_end`
- keep playback and document range actions as timing family actions

#### View

- retain current `painter.view.*` camera actions

#### Position

- `painter.position.nudge_up`
- `painter.position.nudge_left`
- `painter.position.nudge_down`
- `painter.position.nudge_right`
- `painter.position.nudge_backward`
- `painter.position.nudge_forward`
- `painter.position.rotate_left`
- `painter.position.rotate_right`
- `painter.position.swing_up`
- `painter.position.swing_left`
- `painter.position.swing_down`
- `painter.position.swing_right`

### Default bindings

#### Time

- Left Arrow
- Right Arrow
- Down Arrow
- Up Arrow

#### View

- Numpad cluster as already established

#### Position

- W A S D Z X Q E
- double-tap for swing behavior should be implemented by interpreter policy, not by duplicate binding rows

#### Tools

- top-row digit sequence family
- `1` - `9` for core tools
- `10+` for extended tools where needed
- single resolved tool token = primary-hand assignment
- repeated resolved same tool token in shared buffer window = secondary-hand assignment

### Deletions / retirements

Retire legacy target-specific arrow-key defaults such as current group nudge arrow bindings once positional semantic actions replace them.

We should end with no painter default arrow binding that means camera pan or direct group nudge.

---

## Implementation Phases

## Phase 0 - Write down and lock the matrix

Deliverables:

- this document
- agreement on final default matrix
- agreement on semantic action ids

Exit criteria:

- no further ambiguity about arrows vs WASD vs numpad responsibilities

## Phase 1 - Audit and isolate legacy keyboard paths

Targets:

- `src/mono_ui/modules/painter_canvas_module.ts`
- `src/canvas_app/painter_app_state.ts`

Tasks:

- inventory all hardwired painter keyboard branches
- mark which remain local text-capture behavior
- mark which must move to app-level semantic dispatcher
- identify paste-transform-only branches that should become positional routing

Exit criteria:

- every painter keyboard action is assigned either to semantic dispatcher ownership or true local text ownership

## Phase 2 - Expand painter controls profile

Tasks:

- add semantic time and position action definitions
- preserve camera/view actions
- migrate labels/categories to Time / View / Position naming
- ensure conflicts are visible in controls UI

Exit criteria:

- controls profile fully represents intended painter keyboard behavior

## Phase 3 - Build semantic routing helpers

Tasks:

- add time routing helper
- add view routing helper
- add positional routing helper
- add tool + hand resolution helper
- add supported/no-op feedback path for unsupported positional actions by tool

Exit criteria:

- app-level dispatcher can invoke all painter keyboard semantics through one path

## Phase 4 - Generalize multi-tap / sequence interpreter

Tasks:

- extract or extend the current double-tap interpreter model from tool shortcuts
- use it for WASD positional single vs double dispatch
- add buffered top-row numeric sequence resolution for tool assignment
- share the same timing window between numeric buffering and double-tap confirmation
- add early-commit behavior for pending single actions when later non-digit input makes intent clear
- keep deterministic delayed-single behavior where ambiguity still exists

Exit criteria:

- positional W/A/S/D support single nudge and double swing correctly
- top-row numeric tool sequences resolve correctly for `1` - `9` and `10+`
- pending tool selection can commit early before draw/use input when user intent is obvious

## Phase 5 - Tool integration

Tasks:

- assign painter core/extended tools onto the numeric sequence map
- move tool: implement positional routing
- paste tool: replace special-case transform routing with semantic routing
- text tool: route positional movement to text anchor/cursor where valid
- selection tools: route positional movement to selection-only movement
- ensure numeric tool shortcuts are disabled during text capture / type mode

Exit criteria:

- all requested tool families respond meaningfully to positional semantics
- numeric tool sequence shortcuts work without interfering with type mode
## Phase 6 - Remove legacy hardwired control paths

Tasks:

- remove canvas-module non-text arrow/WASD pan paths
- remove ad hoc numpad move-preview shortcuts that duplicate semantic routes
- remove any redundant special keyboard branches superseded by semantic actions
- keep only true text-capture-local arrow handling where text entry needs it

Exit criteria:

- no duplicate painter keyboard ownership remains
- keyboard control source of truth is the controls runtime + semantic dispatcher

## Phase 7 - Regression and TAI coverage

Tasks:

- add focused TAI scripts under `local_data/tool_assisted_inputs/` for:
  - time nudge left/right
  - group jump up/down
  - positional move
  - positional rotate
  - positional swing via double tap
  - paste transform via positional controls
  - selection move via positional controls
- verify logs first when failures appear

Exit criteria:

- stable reproducible coverage for the new control matrix

---

## Specific Integration Notes

## Text capture

Text capture remains a hard override.

Meaning:

- text-mode raw arrows still move text cursor if that is the intended text entry rule
- camera controls stay camera controls if explicitly allowed during text mode
- positional keys may affect text anchor/cursor only through semantic routing, not camera pan

We should be strict about what remains local text ownership vs what becomes shared semantic routing.

## Paste transform

Current paste transform special casing in `painter_app_state.ts` is a transitional surface.

End goal:

- paste transform uses the same positional semantic family as move/selection/text where appropriate
- camera/view controls stay separate
- special invert-modifier behavior should be reviewed and either retained intentionally or collapsed into the new routing model

## Selection tools

User requirement is explicit:

- positional controls for selection tools should move the selection only

This must not accidentally become:

- camera motion
n- group nudge
- content paint/edit

## Status feedback

Because some positional actions will depend on tool capability, unsupported actions should produce brief explicit feedback rather than silently doing nothing.

Examples:

- `Text tool: rotate not available`
- `Selection tool: swing not available yet`

---

## Success Criteria

This plan is successful when:

1. arrows always feel like time controls
2. numpad always feels like view/camera controls
3. WASD / Z X / Q E always feel like positional authoring controls
4. double-tap positional swing works without accidental single-fire
5. move, paste, text, and selection tools all participate in positional routing appropriately
6. the controls panel accurately shows the painter matrix
7. TAI can deterministically use the new controls
8. painter hot paths contain no leftover legacy hardwired keyboard control system outside true local text-entry behavior

---

## Immediate Next Implementation Steps

1. confirm final semantic action ids and exact labels
2. lock the initial numeric tool map for `1` - `9` and decide which tools start at `10+`
3. audit every painter keyboard branch in `painter_canvas_module.ts`
4. define the positional routing helper contract in `painter_app_state.ts`
5. generalize the current double-tap interpreter into a shared multi-tap / sequence dispatcher
6. migrate one family at a time: Tools -> Time -> Position -> View cleanup -> legacy removal

---

## Next Development Outline After Current Migration Pass

The current pass has already landed these foundations:

- arrows now route to time actions
- numeric top-row tool sequences are active
- legacy hidden non-text keyboard pan is removed
- app-level positional action ids exist and are routed for move / paste / selection / text
- hardcoded undo / redo / copy key handling has moved out of the canvas hot path

The next development should focus on **finishing semantics and reducing transitional behavior**, not on inventing a new controls system.

## Track 0 - timing transport and onion skin workflow

This track extends the new time-nudge arrow family into a fuller animation transport workflow.

The goal is to support:

- precise single-step editing while paused
- quick direction-aware play/pause with double taps
- future realtime authoring while playback continues
- lightweight onion skinning suitable for particle-style animation workflows

### 0.1 Arrow timing semantics

Lock the base arrow semantics to:

- `ArrowLeft`
  - pause playback
  - step back 1 breath
- `ArrowRight`
  - pause playback
  - step forward 1 breath
- `ArrowUp`
  - jump to active group start
- `ArrowDown`
  - jump to active group end

This supersedes the older down=start / up=end mapping.

### 0.2 Double-tap arrow semantics

Add a buffered arrow-double-tap interpreter using the same timing-family window used by the current painter tool numeric sequence buffering.

Recommended semantics:

- `Left Left`
  - if already playing backward: pause
  - otherwise: begin playing backward from the current breath
- `Right Right`
  - if already playing forward: pause
  - otherwise: begin playing forward from the current breath
- `Up Up`
  - toggle onion skinning enabled/disabled
- `Down Down`
  - reserved / unused for now

Important single-vs-double behavior:

- single `Left` / `Right` should still feel immediate for frame stepping work
- if the second matching tap arrives inside the buffer window, the system should treat the pair as a transport toggle rather than two unrelated single-step commands
- switching directions by double tapping the opposite direction should be supported directly:
  - double-right while playing backward => play forward from current breath
  - double-left while playing forward => play backward from current breath

### 0.3 Playback state model

Painter timing should move toward an explicit transport state instead of only a simple play/pause boolean.

Recommended state model:

- `paused`
- `playing_forward`
- `playing_backward`

Rules:

- single `Left` / `Right` always force `paused` before stepping
- double tap in the currently active direction toggles to `paused`
- double tap in the opposite direction switches playback direction from the current breath
- this state should be designed so later tools can continue authoring while playback remains active

### 0.4 Onion skin controls in Painter Camera

The ASCII painter camera module should gain explicit onion skin controls.

Add to the painter camera panel:

- `Onion Skin` toggle
- `Onion Skin Distance` slider
  - default: `1`
  - min: `1`
  - max: `3`
- `Onion Skin Step Mode` toggle/cycle
  - `Per Raster Bar`
  - `Per Frame`
  - default: `Per Raster Bar`

This belongs in the painter camera module because it is a view/render aid rather than an authored document mutation.

### 0.5 Onion skin stepping modes

Define the two onion skin stepping modes clearly.

#### Per Frame

For onion distance `N`, render the prior authored breaths:

- `current_breath - 1`
- `current_breath - 2`
- ... up to `N`

This is raw breath-relative stepping.

#### Per Raster Bar

For onion distance `N`, walk backward through raster timeline bars/states rather than raw breath offsets.

Important rule:

- **blank bars count too**
- the stepping must count both visible raster-content bars and blank bars

That means the default mode respects authored timing gaps rather than skipping across them.

If the previous raster span is blank, that blank still consumes one onion-skin distance step.

This is the requested production default because it better reflects authored timing structure.

### 0.6 Onion skin render model

Initial onion skin rendering can stay intentionally simple.

First pass:

- render only prior onion states, never future states
- current breath still renders normally on top
- onion skins render underneath the current breath
- each older onion layer renders before the newer one

Recommended render order per cell stack:

- oldest onion layer first
- then newer onion layers
- current breath last

For example at distance 2:

- onion `n - 2`
- onion `n - 1`
- current `n`

Opacity/intensity model for first pass:

- onion layers render at reduced visual strength versus the current breath
- nearest prior onion should be stronger than older onions
- implementation can use reduced color intensity / weight / opacity-like presentation depending on the renderer surface

### 0.7 Authority and persistence

Onion skin settings should be treated as painter UI/view state, not document content.

That means:

- they belong with painter camera/view settings
- they should persist in the painter app-scoped settings path, alongside other painter camera settings
- they should not create multiplayer-authored document churn

### 0.8 Integration audit: exact files and surfaces that must change

This feature crosses playback, controls, camera persistence, camera UI, and painter render composition. It should be implemented as one integrated slice, not as isolated hacks.

#### Playback / timing core

- `src/canvas_app/painter_app_state.ts`
  - current owner of painter timing hotkeys
  - current owner of `painter_playback_running`
  - current owner of playback stepping interval
  - must become the owner of explicit playback direction state and arrow double-tap interpretation
- `src/ascii_painter/painter_breath.ts`
  - current playback stepping helper only supports forward stepping
  - must gain either direction-aware stepping or a new reverse-capable playback helper

#### Controls bindings / timing actions

- `src/mono_ui/runtime/painter_controls_profile.ts`
  - must remap single-tap up/down defaults to:
    - `ArrowUp` => `painter.breath.jump_active_group_start`
    - `ArrowDown` => `painter.breath.jump_active_group_end`
  - must re-evaluate the standalone play binding so it does not fight the new arrow-transport model
- `src/canvas_app/painter_tool_shortcut_interpreter.ts`
  - contains the current shared 300ms painter-side buffered timing family
  - should either be generalized into a shared buffered-input helper or used as the timing reference for a new arrow transport interpreter

#### Camera config / persistence

- `src/ascii_painter/voxel_space.ts`
  - `CameraConfig` must gain onion-skin view fields
  - default camera values must define the painter onion-skin defaults
- `src/mono_ui/runtime/camera_limits.ts`
  - must define slider limits for onion-skin distance
  - must sanitize the onion-skin fields per app
- `src/mono_ui/runtime/camera_customization_store.ts`
  - persistence already flows through `Partial<CameraConfig>`
  - once the config type and sanitizer are updated, onion-skin settings should naturally persist in app-scoped painter camera settings
- `src/canvas_app/painter_app_state.ts`
  - `sanitizePainterCameraConfig(...)`
  - `createSanitizedPainterCamera(...)`
  - `mergeSavedPainterCameraConfig(...)`
  - painter camera persistence callbacks in `create_camera_control_module()`
  - all must be updated so onion-skin UI state is fully integrated and not partially ephemeral

#### Camera module UI

- `src/mono_ui/modules/place_camera_control_module.ts`
  - current reusable camera panel already supports toggles and sliders
  - must be extended carefully to expose painter-only onion-skin controls without leaving world-camera UI polluted or half-shared
- `src/canvas_app/painter_app_state.ts`
  - `create_camera_control_module()` must wire the painter onion-skin controls into the reusable camera panel

#### Painter render composition

- `src/canvas_app/painter_app_state.ts`
  - owns painter display projection rebuilds and projected preview composition
  - is the most likely integration point for first-pass onion-skin overlay composition
- `src/ascii_painter/painter_view_projection_adapter.ts`
  - may need extension if onion layers are easier to compute during projected-scene generation rather than post-projection composition
- `src/mono_ui/modules/painter_canvas_module.ts`
  - should remain mostly a consumer of the already-composed display scene
  - avoid pushing onion-skin state logic down into ad hoc module-only rendering branches unless necessary

#### Existing playback UI / settings surfaces

- `src/mono_ui/modules/canvas_settings_module.ts`
  - currently exposes a `PLAY/STOP` action
  - should remain coherent with the new directional transport state
  - likely needs a label refresh or at least internal compatibility handling
- any user-saved control bindings / settings migration surfaces
  - if any existing user config has an old dedicated playback key, the new behavior should not leave hidden duplicate transport paths behind

### 0.9 UX notes and anti-strand rules

#### Transport UX

The user should feel one coherent transport system:

- `Left` / `Right` = precise edit stepping
- `Left Left` / `Right Right` = directional transport toggle
- standalone play bindings must not create a competing mental model

The existing dedicated play binding should therefore be reviewed during implementation.

Note from current discussion:

- the user called out that `\` is currently used for play in their workflow and can be remapped

Implementation note:

- no literal default `Backslash` binding was found in the current checked-in painter controls profile
- treat this as either an existing user binding, a legacy local config, or a remembered workflow surface
- do not assume the repo default is the whole truth; implementation should avoid leaving the old play pathway semantically ambiguous if a saved binding exists

Recommended UX outcome:

- keep a rebindable explicit transport action if desired, but align it with the new directional transport model rather than a blind toggle that ignores direction
- if retained, that action should be something like “toggle transport in last direction” or a clearly secondary convenience action

#### Onion-skin UX

The onion-skin controls should be understandable without reading a plan doc.

Recommended panel wording:

- `Onion Skin` (toggle)
- `Onion Distance` (1..3)
- `Onion Mode`:
  - `Raster Bars`
  - `Frames`

Default should be:

- onion disabled by default unless toggled on
- distance `1`
- mode `Raster Bars`

Why:

- distance 1 is the least visually noisy
- raster-bar mode best matches authored timing and blank timing gaps
- keeping onion off by default preserves current visual expectations and performance until requested

#### Raster-bar wording

Use **Raster Bars** in the UI rather than internal terminology like “segment stepping” or “state stepping”.

This matches the timeline vocabulary the user already thinks in.

#### Playback while editing

The transport rewrite should not hard-code assumptions that playback means input lockout.

Future-facing rule:

- playback direction state should drive breath advancement only
- tool-edit suppression while playing should be a separate policy decision per tool, not baked into transport itself

This keeps the path open for the desired realtime particle workflow.

### 0.10 Recommended execution order for this track

1. define playback-direction state in painter app state
2. add reverse-capable playback stepping in the timing helper layer
3. add arrow double-tap interpreter and transport rules
4. remap `ArrowUp`/`ArrowDown` single-tap semantics to start/end as specified above
5. rework standalone play binding semantics so it does not compete with directional transport
6. extend painter camera settings/schema with onion skin enable + distance + stepping mode
7. add onion skin controls to the painter camera module UI
8. thread onion skin state into painter render preparation
9. implement first-pass prior-state onion rendering for distance 1..3
10. add regression coverage for:
   - single-step pause behavior
   - forward/backward double-tap transport toggles
   - double-up onion toggle
   - per-frame onion stepping
   - per-raster-bar onion stepping including blank-bar counting
   - persistence of onion-skin camera settings
   - no stale competing play binding behavior

## Track A - finish positional semantics

### A1. Replace move-tool vector nudge with raster move mode

This is now the preferred direction.

The move tool should **not** be treated as a group/vector transform nudge tool.

Instead:

- `move tool` = **pending raster move mode**
- if there is an active selection, the move tool operates on the selected raster payload
- if there is no active selection, move tool should not fall back to group movement implicitly in its own tool semantics

This is intentionally closer to:

- text tool pending edit mode
- paste tool pending placement mode
- Photoshop-style move behavior

### A2. Pending raster move mode lifecycle

When the user has the move tool active and a selection exists:

1. enter or resume **pending move mode**
2. extract the selected raster payload into a local preview state
3. render a ghost/flash preview, similar to paste preview
4. allow pointer targeting and keyboard nudging to update the preview target
5. commit on explicit confirm
6. cancel on explicit cancel
7. auto-commit on tool leave, similar to text-mode commit-on-finish semantics

### A3. Pending move mode commit rules

Recommended v1 rules:

- `click` while armed = commit move to target
- `Enter` = commit
- `Esc` = leave (commit and exit; undo if user wants to revert)
- switching off the move tool = commit if the preview moved, otherwise just exit
- commit should produce one clean history action and one clean multiplayer/server action

This is better for:

- undo granularity
- multiplayer/network cost
- preview clarity
- deterministic behavior under automation

### A4. Shared pending-placement family

Move and paste should converge toward the same interaction family:

- `text` = pending text edit/placement
- `paste` = pending payload placement
- `move` = pending raster payload move

Shared lifecycle concepts:

- begin
- update target
- nudge target
- preview target
- commit
- leave (commit and exit)
- flush/commit on mode exit when appropriate

### A5. Positional routing precedence

Lock positional routing in this order:

1. **active hand tool is a selection tool**
   - nudge moves the selection only
   - do not move content payload
   - do not move group transform

2. **active hand tool is move and a selection exists**
   - nudge updates pending raster move target
   - commit happens later through move-mode lifecycle

3. **active hand tool is move and no selection exists**
   - no move-tool-local action yet
   - do not silently reinterpret as vector/group move just because move is selected

4. **active hand tool is paste**
   - nudge updates paste preview target / transform

5. **active hand tool is text**
   - nudge moves text anchor/cursor where supported

6. **if the dominant/primary hand does not resolve to move or selection behavior, check the non-dominant/secondary hand**
   - apply the same rules there

7. **if neither hand has move or selection tool active**
   - positional nudge may fall back to group-based movement

This gives the user the requested preference:

- selection tool = move selection only
- move tool = raster move selected content
- no move/selection in either hand = group move fallback

### A6. Explicit support matrix per tool

Lock exact behavior for each positional action by tool:

- `move`
  - `W/A/S/D` = update pending raster move target
  - `Z/X` = deferred unless depth-aware raster move is intentionally supported
  - `Q/E` = deferred unless raster rotation mode exists
- `paste`
  - `W/A/S/D` = move preview in view-plane directions
  - `Z/X` = move preview backward/forward in world depth
  - `Q/E` = rotate preview
- `text`
  - `W/A/S/D` = move text anchor/cursor in authored space
  - `Z/X` = deferred until text plane stepping is intentionally supported
  - `Q/E` = deferred until text orientation exists
- `selection tools`
  - `W/A/S/D` = move selection only
  - this is selection-shape/selection-location behavior, not raster content movement
  - `Z/X` = only if 3D selection movement is valid; otherwise status no-op
  - `Q/E` = deferred unless selection transform rotation support is added
- `fallback group move`
  - only when neither hand is using move or selection tool semantics
  - `W/A/S/D` = group-based movement in view-plane directions
  - `Z/X` = group depth movement if supported
  - `Q/E` = group rotation only when explicit support exists

### A7. Add explicit unsupported-action feedback

When a positional action is semantically recognized but not yet supported for the current tool, emit a short status such as:

- `Move rotate not available yet`
- `Text depth nudge not available yet`
- `Selection rotate not available yet`

That is better than silent failure and will make the controls feel intentional while the matrix is still being completed.

### A3. Decide active-hand ownership rule

Lock one concrete runtime rule for positional dispatch:

- default target = primary-hand tool
- if a mode explicitly activates secondary-hand transform ownership, route there instead
- pointer hover should not decide ownership

Implementation-wise, this likely means introducing a small helper that resolves:

- active hand
- current tool for that hand
- whether a positional action should target tool state, selection state, or authored group state

## Track B - extend the buffered input model

### B1. Add positional double-tap swing

Extend the buffered interpreter so that:

- `W` => delayed single `painter.position.nudge_up`
- `W W` => `painter.position.swing_up`
- same for `A/S/D`

Rules:

- use the same timing window already used by numeric tool sequences
- no single-fire plus double-fire on the same burst
- allow early commit when later non-positional input makes the single intent clear

### B2. Consider extracting a shared buffered input helper

The painter tool interpreter is already doing more than tool assignment.

Next step should likely be a more shared helper, e.g. a small generic buffered input runtime usable for:

- numeric tool sequences
- positional single vs double-tap actions
- future game multi-press actions

This should remain a runtime/helper extraction, not a rewrite of the controls registry.

## Track C - remove remaining transitional branches

### C1. Audit remaining keyboard-owned canvas behavior

Re-check `src/mono_ui/modules/painter_canvas_module.ts` for:

- wheel modifier shortcuts
- any remaining copy/edit history ownership
- any remaining transform-specific keyboard branches that should be app-routed

The target state is:

- text-local editing stays local
- pointer/gesture handling stays local
- semantic keyboard control stays app-owned

### C2. Review paste invert special-casing

`tool_target_invert_held` paste transform routing is still transitional.

Decide whether it should become:

- a deliberate alternate semantic mode, or
- folded into the same positional routing family

The important part is that paste should not remain a special hidden keyboard sub-system forever.

## Track D - controls UX / discoverability

### D1. Make controls UI honest about numeric sequences

The controls surface should eventually explain:

- top-row digit family selects tools
- `10+` is a buffered numeric sequence, not separate single-key bindings
- repeating the same resolved tool token quickly assigns secondary hand

### D2. Make controls UI honest about double-tap semantics

The controls UI should also eventually explain:

- `W/A/S/D` single = positional nudge
- `W/A/S/D` double = positional swing

This can start as descriptive copy even before full custom rebinding support exists.

## Track E - regression coverage

Once double-tap positional behavior lands, add focused TAI / smoke coverage for:

- numeric tool sequence primary assignment
- numeric tool sequence secondary assignment
- time arrows including active-group jump up/down
- move-tool positional nudge
- paste positional nudge and rotate
- selection positional nudge
- positional double-tap swing

## Recommended execution order

1. lock the positional routing precedence and hand-fallback rule
2. define pending raster move mode state + lifecycle
3. align paste with the same pending-placement lifecycle language
4. add unsupported-action status feedback
5. implement move-tool raster preview / commit flow
6. implement positional double-tap swing for `W/A/S/D`
7. decide whether to extract shared buffered interpreter now or immediately after swing lands
8. finish remaining canvas keyboard cleanup
9. improve controls UI wording for numeric sequence and double-tap semantics
10. add focused TAI regression coverage

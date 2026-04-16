# Auto Input Debugging Plan

Date: 2026-04-15

## Intent

Add a reusable auto-input harness for Thaumworld debugging so movement feel, latency, and input fidelity can be tested without manual play.

The harness should:

- load deterministic local scripts from disk
- boot into a playable session with minimal manual setup
- anchor timing to live place breaths rather than only wall-clock time
- drive the current gameplay input authority instead of synthesizing ad-hoc DOM behavior
- stay modular so future input-system rewrites do not invalidate the script format

This plan is downstream of:

- `docs/plans/2026_04_12_input_host_runtime_plan.md`
- `docs/plans/2026_04_12_breath_scheduler_action_busy_plan.md`

This file is the source of truth for the auto-input debugging harness.

## Architecture

1. Core automation harness
- owns script model, run lifecycle, scheduler, action dispatch, and trace events
- must not depend directly on Electron, `app_state`, `place_module`, `CanvasRuntime`, or current HTTP endpoints

2. Script repository adapter
- loads scripts from the current storage system
- primary executable format is JSON
- optional Markdown wrapper can be added later, but execution payload remains JSON

3. World bootstrap adapter
- prepares a playable world/session context for the harness
- current implementation reuses connect/session/control/claim flow
- should not invent a separate login path in the first pass

4. Clock source adapter
- exposes the authoritative automation clock to the scheduler
- current Thaumworld implementation adapts `PLACE_BREATH_TICK`
- scheduler only sees an abstract clock, not gameplay modules

5. Input driver adapters
- scheduler emits abstract actions only
- drivers translate actions into the active input authority
- keyboard first, pointer second

6. Trace sink adapter
- automation emits its own compact trace stream
- traces must correlate cleanly with existing `INPUT_TRACE` and movement logs
- assertions begin small and expand later

## Stable Interfaces

The automation core should be built around these seams:

1. `AutomationScriptRepository`
- loads and validates a script from the active storage backend
- can later support local files, saved presets, Markdown wrappers, or generated scripts

2. `WorldSessionBootstrap`
- ensures the world is in a playable state for automation
- returns readiness context such as session token, actor ref, and place id
- current Thaumworld adapter can use existing HTTP APIs, but the core must not depend on those endpoint names

3. `AutomationClockSource`
- publishes the scheduler clock used for relative action timing
- exposes current tick index, readiness, and optional metadata
- current Thaumworld adapter uses place breaths, but the core should not know what `PLACE_BREATH_TICK` is

4. `AutomationInputDriver`
- accepts abstract automation actions
- first pass needs keyboard support and reset/release support
- backend kind should be reported for trace logging

5. `AutomationTraceSink`
- records compact automation lifecycle and action events
- current adapter can write to console/logs alongside existing traces

## Thaumworld Adapters

The first implementation should stay pragmatic by building only the adapters this app needs right now.

Current planned adapters:

- local JSON script repository under the selected data slot
- current Thaumworld session/bootstrap/actor-claim adapter
- current place-breath clock adapter
- current Electron authoritative keyboard driver
- current shared-runtime fallback keyboard driver
- later `CanvasRuntime` pointer adapter

This keeps the implementation practical without making current renderer/runtime details part of the core architecture.

## Design Rules

- Keep the script language above the current input implementation.
- Do not synthesize DOM keyboard events as the authoritative gameplay path.
- Reuse current session and actor-claim APIs before adding new boot shortcuts.
- Prefer tile-based pointer automation over raw screen coordinates.
- Automation mode should be explicit and safe to disable.
- Human input and automation should not silently mix during a scripted run.
- Core automation runtime must not directly depend on Electron preload APIs, `app_state`, `place_module`, `CanvasRuntime`, current HTTP endpoint names, or filesystem path conventions.

## Script Format

First pass script shape:

```ts
type AutoInputScript = {
  id?: string;
  description?: string;
  start_delay_ms: number;
  stop_on_error?: boolean;
  boot?: {
    auto_connect?: boolean;
    auto_claim?: boolean;
    preferred_actor_ref?: string | null;
    exclude_actor_refs?: string[];
    exclude_actor_names?: string[];
  };
  actions: Array<
    | { at_breath: number; type: 'assert_context_ready' }
    | { at_breath: number; type: 'marker'; label: string }
    | { at_breath: number; type: 'key_down'; code: string; key?: string }
    | { at_breath: number; type: 'key_up'; code: string; key?: string }
  >;
};
```

Example hold script:

```json
{
  "id": "movement_hold_w",
  "description": "Hold W for 20 breaths after boot settles.",
  "start_delay_ms": 2500,
  "boot": {
    "auto_connect": true,
    "auto_claim": true,
    "exclude_actor_names": ["J"]
  },
  "actions": [
    { "at_breath": 0, "type": "assert_context_ready" },
    { "at_breath": 5, "type": "key_down", "code": "KeyW", "key": "w" },
    { "at_breath": 25, "type": "key_up", "code": "KeyW", "key": "w" },
    { "at_breath": 26, "type": "marker", "label": "hold_complete" }
  ]
}
```

## Storage And Loading

- [ ] Define a script-repository seam distinct from scheduler/runtime execution.
- [ ] Implement a local repository that stores automation scripts under `local_data/data_slot_<N>/automation/inputs/`.
- [ ] Add a small loader that reads a configured script path using the current local repository adapter.
- [ ] Track the last-used script path locally for fast reruns.
- [ ] Keep JSON as the only executable format in phase 1.
- [ ] Defer Markdown support until the JSON path is stable.

## Boot And Claim Runtime

The core harness should request world readiness through a bootstrap adapter rather than calling specific endpoints directly.

Current Thaumworld adapter reuses these existing endpoints and flows:

- `/api/connect`
- `/api/session/control`
- `/api/actors/claimable`
- `/api/actors/claim`

Actor selection order:

1. explicit `preferred_actor_ref` if valid and claimable
2. first claimable actor not excluded by ref/name
3. first remaining claimable actor

Implementation goals:

- [ ] Define a world-bootstrap seam distinct from script scheduling and action dispatch.
- [ ] Add a Thaumworld automation boot helper under `src/canvas_app/`.
- [ ] Reuse current session bootstrap instead of adding a separate direct-login path.
- [ ] Allow explicit automation mode to auto-claim a deterministic actor.
- [ ] Fail clearly when no actor can be claimed.
- [ ] Wait for session token, actor ref, and place id before arming gameplay actions.

## Breath Scheduler

The scheduler should consume an abstract automation clock without owning place rendering logic.

Current Thaumworld implementation should adapt live place breath updates into that clock.

Scheduler states:

- `idle`
- `booting`
- `waiting_start_delay`
- `waiting_for_breath_zero`
- `running`
- `completed`
- `failed`

Implementation goals:

- [ ] Define an automation clock-source seam.
- [ ] Add a runtime scheduler under `src/mono_ui/runtime/`.
- [ ] Expose a narrow place-breath adapter from `place_module`.
- [ ] Start the script delay timer only after the automation runtime begins.
- [ ] Anchor `breath_zero` to the first observed clock tick after delay expiry.
- [ ] Fire each action when `current_breath >= breath_zero + at_breath`.
- [ ] Log late and skipped actions explicitly.
- [ ] Release held automation keys if the run aborts or resets.

## Keyboard Driver

First pass automation must target the real gameplay authority, not synthetic DOM behavior.

Stable seam:

- `AutomationInputDriver`

Current backends:

1. Electron authoritative backend
- inject directly into the gameplay bridge authority in `electron/main.js`
- reuse existing keydown/keyup ingestion behavior

2. Local fallback backend
- use the shared runtime / worker path when Electron authority is unavailable

Implementation goals:

- [ ] Define an input-driver seam distinct from the scheduler.
- [ ] Add a renderer-side keyboard driver abstraction in `src/mono_ui/runtime/`.
- [ ] Add a dedicated automation keyboard adapter for the current Electron bridge in `electron/preload.js` and `electron/main.js`.
- [ ] Route automation keydown/keyup through the same internal handlers as live gameplay input.
- [ ] Add typings for the current Electron adapter surface in `src/vite-env.d.ts`.
- [ ] Add a local fallback backend for non-Electron/dev cases.
- [ ] Gate automation gameplay events on ready context just like the live bridge does.

## Pointer Driver

Pointer automation is phase 2 work.

Preferred actions:

- `mouse_move_tile`
- `mouse_down_tile`
- `mouse_up_tile`
- `mouse_click_tile`
- `mouse_drag_tile`

Implementation goals:

- [ ] Add a narrow automation/test seam to `CanvasRuntime`.
- [ ] Reuse internal pointer routing and event construction where possible.
- [ ] Prefer tile coordinates over screen coordinates.
- [ ] Treat screen-space pointer actions as optional fallback behavior only.

## Trace And Assertions

Automation should log its own compact trace stream through a trace sink seam.

Trace prefix:

- `SCRIPT_TRACE`

Expected events:

- `script_loaded`
- `boot_started`
- `boot_ready`
- `waiting_start_delay`
- `breath_zero`
- `action_fired`
- `action_skipped`
- `action_failed`
- `completed`
- `failed`

Implementation goals:

- [ ] Define a trace-sink seam.
- [ ] Add a small automation trace helper.
- [ ] Include script id, action index, target breath, current breath, actor ref, place id, and backend in trace payloads.
- [ ] Add `assert_context_ready` in phase 1.
- [ ] Defer movement/result assertions until the replay path is stable.

## UI And Control Surface

Phase 1 should stay minimal.

Implementation goals:

- [ ] Allow a configured script path to auto-run on boot in explicit automation mode.
- [ ] Disable or clearly gate live human gameplay input while automation is running.
- [ ] Add fast rerun support using the last-used script path.
- [ ] Defer larger debug UI/file-picker work until the replay core is reliable.

## File Layout

Planned core files:

- `src/mono_ui/runtime/automation_interfaces.ts`
- `src/mono_ui/runtime/automation_script_types.ts`
- `src/mono_ui/runtime/automation_scheduler.ts`
- `src/mono_ui/runtime/automation_trace.ts`
- `src/mono_ui/runtime/automation_runtime.ts`

Planned first-pass adapter files:

- `src/mono_ui/runtime/automation_script_repository_local.ts`
- `src/canvas_app/automation_boot_thaumworld.ts`
- `src/mono_ui/runtime/automation_clock_place_breath.ts`
- `src/mono_ui/runtime/automation_keyboard_driver_electron.ts`
- `src/mono_ui/runtime/automation_keyboard_driver_shared_runtime.ts`
- `src/mono_ui/runtime/automation_pointer_driver_canvas_runtime.ts`

Planned touched files:

- `src/canvas_app/app_state.ts`
- `src/mono_ui/modules/place_module.ts`
- `src/mono_ui/runtime/canvas_runtime.ts`
- `src/vite-env.d.ts`
- `electron/preload.js`
- `electron/main.js`

## Phases

### Phase 1: Keyboard Replay MVP

- [ ] Keep the core-vs-adapter seam explicit without overbuilding a general plugin system.
- [ ] Load local JSON automation scripts.
- [ ] Bootstrap session and controlled actor automatically in explicit automation mode.
- [ ] Anchor scheduler to the current place-breath clock adapter.
- [ ] Inject keyboard `key_down` and `key_up` deterministically.
- [ ] Emit `SCRIPT_TRACE` logs for the full run.
- [ ] Add canned movement scripts for hold, tap, replace, and jump-while-moving.

Acceptance:

- [ ] A configured script can boot the game, claim an actor, and replay a keyboard movement pattern without manual input.
- [ ] Logs clearly show script start, breath zero, action dispatch, and completion.
- [ ] Aborting or losing focus does not leave automation-held keys stuck down.

### Phase 2: Automation Control UX

- [ ] Persist and reuse the last script path.
- [ ] Add manual stop/reset/rerun controls.
- [ ] Show current automation state in a small debug/control surface.

Acceptance:

- [ ] The same script can be rerun repeatedly in one dev session with minimal friction.
- [ ] Automation status is visible without opening code or logs.

### Phase 3: Pointer Automation

- [ ] Add tile-based pointer movement, click, and drag actions.
- [ ] Route pointer automation through `CanvasRuntime` internals.
- [ ] Add initial click/drag test scripts.

Acceptance:

- [ ] Tile-based pointer replay remains stable across normal UI scale/layout changes.
- [ ] Pointer automation can reproduce at least one real game interaction and one drag interaction.

### Phase 4: Assertions And Benchmarks

- [ ] Add script assertions beyond context readiness.
- [ ] Record compact timing summaries for scripted runs.
- [ ] Add batch-friendly pass/fail reporting for repeated tuning runs.

Acceptance:

- [ ] A movement script can report success/failure automatically.
- [ ] Repeated runs produce comparable timing traces for tuning input feel.

## Testing Plan

Unit coverage:

- [ ] script validation
- [ ] actor selection rules
- [ ] scheduler breath anchoring
- [ ] late/skipped action behavior

Integration coverage:

- [ ] Electron automation keydown/keyup reaches the same authority path as live gameplay input
- [ ] boot helper binds the intended actor deterministically
- [ ] automation reset releases held state cleanly

Manual/log verification:

- [ ] `SCRIPT_TRACE` correlates cleanly with `INPUT_TRACE`
- [ ] movement logs reflect expected tap/hold/replace behavior
- [ ] repeated runs are stable enough to compare feel changes between revisions

Initial canned scripts:

- [ ] `movement_hold_w.json`
- [ ] `movement_tap_w.json`
- [ ] `movement_replace_w_to_d.json`
- [ ] `movement_jump_while_w.json`

## Non-Goals For Phase 1

- Do not redesign the full input system again.
- Do not add controller automation yet.
- Do not add general AI freeform input generation yet.
- Do not build a new direct-login boot path yet.
- Do not make screen-space mouse automation the primary path.
- Do not make the core harness responsible for login/session/business logic beyond requesting readiness through an adapter.
- Do not let the core harness depend directly on Electron, `app_state`, `place_module`, or current endpoint names.

## Current Recommended First Slice

1. JSON script loader
2. automation boot helper using current connect/claim flow
3. breath-relative scheduler anchored on `PLACE_BREATH_TICK`
4. Electron authoritative keyboard injection
5. `SCRIPT_TRACE`
6. canned keyboard movement scripts

This is the smallest slice that materially reduces manual input testing for movement tuning.

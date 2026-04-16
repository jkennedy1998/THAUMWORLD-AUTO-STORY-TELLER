# Input Host Runtime Plan

Date: 2026-04-12

## Intent

Isolate platform-specific input capture from gameplay/UI input consumption.

The game should not depend on Electron or DOM keyboard semantics directly. It should consume:

- button down/up state
- hold state
- action edges
- pointer position/button state
- player/channel/device identity

## Architecture

1. Platform input host
- Electron/window-specific capture layer
- normalizes raw input events
- routes them into the shared runtime

2. Shared input runtime
- multiplayer-ready state model from day one
- owns authoritative action/button state per player/channel/device
- derives movement intent from abstract actions
- central place for suspicious-event hardening

3. Bindings config
- maps physical inputs to abstract actions
- intended to be loaded per save file/profile later

4. Consumers
- gameplay/UI query action state and movement intent
- consumers should not care whether the source was Electron, browser, controller, or network later

## First Pass Scope

Current first pass covers:

- keyboard gameplay actions
- `W`, `A`, `S`, `D`
- `Space`
- `Escape`

Text input remains module-local and focused, but gameplay action state no longer depends on the hidden `key_sink` as the authoritative source.

## Current Implementation Status

Implemented:

- `src/mono_ui/runtime/shared_input_runtime.ts`
  - multiplayer-ready action runtime
  - bindings config support
  - movement intent derivation
  - worker-owned keyboard action state
  - suspicious gameplay key-release quiet-window confirmation for held movement stabilization

- `src/mono_ui/runtime/electron_input_host.ts`
  - Electron/window input host adapter for keyboard/focus events

- `src/mono_ui/runtime/input_worker.ts`
  - dedicated worker program that owns keyboard gameplay input state
  - consumable press support scaffold for future actions

- `src/mono_ui/runtime/input_worker_protocol.ts`
  - worker/main-thread message protocol

- `src/mono_ui/runtime/input_actions.ts`
  - main-thread cached facade over the worker runtime for existing consumers

- `src/mono_ui/runtime/canvas_runtime.ts`
  - uses the Electron host rather than owning raw window keyboard listeners inline
  - keeps focused-module-first `Escape` behavior
  - keeps `key_sink` for text input only

## First Pass Non-Goals

- do not redesign all pointer routing yet
- do not redesign painter interaction semantics yet
- do not implement controller support yet
- do not implement per-save-file binding persistence yet

## Next Steps

1. Validate whether held-key flapping is fixed under the shared runtime hardening rules.
2. If needed, refine the suspicious-release trust rules using focused diagnostics.
3. Move pointer/button/wheel/stylus raw ownership into the shared runtime.
4. Add actual per-save-file binding load/save.
5. Extend player/channel/device routing beyond the default local player.

# UI Improvements Plan: Logs, Time, Audio, Shaders

**Date:** 2026-02-13
**Status:** ACTIVE

Checkbox legend:
- `[ ]` not_started
- `[~]` implemented
- `[x]` tested

## Goal

Make the UI easier to read and easier to trust.

- Log window shows a clean, non-duplicated story: user -> narration -> NPC (with consistent grouping).
- Renderer narration becomes context-aware for conversation.
- UI displays global time (game time) consistently.
- Add a lightweight visual texture pass to the output window (optional, tasteful).
- Add an SFX architecture and a minimal test sound triggered by “actor speaks out loud”.
- Keep music separate from SFX.

## Scope

In-scope:
- UI layout adjustments + new “debug reader” patch module.
- Log ingestion/dedup + message grouping rules.
- Renderer_AI duplicate-output bug fix (root cause: re-processing `processing` messages).
- Renderer_AI prompt/context feed improvements for conversation (inputs/metadata only).
- Global time display (read-only).
- SFX system architecture + one test sound on speech.
- Optional shader/texture pass for the log output window.

Out-of-scope (for this plan):
- Full TTS per language (design hooks only).
- Real occlusion-based audio propagation (design hooks only).
- Music content/playlisting (architecture notes only).

## Current Problems (Observed)

- Log window sometimes shows: user message, then renderer narration twice, then NPC once.
- Renderer narration is often “off” because it lacks conversation context (who is being addressed, participation state, place, recent exchange).

Root causes to address:
- `src/renderer_ai/main.ts` currently considers `status === "processing"` messages as candidates, which can cause re-processing and duplicate `rendered_1` outputs.
- ActionPipeline-driven COMMUNICATE outbox envelopes are not guaranteed to include enough narrative context (events/effects/conversation/witness).

## Proposed Layout (Concept)

Based on the attached mock.

Module naming (UI-facing):
- `input` (1)
- `transcript` (2)
- `place` (3)
- `system info` (4)
- `free space` (5)
- `debug reader` (6)
- `buttons` (7)
- `roller` (8)

- Top bar: `system status` (includes global time)
- Main left: `place module`
- Main right: `debug reader` (patch module for not-yet-first-class UI state)
- Bottom left: `transcript window` (narration + NPC text)
- Bottom right: `debug reader` (same module; optional secondary view mode)
- Bottom strip: `input`
- Bottom-right strip: `buttons` (primary non-debug action controls)

Buttons panel intent:
- Replace non-debug hotkeys with discoverable controls (keep hotkeys as optional power-user shortcuts).
- Examples: COMMUNICATE volume (WHISPER/NORMAL/SHOUT), movement mode (WALK/SNEAK/SPRINT).

Progress:
- [~] COMMUNICATE volume buttons exist in the UI and are sent as `intent_subtype` overrides.
- [~] Movement mode buttons exist (WALK/SNEAK/SPRINT) and drive place movement behavior.
- [~] Layout rebalanced: place on left, debug reader on right, incoming window bottom-left, status bar top.

## Work Items

Execution order (do these in sequence):
1. B) Fix Renderer_AI Double Output
2. A) Log Window: Dedup + Grouping
3. C) Make Renderer Narration Conversation-Aware
4. Global Renderer Debug Toggle + Debug Reader
5. Renderer Snapshot
6. D) Global Time Display
7. Buttons panel (non-debug controls)
8. E) Output Text Rebalancing
9. F) Output Texture / Shader Pass (Optional)
10. G) Sound Effects System
11. H) Music System

### A) Log Window: Dedup + Grouping

- [~] Define canonical log ordering and grouping rules:
  - Group by `correlation_id` when present.
  - Within a group: User -> Narration -> NPC(s) -> System/debug.
  - If renderer outputs multiple times for the same `reply_to`/group, show only the latest.
- [~] Update the log fetch + filter logic in `src/canvas_app/app_state.ts`:
  - Fix “recent messages” selection (ensure we’re taking the most recent window, not an arbitrary slice).
  - Replace content-based renderer dedup with id/reply_to/correlation aware dedup.
  - Add a small debug toggle to show hidden/filtered messages (for debugging).
- [~] Hide system/state routing lines by default (keep them available behind debug).
- [~] Add message type badges (minimal): `USER`, `NARRATION`, `NPC`, `SYSTEM`.
- [~] Reduce log noise: stop logging renderer->npc_ai `npc_position_update` messages and ensure they are consumed/removed by npc_ai.
- [~] Make session filtering resilient: `SESSION_ID` should be a live binding so long-running services follow `.session_id` updates.

Acceptance:
- [ ] Sending 10 messages does not produce duplicate narration lines.
- [ ] A single player message appears once.
- [ ] The user sees a clean and readable log from game entry to game exit

Note: duplicates can be caused by backend appending bare log lines (without correlation_id) for already-logged envelopes. Avoid generating display-only log lines in `interface_program` for renderer/npc outputs.

### B) Fix Renderer_AI Double Output
- [~] In `src/renderer_ai/main.ts`, stop treating `status === "processing"` as a candidate unless a stale-lock rule exists.
- [~] Add a best-effort lock marker in `meta` (ex: `render_lock_at_ms`) so multiple ticks cannot double-process.
- [ ] Optional: ensure `meta.rendered === true` is set exactly once per processed message (only needed if re-processing returns).

Acceptance:
- [ ] Renderer produces one `rendered_1` per applied_* message (manual test + log check).

### C) Make Renderer Narration Conversation-Aware
- [~] Define the minimal conversation context packet for narration:
  - actor_ref, target_ref (if any), place_id
  - conversation participation: `response_eligible_by`, witnesses, and/or “who is in conversation” snapshot
  - last N exchange lines (user + npc) for tone/continuity (small, bounded)
- [~] Ensure ActionPipeline COMMUNICATE messages sent for narration include this context in `meta`.
- [~] Update `src/renderer_ai/main.ts` prompt assembly to incorporate the context packet when present.
- [~] If COMMUNICATE has no explicit target, allow exactly one observed NPC to respond (avoid dead-air without enabling multi-NPC pile-on).
- [~] Ensure direct target is always included in `response_eligible_by` when observed.
- [~] Prevent multi-NPC pile-on for direct targeting: if `target_ref` is set, only that target can respond.
- [~] Prevent narration from inventing NPC dialogue; narration describes non-verbal reaction only.
- [~] Exit-phase fallback: if no target and multiple NPCs observe, allow exactly one observed NPC to reply (avoid dead-air on goodbyes).

Acceptance:
- [ ] Renderer narration mentions the correct addressee and place context for simple greetings.

### Narration Routing By Action Type

- [ ] Define narration modes by action type (keep them consistent and predictable):
  - `MOVE` within a place: no narration unless something notable happens (blocked, stumble, perception event)
  - `TRAVEL` / region or place transitions: special narration
  - `INSPECT`: narration varies by target type (npc/item/tile/place)
  - `USE` (tools/attacks): narration per use subtype
  - `COMMUNICATE`: narration varies by conversation phase (entry / mid / exit); keep narration to 2 lines max
- [ ] Implement prompt routing in `renderer_ai` so each action type has its own context packet + prompt template.

### D) Global Time Display

- [~] Define what “global time” means for UI (initially: read `local_data/data_slot_1/game_time.jsonc`).
- [x] Add a time widget in the `system status` bar.
- [~] Decide format: `Day X HH:MM` (simple) and keep it stable.

Acceptance:
- [ ] Time is visible and updates without flicker.

### E) Output Text Rebalancing

- [x] Rebalance font sizes and line heights for the incoming window.

Acceptance:
- [x] Incoming window remains readable during multi-NPC chatter.

### UI Traversal (Drag-to-Pan)

- [x] Add drag-to-pan traversal for text windows (transcript/debug/status) using the same drag gesture as place.
- [x] Ensure place panning uses the same drag gesture system as text windows (DragEvent-based, consistent threshold).
- [x] Add global canvas pan (drag on free space) to traverse the full UI without browser scrollbars.
- [x] Allow vertical panning + add a small pan margin so traversal has breathing room.
- [x] Make global pan tile-locked (moves in whole character-cell steps) + add Space+drag to pan anywhere.

### UI Input Hygiene

- [x] Remove numeric-key zoom controls (`1`, `2`, `3`, `4`, ...).
  - This was not an intended feature; it should not be bound in the non-debug UI.
  - this is completed in the place module but not in the entire program
- [x] Remove place zoom controls (`+`, `-`, `0`, and ctrl+wheel zoom).

- [x] Add global UI scale controls (`-`/`+`) in 1% steps; persist between sessions.

### F) Output Texture / Shader Pass (Optional)

- [x] Implement a 2-pass turbulence displacement post-process (applies to full UI):
  - Pass 1 (wobble): large kernels (~5-10 glyphs), "paper breathing" feel
  - Pass 2 (texture): small kernels to roughen letterform edges
  - Animate via offset (not re-seeding) at ~12Hz to keep temporal coherence

Acceptance:
- [x] Text remains crisp; overlay is subtle.

Progress:
- [x] Implemented an SVG 2-pass turbulence displacement filter applied to the canvas (offset animation at 12Hz).

### G) Sound Effects System (Architecture + One Test)

- [ ] Create an SFX system architecture:
  - SFX queue (events with timestamp, kind, loudness)
  - Multiple concurrent speakers (positional emitters)
  - Dampening rules driven by the same signal model used for perception (quiet/loud)
  - Routing (recommended): use `movement_command` with a new command type `UI_SOUND`.
    - Any backend process can append a `movement_command` message for the renderer.
    - Renderer consumes via the existing command handler and plays audio immediately.
  - Contract sketch (`UI_SOUND`):
    - `sound_id` (maps to `src/mono_ui/sfx/<sound_id>.wav`)
    - `emitter_ref` + `emitter_pos` (for positional mixing)
    - `loudness` (`WHISPER`/`NORMAL`/`SHOUT` or numeric)
    - optional: `channel` (`sfx`), `max_instances`, `cooldown_ms`
  - SFX assets live in `src/mono_ui/sfx/` (temporary files that can be swapped by replacing filenames)
- [ ] Implement one test SFX:
  - When actor COMMUNICATE subtype is `NORMAL` or `SHOUT`, play a placeholder “speech blip” at actor position.
  - No TTS yet; just a deterministic test sound.

Acceptance:
- [ ] Player speaking triggers the test sound once per message.

### H) Music System (Separate)

- [~] Document architecture only (no implementation):
  - Separate channel + lifecycle from SFX
  - Music transport + playlist/state
  - Ducking rules when loud SFX occur

Architecture notes:
- Music is long-lived state ("what is playing") not fire-and-forget events.
- Keep music playback entirely renderer-local (frontend owns WebAudio + timing).
- Keep channels separate: `music` and `sfx` must have independent gains/mix.

Recommended model:
- MusicTransport (renderer)
  - One active "track" at a time + optional "stinger" overlay.
  - Crossfade between tracks (e.g. 800-1500ms), never hard-cut unless emergency.
  - Internal state machine:
    - STOPPED -> LOADING -> PLAYING -> FADING_OUT -> STOPPED
  - Persist desired music state in memory (NOT in log.jsonc) to avoid replay-on-boot.

Playlist/state:
- Use a small declarative "music state" packet (input-driven, not time-driven):
  - `context_id` (e.g. place_id, region_id, combat_id)
  - `mood` tag (calm, tense, mystery, etc.)
  - `intensity` 0..1
  - `allow_silence` boolean
- Renderer resolves the packet into an actual asset id using a table.

Ducking:
- Ducking is a mixing rule: loud SFX temporarily reduce music gain.
- Suggested rule:
  - On SFX with loudness >= SHOUT: duck music to ~-10dB for 250ms, recover over 900ms.
  - On bursty UI sounds: no duck.
- Ducking is optional and should be easy to disable for debugging.

Control contract (design-only):
- Prefer using the existing movement_command path (renderer already polls outbox):
  - Add a new renderer command type later: `UI_MUSIC`
  - Payload sketch:
    - `music_id` OR `music_state` packet
    - `action`: play|stop|fade
    - `fade_ms`
    - `priority` (combat overrides ambient)
    - `channel`: music
  - Renderer debounces: ignore redundant commands that don't change resolved state.

Assets:
- Keep placeholders swappable by filename:
  - `src/mono_ui/music/<music_id>.ogg` (or .wav initially)
  - separate from `src/mono_ui/sfx/`

## Debug Reader Module

- [ ] Define a patch module that reads state and prints it clearly.
  - Supports two views:
    - `State` (region/world tile coords, place id, selection, conversation)
    - `Debug` (last action id / correlation id / audio debug)
  - region/world tile coordinates
  - place id
  - selected target
  - conversation presence (actor + npc)
  - last action id / correlation id
  - optional: audio debug (recent sound events + dampening)
  - show current debug toggle states (when global debug enabled):
    - vision debug enabled
    - hearing ranges (H)
    - sense broadcasts (B)
    - LOS occlusion (V)

Acceptance:
- [ ] Debug reader helps diagnose “why did X respond” without reading logs.

Progress:
- [~] Debug reader window exists and shows toggle states + volume + last input id.
- [~] Debug reader shows current selected target prominently (prevents “wrong NPC replied” confusion).

### Global Renderer Debug Toggle

- [~] Make `\` a global renderer debug toggle.
  - When enabled, all modules may expose debug affordances.
  - Example: buttons panel shows extra debug markers (ex: `H`, `P`) and debug-only toggles.
  - Debug-only hotkeys (H/B/V overlays) should do nothing when debug is disabled.

### Renderer Snapshot (LLM-Friendly Debugging)

- [~] Add a hotkey to dump the current composed UI grid as raw ASCII to disk.
  - Hotkey: `Ctrl+.` / `Ctrl+/` (and `.` or `/` when nothing is focused)
  - Output: `local_data/data_slot_1/logs/ui_snapshot_<session_id>_<timestamp>.txt`
  - Include header metadata (timestamp, session_id, grid size)

Acceptance:
- [ ] Snapshot files are created and correlate to the current session id.

## Notes

- This plan should remain the single source of truth for UI improvements.
- If you discover an issue while implementing, add it here as a checkbox item (not as a build log).

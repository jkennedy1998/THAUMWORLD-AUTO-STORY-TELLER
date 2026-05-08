# 2026-05-06 Remote Relay Multiplayer Implementation Plan

## Context

THAUMWORLD and ASCII Painter already share a working direct multiplayer spine built around:

- `GET /api/host/status`
- `POST /api/connect`
- `session_token` + `reconnect_token`
- bridge WebSocket attach using `session_token`
- app-specific bootstrap after session attachment

Current implementation is still centered on local/manual-direct hosts. The architecture plan now locks the product model to:

- `local`
- `direct`
- `remote_relay`

The first remote implementation should be standard, replaceable, and modest in scope:

- one public Node control+relay service
- HTTPS + WSS
- in-memory room/session registry first
- private join-code sessions only
- host remains authoritative
- remote relay reuses the current session/bootstrap lifecycle where practical

This document maps that decision to concrete repo code changes.

Related cleanup/validation discipline plan for the recent TAI + multiplayer stabilization work:

- `docs/plans/2026_05_06_multiplayer_tai_cleanup_plan.md`

## Implementation Goal

Add a first end-to-end `remote_relay` path without breaking `local` or `direct`, while keeping the shared multiplayer/session substrate common across THAUMWORLD and ASCII Painter.

## Main Strategy

Do not create a second multiplayer model.

Instead:

1. extend connection vocabulary to represent remote relay targets
2. add a shared remote control/relay client layer
3. add a public control+relay service
4. preserve host authority and existing `/api/connect`-style session semantics
5. adapt transport resolution so both direct and remote feed the same app bootstrap flow

## Current Reusable Code

### Shared join/session pieces to preserve

- `src/engine_multiplayer/connection_probe.ts`
- `src/engine_multiplayer/join_directory.ts`
- `src/engine_multiplayer/join_preference_store.ts`
- `src/shared/multiplayer_transport.ts`
- `src/shared/multiplayer_session.ts`
- `src/interface_program/main.ts` (`/api/host/status`, `/api/connect`)
- `src/event_bridge/main.ts` (session-token-gated WS attach)

### Current UI/entry points to extend

- `src/engine_launch/join_controller.ts`
- `src/canvas_app/world_discovery.ts`
- `src/canvas_app/app_state.ts`
- `src/canvas_app/main.ts`

## Target Module Shape

## A. Public service modules

Add a new public service area, likely under one of:

- `src/remote_relay_service/*`
- or `src/multiplayer_cloud/*`

Recommended first-pass files:

- `src/remote_relay_service/server.ts`
- `src/remote_relay_service/control_api.ts`
- `src/remote_relay_service/relay_ws.ts`
- `src/remote_relay_service/store.ts`
- `src/remote_relay_service/tokens.ts`
- `src/remote_relay_service/types.ts`
- `src/remote_relay_service/rate_limits.ts`
- `src/remote_relay_service/logging.ts`

## B. Shared client/core modules

Add shared remote client helpers:

- `src/shared/remote_relay_protocol.ts`
- `src/shared/remote_relay_client.ts`
- `src/shared/remote_control_client.ts`
- `src/shared/remote_session_types.ts`

## C. Engine multiplayer extensions

Extend current engine multiplayer area:

- `src/engine_multiplayer/connection_types.ts`
- `src/engine_multiplayer/connection_store.ts`
- `src/engine_multiplayer/connection_probe.ts`
- `src/engine_multiplayer/join_directory.ts`
- possibly add `src/engine_multiplayer/remote_connection_store.ts`
- possibly add `src/engine_multiplayer/remote_join_code_store.ts`

## D. Host/runtime integration

Likely new host/runtime helpers:

- `src/interface_program/remote_host_session.ts`
- `src/shared/remote_host_registration.ts`
- `src/shared/relay_tunnel_runtime.ts`

These should bridge host authority code to the public service without moving game/painter authority out of the host.

## File-by-File Change Map

## 1. `src/engine_multiplayer/connection_types.ts`

### Change
Expand the connection model to represent remote relay entries cleanly.

### Planned edits
- [ ] add `remote_join_code` to `EngineConnectionKind`
- [ ] add `method: 'local' | 'direct' | 'remote_relay'` to connection entries or join selections
- [ ] extend transport shape so selections can describe direct vs relay transport explicitly
- [ ] add metadata fields for remote sessions such as:
  - `room_id?`
  - `session_id?`
  - `join_code?`
  - `relay_origin?`
  - `visibility?`
  - `app_kind?`

### Reason
Current kinds only model local/manual direct. Remote needs a first-class entry type without overloading direct host fields.

## 2. `src/engine_multiplayer/connection_store.ts`

### Change
Preserve current manual direct storage, but stop treating all non-local joins as saved hosts.

### Planned edits
- [ ] keep current localStorage-based direct host storage intact for first pass
- [ ] add separate persistence path for remote session history or recent join codes
- [ ] avoid storing long-lived remote auth secrets locally
- [ ] add helpers for remembering recent remote targets in a minimal way

### Reason
Direct host memory and remote relay memory are not the same thing.

## 3. `src/engine_multiplayer/connection_probe.ts`

### Change
Split direct probing from remote resolution.

### Planned edits
- [ ] keep `/api/host/status` probing for `local`, `lan_discovered`, and `saved_manual`
- [ ] add remote resolution path that does not assume direct host HTTP access
- [ ] introduce a remote status/result shape for join-code resolution and relay attach readiness
- [ ] preserve current `HostStatus` for direct mode
- [ ] add common output shape so join UI can still reason about joinability uniformly

### Reason
Remote relay should not fake itself as a direct host probe.

## 4. `src/engine_multiplayer/join_directory.ts`

### Change
Teach join directory sorting and selection about `remote_relay` entries.

### Planned edits
- [ ] update ranking rules to handle remote entries explicitly
- [ ] keep local first, then reachable direct, then recent remote/private entries, then offline direct
- [ ] avoid marking remote join-code entries as if they were manual host entries
- [ ] keep transport resolution separate from saved connection identity

### Reason
Current sort/order logic assumes only local/manual/LAN direct shapes.

## 5. `src/shared/multiplayer_transport.ts`

### Change
Refactor transport config so direct and relay are both first-class strategies.

### Planned edits
- [ ] preserve direct helpers like `build_multiplayer_transport_config(...)`
- [ ] add a transport strategy discriminator, e.g.:
  - `kind: 'direct_http_ws' | 'relay_ws_tunnel'`
- [ ] add relay transport config shape with fields like:
  - `relay_https_origin`
  - `relay_wss_origin`
  - `room_id`
  - `attach_token`
- [ ] keep app-facing transport access narrow and stable

### Reason
Current transport helpers assume host-derived API/bridge URLs.

## 6. `src/shared/multiplayer_session.ts`

### Change
Preserve app session model, but define how it lives inside remote relay transport.

### Planned edits
- [ ] keep `session_token`, `reconnect_token`, `client_session_id`, `connection_id`
- [ ] document and possibly extend session records for remote correlation fields only if needed
- [ ] do not let cloud relay become the owner of app session semantics

### Reason
This is already the right place for host-authoritative client session leasing.

## 7. `src/interface_program/main.ts`

### Change
Add host-side remote session registration/tunnel support while keeping current direct endpoints.

### Planned edits
- [ ] keep `/api/host/status` and `/api/connect` working unchanged for direct mode
- [ ] add host-side endpoints or internal hooks for:
  - start remote hosting
  - stop remote hosting
  - inspect remote hosting status
- [ ] make host runtime register with the public control service
- [ ] keep the host as authority that still issues app sessions
- [ ] ensure remote mode still reaches the same conceptual connect/bootstrap flow

### Reason
This file already owns host authority HTTP behavior.

## 8. `src/event_bridge/main.ts`

### Change
Keep event bridge local-authority-side, but prepare it to sit behind a relay tunnel.

### Planned edits
- [ ] do not turn this file directly into the public relay service
- [ ] preserve current `session_token` validation and heartbeat behavior
- [ ] add an adapter or tunnel layer so relay-attached clients can still participate in the same message/session model
- [ ] keep logging fields expandable with `room_id`/`session_id` correlation when remote mode is active

### Reason
This should stay the authority-side message/session bridge, not the internet relay implementation.

## 9. `src/engine_launch/join_controller.ts`

### Change
Expand join UX flow to handle remote sessions cleanly.

### Planned edits
- [x] add a remote join flow for entering a join code
- [x] preserve direct connection list behavior
- [x] update status lines and selection output to show method and remote resolution state
- [ ] surface clearer failure reasons for:
  - direct probe failure
  - join code invalid
  - relay attach failed
  - remote host unavailable

### Reason
Current join controller is direct-entry oriented.

## 10. `src/canvas_app/world_discovery.ts`

### Change
Integrate remote relay entries into the existing world discovery model.

### Planned edits
- [x] keep local/direct world discovery intact
- [x] add remote world join targets as a separate source path
- [x] do not require remote sessions to look like LAN hosts
- [x] normalize results into the same join UI shape where possible

### Reason
This is part of the app-facing discovery pipeline that will otherwise remain biased toward direct hosts.

## 11. `src/canvas_app/app_state.ts`

### Change
Preserve app session bootstrap flow while letting transport be direct or relay.

### Planned edits
- [x] keep `ensure_multiplayer_session_bootstrap(...)` as the main authority-session entry point
- [x] abstract transport send/receive path so `/connect` semantics can be preserved through relay
- [x] avoid hard-coding direct HTTP assumptions into remote mode
- [x] keep reconnect-token persistence behavior, unless remote-specific tweaks are required
- [x] add remote join logging fields including method, room, and relay endpoint context

### Reason
This is one of the main places where direct assumptions currently leak into bootstrap.

## 12. `src/canvas_app/main.ts`

### Change
Preserve painter join behavior while allowing remote selections.

### Planned edits
- [x] keep painter direct join flow intact
- [x] teach painter launch/join selection to accept relay-backed transport selections
- [x] preserve join-preference recording, but distinguish direct vs remote strategy values cleanly
- [x] make sure painter remote document identity is remembered without persisting sensitive relay credentials

### Reason
Painter already reuses shared selection pieces and should continue doing so.

## 13. `src/engine_multiplayer/join_preference_store.ts`

### Change
Allow preferences to remember remote join targets intentionally.

### Planned edits
- [x] preserve content-ref-based preference lookup
- [x] allow strategy values to distinguish direct vs remote relay
- [x] define what remote metadata is safe to persist as preference hints
- [x] do not persist short-lived attach credentials

### Reason
Current preference handling already tracks transport strategy and is a good fit for this extension.

## 14. New public service launcher/scripts

### Change
Add standard scripts for running the public control+relay service.

### Planned edits
- [x] add a dev script for the service
- [ ] add a production/launch script for the service
- [ ] add docs for config env vars:
  - public HTTPS origin
  - public WSS origin
  - token secret or token config if needed
  - lease durations
  - rate limits

### Reason
The public service should be runnable and testable independently from the host app.

## Protocol Decisions To Encode In Code

## Control API

First-pass public JSON endpoints should include shapes equivalent to:

- [x] host create/register remote session
- [x] host refresh remote session lease
- [x] host close remote session
- [x] client resolve join code
- [x] optional inspect/debug endpoint in dev

## Relay API

First-pass WSS attach should include:

- [x] host attach with `host_token`
- [x] client attach with room-scoped short-lived token
- [x] one active host connection per room
- [ ] reconnect replacing old host attachment where needed
- [x] small JSON message envelope only

## Message Envelope

Add a shared protocol file with a small explicit envelope, e.g. fields like:

- [ ] `type`
- [ ] `room_id`
- [ ] `sender_role`
- [ ] `target`
- [ ] `request_id?`
- [ ] `payload`
- [ ] `sent_at_ms?`

The exact naming can vary, but it must be shared by host and client code.

## Suggested Phases

## Phase 1: Shared types and transport split

- [ ] extend `connection_types.ts`
- [ ] extend `multiplayer_transport.ts`
- [ ] add remote protocol/type files
- [ ] update join directory and connection store data models
- [ ] keep direct mode green

### Exit condition
Codebase can represent `remote_relay` selections without yet connecting to a real relay service.

## Phase 2: Public control+relay service MVP

- [x] add new public service modules
- [x] in-memory room/session store
- [x] HTTPS JSON control endpoints
- [x] WSS relay endpoint
- [x] attach-token validation
- [x] attach-token expiry + bounded-use guardrails
- [x] lease expiry cleanup
- [x] basic rate limits

### Exit condition
A host can register a private join-code room and a client can resolve it and attach to the same relay room.

## Phase 3: Host runtime integration

- [x] host can start/stop remote hosting
- [x] host registers with control service
- [x] host attaches outbound to relay
- [x] host exposes remote-hosting status to app/UI
- [x] direct endpoints continue to work unchanged

### Exit condition
The host runtime can advertise a relay-backed private session while remaining local authority.

## Phase 4: Client join integration

- [x] add remote join-code UX
- [x] resolve join code from app/client side
- [x] adapt session/bootstrap flow to run over relay transport
- [x] preserve `/connect`-style semantics conceptually
- [x] preserve reconnect behavior where possible

### Exit condition
THAUMWORLD client can join a remote relay session end-to-end.

## Phase 5: ASCII Painter integration

- [x] adapt painter join flow to relay-backed selections
- [x] preserve painter hosted-session bootstrap logic
- [ ] verify remote document bootstrap and revision flow
- [x] verify preference/history behavior

### Exit condition
ASCII Painter client can join a remote relay session end-to-end.

## Phase 6: Hardening and cleanup

- [x] add shared logging vocabulary fields
- [x] add correlation IDs to host/client/control/relay logs
- [ ] tune guardrails and rate limits
- [x] tighten attach-token lifecycle (short TTL, bounded HTTP reuse, one-time WS attach)
- [x] write direct/LAN regression checks
- [x] add automated CORS/custom-header regression coverage for direct host + relay control preflight paths
- [ ] remove or quarantine dead-end remote experiments if any appear

### Exit condition
Remote MVP is debuggable and direct mode remains intact.

## Logging/Observability Code Changes

Add common fields across local app logs and public service logs where applicable:

- [x] `method`
- [x] `room_id`
- [x] `session_id`
- [x] `connection_id`
- [x] `client_session_id`
- [x] `slot`
- [x] `app_kind`

Update existing log families rather than inventing totally separate ones where practical:

- [x] `[JOIN_PROBE]`
- [x] `[JOIN_UI]`
- [x] `[JOIN_CONNECT]`
- [x] `[HOST_STATUS]`
- [x] `[HOST_CONNECT]`
- [x] event bridge logs
- [x] new remote control/relay logs

## Regression Rules

Before merging relay work, keep these true:

Manual checklist doc:
- `docs/plans/2026_05_06_remote_relay_multiplayer_regression_checklist.md`

Automated regression coverage:
- `src/tests/multiplayer_cors_headers.test.ts`
- local TAI smoke coverage via `local_data/tool_assisted_inputs/tai10_game_join_actor_claim_smoke/script.json`
- local painter TAI smoke coverage via `local_data/tool_assisted_inputs/tai11_painter_join_bootstrap_smoke/script.json`

- [ ] local join still works with no cloud dependency
- [ ] saved manual direct host join still works
- [ ] `/api/host/status` remains valid for direct mode
- [ ] `/api/connect` remains valid for direct mode
- [ ] event bridge `session_token` validation remains intact
- [ ] THAUMWORLD direct join preferences still work
- [ ] Painter direct join preferences still work
- [x] local THAUMWORLD TAI join smoke remains boot-stable after join-menu changes
- [x] local painter TAI bootstrap smoke remains boot-stable after launch/join timing changes

## Risks To Watch During Implementation

- [ ] accidentally coupling app logic to relay details
- [ ] accidentally replacing direct join semantics instead of extending them
- [ ] leaking short-lived remote auth tokens into persistent local state
- [ ] turning event bridge into the internet relay instead of keeping it authority-local
- [ ] introducing remote-only assumptions into direct/local paths
- [ ] overbuilding for multi-instance scale before single-instance MVP works

## Definition Of Done For This Implementation Plan

- [ ] every major architecture decision is mapped to concrete files or new modules
- [ ] shared-vs-app-specific changes are explicit
- [ ] public service work is separated from host runtime work
- [ ] direct-regression expectations are explicit
- [ ] phased implementation can begin without reopening architecture debates

## Immediate Next Step

Use this plan to choose the first actual code phase.

Recommended first coding slice:

1. shared type/transport expansion
2. new remote protocol type definitions
3. join-controller and storage model updates that can represent `remote_relay` without yet implementing network behavior

That keeps early changes small, testable, and less likely to collide with unrelated work in the repo.

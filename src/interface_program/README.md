# interface_program

HTTP/program host layer for THAUMWORLD.

## Purpose

`interface_program` is the transport and composition boundary between outside programs and the game/runtime systems.

It should make THAUMWORLD usable from:
- the main UI
- other local programs
- future headless tools
- multiplayer/session clients

## Owns

- HTTP route handling
- request/response formatting
- session/auth transport checks
- host/process composition
- wiring reusable interface-facing services together

## Does not own

- core action rules
- world simulation rules
- NPC cognition/decision rules
- storage format ownership
- inventory/place/world domain models

Those should live in their domain modules and be called from here.

## Folder pattern

This folder is moving toward feature-folder encapsulation:

- `main.ts`
  - host boot and top-level route composition
- `<feature>/`
  - one capability per folder
  - colocated `README.md`
  - route + service files for that capability
- existing state/domain helpers
  - backing implementations used by feature folders

Transitional `routes/` and `services/` files may remain as compatibility shims while seams are moved into feature folders.

## Extracted seams

### `target/`

- `target/README.md`
- `target/route.ts`
- `target/service.ts`
- backing state: `target_state.ts`

Handles `/api/target` by:
- authorizing the actor
- setting or clearing the selected target
- returning a stable result payload

Why it was first:
- small
- already partially encapsulated
- low risk
- useful to non-HTTP callers

### `session_health/`

- `session_health/README.md`
- `session_health/route.ts`
- `session_health/service.ts`

Handles read-only operational endpoints:
- `/api/log`
- `/api/status`
- `/api/health`
- `/api/health/session`

## Rule of thumb for future work

When adding or refactoring interface behavior:

1. keep `main.ts` thin
2. move route-specific HTTP code into `routes/`
3. move reusable behavior into `services/`
4. do not put game rules in route handlers
5. prefer stable service inputs/outputs over direct storage calls from routes

## Current state

This is the first extraction, not the final architecture.

The goal is incremental improvement:
- thinner route handling
- clearer ownership
- more reusable program-facing seams
- less logic trapped inside `main.ts`

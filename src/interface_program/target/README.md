# target

Colocated README for the encapsulated target feature.

Target selection seam for `interface_program`.

## Purpose

Owns the interface-facing target selection boundary used by HTTP callers and internal program callers.

## Owns

- the `/api/target` HTTP adapter
- set-or-clear target selection behavior
- stable target selection inputs and result shapes for interface callers

## Does not own

- target highlighting implementation details
- actor or NPC storage ownership
- combat/action semantics beyond selecting a target
- actor authorization policy ownership
- target persistence beyond the backing target state module

## How to talk to it

### HTTP

- `POST /api/target`

Request body:
- `session_token`
- `actor_ref`
- `target_ref` or `null`
- optional `target_type`
- optional `target_name`

Response:
- `{ ok: true, action: "set", actor_ref, target_ref, target_type }`
- `{ ok: true, action: "cleared", actor_ref }`
- or an error payload

### Internal code

- `handleTargetRoute(...)` for HTTP route delegation
- `applyActorTargetSelection(...)` for non-HTTP callers

## Dependencies

- `../target_state.ts`
- auth helpers passed from `main.ts`
- `../../shared/debug.ts`

## Side effects

- updates in-memory target selection state
- may trigger highlight/target UI commands through `target_state.ts`

## Notes

This is the first folder-level encapsulated seam under `interface_program`.
It is intentionally small and low risk, and serves as the template for future extractions.

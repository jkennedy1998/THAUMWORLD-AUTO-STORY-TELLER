# session_health

Colocated README for the encapsulated session health feature.

Read-only operational status seam for `interface_program`.

## Owns

- `/api/log`
- `/api/status`
- `/api/health`
- `/api/health/session`
- slot parsing and HTTP status mapping for those endpoints
- shaping health/status/log snapshots for interface callers

## Does not own

- session token auth
- actor control or multiplayer claims
- simulation or world rules
- status/log file writing
- process boot or server lifecycle

## How to talk to it

### HTTP

- `GET /api/log?slot=<n>&all=1`
- `GET /api/status?slot=<n>`
- `GET /api/health`
- `GET /api/health/session`

### Internal code

- `handleSessionHealthRoute(...)` for HTTP route delegation
- `readSessionLog(...)`
- `readSessionStatus(...)`
- `readInterfaceHealth(...)`
- `readSessionHealth(...)`

## Dependencies

- `src/engine/log_store.ts`
- `src/engine/status_store.ts`
- `src/engine/paths.ts`
- `src/time_system/tracker.ts`
- `src/shared/session.ts`

## Notes

This seam is intentionally read-only and low risk.
It exists to pull operational diagnostics out of `main.ts` without changing response shapes or status-code behavior.

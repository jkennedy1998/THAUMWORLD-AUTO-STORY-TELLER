# 2026-05-06 Remote Relay Multiplayer Regression Checklist

## Purpose

Manual regression matrix for the current `local` + `direct` + `remote_relay` multiplayer rollout across THAUMWORLD and ASCII Painter.

## Log-first debugging reminder

Always inspect:

- `local_data/data_slot_<N>/logs/YYYY-MM-DD/latest.log`

Then check the referenced session log for:

- `[JOIN_PROBE]`
- `[JOIN_UI]`
- `[JOIN_CONNECT]`
- `[HOST_STATUS]`
- `[HOST_CONNECT]`
- `[REMOTE_CONTROL]`
- `[REMOTE_RELAY]`
- `[EVENT_BRIDGE]`
- `[PAINTER_JOIN]`
- `[PAINTER_LAUNCH]`
- `[PAINTER_WS_ATTACH]`

---

## A. THAUMWORLD local/direct regressions

### A1. Local self-host join still works
- [ ] launch local host/client flow with no relay env configured
- [ ] verify `/api/host/status` returns `ok: true`
- [ ] verify `/api/connect` returns `session_token`, `reconnect_token`, `connection_id`, `boot_session_id`
- [ ] verify renderer/event bridge websocket attaches successfully
- [ ] verify no relay-only fields are required

### A2. Saved manual direct host still works
- [ ] save a manual host entry like `192.168.x.x` or `host:port`
- [ ] refresh join directory and verify it probes through direct `/api/host/status`
- [ ] join successfully
- [ ] verify direct host history updates `last_connected_at`
- [ ] verify remote session history is not used for this flow

### A3. Direct reconnect still works
- [ ] join a direct host
- [ ] restart renderer/client side only if possible
- [ ] verify reconnect token reuse path succeeds
- [ ] verify `[JOIN_CONNECT]` shows `reconnect_token_reused`

---

## B. THAUMWORLD remote relay regressions

### B1. Remote host registration
- [ ] run relay service
- [ ] run host with `THAUM_REMOTE_RELAY_ORIGIN`
- [ ] verify `GET /api/remote_relay/status` reports active room state
- [ ] verify `/api/host/status` includes `remote_relay`
- [ ] verify logs show host register + host socket connect

### B2. Remote join-code resolution and connect
- [ ] add or enter join code
- [ ] verify `[JOIN_PROBE]` resolves room and relay attach fields
- [ ] verify `/api/connect` succeeds through relay-backed HTTP proxy
- [ ] verify websocket attach succeeds through relay-backed WS path
- [ ] verify bootstrap reaches normal playable state

### B3. Consumed/expired attach token rejection
- [ ] attempt to reuse a consumed attach token for websocket attach
- [ ] verify rejection with `invalid_or_consumed_attach_token`
- [ ] verify fresh join-code resolution produces a new working attach token

### B4. Lease expiry / explicit close
- [ ] stop host cleanly and verify relay close occurs
- [ ] or allow lease to expire without refresh
- [ ] verify subsequent join-code resolve reports offline/unavailable

---

## C. ASCII Painter direct regressions

### C1. Local authoritative painter host still works
- [ ] launch painter in local host path
- [ ] verify painter bootstrap reaches `authority_mode: authoritative_host`
- [ ] verify painter document bootstrap loads snapshot
- [ ] verify local edits continue to apply normally

### C2. Direct painter join still works
- [ ] join an authoritative painter host over direct transport
- [ ] verify `painter_document_id` is discovered from host status
- [ ] verify painter `/connect` succeeds and websocket attaches
- [ ] verify initial snapshot loads
- [ ] verify revision/patch updates continue after join

---

## D. ASCII Painter remote relay regressions

### D1. Remote painter join transport
- [ ] join a relay-backed painter session
- [ ] verify painter launch logs include `transport_kind: relay_ws_tunnel`
- [ ] verify room-scoped `relay_room_id` is present in logs
- [ ] verify websocket attach uses relay attach path, not direct localhost assumptions

### D2. Remote painter bootstrap
- [ ] verify remote painter `/api/host/status` resolves `painter_document_id`
- [ ] verify painter `/connect` succeeds over relay-backed HTTP proxy
- [ ] verify authoritative snapshot is received and applied
- [ ] verify lifecycle reaches multiplayer-ready state

### D3. Remote painter patch/revision flow
- [ ] make a host-side painter edit
- [ ] verify remote participant receives patch events
- [ ] verify revision increments monotonically
- [ ] verify revision-gap recovery still re-bootstrap snapshots if needed

### D4. Painter preference/history behavior
- [ ] after successful remote painter join, verify join preference persists `remote_relay`
- [ ] verify remote document content ref is saved without short-lived attach credentials
- [ ] verify direct-manual host storage does not get polluted by relay join codes
- [ ] verify recent remote session list updates online/connected timestamps

---

## E. Correlation/logging checks

- [ ] verify direct `/api/host/status` carries `request_id`
- [ ] verify direct `/api/connect` carries `request_id`
- [ ] verify relay control requests carry `x-remote-request-id`
- [ ] verify websocket attach logs carry `request_id`
- [ ] verify `room_id`, `connection_id`, and `client_session_id` appear where expected

---

## Current known focus areas

- painter remote flow should now preserve relay transport metadata instead of collapsing back to direct-only assumptions
- dedicated remote join UI still remains future polish; current entry path is text-based
- host room persistence across restarts is still intentionally deferred

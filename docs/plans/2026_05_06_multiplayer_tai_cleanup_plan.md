# 2026-05-06 Multiplayer TAI Cleanup Plan

## Current context

THAUMWORLD multiplayer transport and relay work has advanced significantly, but the most recent validation pass mixed too many concerns at once:

- direct/local join validation
- remote relay validation
- join-menu / TAI modernization
- actor-claim gameplay assertions
- ASCII Painter boot/runtime stability
- stale launcher/process/lock state

That made failures ambiguous and slowed diagnosis.

This plan is a cleanup and execution-discipline plan only. It is intentionally focused on the work we were just doing: validating multiplayer and modernizing TAI without continuing to stumble across unrelated layers.

## Goal

Restore a clean, trustworthy multiplayer validation loop by:

- separating product/runtime failures from automation failures
- re-establishing one small canonical passing baseline
- cleaning environment/state before each serious run
- validating layered join milestones instead of broad end-to-end guesses
- treating ASCII Painter stability as its own track instead of mixing it into THAUMWORLD join proof

## Best-practice operating rules

- [ ] Do not combine new feature work with flaky smoke-test debugging in the same pass.
- [ ] Each test should answer one primary question only.
- [ ] Prefer smallest-scope validation first: probe -> connect -> websocket attach -> ready.
- [ ] Treat logs as the source of truth before interpreting UI/TAI failure symptoms.
- [ ] Always start from a known-clean launcher/process/lock state.
- [ ] Keep THAUMWORLD, relay, Painter, and TAI-framework issues in separate buckets.
- [ ] Do not treat blocked Painter boot as multiplayer evidence.
- [ ] Do not treat actor-claim failure as join-transport failure unless logs show connect/attach broke first.

## Failure buckets

Use these buckets consistently during cleanup:

### 1. Environment/state hygiene
- stale `host_launcher.lock`
- lingering node/electron processes
- launcher attaching to old host state
- stale session/log assumptions

### 2. THAUMWORLD direct/local multiplayer
- `/api/host/status`
- `/api/connect`
- websocket attach
- session/bootstrap ready

### 3. Remote relay multiplayer
- host register
- join-code resolve
- relay-backed HTTP proxy
- relay-backed websocket attach

### 4. TAI framework reliability
- action semantics
- timing profile behavior
- state-driven waits
- boot sequencing
- script scope being too broad

### 5. ASCII Painter runtime stability
- boot/init ordering
- launch intent handling
- painter join/bootstrap
- patch/revision flow

## Canonical validation order

Do not skip ahead.

### Phase A: Re-establish one known-good baseline

Primary target:

- THAUMWORLD only
- local/direct only
- join only
- no actor-claim requirement
- no Painter
- no relay dependency

Success means logs prove all of:

- [ ] `[JOIN_PROBE]` online
- [ ] `[JOIN_CONNECT]` connect succeeded
- [ ] `[WebSocketClient]` connected successfully
- [ ] session/bootstrap reached ready state
- [ ] run result is not dependent on actor claim or gameplay state

### Phase B: Lock down the direct smoke contract

Once Phase A is stable:

- [ ] keep one canonical THAUMWORLD join-only smoke script
- [ ] keep actor-claim as a separate higher-scope smoke, not the baseline truth source
- [ ] require direct/local smoke to pass before relay or Painter smoke is trusted

### Phase C: Validate relay separately

Only after direct/local baseline is stable:

- [ ] validate host registration
- [ ] validate join-code resolution
- [ ] validate relay-backed `/api/connect`
- [ ] validate relay-backed websocket attach
- [ ] validate ready state without adding gameplay assertions first

### Phase D: Stabilize Painter separately

Only after THAUMWORLD baseline and relay validation are understood:

- [ ] fix/understand Painter boot/init issues first
- [ ] validate painter join/bootstrap second
- [ ] validate patch/revision flow third
- [ ] only then make `tai11` a real multiplayer smoke again

## Clean-run ritual before each serious validation pass

Perform these steps every time:

- [ ] confirm whether launcher should start fresh host or attach to existing host
- [ ] inspect `local_data/data_slot_<N>/host_launcher.lock`
- [ ] inspect `local_data/data_slot_<N>/host_session.json`
- [ ] confirm no stale node/electron processes are holding the old run open
- [ ] start a fresh log session and record the exact session log path
- [ ] use `latest.log` first when reading results

## Layered verdict model

Every run should be judged by layers, not by one final vague “pass/fail”.

### Layer 1: Host availability
- [ ] host started
- [ ] `/api/host/status` reachable

### Layer 2: Probe success
- [ ] join probe returned online
- [ ] join metadata matched expected transport/method

### Layer 3: Connect success
- [ ] `/api/connect` returned session credentials

### Layer 4: WS attach success
- [ ] websocket attach succeeded

### Layer 5: Session ready
- [ ] bootstrap reached usable session state

### Layer 6: Optional app-specific behavior
- [ ] actor claim
- [ ] painter snapshot apply
- [ ] painter patch/revision flow

If failure happens, classify it at the earliest broken layer.

## Test-scope cleanup rules

### THAUMWORLD
- [ ] baseline smoke should assert join/session readiness only
- [ ] actor claim should move to a separate smoke classification
- [ ] menu-selection semantics should be validated independently from connection transport where possible

### Relay
- [ ] first relay smoke should prove transport only
- [ ] do not add reconnect/expiry/consumed-token cases until basic relay join is clean

### Painter
- [ ] first Painter cleanup target is boot stability
- [ ] only after boot is stable should multiplayer assertions matter

## Logging discipline

For every investigated run, capture and review:

- [ ] session log path
- [ ] whether run was fresh-start or attached-to-existing-host
- [ ] `[JOIN_PROBE]`
- [ ] `[JOIN_UI]`
- [ ] `[JOIN_CONNECT]`
- [ ] `[HOST_STATUS]`
- [ ] `[HOST_CONNECT]`
- [ ] `[WebSocketClient]`
- [ ] `[REMOTE_CONTROL]` / `[REMOTE_RELAY]` when relay is involved
- [ ] `[PAINTER_JOIN]` / `[PAINTER_LAUNCH]` only for Painter lane

## Immediate next implementation/cleanup sequence

### 1. Re-baseline THAUMWORLD join smoke
- [x] define one canonical join-only TAI smoke as the truth source for direct/local multiplayer
- [x] keep it free of actor-claim assertions
- [ ] verify it from a fresh run with a named log session

Implementation note:
- canonical baseline is now `tai12` / `npm run dev:tai:baseline`

### 2. Quarantine higher-scope THAUMWORLD smoke
- [x] classify actor-claim smoke as secondary coverage
- [x] do not let it block transport/join confidence unless lower-layer join logs fail

Implementation note:
- actor-claim coverage is now `tai10` / `npm run dev:tai:actor_claim`

### 3. Quarantine Painter multiplayer smoke
- [x] classify current `tai11` as blocked until Painter boot is stable
- [x] record Painter boot/init failure separately from multiplayer status

Implementation note:
- `tai11` registry metadata and launcher output now warn that it is blocked and not a canonical multiplayer truth source

### 4. Resume relay smoke only after direct baseline is trustworthy
- [ ] use same layered verdict model
- [ ] transport first, richer behavior later

## Completion criteria

This cleanup plan is complete when:

- [ ] there is one trusted THAUMWORLD join-only baseline smoke
- [ ] actor-claim failures no longer confuse join-transport diagnosis
- [ ] Painter boot failures are tracked separately from multiplayer verdicts
- [ ] relay validation is run only after direct/local baseline passes cleanly
- [ ] each investigated failure is assigned to one clear bucket and one earliest broken layer

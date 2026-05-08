# 2026-05-06 Remote Relay Multiplayer Architecture Plan

## Context

THAUMWORLD and ASCII Painter already have working same-machine and LAN/manual-direct multiplayer paths. The current codebase already has a shared multiplayer shape built around host probing, `/api/host/status`, `/api/connect`, session tokens, reconnect tokens, and bridge WebSocket attachment. Local testing and LAN-style direct joins are important to preserve permanently.

The open problem is the "wifi to other wifi anywhere in the world" case: remote player-hosted sessions without requiring port forwarding. Based on current project goals, Headscale/overlay remains a useful dev fallback, but it is not the desired end-user answer because the long-term target is low-friction remote joining, ideally with zero install on locked-down machines.

This plan therefore sets the architecture target as:

- keep `local` forever
- keep LAN/manual direct forever
- add one true `remote_relay` path for internet play
- treat `remote` as relay-only in the product model
- share the remote join substrate across THAUMWORLD and ASCII Painter
- keep one authoritative player host machine
- keep relay as transport only, not gameplay/document authority
- favor a standard, replaceable implementation over an overbuilt one

This plan is architecture-first. It is intended to lock the shape of the system before implementation expands. It also assumes the first implementation should be reasonable, secure-by-default, and easy to replace later if a better backend architecture is needed.

## Intent

Define a scalable multiplayer architecture with exactly three first-class connection methods:

1. `local`
2. `direct`
3. `remote_relay`

Each method should have one canonical implementation path. We should avoid overlapping half-solutions for remote play once the relay path is established.

## Locked Direction

1. The host remains a player machine, not a cloud simulation server.
2. `local` remains a permanent first-class path.
3. `direct` remains a permanent first-class path for LAN and manually reachable hosts.
4. `remote_relay` is the only intended internet-safe product path.
5. Relay is outbound-only for both host and client whenever possible.
6. THAUMWORLD and ASCII Painter must share the same transport/session substrate.
7. App-specific bootstrap happens after common transport/session attachment.
8. Remote session discovery belongs to a control/directory layer, not the raw relay pipe.
9. Overlay/VPN can remain a dev fallback, but should not define the main product path.
10. The first implementation should prefer simple, standard, single-service deployment over early distributed complexity.
11. Remote relay should tunnel and preserve the existing session/bootstrap lifecycle where practical, instead of replacing it with a brand-new multiplayer model.
12. If older wifi-to-wifi approaches prove unnecessary after relay succeeds, they can be removed.

## Product Model

### Method 1: Local

For same-machine testing and local convenience.

Characteristics:

- no cloud dependency
- localhost transport assumptions allowed
- fastest dev/test loop

### Method 2: Direct

For LAN and any manually reachable host.

Characteristics:

- supports LAN discovery and manual host entry
- same core codepath for `lan_discovered` and `saved_manual`
- no relay dependency
- remains useful for homes, studios, classrooms, conventions, and debugging

### Method 3: Remote Relay

For internet play without port forwarding.

Characteristics:

- host opens outbound connection to a public service
- client opens outbound connection to the same public service
- public service binds them into a room/session and forwards traffic
- host remains authoritative for world/document state

## Core Architecture

### A. Shared Multiplayer Core

The engine-owned shared layer should own:

- transport selection
- host registration lifecycle
- join code / invite resolution
- session issuance and resume
- reconnect tokens
- heartbeat
- transport attachment
- common logging vocabulary
- common timing instrumentation
- failure and retry behavior

This shared core should be reused by both THAUMWORLD and ASCII Painter.

### B. App Adapters

Each app should only own:

- content/resource identity resolution
- app-specific bootstrap success rules
- app-specific state synchronization after transport attach
- app-specific UI and terminology

The shared multiplayer core should not become painter-specific or game-specific.

## Connection Vocabulary

Separate these concepts clearly:

- `connection method`: `local | direct | remote_relay`
- `connection entry type`: `local | lan_discovered | saved_manual | remote_join_code` (exact naming can be finalized later)
- `transport strategy`: `localhost | direct_tcp_http_ws | relay_ws_tunnel` or similarly explicit engine vocabulary

The key rule is that user-facing selection type and runtime transport mechanism must not be collapsed into one field.

## Relay System Split

### 1. Control / Directory Layer

Responsibilities:

- host session registration
- join code generation
- invite resolution
- optional public/private listing metadata
- relay routing metadata
- short-lived session lookup
- session expiry and cleanup
- issuing or validating short-lived attach credentials

This is the rendezvous and discovery layer.

### 2. Relay Layer

Responsibilities:

- accept outbound host connection
- accept outbound client connection
- authenticate host/client attachment
- bind peers into rooms/sessions
- forward messages between host and clients
- support reconnect windows
- emit relay-side logs and metrics

This is the transport pipe, not the authority.

### First Implementation Shape

For the first implementation, control and relay should ship as one public Node service exposing:

- HTTPS JSON control endpoints
- WSS relay endpoint
- one in-memory room/session registry with lease expiry
- basic rate limiting and attachment guardrails

This combined service is a deployment choice, not a permanent architecture requirement. It should be easy to split later if scale or replacement work demands it.

### 3. Host Runtime

Responsibilities:

- create/own world or painter document session locally
- register remote availability with control service
- maintain outbound relay connection
- serve as authoritative simulation/document owner
- continue to own gameplay/document session issuance and bootstrap semantics

### 4. Client Runtime

Responsibilities:

- resolve join code/invite
- attach to relay session
- acquire/refresh session tokens
- continue into app bootstrap using shared session flow

### Runtime Principle

`remote_relay` should reuse the current conceptual lifecycle as much as possible:

1. resolve target
2. attach transport
3. perform connect/session bootstrap
4. attach event/message stream
5. continue into app-specific bootstrap

The relay path should therefore tunnel and preserve the existing join/session model where practical, rather than introducing a second unrelated multiplayer stack.

## Discovery Model

Remote visibility should be controlled by policy, not implied by relay existence.

Recommended session visibility modes:

- `private` - join code or invite only
- `shared` - limited audience / future scope
- `public` - browseable directory / future scope

Default first implementation should be `private` join-code-based remote sessions.

## Persistence Direction

Join/session memory remains engine-owned and slot-scoped where local state is needed.

Persist locally:

- saved direct hosts
- last successful join targets
- reconnect tokens when appropriate
- app-neutral join preferences
- small remote session history that helps UX/debugging

Do not persist:

- long-lived remote authority secrets
- unnecessary cloud session metadata
- remote connection metadata inside game world content or painter files

## Shared Logging Direction

Use one log vocabulary across both apps and future relay services.

Recommended events:

- `transport_selected`
- `host_registration_started`
- `host_registration_succeeded`
- `host_registration_failed`
- `join_code_issued`
- `join_code_resolved`
- `direct_probe_started`
- `direct_probe_succeeded`
- `direct_probe_failed`
- `relay_attach_started`
- `relay_attach_succeeded`
- `relay_attach_failed`
- `session_resumed`
- `session_invalidated`
- `heartbeat_timeout`
- `bootstrap_started`
- `bootstrap_succeeded`
- `bootstrap_failed`

## Scalability Direction

Start with a single deployable public Node service combining control + relay.

Scale later only if needed:

- in-memory room/session storage first
- hide storage behind a small replaceable interface from day one
- Redis/pubsub later if multi-instance relay is needed
- sticky routing later if horizontal scaling is needed
- rate limiting and abuse protections before public session browsing

Free/cheap operation is realistic at small scale, but relay bandwidth is a real long-term cost. The architecture should therefore remain efficient and incremental in message volume.

## Security Direction

Use a simple, standard security baseline:

- HTTPS for control-plane traffic
- WSS for relay traffic
- opaque random high-entropy tokens, not custom embedded-data tokens
- room access never granted by room id alone
- short-lived attach credentials wherever practical
- one active host attachment per room in the first implementation
- basic rate limits on host registration, join-code resolution, and relay attachment attempts
- lease expiry and idle cleanup for sessions and rooms

The first implementation should not require accounts, identity federation, or advanced abuse systems.

## Non-Goals For First Pass

- cloud-hosted authoritative game simulation
- mandatory account system
- public global browser as a first milestone
- custom NAT punchthrough as the primary path
- replacing direct/LAN with relay for all cases
- turning the public relay into app-specific gameplay/document authority
- treating the current local event bridge as the internet relay service itself
- merging app-specific bootstrap logic into one giant transport file

## Definition Of Done For The Architecture Phase

- the repo has one agreed three-method model: `local`, `direct`, `remote_relay`
- relay is defined as transport only, not authority
- control-plane and relay-plane responsibilities are separated conceptually
- shared-vs-app-specific responsibilities are clearly locked
- logging vocabulary is defined
- discovery/privacy model for first pass is defined
- implementation can proceed without re-arguing the core shape every session

## Architecture Checklist

### 1. Canonical method model

- [ ] Confirm the permanent first-class methods are exactly `local`, `direct`, and `remote_relay`
- [ ] Confirm `direct` covers both LAN discovery and manual reachable-host entry
- [ ] Confirm `remote_relay` is the only intended internet-safe product path
- [ ] Confirm overlay/VPN is dev-only or fallback-only, not the primary user path

### 2. Shared substrate boundary

- [ ] Define exactly which session/transport helpers are shared across THAUMWORLD and ASCII Painter
- [ ] Define exactly which bootstrap/state-sync responsibilities stay app-specific
- [ ] Confirm the shared layer owns reconnect, heartbeat, and transport attachment
- [ ] Confirm app layers report bootstrap success/failure back into the shared session pipeline

### 3. Control-plane contract

- [ ] Define host registration request/response shape
- [ ] Define join code generation and resolution rules
- [ ] Define remote session expiry/cleanup rules
- [ ] Define visibility modes for sessions (`private` first, others later)
- [ ] Define the minimum metadata the control layer stores for a host session
- [ ] Confirm first implementation uses standard HTTPS JSON endpoints

### 4. Relay-plane contract

- [ ] Define how host attaches to a relay session
- [ ] Define how client attaches to a relay session
- [ ] Define the message envelope used by relay-forwarded traffic
- [ ] Define relay-side auth tokens and attachment validation rules
- [ ] Define reconnect window behavior for temporary disconnects
- [ ] Define relay-side rate/size guardrails
- [ ] Confirm first implementation uses WSS and a small JSON message envelope

### 5. Session and token model

- [ ] Define stable identifiers: session id, room id, host token, client token, reconnect token
- [ ] Define which tokens are local-only, relay-issued, or control-issued
- [ ] Define token expiry and invalidation behavior
- [ ] Confirm first implementation uses opaque random tokens rather than JWTs or custom encoded token payloads
- [ ] Define how current local `/api/connect` session concepts map into relay sessions

### 6. Discovery and UX model

- [ ] Lock first-pass remote UX to join-code/invite flow
- [ ] Decide whether remote sessions are ever browseable in first pass (recommended: no)
- [ ] Define how users choose between local/direct/remote in both apps
- [ ] Define how failed direct probes vs failed relay joins are explained to users

### 7. Persistence and local memory

- [ ] Define what new slot-scoped files/stores are needed for relay-aware join memory
- [ ] Confirm connection metadata stays out of world files and painter content files
- [ ] Define what remote history/preferences should be remembered locally
- [ ] Define purge-safe schema/versioning rules for new join state

### 8. Observability

- [ ] Lock a shared log/event vocabulary used by both apps and the future relay service
- [ ] Define timing instrumentation points for direct and relay joins
- [ ] Define minimum useful relay logs for debugging host/client routing failures
- [ ] Define how local app logs and relay/control logs will be correlated during debugging

### 9. Deployment and cost shape

- [ ] Confirm first implementation is one combined public Node service for control + relay
- [ ] Define the smallest viable public deployment footprint
- [ ] Note expected free/cheap hosting constraints for long-lived WebSocket traffic
- [ ] Define the first scaling breakpoint that would require Redis/multi-instance work
- [ ] Keep the combined-service implementation replaceable by preserving a clean storage and relay boundary

### 10. Cleanup / deprecation policy

- [ ] Decide which older remote experiments remain supported during transition
- [ ] Decide what can be removed once relay is proven stable
- [ ] Keep LAN/direct intact regardless of relay success
- [ ] Record explicit criteria for deleting failed or redundant wifi-to-wifi approaches

## Implementation Readiness Checklist

- [ ] Architecture checklist above is complete enough that implementation can begin
- [ ] Shared terminology is stable enough for type names and file/module names
- [ ] First relay milestone is defined as a private join-code remote session working end-to-end
- [ ] Direct/LAN regression expectations are written before relay implementation starts
- [ ] A follow-up implementation plan can be written without reopening basic architecture decisions

## Immediate Next Step

After this architecture plan is accepted, write a follow-up implementation plan that maps the chosen relay architecture onto concrete repo modules, files, and phased milestones without changing the locked high-level model above.

That implementation plan should assume:

- one combined public Node control+relay service first
- HTTPS + WSS only
- in-memory room/session registry first
- private join-code remote sessions only
- host-authoritative session/bootstrap semantics preserved
- the current local event bridge remains a local runtime component, not the public relay service

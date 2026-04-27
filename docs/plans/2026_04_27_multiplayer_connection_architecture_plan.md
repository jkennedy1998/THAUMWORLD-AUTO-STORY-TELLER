# 2026-04-27 Multiplayer Connection Architecture Plan

## Intent

Define a scalable multiplayer connection architecture that:

- preserves `local`, LAN, and manual direct-host joins
- keeps current direct IP testing as the active remote baseline
- stores join routing state in slot-scoped engine persistence files
- keeps join state owned by the join system instead of files
- prepares the engine for future Headscale overlay transport
- leaves room for a later built-in relay transport without deleting current work

## Current Stage

- current remote baseline: direct manual host address
- near-term no-port-forwarding target: Headscale
- long-term replacement target: built-in relay or remote transport architecture

## Locked Direction

1. Direct/manual host join remains the current remote baseline.
2. `local` and LAN stay first-class forever.
3. Join state is engine-owned and slot-scoped.
4. File/content data does not own connection metadata.
5. `saved_manual` remains a valid long-term connection entry type.
6. Headscale is the first no-port-forwarding remote path.
7. Built-in relay is later scope, not current scope.
8. Join UX is expected to evolve later; the persistence model must survive UX changes.

## Core Vocabulary

- `content_ref`: consumer-supplied stable identity for a joinable resource
- `last_successful_connection_for_content`: the last confirmed successful join route for a `content_ref`
- `preferred_join_target_for_content`: the preferred target that should be tried first for a `content_ref`

These are join-owned concepts. `content_ref` is a lookup key, not a storage owner.

Recommended engine-facing shape:

```ts
type EngineContentRef = {
  kind: 'file' | 'project' | 'user_scope' | 'workspace' | 'resource';
  value: string;
};
```

The engine defines this contract. Each app adapter resolves the actual `content_ref` value for its own resources.

## Ownership Model

The join system owns multiplayer connection memory.

- join entry store owns known targets
- join preference store owns content-to-target mappings
- content/file persistence owns only content data
- launch records own only launch/menu state

This keeps join schemas purgeable without touching files.

## Storage Boundary

Data slots are the default storage boundary for these engine files.

- source of truth is slot-scoped JSON on disk
- browser localStorage is not the primary source of truth for this feature
- each join-owned store must be explicitly versioned
- schema mismatch should be purge-safe and rebuild-safe
- slot reset should wipe join state for that slot only

Core join persistence should sit behind an engine storage seam. Engine multiplayer modules should depend on a slot-scoped persistence adapter contract rather than renderer globals directly.

## Persistence Model

### Join Entry Store

This is the address book of known targets.

- `local`
- future `lan_discovered`
- `saved_manual`

This store remains the home for known connection entries.

### Join Preference Store

This is a join-owned mapping keyed by `content_ref`.

Recommended first-pass fields:

- `content_ref`
- `preferred_connection_id`
- `preferred_host`
- `preferred_connection_kind`
- `last_transport_strategy`
- `last_connected_at_ms`
- optional `app_metadata`

This store should be independent from content persistence and launch records.

## Content Identity Rules

The engine owns the `content_ref` contract. Consumers own `content_ref` resolution.

Identity values must be stable. Human-facing labels such as display names must not be part of the canonical `content_ref` key unless the product explicitly treats renaming as identity replacement.

### Painter First Adapter Rules

1. file-backed painter content uses `{ kind: 'file', value: <canonical_path> }`
2. non-file-backed painter content uses a stable resource identity if available
3. if neither is stable yet, do not persist a content preference for that join

Painter remote resource identity should be keyed by stable document identity only. Display name remains metadata, not identity.

The abstraction stays named `content_ref`, not `file_ref`, so it can later support projects, users, or shared workspaces.

## Runtime Behavior

### Write Behavior

Write join preference data only after a confirmed successful join.

At the engine level, success means:

1. target selected
2. probe confirms joinable resource state
3. connect succeeds
4. transport subscription or attach succeeds
5. consumer bootstrap succeeds

For the first painter adapter, success means:

1. target selected
2. `/api/host/status` confirms joinable content
3. `/api/connect` succeeds
4. websocket attaches successfully
5. document bootstrap succeeds

At that point write:

- `last_successful_connection_for_content`
- `preferred_join_target_for_content`

Do not write on target selection, probe success alone, partial connect, or failed bootstrap.

### Read Behavior

When a consumer resolves a `content_ref` for a joinable resource:

1. resolve `content_ref`
2. ask the join system for a preferred target for that `content_ref`
3. if found, preselect and prioritize that target
4. if unavailable, fall back to normal join directory behavior

First-pass behavior should prefer and preselect, not silently auto-connect during normal startup.

Preference lookup should be driven by the active joinable resource context, not only by launch-shell resume state. The launch shell may provide an initial fallback context, but the durable integration point should live closer to consumer-owned active content state.

## Fallback Rules

If a preferred mapping exists:

1. use the referenced connection id if it still exists
2. otherwise use a host match if one exists
3. otherwise fall back to normal join ordering

If a preferred target probes offline:

- keep it visible
- show its status clearly
- allow the user to choose another target

First pass should avoid hidden fallback auto-connect behavior.

## Preference Precedence

When multiple remembered identities could apply, the preference order should be explicit.

Recommended precedence:

1. active content-specific preference
2. stable remote resource-specific preference
3. preferred host match fallback
4. normal join ordering

## Current Connection Model

Keep the current engine connection entry types:

- `local`
- `lan_discovered`
- `saved_manual`

These are connection entry types, not transport strategies.

## Future Transport Strategy Model

Treat transport strategy as a separate axis:

- `direct`
- `overlay`
- later `relay`

`saved_manual` may point to any of these reachable address types. Entry type and transport strategy must not be collapsed together.

## Headscale Path

Headscale is the first no-port-forwarding remote path.

Near-term direction:

1. direct IP remains the active remote baseline
2. Headscale IPs or hostnames fit naturally into `saved_manual`
3. the same join pipeline should probe, connect, and bootstrap through a Headscale address
4. no large join UX rewrite is required to adopt Headscale

This keeps current local, LAN, and manual direct behavior intact while adding a scalable remote path.

In engine terms, Headscale is the first planned implementation of the generic `overlay` transport strategy. It should not become a provider-specific core transport name.

## Engine Core Contract

The engine core owns:

- slot-scoped join persistence files
- join entry persistence
- join preference persistence keyed by `content_ref`
- connection entry types
- transport strategy vocabulary
- target probing
- target connect flow
- preference lookup and write APIs
- slot-scoped persistence adapter contract
- timing instrumentation for the join pipeline

The engine core does not own painter-specific file semantics, game-specific actor flow, or future project/user semantics. It only defines the contract those adapters plug into.

## First Adapter: Painter

Painter is the first consumer of this architecture.

Painter adapter responsibilities:

- resolve painter `content_ref`
- declare when authoritative painter bootstrap has succeeded
- invoke join preference lookup from active painter content context
- invoke join preference write when a painter remote join fully succeeds

Painter is the first adapter implementation, not the definition of the core engine contract.

## Logging And Timing Instrumentation

Add timing logs for the preference-aware join path.

Recommended timing points:

1. content preference lookup started and completed
2. preferred target resolution source
3. join refresh started and completed
4. probe dispatch started and completed
5. host status fetch started and completed
6. connect request started and completed
7. websocket attach started and completed
8. document bootstrap started and completed
9. preference write started and completed

Recommended fields:

- `slot`
- `content_ref`
- `connection_id`
- `host_input`
- `connection_kind`
- `transport_strategy`
- `started_at_ms`
- `latency_ms`
- `result`
- `refresh_reason`
- `superseded_by_newer_refresh`

These should use the existing debug/log system so noisy timing logs can be enabled when needed and reduced later.

## Noise Reduction

After timing instrumentation is good enough, reduce low-value noise such as:

- stale saved-host probe spam
- overlapping refresh duplication
- `[object Object]` logs
- old smart-mode diagnostics once they are no longer useful

Keep high-value logs around host readiness, preferred-target resolution, connect results, bootstrap results, and preference writes.

## Implementation Phases

### Phase 1: Slot-Scoped Join Persistence Model

- [~] define versioned slot-scoped JSON storage for join preferences
- [~] keep join state separate from content persistence and launch records
- [~] make schema mismatch purge-safe

### Phase 2: Engine `content_ref` Contract

- [~] define structured engine-facing `content_ref` shape
- [~] define adapter responsibility for `content_ref` resolution

### Phase 3: Painter First Adapter `content_ref` Resolution

- [~] resolve painter `content_ref` from canonical file path for file-backed painter content
- [~] define fallback behavior for non-file-backed painter content

### Phase 4: Join Preference Store API

- [~] add join preference read API
- [~] add join preference write API
- [~] keep the API transport-agnostic

### Phase 5: Successful Join Recording

- [~] update painter successful join flow to write `last_successful_connection_for_content`
- [~] update painter successful join flow to write `preferred_join_target_for_content`

### Phase 6: Preference-Aware Consumer Lookup

- [~] define engine hook for consumers to request preferred target lookup by `content_ref`

### Phase 7: Preference-Aware Painter Resume Or Open

- [~] look up preferred target when content is resumed, loaded, or opened
- [~] preselect and prioritize that target in join flow
- [~] fall back cleanly when the preferred target is missing or offline

### Phase 8: Timing Instrumentation

- [~] add timing logs for lookup, probe, connect, websocket attach, bootstrap, and preference writes
- [~] add a clear host-ready log for remote join readiness

### Phase 9: Validation

- [ ] validate direct same-Wi-Fi path using the new preference model
- [ ] validate direct public-IP path using the new preference model
- [ ] later validate Headscale-hostname or Headscale-IP path through the same join pipeline

### Phase 10: Cleanup And Boundary Correction

- [~] move slot-scoped join preference disk access behind an engine storage adapter seam
- [~] remove renderer-global persistence assumptions from core join preference modules
- [~] make remote painter resource identity stable by excluding display-name-like metadata from the canonical `content_ref`
- [~] move file-backed preference consumption from launch-shell-only behavior toward active consumer content context
- [~] define and implement explicit precedence between content-specific and resource-specific remembered targets
- [~] complete probe timing by logging host-status completion latency explicitly

## Success Criteria

- [ ] a successful remote join writes the preferred target for that `content_ref`
- [ ] opening the same content later prefers the same target automatically
- [ ] deleting join state does not affect file or content data
- [ ] slot reset cleanly removes join preference data
- [ ] direct IP still works as the current remote baseline
- [ ] the architecture remains compatible with Headscale and later relay transport
- [ ] core join persistence no longer depends directly on renderer-only APIs
- [ ] remembered target identity remains stable across display-name changes

## Deferred Scope

- no built-in relay implementation yet
- no full join UX redesign yet
- no user-account-based join ownership yet
- no project or multi-file join ownership yet
- no automatic LAN discovery redesign yet
- no large multiplayer security or auth redesign yet

## Recommended Order

1. [ ] define slot-scoped join preference persistence
2. [ ] add disk-backed join preference store
3. [ ] define structured engine `content_ref` contract
4. [ ] add preference read API
5. [ ] add preference write API on successful join
6. [ ] add painter first-adapter `content_ref` resolution
7. [ ] integrate preference lookup into painter resume, load, and open flow
8. [ ] add timing instrumentation
9. [ ] validate direct same-Wi-Fi path
10. [ ] validate direct public-IP path
11. [ ] later validate Headscale path

## Cleanup Pass Scope

The current implementation direction is valid, but the next refinement pass should continue improving placement and boundaries rather than replacing the feature.

Estimated size: medium.

Expected work split:

1. small: stabilize remote resource identity
2. small: complete probe timing
3. small-medium: define and enforce preference precedence
4. medium: move join preference persistence behind an engine storage seam
5. medium: move preference consumption from launch-shell-only behavior into active content flow

This is a refinement pass, not a rewrite. The slot-scoped persistence model, structured `content_ref`, and preference read/write direction remain correct.

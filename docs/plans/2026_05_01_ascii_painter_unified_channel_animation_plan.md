# ASCII Painter Unified Channel Animation Plan

## Status Note

This plan established the direction toward unified animation storage and shared row editing semantics.

However, implementation and later design review changed the canonical authored truth away from key-first channel storage and toward explicit property-block storage.

The current superseding plan is:

- `docs/plans/2026_05_02_ascii_painter_property_block_animation_plan.md`

The main divergence is:

- old direction: keys are the primary authored timeline truth and blocks are derived
- new direction: explicit content/blank blocks are the primary authored timeline truth for both raster and move

This older plan should now be treated as historical context plus migration background, not the final architecture target.

## Goal

Unify raster content animation and value/keyframe animation under one channel architecture so that:

- raster content is no longer a special timing system
- movement/value animation is no longer a separate keyframe system
- all animated data uses the same storage model, evaluation model, and row interaction model
- future multi-channel editing can be built on shared primitives instead of per-channel special cases

This plan is architecture-first. It is meant to prevent another rewrite by locking the model before implementation.

## Core Principles

1. Keys are the authored source of truth.
2. Channel behavior determines how values resolve over time.
3. First and last key regions are special boundary zones, not ordinary gaps.
4. Group trim is separate from channel behavior.
5. Multiplayer presence is separate from animation/document state.
6. Raster content is just another channel.
7. Channel ordering is explicit and persisted on the group.

## Ownership Model

### Persistent file-owned state

- file extent
- loop window
- groups
- channel order
- channels
- keys
- channel behaviors
- group trims

### Local per-user state

- current breath
- timeline viewport
- playback running state
- active tool
- active group/channel focus
- hover state
- local drag previews

### Shared ephemeral presence

- current breath
- active group id
- active channel id
- XYZ cursor/focus
- tool id
- vivid user color
- updated timestamp

Presence must not be persisted, undoable, or authoritative.

## Canonical Data Model

```ts
type PainterChannelKind =
  | 'raster_content'
  | 'location'
  | 'rotation';

type PainterChannelBehavior =
  | 'clip'
  | 'linear'
  | 'similarities'
  | 'forward_stacked'
  | 'backstacked'
  | 'interpolate';

type PainterBoundaryBehavior =
  | 'none'
  | 'clip'
  | 'linear'
  | 'loopin'
  | 'loopout';

type PainterChannelValue =
  | { kind: 'raster'; voxels: PainterVoxelRecord[] }
  | { kind: 'vec3'; x: number; y: number; z: number }
  | { kind: 'scalar'; value: number };

type PainterChannelKey = {
  id: string;
  breath: number;
  value: PainterChannelValue;
};

type PainterChannel = {
  id: string;
  kind: PainterChannelKind;
  label: string;
  gap_behavior: PainterChannelBehavior;
  before_first_behavior: PainterBoundaryBehavior;
  after_last_behavior: PainterBoundaryBehavior;
  keys: PainterChannelKey[];
};

type PainterGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  breath_start: number;
  breath_end: number;
  channel_ids: string[];
  channels: Record<string, PainterChannel>;
  metadata?: {
    created_at?: string;
    modified_at?: string;
    origin?: { x: number; y: number; z: number };
  };
};
```

### Key storage rules

- keys store full channel snapshots, not partial deltas
- there is at most one key per channel per breath
- writing a key at an existing breath overwrites that channel's prior key at that breath
- different channels may all have keys on the same breath

Canonical in-memory form should remain a simple ordered key array per channel.

## Channel Defaults

Channel defaults are implicit by `kind`, not stored per group and not authored as a separate base value.

Examples:

- `location` -> `{ x: 0, y: 0, z: 0 }`
- `rotation` -> `0`
- `raster_content` -> empty/no content

We should keep defaults minimal and only rely on them where needed.

Add a central helper:

```ts
get_default_channel_value(kind: PainterChannelKind): PainterChannelValue
```

This becomes the single source of truth for property defaults.

## Evaluation Model

Each channel evaluates in three temporal regions:

1. before first key
2. between keys
3. after last key

These regions must be handled explicitly.

Starts and ends are not ordinary gaps.

### Initial `clip` behavior

`clip` is the initial shared center behavior for raster and movement.

Meaning:

- snap to the first valid truth once reached
- use the last reached key's value until another key replaces it
- no interpolation
- no easing

This is After Effects-like keyframe snapping.

For current architecture purposes, `clip` is the default center behavior for both raster content and movement/value channels.

### Boundary behaviors

`before_first_behavior` and `after_last_behavior` are separate hooks for:

- `none`
- `clip`
- `linear`
- later `loopin`
- later `loopout`

This is where first/last-key exceptions live.

## Group Trim Rules

Group trim is render/process gating only.

If the current breath is outside `group.breath_start..group.breath_end`:

- do not render that group's channel output
- do not process cropped-out channel output
- still show all keys and editing UX in the timeline
- key editing remains allowed outside trim
- direct raster/content editing for the trimmed-out rendered result should cancel immediately
- emit a debug log when cancelled

Trim must remain separate from channel behavior.

## Channel Ordering

Channel order is explicit and persisted as `group.channel_ids`.

This is the source of truth for:

- channel row order in GROUPS
- channel render/process order
- swapping/reordering behavior

We are not deriving channel order from channel kind anymore.

Multiple channels per kind are allowed.

This is intentional so we can support more general property stacks later, including cascading transforms and shape-like systems.

### Channel composition rules

- channel processing order is exactly `group.channel_ids`
- multiple `location` channels compose additively in that order
- multiple raster channels render in that same order like layered content within the group

## Raster Is Not Special

Raster content is just another channel.

Consequences:

- raster blocks and value keyframe blocks are the same conceptual thing
- swap/move/select/hover logic should become channel-generic
- raster should not be treated as the primary source of truth in future architecture
- derived block ownership belongs to the left/source key by default

The current raster row can remain visually prominent for UX, but the model must not special-case it.

## Group Spatial Logic

Groups no longer need a freely moveable authored vector offset as a default editing workflow.

Revised direction:

- render from local origin by default
- users should pan the view rather than passively moving static content around
- if movement is needed, create or use a `location` channel
- if a movement-oriented action is invoked and no `location` channel exists yet, auto-create one and place the first key

This is a deliberate simplification to align logic with animation intent.

## Generic Runtime Helpers

We should build pure channel helpers before storage migration.

Needed helpers:

- `get_default_channel_value(kind)`
- `get_exact_channel_key(channel, breath)`
- `get_nearest_channel_key(channel, breath)`
- `evaluate_channel_at_breath(channel, breath)`
- `derive_channel_regions(channel, trim)`
- `add_or_replace_channel_key(channel, breath, value)`
- `remove_channel_key(channel, breath)`
- `shift_channel_keys(channel, delta)`
- `swap_channel_regions(channel, sourceKeyId, targetKeyId)`

Important:

- storage should remain key-based
- UI bars/regions should be derived from keys and behavior

### Derived region rules

- UI blocks are derived from channel keys plus behavior, not stored as authored spans
- same-channel swaps operate on derived blocks/regions
- default swap behavior should swap the block contents including breath coverage/duration, matching the current raster behavior
- swaps are channel-local only and must not affect other channels unless future multi-channel editing explicitly opts into that

## Commands And Mutations

Long-term command surface should move from channel-specific mutations to generic channel operations.

Target operations:

- add channel
- remove channel
- reorder channels
- add key
- replace key at breath
- move key
- remove key
- swap channel blocks
- set channel behavior
- set group trim
- set loop window

All authored edit commands must carry explicit:

- breath
- group id
- channel id
- operation payload

No edit path should depend on shared current time.

## Multiplayer Presence Model

Presence is not part of the animation system.

It is an engine-available multiplayer layer.

Suggested payload:

```ts
type PainterPresence = {
  connection_id: string;
  color_vivid_rgb: { r: number; g: number; b: number };
  breath: number;
  group_id: string | null;
  channel_id: string | null;
  tool_id: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  updated_at_ms: number;
};
```

Presence rendering rules for now:

- always available
- color based on the user's personal vivid color
- rendering can adapt based on overlap in group/breath/XYZ later

## GROUPS UI Direction

GROUPS should become a channel-row system.

Each row should eventually expose:

- channel label
- channel behavior badge
- derived visible regions
- exact key boundaries
- hover/active styling
- presence overlays
- shared hit-testing grammar

This is the foundation for future multi-channel editing.

### Add property behavior

Because only movement/property rows are currently being expanded first:

- the add-property button should insert a `location` channel for now
- new channels start with no keys
- later this can expand into property/channel selection

We will likely need explicit UI to add/remove property rows once the system matures.

## Multi-Channel Editing Preparation

This architecture is chosen specifically so future multi-channel editing does not require another model rewrite.

Because all channels share the same primitive:

- single-click selection can later select one or more keys/blocks
- multiple channels can be edited together
- channel-local operations can later be promoted to multi-channel operations

We are not implementing multi-channel editing yet, but the architecture must preserve it.

## Legacy Adapters During Migration

The following should become compatibility projections over the unified channel model before deletion:

- raster segment derivation helpers
- movement key resolvers
- `GroupListItem.raster_segments`
- `GroupListItem.location_key_breaths`
- old content-state lookup helpers
- old move-key lookup helpers

These are adapters only, not target architecture.

## Legacy Structures To Retire

Delete later:

- `content_states`
- `length_breaths` as primary authored timing
- `location_base`
- `location_keys`
- raster-specific segment mutation APIs
- move-specific key APIs
- timing compatibility helpers tied to the old storage model

## Recommended Migration Order

1. Add unified channel types and default-value helpers.
2. Add pure channel evaluators and derived-region helpers.
3. Add adapters from current raster/move storage into channel read-models.
4. Migrate movement first onto a real `location` channel.
5. Refactor GROUPS to consume ordered channel rows.
6. Auto-create `location` channel on first movement edit when needed.
7. Migrate raster storage from `content_states` to `raster_content` keys.
8. Replace specialized mutation commands with generic channel commands.
9. Remove legacy raster/move storage and helpers.

## Immediate Implementation Notes

When beginning implementation:

- prioritize movement channel migration first
- keep multiplayer current-breath local per user
- keep loop window file-owned
- keep presence outside document state
- centralize trim-based edit cancellation early so tool paths stop duplicating it
- make auto-create-channel plus first key authoring a single undo step

## Future Development Notes

- add a swap-mode toggle later for alternate semantics such as swapping values only vs swapping breath coverage/duration
- add lightweight clipboard-style channel duplication/copy workflows later
- add per-channel mute/visibility later if needed
- expand add-property UI beyond inserting only `location`
- batch multi-step auto-authoring flows into one undo step consistently across future channel types

## Summary

The target system is:

- keys as authored truth
- behavior-driven evaluation
- boundary-aware starts and ends
- explicit ordered channels per group
- raster treated as just another channel
- trim separate from behavior
- presence separate from animation state

This is the cleanest architecture for future co-animation and multi-channel editing.

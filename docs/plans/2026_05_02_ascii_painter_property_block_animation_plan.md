# ASCII Painter Property Block Animation Plan

## Goal

Unify `raster` and `move` under one authored property-block system so that:

- both use the same timeline truth
- both use the same row interaction grammar
- both support future shared commands and multi-property editing
- future properties like `rotation`, `opacity`, and vector content can be added without another model rewrite

This plan supersedes the earlier key-first unified-channel plan where they differ.

## Why We Diverged

The earlier plan assumed:

- keys are the authored source of truth
- timeline blocks are derived from keys

That is no longer the best fit for the actual UX and control model.

What the current system needs is:

- explicit content blocks
- explicit blank blocks
- explicit blank caps / boundary semantics
- the same authored row model for raster and move

Because blanks are first-class timeline elements for both raster and move, the cleanest single source of truth is block-authored storage, not key-authored storage.

## Status / Reality Check

The current implementation is not yet a single unified property-block system.

Today the runtime is still hybrid:

- raster authored truth is still primarily `content_states`
- move authored truth is still primarily channel keys
- groups still carry compatibility-era mixed structures
- GROUPS still consumes a raster row and a move row through separate assumptions

This plan describes the target canonical model, not the current implementation state.

## Core Principles

1. Properties are the authored source of truth.
2. One property equals one row.
3. Blocks are the authored timeline truth inside a property.
4. Blocks are either `content` or `blank`.
5. Raster and move use the same row/block model and the same timeline UX grammar.
6. The model is structurally unified, but property payloads remain typed by property kind.
7. A property is a single timeline lane; layering and additive composition come from multiple properties, not overlapping active blocks within one property.
8. Multiple properties of the same kind are allowed.
9. Property order is canonical and behaviorally meaningful.
10. Processing mode is stored per property.
11. Group trim is separate from property evaluation.
12. Multiplayer presence is separate from animation/document state.
13. Empty properties are removed manually, not automatically.

## Ownership Model

### Persistent file-owned state

- file extent
- loop window
- groups
- property order
- properties
- blocks
- process modes
- group trims

### Local per-user state

- current breath
- timeline viewport
- playback running state
- active tool
- active group/property focus
- hover state
- local drag previews

### Shared ephemeral presence

- current breath
- active group id
- active property id
- XYZ cursor/focus
- tool id
- vivid user color
- updated timestamp

Presence must not be persisted, undoable, or authoritative.

## Property Model Decisions

- a property is a single ordered timeline lane
- raster and move share one canonical block-based timeline model
- move and raster share one row interaction grammar even when their payload editors differ
- property values remain typed by property kind
- at a given breath, one property should have at most one active authored block after normalization
- simultaneous layering or additive composition is expressed through multiple same-kind properties in `property_ids` order
- do not model simultaneous move sums or simultaneous raster layers by allowing overlapping active blocks within one property

This means the system is unified in container structure, editing grammar, ordering, and command semantics without flattening all properties into one value type.

## Versioning And Migration Contract

- current persisted painter document version is `4`
- property-block migration should introduce canonical `version: 5`
- `v4` documents must remain importable through a compatibility adapter
- canonical normalized output after migration should be `v5`
- avoid long-lived dual-write if possible; prefer compatibility read plus canonical write

During migration the rules should be explicit:

- `content_states` become compatibility input, not canonical authored output
- `location_base` and `location_keys` become compatibility input, not canonical authored output
- channel-era structures may be read for migration, but property-block structures become the only authored truth in normalized `v5` documents

Migration adapters themselves are not undo events.

## Canonical Data Model

```ts
type PainterPropertyKind =
  | 'raster'
  | 'move'
  | 'rotation'
  | 'opacity';

type PainterProcessMode =
  | 'add';

type PainterBoundaryType =
  | 'clip'
  | 'hold'
  | 'linear'
  | 'loopin'
  | 'loopout';

type PainterPropertyValue =
  | { kind: 'raster'; voxels: PainterVoxelRecord[] }
  | { kind: 'vec3'; x: number; y: number; z: number }
  | { kind: 'scalar'; value: number };

type PainterPropertyBlock =
  | {
      id: string;
      type: 'content';
      start: number;
      end: number;
      value: PainterPropertyValue;
    }
  | {
      id: string;
      type: 'blank';
      start: number;
      end: number;
      left_boundary: PainterBoundaryType;
      right_boundary: PainterBoundaryType;
    };

type PainterProperty = {
  id: string;
  kind: PainterPropertyKind;
  label: string;
  process_mode: PainterProcessMode;
  blocks: PainterPropertyBlock[];
};

type PainterGroup = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  breath_start: number;
  breath_end: number;
  property_ids: string[];
  properties: Record<string, PainterProperty>;
};
```

Canonical expectations for this model:

- `property_ids` is the only ordering truth inside a group
- multiple properties of the same kind are valid
- property IDs stay stable across non-destructive edits where practical
- legacy fields are compatibility input, not canonical normalized output

## Authoring Truth

The single source of truth should be:

- ordered properties on a group
- authored blocks inside each property

Not:

- raster `content_states`
- movement key-only authored state
- a derived block model that has to be reconstructed from a different primary truth

The target authored truth is property-block based for both `raster` and `move`, even if migration temporarily preserves compatibility readers.

## Property Kinds In Scope

Immediate implementation target:

- `raster`
- `move`

Future properties we want to support with this same architecture:

- `rotation`
- `opacity`
- future vector content rendered into the raster grid

The plan should preserve room for future vector and shape content, but not implement it yet.

## One Property = One Row

Keep the row model simple.

- one property is one row
- multiple rows of the same property kind are allowed by the canonical data model
- initial UX may still default to one raster property and one move property
- that initial UX simplification must not become a model restriction
- build advanced creation flows later without blocking same-kind multiplicity in the architecture

## Property Order

Property order is explicit and persisted on the group.

Recommended shape:

```ts
property_ids: string[]
properties: Record<string, PainterProperty>
```

This is the source of truth for:

- property row order in GROUPS
- property evaluation/render order
- future swapping/reordering behavior

Raster and move participate in the same ordered list. Property order is not cosmetic; it affects evaluation.

## Process Modes

Start with only:

- `add`

Store the processing mode per property now, even though the UI for changing it can come later.

### `move` + `add`

- active content blocks contribute `{x,y,z}`
- active blank blocks contribute nothing
- final move result is additive in property order

### `raster` + `add`

- later raster draws over earlier raster result
- only filled cells write
- blank/null/clear cells do not overwrite prior cells
- effectively a simple per-cell alpha-over style composition

The architecture should support multiple `move` properties summing together and multiple `raster` properties layering together through shared ordered property composition.

Keep room for future modes later, such as:

- replace
- subtract
- multiply
- linear light
- others

But do not implement those now.

## Block Types

Each property row is authored as blocks.

### Content block

- explicit start
- explicit end
- typed value payload

### Blank block

- explicit start
- explicit end
- explicit left boundary type
- explicit right boundary type

Blank blocks are first-class authored elements.

## Shared Raster / Move Model

Raster and move should share:

- explicit content blocks
- explicit blank blocks
- same row grammar
- same blank grammar
- same cap/boundary grammar
- same selection model
- same hover model
- same drag/delete/split/compact model
- same trim rules
- same future multi-property command vocabulary

They should differ only in:

- value payload
- process-mode evaluation semantics
- final rendering/application step

The model is unified structurally, not semantically flattened:

- `raster` payloads carry raster content
- `move` payloads carry `vec3`
- future kinds may carry their own typed payloads

## Block / Blank / Cap Grammar

Both raster and move should eventually use the same rendering and interaction engine as much as possible.

### Content block subparts

- single
- left head
- center
- right head

### Blank block subparts

- single
- left cap
- center
- right cap

### Blank visuals

Default current visual language:

- body: `▢`
- clip caps: `<` `>`
- future hold caps: `⟦` `⟧`

Later, property-specific row visuals may vary by:

- color
- weight
- glyph choice

But the underlying interaction engine should be shared.

## Selection Rules

- content single/center/head left click selects the whole content block
- blank center/single left click selects the whole blank block
- blank cap left click selects the cap instance itself

This leaves room for future multi-selection later without redesigning selection identity.

## Current Control Model To Preserve

This architecture must support the control grammar being built now.

This section is the authoritative raster interaction matrix for content and blank pieces.

### Click Resolution Rules

- left single click selects only if the interaction does not become a drag and is not consumed by a left double click
- right single click is a true no-op for block interactions for now
- right single click must not pre-fire when a right double click is about to occur
- drag threshold crossing starts the drag behavior and suppresses single click behavior
- double click behavior suppresses single click behavior

### Content Delete Result Rule

When a content block is deleted by double right click:

- if the block sits between content, it becomes a blank block over that span
- if the block is at a leading or trailing edge, it trims away instead of leaving a terminal blank

### Content Single

- left click: select the whole content block
- left drag: solo time reposition
- left double click: no-op
- right click: no-op
- right drag: dynamic resize
- right double click: delete whole content block using the delete result rule above

### Content Left Edge

- left click: select the whole content block
- left drag: destructive resize, placing the start edge at the dragged breath
- left double click: no-op
- right click: no-op
- right drag: dynamic resize preserving the opposite side
- right double click: delete whole content block using the delete result rule above

### Content Right Edge

- left click: select the whole content block
- left drag: destructive resize, placing the end edge at the dragged breath
- left double click: no-op
- right click: no-op
- right drag: dynamic resize preserving the opposite side
- right double click: delete whole content block using the delete result rule above

### Content Center

- left click: select the whole content block
- left drag: solo move in time, allowing gaps and destructive overwrite inside the claimed span
- left double click: split at the clicked breath
- right click: no-op
- right drag: swap with another same-kind content block
- right double click: delete whole content block using the delete result rule above

### Blank Single

- left click: select the whole blank block
- left drag: timeline scrub
- left double click: no-op
- right click: no-op
- right drag: no-op
- right double click: compact left

### Blank Left Cap

- left click: select the cap instance itself
- left drag: no-op
- left double click: no-op
- right click: no-op
- right drag: no-op
- right double click: left content consumes the whole blank span

### Blank Center

- left click: select the whole blank block
- left drag: timeline scrub
- left double click: no-op
- right click: no-op
- right drag: blank merge/compact preview by direction
- right double click on the left half: left content consumes the whole blank span
- right double click on the right half: right content consumes the whole blank span

### Blank Right Cap

- left click: select the cap instance itself
- left drag: no-op
- left double click: no-op
- right click: no-op
- right drag: no-op
- right double click: right content consumes the whole blank span

The backend truth should support these controls directly instead of translating them through separate raster vs move models.

## Group Trim Rules

Group trim is render/process gating only.

If the current breath is outside `group.breath_start..group.breath_end`:

- do not render/process that group's property output
- still show all blocks and editing UX in the timeline
- key/block editing remains allowed outside trim in the timeline
- direct rendered raster editing outside trim should cancel immediately with debug

Trim must remain separate from property behavior.

## Normalization Rules

Normalization must be explicit and deterministic.

Per property invariants:

- block IDs are unique within a property
- blocks are sorted by `start`
- every block satisfies `start <= end`
- zero-length blocks are invalid
- overlapping active blocks within one property are invalid after normalization
- one property is one timeline lane

Blank rules:

- adjacent blank blocks should merge deterministically when normalization requires compaction
- terminal blank preservation policy must be explicit, not implicit
- boundary caps must survive normalization when they carry authored meaning
- blank blocks may exist at the start or end of a property if the authored model requires them

Ordering rules:

- `property_ids` preserves known IDs in their authored order
- stray properties not listed in `property_ids` are appended deterministically
- duplicate IDs are removed deterministically during normalization

Compatibility rules:

- legacy `content_states` and legacy move key structures are migration inputs only
- normalized canonical output should not depend on retaining legacy authored structures

## Property Row UI Rules

- property names render inline as part of the row UI
- raster follows the same property-name convention as move
- double right click on a property name deletes that property row
- empty properties are not auto-removed
- if a property exists, it remains until the user deletes it manually

## UI Migration Scope

Initial UI migration should stay intentionally narrow:

- first target remains GROUPS
- GROUPS should move to property-row-driven rendering
- initial property kinds in active UI scope are `raster` and `move`
- preserve the current gesture grammar where possible
- do not expand this pass into a general multi-kind property editor
- do not require advanced same-kind property creation UX in the first slice

## Evaluation Model

Evaluation should be derived from property blocks through one explicit pipeline.

Recommended ordered pipeline:

1. Check group trim gate.
2. Resolve the active block for each property at the current breath.
3. Ignore blank contributions.
4. Convert active content blocks into typed property contributions.
5. Compose contributions in `property_ids` order according to property-kind process rules.
6. Produce a group-local move result.
7. Produce a group-local raster result.
8. Project raster output through the resolved move result.
9. Resolve final visible cells across groups by reverse `group_order`.

Composition rules in scope now:

- move properties with `add` sum together in property order
- raster properties with `add` layer together in property order
- blanks contribute nothing
- final cross-group visibility remains governed by `group_order`, not `property_ids`

This keeps intra-group property order and inter-group visibility order clearly separated.

## Shared Runtime Helpers Needed

Build shared property-block helpers before further migration.

Needed helpers:

- get property at breath
- get exact block at breath
- normalize property blocks
- move block
- split block
- blank block
- compact blank
- destructive edge set
- merge adjacent blanks
- trim terminal blanks
- normalize property ordering
- evaluate property stack at breath

These helpers should assume the canonical lane rule: simultaneous composition comes from multiple properties, not overlap within one property.

These helpers should work for both raster and move.

## Shared Command Vocabulary

Command vocabulary should be defined in phases.

### Phase A: compatibility-facing commands

- existing raster-segment and move-key commands may remain active during migration

### Phase B: canonical property commands

- add property
- remove property
- reorder properties
- move property block
- split property block
- blank property block
- compact property blank
- set property block edge
- swap property blocks
- cycle property boundary type
- set property process mode

### Phase C: removal

- remove legacy raster-segment and move-key command families after UI, runtime, and history fully switch over

That is the command family that can later power shared multi-property editing.

## Undo / History Contract

Undo behavior must be specified before deep migration work.

Target contract:

- authoritative undo should operate on canonical property/block command units, not only voxel delta history
- local undo should mirror the same logical command boundaries where possible
- structural property edits and content edits should share one coherent undo model
- drag previews do not create history entries until commit
- split, merge, move, swap, and edge-set operations are single undo units

This matters because the current local and authoritative undo paths are not equivalent.

## Migration Strategy

### Phase 1

Lock contracts: property model decisions, versioning, normalization, evaluation order, command vocabulary, and undo/history.

### Phase 2

Define canonical `v5` property/block types and normalization helpers.

### Phase 3

Build shared property-block runtime helpers.

### Phase 4

Define protocol and command handling around canonical property operations.

### Phase 5

Align undo/history behavior with canonical property commands.

### Phase 6

Migrate `move` first into authored property-block storage.

Why move first:

- smaller payload
- currently more behaviorally disconnected than raster
- easiest place to prove shared blank/block semantics

### Phase 7

Migrate `raster` from `content_states` into authored raster property blocks.

After this, remove raster-authored special truth.

### Phase 8

Refactor GROUPS to consume only property rows and block lists.

No raster-vs-move data split should remain.

### Phase 9

Delete old migration scaffolding and legacy authored structures.

## Compatibility Layer Exit Criteria

Migration is not complete until all of these are true:

- no authored writes target `content_states`
- no authored writes target `location_keys` or `location_base`
- no runtime mirror logic is needed to keep raster content synced to older structures
- GROUPS consumes generic property rows
- canonical property commands replace raster-vs-move split command assumptions for migrated behavior
- authoritative undo supports property/block commands
- old documents still import cleanly
- canonical export writes only the property-block document shape

## Legacy Structures To Remove Eventually

Once migration is complete, remove:

- `content_states`
- `location_keys`
- `location_base`
- raster-specific authored truth
- move-specific key-only authored truth
- channel-key mirror logic
- raster/move split row assumptions

## Multiplayer Model

Keep the existing state split:

### Shared persistent file state

- file extent
- loop window
- groups
- property order
- properties
- blocks
- process modes
- trims

### Local per-user state

- current breath
- viewport
- playback state
- local previews
- active focus/tool

### Shared ephemeral presence

- breath
- group id
- property id
- XYZ focus
- tool id
- vivid user color

Presence remains outside the animation truth.

## Immediate Implementation Target

The best first real slice under this architecture is:

1. lock the contracts in this document so implementation does not drift
2. define canonical `property` + `block` authored types and normalization rules
3. migrate `move` from key-authoring to block-authoring
4. keep raster temporarily on the compatibility layer while move proves the model
5. make GROUPS consume move as a property row with explicit blocks and blanks
6. then migrate raster onto the same block truth

## Non-Goals For Now

- do not implement `rotation` yet
- do not implement `opacity` yet
- do not implement vector content yet
- do not implement multiple process modes yet
- do not implement multi-property editing yet

This plan exists to make those expansions possible later without another rewrite.

## Summary

The target truth is no longer:

- keys derive blocks

It is:

- explicit property blocks are the authored truth

for both `raster` and `move`.

The canonical lane rule is:

- a property is one timeline lane with typed block payloads
- multiple properties of the same kind are allowed
- simultaneous layering or additive composition is expressed through multiple same-kind properties in `property_ids` order
- overlapping active blocks inside one property are not the model

That is the cleanest architecture for:

- the control grammar already being built
- shared future commands
- additive lightweight authoring
- future raster/vector/property expansion

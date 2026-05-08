# Unified Graphic Payload Slot Value Model Deep Dive 3

Date: 2026-05-07

## Purpose

Resolve the biggest remaining schema question before implementation planning:

## what exactly should a slot value be?

This deep dive is about the value stored in appearance slots.
Not about graphic definitions in general.
Not about presentation selectors in general.

It focuses on:

- what the current repo actually stores and renders
- what the unified architecture needs
- what minimum first-pass slot model is sustainable
- what should remain outside first pass

## Executive Conclusion

The sustainable first-pass model should be:

## slots store an appearance value union, not just a material id

Recommended first-pass conceptual shape:

```ts
type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: { r: number; g: number; b: number } };

type SlotAssignments = Partial<Record<1 | 2 | 3, SlotValue>>;
```

This is the smallest model that can actually unify:

- atlas material-backed graphics
- plain text/glyph visuals with flat color
- painter authoring
- existing `rgb`-heavy UI/render paths

Anything smaller leaves the architecture split.

## Why This Question Matters

Right now the repo has two incompatible appearance stories:

### Story A: atlas/material path

- semantic graphic id
- up to 3 material slots
- final color resolved at render time

### Story B: text/rgb path

- visible character
- one flat `rgb`
- final color already present on the cell

If slot values remain `string material ids` only, Story B never really joins Story A.
Text would stay special forever.
That would conflict with the source-of-truth goal.

## Current Repo Reality

## 1) Current slot assignments only store material ids

File:

- `src/render_shaders/graphics_contract.ts`

Current type:

```ts
type InlineMaterialAssignments = Partial<Record<1 | 2 | 3, string>>;
```

This means a slot can currently say only:

- slot 1 = `STONE_PALE`
- slot 2 = `BRONZE`
- slot 3 = `FOLIAGE_GREEN`

### What this supports well

- atlas recoloring
- semantic authored materials
- lighting-aware material rendering

### What this does not support

- plain flat-color glyph visuals as first-class slot values
- painter-authored explicit colors in a unified slot system
- a text visual whose appearance is not a material id

## 2) Final runtime cells still carry `rgb` separately

Files:

- `src/mono_ui/types.ts`
- `src/render_shaders/reducer.ts`
- `src/mono_ui/runtime/cell_renderer.ts`

Current cell shape includes both:

- `materials?: Partial<Record<1 | 2 | 3, string>>`
- `rgb: Rgb`

And font rendering still draws with:

- `cell.char`
- `cell.rgb`

### What this confirms

Flat color is still not optional in the real renderer.
It is a primary active path.

## 3) Atlas rendering expects semantic slot values, not flat color values

Files:

- `src/mono_ui/runtime/atlas_runtime.ts`
- `src/mono_ui/runtime/material_registry.ts`

Current atlas recoloring works by:

- decoding source bands 1/2/3
- looking up slot assignment material ids
- resolving semantic tones from the material registry
- applying lighting to semantic values

### What this confirms

The atlas backend is already strongly built around semantic materials.
That is good and should remain.

### What this implies

If we add flat-color slot values, atlas rendering will need a second slot-resolution path for:

- resolve material tone ramp
n- or use flat color directly

That is a manageable expansion, not a conceptual problem.

## 4) Painter and UI are still deeply `rgb`-oriented

Files and evidence:

- `src/ascii_painter/types.ts`
- many `mono_ui/modules/*` paths
- `src/shared/painter_document_store.ts`
- `src/shared/painter_tools.ts`

Current painter/tooling assumptions are heavily based on:

- `char`
- `rgb`
- `weight`

Many UI paths also generate direct `rgb` cells with no material semantics at all.

### What this confirms

Any first-pass slot model that refuses flat color would force:

- a giant premature conversion of UI and painter systems into material ids
- or permanent split authority

Neither is desirable.

## What The Slot Model Needs To Accomplish

A viable slot model must satisfy all of these.

## Requirement 1: support semantic materials

Needed for:

- atlas recoloring
- authored surface meaning
- lighting-aware appearance

## Requirement 2: support flat authored color

Needed for:

- text/glyph visuals
- painter workflows
- many existing UI cells
- simple immediate visuals that should not require a material definition

## Requirement 3: support up to 3 slots

Already decided in the broader architecture.

## Requirement 4: avoid forcing every visual into fake multi-slot complexity

Many visuals are really just:

- one glyph + one color
- one atlas graphic + one material

The model should allow that simply.

## Requirement 5: keep materials declarative

The slot model must not turn materials into scripts or arbitrary nested behavior blobs.

## Requirement 6: allow render-time light application where appropriate

Material-backed slots should remain lighting-aware.
Flat-color slots may either:

- be used as-is
- or later participate in light response with a simple rule

But first pass should stay simple.

## Options Considered

## Option A: keep slots as material-id-only strings

```ts
type SlotAssignments = Partial<Record<1 | 2 | 3, string>>;
```

### Pros

- minimal change to atlas pipeline
- preserves current implementation shape

### Cons

- text/glyph color remains outside the slot model
- `rgb` remains permanently separate authority
- painter cannot unify around one appearance payload
- flat-color visuals would need fake material ids for every color, which is terrible

## Verdict

Not sufficient for the source-of-truth architecture.

## Option B: slots store only flat rgb values

```ts
type SlotAssignments = Partial<Record<1 | 2 | 3, Rgb>>;
```

### Pros

- easy for painter and font rendering
- easy mental model

### Cons

- throws away semantic material meaning
- breaks the whole material/light pipeline conceptually
- forces atlas rendering to lose the strongest existing abstraction in the repo

## Verdict

Reject.
This would be a regression.

## Option C: slots store tagged union of material or flat rgb

```ts
type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: Rgb };
```

### Pros

- unifies both real appearance stories already in the repo
- preserves semantic materials
- preserves direct color for glyph/painter/UI cases
- allows gradual migration without preserving permanent split authority
- keeps the model small and understandable

### Cons

- requires resolver/backend/type updates
- requires deciding how fallback `rgb` maps into slot usage
- requires eventual normalization helpers

## Verdict

Best first-pass choice.

## Option D: slots store a larger appearance language

For example:

```ts
type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: Rgb }
  | { kind: 'palette_index'; index: number }
  | { kind: 'gradient'; ... }
  | { kind: 'inherit'; ... }
```

### Pros

- future-flexible

### Cons

- too much too early
- invites speculative complexity
- not required by current repo truths

## Verdict

Do not use in first pass.

## Recommended First-Pass Slot Value Model

## Canonical value shape

```ts
type SlotValue =
  | { kind: 'material'; material_id: string }
  | { kind: 'flat_rgb'; rgb: Rgb };

type SlotAssignments = Partial<Record<1 | 2 | 3, SlotValue>>;
```

## Canonical meaning

### `material`
Means:

- this slot is filled by a semantic material definition
- final tone/color is resolved through the material registry
- lighting can transform semantic tones before final rgb

### `flat_rgb`
Means:

- this slot is filled by an explicit final-ish color choice
- first pass should treat it as direct color
- no semantic tone ramp is implied

This is the cleanest minimal union.

## How This Maps To Different Visual Types

## Glyph-like single-color text

Conceptually:

- visual source = glyph graphic
- slot count = 1
- slot 1 = `{ kind: 'flat_rgb', rgb }`
- weight remains separate

This lets text join the same appearance model without pretending to be an atlas material graphic.

## Atlas graphic with one surface

Conceptually:

- visual source = atlas graphic
- slot count = 1
- slot 1 = `{ kind: 'material', material_id: 'STONE_PALE' }`

## Atlas graphic with multiple surfaces

Conceptually:

- visual source = atlas graphic
- slot 1 = wood
- slot 2 = metal
- slot 3 = trim/accent

This stays exactly aligned with the current atlas band system.

## Painter-authored mixed cases

Conceptually first pass can support:

- text glyph with flat slot color
- atlas graphic with material slots
- atlas graphic with one or more flat-color slot overrides if desired later

That is much more flexible than the current split.

## What To Do With Legacy `rgb`

This is the most important migration question.

## Recommended rule

Long-term, `rgb` should become:

- derived runtime convenience for font drawing and fallback paths
- not canonical authored appearance truth

## First-pass transitional rule

When a cell is effectively glyph-backed and has a single flat-color appearance:

- canonical slot 1 should hold the `flat_rgb`
- runtime may still mirror that to `cell.rgb` for current font rendering compatibility

When a cell is material-backed atlas content:

- canonical appearance truth should be slot assignments
- runtime may still carry `rgb` as fallback/non-authoritative output if needed

So the migration path is:

- keep `rgb` temporarily
- demote it conceptually
- make slot assignments canonical

## Should Flat Color Be Allowed On Atlas Slots?

Short answer:

## yes, architecturally yes; first-pass operationally optional

Why yes:

- it keeps the slot model truly unified
- it avoids creating a special ban for atlas-backed visuals
- some authored art may want direct tint behavior

Why optional operationally in first pass:

- the initial implementation may only need flat color on glyph-like graphics
- atlas flat-color resolution can be added immediately or shortly after, depending on scope

But the **type model** should allow it from the start.

## Should Material Definitions Support Flat Color Internally Instead?

Possible alternative:

- keep slot values material-only
- generate ephemeral materials for direct colors

This is not recommended.

Why not:

- it pollutes the material system with non-semantic one-off colors
- it makes painter editing awkward
- it hides the real distinction between semantic materials and explicit colors
- it makes serialization and diffs worse

Flat color should be a real first-class slot value kind.

## Interaction With Lighting

## Material-backed slot lighting

Already strong and should remain:

- source band semantic value
- material tone ramp lookup
- light remap
- final rgb

## Flat-color slot lighting

Recommended first-pass behavior:

- treat flat rgb as direct final color
- do not route through semantic tone remapping

Why:

- simple
- predictable for painter/text workflows
- avoids inventing pseudo-material logic

Possible later extension:

- optional simple light-response mode for flat colors

But not first pass.

## Interaction With Graphic Defaults

Graphic definitions may still declare default slot values.
That is useful.

Example:

- a grass graphic may default slot 1 to foliage green
- a glyph graphic may default slot 1 to off-white

But instance/authored payload should be allowed to override them.

The key point is:

- defaults should use the same slot value type
- not a separate material-only type

## Interaction With Material Option Constraints

Current type:

```ts
type MaterialOptionsBySlot = {
  defaults?: InlineMaterialAssignments;
  allowed?: Partial<Record<1 | 2 | 3, string[]>>;
};
```

This is currently material-specific.

### What this implies

If slot values become a union, `allowed` constraints must be reconsidered.

### Recommended first-pass rule

Keep material constraints material-specific.
Do not try to solve generalized slot-validation language yet.

Conceptually:

- slots may hold flat colors or materials
- but content definitions that expose material options still only constrain material selections

That is a tolerable first-pass asymmetry.

## Interaction With Painter Editing

This model fits the earlier architecture decisions well.

Painter tools can target:

- slot 1
- slot 2
- slot 3
- all active slots

And a paint action can apply:

- a flat color slot value
- later a material slot value

This avoids creating separate tool families for glyph color versus material assignment.

## Interaction With The Existing Runtime Cell Contract

Current cell runtime contract still contains:

- `char`
- `graphic`
- `materials`
- `rgb`

### Recommended future direction

Eventually that should move toward:

- `char` or glyph presentation output
- `graphic`
- `slot_values`
- `rgb` only as a derived convenience where needed

### Important note

This deep dive does **not** require deleting `rgb` immediately.
It only clarifies that `rgb` should stop being the canonical appearance store.

## Practical First-Pass Architecture Decision

If we want the smallest sustainable first implementation target, it should be:

## canonical authored/shared payload stores slot assignments as a union

while runtime may temporarily keep compatibility mirrors:

- `materials` for old atlas code
- `rgb` for old font code

That is a migration bridge.
But the source of truth should move to the slot-value union.

## Things Explicitly Out Of Scope For First Pass

Do not add yet:

- gradients
- palette-index slot values
- procedural slot shaders
- inheritance chains between slots
- alpha/transparency policy language
- animated slot values

The repo does not need those to unify the current split.

## Required Plan Readjustments Based On This Deep Dive

The main plan should be tightened in these ways:

### Readjustment 1
Where the plan says "material slots," it should be more precise:

- the canonical stored appearance payload should be **slot assignments**
- a slot assignment may be a material or a flat color

### Readjustment 2
The architecture should explicitly demote `rgb` from canonical authored truth to transitional/runtime-derived convenience.

### Readjustment 3
Graphic defaults and instance overrides should use the same slot-value shape.

### Readjustment 4
First-pass lighting policy should explicitly differ by slot kind:

- material slots are light-reactive
- flat rgb slots are direct color in first pass

## Bottom Line

The repo cannot reach a real unified visual payload if slot values remain material-id-only.

The smallest sustainable model is:

- **material slot values** for semantic surfaces
- **flat rgb slot values** for direct color visuals

So Deep Dive 3 conclusion is:

## the canonical appearance model should be slot-based, and slot values should be a small tagged union rather than raw material-id strings.

# Inspect Platform Redesign Plan

Date: 2026-02-05
Updated: 2026-03-24

## Status

- [~] in progress

## Intent

Turn inspect into a stable platform for advanced world inspection rather than a narrow tile/item description system.

This redesign keeps inspect as a real action in the action pipeline, keeps target resolution canonical and scene-aware, moves authored inspect helper data into shared databases/defs, supports per-instance diffs, and treats narration as a replaceable interpretation layer.

This document supersedes the older terrain-era inspect assumptions in this file. It is now the source of truth for future inspect work.

## Current Direction

The project has already moved beyond the original design in a few important ways:

- inspect now resolves richer target kinds through the place UI and action pipeline
- place/tile inspect is no longer meant to rely on `environment.terrain`
- inspect results now carry curated narration context for the narrator model
- item piles, place, and adjacent-place inspection now exist conceptually in the pipeline

However, the current implementation is still transitional. Some old assumptions remain in code and data structures, and some newer inspect logic is still heuristic or incomplete.

This plan aims to unify the system around stable contracts so implementation details can evolve later without breaking inspect as a gameplay platform.

## Implementation Posture

This plan should be executed by reusing working systems that already exist, replacing or removing only the parts that have become legacy.

Rules for implementation work:

- prefer extending stable existing systems over inventing parallel inspect-specific infrastructure
- when an older inspect path becomes obsolete, delete it rather than keeping compatibility indefinitely
- use this plan's checklists and test checklists as the main implementation tracker
- if a working existing system already solves part of the redesign cleanly, connect to it instead of recreating it inside inspect
- if a compatibility bridge is temporarily needed, it must have an explicit removal task in this plan

## Non-Negotiable Goals

- inspect must go through the action pipeline and cost action budget (`PARTIAL` / `FULL` / etc.)
- inspect must resolve the real world subject before prose generation
- inspect must support future hidden/discoverable content gated by rolls
- inspect helper text must live in authored defs/databases, not be hardcoded in one-off logic
- inspect helper flags must drive context gathering in a reusable way
- scene focus must be deterministic
- support details may vary, but the main subject of an inspect should stay stable
- old inspect systems should be removed when replaced; do not preserve legacy parallel paths unnecessarily

## Long-Term Product Vision

Inspect should become a scalable platform for rich game observation.

Examples of intended capabilities:

- a crowded tile can be inspected as a scene, not just as the topmost object
- authored helpers can hint at how things should be described without hardcoding prose
- the narrator can connect related facts organically when the data suggests it
- hidden items, secrets, and subtle details can be revealed later through inspect checks/rolls
- different inspect implementations can be swapped in later without changing target resolution or data transport

## Stable Platform Contracts

These pieces should be treated as stable platform contracts even if the implementation behind them changes later.

### 1. Inspect Goes Through The Action Pipeline

- inspect is not a side utility; it is a real action
- inspect should continue to consume action cost through the same action/effect pipeline as other verbs
- later, hidden content checks and reveal rolls should happen inside this pipeline, not in renderer-only code

### 2. Canonical Inspect Target Kinds

Inspect resolves to one of these subject families:

- `actor`
- `npc`
- `item`
- `item_pile`
- `structure`
- `tile`
- `place`
- `adjacent_place`

This taxonomy should remain stable, even if how each kind is narrated changes.

### 3. Shared Inspect Authoring Model

All inspectable def-like things should be able to supply shared inspect helper data:

- tiles
- structures (via tile/structure defs or structure-specific defs)
- items
- actors / NPC kinds or sheets
- places or place templates

### 4. Shared Inspect Diff Model

Runtime instances should be able to add or override inspect text/data through diffs:

- item instance visual state
- structure instance state
- tile instance additions
- actor / NPC current state additions
- place temporary atmosphere/state

### 5. Deterministic Scene Focus

- every inspect should resolve a deterministic `scene_focus`
- support details may rotate via seeded variation
- the main read of the scene should remain stable between repeated inspects unless the world state changes

### 6. Narration Is A Replaceable Layer

The inspect pipeline should end in a structured narrator packet.

The current LLM narration implementation can change later.
The stable part is the packet, not the exact prompt wording.

## Existing Systems To Reuse

The redesign should intentionally build on these existing systems where they already work.

### Action And Intent Flow

- existing action pipeline routing in `src/interface_program/main.ts`
- existing inspect action handling in `src/action_handlers/inspect.ts`
- existing action cost / verb infrastructure already used by movement and other verbs

Reuse goal:

- keep inspect as a first-class action rather than moving logic into UI or renderer shortcuts

### Place / Scene Resolution

- place click targeting in `src/mono_ui/modules/place_module.ts`
- current place/tile/world-z inspect context already being passed through UI and action handling
- place/tile resolution helpers in shared place/tile code (`resolve_place_tile`, place layer helpers, place adjacency helpers)
- current structure and placed item data already stored in place data and related stores

Reuse goal:

- canonical inspect subject resolution should come from the same world/scene data already used to render and interact with the 3D place

### Defs + Diffs Philosophy

- tile resolution already uses defs plus runtime deltas
- item systems already use resolved definitions and runtime instance data
- tag add/remove and similar runtime overlays already exist in several systems

Reuse goal:

- inspect should reuse the same authored-base + runtime-diff philosophy instead of inventing a separate persistence style

### Prompt / Narration Pipeline

- current inspect result narration already goes through renderer AI and structured prompt generation
- current inspect result already carries curated narration context

Reuse goal:

- keep a structured narrator packet and swap prompt contents over time rather than replacing the whole renderer narration path

### Sense / Clarity / Hidden Foundations

- clarity/sense calculations already exist in `src/inspection/clarity_system.ts`
- inspect already has the concept of hidden/discoverable features and can evolve toward roll-gated discovery

Reuse goal:

- hidden content should extend these foundations, not bypass them with separate reveal logic in UI or prompt code

## Canonical Inspect Resolution

Inspect should resolve a scene bundle, not just a single fallback ref.

### In-Bounds Tile Priority

When the player inspects a tile inside the current place, canonical priority should be:

1. `actor`
2. `npc`
3. `item_pile`
4. `item`
5. owning `structure`
6. `tile`

This does not mean the narrator only sees the first thing. It means the first thing is the default primary subject candidate.

### Out-Of-Bounds Priority

When the player inspects outside the current place:

1. `adjacent_place` if there is a valid one-connection-over target
2. otherwise `place` surroundings / boundary context

### Crowded Tile Rule

Crowded tiles should be treated as a composed scene.

- The main subject remains deterministic
- Co-located subjects and nearby context are also gathered
- The narrator may connect them naturally if the supplied facts suggest a relationship
- We are not trying to hardcode every relationship, only to give the narrator enough structured context to read the scene well

Examples:

- berries under a bush
- a character standing over an item
- dropped tools beside a structure
- several things clustered on a support surface

## Shared Inspect Authoring Schema

Create one reusable authored inspect schema for all inspectable defs.

Suggested base shape:

```ts
type InspectIncludeFlag =
  | "identity"
  | "material"
  | "condition"
  | "function"
  | "relations"
  | "surrounding_tiles"
  | "nearby_entities"
  | "place_context"
  | "region_context"
  | "temperature"
  | "light"
  | "weather"
  | "supporting_surface"
  | "multitile_owner"
  | "contents"
  | "equipment"
  | "activity"
  | "hidden";

type InspectSeed = {
  id: string;
  text: string;
  include_if?: InspectIncludeFlag[];
  senses?: SenseType[];
  min_clarity?: ClarityLevel;
  priority?: number;
};

type InspectFeatureDef = {
  id: string;
  text: string;
  keywords?: string[];
  include_if?: InspectIncludeFlag[];
  senses?: SenseType[];
  min_clarity?: ClarityLevel;
  hidden?: boolean;
  discovery_cr?: number;
  relevant_prof?: string;
  relevant_stat?: string;
};

type InspectProfile = {
  short?: string;
  full?: string;
  include_defaults?: InspectIncludeFlag[];
  sensory?: Partial<Record<SenseType | "touch", string[]>>;
  helper_seeds?: InspectSeed[];
  features?: InspectFeatureDef[];
};
```

## Shared Inspect Diff Schema

Per-instance inspect diffs should mirror the existing defs + deltas philosophy across the project.

Suggested shape:

```ts
type InspectProfileDiff = {
  short_override?: string;
  short_append?: string[];
  full_append?: string[];
  include_add?: InspectIncludeFlag[];
  include_remove?: InspectIncludeFlag[];
  sensory_add?: Partial<Record<SenseType | "touch", string[]>>;
  helper_seeds_add?: InspectSeed[];
  helper_seeds_remove?: string[];
  feature_add?: InspectFeatureDef[];
  feature_remove?: string[];
  feature_patch?: Array<Partial<InspectFeatureDef> & { id: string }>;
};
```

Example use cases:

- a bush is currently fruiting
- a sword is chipped and bloodstained
- a chest is cracked open
- a person looks exhausted tonight
- a place smells smoky after a fire

## Initial Include Flag Catalog

We do not need every possible flag implemented immediately.

Start with:

- `identity`
- `material`
- `condition`
- `relations`
- `surrounding_tiles`
- `nearby_entities`
- `place_context`
- `light`

Add later when needed:

- `weather`
- `temperature`
- `region_context`
- `supporting_surface`
- `multitile_owner`
- `contents`
- `equipment`
- `activity`
- `hidden`

## Inspect Pipeline Stages

The inspect system should be split into stable stages.

### Stage 1: Action Pipeline Entry

- inspect enters through the action pipeline
- actor, action cost, explicit hints, and spatial context are preserved
- later hidden rolls and discovery checks also live here

### Stage 2: Canonical Subject Resolution

Resolve a stable scene bundle:

- primary target candidate
- co-located subjects
- owning multitile structure
- base tile/surface
- nearby directional subjects
- place / adjacent place context

### Stage 3: Base Inspect Profile Resolution

Load authored inspect profile from the def/sheet/template for:

- the primary subject
- optionally relevant support subjects

### Stage 4: Instance Diff Application

Merge runtime inspect diffs from the concrete instance.

### Stage 5: Context Gathering From Flags

Flags request categories of runtime/context data.
Flags do not themselves generate prose.

Examples:

- `surrounding_tiles` -> collect nearby tile summaries
- `nearby_entities` -> gather nearby actors/NPCs/items
- `place_context` -> gather place-level visible summary
- `light` -> gather current light state
- `multitile_owner` -> gather owning structure instance identity

### Stage 6: Fact Extraction

Convert resolved subject + gathered context into atomic facts.

Facts should carry metadata like:

- `importance`
- `mundane`
- `supports_scene`
- `source`
- `include_flags`
- `nearby`

### Stage 7: Deterministic Scene Focus

Derive a deterministic scene focus from the resolved scene.

Examples:

- `npc_over_item_pile`
- `fruit_under_foliage`
- `structure_with_scattered_tools`
- `empty_surface_with_notable_material`
- `adjacent_place_threshold`

This focus should stay stable across repeated inspects unless the world state changes.

### Stage 8: Selection / Culling

Select facts in tiers:

- `core`
- `supporting`
- `ambient`
- `noise`

Rules:

- core facts are stable
- supporting facts may rotate via seeded selection
- ambient facts are optional only when useful
- noise/mundane facts are usually dropped

### Stage 9: Narrator Packet Build

Build a structured packet for the narrator implementation.

The packet, not the prompt phrasing, is the long-term stable contract.

## Narration Style Direction

Inspect prose should read like close inner observation.

Constraints:

- do not say "I see"
- do not overexplain the act of inspecting
- keep it short
- keep it factual and observational
- let the subject feel naturally noticed rather than theatrically narrated

Desired tone examples:

- "Blades of grass push up between the stone tiles here."
- "Snowberries lie under the bush, some fresh, some already softening."
- "Gunther stands over a scatter of dropped tools, like he just kicked through them."

## Structured Narrator Packet

The narrator should receive a packet like this, not a raw world blob.

```txt
You convert inspect data into short humanized observational text.

Write in close inner observation from the inspecting actor's perspective.
Do not say “I see.”
Keep it short, factual, and natural.
Lead with the most interesting thing first.
Not all supplied information must be included.
If supplied facts suggest a natural relationship, you may phrase them together organically.
Do not invent unsupported facts.
Output only the narrative text.

PERSON READING THE PROMPT INFO:
- name
- role / kind
- personality cues
- current tonal modifiers if any
- clarity / sensory constraints

INSPECT TARGET:
- target kind
- scene focus
- primary subject
- tile / place context

RELEVANT INFO:
- core facts
- supporting facts
- nearby facts
- sensory facts
- place context
```

## Hidden Content Integration

The redesign must support hidden items and hidden details later without another major architecture change.

### Hidden Content Rules

- hidden content should be resolved in inspect logic, not only in narration
- hidden details should be gated by inspect checks/rolls later
- revealed hidden facts should join the same fact-selection system as visible facts
- unrevealed hidden facts should never leak to the narrator packet

This means hidden mechanics belong in:

- action pipeline
- inspect resolver
- discovery/check logic

not in renderer-only prompt shaping.

## Legacy Removal Policy

This redesign should actively remove outdated inspect systems as their replacements land.

We do not need to preserve obsolete branches in-place forever because git history already exists.

### Remove / Deprecate As Replacements Land

- terrain-based tile inspect fallback logic
- tile-only inspect authoring types once replaced by shared inspect profiles
- result fields like `requested_features` / `random_features` if superseded by flags + selected ids
- legacy item inspect fallback paths that do not use canonical placed/runtime item data
- prompt generation that relies on ad hoc mixed inspect blobs instead of a structured narrator packet
- text parser logic that acts as the primary inspect selector rather than a thin adapter into include flags

### Explicit Cleanup Rule

Whenever a target family is migrated to the new inspect platform:

- delete the old target-family inspect path
- delete obsolete schema fields if no longer consumed
- update all prompts/results to use the shared packet
- document the removal in this plan checklist

### Legacy Systems Already Identified

These should be treated as likely removal/deprecation targets as the new platform lands:

- terrain-based tile inspect fallback logic
- tile-only inspect authoring model as the long-term inspect schema
- old inspect result fields whose only purpose was random/keyword feature output if replaced by flags and fact tiers
- legacy item-inspect paths that do not use canonical place/instance item data
- inspect prompt inputs that rely on ad hoc raw blobs instead of the narrator packet
- text parser logic acting as the primary inspect selector instead of a thin helper into include flags

These should not be removed blindly, but they also should not remain indefinitely once their replacements are live.

## Migration Order

### Phase 0: Freeze Platform Contracts

- [x] define stable inspect target kinds
- [x] define shared inspect profile schema
- [x] define shared inspect diff schema
- [ ] define initial include-flag catalog
- [x] define narrator packet schema
- [x] define deterministic scene focus rules

Tests / verification for Phase 0:

- [x] target kinds are documented in one canonical place
- [x] shared schema names/types are settled before migration code starts
- [x] every new inspect data shape has an identified owner and storage location

### Phase 1: Canonical Scene Resolver

- [x] build canonical inspect scene bundle resolver
- [x] resolve multitile owning structures cleanly
- [x] resolve item piles as first-class scene subjects
- [x] keep actor/npc/item/structure/tile/place/adjacent_place priorities explicit

Tests / verification for Phase 1:

- [x] inspecting a tile with an actor prefers the actor as primary subject candidate
- [x] inspecting a tile with an NPC prefers the NPC when no actor is present
- [x] inspecting a tile with multiple items produces an `item_pile` candidate
- [x] inspecting a multitile structure resolves the owning structure instance rather than a random occupied cell
- [x] inspecting out of bounds can distinguish adjacent place vs general place surroundings

### Phase 2: Shared Authoring Schema

- [ ] introduce shared inspect profile types in code
- [ ] migrate tile/structure authoring to shared inspect profile
- [ ] stop treating tile-only inspect schema as the long-term source of truth

Tests / verification for Phase 2:

- [ ] at least one tile/structure definition reads from the shared inspect profile successfully
- [ ] helper seeds can be loaded from authored data without inspect-specific hardcoding
- [ ] old tile-only schema usage is either removed or explicitly marked temporary

### Phase 3: Shared Diff Schema

- [ ] introduce shared inspect diff support
- [ ] wire item-instance inspect diffs
- [ ] wire structure/tile-instance inspect diffs
- [ ] plan actor/NPC/place runtime inspect diffs

Tests / verification for Phase 3:

- [ ] instance-level inspect text can be appended/overridden without changing the base def
- [ ] item and structure runtime diffs merge deterministically
- [ ] diff application does not mutate shared master defs

### Phase 4: Context Gathering By Flags

- [ ] implement initial flag-driven context gatherer
- [ ] support `identity`
- [ ] support `material`
- [ ] support `condition`
- [ ] support `relations`
- [ ] support `surrounding_tiles`
- [ ] support `nearby_entities`
- [ ] support `place_context`
- [ ] support `light`

Tests / verification for Phase 4:

- [ ] include flags result in data gathering only for the requested categories
- [ ] `relations` can surface co-located relationships without prose generation
- [ ] `surrounding_tiles` can summarize nearby tile context
- [ ] `place_context` and `light` are available in the inspect packet when requested

### Phase 5: Fact Extraction + Selection

- [ ] split facts into core/supporting/ambient/noise
- [ ] keep core stable across repeated inspect
- [ ] use seeded variation only for supporting facts
- [ ] ensure scene focus remains deterministic

Tests / verification for Phase 5:

- [ ] repeated inspect on the same unchanged subject keeps the same core facts
- [ ] repeated inspect can vary supporting facts deterministically
- [ ] scene focus does not change randomly between identical inspects
- [ ] mundane/noise facts are dropped when stronger facts are available

### Phase 6: Narrator Packet + Prompt

- [ ] replace flatter inspect prompt payloads with structured narrator packet
- [ ] enforce close inner observation tone
- [ ] explicitly forbid "I see" framing
- [ ] keep prose short, factual, and observational
- [ ] let the narrator connect naturally related facts when supported

Tests / verification for Phase 6:

- [ ] narrator prompt receives observer info, inspect target, and relevant info as separate structured sections
- [ ] output stays short and observational
- [ ] output does not default to explicit "I see" phrasing
- [ ] crowded-tile relations can be described naturally when supported by facts

### Phase 7: Hidden Content Hooks

- [ ] add hidden/discoverable inspect feature plumbing to the platform
- [ ] keep hidden reveal logic in inspect/action logic
- [ ] ensure narrator packet only contains visible/revealed facts

Tests / verification for Phase 7:

- [ ] hidden facts are absent from narrator input before discovery
- [ ] successful reveal checks expose hidden facts through the same fact-selection pipeline
- [ ] inspect still consumes action cost while performing hidden-content checks

### Phase 8: Remove Legacy Paths

- [ ] delete terrain-era inspect assumptions
- [ ] delete tile-only inspect special casing once migrated
- [ ] delete outdated item inspect fallback paths
- [ ] delete obsolete inspect result fields and compatibility shims

Tests / verification for Phase 8:

- [ ] no inspect path depends on terrain fallback anymore
- [ ] no migrated target family still depends on the legacy schema/path
- [ ] typecheck/build/tests pass after each legacy removal cluster
- [ ] logs and debug output still identify inspect subject resolution clearly after cleanup

## First Slice Recommendation

The first implementation slice should be intentionally small but foundational.

Do first:

- shared inspect profile schema
- shared inspect diff schema
- canonical tile/structure scene resolver
- initial include flags:
  - `identity`
  - `material`
  - `condition`
  - `relations`
  - `surrounding_tiles`
  - `place_context`
  - `light`
- narrator packet with:
  - observer info
  - inspect target info
  - deterministic scene focus
  - core facts
  - supporting facts
  - nearby facts

This gives the platform shape without trying to solve every inspect note at once.

## Main Execution Checklist

This section should be treated as the primary tracker while the plan is implemented.

### Platform

- [x] canonical target kinds frozen
- [x] shared inspect profile schema added
- [x] shared inspect diff schema added
- [x] narrator packet schema added
- [x] deterministic scene focus rules added

### Integration

- [x] place click/inspect target resolution uses canonical scene resolver
- [ ] action pipeline still owns inspect cost and result flow
- [ ] helper seeds are loaded from defs/databases
- [ ] include flags drive runtime context gathering
- [x] narrator consumes structured packet instead of loose inspect blob

### Cleanup

- [ ] terrain-era inspect fallback removed
- [ ] tile-only inspect schema deprecated or removed
- [ ] outdated item inspect fallback paths removed
- [ ] obsolete inspect result fields removed
- [ ] temporary compatibility bridges removed

### Tests

- [x] actor inspect on crowded tile behaves correctly
- [x] npc inspect on crowded tile behaves correctly
- [x] item pile inspect behaves correctly
- [x] tile/structure inspect resolves owning structure correctly
- [x] place inspect behaves correctly
- [x] adjacent place inspect behaves correctly
- [ ] repeated inspect keeps stable core facts
- [ ] supporting facts rotate deterministically
- [ ] hidden-content path is scaffolded without leaking unrevealed facts

## Risks / Open Questions

- actor/NPC inspect authoring is currently less standardized than tiles/items
- place data still has some mixed legacy/current storage paths, especially around ground items and structure context
- if too many flags are added too early, culling will become muddy before the platform stabilizes
- if helper seeds and runtime facts are merged without provenance, debugging output quality will become hard to reason about
- structure inspect should likely become first-class explicitly rather than remaining an accidental tile-resolution side effect

## Definition Of Done

This redesign is complete only when:

- inspect still runs through the action pipeline with action cost
- canonical target kinds are stable and used consistently
- helper text and include flags live in authored inspect profiles
- instance-specific inspect changes use diffs rather than ad hoc special casing
- scene focus is deterministic
- support details may vary, but core subject stays stable
- narrator input is a structured packet, not a loose inspect blob
- hidden content can be added through the same platform later
- legacy terrain-era and other replaced inspect paths are removed cleanly

## Working Checklist

- [x] Phase 0 complete
- [x] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete
- [ ] Phase 6 complete
- [ ] Phase 7 complete
- [ ] Phase 8 complete

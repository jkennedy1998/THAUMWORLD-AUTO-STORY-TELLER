# Painter / Game Render Alignment Observations

Status: design observation document, not an execution plan.

## Purpose

This document captures observed alignment points between the ASCII painter and the game render/runtime stack.

It is meant to:
- describe where the two systems already speak a similar language
- describe where that similarity is only conceptual
- identify where future implementation plans could be carved out

It is **not** a todo list, implementation checklist, or source-of-truth execution plan.

## Working framing

The painter and the game should not be treated as identical systems.

However, they also should not be treated as unrelated.

A useful working frame is:
- they may eventually share more of a **scene / projection / timeline / authored visual state language**
- they do **not** currently share a single source-of-truth model for rendering, simulation, or editing

---

## Current strong alignment points

### 1) Breath / timeline semantics

Painter already has real breath-native structure:
- document breath ranges
- playback settings
- group breath spans
- property blocks over time
- active-breath evaluation in runtime

Game runtime also already uses breath broadly across movement, timing, and ongoing world behavior.

### Why this matters

This makes "breath" a credible shared language for:
- authored animation timing
- staged visual state
- future visual behaviors that are not purely simulation-driven

### Current caution

The two systems use breath for different immediate purposes today:
- painter: authored visual timeline evaluation
- game: simulation / runtime scheduling

So the concept aligns strongly, but the data models are not yet unified.

---

### 2) World-coordinate thinking

Both systems already operate with real xyz thinking.

Painter runtime resolves local authored content into world-space positions through group move properties.

Game rendering and interaction also operate in projected world coordinates.

### Why this matters

This gives both systems a common conceptual ground for:
- projection
- view transforms
- focus planes
- camera targets
- spatial authored content

### Current caution

Painter group positioning is only partially realized in the current implementation.

Observed gap:
- `PainterGroup.metadata.origin` exists in `src/ascii_painter/painter_document.ts`
- runtime location resolution currently comes from move properties, not from a fully active origin model

So painter has the idea of positioned groups, but that idea is not yet fully reflected as a unified runtime location source.

---

### 3) Authored visual grouping

Painter groups are already richer than plain z-layers.

They carry:
- stable identity
- visibility / lock / opacity
- timing spans
- ordered property stacks
- additive move behavior
- raster content over time

### Why this matters

This is conceptually useful for game-facing authored visual organization too, for example:
- readable render-layer organization
- actor or NPC highlighting layers
- item or tile overlay layers
- future authored visual states not driven only by simulation
- level-editing workflows that preserve non-destructive history

### Current caution

Game rendering does not currently use painter-style groups as its render composition primitive.

The game uses pass ordering and render requests instead.

So this is a strong conceptual bridge, not a current implementation match.

---

### 4) Shared projection / camera / DOM-render direction

There is already meaningful convergence in the rendering stack around:
- projected plane/slot thinking
- shared camera tuning concepts
- DOM voxel rendering
- rotated ortho projection helpers

Observed code reality:
- painter already builds projected scenes from runtime-native data
- place rendering already uses DOM layer rendering with shared camera-style tuning

### Why this matters

This is currently the most practical shared seam.

The two systems do not need identical authored truth to share:
- projection math
- projected-scene structures
- camera configuration concepts
- DOM/world-layer rendering behavior

---

## Conceptual alignment points worth preserving

These are not full matches yet, but they are good long-term alignment ideas.

### 5) Properties as authored render channels

#### Painter feature

Painter properties currently include:
- raster
- move
- rotation
- opacity

#### Linked game feature

Game rendering already has visual concerns that could conceptually map to authored channels, such as:
- recolor or emphasis layers
- vivid actor/NPC/item overlays
- staged display states
- optional visual channels that are easier to reason about than ad-hoc render flags

### Why this matters

This is a plausible bridge for giving the game a more authored visual language without forcing it to become the painter.

It also suggests a way to describe visual behavior in a more readable layer/property vocabulary.

### Current caution

This is still a conceptual alignment point.

Game render state today is not represented as painter-style property stacks.

Also, game render composition includes pass semantics and payload/shader resolution behavior that are not captured by the painter property model yet.

---

### 6) Blocks over time as authored stage data

#### Painter feature

Painter property blocks already express:
- exact content spans
- blank spans
- temporal gaps
- staged changes over breath

#### Linked game feature

Game visual behavior often needs stage-like timing too, for example:
- staged animation
- held visual states
- authored transitions
- future non-simulation visual systems

This is especially relevant for cases where the game wants authored visuals that are not simply procedural particles or immediate simulation output.

### Current caution

Painter blocks currently describe authored visual property evaluation, not broad game runtime state.

So while the shape is promising, it should not be mistaken for a drop-in simulation model.

---

### 7) Non-destructive editing and place-painter / level-editor overlap

#### Painter feature

Painter already carries a non-destructive editing mindset through its document/runtime/history structure.

#### Linked game feature

This overlaps conceptually with a future place-painter or level-editor mode in the game.

### Why this matters

This could support a future model where:
- a level is authored with painter-like workflows
- the playable world explores or simulates that authored content
- edit/play are related modes rather than completely separate worlds

### Current caution

This is mostly a workflow alignment point, not a present runtime unification.

---

### 8) Rich visual payloads and special rendered glyphs

#### Painter feature

Painter now preserves richer visual payload data across authored storage, runtime projection, and active editing paths, including:
- `graphic`
- `appearance_slots`
- compatibility `materials`
- shared `weight_index`

The broader painter direction also wants room for:
- special rendered glyphs that are still tile-sized
- future shader-aware or procedurally colored content
- possible group-level visual controls such as richer compositing later

#### Linked game feature

Game rendering already uses richer payloads than plain text cells, including:
- text plus shape/graphic rendering
- material/shader-style payload resolution
- future blend/compositing ambitions in the render stack

### Why this matters

This is now one of the strongest active alignment areas.

The painter is no longer limited to a tiny text-only canonical payload here; it can now preserve the same general class of visual payload the game runtime already understands.

### Current caution

The remaining gap is no longer basic schema capability. It is source-of-truth and authority cleanup around that richer payload.

Current follow-up alignment issues are mostly:
- `appearance_slots` vs compatibility `materials` / legacy `rgb` authority is still not fully cut over everywhere
- brush, erase, text, paste, move, and helper paths still need continued low-traffic sweep work to avoid reconstructing legacy text-first cells
- backend routing and family lookup still rely on naming conventions in places (`text_`, atlas-family prefixes)
- graphic-definition ownership and presentation-selection ownership are still spread across multiple runtime layers instead of one explicit registry/resolution surface
- neighbor/facing/breath presentation selection is only partially unified

---

## Important current non-alignments

These are the main places where a naive "just unify them" approach would break.

### 9) Painter composition rules vs game composition rules

Painter runtime currently resolves visible cells roughly as:
- groups contribute content
- group order determines winning content at a coordinate
- last winning group wins

Game rendering currently composes differently:
- render requests are grouped by pass
- pass ordering matters (`tile`, `item`, `character`, `particle`, `ui`)
- per-request ordering matters
- some passes have special behavior, such as character flashing on collisions

### Why this matters

This is a real structural mismatch.

The game is not currently "group-order winner rendering," and the painter is not currently "render-pass request composition."

Any future alignment here needs a shared higher-level scene contract rather than forcing one current composition rule directly onto the other.

---

### 10) Positioned groups and location truth are currently incomplete on the painter side

#### Painter feature

Painter groups are intended to behave like positioned authored visual units over time.

That includes:
- grouped raster content
- move properties over breath
- stable grouped identity
- future positioned multi-tile authored motion

#### Linked game feature

Game entities, tiles, and other world content already depend on concrete positional truth.

Multi-tile bodies and other world-space systems already assume that world positioning is not ambiguous.

### Why this matters

This is less a long-term conceptual mismatch and more an immediate internal painter cleanup issue.

If the painter's own position truth is unresolved, it is too early to align other systems to it.

### Current caution

Observed gap:
- `metadata.origin` exists as older residue
- move properties currently do the real runtime location work
- this is not yet a clean single location truth

This should likely be cleaned on the painter side before broader system unification work.

---

### 11) Facing-aware body/render behavior currently lives on the game side

Game rendering already has strong facing-driven behavior through:
- body-model voxel evaluation
- render vs physical poses
- facing transforms
- render-payload resolution

This is richer in a different direction than the current painter runtime.

### Why this matters

Ideas like:
- chests or entities that switch visuals by facing
- painter-authored special characters with rotation/facing behavior
- game entities rendered through painter-like channels

are all plausible future bridges.

### Current caution

These are not yet shared data concepts.

Painter currently has move/rotation/opacity/raster properties, but not the same body-model/facing-driven render model used by the game.

---

### 12) Occupancy and LOS are only weak alignment points today

Occupancy and LOS are deeply useful in the game.

They are currently tied to:
- tags such as `OCCUPIES` and `COVER`
- place tiles
- entity/body occupancy
- movement legality
- sense and debug systems

### Why this still matters conceptually

Some of the underlying spatial math could eventually help painter tools, for example:
- 3D painting on surfaces
- view-aware painting constraints
- future authored visibility helpers

### Current caution

Right now these are game-behavior systems, not a shared authored render language.

So they should not be treated as a primary early unification seam.

---

### 13) Interaction is too broad to be a shared seam by itself

Both systems have interactions, but in different senses.

Painter interactions are mainly:
- tools
- edits
- selection
- projection-aware painting

Game interactions are mainly:
- movement
- inspection
- use/actions
- occupancy-aware selection
- action pipeline behaviors

### Current caution

There may be future shared sub-seams such as:
- projected world picking
- hit testing
- camera anchors
- tool/controller patterns

But "interaction" by itself is too broad to be a useful unification target.

---

### 14) Game render path is not yet scene-native in the same way as the painter path

#### Painter feature

Painter is already moving further toward runtime-native projected rendering.

It can build projected display state from the painter runtime directly.

#### Linked game feature

Game/place rendering still does more pre-rasterization into slot buffers before pushing content through DOM world layers.

### Why this matters

This is a practical render-seam mismatch.

If the systems are to meet at a shared render seam, it likely makes more sense for the game path to move closer to scene-native projected inputs than for the painter to move back toward heavier compatibility buffering.

### Current caution

This does not mean the game path is wrong. It means the two sides are currently at different stages of render-pipeline maturity.

---

## Practical shared seam suggested by current code

The most realistic shared seam visible today is not full authored-model unification.

It is closer to shared:
- scene projection
- projected slot/plane representation
- camera tuning
- DOM layer/world layer rendering
- breath-aware visual evaluation feeding a projected scene

In other words:
- the painter can keep its richer authored document/runtime model
- the game can keep its richer simulation/runtime model
- both may eventually feed a more shared projected-scene/render contract

---

## Observed asymmetry in current implementation maturity

### Painter side

Painter is already moving toward runtime-native projected rendering.

It can build projected display state from the painter runtime directly.

### Game side

Place rendering still does more pre-rasterization into slot buffers before pushing data through DOM world layers.

### Why this matters

A future shared render seam likely should converge more toward:
- scene-native projected rendering inputs

rather than deeper reliance on:
- legacy voxel-space mirrors
- pre-rasterized compatibility buffers as the main shared truth

---

## Summary

The painter and the game are not the same system.

But they do already align in important ways around:
- breath/time
- xyz spatial reasoning
- authored visual staging
- projection/camera ideas
- layered visual organization

The main current blockers to deeper alignment are:
- painter composition rules differ from game render composition rules
- richer payload authority is still partly transitional (`appearance_slots` vs compatibility `materials` / legacy `rgb`, plus naming-driven backend routing)
- painter positioned-group/location truth is not yet fully cleaned up
- game rendering is still not fully using the same projected-scene style interface as the more advanced painter path

This suggests that future plans should likely be carved around **specific seams** rather than around an immediate full merger.

Good candidate seams for future planning include:
- shared projected-scene contracts
- richer canonical painter visual payloads
- composition-model comparison and reconciliation
- positioned-group runtime truth
- painter-authored content workflows for game-facing level editing and animation

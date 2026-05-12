# ASCII Painter Brush Aliasing Exploration Notes

Status: Exploration notes / goals only / no implementation yet

Date: 2026-05-11

## Purpose

This document is a holding note for improving brush behavior in the ASCII painter.

It is intentionally **not** an implementation plan.

We do **not** fully know the final system shape. The immediate goal is to:

1. capture a few important brush goals
2. clean up the current mental model
3. outline likely UX directions simply
4. avoid firing on code changes before the model is clearer

## Scope

This plan is about future brush behavior for:

- pencil
- eraser
- line
- other brush-driven tools that should inherit the same behavior later

This includes possible future aliasing for:

- graphic / character
- color / material
- weight

This plan does **not** lock the final architecture yet.

## Current stance

The system is still exploratory.

We are not yet choosing:

- the final aliasing math
- the final character-family model
- the final UI shape for advanced brush settings
- the final relationship between gradiator and brush aliasing
- the final subcell / quadrant interaction model

For now this document should stay lightweight.

It is mainly a place to record goals and good ideas while we mull the system over.

---

## Current goals and likely cleanup direction

The first code concept we should touch later is the current tool/action split.

### Desired cleanup

Treat brush-driven editing primarily as:

- **positive act**
- **negative act**

In practice:

- **pencil = positive act**
- **eraser = negative act**

### Important consequence

**Line should not become its own deep brush behavior system.**

Instead:

- line should use the same positive brush application path as pencil
- erasing a line should use the same negative brush application path as eraser
- future deep brush behavior should therefore automatically deepen line too

This is important for customization.

If line shares the same positive brush pipeline, then any future work on:

- aliasing
- buildup
- hardness
- character families
- color softening
- weight buildup
- subcell targeting

can naturally apply to line as well, rather than requiring a second implementation.

### Guiding rule

Before adding advanced aliasing behavior, we should move mentally toward:

- tools define **shape / sampling**
- positive/negative brush logic defines **what happens at each touched cell**

Simple examples:

- pencil = positive act over immediate sampled cells
- eraser = negative act over immediate sampled cells
- line = positive act over line-sampled cells
- future erase-line mode = negative act over line-sampled cells
- rect stroke/fill can later follow the same pattern

This cleanup should come before deep brush feature expansion.

---

## UX-side outline only

Below is a simple outline of likely future UX surfaces. These are not locked yet.

These are goals and idea buckets, not committed work.

## 1. Shared brush settings area

Likely direction:

- a shared brush settings section that affects positive/negative brush behavior
- shape tools should inherit from the same underlying brush behavior when possible

Possible high-level groups:

- Size
- Graphic aliasing
- Color aliasing
- Weight aliasing
- Tool target / channel masks

## 2. Graphic / character aliasing

Likely direction:

Graphic aliasing should be configurable independently from color and weight.

Simple likely UX controls:

- enabled toggle
- mode selector
- hardness / buildup amount
- family / preset selector

Possible future modes:

### A. Density-ramp mode

Example families:

- `█▓▒░ `
- other ordered custom ramps

Simple user expectation:

- repeated positive action moves the character forward through a ramp
- repeated negative action moves backward through the ramp
- hardness may skip multiple steps per hit

### B. Subcell / quadrant mode

Example character families:

- quadrant and half-block style characters

Simple user expectation:

- the cell can behave like a higher-resolution target
- positive action fills sub-parts
- negative action removes sub-parts

This likely needs more pointer-detail support before implementation.

### C. Hatch mode

Example families:

- `▤▥▦`
- `▧▨▩`
- related tiled hatch characters

Simple user expectation:

- positive action builds hatch density or layered hatch states
- negative action removes them

### D. Border / linework mode

Example families:

- box drawing and border connection characters

Simple user expectation:

- brush action may connect or disconnect edges rather than just replace a glyph

This probably belongs in the same broad brush-setting future, but may end up being a more specialized family.

## 3. Color aliasing

Likely direction:

Color aliasing should be independent from graphic aliasing.

Simple likely UX controls:

- enabled toggle
- mode selector
- alpha / softness / buildup
- source selector

Possible future modes:

- use brush color directly
- blend toward brush color
- blend using the color behind / existing color
- step through indexed palette directionally

Important preview note:

- preview should show the indexed / quantized result the user will actually get
- preview should not show an unindexed temporary color if commit will snap it differently

## 4. Weight aliasing

Likely direction:

Weight aliasing is simpler and should probably mirror the same concepts:

- enabled toggle
- mode selector
- buildup / hardness amount

Simple user expectation:

- positive action can build weight up
- negative action can reduce weight down

## 5. Character family / preset management

Likely direction:

Users may need a lightweight way to choose what kind of character logic the brush is using.

Possible UX ideas:

- family dropdown
- preset rows
- simple checkbox groups for supported family behaviors
- later, more advanced axes if needed

This should stay simple at first.

We should not overbuild a giant editor before we know which families actually feel good to use.

---

## Brush concepts we likely need to track

These are planning concepts only.

They should help us think about the eventual brush pipeline, but they do not lock implementation.

### 1. Directionality

Likely useful for:

- hatching
- linework / border behavior
- tapering
- directional buildup
- future texture-following logic

This may include:

- current stroke direction
- previous direction
- cardinalized direction when needed
- possibly local turn / curve behavior later

### 2. Subcell position

This is likely one of the most important future brush inputs.

Current likely planning direction:

- support at least a small normalized subcell coordinate inside the cell
- probably think in terms of a reusable fine grid rather than only a hardcoded quadrant model

Possible planning resolutions:

- **2x2 behavior** for simple quadrant work
- **3x3-style logic** for left / center / right and top / middle / bottom decisions
- **4x4 planning resolution** as a good shared first abstraction
- possibly even **per-render-pixel cell position** later based on current cell size

Given current cell sizing, it may later make sense to think in terms of something like the full visual cell pixel area as a higher-resolution input surface. Right now that suggests a future path like roughly `12x16`-aware sampling, though this is absolutely not something to implement yet.

Planning point:

- we should probably avoid locking ourselves into only 2x2 if we already suspect we will want richer subcell logic later

### 3. Pressure / flow

We should likely distinguish between:

- **flow** as the simulated amount of brush effect applied over time / samples
- **pressure** as an input signal that may later influence flow

Short-term planning direction:

- do **not** depend on stylus pressure yet
- allow for simulated pressure/flow style brush behavior later
- think in a Photoshop-like sense where repeated motion can build effect gradually

Long-term planning direction:

- stylus pressure can later feed into this same system
- pressure should probably be an optional modifier, not the only way the brush becomes expressive

### 4. Hit count / accumulation

We will likely need a notion of how many times a cell has been affected within a stroke.

Useful for:

- buildup
- hardness stepping
- repeated ramp advancement
- repeated hatch filling
- erase inversion

### 5. Stroke order / distance along stroke

Likely useful for:

- tapering
- beginning/end behavior
- spacing-based effects
- directional textures
- future brush patterns

This may include:

- sample index in stroke
- normalized distance along stroke
- distance from stroke start / end

### 6. Stroke speed

Likely useful later for expressive brushes.

Possible uses:

- softer or lighter effect when moving quickly
- denser or stronger effect when moving slowly
- flow modulation without actual stylus pressure

This is not required for first implementation, but it is worth preserving room for.

### 7. Neighbor context

Likely useful for:

- border / box-drawing behavior
- connectivity-aware chars
- local smoothing
- context-aware erasing

This means some brush logic may need awareness not only of the current cell, but nearby cells too.

### 8. Existing cell state

This seems obvious, but it is central.

The brush may need to inspect:

- current character / graphic
- current color/material state
- current weight
- current family membership if we introduce families later

### 9. Input modality context

We should think about brush UX from multiple input perspectives, not only mouse + keyboard.

Important planning perspectives:

- mouse + keyboard
- stylus + keyboard
- dual-controller VR

Planning note:

- the same deep brush system should ideally be usable from all of these inputs
- not every modality will expose the same signals immediately
- the brush model should allow optional richer inputs without making them mandatory

Examples:

- mouse may provide direction, speed, timing, buttons, wheel, modifiers
- stylus may later add pressure, tilt, angle, and eraser-end semantics
- VR controllers may later add handedness, orientation, distance, trigger pressure, or motion-based flow

This should be considered from the user perspective early so we do not accidentally hardcode a mouse-only mental model.

## Important unresolved design questions

These are open and should remain open for now.

- Is gradiator just one source of ordered density ramps, or the main brush-family editor?
- Should character aliasing operate directly on chars, or through internal family-state models?
- How much pointer detail do we need for subcell modes?
- Should we standardize on a normalized subcell space, a fixed grid like 4x4, or a cell-pixel-aware coordinate model?
- How should flow, buildup, hardness, and future pressure relate to each other?
- Should hatch and border logic be part of one family registry or separate special systems?
- How much per-hand customization should these settings support at first?
- Which settings are shared by positive and negative acts, and which differ?
- What brush concepts are core enough to always track even before a mode uses them?

---

## Current goals

- [ ] keep this document lightweight and exploratory
- [ ] avoid starting aliasing implementation before the cleanup direction is accepted
- [ ] keep UX descriptions simple and non-binding
- [ ] confirm the positive/negative brush model
- [ ] confirm that line should reuse the positive brush path rather than becoming a separate deep system
- [ ] confirm that future brush-driven tools should be thought of as shape sampling + positive/negative application
- [ ] keep stroke speed as a likely future brush input
- [ ] keep subcell position and subcell path thinking in view
- [ ] keep connectivity-aware character and sprite brushes in view
- [ ] prefer explicit transition logic over a hidden general accumulation layer
- [ ] decide later whether the first implemented version should stay density-ramp-first

---

## Non-goals for this document

This document does not yet:

- define exact types
- define exact file edits
- define exact persistence schema changes
- define final brush-family registry design
- define final preview/render logic
- start implementation

---

## Short version

The next meaningful direction is not “implement aliasing now.”

The next meaningful direction is:

1. simplify the brush mental model into **positive** and **negative** acts
2. make **line** conceptually inherit the same positive brush behavior as pencil
3. prefer explicit character/sprite transition logic over a hidden generic accumulation layer
4. keep stroke speed, subcell pathing, and connectivity-aware brushes in view
5. keep advanced aliasing ideas outlined but undecided
6. clean current paths first, then choose the real system

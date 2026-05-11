# ASCII Painter Brush Aliasing Exploration Plan

Status: Planning only / no implementation yet

Date: 2026-05-11

## Purpose

This document is a holding plan for improving brush behavior in the ASCII painter.

It is intentionally **not** an implementation plan yet.

We do **not** fully know the final system shape. The immediate goal is to:

1. clean up the current mental model
2. outline likely UX directions simply
3. identify the first architectural cleanup to make later decisions easier
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

## Current planning stance

The system is still exploratory.

We are not yet choosing:

- the final aliasing math
- the final character-family model
- the final UI shape for advanced brush settings
- the final relationship between gradiator and brush aliasing
- the final subcell / quadrant interaction model

We should do some cleanup first, then decide.

---

## First cleanup direction to lock before implementation

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

### Planning rule

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

## Important unresolved design questions

These are open and should remain open for now.

- Is gradiator just one source of ordered density ramps, or the main brush-family editor?
- Should character aliasing operate directly on chars, or through internal family-state models?
- How much pointer detail do we need for subcell modes?
- Should hatch and border logic be part of one family registry or separate special systems?
- Should hardness and buildup be the same concept or two separate ones?
- How much per-hand customization should these settings support at first?
- Which settings are shared by positive and negative acts, and which differ?

---

## Suggested planning sequence

### Phase 0: no implementation yet

- [ ] keep this as a planning-only document
- [ ] avoid starting aliasing implementation before the cleanup direction is accepted
- [ ] keep UX descriptions lightweight and non-binding

### Phase 1: conceptual cleanup decision

- [ ] confirm the positive/negative brush model
- [ ] confirm that line should reuse the positive brush path rather than becoming a separate deep system
- [ ] confirm that future brush-driven tools should be evaluated in terms of shape sampling + positive/negative application

### Phase 2: current-code cleanup pass

- [ ] identify where pencil and eraser application paths currently diverge unnecessarily
- [ ] identify where line currently behaves as its own special editing path instead of a sampled positive brush path
- [ ] identify which shape tools can later collapse into shared application logic

### Phase 3: architecture decision after cleanup

- [ ] decide whether aliasing is best modeled by channel processors, character families, or both
- [ ] decide how much of the first version should be density-ramp only
- [ ] decide whether subcell support is part of v1 or deferred
- [ ] decide whether gradiator should be reused directly or only conceptually

### Phase 4: UX decision pass

- [ ] choose the smallest useful first brush-settings UI
- [ ] decide which settings must be per-hand
- [ ] decide which settings belong in the existing tool properties panel versus a future specialized panel

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
3. keep advanced aliasing ideas outlined but undecided
4. clean current paths first, then choose the real system

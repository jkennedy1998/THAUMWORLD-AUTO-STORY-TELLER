# ASCII Painter Time-Based Assets Plan

Date: 2026-05-14

## Status

Active planning document.

This plan focuses on aligning the ASCII painter and Thaumworld around a shared breath/time model for authored assets, while keeping runtime simulation separate from painter UI concepts.

## Goal

Turn the painter into a clean authoring system for time-based visual assets that Thaumworld can consume at runtime.

The core intent is:
- one shared breath clock
- authored clips/loops/state on that clock
- optional playback and baking
- no hidden group-content gating behavior
- runtime game systems consume exported assets, not painter UI semantics

## Scope boundary

This plan is about the time-based asset bridge, not a full painter rewrite.

It applies to:
- painter-authored timed content
- preview/playback behavior
- export/import into Thaumworld
- future effect/clip authoring

It does not yet define:
- a full replacement for the current place painter workflow
- painter UI redesign beyond what the bridge needs
- gameplay mechanics for the runtime assets

## Step 0: Remove group content gating

Before adding anything new, remove the current concept of **timed content gating inside groups**.

Important:
- this does **not** mean selection tools are removed
- this does **not** mean painter selection UX is removed
- this only means the hidden/unsupported group-content gating concept should be deleted so the model is clean

Why this is first:
- it removes ambiguous behavior from the group model
- it prevents new animation/timeline work from depending on an unclear legacy path
- it makes the authored content model easier to reason about

## Current bridge state

What already aligns:
- both systems use breath-like incremental time
- both already support pause/speed-style time control concepts
- painter already has loop windows and breath-based authored spans
- Thaumworld already has layered/runtime visual channels

What still needs adapters:
- a clear playback contract for loops and keyframes
- a clean separation between editor state and runtime state
- removal of hidden group-content gating
- a minimal way for painter-authored content to reach the current game runtime

## First concrete asset

Start with a single-play particle effect.

Why this first:
- small enough to test end-to-end
- exercises breath timing
- exercises cleanup/self-delete behavior
- can render into the existing particles layer
- does not require full physics or general simulation

Suggested minimal behavior:
- spawn time
- current breaths processed
- active while its breath window lasts
- delete itself when complete
- sparse/non-blank storage only

## Scalability constraints

Keep the first bridge intentionally small:
- one particle type only
- one-way flow first (author in painter, consume in game)
- no generalized import system yet
- no physics payloads yet
- no simulation callouts yet
- preserve the current schema if possible
- keep reads/writes sparse and cheap
- keep cleanup deterministic
- keep the asset format versionable from day one

## Architectural direction

### 1) One engine time model

Use breaths as the shared unit of time across:
- game simulation
- authored animation
- playback
- preview

The difference is not separate clocks; the difference is which system consumes the clock.

### 2) Painter is an authoring tool

Painter should primarily author:
- clips
- loops
- keyframes
- emitters
- shape sources
- baked outputs

Painter should preview content, but it should not be the game runtime.

### 3) Thaumworld is the runtime consumer

Thaumworld should load exported painter assets as runtime content.

It should not need painter-only concepts like UI groups, timeline editing controls, or temporary editing focus state.

### 4) Groups evolve into tracks/layers

The current `groups` module should eventually behave more like a timeline/layer authoring surface than a generic group editor.

Good future language:
- track
- clip
- loop
- emitter
- layer
- baked state

## Core asset primitives

### Clip
A timed authored asset on the breath axis.

### Loop
A defined active breath window for repeated playback.

### Keyframe
A saved authored state at a specific breath.

### Emitter
A particle source with authorable emission settings.

### Shape source
A region that defines where an emitter or effect can originate.

This can be geometry-derived or a simple editable 1-bit raster-like source.

### Baked frame / baked state
A runtime-friendly exported result produced from authored content.

### Proposed data model sketch

```ts
type PainterClip = {
  id: string;
  name: string;
  loop_start_breath: number;
  loop_end_breath: number;
  keyframes: PainterKeyframe[];
};

type PainterKeyframe = {
  id: string;
  breath: number;
  state: unknown;
};

type PainterEmitter = {
  id: string;
  name: string;
  emission_rate: number;
  shape_source_id?: string;
  properties: Record<string, unknown>;
};

type PainterBakedState = {
  breath: number;
  payload: unknown;
};
```

## Playback semantics

- Playback can sample by breath or by discrete state index.
- Loop windows define the active repeated range.
- Pausing and speed changes operate on the shared breath clock.
- Preview should use the same sampling rules that runtime export expects.
- Keyframes are authored anchor points, not hidden derived data.

## Runtime bridge contract

- Painter source content and runtime-baked content should be separable.
- The canonical save should stay as close to the current schema as practical.
- Keep the format small, sparse, and fast to read in the game.
- Thaumworld does not yet have a general import boundary; this first bridge should be minimal and carefully introduced.
- Prefer writing into the current place schema / particles layer if it can host the data cleanly.
- Exported assets should preserve loop bounds, keyframes, and emitter/shape metadata when those exist.
- Baked outputs should be clearly labeled as runtime-ready, not source-authoring truth.
- Round-tripping can wait until a runtime import path exists.

## Authoring UI transition

- The current groups module should not be assumed to be the final UI shape.
- Short term: keep it usable as the bridge surface.
- Medium term: move toward tracks/clips/layers/emitter-oriented editing.
- Long term: make the UI vocabulary match the asset vocabulary.

## Validation / diagnostics

- Add regression coverage for removed group-content gating behavior.
- Add tests for loop playback and sampling rules.
- Add export/import round-trip coverage.
- Add dev log diagnostics for asset playback and bake/export boundaries.

## Design principles

- Do not reintroduce hidden group-content gating as a special case.
- Keep selection tools separate from authored content shape sources.
- Keep the breath axis unified.
- Allow playback by breath or by discrete state where appropriate.
- Prefer explicit export/import boundaries over implicit coupling.
- Keep game mechanics separate from decorative effect authoring.
- Support decorative particles as a first-class authored/runtime channel.

## Target use cases

This plan should support:
- multi-tile character animation
- decorative particles
- UX effect particles
- cutscene animation
- looped visual clips
- plant growth style animation
- hybrid authored + simulated motion later

## Phased plan

### Phase 0: Remove group-content gating

This is the cleanup pass before any new asset work.

#### File-by-file remove map

##### `src/ascii_painter/painter_document_runtime.ts`
- Remove `is_painter_group_active_at_breath(...)` as a content gate.
- Stop using active-breath checks to decide whether group content exists.
- Update `rebuild_runtime_indices(...)` so visibility and authored content are not silently suppressed by crop timing.
- Remove crop-based return-null behavior from winner resolution paths.
- Keep timing metadata only if it is still needed as a plain authored range.

##### `src/ascii_painter/painter_breath.ts`
- Remove crop-based nulling from `get_group_raster_segment_at_breath(...)`.
- Stop treating `cropped_start` / `cropped_end` as a hidden content gate.
- Keep breath range helpers only if they become honest playback/window helpers.

##### `src/ascii_painter/painter_document.ts`
- Stop deriving content validity from `cropped_start` / `cropped_end`.
- Keep the fields only if they are still needed as authored loop/window metadata.
- Avoid using crop fields as the source of truth for whether content exists.

##### `src/mono_ui/modules/groups_module.ts`
- Remove UI visibility checks that treat crop as an on/off gate.
- Remove or rename `isBreathInsideGroupCrop(...)` and any crop-based visible-span logic.
- Keep selection and block editing separate from timing-window display.

##### `src/canvas_app/painter_app_state.ts`
- Remove `setPainterGroupTiming(...)` as a gate-control command.
- Remove `on_set_group_timing` wiring if it still implies hidden content suppression.
- Rename timing UI and logs toward loop/window semantics if the range is still needed.

##### Docs / tests
- Update plan docs that still describe group trim as render/process gating.
- Add regression coverage that proves authored content remains visible/accessible after the cleanup.

#### Checklist

1. Identify every group-content gating path.
   - runtime evaluation
   - editor UI visibility/limits
   - serialization / deserialization
   - any preview or playback assumptions

2. Remove the gating behavior from the timed group model.
   - keep selection tools intact
   - keep group ordering intact
   - keep the rest of the group/timeline model intact

3. Remove hidden dependencies.
   - eliminate any code paths that silently expect gated timed content
   - ensure no fallback behavior still simulates gating

4. Verify UX still works without gating.
   - group editing remains usable
   - selection behavior remains separate
   - painter previews do not depend on the removed path

5. Add regression coverage.
   - confirm the gated path is gone
   - confirm the cleanup does not break unrelated painter behavior

6. Confirm the log story.
   - add or preserve diagnostics that make removal visible during dev logs if needed
   - keep the cleanup easy to verify in a normal run

### Phase 1: Define the first particle asset shape

- Pick the first asset as a single-play particle effect.
- Define its minimal data fields:
  - spawn breath
  - active breath window
  - processed breath count
  - self-delete/completion state
- Keep it sparse and non-blank only.
- Preserve the current schema if possible.
- Current scaffold lives in `src/ascii_painter/painter_time_assets.ts` and hangs off `PainterDocumentMetadata.time_assets`.

### Phase 2: Stabilize breath-based authored playback

- Treat loop windows as the current asset boundary.
- Use breaths as the clip range.
- Make keyframes the authored states inside the loop.
- Support preview playback without changing the world/runtime model.

### Phase 3: Lock the authoring contract

- Keep the painter as the source-authoring tool.
- Keep preview/playback semantics aligned with the shared breath clock.
- Keep the groups module as a bridge surface for now.
- Avoid committing to a final UI vocabulary yet.

### Phase 4: Add the minimal runtime bridge

- Add the smallest possible path from painter-authored particle output into the existing game runtime.
- Prefer the current place schema / particles layer if it can carry the data cleanly.
- Keep the runtime data model independent from painter editing state.
- Keep this bridge one-way until the first asset proves stable.

### Phase 5: Add baked playback paths

- Support sparse baked outputs for decorative effects.
- Allow playback by breath or by discrete state sampling.
- Keep live simulation optional, not mandatory.
- Start with precomputed frames only.

### Phase 6: Add hybrid simulation later

- Permit authored keyframes to act as simulation seeds.
- Let runtime or offline baking evolve the state forward.
- Store the result as replayable asset data.

## Non-goals for now

- No fire/water/sand mechanic implementation in the painter.
- No deep gameplay mechanics based on particles yet.
- No forced unification of painter UI with game UI.
- No live-simulation-first architecture.
- No generalized runtime import system yet.
- No dependence on hidden group-content filters or other painter-only runtime gates.
- No painter/game UI fusion beyond the bridge requirements.

## Open questions / assumptions

- Does the first bridge target write into the existing place particles layer directly, or through a thin in-repo adapter?
- Are current groups and game render layers the same long-term concept, or only partially aligned?
- How much of the current schema can remain unchanged for the first particle asset?
- Is "baked" strictly sparse precomputed frames for now, with simulation deferred?
- Should the first asset be authored as a one-shot clip with self-delete behavior only?

Assumptions:
- breaths remain the shared clock
- the first bridge should stay minimal
- the first asset should be sparse and cheap
- hidden group-content filters are removed first
- generalized particle simulation can wait

## Success criteria

- The painter has a clean, understandable time-based authoring model.
- Thaumworld can consume the first particle asset without painter-specific assumptions.
- Breath remains the shared clock across systems.
- Decorative particles are a natural fit.
- Hidden group-content gating is gone from the timed content model.
- The first bridge stays minimal, sparse, and scalable.

## Related docs

- `docs/design/painter_game_render_alignment_observations.md`
- `docs/plans/2026_04_29_ascii_painter_breath_group_animation_architecture_plan.md`
- `docs/plans/2026_05_01_ascii_painter_unified_channel_animation_plan.md`
- `docs/plans/2026_05_02_ascii_painter_property_block_animation_plan.md`
- `docs/plans/2026_05_14_ascii_painter_time_based_assets_plan.md`

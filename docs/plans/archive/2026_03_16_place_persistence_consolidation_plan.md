# Place Persistence Consolidation Plan

Date: 2026-03-16

## Status

- [~] in progress

## Intent

Consolidate whole-place persistence onto one canonical load/save path so runtime place mutation, movement-backed tile updates, item placement, and the upcoming place painter all operate on the same persistence boundary.

This plan exists because `save_place(...)` and `save_place_with_ground(...)` currently behave like parallel whole-place writers that emerged during incremental development. That split is now a risk for:

- runtime augmentation drift
- raw `?` tiles after save/refresh
- painter-safe mutation semantics
- future live authoring of tiles/items/actors/NPCs/structures

## Source Of Truth / Dependencies

- Movement design: `docs/plans/2026_03_13_unified_movement_system_design.md`
- Movement implementation: `docs/plans/2026_03_13_unified_movement_system_implementation_plan.md`
- Place painter implementation: `docs/plans/2026_03_15_place_painter_implementation_plan.md`
- Canonical place storage host: `src/place_storage/store.ts`
- Ground/item helpers: `src/place_storage/ground_store.ts`
- Persistence sanitizer: `src/shared/defs_deltas_sanitize.ts`
- Runtime save/sync wrappers: `src/interface_program/main.ts`

## Invariants (Non-Negotiable)

- There is one canonical whole-place save boundary.
- Ground-item support is part of canonical place persistence, not a second persistence system.
- Saving a place must not mutate the live runtime place object in place.
- Persisted place JSON must not contain runtime-only augmentation flags or transient tile physics state.
- Runtime augmentation remains reproducible and non-authoritative.

## Definition Of Done

- `load_place(...)` is the canonical whole-place loader.
- `save_place(...)` is the canonical whole-place writer.
- Ground/item helpers delegate to canonical place persistence rather than maintaining a parallel full-place save path.
- Whole-place saves deep-clone before sanitization/write.
- Runtime-only fields such as root augmentation sentinels and tile physics state are stripped from persisted JSON.
- Item placement/drop and place refresh no longer produce raw `?` tiles due to persistence drift.

## Architecture Direction

### Canonical whole-place persistence

- `src/place_storage/store.ts` owns whole-place load/save.
- Ground/item logic may add helpers for mutation and normalization, but should not own a second independent whole-place writer.

### Ground support as canonical normalization

- Ground scattered-key normalization remains useful.
- It should live as a helper used by the canonical load path, not as justification for a separate whole-place load/save implementation.

### Runtime safety rule

- Save paths must operate on a cloned canonical object.
- Sanitization must never degrade the active in-memory place object being rendered/simulated.

## Development Sequence

### Phase 1: Consolidate normalization helpers

- [x] Extract ground scattered-key normalization into a reusable helper module.
- [ ] Ensure canonical place load path owns this normalization.

### Phase 2: Collapse parallel whole-place save behavior

- [x] Make `save_place_with_ground(...)` delegate to `save_place(...)`.
- [x] Make `load_place_with_ground(...)` delegate to `load_place(...)`.
- [ ] Audit all remaining callsites and migrate them toward canonical wrappers over time.

### Phase 3: Clone-before-save hardening

- [x] Make `save_place(...)` deep-clone before sanitization/write.
- [ ] Apply the same rule to every remaining whole-place save helper/wrapper.

### Phase 4: Strip runtime-only persistence junk

- [x] Strip root `__api_runtime_augmented` from saved place JSON.
- [x] Strip tile `__physics` from saved place JSON.
- [ ] Audit for any other runtime/editor-only place fields that should be stripped.

## Notes

- This plan is prerequisite-quality work for place painter.
- It also supports unified movement by keeping runtime mutation and saved place state aligned to one persistence model.

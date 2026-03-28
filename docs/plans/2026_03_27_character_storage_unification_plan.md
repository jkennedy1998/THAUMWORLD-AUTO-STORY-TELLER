# Character Storage Unification Plan

Date: 2026-03-27

## Status

- [ ] planned

## Initial Implementation Notes

Initial groundwork added during this planning pass:

- shared character storage helper types in `src/shared/character_storage.ts`
- shared canonical actor/NPC load-save-patch helpers in `src/shared/character_store.ts`
- shared API-side inline character item augmentation in `src/shared/character_payload.ts`
- NPC save sanitization parity with actor save sanitization in `src/shared/defs_deltas_sanitize.ts` and `src/npc_storage/store.ts`
- canonical read endpoints for NPC and ref-based character loading in `src/interface_program/main.ts`
- canonical character update endpoint in `src/interface_program/main.ts`
- place character presence normalization helpers in `src/shared/place_character_presence.ts`
- place save/load normalization for lightweight character presence in `src/place_storage/store.ts`
- frontend NPC character module loading moved off place snapshots and onto canonical character fetches in `src/canvas_app/app_state.ts`
- frontend actor character loading and main-inventory resolution now use canonical ref-based character fetches in `src/canvas_app/app_state.ts`
- initial place-painter-only `character_editor_module` shell added in `src/mono_ui/modules/character_editor_module.ts` and wired through canonical character load/save paths in `src/canvas_app/app_state.ts`
- reusable selectable `option_picker_module` added in `src/mono_ui/modules/option_picker_module.ts`, with initial character-editor picker wiring for `kind` and `sex`

These changes do not complete the migration. They establish the first shared storage/API seams needed for the later character editor work.

## Related Plans

- Character module rework: `docs/plans/2026_02_22_character_module_rework.md`
- Place painter implementation: `docs/plans/2026_03_15_place_painter_implementation_plan.md`
- Unified movement system design: `docs/plans/2026_03_13_unified_movement_system_design.md`

## Intent

Unify actor and NPC storage around one canonical character model so the place painter can edit existing characters safely, the character editor can be shared across actors and NPCs, and future player creation can use the same helpers.

This plan keeps the inline ownership model for items:

- items owned by an actor stay in the actor file
- items owned by an NPC stay in the NPC file
- items owned by a place stay in the place file
- nested container contents stay inline under their owning item/container

The problem to solve is not inline ownership. The problem is that actors moved toward a newer inline character/item model while NPCs and place-held character data still lag behind it.

## Product Direction

The target architecture is:

- `actor` and `npc` files are the canonical source of character data
- `place` files store character presence and place-local spatial state, not full duplicated character sheets
- place painter character editing loads canonical character data by ref, not from place snapshots
- runtime state is split from authored character data
- only runtime fields needed for reload continuity are persisted on the character side
- active places run high-fidelity simulation; inactive places use coarse background progression

This architecture supports:

- a shared `character_editor_module` for actors and NPCs
- future player character creation through the same helpers as NPC/actor creation
- lower drift between actor and NPC storage
- less save duplication between place files and character files

## Current Storage Problems

### Actor and NPC model drift

Actors and NPCs are close enough to want one system, but they are not actually using one shared storage model.

- actor store: `src/actor_storage/store.ts`
- NPC store: `src/npc_storage/store.ts`
- actor schema: `local_data/data_slot_default/schemas/actor.schema.jsonc`
- NPC schema: `local_data/data_slot_default/schemas/npc.schema.jsonc`

Current issues:

- actor and NPC files duplicate many of the same concepts without one shared canonical character definition
- actor-side cleanup and save behavior has moved ahead of NPC-side behavior
- NPC creation and storage still carry more legacy assumptions than actor creation and storage

### Template and schema mismatch

The stored data shapes are not fully aligned with their schemas or with current runtime expectations.

Examples already observed:

- actor schema requires `equipment`, while actor default data uses `equipped_items`
- actor default data is at `schema_version: 2`, while NPC default data is still at `schema_version: 1`
- NPC default data still uses older `equipment.body_slots` and related fields

This means schema, templates, and runtime code are not speaking one clean language.

### Place-held character duplication

Current place data stores rich character records in `actors_present` and `npcs_present` instead of lightweight references plus local spatial state.

That creates several risks:

- duplicated character data can drift away from the canonical actor/NPC files
- editor work can accidentally target place copies instead of real character files
- equipment, tags, body slots, and other sheet fields can end up with multiple saved truths

### NPC canonical load/save gap

Actors already have a clearer canonical load path through `/api/actor`.

NPCs do not yet have an equivalent canonical data flow for editing. Current UI paths reconstruct NPC data from place contents instead of loading the NPC file as the source of truth.

That blocks a real shared character editor.

### Runtime and authored data are mixed together

Character files currently mix:

- authored identity data
- kind-derived baseline data
- current live resources
- movement/runtime timing fields
- AI/memory-related fields

This makes editing noisier, migration harder, and diff-based updates less trustworthy.

### Memory is split across multiple storage styles

Memory data currently exists in more than one shape and location, including:

- simple memory arrays on character-like records
- `memory_sheet` usage on NPC objects
- dedicated long-term memory files in `src/npc_storage/memory.ts`

That needs explicit cleanup so memory does not stay half in sheet data and half in separate systems.

## Canonical Ownership Rules

### Character files own canonical character data

`actor` and `npc` files should own:

- identity fields like name, title, kind, sex, age
- appearance selections and character-authored body/identity choices
- stats, profs, perks, tags, lore, personality, and similar long-lived character data
- body slots and character-owned item layout
- equipment and carried inventory
- current resources that must persist, such as current health/actions/thaum
- reload-critical runtime fields
- memory data, or clear references to memory data, once memory cleanup is complete

### Place files own place data and presence

`place` files should own:

- tiles, structures, connectors, and place geometry
- ground items and place-owned containers
- which actors and NPCs are present in the place
- tile position, elevation, and other place-local spatial presence data
- any place-local occupancy/index data needed for fast movement and interaction queries

### Inline item ownership remains the rule

This plan keeps the current scaling direction:

- actor-owned items are inline in actor files
- NPC-owned items are inline in NPC files
- place-owned items are inline in place files
- contents remain nested under their owning container/item

No central giant item store is introduced for routine ownership.

## Reference Model For Place Character Presence

Place files should stop storing full copied actor/NPC sheets in place contents.

Instead, place character entries should become lightweight presence records.

Recommended presence shape:

```ts
type PlaceCharacterPresence = {
  ref: string;
  role: "actor" | "npc";
  tile_position: { x: number; y: number };
  elevation: number;
  facing?: string;
};
```

Notes:

- `ref` is the authoritative link to the canonical character file
- spatial truth for where a character is standing belongs to the place presence record
- richer character data should be loaded from the actor/NPC file when needed by UI or backend logic
- if temporary runtime caches are needed for performance, they should be treated as derived runtime caches, not saved canonical copies

## Character Storage Split

The unified character model should be organized conceptually into four layers.

### Field audit starting point

Initial field classification for migration planning:

- move to `place presence`: `tile_position`, `elevation`, `facing`, place membership/presence lists
- keep in `character core`: `kind`, `name`, `title`, `sex`, `age`, appearance selections, stats baseline, profs, perks, lore/personality
- keep in `character items`: `body_slots`, equipped items, inline carried containers, nested item contents
- keep in `character state`: current health/vigor/actions/thaum and other current persistent resources
- keep in `runtime continuity` only when needed: `breath_index`, `breath_last_processed`, `breath_last_processed_ms`, resumable movement intent/schedule markers
- move to `memory subsystem`: `memory`, `memory_sheet`, dedicated long-term memory stores

Fields that should be treated as likely transient/runtime-only unless a concrete reload case requires them:

- render caches
- editor/module UI state
- temporary path previews
- recomputable movement helper values
- duplicated place-side character tags/body/equipment snapshots

### 1. Character core

Stable authored data and long-lived identity:

- schema version
- role
- kind
- name and title
- sex and age
- appearance selections
- stats baseline
- profs
- perks and perk point totals
- tags that are part of long-lived character state
- lore and personality categories

### 2. Character items

Inline owned item state:

- body slots
- equipped items
- inline inventory containers and contents
- body-slot-attached storage relationships

### 3. Character state

Live state that persists across save/load:

- current and max resources where appropriate
- any active long-lived statuses/effects
- reload-critical runtime continuity fields

This is where fields like current health, current actions, and current thaum belong.

### 4. Character runtime continuity

Only runtime fields needed to resume correctly after reload:

- last processed breath markers
- resumable movement intent if a move should continue cleanly after reload
- in-progress state that must survive a restart to avoid broken continuity

Do not persist transient UI caches, editor state, render caches, or recomputable helper data in this layer.

## Active vs Inactive Simulation Rule

For performance and fidelity, simulation should split by load state.

### Active places

Active or loaded places run high-fidelity simulation:

- step-by-step movement
- occupancy checks
- local interaction timing
- detailed pathing and collision

### Inactive places

Inactive or unloaded places should use coarse background progression:

- advance schedules in larger logical steps
- complete travel goals or schedule milestones without simulating every footstep
- persist enough state so the character resumes coherently when the place becomes active again

This avoids expensive offscreen simulation while preserving believable continuity.

## Runtime Location Rule

Canonical position should not live only on the character file.

Recommended split:

- place presence owns spatial truth: who is in the place, tile position, elevation, facing
- character runtime owns resumable movement continuity: movement goal, last processed breath, and other reload-critical movement state

This avoids two major failure modes:

- character says they are in a place but the place does not list them
- place lists a character but the character file says they are elsewhere

## Storage Rules For The Character Editor

The future `character_editor_module` should follow these rules:

- it opens by selected `actor_ref` or `npc_ref`
- it loads canonical character data from the actor/NPC file
- it does not use `place.contents.*_present` as the authoring source
- it is available only in place painter mode
- edits are saved back to the canonical owner file

This editor should become the shared character authoring surface for:

- NPC editing in place painter
- actor editing in place painter
- future player creation and editing helpers

## Migration Phases

### Phase C1: Define the unified storage model

- [ ] define a shared conceptual character schema for actor and NPC storage
- [ ] classify every existing field as one of:
  - character core
  - character items
  - character state
  - runtime continuity
  - place presence
  - memory subsystem
- [ ] mark deprecated legacy fields explicitly

Acceptance:

- [ ] every actor/NPC field has a clear ownership category
- [ ] deprecated fields are listed before migration code starts

### Phase C2: Bring NPC storage up to actor-era inline ownership conventions

- [ ] align NPC body-slot and equipped-item layout with the newer actor-side inline model
- [ ] remove or deprecate legacy NPC `equipment` storage patterns
- [ ] make NPC save/load sanitization behavior parallel to actor save/load

Acceptance:

- [ ] NPC-owned items follow the same inline ownership rules as actor-owned items
- [ ] NPC files no longer depend on legacy equipment-only structures as canonical data

### Phase C3: Introduce canonical NPC API paths

- [ ] add canonical NPC load endpoint(s) parallel to actor load behavior
- [ ] add save/update path(s) for NPC character editing
- [ ] ensure frontend editor paths can load both actors and NPCs by ref from canonical files

Acceptance:

- [ ] UI can load an NPC without going through place snapshot copies
- [ ] actor and NPC editor fetch paths are structurally similar

### Phase C4: Slim place-held character data into presence records

- [ ] replace rich copied actor/NPC place entries with reference-oriented presence records
- [ ] keep tile position, elevation, and other place-local spatial truth in place data
- [ ] remove duplicated sheet-like fields from place persistence

Acceptance:

- [ ] place files no longer store full copied character sheets
- [ ] place rendering and movement can still answer local occupancy questions efficiently

### Phase C5: Separate runtime continuity from authored character data

- [ ] move transient or recomputable fields out of canonical authored storage
- [ ] keep only reload-critical runtime continuity fields on character persistence
- [ ] document which movement/action/status fields persist and which are runtime-only

Acceptance:

- [ ] character files are cleaner to edit
- [ ] save data persists continuity without saving unnecessary transient noise

### Phase C6: Build the painter-side character editor on canonical storage

- [ ] add a dedicated painter `character` tool
- [ ] add `character_editor_module` with actor/NPC parity
- [ ] gate editing so it is only available in place painter mode
- [ ] save back to canonical actor/NPC files

Acceptance:

- [ ] selected actor or NPC can be edited from place painter
- [ ] editor data matches canonical character storage, not place copies

### Phase C7: Memory cleanup follow-on

- [ ] choose one canonical memory ownership model
- [ ] separate memory editing/scrubbing UI from the core identity sheet
- [ ] remove ambiguous overlap between simple memory arrays, `memory_sheet`, and dedicated memory stores

Acceptance:

- [ ] memory data has one clear ownership and access pattern
- [ ] character core editing does not accidentally mutate multiple memory systems

## Main Risks And Safeguards

### Risk: existing systems expect rich place-held character blobs

Safeguard:

- migrate in phases and provide compatibility adapters during transition
- audit renderer, movement, AI, and targeting code before removing place-held fields

### Risk: NPC editing still routes through place snapshots

Safeguard:

- add canonical NPC API paths before building the editor
- make the editor reject non-canonical load paths

### Risk: actor/NPC divergence keeps reappearing

Safeguard:

- define one shared character storage contract first
- treat actor/NPC differences as narrow role-specific extensions only

### Risk: runtime data pollutes authored data again

Safeguard:

- maintain an explicit persisted runtime continuity section
- reject transient UI/cache/debug fields from canonical character save paths

### Risk: memory remains split across systems

Safeguard:

- keep memory cleanup as an explicit tracked phase, not an implicit side effect of editor work

## Success Criteria

- actor and NPC files act as the canonical source for character data
- place files hold character presence and place-local spatial truth, not full copied character sheets
- actor-owned, NPC-owned, and place-owned items remain inline with their owner
- runtime persistence is limited to reload-critical continuity state
- place painter can open a shared `character_editor_module` for both NPCs and actors
- future player creation can reuse the same storage and helper foundations

## Recommended Default Decisions

- keep inline ownership for items
- keep canonical location in place presence records, not duplicated on character files
- keep high-fidelity simulation for active places only
- use coarse background progression for inactive places
- persist only reload-critical runtime continuity fields on characters
- load editor data from canonical actor/NPC files by ref

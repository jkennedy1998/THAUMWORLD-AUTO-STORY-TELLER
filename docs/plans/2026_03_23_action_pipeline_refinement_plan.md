# Action Pipeline Refinement Plan

Date: 2026-03-23

## Status

- [~] in progress

## Intent

Refine the current action pipeline, breath loop, timed-event state, and movement runtime into one coherent gameplay model for free roam and timed events.

This plan focuses on the verbs currently in active development:

- `MOVE`
- `INSPECT`
- `USE`
- `COMMUNICATE`

The goal is not to replace the existing breath-driven movement runtime. The goal is to make breaths, action economy, turn permission, movement permission, and observer broadcasting feel like one integrated system.

This plan is also explicitly about reusing systems we already have and collapsing parallel behavior where those systems overlap.

## Source Of Truth / Related Plans

- Movement runtime host: `src/interface_program/main.ts`
- Action pipeline: `src/action_system/pipeline.ts`
- Interface integration shell: `src/interface_program/action_integration.ts`
- Timed-event persistence: `src/world_storage/store.ts`
- Turn phase engine: `src/turn_manager/state_machine.ts`
- Communication reaction flow: `src/npc_ai/witness_handler.ts`
- Conversation lifecycle: `src/npc_ai/conversation_state.ts`
- Unified movement design: `docs/plans/2026_03_13_unified_movement_system_design.md`
- Unified movement implementation: `docs/plans/2026_03_13_unified_movement_system_implementation_plan.md`

If this plan conflicts with older action assumptions, this plan wins for action-economy direction.

## Canonical Owners

This plan chooses one owner per concern.

### Persisted Timed-Event Truth

- owner: `src/world_storage/store.ts`
- owns whether a timed event exists, who participates, which actor is active, event type, region, and restart-safe persistence
- also owns trigger-context metadata so the system can remember why the timed event started

### Turn Phase Workflow

- owner: `src/turn_manager/state_machine.ts`
- owns phases, held actions, reactions, and phase progression rules

### Breath Runtime And Movement Suppression

- owner: `src/interface_program/main.ts`
- owns breath cadence, movement pacing, movement suppression, gravity, and final movement authority

### Action Approval And Observer Broadcasting

- owner: `src/action_system/pipeline.ts`
- owns action validation, action approval, and observer broadcasting semantics

### Communication Reactions And Conversation Lifecycle

- owner: `src/npc_ai/witness_handler.ts` and `src/npc_ai/conversation_state.ts`
- owns witness-driven responder eligibility, conversation start/end, and conversation-state timing

The purpose of this plan is to bridge these systems, not to create parallel replacements for them.

## Core Design Decisions

### Breath Is Canonical

- Breaths are the simulation clock in free roam.
- Breaths remain the simulation clock in timed combat / timed events.
- Timed events should not introduce a separate stepping model that fights the breath system.
- Action economy, movement suppression, and turn ownership should piggyback on breaths rather than bypass them.

### Turns Mean Permission, Not A New Physics System

- Timed turns answer: `can this actor or npc act now?`
- Timed turns should control when actions may be initiated and when movement input may spend movement budget.
- Once an entity has no remaining action economy and no remaining movement economy, it is done acting until refreshed by turn progression.

### Timed Events Start With Initiative

- Timed events always start with initiative.
- Initiative is rolled at timed-event start to determine who acts first.
- Participants are ordered highest to lowest by initiative according to the initiative rules already present in the system.
- After a turn, that actor goes to the end of the list and the next highest initiative'd participant acts.
- The old hold clarification is out of scope for this plan because `HOLD` is not being implemented yet.

### One Timed-Event Container, Different Trigger Contexts

- Conversation-style escalation and hostile/injurious escalation should use the same timed-event infrastructure.
- The important distinction is trigger context and NPC motive, not a separate turn/initiative system.
- Timed events should retain metadata about what triggered them so later systems can derive motive and behavior.

### Temporary Timed-Event Exit Policy

- For the current development phase, timed events end only when the debug `END` control is used.
- Automatic end conditions are intentionally disabled for now.
- Real event-state-based ending will come later once communication, inspect, and other action integrations are more mature.
- This keeps turn-mode stable while verbs and NPC turn behavior are still being integrated.

### MOVE Is A Control / Movement-Budget Action

- `MOVE` is not primarily a one-tile discrete boardgame step in runtime code.
- The live movement runtime remains breath-based, continuous, and input-driven.
- In free roam, `MOVE` is throttled by movement speed across breaths.
- In timed events, `MOVE` is effectively expressed as movement input/control budget available during the entity's turn window.
- In timed events, movement input is allowed only while timed-event movement budget remains.
- When that movement budget is depleted, movement input is suppressed.
- `MOVE` as a `FULL` action should refresh or substantially refill movement capacity during a timed event.
- Gravity, falling, and other physical resolution continue even when control input is suppressed.

### INSPECT Uses Real Action Economy

- `INSPECT` uses an action.
- In free roam, `INSPECT` should use a `FULL` action.
- In timed events/combat, `INSPECT` should respect the player's chosen cost mode through the UI/control path.
- `INSPECT` is a meaningful turn-economy cost in combat even if it is not dramatic in realtime feel.

### USE Is A General Interaction Action

- `USE` is the general interaction action bucket.
- It covers interactions such as transfers, button presses, equipping armor/tools/weapons, pickups, throws, and similar item/world interactions.
- Some `USE` interactions require no roll.
- Some `USE` interactions require a roll.
- `USE` may consume action economy, movement economy, or a mix depending on the interaction.
- When a `USE` action costs movement during a timed event and is not itself movement, it should spend from the same movement pool used for locomotion that turn.

### Free Roam And Timed Events Should Share The Same Throttle Model

- Free roam already uses breath-based throttling and movement budget/debt logic.
- Timed-event movement should reuse the same underlying throttle model whenever possible.
- In timed events, entities that can act should be exposed to the same amount of physics breaths during their turn windows.
- Timed-event movement should be spread across those breaths in a manner similar to free-roam throttling rather than resolving as an instant burst.
- NPC control pacing during timed events should derive from the same scalable breath-budgeting idea rather than a separate custom scheduler.
- This keeps free roam and timed events parallel, scalable, and easier to reason about.
- Later target: global breaths should slow in timed-event mode so the world is exposed to time equivalently rather than remaining at full free-roam cadence.

### Reuse Current Systems Aggressively

- Prefer extending systems already carrying real gameplay state over creating new neighbors that fulfill the same niche.
- Do not preserve legacy compatibility paths permanently if a newer system already serves the same role.
- If two systems currently model the same concern, this plan must choose one owner and schedule the other for removal.

## Current Reality

### Already True

- The server breath loop is real and already drives live simulation in `src/interface_program/main.ts`.
- Free-roam movement already has breath-based throttling and movement budget / debt accounting.
- Movement perception already feeds the witness system using action-style perception events.
- The action pipeline already handles validation, broadcasting, and observer collection for non-movement verbs.
- Timed-event persistence already exists in `src/world_storage/store.ts`.
- Turn phase scaffolding already exists in `src/turn_manager/state_machine.ts`.
- Witness-driven communication and conversation flow already exist in `src/npc_ai/witness_handler.ts` and `src/npc_ai/conversation_state.ts`.

### Not Yet Authoritative

- Action cost enforcement is intentionally not authoritative yet.
- Turn ownership is intentionally not authoritative yet because free roam is still primary.
- `MOVE` does not yet use the action pipeline as the approval layer for live movement input.
- `executeEffect(...)` in `src/interface_program/action_integration.ts` is still too stubbed to be the canonical action bridge.

### Duplicate / Transitional Reality To Collapse

- Turn progression is currently split between persisted world state and a newer in-memory phase state machine.
- `src/turn_manager/main.ts` still runs legacy turn advancement while also running newer phase flow.
- Action cost concepts are split across world-store counters, `turn_manager/validator.ts`, and stubbed pipeline hooks.
- Communication eligibility is partly owned by witness logic and partly by interface-side fallback heuristics.

This plan does not preserve those overlaps as permanent architecture.

## Existing Systems To Reuse

### Persisted Timed-Event State

- Reuse `src/world_storage/store.ts` as the persisted source of truth for active timed-event metadata.
- Extend it rather than inventing a second persisted event authority.
- Keep it responsible for restart-safe event continuity.

### Turn Phase Engine

- Reuse `src/turn_manager/state_machine.ts` as the turn-phase engine.
- Extend it instead of preserving legacy one-off advancement logic in parallel.
- Long term, phase progression should be expressed there rather than duplicated in world-store helpers.
- Reuse the existing initiative roll + ordering flow at timed-event start rather than inventing a second initiative system.

### Witness-Driven Communication Flow

- Reuse `src/npc_ai/witness_handler.ts` and `src/npc_ai/conversation_state.ts` as the canonical communication reaction path.
- Do not preserve interface-side responder fallback heuristics once witness eligibility is trustworthy.
- The detailed NPC communication scheduler/refactor work is tracked in `docs/plans/2026_02_13_advanced_npc_interactions_scheduler.md`.

### Breath-Driven Movement Runtime

- Reuse `src/interface_program/main.ts` as the only canonical movement runtime.
- Timed-event movement suppression should happen there, in the same place that already owns breath pacing and movement spend.
- Do not add a separate combat movement engine.

### Action Pipeline Ingress

- Reuse `src/interface_program/action_integration.ts` as the ingress shell into `src/action_system/pipeline.ts`.
- Replace its stubs with real adapters instead of bypassing it forever.

## Systems To Collapse / Remove

### Turn Duplication

- Collapse the split between persisted world-turn helpers and in-memory turn-phase logic.
- Keep `src/world_storage/store.ts` for persistence.
- Keep `src/turn_manager/state_machine.ts` for phase behavior.
- Remove the legacy advancement path in `src/turn_manager/main.ts` after the new path is authoritative.

### Action Cost Duplication

- Do not preserve three parallel notions of action economy.
- Choose one live adapter path from pipeline -> timed-event state.
- Treat `src/turn_manager/validator.ts` as policy/reference material unless and until it becomes the single real validator.

### Communication Scheduling Duplication

- Do not preserve both witness-driven responder selection and interface-side responder fallback logic long-term.
- Witness/conversation systems should become the canonical communication scheduler.

### Legacy Compatibility Fields / Aliases

- Avoid preserving duplicate counters, aliases, and helper paths once a canonical owner exists.
- Migration scaffolding is allowed temporarily, but every duplicated path should have a removal phase.

## Target Model

## 1. Shared Breath-Driven Gameplay Substrate

- One breath loop powers free roam and timed events.
- Timed events add permission layers and action/movement budgets on top of that breath loop.
- No second movement simulation should be introduced for combat.
- Timed combat should reuse the same scalable breath cadence model already proven in free roam.

## 2. Split Economy: Action Budget And Movement Budget

- Action budget covers `FULL`, `PARTIAL`, and later `EXTENDED` behavior.
- Movement budget covers how much input-driven locomotion the entity may still spend this turn.
- Every meaningful thing should consume either action economy or movement economy.
- When both are depleted, the entity has nothing left to do.
- Turn ownership is fundamentally permission: the actor or NPC can act now, spend now, or is done for now.

### Full vs Partial Actions

- The gameplay difference between a `FULL` action and a `PARTIAL` action is whether modifiers may be used in rolls.
- `PARTIAL` actions do not allow positive modifiers to improve the acting entity's roll.
- `PARTIAL` actions still allow negative modifiers to affect the acting entity's roll.
- `PARTIAL` actions also do not prevent an opposing/contesting roll from using its own allowed positive modifiers.
- `FULL` actions allow modifiers to participate in the action's rolls.
- Some actions may only be taken as `FULL` actions.

### Important Clarification

- The existing free-roam `move_budget` / `move_debt` runtime in `src/interface_program/main.ts` is primarily movement pacing.
- Timed-event `movement_remaining` style values are action-economy state.
- These systems should be bridged carefully, not blindly merged as if they were the same field.

## 3. MOVE In Timed Events

- Baseline timed-event movement budget is tracked per entity.
- Holding movement input or using click-movement spends timed-event movement budget through the normal breath runtime.
- `MOVE` as a `FULL` action refills or strongly refreshes movement capacity.
- In timed events, movement spending should be understood as available movement inputs / movement ability during the turn, not a separate non-breath stepper.
- Actors and NPCs with turns should be exposed to comparable physics-breath opportunity during their turn windows.
- If movement budget is empty:
  - input-driven acceleration is suppressed
  - path-follow intent is suppressed
  - falling / gravity still resolve

## 4. Verb-Specific Intent

### MOVE

- Approves movement control / refresh behavior.
- Owns movement-related observer broadcasts.
- In timed events, governs whether the entity can continue spending movement.

### INSPECT

- Uses pipeline validation + observer broadcasting.
- Uses action economy once costs are wired.
- In free roam, the first-pass runtime rule is `FULL`.
- In timed events/combat, it should respect the chosen cost mode from the UI/control path.
- If `INSPECT` is taken as `PARTIAL`, it should use only the natural roll outcome.
- If `INSPECT` is taken as `PARTIAL`, it should still allow negative modifiers against the acting entity where applicable.
- If `INSPECT` is taken as `FULL`, it may use modifiers.
- Does not need to touch movement runtime.

### USE

- Uses pipeline validation + observer broadcasting.
- Can consume action economy, movement economy, or a mix depending on the interaction.
- Some `USE` cases require no roll.
- Some `USE` cases require a roll.
- If a `USE` action is taken as `PARTIAL`, its roll uses only the natural outcome.
- If a `USE` action is taken as `PARTIAL`, it should still allow negative modifiers against the acting entity where applicable.
- If a `USE` action is taken as `FULL`, it may use modifiers.
- Some `USE` interactions may require `FULL` and should not allow `PARTIAL`.
- Movement-cost `USE` cases should spend from the same movement pool used for locomotion during the turn.
- Can later affect movement state indirectly through statuses/tags, but not by bypassing the pipeline.

### COMMUNICATE

- Uses pipeline validation + observer broadcasting.
- Uses action economy once costs are wired.
- Can trigger the same class of timed event as hostile or injurious `USE` interactions.
- Multiple people talking can escalate into a timed event.
- `COMMUNICATE` should continue using witness/conversation systems as its reaction and eligibility substrate.

### Hostile Or Injurious USE

- `ATTACK` is no longer a separately supported verb in this plan.
- Hostile or injurious actions now live under `USE`.
- An attempt to injure health from one character to another should be treated as a timed-event trigger condition.
- Observer and witness behavior for hostile `USE` should use the same general observer model as other current verbs.

## First-Pass Rules Matrix

This matrix is the current implementation target unless a later plan update changes it explicitly.

| Verb | Free Roam | Timed Event | Roll Rule | Notes |
| --- | --- | --- | --- | --- |
| `MOVE` | Breath-throttled movement input | Turn-window movement/control budget | No standard action roll | Uses the existing movement runtime; timed events suppress control input when movement is depleted |
| `INSPECT` | `FULL` | Player chooses supported cost mode | `PARTIAL`: no positive modifiers for actor, negatives still apply; `FULL`: modifiers allowed | Meaningful combat cost even if realtime feel is lighter |
| `USE` | Context-driven, usually permissive | Costs action, movement, or both depending on the interaction | Some uses roll, some do not; `PARTIAL` means no positive modifiers for actor, negatives still apply | Movement-cost `USE` spends from the same movement pool as locomotion |
| `COMMUNICATE` | Uses pipeline path without timed turn gating | Costs action economy according to first-pass communication rules | If a communication roll exists, `PARTIAL` means no positive modifiers for actor, negatives still apply; `FULL` means modifiers allowed | Multiple participants talking can trigger a timed event |

### Matrix Notes

- `PARTIAL` never shields the acting entity from negative modifiers.
- `PARTIAL` also does not suppress allowed positive modifiers on opposing/contesting rolls.
- Timed-event movement should be spread across comparable physics breaths for actors and NPCs with turns.

## Non-Goals For This Plan

- Do not fully implement every tabletop action.
- Do not replace the current breath movement runtime with a discrete action-stepper.
- Do not fully solve peak/blunder systems in this pass.
- Do not require the old text command parser to be part of the final architecture.
- Do not preserve overlapping legacy systems simply because they already exist.

## Invariants

- Breath remains canonical in free roam and timed events.
- Server remains authoritative for final movement state.
- Timed-event turns gate action initiation and movement spending, not physics itself.
- Movement suppression in timed events must not suppress gravity/falling.
- Broadcasting of observable actions should use one perception/witness model.
- Free-roam and timed-event movement should stay mechanically parallel where possible.

## Phases

The phases below are intentionally narrow. Each phase should leave the project in a testable state before the next phase starts.

## Phase 1 - Lock The Gameplay Contract

Purpose: define the behavior clearly enough that implementation work does not drift.

### Deliverables

- [x] Define the timed-event action economy contract for current verbs only: `MOVE`, `INSPECT`, `USE`, `COMMUNICATE`.
- [x] Define which resources each current verb spends: action budget, movement budget, or both.
- [x] Define the initial timed-event movement resource model in concrete engine terms.
- [ ] Decide the first-pass refill behavior for `MOVE` as a `FULL` action.
- [ ] Define how timed-event depletion maps onto suppression in the live movement controller.
- [ ] Define exactly which existing runtime fields are reused and which fields are only transitional.
- [x] Define what stays permissive in free roam versus what becomes authoritative in timed events.
- [x] Define how `INSPECT` cost selection works in timed events versus free roam.
- [x] Define how `USE` can spend movement instead of action budget for specific interaction cases.
- [ ] Define how timed-event breath exposure is normalized across actors and NPCs with turns.
- [ ] Define exactly how `FULL` versus `PARTIAL` affects current-verb rolls in first-pass runtime rules.
- [ ] Define which current verbs/interactions may only be used as `FULL`.
- [x] Define the first-pass debug path for manually starting a timed event during development.

### Exit Criteria

- The plan can answer, without ambiguity:
  - `can_act_now`
  - `can_spend_action_cost`
  - `can_spend_movement`
  - `should_suppress_control_input`
  - `should_gravity_continue`
- Each current verb has a first-pass gameplay rule that matches the tabletop intent.

### Test Cases

- [ ] Rule check: in free roam, held movement input still works without turn gating.
- [ ] Rule check: in a timed event, an entity can exhaust action economy and movement economy separately.
- [ ] Rule check: once both are depleted, the entity has nothing left to do this turn.
- [ ] Rule check: gravity/falling remains active even if movement control is depleted.
- [ ] Rule check: `INSPECT` uses a `FULL` action in free roam.
- [ ] Rule check: `INSPECT` can use the chosen timed-event cost mode in combat.
- [ ] Rule check: a movement-cost `USE` action spends from the same movement pool as locomotion.
- [ ] Rule check: `PARTIAL` rolls do not gain positive modifiers for the acting entity.
- [ ] Rule check: `PARTIAL` rolls still suffer negative modifiers where applicable.
- [ ] Rule check: `PARTIAL` does not suppress allowed positive modifiers on opposing/contesting rolls.
- [ ] Rule check: `FULL` rolls can apply modifiers.
- [ ] Rule check: timed events start by rolling initiative and selecting a first actor.

## Phase 2 - Make Timed-Event State The Real Query Surface

Purpose: make the pipeline and runtime ask the same source of truth about timed-event state.

### Deliverables

- [x] Replace the `isInCombat()` stub in `src/interface_program/action_integration.ts` with real timed-event state.
- [x] Replace the `getCurrentActor()` stub in `src/interface_program/action_integration.ts` with real active-actor lookup.
- [ ] Decide whether `src/turn_manager/validator.ts` is promoted into the real adapter path or reduced to reference/policy code.
- [ ] Document which timed-event fields in `src/world_storage/store.ts` remain canonical and which are transitional.
- [ ] Ensure turn-phase reads and action-pipeline reads agree on active event and active actor.

### Dependencies

- Requires Phase 1 rules to be stable enough to encode.

### Exit Criteria

- `action_integration` no longer answers combat/turn questions with hardcoded stubs.
- The action pipeline and turn logic agree on who the active actor is.
- The project has one obvious query path for timed-event presence and active actor.

### Test Cases

- [ ] Start a timed event and verify the action pipeline sees timed-event-active state.
- [ ] Start a timed event and verify the current actor reported to the action pipeline matches the turn manager.
- [ ] Verify free-roam action usage still works when no timed event is active.
- [ ] Start a timed event through the debug path and verify initiative is rolled immediately.

## Phase 3 - Wire Action Economy Without Overbuilding

Purpose: make turn permission and current-verb action costs real in the pipeline.

### Deliverables

- [x] Replace `checkActionCost()` stub logic with live timed-event checks for `MOVE`, `INSPECT`, `USE`, and `COMMUNICATE`.
- [x] Replace `consumeActionCost()` stub logic with live budget consumption for the same verbs.
- [x] Enable pipeline cost checks when the adapter layer is trustworthy.
- [ ] Decide first-pass runtime costs for `USE` and `COMMUNICATE`.
- [x] Support the first-pass timed-event cost selection path for `INSPECT`.
- [x] Support `USE` actions that spend movement instead of a standard action where applicable.
- [ ] Support first-pass `FULL` vs `PARTIAL` roll behavior for current verbs where rolls apply.

### Dependencies

- Requires Phase 2 real turn/timed-event queries.

### Exit Criteria

- In timed events, current verbs can be accepted or rejected for turn/cost reasons by the pipeline.
- Outside timed events, free roam remains permissive.
- No second action-cost authority is introduced.

### Test Cases

- [ ] Timed-event active actor can spend a legal `INSPECT` action and receive success from the pipeline.
- [ ] Free-roam `INSPECT` consumes a `FULL` action according to the first-pass rule.
- [ ] Timed-event non-active actor is rejected for `USE` or `COMMUNICATE` because it is not their turn.
- [ ] Timed-event active actor can deplete partial/full economy and then receives a rejection for a further action.
- [ ] Timed-event active actor can perform a movement-cost `USE` action and lose movement from the same pool used for locomotion.
- [ ] Free-roam `INSPECT`/`USE`/`COMMUNICATE` still route through the pipeline without turn-based rejection.
- [ ] A `PARTIAL` rolled action uses only the natural outcome.
- [ ] A `PARTIAL` rolled action does not gain positive modifiers for the acting entity.
- [ ] A `PARTIAL` rolled action still suffers negative modifiers where applicable.
- [ ] A contest against a `PARTIAL` action can still use allowed positive modifiers on the opposing side.
- [ ] A `FULL` rolled action can use modifiers.

## Phase 4 - Add Timed-Event Movement Economy On Top Of Existing Breaths

Purpose: add movement depletion and suppression without creating a second locomotion system.

### Deliverables

- [x] Add timed-event movement budget state alongside existing breath movement runtime state.
- [ ] Define how movement capacity is initialized at turn start.
- [x] Define how `MOVE` refills movement capacity.
- [ ] Define how movement capacity is drained by held intent / path following across breaths.
- [x] Define suppression behavior when movement capacity hits zero.
- [x] Wire suppression in the canonical movement controller in `src/interface_program/main.ts`.
- [ ] Define how many physics breaths an acting entity is exposed to during a timed turn window.
- [ ] Define how that turn-window breath exposure should stay comparable across actors and NPCs.

### Dependencies

- Requires Phase 1 movement rules and Phase 2 timed-event truth.

### Exit Criteria

- Timed-event movement can be exhausted independently of action economy.
- When movement is depleted, control movement is suppressed in the live movement controller.
- Gravity/falling still resolve.
- No combat-only movement scheduler is introduced.

### Test Cases

- [ ] During a timed event, hold movement input until movement budget is exhausted and verify movement stops from suppression rather than crash or desync.
- [ ] During a timed event, compare two entities with turns and verify they receive comparable movement opportunity across their turn windows.
- [ ] During a timed event, after movement depletion, verify falling still occurs from an unsupported position.
- [ ] In free roam, held movement still uses the normal breath throttle and is not blocked by timed-event movement gating.
- [ ] NPC timed-event movement can be throttled using the same breath-based pacing model rather than a second tick system.

## Phase 5 - Make MOVE A Real Action Bridge

Purpose: make timed-event `MOVE` interact correctly with movement permission without forcing tile-stepping into the pipeline.

### Deliverables

- [x] Add a proper action-side bridge for `MOVE` approval in timed events.
- [ ] Keep free-roam movement responsive while allowing timed-event gating.
- [ ] Make click-to-move and held intent respect timed-event movement suppression.
- [ ] Ensure runtime stepping still happens in the canonical breath loop.
- [ ] Keep gravity/falling active even when control movement is depleted.
- [ ] Ensure no parallel combat-only movement scheduler is introduced.
- [ ] Ensure timed-event movement is spread across turn-window breaths rather than collapsing into a single burst.

### Clarification

- The pipeline does not need to micromanage every tile step.
- The pipeline must decide whether movement is currently allowed or refreshed.
- The movement runtime then spends that permission over subsequent breaths.

### Dependencies

- Requires Phase 3 action economy and Phase 4 movement depletion.

### Exit Criteria

- `MOVE` in a timed event has a visible gameplay effect on movement availability.
- `MOVE` does not replace the live movement runtime.
- Direct held movement and click-to-move both respect the same permission model.

### Test Cases

- [ ] Timed-event actor with no movement remaining uses `MOVE` and regains the ability to move.
- [ ] Timed-event actor with no movement remaining cannot continue moving until `MOVE` or turn refresh restores movement.
- [ ] Click-to-move during a timed event halts once movement is depleted.
- [ ] Held direct input and click-follow consume the same timed-event movement economy by the same rules.

## Phase 6 - Unify Observer Broadcasting Across Current Verbs

Purpose: keep action visibility and NPC reactions consistent while timed-event rules become more authoritative.

### Deliverables

- [ ] Keep `INSPECT`, `USE`, and `COMMUNICATE` on the normal action-pipeline perception path.
- [ ] Align `MOVE` broadcasts with the same observer semantics used by the action pipeline.
- [ ] Ensure timed-event movement suppression does not break witness updates for actual motion that still occurs.
- [ ] Preserve `observedBy` style outputs for downstream systems where useful.
- [ ] Keep witness/conversation eligibility as the canonical communication reaction path.
- [ ] Schedule interface-side responder fallback logic for removal once witness-driven eligibility covers the same cases.

### Dependencies

- Requires current verbs to be routing through their intended approval paths.

### Exit Criteria

- Movement and non-movement current verbs both produce observer-facing results in a consistent way.
- Communication-side NPC reactions still rely on witness/conversation logic rather than parallel heuristics.

### Test Cases

- [ ] `COMMUNICATE` produces observer/witness data for nearby NPCs in timed events.
- [ ] `INSPECT` and `USE` continue to produce action-pipeline observer results.
- [ ] Actual movement that occurs in a timed event still produces witness-visible motion events.
- [ ] Communication responders come from witness/conversation eligibility rather than interface fallback logic for covered cases.

## Phase 7 - Current-Verb Rules Pass

Purpose: finish the first coherent gameplay slice for the four current verbs.

### Deliverables

- [ ] Define first-pass action-economy rules for `MOVE`.
- [ ] Define first-pass action-economy rules for `INSPECT`.
- [ ] Define first-pass action-economy rules for `USE`.
- [ ] Define first-pass action-economy rules for `COMMUNICATE`.
- [ ] Verify these rules against the current tabletop notes and runtime constraints.
- [ ] Define first-pass movement-cost `USE` examples that must work.
- [ ] Define which first-pass verb variants are `FULL`-only.
- [~] Keep inspect-target normalization explicitly in scope while `INSPECT` is being integrated alongside `COMMUNICATE`.

### Consolidation Rules

- Prefer extending current systems over introducing new neighboring systems.
- If a current system fully covers the niche, remove the older/parallel behavior instead of preserving both.
- Any compatibility path retained for migration must name its removal target.

### First-Pass Verb Intent

- `MOVE`
  - timed-event role: refresh / authorize movement control budget
  - free-roam role: remains live movement input pathway
- `INSPECT`
  - action-economy verb with normal pipeline execution
  - free-roam default: `FULL`
  - timed-event mode: chosen cost mode via UI/control path
  - `PARTIAL`: no positive modifiers for the acting entity; negative modifiers still apply
  - `FULL`: modifiers allowed
- `USE`
  - action-economy verb with normal pipeline execution
  - may sometimes spend movement instead of a standard action
  - some variants may be `FULL`-only
- `COMMUNICATE`
  - action-economy verb with normal pipeline execution
  - may trigger timed events when multiple people are talking
  - if a roll exists, `PARTIAL` means no positive modifiers for the acting entity; negative modifiers still apply
  - if a roll exists, `FULL` means modifiers allowed

### Exit Criteria

- The four verbs behave coherently under the same timed-event permission model.
- Their first-pass runtime behavior is compatible with the tabletop direction, even if not feature-complete.

### Test Cases

- [ ] The active actor can meaningfully use each of the four verbs during a timed event according to its first-pass rule.
- [ ] A non-active actor cannot bypass turn permission with any of the four verbs.
- [ ] Exhausting action economy or movement economy changes what verbs remain available in intuitive ways.
- [ ] `FULL` versus `PARTIAL` meaningfully changes rolled outcomes according to the rules.
- [ ] `PARTIAL` still allows negative modifiers and opposing contested advantages where applicable.

## Phase 8 - Deletion / Cleanup Phase

Purpose: remove overlaps so the new architecture stays understandable.

### Deliverables

- [ ] Remove legacy turn advancement in `src/turn_manager/main.ts` once state-machine-driven flow is authoritative.
- [ ] Remove duplicate or unused timed-event counters once one live action-economy path is authoritative.
- [ ] Remove interface-side communication responder fallback heuristics once witness-driven scheduling fully replaces them.
- [ ] Remove stale compatibility aliases or duplicate fields that no longer serve persistence migration.

### Dependencies

- Requires replacement paths to be proven by earlier phases.

### Exit Criteria

- No duplicate turn progression path remains active.
- No duplicate communication scheduling path remains active for the covered behaviors.
- Remaining compatibility scaffolding is minimal and explicitly justified.

### Test Cases

- [ ] Verify the game still progresses turns correctly after legacy turn advancement is removed.
- [ ] Verify communication behavior remains correct after interface-side fallback heuristics are removed for covered cases.
- [ ] Verify restart/load behavior still works after duplicate compatibility fields are reduced.

## Phase 9 - Verification Matrix

Purpose: prove the integrated model actually matches the game rules and goals.

### Free Roam Verification

- [ ] Held movement remains responsive and breath-driven.
- [ ] Click-to-move remains responsive.
- [ ] Free-roam actions are not incorrectly blocked by timed-event rules.
- [ ] Free-roam `INSPECT` follows the first-pass `FULL` rule.

### Timed Combat / Timed Event Verification

- [ ] Only the active actor/NPC can initiate current verbs.
- [ ] Action economy can be spent and exhausted.
- [ ] Movement economy can be spent and exhausted.
- [ ] Once both are depleted, the entity has nothing left to do.
- [ ] `MOVE` restores meaningful movement capacity.
- [ ] Movement suppression does not stop gravity/falling.
- [ ] Timed-event movement is distributed across the acting entity's turn-window breaths rather than resolving as an instant burst.
- [ ] `PARTIAL` roll actions use natural outcomes only.
- [ ] `PARTIAL` roll actions do not gain positive modifiers for the acting entity.
- [ ] `PARTIAL` roll actions still suffer negative modifiers where applicable.
- [ ] `FULL` roll actions allow modifiers.

### Witness / Broadcast Verification

- [ ] `MOVE`, `INSPECT`, `USE`, and `COMMUNICATE` all produce observer-facing behavior consistent with their path.
- [ ] NPC witness reactions continue to function for observable actions.
- [ ] Communication eligibility comes from witness/conversation state rather than interface fallbacks.

### Scalability / Parallelism Verification

- [ ] NPCs use the same breath-based timing concepts rather than a separate combat movement scheduler.
- [ ] Timed-event movement pacing can scale through the same general throttle model already used in free roam.
- [ ] No second locomotion or turn scheduler is introduced for the same niche.
- [ ] Actors and NPCs that can act are exposed to comparable physics-breath opportunity during their timed turns.

## Concrete Scenario Tests

These are the scenario-level checks that should keep implementation honest.

### Scenario A - Free-Roam Baseline

- [ ] In free roam, the player can move continuously with held input.
- [ ] In free roam, the player can click-to-move without turn-based rejection.
- [ ] In free roam, `INSPECT` and `USE` still function through their normal action path.

### Scenario B - Timed Event Triggers

- [ ] Multiple participants talking can trigger a timed event.
- [ ] A hostile or injurious `USE` can trigger a timed event.
- [ ] The debug timed-event button can trigger a timed event during development.
- [ ] The timed event establishes an active actor.
- [ ] Initiative is rolled at timed-event start to determine who acts first.
- [ ] A non-active participant is rejected for acting out of turn.

### Scenario C - Timed Movement Depletion

- [ ] The active actor can move until timed-event movement is exhausted.
- [ ] Once exhausted, direct input no longer advances the actor.
- [ ] Once exhausted, click-follow no longer advances the actor.
- [ ] The actor does not crash, snap, or desync when movement is exhausted.
- [ ] The actor's movement opportunity is spread across the turn window rather than spent in one burst.

### Scenario D - MOVE Refresh

- [ ] After movement is exhausted, `MOVE` as a `FULL` action restores movement capacity.
- [ ] The actor can then move again using the normal breath runtime.
- [ ] The actor cannot continue taking unrelated extra actions if action economy is also exhausted.

### Scenario E - Airborne / Unsupported Resolution

- [ ] In a timed event, an unsupported actor or NPC still falls even when control movement is depleted.
- [ ] Suppression prevents control steering, not physics resolution.

### Scenario F - NPC Parallelism

- [ ] NPC timed-event movement uses the same general breath pacing concepts as free roam.
- [ ] NPCs do not require a separate combat-only movement scheduler to participate in timed events.
- [ ] NPCs and actors with turns get comparable turn-window breath exposure for movement.

### Scenario G - Inspect And Use Costs

- [ ] In free roam, `INSPECT` spends a `FULL` action according to the first-pass runtime rule.
- [ ] In a timed event, `INSPECT` respects the chosen cost mode from the UI/control path.
- [ ] A `USE` interaction that is defined as movement-cost spends movement from the same pool used for moving.
- [ ] A `USE` interaction can still resolve without a roll when the interaction rules do not require one.
- [ ] A `PARTIAL` `INSPECT` or `USE` roll uses only the natural outcome.
- [ ] A `PARTIAL` `INSPECT` or `USE` roll does not gain positive modifiers for the acting entity.
- [ ] A `PARTIAL` `INSPECT` or `USE` roll still suffers negative modifiers where applicable.
- [ ] A `FULL` `INSPECT` or `USE` roll can apply modifiers.

### Scenario H - Communication Does Not Regress

- [ ] `COMMUNICATE`-driven witness/conversation behavior still works while action-economy work is added.
- [ ] Covered communication response cases no longer depend on interface-side fallback heuristics once witness logic is sufficient.

## Open Design Questions

- [ ] How much baseline movement budget should an entity start a timed turn with before using `MOVE`?
- [ ] Should `MOVE` refill all movement modes, or only the currently relevant movement mode?
- [ ] Should path-following spend the same timed-event movement budget as held direct input with identical suppression rules?
- [ ] How should action and movement economy be surfaced to the player in the UI during timed events?
- [ ] Which existing movement budget fields should be reused directly, and which should remain free-roam-only tuning fields?
- [ ] Which pieces of `src/turn_manager/validator.ts` should survive as live code versus documentation/policy reference?

## Definition Of Done

This plan is complete when all of the following are true:

- Timed-event action permission is real for `MOVE`, `INSPECT`, `USE`, and `COMMUNICATE`.
- Timed-event movement depletion suppresses control movement while still allowing gravity/falling.
- `MOVE` as a `FULL` action meaningfully restores timed-event movement capacity.
- Free-roam movement still runs on breaths and remains responsive.
- The action pipeline, turn ownership, movement suppression, and witness broadcasting all feel like parts of the same gameplay system rather than parallel systems.
- Duplicate turn advancement and duplicate communication scheduling paths are removed or clearly marked as temporary migration scaffolding with explicit deletion targets.

# LLM Readability Hardening Plan
## Contracts, Observability, Build Health, and Evals

Date: 2026-02-12

This plan focuses on making the project easier for humans and LLM agents to understand, change safely, and debug quickly.

Progress checklist:
- [x] Contracts created (`docs/contracts/*.md`)
- [x] Build health restored (`npm run build` green)
- [x] Add typecheck + eval scripts (package.json)
- [x] Add minimal conversation lifecycle eval
- [x] Action system integration eval runnable + passing
- [x] Observability: structured events (key modules migrated)
- [x] Legacy cleanup: remaining legacy modules clearly marked or removed

Scope priorities (aligned to current needs):
- Contracts: make cross-process state ownership explicit.
- Build health: stop flying blind with a permanently-red `tsc`.
- Observability: replace log spam with structured, transition-level events.
- Evals: add small, repeatable regression checks for conversation behaviors.
- Legacy cleanup: eliminate duplicate pathways and “ghost” modules.

Non-goals (explicitly deferred):
- Automatic invariant healing beyond basic warnings (we can debug/expand later).
- Deepening conversation content quality (this plan lays the rails; later plans can expand).

---

## 1) Contracts (Source Of Truth + Ownership)

Goal: Any engineer/agent can answer “where does truth live?” in under 60 seconds.

Deliverables:
- Add a single canonical contract document that defines:
  - Message envelope (`outbox.jsonc` entries): `id`, `stage`, `status`, `sender`, `recipient`, `created_at`, `content`.
  - Movement command contract: `movement_command` payloads and required fields.
  - Conversation logic contract (backend): `conversation_state` + `witness_handler` responsibilities.
  - Conversation visual contract (renderer): `NPC_STATUS busy/present` as the sync channel.
  - Conversation exit contract: "bye" and leaving place end the session.

Status:
- [x] `docs/contracts/message_bus.md`
- [x] `docs/contracts/conversation.md`
- [x] `docs/contracts/movement.md`

Notes:
- Keep the docs short and opinionated. Prefer tables and explicit “owner” columns.

---

## 2) Observability (Structured Events, Not Spam)

Goal: Logs should read like a trace, not a firehose.

Rules:
- Log only transitions and important edges (enter/exit conversation, status flips, place transitions).
- Include stable keys in every log event:
  - `event`, `npc_ref`, `actor_ref`, `place_id`, `reason`, `msg_id` (if present).
- No per-frame/per-tick console spam.

Implementation steps:
- Create a small helper for structured debug events (backend + renderer):
  - `debug_event(component, event_name, fields)` -> routes to existing `debug_log`.
- Convert the noisiest modules first:
  - `src/npc_ai/witness_handler.ts`
  - `src/mono_ui/modules/movement_command_handler.ts`

Status:
- [x] `src/shared/debug_event.ts`
- [x] `src/npc_ai/witness_handler.ts` (key transitions)
- [x] `src/mono_ui/modules/movement_command_handler.ts` (status + lifecycle)
- [x] `src/action_system/pipeline.ts` + `src/action_system/perception.ts` (structured action/perception trace)

Acceptance:
- A single conversation produces a small, consistent sequence of log events.

---

## 3) Build Health (Make `tsc` Meaningful Again)

Goal: “green build” becomes the default, so changes are trustworthy.

Approach options (pick one and enforce it):
1) Fix the existing TypeScript errors (preferred, but may take time).
2) Introduce a temporary “strict surface” build that only typechecks critical folders:
   - `src/npc_ai/**`, `src/mono_ui/**`, `src/action_system/**`, `src/engine/**`
   - Leave other legacy modules for incremental cleanup.

Deliverables:
- Add `npm run typecheck:core` (or similar) that is expected to pass.
- Document the policy in `docs/guides/DEVELOPER_GUIDE.md`.

Status:
- [x] `npm run build` is green
- [x] `npm run typecheck`
- [x] `npm run typecheck:core`

---

## 4) Evals / Regression Harness (System-Level Checks)

Goal: Catch behavioral regressions without relying on manual playtesting.

Add a small eval runner that can validate system outcomes:
- Conversation lifecycle:
  - `hello` -> NPC_STATUS busy
  - `bye` -> NPC_STATUS present
  - silence -> timeout -> present
  - leaving place -> present
- Multi-NPC sanity:
  - two NPCs can be busy independently

Implementation direction:
- Prefer deterministic “simulation” tests that stub time and outbox writes.
- Start by extending `src/tests/action_system_integration.test.ts` or adding a new test module.

Status:
- [x] `scripts/evals/conversation_lifecycle.ts`
- [x] `npm run eval:action_system`
- [x] `npm run eval`

---

## 5) Legacy Cleanup (Remove Duplicate Paths)

Goal: One way to do each thing.

Checklist:
- Remove or clearly mark legacy/unused modules:
  - `src/npc_ai/witness_integration.ts` usage still exists (movement engine references). Decide whether to:
    - port needed pieces into `witness_handler`, or
    - formally keep it as “movement perception only”, or
    - archive it.
- Ensure `npc_ai/main.ts` and ActionPipeline do not double-trigger witness logic.

Acceptance:
- Only one path starts/ends conversations.

Status:
- [x] Conversation start/end owned by witness_handler (per contracts)
- [x] `src/npc_ai/witness_integration.ts` marked legacy; renderer-safe movement perception moved to `src/npc_ai/movement_perception.ts`

---

## Phase Plan (Suggested Execution)

Phase 0 (Today):
- Add the contract docs (short, canonical).
- Add `typecheck:core` (even if full `build` is still red).

Phase 1:
- Introduce `debug_event` helper.
- Convert witness + movement handler to structured transition logs.

Phase 2:
- Add eval harness for conversation lifecycle.
- Run it in dev scripts.

Phase 3:
- Reduce remaining TS errors until full `tsc` is green.

---

## Definition Of Done

- A new contributor can:
  - find the contracts quickly,
  - reproduce the core conversation lifecycle,
  - and trust `typecheck:core` + evals to catch regressions.

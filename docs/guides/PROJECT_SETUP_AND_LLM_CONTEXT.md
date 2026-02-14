# Project Setup + LLM Context Guide

This repo is designed to be worked on by humans and LLM agents without needing “tribal knowledge”. The trick is keeping a single source of truth for *what to do next* (plans) and a small, stable set of docs for *how the system works* (design/specs/contracts).

## What To Read (In Order)

1. `docs/INDEX.md` (navigation + what’s current)
2. `docs/design/ARCHITECTURE.md` (current build flow vs legacy)
3. `docs/design/SERVICES.md` + `docs/design/STAGES.md` (interfaces + message routing)
4. `docs/contracts/message_bus.md` (envelopes + renderer command types)
5. If working on NPC interaction: `docs/guides/NPC_WITNESS_SYSTEM.md`

## Suggested “Context Bundle” (Copy/Paste List)

- `docs/INDEX.md`
- `docs/design/ARCHITECTURE.md`
- `docs/design/SERVICES.md`
- `docs/design/STAGES.md`
- `docs/contracts/message_bus.md`
- `docs/plans/README.md`
- The single active plan you are executing (one file from `docs/plans/`)

## How Plans Work (Single Source of Truth)

- Active work lives in `docs/plans/`.
- Plans use the checkbox legend: `[ ] not_started`, `[~] implemented`, `[x] tested`.
- If you discover something while implementing, update the plan that owns it (or create a new dated plan).
- Avoid build logs: if it matters, capture it as a plan TODO + a short rationale.

## What To Avoid Feeding an LLM

- `docs/archive/` (historical)
- `docs/analysis/` (preserved retrospectives; useful for debugging, not for “current truth”)
- Old pipeline descriptions that assume `interpreter_ai` is live (it’s archived in this build)

## Local Workflow (Slot 1)

- Use `local_data/data_slot_1/` for testing.
- Start dev: `npm run dev`
- Primary runtime truth is the ActionPipeline in `interface_program`; cross-process coordination happens via inbox/outbox JSONC.

## When You Need More Context

- Open the active plan you’re executing and stay inside it.
- If you hit a surprising behavior, add a small note to `docs/analysis/` (dated filename), then link that note from the plan.

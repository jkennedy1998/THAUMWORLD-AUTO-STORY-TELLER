# Prompt Context Architecture

## Purpose

THAUMWORLD now routes live NPC dialogue prompt data through a localized prompt-context layer instead of assembling prompt facts ad hoc in multiple places.

This layer exists to:

- keep prompt data grounded in actual game state
- make prompt context deterministic and debuggable
- support reuse across dialogue, inspect, place narration, and future service/quest systems
- reduce reliance on model training priors by feeding curated world facts

## Current Flow

For NPC dialogue, `src/npc_ai/main.ts` now:

1. gathers high-level runtime inputs
2. calls `build_dialogue_prompt_context(...)`
3. passes selected context into `build_npc_dialogue_prompts(...)`
4. sends the final rendered prompt to the dialogue model

`src/npc_ai/prompts.ts` is now primarily a renderer, not a discovery layer.

## Prompt-Context Modules

Located in `src/context_manager/prompt_context/`:

- `types.ts`
  - shared prompt-context input/output types
- `utils.ts`
  - normalization, hashing, keyword extraction helpers
- `selector.ts`
  - deterministic selection/culling logic
- `character_context.ts`
  - personality and NPC-identity candidate facts
- `conversation_context.ts`
  - transcript, summary, factoid, and long-term memory candidates
- `place_context.ts`
  - grounded same-place context from characters, items, containers, and structures
- `dialogue_context.ts`
  - orchestrator that combines provider outputs and applies per-situation budgets

## Grounding Rules

Prompt context should prefer actual world state in this order:

1. active conversation transcript and summary
2. participant factoids and relevant memories
3. NPC-specific identity and personality fields
4. same-place grounded world context
   - nearby characters
   - nearby items / containers
   - nearby structures / features
5. place summary context

The system should avoid relying on generic lore flavor when concrete room state is available.

## Deterministic Selection

Selection is currently deterministic, not LLM-driven.

The selector uses seed inputs such as:

- `conversation_id`
- `npc_ref`
- `player_ref`
- `template_situation`
- `player_text`

This allows:

- reproducible debugging
- stable but varied prompt composition
- prompt diversity without nondeterministic context drift

## Exported Reusable APIs

Current reusable place-context APIs:

- `get_nearby_surroundings(...)`
- `get_place_summary(...)`

These currently return deterministic fact batches grounded in actual place state.

## Current NPC Dialogue Usage

The live NPC dialogue path currently consumes selected:

- personality lines
- world lines
- memory context
- transcript summary
- participant factoids
- transcript recent turns
- place summary lines
- location names

This data is logged in `NPC_AI` prompt-context debug output so conversation shaping can be inspected turn by turn.

## Near-Term Growth

This layer is intended to expand into shared prompt infrastructure for:

- inspect narration
- place summaries
- lore surfacing
- quest/service/shop systems
- future deterministic or LLM-assisted context selectors

## Important Constraint

This layer should remain a **fact selection** layer.

It should:

- gather and cull context
- expose structured prompt-ready facts

It should not:

- generate final dialogue
- own conversation truth
- replace session/queue canonical state

Canonical conversation truth still lives in session state.

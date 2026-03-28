import type { DialoguePromptContextParams, DialoguePromptContextSelection } from "./types.js";
import { build_personality_candidates } from "./character_context.js";
import { build_memory_candidates, select_transcript_recent } from "./conversation_context.js";
import { build_place_candidates, build_place_summary_candidates } from "./place_context.js";
import { select_deterministic } from "./selector.js";
import { extract_keywords, safe_text } from "./utils.js";

export function build_dialogue_prompt_context(params: DialoguePromptContextParams): DialoguePromptContextSelection {
    const keywords = extract_keywords(params.player_text);
    const seed_key = [
        params.conversation_id,
        params.npc_ref,
        params.player_ref,
        params.template_situation ?? "none",
        params.player_text,
    ].join("|");

    const personality_candidates = build_personality_candidates(params.npc);
    const world_candidates = build_place_candidates(params);
    const place_summary_candidates = build_place_summary_candidates(params);
    const memory_candidates = build_memory_candidates(params);
    const transcript_recent = select_transcript_recent(params);
    const transcript_summary = safe_text(params.speech_turn_context?.transcript_summary);
    const selected_factoids = select_deterministic(
        Array.isArray(params.speech_turn_context?.memory_factoids_for_participant)
            ? params.speech_turn_context!.memory_factoids_for_participant.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            : [],
        `${seed_key}:factoids`,
        keywords,
        params.template_situation === "mid_conversation" ? 3 : 2,
    );

    const personality_budget = params.template_situation === "mid_conversation" ? 2 : 3;
    const world_budget = params.template_situation === "goodbye" ? 1 : 2;
    const memory_budget = params.template_situation === "mid_conversation" ? 3 : 2;
    const place_summary_budget = params.template_situation === "mid_conversation" ? 1 : 2;
    const selected_memory_lines = select_deterministic(memory_candidates, `${seed_key}:memory`, keywords, memory_budget);
    const selected_place_summary_lines = select_deterministic(place_summary_candidates, `${seed_key}:place_summary`, keywords, place_summary_budget);
    const memory_context = selected_memory_lines.join("\n");
    const place_name = safe_text(params.place?.name) || "unknown";

    return {
        personality_lines: select_deterministic(personality_candidates, `${seed_key}:personality`, keywords, personality_budget),
        world_lines: select_deterministic(world_candidates, `${seed_key}:world`, keywords, world_budget),
        memory_context,
        transcript_summary,
        participant_factoids: selected_factoids,
        transcript_recent,
        npc_location_name: place_name,
        player_location_name: place_name,
        place_summary_lines: selected_place_summary_lines,
        debug: {
            seed_key,
            personality_candidates: personality_candidates.length,
            world_candidates: world_candidates.length,
            memory_candidates: memory_candidates.length,
            place_summary_candidates: place_summary_candidates.length,
            selected_memory_count: Math.min(memory_candidates.length, memory_budget),
            selected_personality_count: Math.min(personality_candidates.length, personality_budget),
            selected_world_count: Math.min(world_candidates.length, world_budget),
            selected_place_summary_count: Math.min(place_summary_candidates.length, place_summary_budget),
        },
    };
}

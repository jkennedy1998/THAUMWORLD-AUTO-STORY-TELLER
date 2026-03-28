import { get_memories_about } from "../../npc_storage/memory.js";
import type { DialoguePromptContextParams } from "./types.js";
import { safe_text } from "./utils.js";

export function build_memory_candidates(params: DialoguePromptContextParams): string[] {
    const candidates: string[] = [];
    const transcript_summary = safe_text(params.speech_turn_context?.transcript_summary);
    if (transcript_summary) candidates.push(`Shared summary: ${transcript_summary}`);

    const factoids = Array.isArray(params.speech_turn_context?.memory_factoids_for_participant)
        ? params.speech_turn_context!.memory_factoids_for_participant.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        : [];
    for (const fact of factoids) {
        candidates.push(`What you remember: ${fact}`);
    }

    const all_memories = get_memories_about(params.slot, params.npc_ref, params.player_ref, { limit: 10 });
    for (const memory of all_memories) {
        if (memory.conversation_id === params.conversation_id) continue;
        const summary = safe_text(memory.summary);
        if (summary) candidates.push(`Recall: ${summary}`);
    }

    return candidates;
}

export function select_transcript_recent(params: DialoguePromptContextParams): Array<{ speaker_ref: string; text: string }> {
    const recent = Array.isArray(params.speech_turn_context?.transcript_recent) ? params.speech_turn_context!.transcript_recent : [];
    return recent.slice(-6).map((turn) => ({
        speaker_ref: safe_text(turn?.speaker_ref) || "unknown",
        text: safe_text(turn?.text),
    })).filter((turn) => turn.text.length > 0);
}

import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { SERVICE_CONFIG } from "../shared/constants.js";
import { get_configured_data_slot } from "../shared/boot_env.js";

type RelationshipStatus = "friendly" | "hostile" | "neutral" | "unknown";

const data_slot_number = get_configured_data_slot();

type NpcDialoguePromptParams = {
    npc: any;
    player_text: string;
    can_perceive: boolean;
    memory_context?: string;
    conversation_mode?: string;
    social_role?: string;
    transcript_recent?: Array<{ speaker_ref: string; text: string }>;
    transcript_summary?: string;
    participant_factoids?: string[];
    player_location_name?: string;
    npc_location_name?: string;
    relationship_status?: RelationshipStatus;
    relationship_memory_count?: number;
    template_situation?: string;
    template_context_lines?: string[];
    template_examples?: string[];
    response_constraints?: string[];
    selected_personality_lines?: string[];
    selected_world_lines?: string[];
    selected_place_summary_lines?: string[];
};

type PromptPair = { system: string; user: string };

function safe_text(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function get_speaker_display_name(speaker_ref: string): string {
    const ref = safe_text(speaker_ref);
    if (ref.startsWith("npc.")) {
        const result = load_npc(data_slot_number, ref.slice(4));
        if (result.ok) {
            const name = safe_text((result.npc as any)?.name);
            if (name) return name;
        }
        return "Unknown NPC";
    }
    if (ref.startsWith("actor.")) {
        const result = load_actor(data_slot_number, ref.slice(6));
        if (result.ok) {
            const name = safe_text((result.actor as any)?.name);
            if (name) return name;
        }
        return "Unknown Actor";
    }
    return ref || "unknown";
}

export function build_npc_dialogue_prompts(params: NpcDialoguePromptParams): PromptPair {
    const npc_name = safe_text(params.npc?.name) || "Unknown NPC";
    const title = safe_text(params.npc?.title);
    const features = safe_text(params.npc?.appearance?.distinguishing_features);
    const personality_lines = Array.isArray(params.selected_personality_lines) ? params.selected_personality_lines : [];
    const lore_lines = Array.isArray(params.selected_world_lines) ? params.selected_world_lines : [];
    const relationship = params.relationship_status ?? "unknown";
    const relationship_memories = Number.isFinite(params.relationship_memory_count)
        ? Math.max(0, Math.floor(params.relationship_memory_count as number))
        : 0;
    const place_summary_lines = Array.isArray(params.selected_place_summary_lines) && params.selected_place_summary_lines.length > 0
        ? params.selected_place_summary_lines
        : [];

    const system = [
        "You are roleplaying a tabletop NPC in THAUMWORLD.",
        "Stay fully in character and grounded in immediate scene truth.",
        "Never mention game mechanics, prompts, tokens, or being an AI.",
        "Use short natural dialogue unless the user clearly asks for detail.",
        "Treat memories as subjective recollection, not perfect objective records.",
        "Answer the speaker's actual point directly before adding flavor.",
        "Prefer spoken dialogue over narrated gestures or stage directions.",
    ].join("\n");

    const user_lines: string[] = [];
    user_lines.push(`NPC Identity: ${npc_name}${title ? `, ${title}` : ""}`);
    if (features && params.can_perceive) user_lines.push(`Visible features: ${features}`);
    if (personality_lines.length > 0) {
        user_lines.push("Personality:");
        for (const line of personality_lines) user_lines.push(`- ${line}`);
    }

    const npc_loc = safe_text(params.npc_location_name) || "unknown";
    const player_loc = safe_text(params.player_location_name) || "unknown";
    if (npc_loc !== "unknown" || player_loc !== "unknown") {
        user_lines.push(`Location context: you are in ${npc_loc}; speaker location is ${player_loc}.`);
    }

    if (place_summary_lines.length > 0) {
        user_lines.push("Place summary:");
        for (const line of place_summary_lines) user_lines.push(`- ${line}`);
    }

    user_lines.push(`Relationship stance toward speaker: ${relationship} (based on ${relationship_memories} memories).`);

    if (!params.can_perceive) {
        user_lines.push("Perception constraint: you cannot perceive the speaker clearly right now.");
    }

    if (lore_lines.length > 0) {
        user_lines.push("Grounded world context:");
        for (const lore of lore_lines) user_lines.push(`- ${lore}`);
    }

    if (params.memory_context && params.memory_context.trim().length > 0) {
        user_lines.push("Memory context:");
        user_lines.push(params.memory_context.trim());
    }

    if (params.conversation_mode) {
        user_lines.push(`Conversation mode: ${params.conversation_mode}`);
    }
    if (params.social_role) {
        user_lines.push(`Your social role in this reply: ${params.social_role}`);
    }
    if (params.template_situation) {
        user_lines.push(`Reply situation: ${params.template_situation}`);
    }
    if (Array.isArray(params.template_context_lines) && params.template_context_lines.length > 0) {
        user_lines.push("Reply guidance:");
        for (const line of params.template_context_lines.slice(0, 5)) {
            const text = safe_text(line);
            if (text) user_lines.push(`- ${text}`);
        }
    }
    if (Array.isArray(params.response_constraints) && params.response_constraints.length > 0) {
        user_lines.push("Constraints:");
        for (const line of params.response_constraints.slice(0, 4)) {
            const text = safe_text(line);
            if (text) user_lines.push(`- ${text}`);
        }
    }
    if (Array.isArray(params.template_examples) && params.template_examples.length > 0) {
        user_lines.push("Voice examples for tone only (do not copy them exactly):");
        for (const line of params.template_examples.slice(0, 3)) {
            const text = safe_text(line);
            if (text) user_lines.push(`- ${text}`);
        }
    }
    if (params.transcript_summary && params.transcript_summary.trim().length > 0) {
        user_lines.push("Conversation summary so far:");
        user_lines.push(params.transcript_summary.trim());
    }
    if (Array.isArray(params.participant_factoids) && params.participant_factoids.length > 0) {
        user_lines.push("What you particularly remember:");
        for (const fact of params.participant_factoids.slice(-4)) {
            const text = safe_text(fact);
            if (text) user_lines.push(`- ${text}`);
        }
    }
    if (Array.isArray(params.transcript_recent) && params.transcript_recent.length > 0) {
        user_lines.push("Most recent conversation turns:");
        for (const line of params.transcript_recent.slice(-6)) {
            const speaker = get_speaker_display_name(safe_text(line?.speaker_ref));
            const text = safe_text(line?.text);
            if (text) user_lines.push(`- ${speaker}: ${text}`);
        }
    }

    user_lines.push(`Player says: "${params.player_text}"`);
    user_lines.push("Respond with 1-3 sentences in your own voice.");
    user_lines.push("If this is an ongoing exchange, continue it instead of restarting it.");
    user_lines.push("If the speaker asks for something concrete, address that concrete thing first.");
    user_lines.push("Use gesture or physical action only if it genuinely helps the line; otherwise keep the reply as spoken dialogue.");
    user_lines.push("If uncertain, ask one grounded follow-up question instead of inventing facts.");

    return {
        system,
        user: user_lines.join("\n"),
    };
}

export function build_turn_summary_prompts(params: {
    npc_name: string;
    npc_personality: string;
    existing_summary: string;
    conversation_text: string;
}): PromptPair {
    const system = "You are summarizing recent dialogue from an NPC's first-person perspective for tabletop memory continuity.";
    const user = [
        `NPC: ${params.npc_name}`,
        params.npc_personality ? `Personality: ${params.npc_personality}` : "",
        params.existing_summary ? `Previous summary: ${params.existing_summary}` : "",
        "New exchanges:",
        params.conversation_text,
        "",
        "Write one sentence in first person about what matters most and how you feel.",
        "Keep concrete names/promises/threats. No meta commentary.",
    ].filter(Boolean).join("\n");
    return { system, user };
}

export function build_memory_journal_prompts(params: {
    npc_id: string;
    npc_name: string;
    npc_personality: Record<string, unknown>;
    mode: "consolidate" | "conversation" | "timed_event";
    region_label?: string;
    conversation_id?: string | null;
    event_id?: string;
    event_type?: string;
    participants?: string[];
    transcript?: string;
    events_text?: string;
    entries?: string[];
    consolidate_target?: number;
}): PromptPair {
    if (params.mode === "consolidate") {
        const system = "You are an NPC condensing your personal memory journal while preserving voice and motive.";
        const user = [
            `NPC: ${params.npc_name} (id=${params.npc_id})`,
            "Personality:",
            JSON.stringify(params.npc_personality ?? {}, null, 2),
            "",
            `You have ${(params.entries ?? []).length} journal entries. Consolidate to at most ${params.consolidate_target ?? 12} entries.`,
            "Each entry should be 1-4 sentences and keep first-person perspective when describing your own feelings.",
            "Return ONLY valid JSON: an array of strings.",
            "",
            "Journal entries:",
            (params.entries ?? []).map((e, i) => `Entry ${i + 1}: ${e}`).join("\n\n"),
        ].join("\n");
        return { system, user };
    }

    if (params.mode === "conversation") {
        const system = "You are an NPC writing a memory journal entry in character for a tabletop campaign.";
        const user = [
            `NPC: ${params.npc_name} (id=${params.npc_id})`,
            `Location: ${params.region_label ?? "(unknown region)"}`,
            params.conversation_id ? `Conversation: ${params.conversation_id}` : "",
            "",
            "Personality:",
            JSON.stringify(params.npc_personality ?? {}, null, 2),
            "",
            "Transcript:",
            params.transcript ?? "",
            "",
            "In 2-5 sentences, write what YOU would remember.",
            "Focus on motives, promises, threats, impressions, and unresolved hooks.",
            "Do NOT use the word 'player'. Use actor.<id>/npc.<id> labels when known.",
            "Return plain text only.",
        ].filter(Boolean).join("\n");
        return { system, user };
    }

    const system = "You are an NPC writing a personal memory of a timed event. Stay in character and pragmatic.";
    const user = [
        `NPC: ${params.npc_name} (id=${params.npc_id})`,
        `Event: ${params.event_type ?? "event"} (${params.event_id ?? "unknown"})`,
        `Location: ${params.region_label ?? "(unknown region)"}`,
        `Participants: ${(params.participants ?? []).join(", ")}`,
        "",
        "Personality:",
        JSON.stringify(params.npc_personality ?? {}, null, 2),
        "",
        "Observed events:",
        params.events_text ?? "",
        "",
        "In 2-5 sentences, write what YOU would remember.",
        "Prioritize tactical and social relevance: who threatened whom, who helped, what promises were made, what to do next.",
        "Do NOT use the word 'player'. Use actor.<id>/npc.<id> labels when known.",
        "Return plain text only.",
    ].join("\n");
    return { system, user };
}

export function build_conversation_summary_prompts(params: {
    npc_name: string;
    npc_personality: string;
    formatted_conversation: string;
    place_name?: string;
    lore_lines?: string[];
}): PromptPair {
    const system = "You are a tabletop narrative archivist writing from one NPC's in-world perspective.";
    const user = [
        `NPC: ${params.npc_name}`,
        params.npc_personality ? `Personality: ${params.npc_personality}` : "",
        params.place_name ? `Location: ${params.place_name}` : "",
        params.lore_lines && params.lore_lines.length > 0 ? "Context lore:\n" + params.lore_lines.map((l) => `- ${l}`).join("\n") : "",
        "",
        "Conversation log:",
        params.formatted_conversation,
        "",
        "Return the exact required schema sections:",
        "MEMORY:",
        "EMOTION:",
        "LEARNED:",
        "DECIDED:",
        "RELATIONSHIPS:",
        "",
        "Keep it concise and in character. Preserve commitments, threats, trade terms, and relationship shifts.",
    ].filter(Boolean).join("\n");
    return { system, user };
}

type RelationshipStatus = "friendly" | "hostile" | "neutral" | "unknown";

type NpcDialoguePromptParams = {
    npc: any;
    player_text: string;
    can_perceive: boolean;
    memory_context?: string;
    player_location_name?: string;
    npc_location_name?: string;
    relationship_status?: RelationshipStatus;
    relationship_memory_count?: number;
    place?: any;
    region?: any;
};

type PromptPair = { system: string; user: string };

function safe_text(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

function extract_keywords(text: string): string[] {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4);
    const dedup = Array.from(new Set(words));
    return dedup.slice(0, 12);
}

function score_line(line: string, keywords: string[]): number {
    if (!line) return 0;
    const lower = line.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
        if (lower.includes(kw)) score += 2;
    }
    if (score === 0 && /rumor|secret|history|danger|guard|tavern|trade|road|shrine/.test(lower)) {
        score = 1;
    }
    return score;
}

function pick_relevant(lines: string[], query: string, max_items: number): string[] {
    const keywords = extract_keywords(query);
    const scored = lines
        .map((line) => ({ line: line.trim(), score: score_line(line, keywords) }))
        .filter((x) => x.line.length > 0)
        .sort((a, b) => b.score - a.score);
    const picked = scored.slice(0, max_items).map((x) => x.line);
    return Array.from(new Set(picked));
}

function build_lore_shards(player_text: string, place: any, region: any): string[] {
    const lore_candidates: string[] = [];

    const place_name = safe_text(place?.name);
    const place_short = safe_text(place?.description?.short);
    const place_full = safe_text(place?.description?.full);
    const place_sight = Array.isArray(place?.description?.sensory?.sight) ? place.description.sensory.sight : [];
    const place_sound = Array.isArray(place?.description?.sensory?.sound) ? place.description.sensory.sound : [];

    if (place_name) lore_candidates.push(`Place: ${place_name}`);
    if (place_short) lore_candidates.push(`Local detail: ${place_short}`);
    if (place_full) lore_candidates.push(`Local detail: ${place_full}`);
    for (const s of place_sight.slice(0, 3)) lore_candidates.push(`Seen nearby: ${safe_text(s)}`);
    for (const s of place_sound.slice(0, 2)) lore_candidates.push(`Heard nearby: ${safe_text(s)}`);

    const region_name = safe_text(region?.name);
    const region_atmosphere = safe_text(region?.description?.atmosphere);
    const region_history = safe_text(region?.lore?.history);
    const region_rumors = Array.isArray(region?.lore?.rumors) ? region.lore.rumors : [];
    const region_events = Array.isArray(region?.state?.current_events) ? region.state.current_events : [];

    if (region_name) lore_candidates.push(`Region: ${region_name}`);
    if (region_atmosphere) lore_candidates.push(`Atmosphere: ${region_atmosphere}`);
    if (region_history) lore_candidates.push(`History: ${region_history}`);
    for (const r of region_rumors.slice(0, 4)) lore_candidates.push(`Rumor: ${safe_text(r)}`);
    for (const e of region_events.slice(0, 3)) lore_candidates.push(`Current event: ${safe_text(e)}`);

    return pick_relevant(lore_candidates, player_text, 4);
}

function build_personality_card(npc: any, player_text: string): string[] {
    const personality = (npc?.personality ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    const goal = safe_text(personality.story_goal);
    const passion = safe_text(personality.passion);
    const flaw = safe_text(personality.flaw);
    const fear = safe_text(personality.fear);
    const happy = safe_text(personality.happy_triggers);
    const angry = safe_text(personality.angry_triggers);
    const lower = player_text.toLowerCase();

    if (goal && safe_text(npc?.role) !== "villager") lines.push(`Goal: ${goal}`);
    if (passion && (lower.includes(passion.toLowerCase()) || Math.random() < 0.25)) lines.push(`Passion: ${passion}`);
    if (flaw) lines.push(`Flaw: ${flaw}`);
    if (fear && (lower.includes("fear") || lower.includes("afraid") || lower.includes("threat"))) lines.push(`Fear: ${fear}`);
    if (happy && lower.includes(happy.toLowerCase())) lines.push(`Positive trigger: ${happy}`);
    if (angry && lower.includes(angry.toLowerCase())) lines.push(`Negative trigger: ${angry}`);

    return lines.slice(0, 5);
}

export function build_npc_dialogue_prompts(params: NpcDialoguePromptParams): PromptPair {
    const npc_name = safe_text(params.npc?.name) || "Unknown NPC";
    const title = safe_text(params.npc?.title);
    const features = safe_text(params.npc?.appearance?.distinguishing_features);
    const personality_lines = build_personality_card(params.npc, params.player_text);
    const lore_lines = build_lore_shards(params.player_text, params.place, params.region);
    const relationship = params.relationship_status ?? "unknown";
    const relationship_memories = Number.isFinite(params.relationship_memory_count)
        ? Math.max(0, Math.floor(params.relationship_memory_count as number))
        : 0;

    const system = [
        "You are roleplaying a tabletop NPC in THAUMWORLD.",
        "Stay fully in character and grounded in immediate scene truth.",
        "Never mention game mechanics, prompts, tokens, or being an AI.",
        "Use short natural dialogue unless the user clearly asks for detail.",
        "Treat memories as subjective recollection, not perfect objective records.",
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

    user_lines.push(`Relationship stance toward speaker: ${relationship} (based on ${relationship_memories} memories).`);

    if (!params.can_perceive) {
        user_lines.push("Perception constraint: you cannot perceive the speaker clearly right now.");
    }

    if (lore_lines.length > 0) {
        user_lines.push("Relevant setting lore:");
        for (const lore of lore_lines) user_lines.push(`- ${lore}`);
    }

    if (params.memory_context && params.memory_context.trim().length > 0) {
        user_lines.push("Memory context:");
        user_lines.push(params.memory_context.trim());
    }

    user_lines.push(`Player says: "${params.player_text}"`);
    user_lines.push("Respond with 1-3 sentences in your own voice.");
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

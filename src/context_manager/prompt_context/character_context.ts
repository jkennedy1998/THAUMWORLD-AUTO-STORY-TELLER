import { safe_text } from "./utils.js";

export function build_personality_candidates(npc: any): string[] {
    const personality = (npc?.personality ?? {}) as Record<string, unknown>;
    const candidates: string[] = [];
    const pairs: Array<[string, unknown]> = [
        ["Goal", personality.story_goal],
        ["Passion", personality.passion],
        ["Flaw", personality.flaw],
        ["Fear", personality.fear],
        ["Hobby", personality.hobby],
        ["Positive trigger", personality.happy_triggers],
        ["Sad trigger", personality.sad_triggers],
        ["Negative trigger", personality.angry_triggers],
        ["Temptation", personality.temptations],
    ];
    for (const [label, value] of pairs) {
        const text = safe_text(value);
        if (text) candidates.push(`${label}: ${text}`);
    }

    const lore_backstory = safe_text(npc?.lore?.backstory);
    if (lore_backstory) candidates.push(`Backstory: ${lore_backstory}`);
    const lore_relationship = safe_text(npc?.lore?.relationship);
    if (lore_relationship) candidates.push(`Personal life: ${lore_relationship}`);
    const services = Array.isArray(npc?.services_offered) ? npc.services_offered.filter((entry: unknown) => typeof entry === "string") : [];
    if (services.length > 0) candidates.push(`Known for: ${services.slice(0, 4).join(", ")}`);
    const knowledge = Array.isArray(npc?.regional_knowledge) ? npc.regional_knowledge.filter((entry: unknown) => typeof entry === "string") : [];
    if (knowledge.length > 0) candidates.push(`Local knowledge: ${knowledge.slice(0, 4).join(", ")}`);
    return candidates;
}

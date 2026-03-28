export type ConversationFallbackSituation = "first_communication" | "mid_conversation" | "goodbye";

const fallbackLines: Record<ConversationFallbackSituation, string[]> = {
    first_communication: [
        "Yeah?",
        "What is it?",
        "Go on.",
    ],
    mid_conversation: [
        "I hear you.",
        "Maybe.",
        "Say that again, plainly.",
    ],
    goodbye: [
        "Right, then.",
        "Take care.",
        "Until next time.",
    ],
};

export function get_fallback_dialogue(situation: ConversationFallbackSituation): string {
    const lines = fallbackLines[situation] ?? fallbackLines.first_communication;
    const index = Math.floor(Math.random() * lines.length);
    return lines[index] ?? lines[0] ?? "Hmm.";
}

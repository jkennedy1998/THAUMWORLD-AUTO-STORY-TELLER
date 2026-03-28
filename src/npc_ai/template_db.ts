import type { ActionVerb } from "../shared/constants.js";

export type NPCTemplate = {
    id: string;
    situation: "first_communication" | "mid_conversation" | "goodbye";
    action: ActionVerb;
    context_lines: string[];
    example_phrasings: string[];
    constraints?: string[];
    priority: number;
};

export type ConversationContinuityState = "fresh_exchange" | "ongoing_exchange" | "closing_exchange";

const genericTemplates: NPCTemplate[] = [
    {
        id: "generic_first_communication",
        situation: "first_communication",
        action: "COMMUNICATE",
        context_lines: [
            "This is the NPC's first reply in the current exchange.",
            "Establish the NPC's voice naturally without sounding scripted or theatrical.",
            "Answer the speaker's immediate point before adding extra color.",
        ],
        example_phrasings: [
            "A brief opening acknowledgement that directly engages the point being raised.",
            "A natural first reply that shows attitude without repeating generic greetings.",
            "A short opener that gives the speaker something usable to respond to.",
        ],
        constraints: [
            "Do not default to stock greeting phrases unless they genuinely fit.",
            "Sound like a person speaking in the moment, not a canned opener.",
            "Avoid narrated gestures unless they are genuinely important.",
        ],
        priority: 6,
    },
    {
        id: "generic_mid_conversation",
        situation: "mid_conversation",
        action: "COMMUNICATE",
        context_lines: [
            "This reply happens in the middle of an active conversation.",
            "React to the recent flow instead of restarting the exchange.",
            "If the speaker asks for something concrete, address that concrete thing first.",
        ],
        example_phrasings: [
            "A reply that picks up directly from the last thing said.",
            "A short answer with a little personality and forward motion.",
            "A grounded follow-up that references the ongoing topic naturally.",
        ],
        constraints: [
            "Do not re-introduce yourself or restart the conversation.",
            "Prefer continuation, clarification, or reaction over generic filler.",
            "Do not drift away from the active topic.",
            "Avoid repeated scenic stage direction when plain speech will do.",
        ],
        priority: 7,
    },
    {
        id: "generic_goodbye",
        situation: "goodbye",
        action: "COMMUNICATE",
        context_lines: [
            "This reply should help close or soften the end of a conversation.",
            "Acknowledge departure, parting, or the conversation winding down.",
            "A closing response should still sound like a reply to this exchange, not a random proverb.",
        ],
        example_phrasings: [
            "A brief parting remark in the NPC's own voice.",
            "A closing line that feels natural for the relationship.",
            "A simple acknowledgement that the exchange is ending.",
        ],
        constraints: [
            "Keep it brief and final-feeling without sounding robotic.",
            "Do not overdramatize unless the recent exchange clearly supports it.",
            "Avoid cryptic or poetic lines unless they strongly fit the NPC.",
        ],
        priority: 8,
    },
];

export function detectSituation(playerInput: string, context?: {
    transcript_recent_count?: number;
    farewell_hint?: boolean;
    continuity_state?: ConversationContinuityState;
    npc_has_spoken_in_session?: boolean;
    player_has_spoken_in_session?: boolean;
    transcript_summary_present?: boolean;
    participant_factoid_count?: number;
}): NPCTemplate["situation"] {
    const input = playerInput.toLowerCase();
    const farewell = context?.farewell_hint === true || /\b(goodbye|bye|farewell|see you|later|until next time)\b/.test(input);
    if (farewell) return "goodbye";

    if (context?.continuity_state === "closing_exchange") return "goodbye";
    if (context?.continuity_state === "ongoing_exchange") return "mid_conversation";
    if (context?.continuity_state === "fresh_exchange") return "first_communication";

    const transcript_recent_count = Number(context?.transcript_recent_count ?? 0);
    const npc_has_spoken = context?.npc_has_spoken_in_session === true;
    const player_has_spoken = context?.player_has_spoken_in_session === true;
    const transcript_summary_present = context?.transcript_summary_present === true;
    const participant_factoid_count = Number(context?.participant_factoid_count ?? 0);

    if (npc_has_spoken || transcript_recent_count >= 2 || transcript_summary_present || participant_factoid_count > 0) {
        return "mid_conversation";
    }
    void player_has_spoken;
    return "first_communication";
}

export function findTemplate(situation: NPCTemplate["situation"]): NPCTemplate | null {
    return genericTemplates.find((template) => template.situation === situation) ?? null;
}

export function getTemplateResponse(template: NPCTemplate): string {
    const index = Math.floor(Math.random() * template.example_phrasings.length);
    return template.example_phrasings[index] ?? template.example_phrasings[0] ?? "Respond naturally in your own voice.";
}

export function hasTemplate(situation: NPCTemplate["situation"]): boolean {
    return findTemplate(situation) !== null;
}

export type DialoguePromptContextParams = {
    slot: number;
    npc: any;
    npc_ref: string;
    player_ref: string;
    player_text: string;
    conversation_id: string;
    template_situation?: string | null;
    place?: any;
    region?: any;
    speech_turn_context?: {
        transcript_recent?: Array<{ speaker_ref: string; text: string }>;
        transcript_summary?: string;
        memory_factoids_for_participant?: string[];
    } | null;
};

export type DialoguePromptContextSelection = {
    personality_lines: string[];
    world_lines: string[];
    memory_context: string;
    transcript_summary: string;
    participant_factoids: string[];
    transcript_recent: Array<{ speaker_ref: string; text: string }>;
    npc_location_name: string;
    player_location_name: string;
    place_summary_lines: string[];
    debug: {
        seed_key: string;
        personality_candidates: number;
        world_candidates: number;
        memory_candidates: number;
        place_summary_candidates: number;
        selected_memory_count: number;
        selected_personality_count: number;
        selected_world_count: number;
        selected_place_summary_count: number;
    };
};

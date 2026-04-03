import { debug_log } from "../shared/debug.js";

export type CommunicationEventStatus = "created" | "evaluated" | "closed";
export type ConversationMode = "free" | "timed";
export type SessionStatus = "active" | "cooling" | "closed";
export type ParticipantStatus = "active" | "observing" | "queued" | "thinking" | "left";
export type ListenerDisposition = "ignore" | "observe" | "join_session" | "queue_to_speak" | "leave_session";
export type AddressRecency = "direct_now" | "direct_recent" | "participant_recent" | "not_addressed";
export type QueueEntryStatus = "queued" | "thinking" | "spoken" | "declined" | "expired" | "cancelled";
export type SocialRole = "direct_reply" | "follow_up" | "interjection" | "farewell_response" | "answer" | "clarification" | "objection";

export type CommunicationEvent = {
    event_id: string;
    speaker_ref: string;
    text: string;
    volume: string;
    direct_target_refs: string[];
    heard_by_refs: string[];
    eligible_speaker_refs: string[];
    place_id: string;
    conversation_id: string;
    created_breath_index: number | null;
    timed_event_id?: string;
    source_action_id?: string;
    status: CommunicationEventStatus;
};

export type ParticipantSessionState = {
    participant_ref: string;
    status: ParticipantStatus;
    joined_breath: number | null;
    last_addressed_breath: number | null;
    last_spoke_breath: number | null;
    last_active_breath: number | null;
    recent_address_decay_breaths: number;
};

export type ListenerDecision = {
    listener_ref: string;
    disposition: ListenerDisposition;
    reason: string;
    social_role: SocialRole;
    priority_score: number;
    priority_breakdown: string[];
    address_recency: AddressRecency;
    target_refs: string[];
    creates_queue_entry: boolean;
};

export type QueueEntry = {
    queue_entry_id: string;
    participant_ref: string;
    reason_to_speak: string;
    joined_from_event_id: string;
    joined_breath_index: number | null;
    social_role: SocialRole;
    status: QueueEntryStatus;
    target_refs: string[];
    admission_priority_score: number;
    stable_order: number;
};

export type SpeechTurnContext = {
    conversation_id: string;
    participant_ref: string;
    current_mode: ConversationMode;
    current_place_id: string;
    current_timed_event_id?: string;
    transcript_recent: SessionTranscriptMessage[];
    transcript_summary: string;
    memory_factoids_for_participant: string[];
    participants: string[];
    current_speaker_ref?: string | null;
    prior_queue_entries: Array<{
        participant_ref: string;
        social_role: SocialRole;
        status: QueueEntryStatus;
        stable_order: number;
    }>;
};

export type SessionTranscriptMessage = {
    speaker_ref: string;
    text: string;
    created_breath_index: number | null;
    social_role?: SocialRole;
};

export type ConversationSession = {
    conversation_id: string;
    mode: ConversationMode;
    participants: string[];
    active_participants: string[];
    observers: string[];
    queued_speakers: QueueEntry[];
    current_speaker_ref: string | null;
    transcript_recent: SessionTranscriptMessage[];
    transcript_summary: string;
    memory_factoids_by_participant: Record<string, string[]>;
    place_id: string;
    last_activity_breath: number | null;
    status: SessionStatus;
    timed_event_id?: string;
    participant_states: Record<string, ParticipantSessionState>;
};

const RECENT_ADDRESS_DECAY_BREATHS = 24;
const MAX_RECENT_TRANSCRIPT_MESSAGES = 12;
const SESSION_EXTENSION_WINDOW_BREATHS = 48;
const SESSION_COOLING_AFTER_BREATHS = 64;
const SESSION_CLOSE_AFTER_BREATHS = 192;
const ACTIVE_PARTICIPANT_DECAY_BREATHS = 48;

const sessions_by_slot = new Map<number, Map<string, ConversationSession>>();
const events_by_slot = new Map<number, Map<string, CommunicationEvent>>();

function random_id(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function get_slot_session_map(slot: number): Map<string, ConversationSession> {
    let map = sessions_by_slot.get(slot);
    if (!map) {
        map = new Map<string, ConversationSession>();
        sessions_by_slot.set(slot, map);
    }
    return map;
}

function get_slot_event_map(slot: number): Map<string, CommunicationEvent> {
    let map = events_by_slot.get(slot);
    if (!map) {
        map = new Map<string, CommunicationEvent>();
        events_by_slot.set(slot, map);
    }
    return map;
}

function uniq(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

function has_overlap(left: string[], right: string[]): boolean {
    const right_set = new Set(right);
    return left.some((item) => right_set.has(item));
}

function ensure_participant_state(session: ConversationSession, participant_ref: string, breath_index: number | null, status: ParticipantStatus): ParticipantSessionState {
    let state = session.participant_states[participant_ref];
    if (!state) {
        state = {
            participant_ref,
            status,
            joined_breath: breath_index,
            last_addressed_breath: null,
            last_spoke_breath: null,
            last_active_breath: breath_index,
            recent_address_decay_breaths: RECENT_ADDRESS_DECAY_BREATHS,
        };
        session.participant_states[participant_ref] = state;
    }
    state.status = status;
    if (breath_index !== null) {
        state.last_active_breath = breath_index;
    }
    return state;
}

function mark_active_participant(session: ConversationSession, participant_ref: string): void {
    if (!session.active_participants.includes(participant_ref)) {
        session.active_participants.push(participant_ref);
    }
    session.observers = session.observers.filter((ref) => ref !== participant_ref);
}

function remove_active_participant(session: ConversationSession, participant_ref: string): void {
    session.active_participants = session.active_participants.filter((ref) => ref !== participant_ref);
}

function mark_observer(session: ConversationSession, participant_ref: string, breath_index: number | null): void {
    if (!session.observers.includes(participant_ref)) {
        session.observers.push(participant_ref);
    }
    remove_active_participant(session, participant_ref);
    ensure_participant_state(session, participant_ref, breath_index, "observing");
}

function mark_participant_active(session: ConversationSession, participant_ref: string, breath_index: number | null): void {
    if (!session.participants.includes(participant_ref)) {
        session.participants.push(participant_ref);
    }
    ensure_participant_state(session, participant_ref, breath_index, "active");
    mark_active_participant(session, participant_ref);
}

function decay_inactive_participants(session: ConversationSession, current_breath: number): void {
    for (const participant_ref of [...session.active_participants]) {
        if (participant_ref === session.current_speaker_ref) continue;
        const queued = session.queued_speakers.some((entry) => entry.participant_ref === participant_ref && (entry.status === "queued" || entry.status === "thinking"));
        if (queued) continue;
        const state = session.participant_states[participant_ref];
        if (!state || typeof state.last_active_breath !== "number") continue;
        const age = current_breath - state.last_active_breath;
        if (age >= ACTIVE_PARTICIPANT_DECAY_BREATHS) {
            mark_observer(session, participant_ref, current_breath);
        }
    }
}

function trim_recent_transcript(session: ConversationSession): void {
    if (session.transcript_recent.length > MAX_RECENT_TRANSCRIPT_MESSAGES) {
        session.transcript_recent = session.transcript_recent.slice(-MAX_RECENT_TRANSCRIPT_MESSAGES);
    }
}

function remove_from_queue(session: ConversationSession, participant_ref: string): void {
    session.queued_speakers = session.queued_speakers.filter((entry) => entry.participant_ref !== participant_ref && entry.status === "queued");
}

function get_address_recency(session: ConversationSession, participant_ref: string, direct_target_refs: string[], breath_index: number | null): AddressRecency {
    if (direct_target_refs.includes(participant_ref)) return "direct_now";
    const state = session.participant_states[participant_ref];
    if (!state || breath_index === null) {
        return session.active_participants.includes(participant_ref) ? "participant_recent" : "not_addressed";
    }
    if (typeof state.last_addressed_breath === "number") {
        const age = breath_index - state.last_addressed_breath;
        if (age >= 0 && age <= state.recent_address_decay_breaths) return "direct_recent";
    }
    if (typeof state.last_active_breath === "number") {
        const age = breath_index - state.last_active_breath;
        if (age >= 0 && age <= state.recent_address_decay_breaths) return "participant_recent";
    }
    return "not_addressed";
}

function compute_address_recency_score(address_recency: AddressRecency): number {
    switch (address_recency) {
        case "direct_now": return 100;
        case "direct_recent": return 60;
        case "participant_recent": return 35;
        default: return 0;
    }
}

function create_queue_entry(decision: ListenerDecision, event: CommunicationEvent, stable_order: number): QueueEntry {
    return {
        queue_entry_id: random_id("queue"),
        participant_ref: decision.listener_ref,
        reason_to_speak: decision.reason,
        joined_from_event_id: event.event_id,
        joined_breath_index: event.created_breath_index,
        social_role: decision.social_role,
        status: "queued",
        target_refs: [...decision.target_refs],
        admission_priority_score: decision.priority_score,
        stable_order,
    };
}

export function create_communication_event(slot: number, params: {
    speaker_ref: string;
    text: string;
    volume?: string | null;
    direct_target_refs?: string[];
    heard_by_refs?: string[];
    eligible_speaker_refs?: string[];
    place_id: string;
    conversation_id: string;
    created_breath_index?: number | null;
    timed_event_id?: string;
    source_action_id?: string;
    event_id?: string;
}): CommunicationEvent {
    const event: CommunicationEvent = {
        event_id: params.event_id ?? random_id("comm_evt"),
        speaker_ref: params.speaker_ref,
        text: params.text,
        volume: typeof params.volume === "string" && params.volume.length > 0 ? params.volume : "NORMAL",
        direct_target_refs: uniq(params.direct_target_refs ?? []),
        heard_by_refs: uniq(params.heard_by_refs ?? []),
        eligible_speaker_refs: uniq(params.eligible_speaker_refs ?? []),
        place_id: params.place_id,
        conversation_id: params.conversation_id,
        created_breath_index: typeof params.created_breath_index === "number" ? params.created_breath_index : null,
        timed_event_id: params.timed_event_id,
        source_action_id: params.source_action_id,
        status: "created",
    };
    get_slot_event_map(slot).set(event.event_id, event);
    debug_log("ConversationSession", "created communication event", {
        slot,
        event_id: event.event_id,
        conversation_id: event.conversation_id,
        speaker_ref: event.speaker_ref,
        direct_target_refs: event.direct_target_refs,
        heard_by_refs: event.heard_by_refs,
        eligible_speaker_refs: event.eligible_speaker_refs,
        breath_index: event.created_breath_index,
        timed_event_id: event.timed_event_id ?? null,
    });
    return event;
}

export function get_communication_event(slot: number, event_id: string): CommunicationEvent | null {
    return get_slot_event_map(slot).get(event_id) ?? null;
}

export function mark_communication_event_evaluated(slot: number, event_id: string): void {
    const event = get_slot_event_map(slot).get(event_id);
    if (!event) return;
    event.status = "evaluated";
    debug_log("ConversationSession", "communication event evaluated", {
        slot,
        event_id,
        conversation_id: event.conversation_id,
    });
}

export function get_conversation_session(slot: number, conversation_id: string): ConversationSession | null {
    return get_slot_session_map(slot).get(conversation_id) ?? null;
}

export function resolve_conversation_session_id(slot: number, params: {
    place_id: string;
    speaker_ref: string;
    direct_target_refs?: string[];
    created_breath_index?: number | null;
    timed_event_id?: string;
}): string | null {
    const sessions = Array.from(get_slot_session_map(slot).values());
    const direct_target_refs = uniq(params.direct_target_refs ?? []);
    const participants = uniq([params.speaker_ref, ...direct_target_refs]);
    const breath_index = typeof params.created_breath_index === "number" ? params.created_breath_index : null;

    const candidate = sessions
        .filter((session) => session.place_id === params.place_id)
        .filter((session) => session.status !== "closed")
        .filter((session) => !params.timed_event_id || session.timed_event_id === params.timed_event_id)
        .filter((session) => {
            if (session.conversation_id && direct_target_refs.length > 0 && has_overlap(session.participants, participants)) return true;
            if (breath_index === null || session.last_activity_breath === null) return false;
            const age = breath_index - session.last_activity_breath;
            return age >= 0 && age <= SESSION_EXTENSION_WINDOW_BREATHS && has_overlap(session.participants, participants);
        })
        .sort((a, b) => {
            const a_activity = a.last_activity_breath ?? -1;
            const b_activity = b.last_activity_breath ?? -1;
            return b_activity - a_activity;
        })[0] ?? null;

    if (candidate) {
        debug_log("ConversationSession", "resolved existing session for new communication", {
            slot,
            conversation_id: candidate.conversation_id,
            place_id: params.place_id,
            speaker_ref: params.speaker_ref,
            direct_target_refs,
            created_breath_index: breath_index,
        });
    }
    return candidate?.conversation_id ?? null;
}

export function ensure_conversation_session(slot: number, params: {
    conversation_id: string;
    place_id: string;
    speaker_ref: string;
    direct_target_refs?: string[];
    mode?: ConversationMode;
    created_breath_index?: number | null;
    timed_event_id?: string;
}): ConversationSession {
    const map = get_slot_session_map(slot);
    const existing = map.get(params.conversation_id);
    if (existing) {
        if (params.place_id) existing.place_id = params.place_id;
        if (params.timed_event_id) existing.timed_event_id = params.timed_event_id;
        if (params.created_breath_index !== undefined) existing.last_activity_breath = params.created_breath_index;
        mark_participant_active(existing, params.speaker_ref, params.created_breath_index ?? null);
        for (const target_ref of uniq(params.direct_target_refs ?? [])) {
            mark_participant_active(existing, target_ref, params.created_breath_index ?? null);
            existing.participant_states[target_ref]!.last_addressed_breath = params.created_breath_index ?? null;
        }
        return existing;
    }

    const participants = uniq([params.speaker_ref, ...(params.direct_target_refs ?? [])]);
    const participant_states: Record<string, ParticipantSessionState> = {};
    const session: ConversationSession = {
        conversation_id: params.conversation_id,
        mode: params.mode ?? (params.timed_event_id ? "timed" : "free"),
        participants,
        active_participants: [...participants],
        observers: [],
        queued_speakers: [],
        current_speaker_ref: null,
        transcript_recent: [],
        transcript_summary: "",
        memory_factoids_by_participant: {},
        place_id: params.place_id,
        last_activity_breath: params.created_breath_index ?? null,
        status: "active",
        timed_event_id: params.timed_event_id,
        participant_states,
    };
    for (const participant_ref of participants) {
        const state = ensure_participant_state(session, participant_ref, params.created_breath_index ?? null, "active");
        if (participant_ref !== params.speaker_ref) {
            state.last_addressed_breath = params.created_breath_index ?? null;
        }
    }
    map.set(session.conversation_id, session);
    debug_log("ConversationSession", "created session", {
        slot,
        conversation_id: session.conversation_id,
        mode: session.mode,
        place_id: session.place_id,
        participants: session.participants,
    });
    return session;
}

export function update_conversation_session_lifecycle(slot: number, conversation_id: string, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    const current_breath = typeof breath_index === "number" ? breath_index : session.last_activity_breath;
    if (current_breath === null || session.last_activity_breath === null) return session;

    decay_inactive_participants(session, current_breath);
    const age = current_breath - session.last_activity_breath;
    const queued_count = session.queued_speakers.filter((entry) => entry.status === "queued" || entry.status === "thinking").length;
    if (queued_count === 0 && age >= SESSION_CLOSE_AFTER_BREATHS) {
        session.status = "closed";
    } else if (queued_count === 0 && age >= SESSION_COOLING_AFTER_BREATHS) {
        session.status = "cooling";
    } else {
        session.status = "active";
    }
    debug_log("ConversationSession", "updated session lifecycle status", {
        slot,
        conversation_id,
        status: session.status,
        age,
        queued_count,
        current_breath,
    });
    return session;
}

export function mark_session_participant_left(slot: number, conversation_id: string, participant_ref: string, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    const state = ensure_participant_state(session, participant_ref, breath_index ?? null, "left");
    state.last_active_breath = typeof breath_index === "number" ? breath_index : state.last_active_breath;
    remove_active_participant(session, participant_ref);
    session.observers = session.observers.filter((ref) => ref !== participant_ref);
    remove_from_queue(session, participant_ref);
    if (session.current_speaker_ref === participant_ref) {
        session.current_speaker_ref = null;
    }
    update_conversation_session_lifecycle(slot, conversation_id, breath_index);
    debug_log("ConversationSession", "participant left session", {
        slot,
        conversation_id,
        participant_ref,
        breath_index: breath_index ?? null,
        active_participants: session.active_participants,
        queue_snapshot: session.queued_speakers.map((entry) => ({
            participant_ref: entry.participant_ref,
            stable_order: entry.stable_order,
            status: entry.status,
        })),
    });
    return session;
}

export function mark_conversation_session_cooling(slot: number, conversation_id: string, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    session.status = "cooling";
    if (typeof breath_index === "number") {
        session.last_activity_breath = breath_index;
    }
    debug_log("ConversationSession", "session marked cooling", {
        slot,
        conversation_id,
        breath_index: breath_index ?? null,
    });
    return session;
}

export function set_conversation_session_summary(slot: number, conversation_id: string, transcript_summary: string): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    session.transcript_summary = String(transcript_summary ?? "").trim();
    debug_log("ConversationSession", "updated session transcript summary", {
        slot,
        conversation_id,
        summary_length: session.transcript_summary.length,
    });
    return session;
}

export function set_participant_memory_factoids(slot: number, conversation_id: string, participant_ref: string, factoids: string[]): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    session.memory_factoids_by_participant[participant_ref] = uniq(factoids.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0));
    debug_log("ConversationSession", "updated participant memory factoids", {
        slot,
        conversation_id,
        participant_ref,
        factoid_count: session.memory_factoids_by_participant[participant_ref].length,
    });
    return session;
}

export function append_conversation_session_message(slot: number, params: {
    conversation_id: string;
    speaker_ref: string;
    text: string;
    created_breath_index?: number | null;
    social_role?: SocialRole;
}): ConversationSession | null {
    const session = get_conversation_session(slot, params.conversation_id);
    if (!session) return null;
    session.transcript_recent.push({
        speaker_ref: params.speaker_ref,
        text: params.text,
        created_breath_index: typeof params.created_breath_index === "number" ? params.created_breath_index : null,
        social_role: params.social_role,
    });
    trim_recent_transcript(session);
    session.current_speaker_ref = params.speaker_ref;
    session.last_activity_breath = typeof params.created_breath_index === "number" ? params.created_breath_index : session.last_activity_breath;
    if (!session.participants.includes(params.speaker_ref)) {
        session.participants.push(params.speaker_ref);
    }
    const state = ensure_participant_state(session, params.speaker_ref, params.created_breath_index ?? null, "active");
    state.last_spoke_breath = typeof params.created_breath_index === "number" ? params.created_breath_index : state.last_spoke_breath;
    mark_active_participant(session, params.speaker_ref);
    debug_log("ConversationSession", "appended session transcript message", {
        slot,
        conversation_id: params.conversation_id,
        speaker_ref: params.speaker_ref,
        social_role: params.social_role ?? null,
        breath_index: params.created_breath_index ?? null,
        transcript_size: session.transcript_recent.length,
    });
    return session;
}

export function mark_session_targets_addressed(slot: number, conversation_id: string, target_refs: string[], breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    const refs = uniq(target_refs);
    for (const ref of refs) {
        mark_participant_active(session, ref, breath_index ?? null);
        const state = session.participant_states[ref]!;
        state.last_addressed_breath = typeof breath_index === "number" ? breath_index : state.last_addressed_breath;
    }
    return session;
}

export function add_session_observers(slot: number, conversation_id: string, observer_refs: string[], breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    for (const ref of uniq(observer_refs)) {
        if (session.participants.includes(ref) || session.active_participants.includes(ref)) continue;
        if (!session.observers.includes(ref)) session.observers.push(ref);
        ensure_participant_state(session, ref, breath_index ?? null, "observing");
    }
    if (observer_refs.length > 0) {
        debug_log("ConversationSession", "updated session observers", {
            slot,
            conversation_id,
            observers: session.observers,
            breath_index: breath_index ?? null,
        });
    }
    return session;
}

export function mark_session_participant_rejoined(slot: number, conversation_id: string, participant_ref: string, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    mark_participant_active(session, participant_ref, breath_index ?? null);
    update_conversation_session_lifecycle(slot, conversation_id, breath_index);
    debug_log("ConversationSession", "participant rejoined session", {
        slot,
        conversation_id,
        participant_ref,
        breath_index: breath_index ?? null,
        active_participants: session.active_participants,
        observers: session.observers,
    });
    return session;
}

export function create_listener_decision(slot: number, params: {
    conversation_id: string;
    listener_ref: string;
    direct_target_refs?: string[];
    eligible_to_speak?: boolean;
    can_perceive?: boolean;
    is_current_participant?: boolean;
    behavior_modifier?: number;
    relationship_modifier?: number;
    relevance_score?: number;
    social_role?: SocialRole;
    reason?: string;
    breath_index?: number | null;
}): ListenerDecision | null {
    const session = get_conversation_session(slot, params.conversation_id);
    if (!session) return null;
    const direct_target_refs = uniq(params.direct_target_refs ?? []);
    const address_recency = get_address_recency(session, params.listener_ref, direct_target_refs, params.breath_index ?? null);
    const priority_breakdown: string[] = [];
    let priority_score = 0;

    const address_score = compute_address_recency_score(address_recency);
    if (address_score > 0) {
        priority_score += address_score;
        priority_breakdown.push(`address:${address_recency}:${address_score}`);
    }
    if (params.is_current_participant) {
        priority_score += 25;
        priority_breakdown.push("participant:25");
    }
    const relevance_score = Math.max(0, Math.floor(Number(params.relevance_score ?? 0)) || 0);
    if (relevance_score > 0) {
        priority_score += relevance_score;
        priority_breakdown.push(`relevance:${relevance_score}`);
    }
    const behavior_modifier = Math.floor(Number(params.behavior_modifier ?? 0)) || 0;
    if (behavior_modifier !== 0) {
        priority_score += behavior_modifier;
        priority_breakdown.push(`behavior:${behavior_modifier}`);
    }
    const relationship_modifier = Math.floor(Number(params.relationship_modifier ?? 0)) || 0;
    if (relationship_modifier !== 0) {
        priority_score += relationship_modifier;
        priority_breakdown.push(`relationship:${relationship_modifier}`);
    }
    const participant_state = session.participant_states[params.listener_ref];
    if (participant_state && typeof participant_state.last_spoke_breath === "number" && typeof params.breath_index === "number") {
        const since_spoke = params.breath_index - participant_state.last_spoke_breath;
        if (since_spoke >= 0 && since_spoke <= 12) {
            priority_score -= 10;
            priority_breakdown.push("recency_penalty:-10");
        }
    }

    if (!params.can_perceive && address_recency === "not_addressed") {
        const decision: ListenerDecision = {
            listener_ref: params.listener_ref,
            disposition: "ignore",
            reason: params.reason ?? "cannot_perceive",
            social_role: params.social_role ?? "follow_up",
            priority_score: 0,
            priority_breakdown: ["cannot_perceive"],
            address_recency,
            target_refs: direct_target_refs,
            creates_queue_entry: false,
        };
        debug_log("ConversationSession", "listener decision created", {
            slot,
            conversation_id: params.conversation_id,
            listener_ref: decision.listener_ref,
            disposition: decision.disposition,
            priority_score: decision.priority_score,
            address_recency: decision.address_recency,
            reason: decision.reason,
        });
        return decision;
    }

    if (!params.eligible_to_speak) {
        const decision: ListenerDecision = {
            listener_ref: params.listener_ref,
            disposition: params.can_perceive ? "observe" : "ignore",
            reason: params.reason ?? (params.can_perceive ? "observer_only" : "not_eligible"),
            social_role: params.social_role ?? "follow_up",
            priority_score,
            priority_breakdown,
            address_recency,
            target_refs: direct_target_refs,
            creates_queue_entry: false,
        };
        debug_log("ConversationSession", "listener decision created", {
            slot,
            conversation_id: params.conversation_id,
            listener_ref: decision.listener_ref,
            disposition: decision.disposition,
            priority_score: decision.priority_score,
            address_recency: decision.address_recency,
            reason: decision.reason,
        });
        return decision;
    }

    const disposition: ListenerDisposition = priority_score > 0 ? "queue_to_speak" : "observe";
    const decision: ListenerDecision = {
        listener_ref: params.listener_ref,
        disposition,
        reason: params.reason ?? (disposition === "queue_to_speak" ? "eligible_responder" : "observer_only"),
        social_role: params.social_role ?? (address_recency === "direct_now" ? "direct_reply" : "follow_up"),
        priority_score,
        priority_breakdown,
        address_recency,
        target_refs: direct_target_refs,
        creates_queue_entry: disposition === "queue_to_speak",
    };
    debug_log("ConversationSession", "listener decision created", {
        slot,
        conversation_id: params.conversation_id,
        listener_ref: decision.listener_ref,
        disposition: decision.disposition,
        priority_score: decision.priority_score,
        address_recency: decision.address_recency,
        reason: decision.reason,
        priority_breakdown: decision.priority_breakdown,
    });
    return decision;
}

export function admit_speakers_for_event(slot: number, params: {
    conversation_id: string;
    event_id: string;
    decisions: ListenerDecision[];
    breath_index?: number | null;
}): QueueEntry[] {
    const session = get_conversation_session(slot, params.conversation_id);
    const event = get_communication_event(slot, params.event_id);
    if (!session || !event) return [];

    const queued = params.decisions
        .filter((decision) => decision.creates_queue_entry)
        .sort((a, b) => {
            if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
            return a.listener_ref.localeCompare(b.listener_ref);
        });

    const created: QueueEntry[] = [];
    let next_order = session.queued_speakers.reduce((max, entry) => Math.max(max, entry.stable_order), 0) + 1;
    for (const decision of queued) {
        const existing = session.queued_speakers.find((entry) => entry.participant_ref === decision.listener_ref && entry.status === "queued");
        if (existing) continue;
        const entry = create_queue_entry(decision, event, next_order++);
        session.queued_speakers.push(entry);
        created.push(entry);
        if (!session.participants.includes(decision.listener_ref)) session.participants.push(decision.listener_ref);
        const state = ensure_participant_state(session, decision.listener_ref, params.breath_index ?? null, "queued");
        if (decision.address_recency === "direct_now") {
            state.last_addressed_breath = params.breath_index ?? state.last_addressed_breath;
        }
        if (!session.active_participants.includes(decision.listener_ref)) session.active_participants.push(decision.listener_ref);
    }
    session.queued_speakers.sort((a, b) => a.stable_order - b.stable_order);
    if (created.length > 0) {
        debug_log("ConversationSession", "admitted speakers into queue", {
            slot,
            conversation_id: params.conversation_id,
            event_id: params.event_id,
            created: created.map((entry) => ({
                participant_ref: entry.participant_ref,
                stable_order: entry.stable_order,
                score: entry.admission_priority_score,
                social_role: entry.social_role,
            })),
            queue_snapshot: session.queued_speakers.map((entry) => ({
                participant_ref: entry.participant_ref,
                stable_order: entry.stable_order,
                status: entry.status,
            })),
        });
    }
    return created;
}

export function mark_queue_entry_status(slot: number, conversation_id: string, participant_ref: string, status: QueueEntryStatus, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    for (const entry of session.queued_speakers) {
        if (entry.participant_ref === participant_ref && (entry.status === "queued" || entry.status === "thinking")) {
            entry.status = status;
            break;
        }
    }
    if (status === "spoken") {
        const state = ensure_participant_state(session, participant_ref, breath_index ?? null, "active");
        state.last_spoke_breath = typeof breath_index === "number" ? breath_index : state.last_spoke_breath;
        mark_active_participant(session, participant_ref);
        remove_from_queue(session, participant_ref);
    } else if (status === "declined" || status === "expired" || status === "cancelled") {
        remove_from_queue(session, participant_ref);
    }
    update_conversation_session_lifecycle(slot, conversation_id, breath_index);
    debug_log("ConversationSession", "queue entry status updated", {
        slot,
        conversation_id,
        participant_ref,
        status,
        breath_index: breath_index ?? null,
        queue_snapshot: session.queued_speakers.map((entry) => ({
            participant_ref: entry.participant_ref,
            stable_order: entry.stable_order,
            status: entry.status,
        })),
    });
    return session;
}

export function mark_queue_entry_status_by_id(slot: number, conversation_id: string, queue_entry_id: string, status: QueueEntryStatus, breath_index?: number | null): ConversationSession | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    const entry = session.queued_speakers.find((item) => item.queue_entry_id === queue_entry_id);
    if (!entry) return null;
    entry.status = status;
    if (status === "spoken") {
        const state = ensure_participant_state(session, entry.participant_ref, breath_index ?? null, "active");
        state.last_spoke_breath = typeof breath_index === "number" ? breath_index : state.last_spoke_breath;
        mark_active_participant(session, entry.participant_ref);
        remove_from_queue(session, entry.participant_ref);
    } else if (status === "declined" || status === "expired" || status === "cancelled") {
        remove_from_queue(session, entry.participant_ref);
    }
    update_conversation_session_lifecycle(slot, conversation_id, breath_index);
    debug_log("ConversationSession", "queue entry status updated by id", {
        slot,
        conversation_id,
        queue_entry_id,
        participant_ref: entry.participant_ref,
        status,
        breath_index: breath_index ?? null,
        queue_snapshot: session.queued_speakers.map((item) => ({
            participant_ref: item.participant_ref,
            stable_order: item.stable_order,
            status: item.status,
        })),
    });
    return session;
}

export function get_session_queue_entry(slot: number, conversation_id: string, participant_ref: string): QueueEntry | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    return session.queued_speakers.find((entry) => entry.participant_ref === participant_ref && entry.status === "queued") ?? null;
}

export function get_session_queue_entry_by_id(slot: number, conversation_id: string, queue_entry_id: string): QueueEntry | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    return session.queued_speakers.find((entry) => entry.queue_entry_id === queue_entry_id) ?? null;
}

export function get_session_queue_snapshot(slot: number, conversation_id: string): QueueEntry[] {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return [];
    return session.queued_speakers.map((entry) => ({ ...entry, target_refs: [...entry.target_refs] }));
}

export function get_session_queue_entry_ids(slot: number, conversation_id: string): string[] {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return [];
    return session.queued_speakers
        .filter((entry) => entry.status === "queued" || entry.status === "thinking")
        .map((entry) => entry.queue_entry_id);
}

export function get_next_session_queue_entry(slot: number, conversation_id: string): QueueEntry | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    const queued = session.queued_speakers
        .filter((entry) => entry.status === "queued")
        .sort((a, b) => a.stable_order - b.stable_order);
    return queued[0] ?? null;
}

export function build_speech_turn_context(slot: number, params: {
    conversation_id: string;
    participant_ref: string;
}): SpeechTurnContext | null {
    const session = get_conversation_session(slot, params.conversation_id);
    if (!session) return null;
    return {
        conversation_id: session.conversation_id,
        participant_ref: params.participant_ref,
        current_mode: session.mode,
        current_place_id: session.place_id,
        current_timed_event_id: session.timed_event_id,
        transcript_recent: session.transcript_recent.map((message) => ({ ...message })),
        transcript_summary: session.transcript_summary,
        memory_factoids_for_participant: [...(session.memory_factoids_by_participant[params.participant_ref] ?? [])],
        participants: [...session.participants],
        current_speaker_ref: session.current_speaker_ref,
        prior_queue_entries: session.queued_speakers.map((entry) => ({
            participant_ref: entry.participant_ref,
            social_role: entry.social_role,
            status: entry.status,
            stable_order: entry.stable_order,
        })),
    };
}

export function get_latest_session_external_turn(slot: number, conversation_id: string, participant_ref: string): SessionTranscriptMessage | null {
    const session = get_conversation_session(slot, conversation_id);
    if (!session) return null;
    return [...session.transcript_recent].reverse().find((message) => message.speaker_ref !== participant_ref) ?? null;
}

export function build_queue_transport_context(slot: number, params: {
    conversation_id: string;
    participant_ref: string;
    queue_entry_id?: string | null;
}): {
    queue_entry: QueueEntry | null;
    latest_external_turn: SessionTranscriptMessage | null;
    speech_turn_context: SpeechTurnContext | null;
} {
    const queue_entry = params.queue_entry_id
        ? get_session_queue_entry_by_id(slot, params.conversation_id, params.queue_entry_id)
        : get_session_queue_entry(slot, params.conversation_id, params.participant_ref);
    const latest_external_turn = get_latest_session_external_turn(slot, params.conversation_id, params.participant_ref);
    const speech_turn_context = build_speech_turn_context(slot, {
        conversation_id: params.conversation_id,
        participant_ref: params.participant_ref,
    });
    return {
        queue_entry,
        latest_external_turn,
        speech_turn_context,
    };
}

export function get_all_conversation_sessions(slot: number): ConversationSession[] {
    return Array.from(get_slot_session_map(slot).values());
}

export function get_session_alignment_for_participant(slot: number, participant_ref: string, place_id?: string | null): {
    conversation_id: string;
    place_id: string;
    target_ref: string | null;
    role: "participant" | "observer" | "queued";
} | null {
    const normalized_place_id = typeof place_id === "string" && place_id.length > 0 ? place_id : null;
    for (const session of get_all_conversation_sessions(slot)) {
        if (normalized_place_id && session.place_id !== normalized_place_id) continue;
        const in_queue = session.queued_speakers.some((entry) => entry.participant_ref === participant_ref && (entry.status === "queued" || entry.status === "thinking"));
        const is_participant = session.participants.includes(participant_ref) || session.active_participants.includes(participant_ref);
        const is_observer = session.observers.includes(participant_ref);
        if (!in_queue && !is_participant && !is_observer) continue;

        const latest_external_turn = [...session.transcript_recent].reverse().find((message) => message.speaker_ref !== participant_ref) ?? null;
        const participant_queue_entry = session.queued_speakers.find((entry) => entry.participant_ref === participant_ref && (entry.status === "queued" || entry.status === "thinking")) ?? null;
        const target_ref = latest_external_turn?.speaker_ref
            ?? participant_queue_entry?.target_refs[0]
            ?? session.current_speaker_ref
            ?? session.participants.find((ref) => ref !== participant_ref)
            ?? null;

        return {
            conversation_id: session.conversation_id,
            place_id: session.place_id,
            target_ref,
            role: is_participant ? "participant" : (in_queue ? "queued" : "observer"),
        };
    }
    return null;
}

export function get_conversation_sessions_debug_snapshot(slot: number): Array<Record<string, unknown>> {
    return get_all_conversation_sessions(slot).map((session) => ({
        conversation_id: session.conversation_id,
        mode: session.mode,
        status: session.status,
        place_id: session.place_id,
        timed_event_id: session.timed_event_id ?? null,
        current_speaker_ref: session.current_speaker_ref,
        last_activity_breath: session.last_activity_breath,
        participants: [...session.participants],
        active_participants: [...session.active_participants],
        observers: [...session.observers],
        transcript_recent_count: session.transcript_recent.length,
        transcript_summary_present: session.transcript_summary.length > 0,
        queued_speakers: session.queued_speakers.map((entry) => ({
            queue_entry_id: entry.queue_entry_id,
            participant_ref: entry.participant_ref,
            stable_order: entry.stable_order,
            social_role: entry.social_role,
            reason_to_speak: entry.reason_to_speak,
            status: entry.status,
            target_refs: [...entry.target_refs],
            admission_priority_score: entry.admission_priority_score,
        })),
        participant_states: Object.fromEntries(
            Object.entries(session.participant_states).map(([participant_ref, state]) => [participant_ref, {
                status: state.status,
                joined_breath: state.joined_breath,
                last_addressed_breath: state.last_addressed_breath,
                last_spoke_breath: state.last_spoke_breath,
                last_active_breath: state.last_active_breath,
                recent_address_decay_breaths: state.recent_address_decay_breaths,
            }])
        ),
        memory_factoid_counts: Object.fromEntries(
            Object.entries(session.memory_factoids_by_participant).map(([participant_ref, facts]) => [participant_ref, Array.isArray(facts) ? facts.length : 0])
        ),
    }));
}

export function clear_conversation_sessions(slot?: number): void {
    if (typeof slot === "number") {
        sessions_by_slot.delete(slot);
        events_by_slot.delete(slot);
        return;
    }
    sessions_by_slot.clear();
    events_by_slot.clear();
}

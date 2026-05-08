import { append_inbox_message } from "../engine/inbox_store.js";
import { append_log_message } from "../engine/log_store.js";
import { create_message } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { get_inbox_path, get_log_path } from "../engine/paths.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import { build_working_memory } from "../context_manager/index.js";
import { debug_log } from "../shared/debug.js";
import type { TimedEventType } from "../shared/constants.js";
import { advance_turn, finalize_world_sim_interstitial, get_active_actor_ref, get_timed_event_phase, get_timed_event_state, get_timed_event_world_breath_index, save_world_store, should_auto_end_actor_turn, start_timed_event } from "../world_storage/store.js";
import type { WorldStore } from "../world_storage/store.js";

export type TimedEventTurnAdvanceResult =
    | { ok: true; advanced: true; interstitial_started: false; current_round: number; active_actor_index: number; active_actor: string }
    | { ok: true; advanced: true; interstitial_started: true; current_round: number | null; active_actor_index: null; active_actor: null }
    | { ok: false; error: string };

export type CanonicalTimedEventStartResult =
    | { ok: true; event_id: string; initiative_order: string[]; first_actor: string | null }
    | { ok: false; error: string };

function roll_d20(): number {
    return Math.floor(Math.random() * 20) + 1;
}

function get_dex_bonus(dex: number): number {
    return Math.floor((dex - 50) / 10);
}

function get_actor_dex(slot: number, actor_ref: string): number {
    if (actor_ref.startsWith("actor.")) {
        const actor_id = actor_ref.replace("actor.", "");
        const result = load_actor(slot, actor_id);
        if (result.ok) {
            return Number((result.actor as any)?.stats?.dex ?? 50);
        }
    } else if (actor_ref.startsWith("npc.")) {
        const npc_id = actor_ref.replace("npc.", "");
        const result = load_npc(slot, npc_id);
        if (result.ok) {
            return Number((result.npc as any)?.stats?.dex ?? 50);
        }
    }
    return 50;
}

function actor_label(actor_ref: string): string {
    return actor_ref.split(".")[1] ?? actor_ref;
}

function roll_and_save_initiative(slot: number, store: WorldStore): boolean {
    if (!store.initiative_order) return false;

    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);

    for (const entry of store.initiative_order) {
        const dex = get_actor_dex(slot, entry.actor_ref);
        const dex_bonus = get_dex_bonus(dex);
        const roll = roll_d20();
        entry.initiative_roll = roll + dex_bonus;
        entry.dex_score = dex;

        debug_log("TIMED_EVENT_START", "initiative roll", {
            slot,
            actor: entry.actor_ref,
            roll,
            dex_bonus,
            total: entry.initiative_roll,
        });

        append_log_message(log_path, "system", `${actor_label(entry.actor_ref)} rolls initiative: ${roll} + ${dex_bonus} DEX = ${entry.initiative_roll}`);
    }

    store.initiative_order.sort((a, b) => {
        if (b.initiative_roll !== a.initiative_roll) {
            return b.initiative_roll - a.initiative_roll;
        }
        if (b.dex_score !== a.dex_score) {
            return b.dex_score - a.dex_score;
        }
        return Math.random() - 0.5;
    });

    const initiative_msg: MessageInput = {
        sender: "turn_manager",
        content: `Initiative order:\n${store.initiative_order.map((e, i) => `${i + 1}. ${actor_label(e.actor_ref)} (${e.initiative_roll})`).join("\n")}`,
        stage: "initiative_announcement",
        status: "sent",
        meta: {
            initiative_order: store.initiative_order.map((e) => ({
                actor: e.actor_ref,
                roll: e.initiative_roll,
            })),
            event_type: store.timed_event_type,
        },
    };
    append_inbox_message(inbox_path, create_message(initiative_msg));
    return save_world_store(slot, store);
}

export async function start_canonical_timed_event(
    slot: number,
    event_type: TimedEventType,
    participants: string[],
    location: { world_x: number; world_y: number; region_x: number; region_y: number },
    options?: {
        trigger?: {
            kind: string;
            source_ref?: string;
            target_refs?: string[];
            summary?: string;
        };
        announce_sender?: string;
    },
): Promise<CanonicalTimedEventStartResult> {
    const result = start_timed_event(slot, event_type, participants, location, {
        trigger: options?.trigger,
    });
    if ("error" in result) return { ok: false, error: result.error };

    const store = get_timed_event_state(slot);
    if (!store?.initiative_order) {
        return { ok: false, error: "timed_event_state_missing_after_start" };
    }
    if (!roll_and_save_initiative(slot, store)) {
        return { ok: false, error: "failed_to_roll_initiative" };
    }

    const turn_store = get_timed_event_state(slot);
    const initiative_order = Array.isArray(turn_store?.initiative_order)
        ? turn_store.initiative_order.map((entry) => entry.actor_ref)
        : participants;
    const first_actor = turn_store?.initiative_order?.[0]?.actor_ref ?? null;
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    const sender = String(options?.announce_sender ?? "turn_manager");

    const turn_order_message: MessageInput = {
        sender,
        content: `Turn order: ${initiative_order.map((ref) => actor_label(ref)).join(", ")}`,
        stage: "turn_order",
        status: "sent",
        meta: {
            event_id: result.event_id,
            initiative_order,
            first_actor,
        },
    };
    append_inbox_message(inbox_path, create_message(turn_order_message));

    try {
        const region_id = `region.${location.world_x}_${location.world_y}_${location.region_x}_${location.region_y}`;
        await build_working_memory(slot, result.event_id, event_type, region_id, participants);
        debug_log("TIMED_EVENT_START", "working memory built", {
            slot,
            event_id: result.event_id,
            participants: participants.length,
        });
    } catch (err) {
        debug_log("TIMED_EVENT_START", "failed to build working memory", {
            slot,
            event_id: result.event_id,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    const start_announcement: MessageInput = {
        sender,
        content: `Timed event begins! ${participants.length} participants.`,
        stage: "timed_event_start",
        status: "sent",
        meta: {
            event_type,
            participants,
            event_id: result.event_id,
            region: location,
            trigger: options?.trigger?.kind ?? null,
            trigger_context: options?.trigger ?? null,
        },
    };
    append_inbox_message(inbox_path, create_message(start_announcement));
    append_log_message(log_path, "system", `Timed event started: ${event_type} with ${participants.length} participants.`);

    debug_log("TIMED_EVENT_START", "canonical timed event start completed", {
        slot,
        event_id: result.event_id,
        event_type,
        participants,
        initiative_order,
        first_actor,
        trigger: options?.trigger?.kind ?? null,
    });

    return {
        ok: true,
        event_id: result.event_id,
        initiative_order,
        first_actor,
    };
}

function announce_timed_event_turn_advance(slot: number, result: Extract<TimedEventTurnAdvanceResult, { ok: true }>): void {
    const log_path = get_log_path(slot);
    if (result.interstitial_started) {
        append_log_message(log_path, "system", "Initiative cycle complete. World simulation interstitial has started.");
        return;
    }

    const inbox_path = get_inbox_path(slot);
    const actor_label_text = actor_label(result.active_actor);
    const turn_position_in_round = result.active_actor_index + 1;
    const turn_announcement: MessageInput = {
        sender: "turn_manager",
        content: `Round ${result.current_round}: ${actor_label_text}'s turn (${turn_position_in_round})`,
        stage: "turn_announcement",
        status: "sent",
        meta: {
            round_number: result.current_round,
            active_actor_index: result.active_actor_index,
            turn_position_in_round,
            active_actor: result.active_actor,
        },
    };
    append_inbox_message(inbox_path, create_message(turn_announcement));
    append_log_message(log_path, "system", `Round ${result.current_round}: ${actor_label_text}'s turn (${turn_position_in_round})`);
}

export function advance_active_timed_event_turn(
    slot: number,
    actor_ref: string,
    options?: {
        source?: string;
        reason?: string;
        announce?: boolean;
    },
): TimedEventTurnAdvanceResult {
    const active_actor_ref = get_active_actor_ref(slot);
    if (!active_actor_ref) {
        return { ok: false, error: "no_active_timed_event" };
    }
    if (active_actor_ref !== actor_ref) {
        debug_log("TIMED_EVENT_TURN", "blocked canonical turn advance for non-active actor", {
            slot,
            actor_ref,
            active_actor_ref,
            source: options?.source ?? null,
            reason: options?.reason ?? null,
            timed_event_phase: get_timed_event_phase(slot),
            world_breath_index: get_timed_event_world_breath_index(slot),
        });
        return { ok: false, error: "not_your_turn" };
    }

    const advanced = advance_turn(slot);
    if ("error" in advanced) {
        if (advanced.error === "world_sim_interstitial_started") {
            const store = get_timed_event_state(slot);
            const result: TimedEventTurnAdvanceResult = {
                ok: true,
                advanced: true,
                interstitial_started: true,
                current_round: store?.current_round ?? null,
                active_actor_index: null,
                active_actor: null,
            };
            if (options?.announce !== false) announce_timed_event_turn_advance(slot, result);
            debug_log("TIMED_EVENT_TURN", "canonical turn advance entered world sim interstitial", {
                slot,
                actor_ref,
                source: options?.source ?? null,
                reason: options?.reason ?? null,
                timed_event_phase: get_timed_event_phase(slot),
                world_breath_index: get_timed_event_world_breath_index(slot),
            });
            return result;
        }
        return { ok: false, error: advanced.error };
    }

    const result: TimedEventTurnAdvanceResult = {
        ok: true,
        advanced: true,
        interstitial_started: false,
        current_round: advanced.current_round,
        active_actor_index: advanced.active_actor_index,
        active_actor: advanced.active_actor,
    };
    if (options?.announce !== false) announce_timed_event_turn_advance(slot, result);
    debug_log("TIMED_EVENT_TURN", "canonical turn advance completed", {
        slot,
        actor_ref,
        source: options?.source ?? null,
        reason: options?.reason ?? null,
        current_round: result.current_round,
        active_actor_index: result.active_actor_index,
        active_actor: result.active_actor,
        timed_event_phase: get_timed_event_phase(slot),
        world_breath_index: get_timed_event_world_breath_index(slot),
    });
    return result;
}

export function finalize_world_sim_interstitial_round(
    slot: number,
    context?: {
        source?: string;
        reason?: string;
    },
): { ok: true; current_round: number; active_actor: string | null; active_actor_index: number } | { ok: false; error: string } {
    const finalized = finalize_world_sim_interstitial(slot);
    if (!finalized.ok) {
        debug_log("TIMED_EVENT_TURN", "failed to finalize world sim interstitial round", {
            slot,
            source: context?.source ?? null,
            reason: context?.reason ?? null,
            error: finalized.error,
            timed_event_phase: get_timed_event_phase(slot),
            world_breath_index: get_timed_event_world_breath_index(slot),
        });
        return finalized;
    }
    debug_log("TIMED_EVENT_TURN", "canonical world sim interstitial finalize completed", {
        slot,
        source: context?.source ?? null,
        reason: context?.reason ?? null,
        current_round: finalized.current_round,
        active_actor_index: finalized.active_actor_index,
        active_actor: finalized.active_actor,
        timed_event_phase: get_timed_event_phase(slot),
        world_breath_index: get_timed_event_world_breath_index(slot),
    });
    return finalized;
}

export function finalize_timed_event_turn_if_exhausted(
    slot: number,
    actor_ref: string,
    context?: {
        source?: string;
        reason?: string;
        announce?: boolean;
    },
):
    | { ok: true; exhausted: false }
    | { ok: true; exhausted: true; advanced: true; interstitial_started?: boolean; current_round?: number | null; active_actor_index?: number | null; active_actor?: string | null }
    | { ok: false; error: string } {
    const active_actor_ref = get_active_actor_ref(slot);
    if (!active_actor_ref) return { ok: false, error: "no_active_timed_event" };
    if (active_actor_ref !== actor_ref) return { ok: false, error: "not_your_turn" };
    if (!should_auto_end_actor_turn(slot, actor_ref)) return { ok: true, exhausted: false };

    const advanced = advance_active_timed_event_turn(slot, actor_ref, {
        source: context?.source ?? "timed_event_auto_end",
        reason: context?.reason ?? "resources_exhausted",
        announce: context?.announce,
    });
    if ("error" in advanced) return { ok: false, error: advanced.error };
    return {
        ok: true,
        exhausted: true,
        advanced: true,
        interstitial_started: advanced.interstitial_started || undefined,
        current_round: advanced.current_round,
        active_actor_index: advanced.active_actor_index,
        active_actor: advanced.active_actor,
    };
}

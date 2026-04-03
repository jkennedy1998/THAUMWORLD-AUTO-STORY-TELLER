import { get_data_slot_dir, get_inbox_path, get_log_path, get_outbox_path, get_world_path } from "../engine/paths.js";
import { ensure_dir_exists, ensure_log_exists, append_log_message } from "../engine/log_store.js";
import { ensure_inbox_exists, append_inbox_message } from "../engine/inbox_store.js";
import { ensure_outbox_exists, read_outbox, write_outbox, append_outbox_message } from "../engine/outbox_store.js";
import { create_message } from "../engine/message.js";
import type { MessageInput } from "../engine/message.js";
import { debug_log, log_service_error } from "../shared/debug.js";
import { load_actor } from "../actor_storage/store.js";
import { load_npc } from "../npc_storage/store.js";
import {
    ensure_world_exists,
    clear_stale_timed_event,
    get_timed_event_state,
    save_world_store,
    start_timed_event,
    advance_turn,
    can_actor_afford_action_cost,
    consume_actor_action_cost,
    cancel_pending_communication_opportunity,
    consume_pending_communication_opportunity,
    finalize_timed_event_turn_if_exhausted,
    get_pending_communication_opportunities,
    has_pending_communication_opportunity,
    mark_actor_done,
    mark_actor_left_region,
    queue_pending_communication_opportunity,
    release_pending_communication_opportunity,
    sync_pending_communication_opportunities_with_queue,
    is_actor_in_region,
    get_timed_event_phase
} from "../world_storage/store.js";
import type { WorldStore } from "../world_storage/store.js";
import type { MessageEnvelope } from "../engine/types.js";
import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { SERVICE_CONFIG } from "../shared/constants.js";
import { build_working_memory, cleanup_expired_memories } from "../context_manager/index.js";
import type { TimedEventType } from "../shared/constants.js";
import { getDefaultCost } from "../action_system/registry.js";
import { face_target } from "../npc_ai/facing_system.js";
import { build_queue_transport_context, build_speech_turn_context, get_all_conversation_sessions, get_next_session_queue_entry, get_session_queue_entry, get_session_queue_entry_by_id, get_session_queue_entry_ids, get_session_queue_snapshot, mark_queue_entry_status_by_id } from "../conversation_manager/session_state.js";
import { get_configured_data_slot } from "../shared/boot_env.js";

const data_slot_number = get_configured_data_slot();
const POLL_MS = SERVICE_CONFIG.POLL_MS.TURN_MANAGER;

// Track which events we've already processed to avoid duplicates
const processedEventIds = new Set<string>();
const processedMessages = new Set<string>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function purge_stale_debug_timed_event_requests(outbox_path: string): number {
    const outbox = read_outbox(outbox_path);
    const before = outbox.messages.length;
    outbox.messages = outbox.messages.filter((message) => String(message.stage ?? "") !== "debug_timed_event_start");
    const removed = before - outbox.messages.length;
    if (removed > 0) {
        write_outbox(outbox_path, outbox);
        debug_log("TIMED_EVENT_BOOT", "purged stale debug timed event requests from outbox", {
            slot: data_slot_number,
            removed,
        });
    }
    return removed;
}

// Read actor/NPC DEX score for initiative
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
    return 50; // Default DEX
}

// Get actor location
function get_actor_location(slot: number, actor_ref: string): { world_x: number; world_y: number; region_x: number; region_y: number } | null {
    let location: Record<string, unknown> | null = null;
    
    if (actor_ref.startsWith("actor.")) {
        const actor_id = actor_ref.replace("actor.", "");
        const result = load_actor(slot, actor_id);
        if (result.ok) {
            location = result.actor.location as Record<string, unknown>;
        }
    } else if (actor_ref.startsWith("npc.")) {
        const npc_id = actor_ref.replace("npc.", "");
        const result = load_npc(slot, npc_id);
        if (result.ok) {
            location = result.npc.location as Record<string, unknown>;
        }
    }
    
    if (!location) return null;
    
    const world = (location.world_tile as Record<string, unknown>) ?? {};
    const region = (location.region_tile as Record<string, unknown>) ?? {};
    
    return {
        world_x: Number(world.x ?? 0),
        world_y: Number(world.y ?? 0),
        region_x: Number(region.x ?? 0),
        region_y: Number(region.y ?? 0)
    };
}

function get_entity_place_and_tile(slot: number, actor_ref: string): { place_id: string; x: number; y: number; z?: number } | null {
    let entity: Record<string, unknown> | null = null;
    if (actor_ref.startsWith("actor.")) {
        const actor_id = actor_ref.replace("actor.", "");
        const result = load_actor(slot, actor_id);
        if (result.ok) entity = result.actor;
    } else if (actor_ref.startsWith("npc.")) {
        const npc_id = actor_ref.replace("npc.", "");
        const result = load_npc(slot, npc_id);
        if (result.ok) entity = result.npc;
    }
    if (!entity) return null;
    const location = (entity.location as Record<string, unknown>) ?? {};
    const tile = (location.tile as Record<string, unknown>) ?? {};
    const place_id = String(location.place_id ?? "").trim();
    if (!place_id) return null;
    return {
        place_id,
        x: Math.floor(Number(tile.x ?? 0)) || 0,
        y: Math.floor(Number(tile.y ?? 0)) || 0,
        z: Number.isFinite(Number(location.elevation)) ? Math.floor(Number(location.elevation)) : undefined,
    };
}

function choose_npc_wander_goal(slot: number, actor_ref: string, target_ref?: string | null): { place_id: string; x: number; y: number; z?: number } | null {
    const npc_pos = get_entity_place_and_tile(slot, actor_ref);
    if (!npc_pos) return null;
    const target_pos = target_ref ? get_entity_place_and_tile(slot, target_ref) : null;
    if (target_pos && target_pos.place_id === npc_pos.place_id) {
        face_target(actor_ref, target_ref!, { x: target_pos.x, y: target_pos.y }, { x: npc_pos.x, y: npc_pos.y });
        const dx = Math.sign(target_pos.x - npc_pos.x);
        const dy = Math.sign(target_pos.y - npc_pos.y);
        if (dx !== 0 || dy !== 0) {
            return { place_id: npc_pos.place_id, x: npc_pos.x + dx, y: npc_pos.y + dy, z: npc_pos.z };
        }
        return null;
    }
    const wander_options = [
        { x: npc_pos.x + 1, y: npc_pos.y },
        { x: npc_pos.x - 1, y: npc_pos.y },
        { x: npc_pos.x, y: npc_pos.y + 1 },
        { x: npc_pos.x, y: npc_pos.y - 1 },
    ];
    const choice = wander_options[Math.floor(Math.random() * wander_options.length)] ?? null;
    return choice ? { place_id: npc_pos.place_id, x: choice.x, y: choice.y, z: npc_pos.z } : null;
}

async function request_entity_move_to(slot: number, actor_ref: string, goal: { place_id: string; x: number; y: number; z?: number }): Promise<boolean> {
    try {
        const response = await fetch("http://localhost:8787/api/movement/move_to", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                slot,
                entity_ref: actor_ref,
                place_id: goal.place_id,
                x: goal.x,
                y: goal.y,
                z: goal.z,
                mode: "WALK",
            }),
        });
        if (!response.ok) return false;
        const data = await response.json().catch(() => ({}));
        return !!data?.ok;
    } catch {
        return false;
    }
}

async function maybe_finalize_exhausted_turn(slot: number, actor_ref: string, context: Record<string, unknown>): Promise<boolean> {
    const result = finalize_timed_event_turn_if_exhausted(slot, actor_ref);
    if (!result.ok) {
        if (result.error !== "no_active_timed_event" && result.error !== "not_your_turn") {
            debug_log("TurnManager: failed to finalize exhausted turn", { actor: actor_ref, ...context, error: result.error });
        }
        return false;
    }
    if (!result.exhausted) return false;
    debug_log("TurnManager: marked exhausted turn done", {
        actor: actor_ref,
        ...context,
        advanced: result.advanced,
    });
    return true;
}

function ensure_pending_communication_from_session_queue(slot: number, actor_ref: string, store: WorldStore): void {
    if (!store.timed_event_active || !store.timed_event_id) return;
    const sessions = get_all_conversation_sessions(slot).filter((session) => session.timed_event_id === store.timed_event_id);
    for (const session of sessions) {
        const next_entry = get_next_session_queue_entry(slot, session.conversation_id);
        if (!next_entry || next_entry.participant_ref !== actor_ref) continue;

        const existing = get_pending_communication_opportunities(slot, session.conversation_id)
            .find((opp) => opp.queue_entry_id === next_entry.queue_entry_id && opp.npc_ref === actor_ref && (opp.status === "pending" || opp.status === "in_flight"));
        if (existing) {
            debug_log("TurnManager: session queue already has pending communication transport", {
                actor: actor_ref,
                conversation_id: session.conversation_id,
                queue_entry_id: next_entry.queue_entry_id,
                opportunity_id: existing.opportunity_id,
            });
            return;
        }

        const transport_context = build_queue_transport_context(slot, {
            conversation_id: session.conversation_id,
            participant_ref: actor_ref,
            queue_entry_id: next_entry.queue_entry_id,
        });
        const latest_message = transport_context.latest_external_turn;
        if (!latest_message) {
            debug_log("TurnManager: cannot create pending communication from session queue without transcript", {
                actor: actor_ref,
                conversation_id: session.conversation_id,
                queue_entry_id: next_entry.queue_entry_id,
            });
            return;
        }

        const queued = queue_pending_communication_opportunity(slot, {
            event_id: store.timed_event_id,
            queue_entry_id: transport_context.queue_entry?.queue_entry_id ?? next_entry.queue_entry_id,
            queue_stable_order: transport_context.queue_entry?.stable_order ?? next_entry.stable_order,
            source_message_id: transport_context.queue_entry?.joined_from_event_id ?? next_entry.joined_from_event_id,
            npc_ref: actor_ref,
            trigger_context: store.timed_event_trigger?.kind,
            created_turn: store.current_turn,
            created_round: store.current_round,
            conversation_id: session.conversation_id,
        });
        debug_log("TurnManager: created pending communication from session queue", {
            actor: actor_ref,
            conversation_id: session.conversation_id,
            queue_entry_id: next_entry.queue_entry_id,
            queue_stable_order: next_entry.stable_order,
            queued_ok: queued.ok,
            opportunity_id: queued.ok ? queued.opportunity_id : null,
            source_message_id: next_entry.joined_from_event_id,
            source_speaker_ref: latest_message.speaker_ref,
        });
        return;
    }
}

// Roll 1d20
function roll_d20(): number {
    return Math.floor(Math.random() * 20) + 1;
}

// Calculate DEX bonus from score (50 = 0, 60 = +1, 40 = -1, etc.)
function get_dex_bonus(dex: number): number {
    return Math.floor((dex - 50) / 10);
}

// Roll initiative for all participants
async function roll_initiative(slot: number, store: WorldStore): Promise<void> {
    if (!store.initiative_order) return;
    
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    // Roll initiative for each participant
    for (const entry of store.initiative_order) {
        const dex = get_actor_dex(slot, entry.actor_ref);
        const dex_bonus = get_dex_bonus(dex);
        const roll = roll_d20();
        entry.initiative_roll = roll + dex_bonus;
        entry.dex_score = dex;
        
        debug_log("TurnManager: initiative roll", {
            actor: entry.actor_ref,
            roll,
            dex_bonus,
            total: entry.initiative_roll
        });
        
        // Log the roll
        const actor_name = entry.actor_ref.split(".")[1] ?? entry.actor_ref;
        append_log_message(log_path, "system", `${actor_name} rolls initiative: ${roll} + ${dex_bonus} DEX = ${entry.initiative_roll}`);
    }
    
    // Sort by initiative (highest first), random tie-break for same DEX
    store.initiative_order.sort((a, b) => {
        if (b.initiative_roll !== a.initiative_roll) {
            return b.initiative_roll - a.initiative_roll;
        }
        // Same initiative roll - higher DEX wins
        if (b.dex_score !== a.dex_score) {
            return b.dex_score - a.dex_score;
        }
        // Same DEX - random tie-break
        return Math.random() - 0.5;
    });
    
    // Create initiative announcement message
    const order_text = store.initiative_order
        .map((e, i) => `${i + 1}. ${e.actor_ref.split(".")[1]} (${e.initiative_roll})`)
        .join("\n");
    
    const initiative_msg: MessageInput = {
        sender: "turn_manager",
        content: `Initiative order:\n${order_text}`,
        stage: "initiative_announcement",
        status: "sent",
        meta: {
            initiative_order: store.initiative_order.map(e => ({
                actor: e.actor_ref,
                roll: e.initiative_roll
            })),
            event_type: store.timed_event_type
        }
    };
    
    append_inbox_message(inbox_path, create_message(initiative_msg));
    append_log_message(log_path, "system", `Timed event started: ${store.timed_event_type}. ${store.initiative_order.length} participants.`);
    
    // Save the updated store
    save_world_store(slot, store);
}

// Check if actors have left the region
async function check_region_exits(slot: number, store: WorldStore): Promise<void> {
    if (!store.initiative_order || !store.event_region) return;
    
    const log_path = get_log_path(slot);
    
    for (const entry of store.initiative_order) {
        if (entry.status === "left_region") continue;
        
        const location = get_actor_location(slot, entry.actor_ref);
        if (!location) continue;
        
        const in_region = is_actor_in_region(slot, entry.actor_ref, location);
        if (!in_region) {
            mark_actor_left_region(slot, entry.actor_ref);
            const actor_name = entry.actor_ref.split(".")[1] ?? entry.actor_ref;
            append_log_message(log_path, "system", `${actor_name} has left the region and is no longer participating in the timed event.`);
            debug_log("TurnManager: actor left region", { actor: entry.actor_ref });
        }
    }
}

// Process NPC turn
async function process_npc_turn(slot: number, actor_ref: string, store: WorldStore): Promise<void> {
    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    debug_log("TurnManager: processing NPC turn", { actor: actor_ref });
    
    // For now, NPCs in timed events will just communicate once and pass
    // This is a simplified version - in the future, NPC AI could make tactical decisions
    
    const npc_id = actor_ref.replace("npc.", "");
    const npc_result = load_npc(slot, npc_id);
    
    if (!npc_result.ok) {
        // NPC not found, mark as done
        mark_actor_done(slot, actor_ref);
        return;
    }
    
    const npc = npc_result.npc;
    const npc_name = (npc.name as string) ?? npc_id;

    ensure_pending_communication_from_session_queue(slot, actor_ref, store);

    const in_flight_comm = get_pending_communication_opportunities(slot)
        .find((opp) => opp.npc_ref === actor_ref && opp.status === "in_flight");
    if (in_flight_comm) {
        debug_log("TurnManager: waiting for in-flight NPC communication to finish", {
            actor: actor_ref,
            opportunity_id: in_flight_comm.opportunity_id,
            conversation_id: in_flight_comm.conversation_id ?? null,
            queue_entry_id: in_flight_comm.queue_entry_id ?? null,
            queue_stable_order: in_flight_comm.queue_stable_order ?? null,
        });
        return;
    }

    const pending_comm = consume_pending_communication_opportunity(slot, actor_ref);
    if (pending_comm) {
        if (pending_comm.conversation_id) {
            const queue_sync = sync_pending_communication_opportunities_with_queue(slot, {
                conversation_id: pending_comm.conversation_id,
                valid_queue_entry_ids: get_session_queue_entry_ids(slot, pending_comm.conversation_id),
            });
            debug_log("TurnManager: synced pending communication opportunities before npc speech turn", {
                actor: actor_ref,
                conversation_id: pending_comm.conversation_id,
                queue_sync,
            });
        }
        const session_queue_entry = pending_comm.conversation_id
            ? (pending_comm.queue_entry_id
                ? get_session_queue_entry_by_id(slot, pending_comm.conversation_id, pending_comm.queue_entry_id)
                : get_session_queue_entry(slot, pending_comm.conversation_id, actor_ref))
            : null;
        const next_queue_entry = pending_comm.conversation_id
            ? get_next_session_queue_entry(slot, pending_comm.conversation_id)
            : null;
        const session_queue_snapshot = pending_comm.conversation_id
            ? get_session_queue_snapshot(slot, pending_comm.conversation_id).map((entry) => ({
                participant_ref: entry.participant_ref,
                stable_order: entry.stable_order,
                status: entry.status,
            }))
            : [];
        const pending_opportunity_snapshot = pending_comm.conversation_id
            ? get_pending_communication_opportunities(slot, pending_comm.conversation_id).map((opp) => ({
                opportunity_id: opp.opportunity_id,
                npc_ref: opp.npc_ref,
                queue_entry_id: opp.queue_entry_id ?? null,
                queue_stable_order: opp.queue_stable_order ?? null,
                status: opp.status,
            }))
            : [];
        const speech_turn_context = pending_comm.conversation_id
            ? build_speech_turn_context(slot, { conversation_id: pending_comm.conversation_id, participant_ref: actor_ref })
            : null;
        const queue_transport_context = pending_comm.conversation_id
            ? build_queue_transport_context(slot, {
                conversation_id: pending_comm.conversation_id,
                participant_ref: actor_ref,
                queue_entry_id: pending_comm.queue_entry_id,
            })
            : null;
        const transport_queue_entry = queue_transport_context?.queue_entry ?? null;
        const latest_external_turn = queue_transport_context?.latest_external_turn ?? null;
        const source_text = String(latest_external_turn?.text ?? "").trim();
        const source_speaker_ref = typeof latest_external_turn?.speaker_ref === "string" && latest_external_turn.speaker_ref.length > 0
            ? latest_external_turn.speaker_ref
            : null;
        const target_ref = transport_queue_entry?.target_refs[0] ?? null;
        const queue_social_role = transport_queue_entry?.social_role ?? null;
        const queue_reason_to_speak = transport_queue_entry?.reason_to_speak ?? null;
        debug_log("TurnManager: NPC turn using pending communication opportunity", {
            actor: actor_ref,
            opportunity_id: pending_comm.opportunity_id,
            queue_entry_id: pending_comm.queue_entry_id ?? null,
            queue_stable_order: pending_comm.queue_stable_order ?? null,
            conversation_id: pending_comm.conversation_id ?? null,
            session_queue_entry: session_queue_entry ? {
                participant_ref: session_queue_entry.participant_ref,
                stable_order: session_queue_entry.stable_order,
                social_role: session_queue_entry.social_role,
                status: session_queue_entry.status,
            } : null,
            next_queue_entry: next_queue_entry ? {
                participant_ref: next_queue_entry.participant_ref,
                stable_order: next_queue_entry.stable_order,
                status: next_queue_entry.status,
            } : null,
            speech_turn_context: speech_turn_context ? {
                participant_ref: speech_turn_context.participant_ref,
                current_mode: speech_turn_context.current_mode,
                participant_count: speech_turn_context.participants.length,
                transcript_recent_count: speech_turn_context.transcript_recent.length,
                transcript_summary_present: speech_turn_context.transcript_summary.length > 0,
                memory_factoid_count: speech_turn_context.memory_factoids_for_participant.length,
            } : null,
            queue_transport_context: queue_transport_context ? {
                queue_entry_id: queue_transport_context.queue_entry?.queue_entry_id ?? null,
                queue_social_role: queue_transport_context.queue_entry?.social_role ?? null,
                latest_external_turn_speaker_ref: queue_transport_context.latest_external_turn?.speaker_ref ?? null,
                latest_external_turn_present: !!queue_transport_context.latest_external_turn,
            } : null,
            session_queue_snapshot,
            pending_opportunity_snapshot,
        });
        if (pending_comm.queue_entry_id && !session_queue_entry) {
            const cancelled = cancel_pending_communication_opportunity(slot, pending_comm.opportunity_id, "missing_session_queue_entry");
            append_log_message(log_path, "system", `${npc_name} no longer has a valid place in the conversation queue.`);
            debug_log("TurnManager: cancelled pending communication because session queue entry is missing", {
                actor: actor_ref,
                opportunity_id: pending_comm.opportunity_id,
                queue_entry_id: pending_comm.queue_entry_id,
                cancelled,
                conversation_id: pending_comm.conversation_id ?? null,
            });
            mark_actor_done(slot, actor_ref);
            return;
        }
        if (!transport_queue_entry || !latest_external_turn || !source_speaker_ref || source_text.length === 0) {
            const cancelled = cancel_pending_communication_opportunity(slot, pending_comm.opportunity_id, "missing_queue_transport_context");
            if (pending_comm.conversation_id && pending_comm.queue_entry_id) {
                mark_queue_entry_status_by_id(slot, pending_comm.conversation_id, pending_comm.queue_entry_id, "cancelled");
            }
            append_log_message(log_path, "system", `${npc_name} cannot reconstruct the queued conversation context to respond.`);
            debug_log("TurnManager: cancelled pending communication because queue transport context is incomplete", {
                actor: actor_ref,
                opportunity_id: pending_comm.opportunity_id,
                conversation_id: pending_comm.conversation_id ?? null,
                queue_entry_id: pending_comm.queue_entry_id ?? null,
                has_queue_entry: !!transport_queue_entry,
                has_latest_external_turn: !!latest_external_turn,
                has_source_speaker_ref: !!source_speaker_ref,
                source_text_length: source_text.length,
                cancelled,
            });
            mark_actor_done(slot, actor_ref);
            return;
        }
        if (next_queue_entry && next_queue_entry.participant_ref !== actor_ref) {
            debug_log("TurnManager: pending communication actor is not front of queue", {
                actor: actor_ref,
                conversation_id: pending_comm.conversation_id ?? null,
                expected_front: next_queue_entry.participant_ref,
                actual_queue_entry: session_queue_entry?.participant_ref ?? null,
            });
            const released = release_pending_communication_opportunity(slot, pending_comm.opportunity_id);
            append_log_message(log_path, "system", `${npc_name} waits to speak; another queued speaker is ahead.`);
            debug_log("TurnManager: released pending communication because npc is not queue front", {
                actor: actor_ref,
                opportunity_id: pending_comm.opportunity_id,
                released,
                expected_front: next_queue_entry.participant_ref,
            });
            mark_actor_done(slot, actor_ref);
            return;
        }
        if (pending_comm.conversation_id && pending_comm.queue_entry_id) {
            mark_queue_entry_status_by_id(slot, pending_comm.conversation_id, pending_comm.queue_entry_id, "thinking");
            debug_log("TurnManager: marked queue entry thinking for pending communication", {
                actor: actor_ref,
                conversation_id: pending_comm.conversation_id,
                queue_entry_id: pending_comm.queue_entry_id,
            });
        }
        const communication_focus_ref = target_ref || source_speaker_ref;
        const move_goal = choose_npc_wander_goal(slot, actor_ref, communication_focus_ref);
        if (move_goal) {
            const moved = await request_entity_move_to(slot, actor_ref, move_goal);
            debug_log("TurnManager: NPC communication movement attempt", {
                actor: actor_ref,
                move_goal,
                moved,
                opportunity_id: pending_comm.opportunity_id,
            });
        }
        const communicate_cost = getDefaultCost("COMMUNICATE");
        if (!can_actor_afford_action_cost(slot, actor_ref, communicate_cost)) {
            const npc_action: MessageInput = {
                sender: actor_ref,
                content: `${npc_name} has no ${communicate_cost} action left to speak.`,
                stage: "npc_timed_action",
                status: "sent",
                meta: {
                    npc_id,
                    npc_name,
                    action_type: "COMMUNICATE_BLOCKED",
                    action_cost: communicate_cost,
                    turn_number: store.current_turn,
                    pending_opportunity_id: pending_comm.opportunity_id,
                },
            };
            append_inbox_message(inbox_path, create_message(npc_action));
            append_log_message(log_path, "system", `${npc_name} cannot respond; no ${communicate_cost} action left.`);
            debug_log("TurnManager: NPC lacks action cost for pending communication", {
                actor: actor_ref,
                action_cost: communicate_cost,
                opportunity_id: pending_comm.opportunity_id,
            });
            const released = release_pending_communication_opportunity(slot, pending_comm.opportunity_id);
            if (pending_comm.conversation_id && pending_comm.queue_entry_id) {
                mark_queue_entry_status_by_id(slot, pending_comm.conversation_id, pending_comm.queue_entry_id, "queued");
            }
            debug_log("TurnManager: released pending communication because actor has no action cost left", {
                actor: actor_ref,
                opportunity_id: pending_comm.opportunity_id,
                released,
            });
            mark_actor_done(slot, actor_ref);
            return;
        }

        const spent_ok = consume_actor_action_cost(slot, actor_ref, communicate_cost);
        if (!spent_ok) {
            append_log_message(log_path, "system", `${npc_name} failed to spend ${communicate_cost} action for communication.`);
            debug_log("TurnManager: failed spending NPC communication action cost", {
                actor: actor_ref,
                action_cost: communicate_cost,
                opportunity_id: pending_comm.opportunity_id,
            });
            const released = release_pending_communication_opportunity(slot, pending_comm.opportunity_id);
            if (pending_comm.conversation_id && pending_comm.queue_entry_id) {
                mark_queue_entry_status_by_id(slot, pending_comm.conversation_id, pending_comm.queue_entry_id, "queued");
            }
            debug_log("TurnManager: released pending communication after failing to spend action cost", {
                actor: actor_ref,
                opportunity_id: pending_comm.opportunity_id,
                released,
            });
            mark_actor_done(slot, actor_ref);
            return;
        }

        const outbox_path = get_outbox_path(slot);
        ensure_outbox_exists(outbox_path);

        const communicate_msg = create_message({
            sender: "turn_manager",
            content: `Service queued communication turn for ${pending_comm.npc_ref}`,
            stage: "service_queued_communication",
            status: "sent",
            correlation_id: pending_comm.correlation_id,
            conversation_id: pending_comm.conversation_id,
            meta: {
                service_kind: "queued_speech_turn",
                force_npc_ref: pending_comm.npc_ref,
                intent_subtype: pending_comm.volume ?? "NORMAL",
                timed_event_pending_opportunity_id: pending_comm.opportunity_id,
                timed_event_trigger_context: pending_comm.trigger_context,
                timed_event_queue_entry_id: pending_comm.queue_entry_id,
                timed_event_queue_stable_order: pending_comm.queue_stable_order,
            },
        });
        append_outbox_message(outbox_path, communicate_msg);

        const npc_action: MessageInput = {
            sender: actor_ref,
            content: `${npc_name} takes their turn to respond.`,
            stage: "npc_timed_action",
            status: "sent",
            meta: {
                npc_id,
                npc_name,
                action_type: "COMMUNICATE",
                action_cost: communicate_cost,
                turn_number: store.current_turn,
                pending_opportunity_id: pending_comm.opportunity_id,
            },
        };
        append_inbox_message(inbox_path, create_message(npc_action));
        append_log_message(log_path, "system", `${npc_name}'s turn: responding to conversation.`);
        debug_log("TurnManager: NPC consumed pending communication opportunity", {
            actor: actor_ref,
            opportunity_id: pending_comm.opportunity_id,
            source_message_id: pending_comm.source_message_id,
            queue_entry_id: pending_comm.queue_entry_id ?? null,
            queue_stable_order: pending_comm.queue_stable_order ?? null,
            action_cost: communicate_cost,
        });
        debug_log("TurnManager: NPC turn remains active while communication is being generated", {
            actor: actor_ref,
            opportunity_id: pending_comm.opportunity_id,
            conversation_id: pending_comm.conversation_id ?? null,
            queue_entry_id: pending_comm.queue_entry_id ?? null,
        });
        return;
    }
     
    // Check if there are active player actors to interact with
    const player_actors = store.initiative_order?.filter(e => 
        e.actor_ref.startsWith("actor.") && e.status === "active"
    ) ?? [];
    
    if (player_actors.length === 0) {
        // No players to interact with, just pass
        mark_actor_done(slot, actor_ref);
        return;
    }
    
    const player_target_ref = player_actors[0]?.actor_ref ?? null;
    const move_goal = choose_npc_wander_goal(slot, actor_ref, store.timed_event_type === "conversation" ? player_target_ref : null);
    let moved = false;
    if (move_goal) {
        moved = await request_entity_move_to(slot, actor_ref, move_goal);
        debug_log("TurnManager: NPC idle movement attempt", {
            actor: actor_ref,
            move_goal,
            moved,
            event_type: store.timed_event_type,
        });
    }

    // Simple behavior based on event type
    let action_text = "";
    if (store.timed_event_type === "combat") {
        action_text = moved ? "wanders cautiously" : "idles and watches the room";
    } else if (store.timed_event_type === "conversation") {
        action_text = moved ? "steps closer and listens" : "faces the speaker and listens";
    } else {
        action_text = moved ? "wanders a short distance" : "observes the surroundings";
    }
    
    // Create NPC action message
    const npc_action: MessageInput = {
        sender: actor_ref,
        content: `${npc_name} ${action_text}.`,
        stage: "npc_timed_action",
        status: "sent",
        meta: {
            npc_id: npc_id,
            npc_name: npc_name,
            action_type: store.timed_event_type,
            turn_number: store.current_turn
        }
    };
    
    append_inbox_message(inbox_path, create_message(npc_action));
    append_log_message(log_path, "system", `${npc_name}'s turn: ${action_text}`);
    
    if (await maybe_finalize_exhausted_turn(slot, actor_ref, { reason: "npc_idle_behavior", moved, event_type: store.timed_event_type })) {
        return;
    }

    mark_actor_done(slot, actor_ref);
    
    debug_log("TurnManager: NPC turn complete", { actor: actor_ref, action: action_text });
}

// Process turn advancement
async function process_turn_advancement(slot: number, store: WorldStore): Promise<void> {
    const fresh_store = get_timed_event_state(slot);
    if (!fresh_store?.timed_event_active) return;
    if (get_timed_event_phase(slot) === "world_sim_interstitial") return;

    const inbox_path = get_inbox_path(slot);
    const log_path = get_log_path(slot);
    
    // Check if current actor is done
    const active_index = fresh_store.active_actor_index ?? 0;
    const current_entry = fresh_store.initiative_order?.[active_index];
    
    if (!current_entry) return;

    debug_log("TIMED_EVENT_TURN", "turn manager inspected active turn state", {
        slot,
        active_actor: current_entry.actor_ref,
        status: current_entry.status,
        current_turn: fresh_store.current_turn ?? null,
        current_round: fresh_store.current_round ?? null,
        timed_event_phase: fresh_store.timed_event_phase ?? null,
        movement_budgets: current_entry.movement_budgets ?? null,
        actions_remaining: current_entry.actions_remaining ?? null,
        partial_actions_remaining: current_entry.partial_actions_remaining ?? null,
    });
    
    // If current actor is done, advance to next
    if (current_entry.status === "done" || current_entry.status === "left_region") {
        debug_log("TurnManager: advancing turn", { 
            from_actor: current_entry.actor_ref,
            turn: fresh_store.current_turn,
            movement_budgets: current_entry.movement_budgets ?? null,
            actions_remaining: current_entry.actions_remaining ?? null,
            partial_actions_remaining: current_entry.partial_actions_remaining ?? null,
        });
        
        const result = advance_turn(slot);

        if (!result.ok && result.error === "world_sim_interstitial_started") {
            append_log_message(log_path, "system", "Initiative cycle complete. World simulation interstitial has started.");
            debug_log("TurnManager: world sim interstitial started", {
                slot,
                turn: store.current_turn,
                round: store.current_round,
            });
            return;
        }

        if (result.ok) {
            // Create turn announcement
            const turn_announcement: MessageInput = {
                sender: "turn_manager",
                content: `Turn ${result.new_turn}: ${result.active_actor.split(".")[1]}'s turn`,
                stage: "turn_announcement",
                status: "sent",
                meta: {
                    turn_number: result.new_turn,
                    active_actor: result.active_actor,
                    event_type: fresh_store.timed_event_type
                }
            };
            
            append_inbox_message(inbox_path, create_message(turn_announcement));
            append_log_message(log_path, "system", `Turn ${result.new_turn}: ${result.active_actor.split(".")[1]}'s turn`);
            
        }
    }
}

// Check if event should end
async function check_event_end(slot: number, store: WorldStore): Promise<void> {
    if (!store.timed_event_active) return;
    debug_log("TurnManager: automatic timed event end disabled", {
        event_id: store.timed_event_id,
        current_turn: store.current_turn,
        current_round: store.current_round,
        reason: "manual_debug_end_only",
    });
}

// Process messages that trigger timed events
async function process_trigger_messages(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        const outbox = read_outbox(outbox_path);

        const start_timed_event_from_trigger = async (
            event_type: TimedEventType,
            participants: string[],
            location: { world_x: number; world_y: number; region_x: number; region_y: number },
            trigger: string,
            trigger_context?: { source_ref?: string; target_refs?: string[]; summary?: string },
        ): Promise<void> => {
            debug_log("TurnManager: starting timed event", {
                type: event_type,
                participants,
                trigger,
            });

            const result = start_timed_event(
                data_slot_number,
                event_type,
                participants,
                location,
                {
                    trigger: {
                        kind: trigger,
                        source_ref: trigger_context?.source_ref,
                        target_refs: trigger_context?.target_refs,
                        summary: trigger_context?.summary,
                    },
                },
            );

            if (!result.ok) return;

            const new_store = get_timed_event_state(data_slot_number);
            if (new_store) {
                await roll_initiative(data_slot_number, new_store);
            }

            const turn_store = get_timed_event_state(data_slot_number);
            const store_order = Array.isArray(turn_store?.initiative_order)
                ? turn_store.initiative_order.map((entry) => entry.actor_ref)
                : participants;
            const first_actor = turn_store?.initiative_order?.[0]?.actor_ref ?? null;
            const turn_announcement: MessageInput = {
                sender: "turn_manager",
                content: `Turn order: ${store_order.map((ref) => {
                    const parts = ref.split(".");
                    return parts[1] || ref;
                }).join(", ")}`,
                stage: "turn_order",
                status: "sent",
                meta: {
                    event_id: result.event_id,
                    initiative_order: store_order,
                    first_actor,
                },
            };
            append_inbox_message(inbox_path, create_message(turn_announcement));

            try {
                const region_id = `region.${location.world_x}_${location.world_y}_${location.region_x}_${location.region_y}`;
                await build_working_memory(
                    data_slot_number,
                    result.event_id,
                    event_type,
                    region_id,
                    participants,
                );
                debug_log("TurnManager: working memory built", { event_id: result.event_id, participants: participants.length });
            } catch (err) {
                debug_log("TurnManager: failed to build working memory", { error: err instanceof Error ? err.message : String(err) });
            }

            const start_announcement: MessageInput = {
                sender: "turn_manager",
                content: `Timed event begins! ${participants.length} participants.`,
                stage: "timed_event_start",
                status: "sent",
                meta: {
                    event_type,
                    participants,
                    event_id: result.event_id,
                    region: location,
                    trigger,
                    trigger_context: trigger_context ?? null,
                },
            };

            append_inbox_message(inbox_path, create_message(start_announcement));
            append_log_message(log_path, "system", `Timed event started: ${event_type} with ${participants.length} participants.`);
        };
        
        // Look for ruling messages that might trigger timed events
        const candidates = outbox.messages.filter((m: MessageEnvelope) => {
            const stage = String(m.stage ?? "");
            const is_ruling = stage.startsWith("ruling_") && m.status === "done";
            const is_debug_start = stage === "debug_timed_event_start";
            return (is_ruling || is_debug_start) && !processedMessages.has(m.id);
        });
        
        for (const msg of candidates) {
            processedMessages.add(msg.id);
            const meta = (msg.meta as Record<string, unknown>) ?? {};

            if (msg.stage === "debug_timed_event_start") {
                const store = get_timed_event_state(data_slot_number);
                if (store?.timed_event_active) continue;

                const participants = Array.isArray(meta.participants)
                    ? meta.participants.filter((p): p is string => typeof p === "string" && (p.startsWith("actor.") || p.startsWith("npc.")))
                    : [];
                if (participants.length < 2) continue;

                const first_participant = participants[0] ?? "";
                if (!first_participant) continue;
                const location = get_actor_location(data_slot_number, first_participant);
                if (!location) {
                    debug_log("TurnManager: cannot start debug timed event, no location", { participant: first_participant });
                    continue;
                }

                const requested_type = String(meta.event_type ?? "combat").toLowerCase();
                const event_type: TimedEventType = requested_type === "conversation" ? "conversation" : "combat";
                await start_timed_event_from_trigger(event_type, participants, location, "debug_start", {
                    summary: typeof meta.summary === "string" ? meta.summary : `Debug start for ${participants.length} participants`,
                });
                continue;
            }
            
            const events = meta.events as string[] ?? [];
            const machine_text = meta.machine_text as string ?? "";
            const sender = String(msg.sender ?? "");
            
            // Harmful USE and COMMUNICATE are the first-pass timed-event triggers.
            const is_harmful_use = events.some(e => e.includes(".USE(") && /health|injur|damage|harm/i.test(e))
                || (machine_text.includes(".USE(") && /health|injur|damage|harm/i.test(machine_text));
            const is_communicate = events.some(e => e.includes(".COMMUNICATE(")) || machine_text.includes(".COMMUNICATE(");
            
            if (!is_harmful_use && !is_communicate) continue;
            
            // Check if timed event is already active
            const store = get_timed_event_state(data_slot_number);
            if (store?.timed_event_active) {
                // Event already active, just continue
                continue;
            }
            
            // Extract participants from the message
            const participants: string[] = [];
            
            // Add the actor who initiated
            if (sender.startsWith("actor.") || sender.startsWith("npc.")) {
                participants.push(sender);
            }
            
            // Extract targets from events
            for (const event of events) {
                // Parse target from event strings like "actor.henry_actor.ATTACK(target=npc.goblin, ...)"
                const target_match = event.match(/target=(actor\.[^,)]+|npc\.[^,)]+)/);
                if (target_match) {
                    const target = target_match[1] ?? "";
                    if (!target) continue;
                    if (!participants.includes(target)) {
                        participants.push(target);
                    }
                }
            }
            
            if (participants.length < 2) {
                // Need at least 2 participants for a timed event
                continue;
            }
            
            // Get region from first participant
            const first_participant = participants[0] ?? "";
            if (!first_participant) continue;
            const location = get_actor_location(data_slot_number, first_participant);
            
            if (!location) {
                debug_log("TurnManager: cannot start timed event, no location", { participant: first_participant });
                continue;
            }
            
            const target_refs = participants.filter((ref) => ref !== sender);
            const event_type: TimedEventType = is_harmful_use ? "combat" : "conversation";
            await start_timed_event_from_trigger(event_type, participants, location, is_harmful_use ? "harmful_use" : "communicate", {
                source_ref: sender || undefined,
                target_refs,
                summary: is_harmful_use
                    ? "Hostile or injurious USE triggered timed event"
                    : "Communication escalation triggered timed event",
            });
        }
    } catch (err) {
        log_service_error("turn_manager", "process_trigger_messages", {}, err);
    }
}

// Main polling loop
let lastMemoryCleanup = 0;

async function tick(outbox_path: string, inbox_path: string, log_path: string): Promise<void> {
    try {
        // Periodic memory cleanup (every 60 seconds)
        const now = Date.now();
        if (now - lastMemoryCleanup > 60000) {
            const cleaned = cleanup_expired_memories(data_slot_number);
            if (cleaned > 0) {
                debug_log("TurnManager: cleaned up expired memories", { removed: cleaned });
            }
            lastMemoryCleanup = now;
        }
        
        // Process any new trigger messages
        await process_trigger_messages(outbox_path, inbox_path, log_path);
        
        // Get current timed event state
        const store = get_timed_event_state(data_slot_number);
        
        if (!store?.timed_event_active) {
            return; // No active timed event
        }
        
        // Check for region exits
        await check_region_exits(data_slot_number, store);
        
        // Store-backed turn advancement is authoritative.
        await process_turn_advancement(data_slot_number, store);

        const post_advance_store = get_timed_event_state(data_slot_number);
        const active_index = post_advance_store?.active_actor_index ?? -1;
        const active_entry = active_index >= 0 ? (post_advance_store?.initiative_order?.[active_index] ?? null) : null;
        if (
            post_advance_store?.timed_event_active &&
            active_entry &&
            active_entry.status === "active" &&
            active_entry.actor_ref.startsWith("npc.")
        ) {
            debug_log("TurnManager: auto-processing active NPC turn", {
                actor: active_entry.actor_ref,
                turn: post_advance_store.current_turn,
                round: post_advance_store.current_round,
                has_pending_communication: has_pending_communication_opportunity(data_slot_number, active_entry.actor_ref),
            });
            await process_npc_turn(data_slot_number, active_entry.actor_ref, post_advance_store);
        }

        // Refresh store state after potential changes
        const updated_store = get_timed_event_state(data_slot_number);
        if (updated_store?.timed_event_active) {
            // Check if event should end
            await check_event_end(data_slot_number, updated_store);
        }
        
    } catch (err) {
        log_service_error("turn_manager", "tick", {}, err);
    }
}

// Initialize function
function initialize(): { outbox_path: string; inbox_path: string; log_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const world_path = get_world_path(data_slot_number);
    
    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    purge_stale_debug_timed_event_requests(outbox_path);
    
    // Ensure world exists
    ensure_world_exists(data_slot_number);
    const stale_clear = clear_stale_timed_event(data_slot_number, "turn_manager_boot");
    if (!stale_clear.ok) {
        debug_log("TIMED_EVENT_BOOT", "failed to clear stale timed event on boot", {
            slot: data_slot_number,
            error: stale_clear.error,
        });
    }
    
    return { outbox_path, inbox_path, log_path };
}

// Boot the service
const { outbox_path, inbox_path, log_path } = initialize();
debug_log("TurnManager: booted", { 
    outbox_path, 
    inbox_path, 
    poll_ms: POLL_MS 
});

// Start polling
setInterval(() => {
    void tick(outbox_path, inbox_path, log_path);
}, POLL_MS);

// Also run immediately on startup
debug_log("TurnManager: running initial tick");
void tick(outbox_path, inbox_path, log_path);

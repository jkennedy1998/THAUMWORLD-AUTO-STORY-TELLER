import * as readline from "node:readline";
import * as http from "node:http";
import * as fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { debug_log, debug_warn, debug_error } from "../shared/debug.js";
import { ollama_chat } from "../shared/ollama_client.js";
import { isCurrentSession, getSessionMeta, SESSION_ID } from "../shared/session.js";
import { SERVICE_CONFIG } from "../shared/constants.js";

import { get_data_slot_dir, get_inbox_path, get_item_dir, get_log_path, get_outbox_path, get_status_path, get_world_dir, get_roller_status_path } from "../engine/paths.js";
import { read_inbox, clear_inbox, ensure_inbox_exists, append_inbox_message, write_inbox } from "../engine/inbox_store.js";
import { ensure_outbox_exists } from "../engine/outbox_store.js";
import { ensure_dir_exists, ensure_log_exists, read_log, append_log_envelope, append_log_message, prune_log_noise } from "../engine/log_store.js";
import { append_outbox_message } from "../engine/outbox_store.js";
import { create_correlation_id, create_message } from "../engine/message.js";
import { route_message } from "../engine/router.js";
import type { MessageEnvelope } from "../engine/types.js";
import type { LogFile } from "../engine/types.js";
import { ensure_status_exists, read_status, write_status_line } from "../engine/status_store.js";
import { ensure_roller_status_exists, read_roller_status, write_roller_status } from "../engine/roller_status_store.js";
import { ensure_actor_exists, find_actors, load_actor, save_actor, create_actor_from_kind } from "../actor_storage/store.js";
import { create_npc_from_kind, find_npcs, save_npc } from "../npc_storage/store.js";
import { get_timed_event_state, get_region_by_coords, is_timed_event_active } from "../world_storage/store.js";
import { travel_between_places } from "../travel/movement.js";
import { load_npc } from "../npc_storage/store.js";
import { load_place, list_places_in_region, save_place, create_basic_place } from "../place_storage/store.js";
import { load_container, list_containers_for_owner, transfer_item_between_containers, get_ground_items, build_ground_container_id, get_or_create_scattered_container, list_scattered_containers, delete_scattered_container_if_empty, add_item_to_container } from "../container_storage/store.js";
import { find_empty_grid_position } from "../shared/migration.js";
import { calculate_grid_dimensions } from "../types/container.js";
import { load_item_def, load_master_item } from "../item_storage/store.js";
import { create_inline_item } from "../item_instances/store.js";
import { load_master_tile } from "../tile_storage/store.js";
import { resolve_inline_item } from "../item_storage/resolve.js";
import { resolve_place_tile } from "../tile_storage/resolve.js";
import {
    load_actor_with_items,
    save_actor_with_items,
    get_all_actor_items,
    find_actor_item_by_id,
    remove_actor_item_by_id,
    add_item_to_body_slot,
    add_item_to_container as add_item_to_inline_container,
    remove_item_by_path,
    transfer_item_between_slots,
    find_first_container,
    ensure_actor_has_sack,
    create_inline_item as create_inline_item_from_store
} from "../item_storage/inline_store.js";
import {
    load_place_with_ground,
    save_place_with_ground,
    add_item_to_ground,
    add_item_to_main_ground,
    remove_item_from_ground,
    get_items_at_position,
    find_nearby_items,
    get_all_ground_items,
    create_ground_item,
    pickup_item_to_actor,
    drop_item_to_ground
} from "../place_storage/ground_store.js";
import { emitTagChange } from "../shared/event_emitter.js";
import type { PlaceConnection, PlaceItem } from "../types/place.js";
import {
    validate_transfer_destination,
    validate_deposit_into_container_item,
    validate_grid_target,
    resolve_target,
    resolve_actor_container_item,
    parse_body_slots_path,
    parse_actor_item_container_id,
    has_tag,
    get_container_capacity_max_slots,
    type GridTarget,
} from "../transfer/legality.js";

function normalize_inline_container_grid(contents: any[], max_slots: number, log_ctx: string): Array<{ item: any; grid_x: number; grid_y: number }> {
    const safe_contents = Array.isArray(contents) ? contents : [];
    const ms = (typeof max_slots === 'number' && Number.isFinite(max_slots) && max_slots > 0) ? Math.floor(max_slots) : safe_contents.length;
    const { cols, rows } = calculate_grid_dimensions(Math.max(1, ms));

    const used = new Set<string>();
    const normalized: Array<{ item: any; grid_x: number | null; grid_y: number | null }> = [];
    let invalid = 0;

    for (const it of safe_contents) {
        const x = (it as any)?.grid_x;
        const y = (it as any)?.grid_y;
        const has_xy = typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y);
        const slot_index = has_xy ? (y * cols + x) : -1;
        const in_bounds = has_xy && x >= 0 && y >= 0 && x < cols && y < rows && slot_index >= 0 && slot_index < ms;
        const key = has_xy ? `${x}_${y}` : '';
        const unique = in_bounds && !used.has(key);

        if (unique) {
            used.add(key);
            normalized.push({ item: it, grid_x: x, grid_y: y });
        } else {
            if (has_xy) invalid++;
            normalized.push({ item: it, grid_x: null, grid_y: null });
        }
    }

    let assigned = 0;
    for (const entry of normalized) {
        if (entry.grid_x !== null && entry.grid_y !== null) continue;

        let placed = false;
        for (let idx = 0; idx < ms; idx++) {
            const px = idx % cols;
            const py = Math.floor(idx / cols);
            const key = `${px}_${py}`;
            if (used.has(key)) continue;
            used.add(key);
            entry.grid_x = px;
            entry.grid_y = py;
            assigned++;
            placed = true;
            break;
        }

        if (!placed) {
            // No space - leave nulls.
        }
    }

    if (invalid > 0 || assigned > 0) {
        debug_log('API', `[GRID_SANITY] ${log_ctx} max_slots=${ms} invalid=${invalid} assigned=${assigned}`);
    }

    return normalized
        .filter((e) => e.grid_x !== null && e.grid_y !== null)
        .map((e) => ({ item: e.item, grid_x: e.grid_x as number, grid_y: e.grid_y as number }));
}

function resolve_inline_container_capacity(container_item: any, contents_len: number, log_ctx: string): { max_slots: number; max_weight: number | null; patched: boolean } {
    let patched = false;

    let max_slots: number | null = null;
    let max_weight: number | null = null;

    const cap = container_item?.container_capacity;
    if (cap && typeof cap.max_slots === 'number' && Number.isFinite(cap.max_slots) && cap.max_slots >= 1) {
        max_slots = Math.floor(cap.max_slots);
        if (typeof cap.max_weight === 'number' && Number.isFinite(cap.max_weight)) {
            max_weight = cap.max_weight;
        }
    }

    if (max_slots === null) {
        // Try item definition (legacy items may be missing container_capacity)
        const def_id = String(container_item?.def_id ?? '');
        if (def_id) {
            const def_result = load_master_item(def_id);
            if (def_result.ok) {
                const def_any: any = def_result.item as any;
                const slots = def_any?.container?.capacity_slots;
                const weight = def_any?.container?.capacity_weight;
                if (typeof slots === 'number' && Number.isFinite(slots) && slots >= 1) {
                    max_slots = Math.floor(slots);
                }
                if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
                    max_weight = weight;
                }
            }
        }
    }

    if (max_slots === null) {
        // Fallback: prefer a reasonable default over 0/empty.
        max_slots = Math.max(10, contents_len, 1);
    }

    // If data already violates capacity, expand to fit so UI doesn't hide items.
    if (contents_len > max_slots) {
        debug_log('API', `[CAPACITY_SANITY] ${log_ctx} expanding max_slots ${max_slots} -> ${contents_len}`);
        max_slots = contents_len;
        patched = true;
    }

    // Patch missing/invalid capacity back into the inline item.
    if (!container_item.container_capacity || typeof container_item.container_capacity.max_slots !== 'number' || container_item.container_capacity.max_slots < 1) {
        container_item.container_capacity = {
            max_slots,
            max_weight: max_weight ?? (container_item.container_capacity?.max_weight ?? null),
        };
        patched = true;
        debug_log('API', `[CAPACITY_SANITY] ${log_ctx} patched container_capacity.max_slots=${max_slots}`);
    }

    return { max_slots, max_weight, patched };
}

function resolve_inline_item_payload_for_api(item_any: any): {
    id: string;
    def_id: string;
    qty: number;
    name: string;
    unit_weight: number;
    display_char: string;
    display_color: string | null;
    tags: any[];
} {
    const id = String(item_any?.id ?? '');
    const def_id = String(item_any?.def_id ?? '');
    const qty_raw = item_any?.qty;
    const qty = (typeof qty_raw === 'number' && Number.isFinite(qty_raw))
        ? qty_raw
        : (Number(qty_raw ?? 1) || 1);

    const r = resolve_inline_item(def_id, item_any);

    const name = r?.name ?? (def_id || String(item_any?.name ?? 'item'));
    const unit_weight = r?.unit_weight ?? (typeof item_any?.weight === 'number' ? item_any.weight : 0);
    const tags = r?.effective_tags ?? (Array.isArray(item_any?.tags) ? item_any.tags : []);

    const base_char = typeof r?.display_char === 'string' ? r.display_char : '';
    const display_char = base_char && base_char.length > 0
        ? base_char.charAt(0)
        : (name ? String(name).charAt(0).toLowerCase() : '·');

    const display_color = (typeof r?.display_color === 'string' && r.display_color.length > 0)
        ? r.display_color
        : (typeof item_any?.display_color === 'string' ? item_any.display_color : null);

    return { id, def_id, qty, name, unit_weight, display_char, display_color, tags };
}

function get_place_base_z(place_any: any): number {
    const z = Number(place_any?.coordinates?.elevation);
    return (typeof z === 'number' && Number.isFinite(z)) ? Math.floor(z) : 0;
}

function get_place_tile_at_world_z(place_any: any, tx: number, ty: number, wz: number): any | null {
    const base_z = get_place_base_z(place_any);
    const z = Math.floor(Number(wz));
    if (!Number.isFinite(z)) return null;
    if (z === base_z) {
        return place_any?.tiles?.cells?.[ty]?.[tx] ?? null;
    }
    if (z === base_z - 1) {
        return place_any?.tiles_z0?.cells?.[ty]?.[tx] ?? null;
    }
    return null;
}

function place_tile_has_effective_tag(place_any: any, tx: number, ty: number, wz: number, tag: string): boolean {
    const tile = get_place_tile_at_world_z(place_any, tx, ty, wz);
    if (!tile) return false;
    const r = resolve_place_tile(String(tile.kind ?? ''), tile);
    const tags = r?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
    return Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? '').toUpperCase() === String(tag ?? '').toUpperCase());
}

function normalize_voxel_position_key(place_any: any, position_key: string): { key: string; x: number; y: number; z: number } | null {
    const parts = String(position_key ?? '').split('_');
    if (parts.length < 2) return null;
    const x = parseInt(parts[0] ?? '', 10);
    const y = parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const base_z = get_place_base_z(place_any);
    const z_raw = parts.length >= 3 ? parseInt(parts[2] ?? '', 10) : NaN;
    const z = Number.isFinite(z_raw) ? Math.floor(z_raw) : base_z;
    return { key: `${x}_${y}_${z}`, x, y, z };
}

function get_actor_world_z(actor_any: any, fallback_z: number): number {
    const z = Number(actor_any?.location?.elevation);
    return (typeof z === 'number' && Number.isFinite(z)) ? Math.floor(z) : fallback_z;
}

function within_range_xy_z(
    actor_pos: { x: number; y: number },
    actor_z: number,
    target_x: number,
    target_y: number,
    target_z: number,
    max_range_xy: number,
    max_range_z: number,
): boolean {
    const dx = Math.floor(target_x) - Math.floor(actor_pos.x);
    const dy = Math.floor(target_y) - Math.floor(actor_pos.y);
    const dist_xy = Math.sqrt(dx * dx + dy * dy);
    const dz = Math.abs(Math.floor(Number(target_z)) - Math.floor(Number(actor_z)));
    return dist_xy <= max_range_xy && dz <= max_range_z;
}

function try_deposit_into_tile_container(place_any: any, place_id: string, tx: number, ty: number, item: any): { ok: true } | { ok: false; error: string } {
    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
    if (!tile) return { ok: false, error: 'tile_not_found' };

    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
    const is_container = Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
    if (!is_container) return { ok: false, error: 'not_a_container' };

    if (!Array.isArray(tile.contents)) tile.contents = [];
    if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
        tile.container_capacity = { max_slots: Math.max(12, tile.contents.length + 1) };
    }
    const max_slots = Math.floor(tile.container_capacity.max_slots);
    if (tile.contents.length >= max_slots) return { ok: false, error: 'container_full' };

    // Ensure top-level entry and let normalizer assign grid.
    delete (item as any).grid_x;
    delete (item as any).grid_y;
    delete (item as any).elevation;
    tile.contents.push(item);

    const normalized = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);
    const coords_by_id = new Map<string, { x: number; y: number }>();
    for (const e of normalized) {
        coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
    }
    for (const it of tile.contents) {
        const id = String(it?.id ?? '');
        const c = coords_by_id.get(id);
        if (!c) continue;
        (it as any).grid_x = c.x;
        (it as any).grid_y = c.y;
    }
    return { ok: true };
}

function try_deposit_into_ground_container_item(place_any: any, place_id: string, tx: number, ty: number, wz: number, item: any): { ok: true } | { ok: false; error: string } {
    const key = `${tx}_${ty}_${Math.floor(Number(wz))}`;
    const list: any[] = Array.isArray(place_any?.ground?.scattered?.[key]) ? place_any.ground.scattered[key] : [];
    if (list.length < 1) return { ok: false, error: 'no_ground_items' };

    const base_z = get_place_base_z(place_any);
    const target_z = Math.floor(Number(wz));

    // Find the first container-item at the same world-z.
    for (const it of list) {
        const iz = (typeof (it as any)?.elevation === 'number' && Number.isFinite((it as any).elevation)) ? Math.floor((it as any).elevation) : base_z;
        if (!Number.isFinite(target_z) || iz !== target_z) continue;

        const payload = resolve_inline_item_payload_for_api(it);
        const is_container = Array.isArray(payload.tags) && payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
        if (!is_container) continue;

        if (!Array.isArray((it as any).contents)) (it as any).contents = [];
        const cap_res = resolve_inline_container_capacity(it, (it as any).contents.length, `ground_container_item:${place_id}:${String(it?.id ?? '')}`);
        if ((it as any).contents.length >= cap_res.max_slots) return { ok: false, error: 'container_full' };

        delete (item as any).grid_x;
        delete (item as any).grid_y;
        delete (item as any).elevation;
        (it as any).contents.push(item);

        const normalized = normalize_inline_container_grid((it as any).contents, cap_res.max_slots, `ground_container_item:${place_id}:${String(it?.id ?? '')}`);
        const coords_by_id = new Map<string, { x: number; y: number }>();
        for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
        for (const child of (it as any).contents) {
            const id = String(child?.id ?? '');
            const c = coords_by_id.get(id);
            if (!c) continue;
            (child as any).grid_x = c.x;
            (child as any).grid_y = c.y;
        }

        return { ok: true };
    }

    return { ok: false, error: 'no_container_item' };
}

function place_item_into_place_legal(place_any: any, place_id: string, tx: number, ty: number, target_wz: number, item: any): { ok: true; placed: 'tile_container' | 'container_item' | 'ground' } | { ok: false; error: string } {
    const base_z = get_place_base_z(place_any);
    const z = Number.isFinite(Number(target_wz)) ? Math.floor(Number(target_wz)) : base_z;

    // 1) Tile container present on this tile: always prefer depositing into it.
    // (Independent of target z; "container on this tile" wins over world placement.)
    {
        const tile = place_any?.tiles?.cells?.[ty]?.[tx];
        if (tile) {
            const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
            const is_container = Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
            if (is_container) {
                const dep = try_deposit_into_tile_container(place_any, place_id, tx, ty, item);
                if (!dep.ok) return { ok: false, error: dep.error };
                return { ok: true, placed: 'tile_container' };
            }
        }
    }

    // 1b) Ground container-item at this voxel.
    {
        const dep = try_deposit_into_ground_container_item(place_any, place_id, tx, ty, z, item);
        if (dep.ok) return { ok: true, placed: 'container_item' };
        // Ignore "no container" errors and fall through; only full should fail hard.
        if (dep.error === 'container_full') return { ok: false, error: dep.error };
    }

    // 2) If occupied, reject placement.
    if (place_tile_has_effective_tag(place_any, tx, ty, z, 'OCCUPIES')) {
        return { ok: false, error: 'target_occupied' };
    }

    // 3) Place into ground at this voxel.
    delete (item as any).grid_x;
    delete (item as any).grid_y;
    (item as any).elevation = z;
    const add_res = add_item_to_ground(place_any, tx, ty, item);
    if (!add_res.ok) return { ok: false, error: add_res.error };
    return { ok: true, placed: 'ground' };
}

function expand_body_slot_meta(meta: unknown): string[] {
    const m = String(meta ?? '').trim();
    if (!m) return [];
    if (m === 'hand') return ['hand_left', 'hand_right'];
    if (m === 'leg') return ['leg_left', 'leg_right'];
    if (m === 'head') return ['head'];
    if (m === 'torso') return ['torso'];
    if (['hand_left', 'hand_right', 'leg_left', 'leg_right'].includes(m)) return [m];
    return [];
}

function compute_compatible_slots_from_tags(tags: any[], log_ctx: string): Array<{ slot_name: string; slot_type: string; garb_index?: number }> {
    const compatible_slots: Array<{ slot_name: string; slot_type: string; garb_index?: number }> = [];
    const seen = new Set<string>();
    const push = (s: { slot_name: string; slot_type: string; garb_index?: number }) => {
        const key = `${s.slot_name}:${s.slot_type}:${s.garb_index ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        compatible_slots.push(s);
    };

    // All items can be held in tool slots
    push({ slot_name: 'hand_left', slot_type: 'tool' });
    push({ slot_name: 'hand_right', slot_type: 'tool' });

    const armor_tag = Array.isArray(tags) ? tags.find((t: any) => t?.name === 'ARMOR') : null;
    if (armor_tag) {
        const meta = Array.isArray(armor_tag.meta) ? armor_tag.meta : [];
        debug_log('API', `[COMPAT_META] ${log_ctx} ARMOR meta=${JSON.stringify(meta)}`);
        for (const m of meta) {
            const expanded = expand_body_slot_meta(m);
            if (expanded.length > 1) {
                debug_log('API', `[COMPAT_EXPAND] ${log_ctx} ARMOR meta=${String(m)} -> ${expanded.join(',')}`);
            }
            for (const slot_name of expanded) {
                push({ slot_name, slot_type: 'armor' });
            }
        }
    }

    const garb_tag = Array.isArray(tags) ? tags.find((t: any) => t?.name === 'GARB') : null;
    if (garb_tag) {
        const meta = Array.isArray(garb_tag.meta) ? garb_tag.meta : [];
        debug_log('API', `[COMPAT_META] ${log_ctx} GARB meta=${JSON.stringify(meta)}`);
        for (const m of meta) {
            const expanded = expand_body_slot_meta(m);
            if (expanded.length > 1) {
                debug_log('API', `[COMPAT_EXPAND] ${log_ctx} GARB meta=${String(m)} -> ${expanded.join(',')}`);
            }
            for (const slot_name of expanded) {
                for (let i = 0; i < 10; i++) {
                    push({ slot_name, slot_type: 'garb', garb_index: i });
                }
            }
        }
    }

    debug_log('API', `[COMPAT_RESULT] ${log_ctx} compatible_slots=${compatible_slots.length}`);
    return compatible_slots;
}
import { calculate_tile_distance, is_within_range } from "../types/container.js";
import { get_npc_location } from "../npc_storage/location.js";
import { get_entities_in_place } from "../place_storage/entity_index.js";
import { get_creation_state_path } from "../engine/paths.js";
import { load_kind_definitions } from "../kind_storage/store.js";
import { PROF_NAMES, STAT_VALUE_BLOCK } from "../character_rules/creation.js";
import { 
  initializeActionPipeline, 
  processPlayerAction,
  formatActionResult 
} from "./action_integration.js";
import { createIntent } from "../action_system/intent.js";
import { 
    format_inspection_result, type InspectorData, type InspectionResult 
} from "../inspection/data_service.js";
import type { InlineItem } from "../types/inline_item.js";
import { extract_feature_keywords_for_inspection, extract_body_slot_for_inspection } from "../inspection/text_parser.js";
import { 
  setActorTarget, 
  clearActorTarget, 
  getActorTarget,
  hasValidTarget 
} from "./target_state.js";
import { 
  setVolume, 
  getVolume, 
  handleCommunicationSubmit 
} from "./communication_input.js";
import type { VolumeLevel } from "./communication_input.js";
import { is_in_conversation as is_in_conversation_state } from "../npc_ai/conversation_state.js";
import { choose_follow_tile } from "./conversation_follow.js";
import {
  get_response_eligible_by_action,
  process_witness_event,
  update_conversations as update_witness_conversations,
} from "../npc_ai/witness_handler.js";
import { load_time, format_short_time, type GameTime } from "../time_system/tracker.js";

const data_slot_number = SERVICE_CONFIG.DEFAULT_DATA_SLOT || 1;
const visual_log_limit = 12;
const HTTP_PORT = 8787;

// (Legacy find_actor_sack removed; inline inventory uses actor.item/body_slots container paths.)
// const ENABLE_CLI_LOG = false;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const INTERPRETER_MODEL = process.env.INTERPRETER_MODEL ?? "llama3.2:latest";
const RENDERER_MODEL = process.env.RENDERER_MODEL ?? "llama3.2:latest";
// gpt-oss:20b is installed; swap back if you want higher quality.
const OLLAMA_BOOT_TIMEOUT_MS = 12_000;
const OLLAMA_WARMUP_TIMEOUT_MS = 600_000;
const OLLAMA_WARMUP_KEEP_ALIVE = "30m";

let current_state: "awaiting_user" | "processing" | "error" = "awaiting_user";
let message_buffer = ""; // message construction buffer
let incoming_message = ""; // received text from other programs (routing)
let ollama_process: ChildProcess | null = null;
let ollama_spawned = false;

// Facing update tracking for active conversations
const FACING_UPDATE_INTERVAL_MS = 100; // Update facing every 100ms during conversation (more responsive)
const last_facing_update = new Map<string, number>(); // npc_ref -> timestamp
const last_follow_update = new Map<string, number>(); // npc_ref -> timestamp

/**
 * Update facing for all active conversations
 * Uses the conversation state from npc_ai/conversation_state to track active conversations
 * Call this periodically (e.g., every tick)
 */
async function update_conversation_facing(): Promise<void> {
  const now = Date.now();
  
  // Import conversation state functions dynamically to avoid circular dependencies
  const { get_all_conversations } = await import("../npc_ai/conversation_state.js");
  const { send_face_command, send_move_command } = await import("../npc_ai/movement_command_sender.js");
  const { get_senses_for_action } = await import("../action_system/sense_broadcast.js");
  
  // Get all active conversations from the npc_ai system
  const conversations = get_all_conversations();

  // Conversation should maintain an audible/pressure distance by default.
  // Use COMMUNICATE.NORMAL pressure broadcast range as the "keep within" threshold.
  const pressure_range_tiles = (() => {
    const broadcasts = get_senses_for_action("COMMUNICATE", "NORMAL");
    const pressure = broadcasts.filter(b => b.sense === "pressure");
    if (pressure.length === 0) return 3;
    return Math.max(...pressure.map(p => p.range_tiles));
  })();
  
  for (const conv of conversations) {
    const npc_ref = conv.npc_ref;
    const actor_ref = conv.target_entity;
    
    // Check if enough time has passed since last update
    const last_update = last_facing_update.get(npc_ref) || 0;
    if (now - last_update < FACING_UPDATE_INTERVAL_MS) {
      continue;
    }
    
    // Update last facing time
    last_facing_update.set(npc_ref, now);
    
    // Send face command to keep NPC facing the actor
    send_face_command(npc_ref, actor_ref, "Maintain facing during conversation");

    // Keep within pressure (hearing/touch) distance by approaching if too far.
    // This uses stored tile positions (actor + npc) which are updated via movement APIs.
    try {
      const npc_id = npc_ref.replace("npc.", "");
      const actor_id = actor_ref.replace("actor.", "");

      const npc_res = load_npc(data_slot_number, npc_id);
      const actor_res = load_actor(data_slot_number, actor_id);

      const npc_loc = npc_res.ok ? (npc_res.npc as any)?.location : null;
      const actor_loc = actor_res.ok ? (actor_res.actor as any)?.location : null;

      const npc_tile = npc_loc?.tile;
      const actor_tile = actor_loc?.tile;

      const npc_place = npc_loc?.place_id;
      const actor_place = actor_loc?.place_id;

      if (!npc_tile || !actor_tile) continue;
      if (npc_place && actor_place && npc_place !== actor_place) continue;

      const dx = Number(actor_tile.x) - Number(npc_tile.x);
      const dy = Number(actor_tile.y) - Number(npc_tile.y);
      const dist = Math.sqrt(dx * dx + dy * dy);

      // If we're already within pressure distance, don't try to move.
      if (dist <= pressure_range_tiles) continue;

      // Rate-limit move commands (avoid spamming the renderer outbox).
      const last_follow = last_follow_update.get(npc_ref) || 0;
      if (now - last_follow < 800) continue;
      last_follow_update.set(npc_ref, now);

      const ax = Number(actor_tile.x);
      const ay = Number(actor_tile.y);

      // Prefer orthogonal adjacency, then diagonals.
      const candidates = [
        { x: ax + 1, y: ay },
        { x: ax - 1, y: ay },
        { x: ax, y: ay + 1 },
        { x: ax, y: ay - 1 },
        { x: ax + 1, y: ay + 1 },
        { x: ax + 1, y: ay - 1 },
        { x: ax - 1, y: ay + 1 },
        { x: ax - 1, y: ay - 1 },
      ];

      // Validate against place bounds and occupancy to avoid "stepping into" the actor tile
      // via downstream clamping.
      const occupied = new Set<string>();
      let bounds: { width: number; height: number } | undefined;

      if (actor_place) {
        const place_res = load_place(data_slot_number, actor_place);
        if (place_res.ok) {
          const w = Number((place_res.place as any)?.tile_grid?.width ?? NaN);
          const h = Number((place_res.place as any)?.tile_grid?.height ?? NaN);
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            bounds = { width: w, height: h };
          }

          const npcs_present = (place_res.place as any)?.contents?.npcs_present;
          const actors_present = (place_res.place as any)?.contents?.actors_present;
          if (Array.isArray(npcs_present)) {
            for (const n of npcs_present) {
              if (n?.npc_ref === npc_ref) continue;
              const t = n?.tile_position;
              if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) occupied.add(`${t.x},${t.y}`);
            }
          }
          if (Array.isArray(actors_present)) {
            for (const a of actors_present) {
              const t = a?.tile_position;
              if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) occupied.add(`${t.x},${t.y}`);
            }
          }
        }
      }

      const best = choose_follow_tile({
        npc_tile: { x: Number(npc_tile.x), y: Number(npc_tile.y) },
        actor_tile: { x: ax, y: ay },
        bounds,
        occupied,
      });
      if (!best) continue;
      send_move_command(npc_ref, best, `Maintain conversation distance (pressure<=${pressure_range_tiles})`);
    } catch {
      // Ignore follow failures; facing updates are still useful.
    }
  }
  
  // Clean up stale facing entries for ended conversations
  const active_npcs = new Set(conversations.map(c => c.npc_ref));
  for (const npc_ref of last_facing_update.keys()) {
    if (!active_npcs.has(npc_ref)) {
      last_facing_update.delete(npc_ref);
      last_follow_update.delete(npc_ref);
    }
  }
}

// other programs/applications can send this program text (a string)
function receive_text_from_other_program(text: string): void {
    incoming_message += text;
}

// flush incoming_message into message_buffer (shell)
function flush_incoming_messages(): void {
    if (!incoming_message) return;
    message_buffer += incoming_message;
    incoming_message = "";
}

// print last N lines of the log in a minimal "visual log" window
function render_visual_log(_log: LogFile, _last_n: number): void {}

function ensure_minimum_game_data(slot: number): void {
    const actors = find_actors(slot, {});
    if (actors.length === 0) {
        const created = ensure_actor_exists(slot, "henry_actor");
        if (created.ok) {
            debug_log("Boot: created default actor", { id: "henry_actor" });
        } else {
            debug_warn("Boot: failed to create default actor", { error: created.error, todo: created.todo });
        }
    }

    const npcs = find_npcs(slot, {}).filter((n) => n.id !== "default_npc");
    if (npcs.length === 0) {
        const actor_id = actors[0]?.id ?? "henry_actor";
        const actor = load_actor(slot, actor_id);
        const actor_location = actor.ok
            ? (actor.actor.location as Record<string, unknown>)
            : { world_tile: { x: 0, y: 0 }, region_tile: { x: 0, y: 0 }, tile: { x: 0, y: 0 } };
        const created = create_npc_from_kind(slot, { name: "stranger" });
        if (created.ok) {
            const npc = { ...created.npc, location: actor_location } as Record<string, unknown>;
            const npc_id = String(npc.id ?? "");
            if (npc_id) save_npc(slot, npc_id, npc);
            debug_log("Boot: created npc", { id: npc_id || "(unknown)" });
        } else {
            debug_warn("Boot: failed to create npc", { error: created.error, todo: created.todo });
        }
    }

    // TODO: add local generation rules for NPCs when actors travel in populated places.
    
    // Ensure Eden Crossroads places exist with proper connections
    ensure_eden_crossroads_places(slot);
}

/**
 * Ensure Eden Crossroads region has places with proper connections
 * This creates a connected hub area for testing
 */
function ensure_eden_crossroads_places(slot: number): void {
    const region_id = "eden_crossroads";
    
    // Define the places in Eden Crossroads
    const places_config = [
        {
            id: "eden_crossroads_square",
            name: "Eden Crossroads Square",
            is_default: true,
            width: 15,
            height: 15,
            description: "A bustling town square at the crossroads of several paths. Merchants hawk their wares while townsfolk gather around the central fountain."
        },
        {
            id: "eden_crossroads_grendas_shop",
            name: "Grenda's General Goods",
            is_default: false,
            width: 10,
            height: 10,
            description: "A cozy shop filled with adventuring supplies, dried meats, and odd trinkets. The smell of leather and herbs fills the air."
        },
        {
            id: "eden_crossroads_tavern",
            name: "The Rusty Anchor Tavern",
            is_default: false,
            width: 12,
            height: 12,
            description: "A lively tavern with weathered wooden beams and the aroma of hearty stew. Sailors and locals share stories over frothy mugs."
        },
        {
            id: "eden_crossroads_temple",
            name: "Temple of the Dawn",
            is_default: false,
            width: 10,
            height: 14,
            description: "A serene temple with stained glass windows casting colorful light. The air is thick with incense and quiet contemplation."
        }
    ];
    
    // Define connections between places
    const connections: Record<string, PlaceConnection[]> = {
        "eden_crossroads_square": [
            {
                target_place_id: "eden_crossroads_grendas_shop",
                direction: "north",
                description: "A wooden door leads to Grenda's shop",
                travel_time_seconds: 3
            },
            {
                target_place_id: "eden_crossroads_tavern",
                direction: "east",
                description: "A swinging door leads to the tavern",
                travel_time_seconds: 3
            },
            {
                target_place_id: "eden_crossroads_temple",
                direction: "west",
                description: "An arched doorway leads to the temple",
                travel_time_seconds: 4
            }
        ],
        "eden_crossroads_grendas_shop": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "south",
                description: "The shop door leads back to the square",
                travel_time_seconds: 3
            }
        ],
        "eden_crossroads_tavern": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "west",
                description: "The tavern door leads back to the square",
                travel_time_seconds: 3
            }
        ],
        "eden_crossroads_temple": [
            {
                target_place_id: "eden_crossroads_square",
                direction: "east",
                description: "The temple exit leads back to the square",
                travel_time_seconds: 4
            }
        ]
    };
    
    // Create places if they don't exist
    for (const config of places_config) {
        const existing = load_place(slot, config.id);
        if (!existing.ok) {
            // Place doesn't exist, create it
            const result = create_basic_place(slot, region_id, config.id, config.name, {
                is_default: config.is_default,
                width: config.width,
                height: config.height
            });
            
            if (result.ok) {
                // Add description
                result.place.description.short = config.name;
                result.place.description.full = config.description;
                
                // Add connections
                const place_connections = connections[config.id];
                if (place_connections) {
                    result.place.connections = place_connections;
                }
                
                save_place(slot, result.place);
                debug_log("Boot: created place", { id: config.id, name: config.name });
            } else {
                debug_warn("Boot: failed to create place", { id: config.id, error: "creation failed" });
            }
        } else {
            // Place exists, check/update connections
            const place = existing.place;
            let needs_save = false;
            
            // Check if connections need to be added or updated
            const config_connections = connections[config.id];
            if (config_connections) {
                // Check if we're missing any expected connections
                const existing_targets = new Set(place.connections.map(c => c.target_place_id));
                const expected_targets = new Set(config_connections.map(c => c.target_place_id));
                
                // Find missing connections
                const missing = config_connections.filter(c => !existing_targets.has(c.target_place_id));
                
                if (missing.length > 0) {
                    // Add missing connections
                    place.connections.push(...missing);
                    needs_save = true;
                    debug_log("Boot: added missing connections to place", { 
                        id: config.id, 
                        added: missing.length,
                        total: place.connections.length 
                    });
                }
            }
            
            if (needs_save) {
                save_place(slot, place);
            }
        }
    }
    
    debug_log("Boot: Eden Crossroads places initialized");
    
    // Ensure NPCs are placed in their locations
    ensure_npcs_in_places(slot);
}

/**
 * Ensure all NPCs are placed in valid locations
 */
function ensure_npcs_in_places(slot: number): void {
    const npcs = find_npcs(slot, {});
    
    for (const npc_data of npcs) {
        const npc_id = npc_data.id;
        const npc_res = load_npc(slot, npc_id);
        
        if (!npc_res.ok) continue;
        
        const npc = npc_res.npc as Record<string, unknown>;
        const location = npc.location as Record<string, unknown>;
        
        // Check if NPC has a valid place_id
        const place_id = location?.place_id as string;
        
        if (!place_id) {
            // NPC has no location, place them in the default place (square)
            const default_place_id = "eden_crossroads_square";
            const place_res = load_place(slot, default_place_id);
            
                if (place_res.ok) {
                    const w = place_res.place.tile_grid.width;
                    const h = place_res.place.tile_grid.height;
                    const min_x = w > 2 ? 1 : 0;
                    const max_x = w > 2 ? (w - 2) : Math.max(0, w - 1);
                    const min_y = h > 2 ? 1 : 0;
                    const max_y = h > 2 ? (h - 2) : Math.max(0, h - 1);
                    // Update NPC location
                    npc.location = {
                        world_tile: { x: 0, y: 0 },
                        region_tile: { x: 0, y: 0 },
                        place_id: default_place_id,
                        tile: { 
                        x: Math.floor(min_x + Math.random() * (max_x - min_x + 1)),
                        y: Math.floor(min_y + Math.random() * (max_y - min_y + 1))
                        },
                        elevation: 0
                    };
                
                save_npc(slot, npc_id, npc);
                debug_log("Boot: placed NPC in default location", { 
                    npc_id, 
                    place_id: default_place_id 
                });
            }
        }
    }
}

async function fetch_json(url: string, timeout_ms: number): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeout_ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`http_${res.status}`);
        return res.json();
    } finally {
        clearTimeout(timeout);
    }
}

async function check_ollama_server(host: string): Promise<{ ok: boolean; models: string[] }> {
    try {
        const data = (await fetch_json(`${host}/api/tags`, 2000)) as { models?: Array<{ name?: string }> };
        const models = Array.isArray(data?.models)
            ? data.models.map((m) => String(m?.name ?? "")).filter((m) => m.length > 0)
            : [];
        return { ok: true, models };
    } catch {
        return { ok: false, models: [] };
    }
}

async function wait_for_ollama(host: string, timeout_ms: number): Promise<{ ok: boolean; models: string[] }> {
    const start = Date.now();
    while (Date.now() - start < timeout_ms) {
        const status = await check_ollama_server(host);
        if (status.ok) return status;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { ok: false, models: [] };
}

async function ensure_ollama_running(): Promise<void> {
    debug_log("Ollama: checking server", { host: OLLAMA_HOST });
    const initial = await check_ollama_server(OLLAMA_HOST);
    if (initial.ok) {
        debug_log("Ollama: server already running", { models: initial.models.length });
        return;
    }

    debug_log("Ollama: starting local server");
    try {
        ollama_process = spawn("ollama", ["serve"], { stdio: "ignore", windowsHide: true });
        ollama_spawned = true;
    } catch (err) {
        debug_warn("Ollama: failed to spawn", { error: err instanceof Error ? err.message : String(err) });
        return;
    }

    const ready = await wait_for_ollama(OLLAMA_HOST, OLLAMA_BOOT_TIMEOUT_MS);
    if (!ready.ok) {
        debug_warn("Ollama: server did not respond in time", { host: OLLAMA_HOST });
        return;
    }

    debug_log("Ollama: server ready", { models: ready.models.length });
}

async function warmup_interpreter_model(): Promise<void> {
    if (!INTERPRETER_MODEL) return;
    debug_log("Ollama: warming interpreter model", { model: INTERPRETER_MODEL });
    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: INTERPRETER_MODEL,
            messages: [{ role: "user", content: "Warm up only. Reply OK." }],
            keep_alive: OLLAMA_WARMUP_KEEP_ALIVE,
            timeout_ms: OLLAMA_WARMUP_TIMEOUT_MS,
            options: { temperature: 0 },
        });
        debug_log("Ollama: warmup ok", { model: response.model, chars: response.content.length });
    } catch (err) {
        debug_warn("Ollama: warmup failed", {
            model: INTERPRETER_MODEL,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function warmup_renderer_model(): Promise<void> {
    if (!RENDERER_MODEL) return;
    debug_log("Ollama: warming renderer model", { model: RENDERER_MODEL });
    try {
        const response = await ollama_chat({
            host: OLLAMA_HOST,
            model: RENDERER_MODEL,
            messages: [{ role: "user", content: "Warm up only. Reply OK." }],
            keep_alive: OLLAMA_WARMUP_KEEP_ALIVE,
            timeout_ms: OLLAMA_WARMUP_TIMEOUT_MS,
            options: { temperature: 0 },
        });
        debug_log("Ollama: warmup ok", { model: response.model, chars: response.content.length });
    } catch (err) {
        debug_warn("Ollama: warmup failed", {
            model: RENDERER_MODEL,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function boot_ai_services(): Promise<void> {
    await ensure_ollama_running();
    await warmup_interpreter_model();
    await warmup_renderer_model();
}

function shutdown_ollama_if_spawned(): void {
    if (!ollama_spawned || !ollama_process) return;
    debug_log("Ollama: stopping spawned server");
    try {
        ollama_process.kill();
    } catch (err) {
        debug_warn("Ollama: failed to stop", { error: err instanceof Error ? err.message : String(err) });
    }
}

function log_ai_config(): void {
    debug_log("AI config", {
        host: OLLAMA_HOST,
        interpreter_model: INTERPRETER_MODEL,
        renderer_model: RENDERER_MODEL,
    });
}

type InputRequest = {
    text: string;
    sender?: string;
    intent_verb?: string;
    intent_subtype?: string;
    action_cost?: string;
    target_ref?: string;
};

type CreationState = {
    schema_version: 1;
    active: boolean;
    actor_id?: string;
    step?: string;
    data?: {
        kind_id?: string;
        name?: string;
        stats?: Record<string, number>;
        background?: string;
        prof_picks?: string[];
        gift_kind_choices?: string[];
        gift_greater_choice?: string | null;
    };
};

function read_creation_state(pathname: string): CreationState {
    if (!fs.existsSync(pathname)) return { schema_version: 1, active: false };
    const raw = fs.readFileSync(pathname, "utf-8");
    try {
        const parsed = JSON.parse(raw) as CreationState;
        if (parsed?.schema_version === 1) return parsed;
    } catch {
        return { schema_version: 1, active: false };
    }
    return { schema_version: 1, active: false };
}

function write_creation_state(pathname: string, state: CreationState): void {
    fs.writeFileSync(pathname, JSON.stringify(state, null, 2), "utf-8");
}

function list_kind_options(): string[] {
    const defs = load_kind_definitions();
    return defs.kinds
        .filter((k) => String(k.id ?? "") !== "DEFAULT_KIND")
        .map((k) => `${k.id} - ${k.name}`);
}

function parse_stat_assignment(input: string): Record<string, number> | null {
    const pairs = input.split(/[ ,]+/).filter((p) => p.includes("="));
    if (pairs.length < 6) return null;
    const out: Record<string, number> = {};
    for (const pair of pairs) {
        const [raw_key, raw_val] = pair.split("=");
        const key = String(raw_key ?? "").trim().toLowerCase();
        const val = Number(raw_val);
        if (!["con", "str", "dex", "wis", "int", "cha"].includes(key)) return null;
        if (!Number.isFinite(val)) return null;
        out[key] = val;
    }
    if (Object.keys(out).length !== 6) return null;
    const used = Object.values(out).sort((a, b) => a - b);
    const expected = [...STAT_VALUE_BLOCK].sort((a, b) => a - b);
    for (let i = 0; i < expected.length; i++) {
        if (used[i] !== expected[i]) return null;
    }
    return out;
}

type ProfValidationResult = {
    valid: boolean;
    invalid_profs: string[];
    wrong_count: boolean;
    entered_count: number;
    too_many_duplicates: boolean;
    duplicate_profs: string[];
    picks?: string[];
};

function validate_prof_picks(input: string, required_count: number): ProfValidationResult {
    const raw = input.split(/[\s,]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const result: ProfValidationResult = {
        valid: false,
        invalid_profs: [],
        wrong_count: raw.length !== required_count,
        entered_count: raw.length,
        too_many_duplicates: false,
        duplicate_profs: [],
    };

    // Check each prof is valid
    for (const entry of raw) {
        const key = entry.toLowerCase();
        if (!PROF_NAMES.includes(key)) {
            result.invalid_profs.push(entry);
        }
    }

    // Check for too many duplicates
    const counts: Record<string, number> = {};
    for (const entry of raw) {
        const key = entry.toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
        if (counts[key] > 2) {
            result.too_many_duplicates = true;
            if (!result.duplicate_profs.includes(key)) {
                result.duplicate_profs.push(key);
            }
        }
    }

    result.valid = result.invalid_profs.length === 0 &&
                   !result.wrong_count &&
                   !result.too_many_duplicates;

    if (result.valid) {
        result.picks = raw.map((p) => p.toLowerCase());
    }

    return result;
}

function parse_prof_picks(input: string, pick_count: number): string[] | null {
    const validation = validate_prof_picks(input, pick_count);
    return validation.valid ? validation.picks ?? null : null;
}

type GiftValidationResult = {
    valid: boolean;
    invalid_gifts: string[];
    wrong_count: boolean;
    entered_count: number;
    duplicates: string[];
    choices?: string[];
};

function validate_gift_choices(input: string, required_count: number, available: string[]): GiftValidationResult {
    const raw = input.split(/[,\n]+/).map((p) => p.trim()).filter((p) => p.length > 0);
    const result: GiftValidationResult = {
        valid: false,
        invalid_gifts: [],
        wrong_count: raw.length !== required_count,
        entered_count: raw.length,
        duplicates: [],
    };

    const chosen: string[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        const match = available.find((g) => g.toLowerCase() === entry.toLowerCase());
        if (!match) {
            result.invalid_gifts.push(entry);
        } else {
            if (seen.has(match.toLowerCase())) {
                result.duplicates.push(match);
            } else {
                seen.add(match.toLowerCase());
                chosen.push(match);
            }
        }
    }

    result.valid = result.invalid_gifts.length === 0 &&
                   !result.wrong_count &&
                   result.duplicates.length === 0;

    if (result.valid) {
        result.choices = chosen;
    }

    return result;
}

function parse_gift_choices(input: string, count: number, available: string[]): string[] | null {
    const validation = validate_gift_choices(input, count, available);
    return validation.valid ? validation.choices ?? null : null;
}

function format_gift_display(gift: Record<string, unknown>): string {
    const name = String(gift.name ?? "Unknown Gift");
    const abilities = Array.isArray(gift.granted_abilities) ? gift.granted_abilities : [];
    const description = abilities.join(" | ") || "No description available";
    return `${name} :\n${description}`;
}

function start_creation_flow(log_path: string, creation_path: string, actor_id: string): { user_message_id: string } {
    const user_msg = append_log_message(log_path, actor_id, "/create");
    const kinds = list_kind_options();
    const state: CreationState = { schema_version: 1, active: true, actor_id, step: "kind", data: {} };
    write_creation_state(creation_path, state);
    append_log_message(log_path, "system", `Character creation started. Choose a kind id:\n${kinds.map((k) => `- ${k}`).join("\n")}`);
    append_log_message(log_path, "hint", `Example: ${kinds[0] ?? "human"}`);
    write_status_line(get_status_path(data_slot_number), "character creation: choose kind");
    return { user_message_id: user_msg.id };
}

function handle_creation_input(
    log_path: string,
    creation_path: string,
    actor_id: string,
    text: string,
    state: CreationState,
): { user_message_id: string } {
    const user_msg = append_log_message(log_path, actor_id, text);
    const data = state.data ?? {};
    const step = state.step ?? "kind";

    if (text.trim().toLowerCase() === "/cancel") {
        write_creation_state(creation_path, { schema_version: 1, active: false });
        append_log_message(log_path, "system", "Character creation cancelled.");
        write_status_line(get_status_path(data_slot_number), "character creation cancelled");
        return { user_message_id: user_msg.id };
    }

    if (step === "kind") {
        const defs = load_kind_definitions();
        const match = defs.kinds.find((k) => String(k.id ?? "").toLowerCase() === text.trim().toLowerCase());
        if (!match) {
            append_log_message(log_path, "system", "Invalid kind id. Try again.");
            return { user_message_id: user_msg.id };
        }
        data.kind_id = String(match.id);
        state.step = "name";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Enter your character name:");
        append_log_message(log_path, "hint", "Example: Aldric Thorne");
        write_status_line(get_status_path(data_slot_number), "character creation: choose name");
        return { user_message_id: user_msg.id };
    }

    if (step === "name") {
        if (!text.trim()) {
            append_log_message(log_path, "system", "Name cannot be empty. Enter your character name:");
            return { user_message_id: user_msg.id };
        }
        data.name = text.trim();
        state.step = "stats";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(
            log_path,
            "system",
            `Assign stats using: con=56 str=54 dex=52 wis=48 int=46 cha=44 (use each value once).\nValues: ${STAT_VALUE_BLOCK.join(", ")}`,
        );
        append_log_message(log_path, "hint", "Example: con=56 str=54 dex=52 wis=48 int=46 cha=44");
        write_status_line(get_status_path(data_slot_number), "character creation: assign stats");
        return { user_message_id: user_msg.id };
    }

    if (step === "stats") {
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter stat assignments:");
            return { user_message_id: user_msg.id };
        }
        const stats = parse_stat_assignment(text);
        if (!stats) {
            append_log_message(log_path, "system", "Invalid stat assignment. Try again or type 'redo'.");
            return { user_message_id: user_msg.id };
        }
        data.stats = stats;
        state.step = "background";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Enter a background (one line):");
        append_log_message(log_path, "hint", "Example: I grew up in a small village on the edge of the forest...");
        write_status_line(get_status_path(data_slot_number), "character creation: background");
        return { user_message_id: user_msg.id };
    }

    if (step === "background") {
        if (!text.trim()) {
            append_log_message(log_path, "system", "Background cannot be empty. Enter a background:");
            return { user_message_id: user_msg.id };
        }
        data.background = text.trim();
        state.step = "profs";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(
            log_path,
            "system",
            `Pick 4 prof picks (comma-separated). Each prof can be chosen up to 2 times.\nProfs: ${PROF_NAMES.join(", ")}`,
        );
        append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
        write_status_line(get_status_path(data_slot_number), "character creation: profs");
        return { user_message_id: user_msg.id };
    }

    if (step === "profs") {
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 4 prof picks (comma-separated):");
            append_log_message(log_path, "system", `Available profs: ${PROF_NAMES.join(", ")}`);
            append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
            return { user_message_id: user_msg.id };
        }
        const validation = validate_prof_picks(text, 4);
        if (!validation.valid) {
            // Show specific error message
            if (validation.invalid_profs.length > 0) {
                append_log_message(log_path, "system", `Invalid prof(s): ${validation.invalid_profs.join(", ")}. Check spelling.`);
            } else if (validation.wrong_count) {
                append_log_message(log_path, "system", `You entered ${validation.entered_count} profs, but need exactly 4.`);
            } else if (validation.too_many_duplicates) {
                append_log_message(log_path, "system", `You can only pick the same prof twice maximum. Duplicates: ${validation.duplicate_profs.join(", ")}`);
            }
            // Show available profs once (user can scroll)
            append_log_message(log_path, "system", `Available profs: ${PROF_NAMES.join(", ")}`);
            append_log_message(log_path, "hint", "Example: quiet, perception, athletics, arcana");
            return { user_message_id: user_msg.id };
        }
        const picks = validation.picks!;
        data.prof_picks = picks;
        state.step = "gifts";
        state.data = data;
        write_creation_state(creation_path, state);

        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const gifts = Array.isArray(kind?.gift_of_kind) ? kind!.gift_of_kind : [];
        const gift_names = gifts.map((g: any) => String(g.name));
        if (gifts.length === 0) {
            state.step = "confirm";
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "No kind gifts available. Type 'confirm' to create your character or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            write_status_line(get_status_path(data_slot_number), "character creation: confirm");
            return { user_message_id: user_msg.id };
        }
        append_log_message(log_path, "system", "Pick 2 gifts of kind (comma-separated):");
        append_log_message(log_path, "system", "Available gifts:");
        for (const gift of gifts) {
            append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
        }
        append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
        write_status_line(get_status_path(data_slot_number), "character creation: gifts");
        return { user_message_id: user_msg.id };
    }

    if (step === "gifts") {
        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const gifts = Array.isArray(kind?.gift_of_kind) ? kind!.gift_of_kind : [];
        const gift_names = gifts.map((g: any) => String(g.name));
        const required_count = Math.min(2, gift_names.length);

        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 2 gifts of kind (comma-separated):");
            append_log_message(log_path, "system", "Available gifts:");
            for (const gift of gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
            return { user_message_id: user_msg.id };
        }

        const validation = validate_gift_choices(text, required_count, gift_names);
        if (!validation.valid) {
            // Show specific error message
            if (validation.invalid_gifts.length > 0) {
                append_log_message(log_path, "system", `Invalid gift(s): ${validation.invalid_gifts.join(", ")}. Check spelling.`);
            } else if (validation.wrong_count) {
                append_log_message(log_path, "system", `You entered ${validation.entered_count} gifts, but need exactly ${required_count}.`);
            } else if (validation.duplicates.length > 0) {
                append_log_message(log_path, "system", `You cannot pick the same gift twice. Duplicates: ${validation.duplicates.join(", ")}`);
            }
            // Show available gifts formatted (user can scroll)
            append_log_message(log_path, "system", "Available gifts:");
            for (const gift of gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${gift_names.slice(0, 2).join(", ")}`);
            return { user_message_id: user_msg.id };
        }
        const choices = validation.choices!;
        data.gift_kind_choices = choices;
        const greater = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind.map((g: any) => String(g.name)) : [];
        if (greater.length === 0) {
            state.step = "confirm";
            state.data = data;
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "No greater gifts available. Type 'confirm' to create your character or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            write_status_line(get_status_path(data_slot_number), "character creation: confirm");
            return { user_message_id: user_msg.id };
        }
        const greater_gifts = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind : [];
        const greater_names = greater_gifts.map((g: any) => String(g.name));
        state.step = "greater_gift";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Pick 1 gift of greater kind:");
        append_log_message(log_path, "system", "Available greater gifts:");
        for (const gift of greater_gifts) {
            append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
        }
        append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
        write_status_line(get_status_path(data_slot_number), "character creation: greater gift");
        return { user_message_id: user_msg.id };
    }

    if (step === "greater_gift") {
        const kind = data.kind_id ? load_kind_definitions().kinds.find((k) => String(k.id) === data.kind_id) : null;
        const greater_gifts = Array.isArray(kind?.gift_of_greater_kind) ? kind!.gift_of_greater_kind : [];
        const greater_names = greater_gifts.map((g: any) => String(g.name));
        
        if (text.trim().toLowerCase() === "redo") {
            append_log_message(log_path, "system", "Re-enter 1 gift of greater kind:");
            append_log_message(log_path, "system", "Available greater gifts:");
            for (const gift of greater_gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
            return { user_message_id: user_msg.id };
        }
        
        const match = greater_names.find((g) => g.toLowerCase() === text.trim().toLowerCase());
        if (!match) {
            append_log_message(log_path, "system", `Invalid greater gift: "${text.trim()}". Check spelling.`);
            append_log_message(log_path, "system", "Available greater gifts:");
            for (const gift of greater_gifts) {
                append_log_message(log_path, "system", format_gift_display(gift as Record<string, unknown>));
            }
            append_log_message(log_path, "hint", `Example: ${greater_names[0] ?? "fey ancestry"}`);
            return { user_message_id: user_msg.id };
        }
        data.gift_greater_choice = match;
        state.step = "confirm";
        state.data = data;
        write_creation_state(creation_path, state);
        append_log_message(log_path, "system", "Type 'confirm' to create your character or 'redo' to restart.");
        append_log_message(log_path, "hint", "Example: confirm");
        write_status_line(get_status_path(data_slot_number), "character creation: confirm");
        return { user_message_id: user_msg.id };
    }

    if (step === "confirm") {
        if (text.trim().toLowerCase() === "redo") {
            state.step = "kind";
            state.data = {};
            write_creation_state(creation_path, state);
            append_log_message(log_path, "system", "Restarting creation. Choose a kind id:");
            const kinds = list_kind_options();
            append_log_message(log_path, "hint", `Example: ${kinds[0] ?? "human"}`);
            write_status_line(get_status_path(data_slot_number), "character creation: choose kind");
            return { user_message_id: user_msg.id };
        }
        if (text.trim().toLowerCase() !== "confirm") {
            append_log_message(log_path, "system", "Type 'confirm' to finish or 'redo' to restart.");
            append_log_message(log_path, "hint", "Example: confirm");
            return { user_message_id: user_msg.id };
        }
        const input = {
            actor_id,
            name: data.name ?? actor_id,
            kind_id: data.kind_id ?? "DEFAULT_KIND",
            gift_kind_choices: data.gift_kind_choices ?? [],
            gift_greater_choice: data.gift_greater_choice ?? null,
            stats: data.stats,
            prof_picks: data.prof_picks ?? [],
            background: data.background,
        };
        const created = create_actor_from_kind(data_slot_number, input);
        if (!created.ok) {
            append_log_message(log_path, "system", `Character creation failed: ${created.todo}`);
            return { user_message_id: user_msg.id };
        }
        write_creation_state(creation_path, { schema_version: 1, active: false });
        append_log_message(log_path, "system", `Character created: ${created.actor.name ?? actor_id}`);
        write_status_line(get_status_path(data_slot_number), "character creation complete");
        return { user_message_id: user_msg.id };
    }

    append_log_message(log_path, "system", "Creation step not recognized. Type /create to restart.");
    return { user_message_id: user_msg.id };
}

function start_http_server(log_path: string): void {
    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/api/input") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const MAX_BYTES = 64 * 1024;
            let body = "";

            req.on("data", (chunk) => {
                body += chunk;
                if (body.length > MAX_BYTES) {
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
                    req.destroy();
                }
            });

            req.on("end", () => {
                let parsed: InputRequest | null = null;
                try {
                    parsed = JSON.parse(body) as InputRequest;
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
                    return;
                }

                const text = typeof parsed?.text === "string" ? parsed.text : "";
                if (!text.trim()) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "empty_text" }));
                    return;
                }

                const sender = typeof parsed?.sender === "string" && parsed.sender.trim().length > 0
                    ? parsed.sender.trim()
                    : "J";

                const intent_verb = typeof parsed?.intent_verb === "string" ? parsed.intent_verb.trim() : "";
                const intent_subtype = typeof parsed?.intent_subtype === "string" ? parsed.intent_subtype.trim() : "";
                const action_cost = typeof parsed?.action_cost === "string" ? parsed.action_cost.trim() : "";
                const target_ref = typeof parsed?.target_ref === "string" ? parsed.target_ref.trim() : "";

                const ui_target_tile = (parsed as any)?.ui_target_tile;
                const ui_target_tile_xy = (ui_target_tile && typeof ui_target_tile === "object")
                    ? {
                        x: Number((ui_target_tile as any).x),
                        y: Number((ui_target_tile as any).y),
                    }
                    : null;
                const ui_target_tile_safe = (ui_target_tile_xy && Number.isFinite(ui_target_tile_xy.x) && Number.isFinite(ui_target_tile_xy.y))
                    ? { x: Math.round(ui_target_tile_xy.x), y: Math.round(ui_target_tile_xy.y) }
                    : null;

                const creation_path = get_creation_state_path(data_slot_number);
                const creation_state = read_creation_state(creation_path);
                if (creation_state.active && creation_state.actor_id === sender) {
                    const handled = handle_creation_input(log_path, creation_path, sender, text, creation_state);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, id: handled.user_message_id }));
                    return;
                }

                if (text.trim().toLowerCase() === "/create") {
                    const handled = start_creation_flow(log_path, creation_path, sender);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, id: handled.user_message_id }));
                    return;
                }

                current_state = "processing";

                // Check if timed event is active and use event_id as correlation_id
                const timed_event = get_timed_event_state(data_slot_number);
                const correlation_id = timed_event?.timed_event_active && timed_event?.event_id
                    ? timed_event.event_id
                    : create_correlation_id();

                // Default to COMMUNICATE if no intent specified but we have a target and text
                // This handles "hello grenda" style messages without explicit intent buttons
                const effective_intent = intent_verb || (target_ref ? "COMMUNICATE" : undefined);
                
                const inbound = create_message({
                    sender,
                    content: text,
                    type: "user_input",
                    status: "queued",
                    correlation_id,
                    meta: {
                        ...getSessionMeta(),
                        timed_event_active: timed_event?.timed_event_active || false,
                        event_id: timed_event?.event_id || null,
                        // Optional UI overrides
                        intent_verb: effective_intent,
                        intent_subtype: intent_subtype || undefined,
                        action_cost: action_cost || undefined,
                        target_ref: target_ref || undefined,
                        ui_target_tile: ui_target_tile_safe || undefined,
                    },
                });

                append_inbox_message(inbox_path, inbound);
                // Also append the canonical user_input envelope to the log so the UI
                // can group/dedup using correlation_id + session_id.
                append_log_envelope(log_path, inbound);
                current_state = "awaiting_user";

                write_status_line(get_status_path(data_slot_number), "received actor input");

                debug_log("HTTP input received", { sender, length: text.length, id: inbound.id });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, id: inbound.id }));
            });
            return;
        }

        if (url.pathname === "/api/roller_status") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            try {
                const status = read_roller_status(get_roller_status_path(data_slot_number));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status }));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "failed_to_read" }));
            }
            return;
        }

        if (url.pathname === "/api/roll") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const MAX_BYTES = 16 * 1024;
            let body = "";

            req.on("data", (chunk) => {
                body += chunk;
                if (body.length > MAX_BYTES) {
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
                    req.destroy();
                }
            });

            req.on("end", () => {
                let parsed: { roll_id?: string } | null = null;
                try {
                    parsed = JSON.parse(body) as { roll_id?: string };
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
                    return;
                }

                const roll_id = typeof parsed?.roll_id === "string" ? parsed.roll_id : "";
                if (!roll_id) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "missing_roll_id" }));
                    return;
                }

                const roll_input = create_message({
                    sender: "roller_ui",
                    content: "roll",
                    status: "sent",
                    stage: "roll_input_1",
                    meta: { roll_id },
                });

                append_outbox_message(outbox_path, roll_input);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, id: roll_input.id }));
            });
            return;
        }

        if (url.pathname === "/api/log") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const log = read_log(get_log_path(slot));
                const all = url.searchParams.get("all") === "1";
                const messages = all ? log.messages : log.messages.filter((m) => isCurrentSession(m));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, messages }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/status") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            try {
                const status = read_status(get_status_path(slot));
                const time: GameTime | null = load_time(slot);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    status,
                    game_time: time,
                    time_short: time ? format_short_time(time) : null,
                    day: time ? time.day : null,
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "read_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/health") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            // Check if services are responsive by checking recent log activity
            try {
                const log = read_log(log_path);
                const recentMessages = log.messages.slice(-10);
                const serviceActivity: Record<string, number> = {};
                
                for (const msg of recentMessages) {
                    const sender = msg.sender?.toLowerCase() ?? 'unknown';
                    serviceActivity[sender] = (serviceActivity[sender] ?? 0) + 1;
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    status: "healthy",
                    session_id: SESSION_ID,
                    services: {
                        interface_program: true,
                        recent_activity: serviceActivity,
                        total_recent_messages: recentMessages.length
                    }
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "health_check_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/place") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            if (!place_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_place_id" }));
                return;
            }

            try {
                // Load base place data
                const place_res = load_place(slot, place_id);
                if (!place_res.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "place_not_found", details: place_res.error }));
                    return;
                }

                const place = place_res.place;

                // Tile growth processing (Phase: tiles-as-entities).
                // Run BEFORE we repopulate place.contents so persistence does not capture derived entity lists.
                try {
                    const time_now = load_time(slot);
                    const now_tick = typeof time_now?.total_minutes === 'number' ? Math.floor(time_now.total_minutes) : 0;
                    let dirty_tiles = false;

                    function has_tag_name(tags: any[], name: string): boolean {
                        const up = name.toUpperCase();
                        return Array.isArray(tags) && tags.some((t: any) => String(t?.name ?? '').toUpperCase() === up);
                    }

                    function drop_to_ground_stacking(place_any: any, gx: number, gy: number, item: any, def: any): void {
                        if (!place_any.ground) place_any.ground = { main: [], scattered: {} };
                        if (!place_any.ground.scattered) place_any.ground.scattered = {};
                        const key = `${gx}_${gy}`;
                        if (!place_any.ground.scattered[key]) place_any.ground.scattered[key] = [];

                        const max_stack = typeof def?.max_stack_size === 'number' && Number.isFinite(def.max_stack_size) ? Math.floor(def.max_stack_size) : 1;
                        const can_stack = (def?.stackable === true) || max_stack > 1;
                        if (can_stack) {
                            for (const existing of place_any.ground.scattered[key]) {
                                if (!existing) continue;
                                if (existing.def_id !== item.def_id) continue;
                                if (existing.contents) continue;
                                const ex_qty = Number(existing.qty ?? 1);
                                const add_qty = Number(item.qty ?? 1);
                                if (!Number.isFinite(ex_qty) || !Number.isFinite(add_qty)) continue;
                                if (ex_qty >= max_stack) continue;
                                const space = max_stack - ex_qty;
                                const moved = Math.min(space, add_qty);
                                if (moved <= 0) continue;
                                existing.qty = ex_qty + moved;
                                item.qty = add_qty - moved;
                                if (item.qty <= 0) return;
                            }
                        }

                        // New stack or remainder
                        delete item.grid_x;
                        delete item.grid_y;
                        place_any.ground.scattered[key].push(item);
                    }

                    const tiles_any = (place as any)?.tiles;
                    const cells = tiles_any?.cells;
                    if (Array.isArray(cells)) {
                        for (let ty = 0; ty < cells.length; ty++) {
                            const row = cells[ty];
                            if (!Array.isArray(row)) continue;
                            for (let tx = 0; tx < row.length; tx++) {
                                const tile = row[tx];
                                if (!tile) continue;
                                const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                                if (!has_tag_name(tags, 'GROW')) continue;

                                if (typeof tile.last_tick_processed !== 'number' || !Number.isFinite(tile.last_tick_processed)) {
                                    tile.last_tick_processed = now_tick;
                                    dirty_tiles = true;
                                    continue;
                                }

                                const last = Math.floor(tile.last_tick_processed);
                                const delta = now_tick - last;
                                if (delta <= 0) continue;

                                // Parse grow config from tag.info
                                const grow_tag = tags.find((t: any) => String(t?.name ?? '').toUpperCase() === 'GROW');
                                const info = grow_tag?.info;
                                let def_ids: string[] = [];
                                let period_min = 120;

                                if (info && typeof info === 'object' && !Array.isArray(info)) {
                                    const any_info: any = info;
                                    if (Array.isArray(any_info.def_ids)) {
                                        def_ids = any_info.def_ids.map((s: any) => String(s ?? '').trim()).filter((s: string) => s.length > 0);
                                    }
                                    if (typeof any_info.period_ticks === 'number' && Number.isFinite(any_info.period_ticks) && any_info.period_ticks > 0) {
                                        period_min = Math.floor(any_info.period_ticks);
                                    } else if (typeof any_info.period_min_ticks === 'number' && Number.isFinite(any_info.period_min_ticks) && any_info.period_min_ticks > 0) {
                                        period_min = Math.floor(any_info.period_min_ticks);
                                    }
                                } else if (Array.isArray(info)) {
                                    def_ids = info.map((s: any) => String(s ?? '').trim()).filter((s: string) => s.length > 0);
                                }

                                if (def_ids.length === 0) {
                                    // No grow outputs configured; just advance tick.
                                    tile.last_tick_processed = now_tick;
                                    dirty_tiles = true;
                                    continue;
                                }

                                const events = Math.min(200, Math.floor(delta / Math.max(1, period_min)));
                                if (events <= 0) continue;

                                // Ensure container fields if tile is also a container.
                                const is_container = has_tag_name(tags, 'CONTAINER');
                                if (is_container && !Array.isArray(tile.contents)) tile.contents = [];
                                if (is_container && (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1)) {
                                    tile.container_capacity = { max_slots: 12 };
                                }

                                for (let i = 0; i < events; i++) {
                                    const def_id = def_ids[i % def_ids.length] as string;
                                    const def_res = load_master_item(def_id);
                                    if (!def_res.ok) continue;
                                    const def = def_res.item as any;

                                    const created = create_inline_item_from_store(String(def.id ?? def_id), 1);

                                    const can_put_in_container = is_container && Array.isArray(tile.contents);
                                    const max_slots = can_put_in_container
                                        ? Math.floor(tile.container_capacity?.max_slots ?? 12)
                                        : 0;
                                    const has_space = can_put_in_container ? (tile.contents.length < Math.max(1, max_slots)) : false;

                                    if (can_put_in_container && has_space) {
                                        tile.contents.push(created);
                                        // stabilize layout
                                        const normalized = normalize_inline_container_grid(tile.contents, Math.max(1, max_slots), `grow_tile_container:${place_id}:${tx},${ty}`);
                                        const coords_by_id = new Map<string, { x: number; y: number }>();
                                        for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                                        for (const it of tile.contents) {
                                            const c = coords_by_id.get(String(it?.id ?? ''));
                                            if (c) { (it as any).grid_x = c.x; (it as any).grid_y = c.y; }
                                        }
                                    } else {
                                        drop_to_ground_stacking(place as any, tx, ty, created, def);
                                    }
                                }

                                tile.last_tick_processed = now_tick;
                                dirty_tiles = true;
                            }
                        }
                    }

                    if (dirty_tiles) {
                        save_place(slot, place);
                    }
                } catch (err) {
                    debug_warn('API', `[GROW] tile growth processing failed for ${place_id}`, err);
                }

                // Debug: log place connections
                debug_log("API", `/api/place: ${place_id} has ${place.connections?.length || 0} connections`, {
                    connections: place.connections?.map((c: { target_place_id: string; direction: string }) => ({ 
                        target: c.target_place_id, 
                        direction: c.direction 
                    }))
                });

                // Get entities in this place from the spatial index
                const entity_refs = get_entities_in_place(slot, place_id);
                debug_log("API", `/api/place: Found entities in ${place_id}`, {
                    slot,
                    npc_count: entity_refs.npcs.length,
                    actor_count: entity_refs.actors.length
                });

                // Preserve existing NPC statuses before clearing (set by witness handler)
                const existing_npcs = new Map<string, any>();
                for (const npc of place.contents.npcs_present || []) {
                    existing_npcs.set(npc.npc_ref, npc);
                }

                // Conversation status is ephemeral; avoid persisting stale "busy" across sessions.

                // Clear existing contents and populate from index
                place.contents.npcs_present = [];
                place.contents.actors_present = [];

                // Load NPC data
                for (const npc_ref of entity_refs.npcs) {
                    const npc_id = npc_ref.replace("npc.", "");
                    const npc_res = load_npc(slot, npc_id);
                    if (!npc_res.ok) {
                        debug_warn("API", `Failed to load NPC ${npc_id} for place ${place_id}`, { error: npc_res.error });
                        continue;
                    }

                    const location = get_npc_location(npc_res.npc);
                    if (!location?.tile) {
                        debug_warn("API", `NPC ${npc_id} has no tile position`, { npc_ref });
                        continue;
                    }

                    // Clamp NPC position to valid place bounds, then to interior (avoid wall ring).
                    const w = place.tile_grid.width;
                    const h = place.tile_grid.height;
                    const bx0 = w > 2 ? 1 : 0;
                    const bx1 = w > 2 ? (w - 2) : Math.max(0, w - 1);
                    const by0 = h > 2 ? 1 : 0;
                    const by1 = h > 2 ? (h - 2) : Math.max(0, h - 1);
                    const clamped_location = {
                        x: Math.max(bx0, Math.min(location.tile.x, bx1)),
                        y: Math.max(by0, Math.min(location.tile.y, by1))
                    };
                    
                    if (clamped_location.x !== location.tile.x || clamped_location.y !== location.tile.y) {
                        debug_warn("API", `NPC ${npc_id} position clamped from (${location.tile.x},${location.tile.y}) to (${clamped_location.x},${clamped_location.y})`, {
                            npc_ref,
                            place_bounds: { w: place.tile_grid.width, h: place.tile_grid.height }
                        });
                    }

                    // Preserve status from existing NPC (set by witness handler via update_npc_status_in_place)
                    const existing_npc = existing_npcs.get(npc_ref);
                    const raw_status = existing_npc?.status || "present";
                    const npc_status = raw_status === "busy" && !is_in_conversation_state(npc_ref)
                        ? "present"
                        : raw_status;

                    place.contents.npcs_present.push({
                        npc_ref,
                        tile_position: clamped_location,
                        elevation: typeof location?.elevation === 'number' && Number.isFinite(location.elevation)
                            ? location.elevation
                            : 0,
                        status: npc_status,
                        activity: "standing here",
                        tags: (npc_res.npc as any).tags || [],
                        body_slots: (npc_res.npc as any).body_slots || {}
                    });
                }

                // Load Actor data
                for (const actor_ref of entity_refs.actors) {
                    const actor_id = actor_ref.replace("actor.", "");
                    const actor_res = load_actor(slot, actor_id);
                    if (!actor_res.ok) {
                        debug_warn("API", `Failed to load actor ${actor_id} for place ${place_id}`, { error: actor_res.error });
                        continue;
                    }

                    const actor = actor_res.actor;
                    const actor_loc_any = (actor.location as any) || {};
                    const location = (actor_loc_any as { tile?: { x: number; y: number } })?.tile;
                    if (!location) {
                        debug_warn("API", `Actor ${actor_id} has no tile position`, { actor_ref });
                        continue;
                    }

                    // Clamp actor position to valid place bounds, then to interior (avoid wall ring).
                    const w = place.tile_grid.width;
                    const h = place.tile_grid.height;
                    const bx0 = w > 2 ? 1 : 0;
                    const bx1 = w > 2 ? (w - 2) : Math.max(0, w - 1);
                    const by0 = h > 2 ? 1 : 0;
                    const by1 = h > 2 ? (h - 2) : Math.max(0, h - 1);
                    const clamped_location = {
                        x: Math.max(bx0, Math.min(location.x, bx1)),
                        y: Math.max(by0, Math.min(location.y, by1))
                    };
                    
                    if (clamped_location.x !== location.x || clamped_location.y !== location.y) {
                        debug_warn("API", `Actor ${actor_id} position clamped from (${location.x},${location.y}) to (${clamped_location.x},${clamped_location.y})`, {
                            actor_ref,
                            place_bounds: { w: place.tile_grid.width, h: place.tile_grid.height }
                        });
                    }

                    place.contents.actors_present.push({
                        actor_ref,
                        tile_position: clamped_location,
                        elevation: (typeof actor_loc_any?.elevation === 'number' && Number.isFinite(actor_loc_any.elevation))
                            ? actor_loc_any.elevation
                            : 0,
                        status: "present",
                        tags: (actor as any).tags || []
                    });
                }

                // Sync items_on_ground from inline ground storage (Phase 5)
                // Read from place.ground.scattered and place.ground.main
                place.contents.items_on_ground = [];
                let synced_count = 0;
                
                // Ensure ground structure exists
                if (!place.ground) {
                    place.ground = { main: [], scattered: {} };
                }
                
                // Sync from scattered items (position-specific)
                if (place.ground.scattered) {
                    for (const [position_key, items] of Object.entries(place.ground.scattered)) {
                        const [x_str, y_str, z_str] = String(position_key).split('_');
                        const x = parseInt(x_str!, 10);
                        const y = parseInt(y_str!, 10);
                        const key_z = parseInt(z_str ?? '', 10);
                        const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
                        const fallback_z = Number.isFinite(key_z) ? Math.floor(key_z) : base_z;
                        
                        for (const item of items) {
                            const place_item: PlaceItem = {
                                item_ref: item.id,
                                quantity: item.qty,
                                tile_position: { x, y },
                                elevation: (typeof (item as any)?.elevation === 'number' && Number.isFinite((item as any).elevation))
                                    ? Math.floor((item as any).elevation)
                                        : fallback_z
                            };
                            place.contents.items_on_ground.push(place_item);
                            synced_count++;
                        }
                    }
                }
                
                // Sync from main ground (items without specific position)
                    if (place.ground.main) {
                        const default_entry = place.tile_grid?.default_entry || { x: 20, y: 20 };
                        for (const item of place.ground.main) {
                            const place_item: PlaceItem = {
                                item_ref: item.id,
                                quantity: item.qty,
                                tile_position: { ...default_entry },
                                elevation: (typeof (item as any)?.elevation === 'number' && Number.isFinite((item as any).elevation))
                                    ? Math.floor((item as any).elevation)
                                    : Math.floor(Number((place as any)?.coordinates?.elevation ?? 0))
                            };
                            place.contents.items_on_ground.push(place_item);
                            synced_count++;
                        }
                    }

                    // Devlog test: 3dification wall-top item exists in tavern.
                    try {
                        if (place_id === 'eden_crossroads_tavern') {
                            const base_z = Math.floor(Number((place as any)?.coordinates?.elevation ?? 0)) || 0;
                            const want_z = base_z + 1;
                            const any_wall_top = (place.contents.items_on_ground ?? []).some((it: any) => Math.floor(Number(it?.elevation)) === want_z);
                            if (any_wall_top) {
                                debug_log('3DIFICATION_TEST', `PASS wall-top ground item present (place=${place_id} z=${want_z})`);
                            } else {
                                debug_warn('3DIFICATION_TEST', `FAIL no wall-top ground item present (place=${place_id} z=${want_z})`);
                            }
                        }
                    } catch {
                        // ignore
                    }
                
                if (synced_count > 0) {
                    debug_log("API", `/api/place: Synced ${synced_count} ground items from inline ground storage`, {
                        place_id,
                        scattered_keys: Object.keys(place.ground.scattered || {}).length,
                        main_count: place.ground.main?.length || 0
                    });
                }

                // NOTE: Actor positions are owned by the actor snapshot (`actor.location.tile`).
                // This endpoint returns a computed view of `place.contents.*` for UI purposes,
                // but we do not persist derived actor tile positions into the place file.

                // Debug: Log ALL entities with their tags (even empty) to track changes
                debug_log("API", `/api/place: All entities with tags in ${place_id}`, {
                    npcs: place.contents.npcs_present.map(n => ({ 
                        ref: n.npc_ref, 
                        tagCount: n.tags?.length || 0,
                        tags: n.tags?.map((t: any) => `${t.name}:${t.mag}`).join(', ') || 'none'
                    })),
                    actors: place.contents.actors_present.map(a => ({ 
                        ref: a.actor_ref, 
                        tagCount: a.tags?.length || 0,
                        tags: a.tags?.map((t: any) => `${t.name}:${t.mag}`).join(', ') || 'none'
                    }))
                });

                debug_log("API", `/api/place: Populated ${place_id}`, {
                    slot,
                    populated_npcs: place.contents.npcs_present.length,
                    populated_actors: place.contents.actors_present.length
                });

                // Augment tiles with display properties from definitions.
                // Client needs display_char, display_color, and container_glyphs for rendering.
                try {
                    const augment_grid = (tiles_obj: any, label: string) => {
                        const tiles = tiles_obj;
                        if (!tiles?.cells) return;
                        let totalTiles = 0;
                        let augmentedTiles = 0;
                        let failedTiles = 0;
                        const failedKinds = new Set<string>();

                        for (const row of tiles.cells) {
                            if (!Array.isArray(row)) continue;
                            for (const tile of row) {
                                if (!tile?.kind) continue;
                                totalTiles++;
                                const resolved = resolve_place_tile(tile.kind, tile);
                                if (resolved) {
                                    tile.display_char = resolved.display_char;
                                    tile.display_color = resolved.display_color;
                                    tile.tags = resolved.effective_tags;
                                    tile.__derived_runtime = true;
                                    augmentedTiles++;
                                    if (resolved.container_glyphs) {
                                        tile.container_glyphs = resolved.container_glyphs;
                                    }
                                } else {
                                    failedTiles++;
                                    failedKinds.add(tile.kind);
                                }
                            }
                        }

                        if (failedTiles > 0) {
                            debug_warn("TILE_DEBUG", `Augmented ${augmentedTiles}/${totalTiles} ${label} tiles for ${place_id}`, {
                                failed: failedTiles,
                                failedKinds: Array.from(failedKinds),
                            });
                        } else {
                            debug_log("TILE_DEBUG", `Augmented ${augmentedTiles}/${totalTiles} ${label} tiles for ${place_id}`);
                        }
                    };

                    augment_grid((place as any)?.tiles_z0, "z0");
                    augment_grid((place as any)?.tiles, "z1");
                } catch (err) {
                    debug_warn("API", `Failed to augment tile display properties for ${place_id}`, err);
                }

                // Add timed event status to response
                const timed_event = get_timed_event_state(slot);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    place,
                    timed_event_active: timed_event?.timed_event_active || false,
                    timed_event_id: timed_event?.timed_event_id || null
                }));
            } catch (err: any) {
                debug_error("API", `/api/place failed for ${place_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "load_place_failed" }));
            }
            return;
        }

        if (url.pathname === "/api/place/travel") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            // Check if timed event is active - disable travel during events
            if (is_timed_event_active(slot)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: false, 
                    error: "travel_disabled_during_event",
                    message: "Cannot travel between places during a timed event"
                }));
                return;
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const entity_ref = data.entity_ref;
                    const target_place_id = data.target_place_id;

                    if (!entity_ref || !target_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    debug_log("API", `/api/place/travel: ${entity_ref} -> ${target_place_id}`);
                    
                    const result = await travel_between_places(slot, entity_ref, target_place_id);
                    
                    if (result.ok) {
                        debug_log("API", `Travel successful: ${result.from_place_id} -> ${result.to_place_id}`);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: true, 
                            from_place_id: result.from_place_id,
                            to_place_id: result.to_place_id,
                            travel_time_seconds: result.travel_time_seconds,
                            travel_description: result.travel_description
                        }));
                    } else {
                        debug_warn("API", `Travel failed: ${result.error}`, { entity_ref, target_place_id });
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: false, 
                            error: result.error,
                            from_place_id: result.from_place_id,
                            to_place_id: result.to_place_id
                        }));
                    }
                } catch (err: any) {
                    debug_error("API", `/api/place/travel request error`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "travel_failed" }));
                }
            });
            return;
        }

        // POST /api/tag/add - Add a tag to an entity (for testing)
        if (url.pathname === "/api/tag/add") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { entity_ref, tag_name, mag, meta } = data;

                    if (!entity_ref || !tag_name) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    // Determine if actor or NPC
                    const is_npc = entity_ref.startsWith("npc.");
                    const entity_id = entity_ref.replace(/^(npc|actor)\./, "");

                    if (is_npc) {
                        const result = load_npc(slot, entity_id);
                        if (!result.ok || !result.npc) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "npc_not_found" }));
                            return;
                        }
                        const npc = result.npc as Record<string, any>;
                        if (!npc.tags) npc.tags = [];
                        
                        // Check if tag already exists - update it instead of creating duplicate
                        const existingTagIndex = (npc.tags as any[]).findIndex((t: any) => t.name === tag_name);
                        let isNewTag = false;
                        let oldMag = 0;
                        
                        if (existingTagIndex >= 0) {
                            // Update existing tag
                            oldMag = npc.tags[existingTagIndex].mag;
                            npc.tags[existingTagIndex].mag = mag || 1;
                            npc.tags[existingTagIndex].meta = meta || [];
                        } else {
                            // Add new tag
                            isNewTag = true;
                            const tagData = {
                                name: tag_name,
                                mag: mag || 1,
                                meta: meta || []
                            };
                            (npc.tags as any[]).push(tagData);
                        }
                        
                        save_npc(slot, entity_id, npc);
                        
                        // Emit appropriate event
                        if (isNewTag) {
                            emitTagChange({
                                type: 'TAG_ADDED',
                                entityRef: entity_ref,
                                tagName: tag_name,
                                newMag: mag || 1,
                                meta: meta || [],
                                timestamp: Date.now(),
                                source: 'api'
                            });
                        } else {
                            emitTagChange({
                                type: 'TAG_UPDATED',
                                entityRef: entity_ref,
                                tagName: tag_name,
                                oldMag,
                                newMag: mag || 1,
                                meta: meta || [],
                                timestamp: Date.now(),
                                source: 'api'
                            });
                        }
                    } else {
                        const result = load_actor(slot, entity_id);
                        if (!result.ok || !result.actor) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                            return;
                        }
                        const actor = result.actor as Record<string, any>;
                        if (!actor.tags) actor.tags = [];
                        
                        // Check if tag already exists - update it instead of creating duplicate
                        const existingTagIndex = (actor.tags as any[]).findIndex((t: any) => t.name === tag_name);
                        let isNewTag = false;
                        let oldMag = 0;
                        
                        if (existingTagIndex >= 0) {
                            // Update existing tag
                            oldMag = actor.tags[existingTagIndex].mag;
                            actor.tags[existingTagIndex].mag = mag || 1;
                            actor.tags[existingTagIndex].meta = meta || [];
                        } else {
                            // Add new tag
                            isNewTag = true;
                            const tagData = {
                                name: tag_name,
                                mag: mag || 1,
                                meta: meta || []
                            };
                            (actor.tags as any[]).push(tagData);
                        }
                        
                        save_actor(slot, entity_id, actor);
                        
                        // Emit appropriate event
                        if (isNewTag) {
                            emitTagChange({
                                type: 'TAG_ADDED',
                                entityRef: entity_ref,
                                tagName: tag_name,
                                newMag: mag || 1,
                                meta: meta || [],
                                timestamp: Date.now(),
                                source: 'api'
                            });
                        } else {
                            emitTagChange({
                                type: 'TAG_UPDATED',
                                entityRef: entity_ref,
                                tagName: tag_name,
                                oldMag,
                                newMag: mag || 1,
                                meta: meta || [],
                                timestamp: Date.now(),
                                source: 'api'
                            });
                        }
                    }

                    debug_log("API", `/api/tag/add: Added ${tag_name} to ${entity_ref}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, entity_ref, tag_name, mag }));
                } catch (err: any) {
                    debug_error("API", `/api/tag/add request error`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "tag_add_failed" }));
                }
            });
            return;
        }

        // GET /api/actor?id=xxx - Get actor data
        if (url.pathname === "/api/actor") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const actor_id = url.searchParams.get("id");
            if (!actor_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_actor_id" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;

            try {
                const actor_result = load_actor(slot, actor_id);
                if (!actor_result.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                    return;
                }

                // Response-only augmentation: attach derived item props from database for consistent UI rendering.
                // (Do not persist these fields.)
                try {
                    const patch_inline_item = (it: any): void => {
                        if (!it || typeof it !== 'object') return;
                        const def_id = typeof it.def_id === 'string' ? it.def_id : '';
                        const resolved = def_id ? resolve_inline_item(def_id, it as any) : null;
                        if (resolved) {
                            it.name = resolved.name;
                            it.weight = resolved.unit_weight;
                            it.tags = resolved.effective_tags;
                            it.display_char = resolved.display_char;
                            if (resolved.display_color) it.display_color = resolved.display_color;
                            it.__derived_runtime = true;
                        }
                        if (Array.isArray(it.contents)) {
                            for (const child of it.contents) patch_inline_item(child);
                        }
                    };

                    const actor_any: any = actor_result.actor as any;
                    const body_slots_any: any = actor_any?.body_slots;
                    if (body_slots_any && typeof body_slots_any === 'object') {
                        for (const v of Object.values(body_slots_any)) {
                            const s: any = v as any;
                            if (!s || typeof s !== 'object') continue;
                            patch_inline_item(s.armor);
                            patch_inline_item(s.tool);
                            if (Array.isArray(s.garb)) {
                                for (const g of s.garb) patch_inline_item(g);
                            }
                        }
                    }
                } catch {
                    // Non-fatal: actor data still returns even if augmentation fails.
                }

                debug_log("API", `/api/actor: Loaded ${actor_id}`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    actor: actor_result.actor 
                }));
            } catch (err: any) {
                debug_error("API", `/api/actor error for ${actor_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "actor_load_failed" }));
            }
            return;
        }

        // GET /api/containers?owner_ref=xxx - List containers for an owner
        if (url.pathname === "/api/containers") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const owner_ref = url.searchParams.get("owner_ref");
            if (!owner_ref) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_owner_ref" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;

            try {
                const containers = list_containers_for_owner(slot, owner_ref);
                
                debug_log("API", `/api/containers: Found ${containers.length} containers for ${owner_ref}`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, owner_ref, containers }));
            } catch (err: any) {
                debug_error("API", `/api/containers error for ${owner_ref}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "containers_list_failed" }));
            }
            return;
        }

        // GET /api/container?id=xxx - Get specific container with contents
        if (url.pathname === "/api/container") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const container_id = url.searchParams.get("id");
            if (!container_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_container_id" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;

            try {
                const container_result = load_container(slot, container_id);
                if (!container_result.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "container_not_found" }));
                    return;
                }

                // Contents are already in wrapped format {instance, definition}
                const contents = container_result.container.contents;
                
                debug_log("API", `/api/container: Loaded ${container_id} with ${contents.length} items`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    container: container_result.container,
                    contents 
                }));
            } catch (err: any) {
                debug_error("API", `/api/container error for ${container_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "container_load_failed" }));
            }
            return;
        }

        // POST /api/transfer - DEPRECATED (replaced by inline /api/transfer below)

        // GET /api/place/ground_items?place_id=xxx - Get ground items in a place
        if (url.pathname === "/api/place/ground_items") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            if (!place_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_place_id" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;

            try {
                // Get scattered containers and their items
                const scattered_containers = list_scattered_containers(slot, place_id);
                const items_with_positions: any[] = [];
                
                for (const container of scattered_containers) {
                    for (const entry of container.contents) {
                        items_with_positions.push({
                            instance_id: entry.instance.id,
                            def_id: entry.instance.def_id,
                            name: entry.definition.name || entry.instance.def_id,
                            qty: entry.instance.qty,
                            condition: entry.instance.condition,
                            tile_position: container.position || { x: 20, y: 20 },
                            container_id: container.id
                        });
                    }
                }
                
                debug_log("API", `/api/place/ground_items: Found ${items_with_positions.length} items in ${place_id}`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, place_id, items: items_with_positions }));
            } catch (err: any) {
                debug_error("API", `/api/place/ground_items error for ${place_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "ground_items_failed" }));
            }
            return;
        }

        // (Legacy /api/place/pickup removed; use /api/place/items/pickup or /api/place/items/pickup_to.)

        // POST /api/place/drop - Drop item from any equipped slot to scattered loot at position
        if (url.pathname === "/api/place/drop") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const item_instance_id = data.item_instance_id;
                    const place_id = data.place_id;
                    const actor_id = data.actor_id;
                    const from_container_id = data.from_container_id; // Source container (any equipped slot)
                    // Position where item should be dropped (from client cursor)
                    const tile_position = data.tile_position;

                    if (!item_instance_id || !actor_id || !from_container_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const slot = data_slot_number;
                    
                    // Load actor directly from storage (authoritative source)
                    const actor_result = load_actor(slot, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                        return;
                    }
                    const actor = actor_result.actor as any;
                    const actor_pos = actor.location?.tile;
                    
                    if (!actor_pos) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_position_unknown" }));
                        return;
                    }
                    
                    // Use actor's actual place from storage (authoritative, not stale client data)
                    const actual_place_id = actor.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    
                    // Log if client sent different place (for debugging stale data issues)
                    if (place_id && place_id !== actual_place_id) {
                        debug_log("API", `Drop place mismatch: client sent ${place_id}, actor is actually in ${actual_place_id}`);
                    }
                    
                    // Validate drop position (must be cardinal direction from actor)
                    const drop_x = tile_position?.x;
                    const drop_y = tile_position?.y;
                    
                    if (drop_x === undefined || drop_y === undefined) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_tile_position" }));
                        return;
                    }
                    
                    // Check cardinal adjacency (N/E/S/W only, no diagonals)
                    const dx = Math.abs(drop_x - actor_pos.x);
                    const dy = Math.abs(drop_y - actor_pos.y);
                    const is_cardinal_adjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
                    
                    if (!is_cardinal_adjacent) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "can_only_drop_to_cardinal_adjacent_tiles" }));
                        return;
                    }
                    
                    debug_log("API", `Drop: ${item_instance_id} from ${from_container_id} to (${drop_x},${drop_y})`);

                    // Get or create scattered container at drop position (using actor's actual place)
                    const scattered_result = get_or_create_scattered_container(slot, actual_place_id, drop_x, drop_y);
                    if (!scattered_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "failed_to_create_container" }));
                        return;
                    }
                    const scattered_container = scattered_result.container;

                    // Find empty position in scattered container
                    const ground_max_slots = scattered_container.capacity?.max_slots || scattered_container.contents.length + 1;
                    const { cols: ground_cols } = calculate_grid_dimensions(ground_max_slots);
                    const ground_empty_pos = find_empty_grid_position(
                        scattered_container.contents,
                        ground_cols,
                        ground_max_slots
                    ) || { x: 0, y: 0 }; // Default to (0,0) if full

                    // Transfer item from source container to scattered container
                    const result = transfer_item_between_containers(
                        slot, 
                        item_instance_id, 
                        from_container_id, 
                        scattered_container.id,
                        ground_empty_pos.x,
                        ground_empty_pos.y
                    );

                    if (result.ok) {
                        // Item ownership is implicit in container structure (inline storage)
                        // No need to update separate item_instance files
                        
                        // Load place to add/update item in items_on_ground for rendering (using actor's actual place)
                        const place_result = load_place(slot, actual_place_id);
                        if (place_result.ok) {
                            const place = place_result.place;
                            if (!place.contents) {
                                place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
                            }
                            
                            // Get item details from the scattered container (wrapped format)
                            const item_entry = scattered_container.contents.find((c: any) => c.instance.id === item_instance_id);
                            const qty = item_entry ? item_entry.instance.qty : 1;
                            
                            // Add/update item in items_on_ground
                            const items_on_ground = place.contents.items_on_ground ?? [];
                            const existing_idx = items_on_ground.findIndex(
                                (i: any) => i.item_ref === item_instance_id
                            );
                            if (existing_idx >= 0 && items_on_ground[existing_idx]) {
                                items_on_ground[existing_idx].tile_position = { x: drop_x, y: drop_y };
                                items_on_ground[existing_idx].quantity = qty;
                            } else {
                                items_on_ground.push({
                                    item_ref: item_instance_id,
                                    quantity: qty,
                                    tile_position: { x: drop_x, y: drop_y }
                                });
                            }
                            place.contents.items_on_ground = items_on_ground;
                            
                            save_place(slot, place);
                            debug_log("API", `/api/place/drop: ${item_instance_id} dropped at (${drop_x},${drop_y}) into ${scattered_container.id} in ${actual_place_id}`);
                        }
                        
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: true, 
                            item_instance_id, 
                            from: from_container_id, 
                            to: scattered_container.id,
                            place_id: actual_place_id,
                            container_id: scattered_container.id,
                            position: { x: drop_x, y: drop_y }
                        }));
                    } else {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: result.error }));
                    }
                } catch (err: any) {
                    debug_error("API", `/api/place/drop request error`, err);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: err?.message ?? "drop_failed" }));
                }
            });
            return;
        }

        // POST /api/place/throw - Throw item from hand tool slot to target tile
        if (url.pathname === "/api/place/throw") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const item_instance_id = data.item_instance_id;
                    const actor_id = data.actor_id;
                    const from_slot = data.from_slot; // e.g., "hand_left.tool" or "hand_right.tool"
                    const target_tile = data.target_tile;

                    if (!item_instance_id || !actor_id || !from_slot || !target_tile) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const slot = data_slot_number;
                    
                    // Load actor
                    const actor_result = load_actor(slot, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                        return;
                    }
                    const actor = actor_result.actor as any;
                    const actor_pos = actor.location?.tile;
                    
                    if (!actor_pos) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_position_unknown" }));
                        return;
                    }
                    
                    const actual_place_id = actor.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    
                    // Calculate distance to target
                    const target_x = target_tile.x;
                    const target_y = target_tile.y;
                    const dx = target_x - actor_pos.x;
                    const dy = target_y - actor_pos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Must be beyond drop range (cardinal adjacency)
                    const is_cardinal_adjacent = (Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1);
                    if (is_cardinal_adjacent) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "use_drop_for_adjacent_tiles" }));
                        return;
                    }
                    
                    // Calculate throw range (base 5 tiles, modified by strength/weight)
                    // Simple implementation: base 5 tiles for now
                    const throw_range = 5;
                    
                    if (distance > throw_range) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "target_too_far", max_range: throw_range, distance }));
                        return;
                    }
                    
                    debug_log("API", `Throw: ${item_instance_id} from ${from_slot} to (${target_x},${target_y})`);

                    // Get or create scattered container at target position
                    const scattered_result = get_or_create_scattered_container(slot, actual_place_id, target_x, target_y);
                    if (!scattered_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "failed_to_create_container" }));
                        return;
                    }
                    const scattered_container = scattered_result.container;

                    // Find empty position in scattered container
                    const ground_max_slots = scattered_container.capacity?.max_slots || scattered_container.contents.length + 1;
                    const { cols: ground_cols } = calculate_grid_dimensions(ground_max_slots);
                    const ground_empty_pos = find_empty_grid_position(
                        scattered_container.contents,
                        ground_cols,
                        ground_max_slots
                    ) || { x: 0, y: 0 };

                    // Parse source container ID from from_slot
                    // from_slot format: "hand_left.tool" or "hand_right.tool"
                    const from_container_id = `container.${actor_id}.${from_slot}`;

                    // Transfer item from hand to scattered container
                    const result = transfer_item_between_containers(
                        slot, 
                        item_instance_id, 
                        from_container_id, 
                        scattered_container.id,
                        ground_empty_pos.x,
                        ground_empty_pos.y
                    );

                    if (result.ok) {
                        // Load place to add item to items_on_ground
                        const place_result = load_place(slot, actual_place_id);
                        if (place_result.ok) {
                            const place = place_result.place;
                            if (!place.contents) {
                                place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
                            }
                            
                            const item_entry = scattered_container.contents.find((c: any) => c.instance.id === item_instance_id);
                            const qty = item_entry ? item_entry.instance.qty : 1;
                            
                            const items_on_ground = place.contents.items_on_ground ?? [];
                            const existing_idx = items_on_ground.findIndex(
                                (i: any) => i.item_ref === item_instance_id
                            );
                            if (existing_idx >= 0 && items_on_ground[existing_idx]) {
                                items_on_ground[existing_idx].tile_position = { x: target_x, y: target_y };
                                items_on_ground[existing_idx].quantity = qty;
                            } else {
                                items_on_ground.push({
                                    item_ref: item_instance_id,
                                    quantity: qty,
                                    tile_position: { x: target_x, y: target_y }
                                });
                            }
                            place.contents.items_on_ground = items_on_ground;
                            
                            save_place(slot, place);
                            debug_log("API", `/api/place/throw: ${item_instance_id} thrown to (${target_x},${target_y}) into ${scattered_container.id}`);
                        }
                        
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            ok: true, 
                            item_instance_id, 
                            from: from_container_id,
                            to: scattered_container.id,
                            place_id: actual_place_id,
                            position: { x: target_x, y: target_y },
                            distance
                        }));
                    } else {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: result.error }));
                    }
                } catch (err: any) {
                    debug_error("API", `/api/place/throw request error`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "throw_failed" }));
                }
            });
            return;
        }

        // POST /api/spawn_item - Spawn a new item on the ground at actor's facing direction
        if (url.pathname === "/api/spawn_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { item_def_id, actor_id, facing_direction } = data;

                    if (!item_def_id || !actor_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const slot = data_slot_number;
                    
                    // Load actor
                    const actor_result = load_actor(slot, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                        return;
                    }
                    const actor = actor_result.actor as any;
                    const actor_pos = actor.location?.tile;
                    const actual_place_id = actor.location?.place_id;
                    
                    if (!actor_pos || !actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_position_unknown" }));
                        return;
                    }

                    // Calculate drop position based on facing direction (cardinal only)
                    let drop_x = actor_pos.x;
                    let drop_y = actor_pos.y;
                    const direction = facing_direction || "south";
                    
                    switch (direction) {
                        case "north": drop_y = actor_pos.y - 1; break;
                        case "south": drop_y = actor_pos.y + 1; break;
                        case "east": drop_x = actor_pos.x + 1; break;
                        case "west": drop_x = actor_pos.x - 1; break;
                        default: 
                            // Default to south if invalid direction
                            drop_y = actor_pos.y + 1;
                    }

                    // Load item definition from master database
                    const def_result = load_master_item(item_def_id);
                    if (!def_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_def_not_found" }));
                        return;
                    }

                    // Get or create scattered container at drop position
                    const scattered_result = get_or_create_scattered_container(slot, actual_place_id, drop_x, drop_y);
                    if (!scattered_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "failed_to_create_container" }));
                        return;
                    }
                    const scattered_container = scattered_result.container;

                    // Create item instance
                    const item_instance = create_inline_item(
                        item_def_id,
                        1, // qty
                        "system", // owner
                        scattered_container.id
                    );

                    // Find empty position in scattered container
                    const ground_max_slots = scattered_container.capacity?.max_slots || scattered_container.contents.length + 1;
                    const { cols: ground_cols } = calculate_grid_dimensions(ground_max_slots);
                    const ground_empty_pos = find_empty_grid_position(
                        scattered_container.contents,
                        ground_cols,
                        ground_max_slots
                    ) || { x: 0, y: 0 };

                    // Add item to scattered container
                    const add_result = add_item_to_container(slot, scattered_container.id, {
                        instance: item_instance,
                        definition: def_result.item,
                        grid_x: ground_empty_pos.x,
                        grid_y: ground_empty_pos.y
                    });

                    if (!add_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "failed_to_add_item" }));
                        return;
                    }

                    // Update place's items_on_ground using the container that has the item
                    // This ensures items_on_ground matches the scattered container (source of truth)
                    const place_result = load_place(slot, actual_place_id);
                    if (place_result.ok) {
                        const place = place_result.place;
                        if (!place.contents) {
                            place.contents = { npcs_present: [], actors_present: [], items_on_ground: [], features: [] };
                        }
                        
                        // Rebuild items_on_ground from the updated scattered container
                        // This ensures consistency with how /api/place rebuilds it
                        const container_name = `scattered_${drop_x}_${drop_y}`;
                        const updated_container = place.containers?.[container_name];
                        
                        if (updated_container) {
                            // Clear existing items at this position
                            place.contents.items_on_ground = place.contents.items_on_ground.filter(
                                (item: any) => {
                                    const pos = item.tile_position;
                                    return !(pos && pos.x === drop_x && pos.y === drop_y);
                                }
                            );
                            
                            // Add all items from the scattered container
                            for (const entry of updated_container.contents) {
                                place.contents.items_on_ground.push({
                                    item_ref: entry.instance.id,
                                    quantity: entry.instance.qty,
                                    tile_position: { x: drop_x, y: drop_y }
                                });
                            }
                        }
                        
                        save_place(slot, place);
                    }

                    debug_log("API", `/api/spawn_item: ${item_def_id} spawned at (${drop_x},${drop_y}) facing ${direction}`);
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        item_instance_id: item_instance.id,
                        item_def_id,
                        position: { x: drop_x, y: drop_y },
                        direction
                    }));
                    
                } catch (err) {
                    debug_error("API", `/api/spawn_item request error`, err);
                    const errorMessage = err instanceof Error ? err.message : "spawn_failed";
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: errorMessage }));
                }
            });
            return;
        }

        // GET /api/item/compatible_slots?item_def_id=xxx&actor_id=xxx - Get slots where item can be equipped
        if (url.pathname === "/api/item/compatible_slots") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const item_def_id = url.searchParams.get("item_def_id");
            const actor_id = url.searchParams.get("actor_id") || "henry_actor";
            
            if (!item_def_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_item_def_id" }));
                return;
            }

            try {
                // Load item definition from master database (single source of truth)
                const def_result = load_master_item(item_def_id);
                if (!def_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_def_not_found" }));
                    return;
                }

                const item_def = def_result.item;
                const compatible_slots = compute_compatible_slots_from_tags(item_def.tags || [], `def:${item_def_id}`);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    item_def_id,
                    compatible_slots
                }));
            } catch (err) {
                debug_error("API", `/api/item/compatible_slots error`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/item_instance/compatible_slots?actor_id=xxx&item_id=yyy - Compatible slots from inline item tags (snapshot)
        if (url.pathname === "/api/item_instance/compatible_slots") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id") || "henry_actor";
            const item_id = url.searchParams.get("item_id");
            if (!item_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_item_id" }));
                return;
            }

            try {
                const actor_result = load_actor_with_items(data_slot_number, actor_id);
                if (!actor_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                    return;
                }

                const found = find_actor_item_by_id(actor_result.actor, item_id);
                if (!found) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_not_found" }));
                    return;
                }

                const item_any: any = found.item as any;

                // NEW INLINE SYSTEM: resolve tags from defs + deltas (do not rely on stored item.tags)
                const resolved = resolve_inline_item(String(item_any?.def_id ?? ''), item_any as any);
                const tags = (resolved?.effective_tags ?? (Array.isArray(item_any?.tags) ? item_any.tags : [])) as any[];
                const compatible_slots = compute_compatible_slots_from_tags(tags, `inst:${actor_id}:${item_id}`);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, actor_id, item_id, compatible_slots }));
            } catch (err) {
                debug_error("API", `/api/item_instance/compatible_slots error`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/place_item/compatible_slots?place_id=xxx&item_id=yyy - Compatible slots from ground inline item tags
        if (url.pathname === "/api/place_item/compatible_slots") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            const item_id = url.searchParams.get("item_id");
            if (!place_id || !item_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                const place_result = load_place_with_ground(data_slot_number, place_id);
                if (!place_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: place_result.error }));
                    return;
                }

                const all_items = get_all_ground_items(place_result.place);
                const found = all_items.find(({ item }: { item: InlineItem }) => item.id === item_id);
                if (!found) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_not_found" }));
                    return;
                }

                const item_any: any = found.item as any;

                // NEW INLINE SYSTEM: resolve tags from defs + deltas (do not rely on stored item.tags)
                const resolved = resolve_inline_item(String(item_any?.def_id ?? ''), item_any as any);
                const tags = (resolved?.effective_tags ?? (Array.isArray(item_any?.tags) ? item_any.tags : [])) as any[];
                const compatible_slots = compute_compatible_slots_from_tags(tags, `place:${place_id}:${item_id}`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, place_id, item_id, compatible_slots }));
            } catch (err) {
                debug_error("API", `/api/place_item/compatible_slots error`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        if (url.pathname === "/api/targets") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id") || "henry_actor";
            try {
                const actor_res = load_actor(slot, actor_id);
                if (!actor_res.ok) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, targets: [] }));
                    return;
                }

                const loc = (actor_res.actor.location as any) ?? {};
                const wx = Number(loc?.world_tile?.x ?? 0);
                const wy = Number(loc?.world_tile?.y ?? 0);
                const rx = Number(loc?.region_tile?.x ?? 0);
                const ry = Number(loc?.region_tile?.y ?? 0);
                const region_res = get_region_by_coords(slot, wx, wy, rx, ry);

                const targets: Array<{ ref: string; label: string; type: string }> = [];
                const actor_label = typeof (actor_res.actor as any)?.name === "string" ? ((actor_res.actor as any).name as string) : actor_id;
                targets.push({ ref: `actor.${actor_id}`, label: actor_label, type: "actor" });

                // Awareness set: only include NPCs the actor is aware of.
                const awareness = new Set<string>();
                const tags = (actor_res.actor as any)?.tags;
                if (Array.isArray(tags)) {
                    for (const tag of tags) {
                        if (tag?.name !== "AWARENESS") continue;
                        const info = tag?.info;
                        if (!Array.isArray(info)) continue;
                        for (const entry of info) {
                            if (typeof entry !== "string") continue;
                            const norm = entry.toLowerCase();
                            // Normalize npc.Gunther -> npc.gunther
                            const fixed = norm.startsWith("npc.") ? `npc.${norm.slice(4).replace(/[^a-z0-9_]/g, "_")}` : norm;
                            awareness.add(fixed);
                        }
                    }
                }

                if (region_res.ok) {
                    targets.push({ ref: `region_tile.${wx}.${wy}.${rx}.${ry}`, label: region_res.region.name ?? region_res.region_id, type: "region" });

                    const npcs_present = (region_res.region as any)?.contents?.npcs_present;
                    if (Array.isArray(npcs_present)) {
                        for (const entry of npcs_present) {
                            const npc_ref_raw = typeof entry?.npc_id === "string" ? entry.npc_id : "";
                            const npc_id = npc_ref_raw.replace(/^npc\./, "");
                            if (!npc_id) continue;
                            const ref = `npc.${npc_id}`.toLowerCase();
                            // Only show if actor is aware, unless awareness set is empty (fresh start)
                            if (awareness.size > 0 && !awareness.has(ref)) continue;
                            const npc_res = load_npc(slot, npc_id);
                            const label = npc_res.ok ? (npc_res.npc.name ?? npc_id) : npc_id;
                            targets.push({ ref: `npc.${npc_id}`, label, type: "npc" });
                        }
                    }

                    // Also include NPCs whose saved location matches the actor's PLACE (Place System)
                    // This filters NPCs to only show those in the same place as the player
                    try {
                        const actor_place_id = (actor_res.actor as any)?.location?.place_id;
                        const all_npcs = find_npcs(slot, {}).filter((n) => n.id !== "default_npc");
                        for (const n of all_npcs) {
                            const npc_id = n.id;
                            if (!npc_id) continue;
                            const ref = `npc.${npc_id}`.toLowerCase();
                            if (awareness.size > 0 && !awareness.has(ref)) continue;
                            const npc_res = load_npc(slot, npc_id);
                            if (!npc_res.ok) continue;
                            const nloc = (npc_res.npc as any)?.location;
                            
                            // Place System: Check if NPC is in same place
                            const npc_place_id = nloc?.place_id;
                            if (actor_place_id && npc_place_id) {
                                // Both have place_id - must match
                                if (npc_place_id !== actor_place_id) continue;
                            } else {
                                // Fallback: Check region match (legacy)
                                const nwx = Number(nloc?.world_tile?.x ?? NaN);
                                const nwy = Number(nloc?.world_tile?.y ?? NaN);
                                const nrx = Number(nloc?.region_tile?.x ?? NaN);
                                const nry = Number(nloc?.region_tile?.y ?? NaN);
                                if (!(nwx === wx && nwy === wy && nrx === rx && nry === ry)) continue;
                            }
                            
                            // Dedup
                            if (targets.some(t => t.type === "npc" && t.ref.toLowerCase() === `npc.${npc_id}`.toLowerCase())) continue;
                            const label = typeof (npc_res.npc as any)?.name === "string" ? ((npc_res.npc as any).name as string) : npc_id;
                            targets.push({ ref: `npc.${npc_id}`, label, type: "npc" });
                        }
                    } catch {
                        // ignore
                    }
                }

                // Get place information for response
                const actor_place_id = (actor_res.actor as any)?.location?.place_id;
                let place_name = null;
                if (actor_place_id) {
                    const place_res = load_place(slot, actor_place_id);
                    if (place_res.ok) {
                        place_name = place_res.place.name ?? actor_place_id;
                    }
                }
                
                // Get world tile coordinates
                const world_x = (actor_res.actor as any)?.location?.world_tile?.x ?? 0;
                const world_y = (actor_res.actor as any)?.location?.world_tile?.y ?? 0;
                const region_x = (actor_res.actor as any)?.location?.region_tile?.x ?? 0;
                const region_y = (actor_res.actor as any)?.location?.region_tile?.y ?? 0;
                
                // Get places in current region
                const places_in_region: Array<{ ref: string; label: string; id: string }> = [];
                if (region_res.ok && region_res.region_id) {
                    const places_result = list_places_in_region(slot, region_res.region_id);
                    if (places_result.ok) {
                        for (const place_id of places_result.places) {
                            const place_res = load_place(slot, place_id);
                            if (place_res.ok) {
                                // Build place reference: place.<region>.<place_suffix>
                                const parts = place_id.split("_");
                                if (parts.length >= 2) {
                                    const place_suffix = parts.pop();
                                    const region_id = parts.join("_");
                                    const ref = `place.${region_id}.${place_suffix}`;
                                    places_in_region.push({
                                        ref,
                                        label: place_res.place.name ?? place_id,
                                        id: place_id
                                    });
                                }
                            }
                        }
                    }
                }
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    region: region_res.ok ? (region_res.region.name ?? region_res.region_id) : null,
                    place: place_name,
                    place_id: actor_place_id,
                    world_coords: { x: world_x, y: world_y },
                    region_coords: { x: region_x, y: region_y },
                    places: places_in_region,
                    targets 
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "failed_to_read" }));
            }
            return;
        }

        // POST /api/target - Set communication target for actor
        if (url.pathname === "/api/target") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const actor_ref = data.actor_ref || "actor.henry_actor";
                    const target_ref = data.target_ref;
                    const target_type = data.target_type || "npc";
                    const target_name = data.target_name;

                    if (!target_ref) {
                        // Clear target
                        clearActorTarget(actor_ref);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true, action: "cleared" }));
                        return;
                    }

                    // Set target
                    setActorTarget(actor_ref, target_ref, target_type, target_name);
                    debug_log("[API]", `Target set for ${actor_ref}: ${target_ref} (${target_type})`);

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        action: "set",
                        actor_ref,
                        target_ref,
                        target_type 
                    }));
                } catch (err: any) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "invalid_request" }));
                }
            });
            return;
        }

        if (url.pathname === "/api/actor/move") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const slot_raw = url.searchParams.get("slot");
            const slot = slot_raw ? Number(slot_raw) : data_slot_number;
            if (!Number.isFinite(slot) || slot <= 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "invalid_slot" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id");
            if (!actor_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_actor_id" }));
                return;
            }

            // Collect request body
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            
            req.on("end", () => {
                try {
                    const data = JSON.parse(body) as { x?: number; y?: number };
                    
                    if (typeof data.x !== "number" || typeof data.y !== "number") {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_position" }));
                        return;
                    }

                    // Load and update actor
                    const actor_res = load_actor(slot, actor_id);
                    if (!actor_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_found" }));
                        return;
                    }

                    const actor = actor_res.actor as Record<string, unknown>;
                    if (!actor.location) {
                        actor.location = {};
                    }
                    (actor.location as Record<string, unknown>).tile = { x: data.x, y: data.y };
                    
                    save_actor(slot, actor_id, actor);
                    
                    debug_log("API", `Actor ${actor_id} position updated`, { slot, x: data.x, y: data.y });
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, actor_id, position: { x: data.x, y: data.y } }));
                } catch (err: any) {
                    debug_error("API", `/api/actor/move failed for ${actor_id}`, err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: err?.message ?? "move_failed" }));
                }
            });
            
            req.on("error", (err: any) => {
                debug_error("API", `/api/actor/move request error for ${actor_id}`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "request_error" }));
            });
            
            return;
        }

        if (url.pathname === "/api/health/session") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            // Dedicated session health endpoint
            try {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    session_id: SESSION_ID,
                    status: "session_active"
                }));
            } catch (err: any) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err?.message ?? "session_check_failed" }));
            }
            return;
        }

        // ============================================
        // NEW INLINE ITEM API ENDPOINTS (Phase 5)
        // ============================================

        // POST /api/place/spawn - Spawn item directly on ground (for testing)
        if (url.pathname === "/api/place/spawn") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { item_def_id, place_id, x, y, qty = 1, contents } = data;

                    if (!item_def_id || !place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    // Load item definition
                    const def_result = load_master_item(item_def_id);
                    if (!def_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_def_not_found" }));
                        return;
                    }

                    const def = def_result.item;

                    // Load place
                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    // Create inline item
                    const item = create_inline_item_from_store(item_def_id, qty);

                    // If contents provided (for containers), add them
                    if (contents && Array.isArray(contents) && contents.length > 0) {
                        item.contents = [];
                        for (const content_item of contents) {
                            const content_def_result = load_master_item(content_item.def_id);
                            if (content_def_result.ok) {
                                const content_def = content_def_result.item;
                                const content_inline = create_inline_item_from_store(content_item.def_id, content_item.qty || 1);
                                item.contents.push(content_inline);
                            }
                        }
                    }

                    // Add to ground at position
                    const spawn_x = x ?? 0;
                    const spawn_y = y ?? 0;
                    const add_result = add_item_to_ground(place_result.place, spawn_x, spawn_y, item);
                    
                    if (!add_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: add_result.error }));
                        return;
                    }

                    // Save place
                    const save_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_result.error }));
                        return;
                    }

                    debug_log("API", `Spawned ${item_def_id} on ground at (${spawn_x}, ${spawn_y}) in ${place_id}${item.contents ? ` with ${item.contents.length} items inside` : ''}`);
                    
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        item_id: item.id,
                        item_def_id,
                        name: def.name,
                        position: { x: spawn_x, y: spawn_y },
                        place_id
                    }));
                } catch (err) {
                    debug_error("API", "/api/place/spawn error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // GET /api/actor/items?actor_id=xxx - Get actor's inline items
        if (url.pathname === "/api/actor/items") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id") || "henry_actor";

            try {
                const result = load_actor_with_items(data_slot_number, actor_id);
                if (!result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: result.error }));
                    return;
                }

                const items = get_all_actor_items(result.actor);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ 
                    ok: true, 
                    actor_id,
                    items: items.map(({ item, path, slot_name, slot_type }) => ({
                        item,
                        path,
                        slot_name,
                        slot_type,
                    }))
                }));
            } catch (err) {
                debug_error("API", "/api/actor/items error", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // POST /api/actor/items/add - Add item to actor's inventory
        if (url.pathname === "/api/actor/items/add") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, item_def_id, qty = 1 } = data;

                    if (!actor_id || !item_def_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    // Load actor
                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    // Load item definition
                    const def_result = load_master_item(item_def_id);
                    if (!def_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_def_not_found" }));
                        return;
                    }

                    const def = def_result.item;

                    // Ensure actor has a sack
                    const sack_result = ensure_actor_has_sack(actor_result.actor);
                    if (!sack_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: sack_result.error }));
                        return;
                    }

                    // Create inline item
                    const item = create_inline_item_from_store(item_def_id, qty);

                    // Add to sack
                    const add_result = add_item_to_inline_container(actor_result.actor, sack_result.sack_path, item);
                    if (!add_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: add_result.error }));
                        return;
                    }

                    // Save actor
                    const save_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_result.error }));
                        return;
                    }

                    debug_log("API", `Added ${item_def_id} to ${actor_id}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        item_id: item.id,
                        item_path: add_result.item_path
                    }));
                } catch (err) {
                    debug_error("API", "/api/actor/items/add error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/pickup - Pickup item from ground to actor
        if (url.pathname === "/api/place/items/pickup") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, item_id } = data;

                    if (!actor_id || !place_id || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    // Load place
                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    // Load actor
                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    // Find item on ground
                    const all_items: Array<{ item: InlineItem; position?: { x: number; y: number }; position_key?: string }> = get_all_ground_items(place_result.place);
                    const target_item = all_items.find(({ item }: { item: InlineItem }) => item.id === item_id);
                    
                    if (!target_item) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    // Determine default pickup target (no auto-created sacks)
                    const actor_any = actor_result.actor as any;
                    const body_slots = actor_any.body_slots || {};
                    const slot_priority = ['leg_left', 'leg_right', 'torso', 'head', 'hand_left', 'hand_right'];

                    function has_container_tag(it: any): boolean {
                        if (!it || typeof it !== 'object') return false;
                        const p = resolve_inline_item_payload_for_api(it);
                        return p.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                    }

                    let to_container: string | null = null;
                    for (const slot_name of slot_priority) {
                        const slot = body_slots[slot_name];
                        if (!slot) continue;
                        if (has_container_tag(slot.armor)) { to_container = `body_slots.${slot_name}.armor`; break; }
                        if (has_container_tag(slot.tool)) { to_container = `body_slots.${slot_name}.tool`; break; }
                        if (Array.isArray(slot.garb)) {
                            for (let i = 0; i < slot.garb.length; i++) {
                                if (has_container_tag(slot.garb[i])) { to_container = `body_slots.${slot_name}.garb.${i}`; break; }
                            }
                            if (to_container) break;
                        }
                    }

                    // Fallback: dominant hand tool slot (right hand) if empty
                    if (!to_container) {
                        const right = body_slots.hand_right;
                        if (right && !right.tool) {
                            to_container = 'body_slots.hand_right.tool';
                        }
                    }

                    if (!to_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: 'no_space_no_container' }));
                        return;
                    }

                    // [LEGALITY] validate before mutating
                    debug_log('API', `[LEGALITY] pickup req actor=${actor_id} item=${item_id} to=${to_container}`);
                    const legality = validate_transfer_destination(actor_any, actor_id, target_item.item, String(to_container), null);
                    if (!legality.ok) {
                        debug_log('API', `[LEGALITY] pickup reject error=${legality.error}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }
                    debug_log('API', `[LEGALITY] pickup allow`);

                    // Remove from ground
                    const remove_result = remove_item_from_ground(place_result.place, item_id);
                    if (!remove_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: remove_result.error }));
                        return;
                    }

                    // Add to actor (slot or container-item)
                    function parse_body_slots_path(p: string): { slot_name: string; slot_type: 'armor'|'tool'|'garb'; garb_index: number | null } | null {
                        const parts = p.split('.');
                        if (parts[0] !== 'body_slots') return null;
                        if (!parts[1] || !parts[2]) return null;
                        const slot_name = parts[1];
                        const slot_type = parts[2] as any;
                        const garb_index = (slot_type === 'garb' && parts[3] !== undefined) ? parseInt(parts[3], 10) : null;
                        return { slot_name, slot_type, garb_index: isNaN(garb_index as any) ? null : garb_index };
                    }

                    function get_item_at_path(path: string): any {
                        const parsed = parse_body_slots_path(path);
                        if (!parsed) return null;
                        const slot = body_slots[parsed.slot_name];
                        if (!slot) return null;
                        if (parsed.slot_type === 'armor') return slot.armor;
                        if (parsed.slot_type === 'tool') return slot.tool;
                        if (parsed.slot_type === 'garb') {
                            if (parsed.garb_index === null) return null;
                            return slot.garb?.[parsed.garb_index] ?? null;
                        }
                        return null;
                    }

                    let add_result: any = null;
                    const dest_item = get_item_at_path(to_container);
                    if (has_container_tag(dest_item)) {
                        // capacity check
                        if (!Array.isArray(dest_item.contents)) dest_item.contents = [];
                        const max_slots = dest_item.container_capacity?.max_slots;
                        if (typeof max_slots === 'number' && dest_item.contents.length >= max_slots) {
                            add_result = { ok: false, error: 'container_full' };
                        } else {
                            dest_item.contents.push(remove_result.item);
                            add_result = { ok: true, item_path: `${to_container}.contents.${dest_item.contents.length - 1}` };
                        }
                    } else {
                        const parsed = parse_body_slots_path(to_container);
                        if (!parsed) {
                            add_result = { ok: false, error: 'invalid_to_container' };
                        } else {
                            const add_slot_res = add_item_to_body_slot(actor_result.actor, parsed.slot_name, parsed.slot_type, remove_result.item);
                            add_result = add_slot_res.ok ? { ok: true, item_path: add_slot_res.path } : add_slot_res;
                        }
                    }

                    if (!add_result.ok) {
                        // Put item back on ground
                        if (target_item.position) {
                            add_item_to_ground(place_result.place, target_item.position.x, target_item.position.y, remove_result.item);
                        } else {
                            add_item_to_main_ground(place_result.place, remove_result.item);
                        }
                        save_place_with_ground(data_slot_number, place_id, place_result.place);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: add_result.error }));
                        return;
                    }

                    // Save actor first, then place. Roll back actor if place save fails.
                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        const rollback = save_actor_with_items(data_slot_number, actor_id, actor_before);
                        if (!rollback.ok) {
                            debug_error("API", "pickup rollback failed", rollback.error);
                        }
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    const picked_name = (resolve_inline_item(String(remove_result.item.def_id ?? ''), remove_result.item) ?? null)?.name ?? String(remove_result.item.def_id ?? 'item');
                    debug_log("API", `Picked up ${picked_name} to ${actor_id}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        item: remove_result.item,
                        item_path: add_result.item_path
                    }));
                } catch (err) {
                    debug_error("API", "/api/place/items/pickup error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/pickup_to - Pickup a specific ground item into a specific body_slots target
        if (url.pathname === "/api/place/items/pickup_to") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, item_id, to_container } = data;

                    if (!actor_id || !place_id || !item_id || !to_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    if (typeof to_container !== 'string' || (!to_container.startsWith('body_slots.') && !to_container.startsWith('actor.item.'))) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_to_container" }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    const actor_z = (typeof actor_any.location?.elevation === 'number' && Number.isFinite(actor_any.location.elevation))
                        ? Math.floor(actor_any.location.elevation)
                        : 0;

                    const all_items: Array<{ item: InlineItem; position?: { x: number; y: number }; position_key?: string }> = get_all_ground_items(place_result.place);
                    const found = all_items.find(({ item }: { item: InlineItem }) => item.id === item_id);
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    // Distance validation.
                    // - XY uses the same "throw" radius as PlaceModule (lets you drag a ground item into your inventory
                    //   without requiring strict touch adjacency).
                    // - Z is still limited to 1 for now ("level above/below").
                    if (actor_pos && found.position) {
                        const place_any = place_result.place as any;
                        const base_z = get_place_base_z(place_any);
                        const item_z = (typeof (found.item as any)?.elevation === 'number' && Number.isFinite((found.item as any).elevation))
                            ? Math.floor((found.item as any).elevation)
                            : base_z;

                        const raw_dx = found.position.x - actor_pos.x;
                        const raw_dy = found.position.y - actor_pos.y;
                        const dist_xy = Math.sqrt(raw_dx * raw_dx + raw_dy * raw_dy);
                        const dz = Math.abs(item_z - actor_z);

                        const max_range_xy = 5;
                        const max_range_z = 1;
                        if (dist_xy > max_range_xy || dz > max_range_z) {
                            debug_log('API', `[RANGE] pickup_to too_far actor=${actor_id} actor_pos=(${actor_pos.x},${actor_pos.y},${actor_z}) item=${item_id} item_pos=(${found.position.x},${found.position.y},${item_z}) dist_xy=${dist_xy.toFixed(2)} dxy=(${raw_dx},${raw_dy}) dz=${dz} max_xy=${max_range_xy} max_z=${max_range_z}`);
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({
                                ok: false,
                                error: "too_far",
                                detail: { max_range_xy, max_range_z, dist_xy, dx: raw_dx, dy: raw_dy, dz, actor_z, item_z },
                            }));
                            return;
                        }
                    }

                    // [LEGALITY] validate destination before mutating ground/actor
                    debug_log('API', `[LEGALITY] pickup_to req actor=${actor_id} item=${item_id} to=${to_container}`);
                    const legality = validate_transfer_destination(actor_any, actor_id, found.item, String(to_container), null);
                    if (!legality.ok) {
                        debug_log('API', `[LEGALITY] pickup_to reject error=${legality.error}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }
                    debug_log('API', `[LEGALITY] pickup_to allow`);

                    const remove_result = remove_item_from_ground(place_result.place, item_id);
                    if (!remove_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: remove_result.error }));
                        return;
                    }

                    const body_slots = actor_any.body_slots || {};

                    function has_container_tag(it: any): boolean {
                        if (!it || typeof it !== 'object') return false;
                        const p = resolve_inline_item_payload_for_api(it);
                        return p.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                    }

                    function parse_body_slots_path(p: string): { slot_name: string; slot_type: 'armor'|'tool'|'garb'; garb_index: number | null } | null {
                        const parts = p.split('.');
                        if (parts[0] !== 'body_slots') return null;
                        if (!parts[1] || !parts[2]) return null;
                        const slot_name = parts[1];
                        const slot_type = parts[2] as any;
                        const garb_index = (slot_type === 'garb' && parts[3] !== undefined) ? parseInt(parts[3], 10) : null;
                        return { slot_name, slot_type, garb_index: isNaN(garb_index as any) ? null : garb_index };
                    }

                    function parse_actor_item_container_id(p: string): { actor_id: string; item_id: string } | null {
                        const parts = p.split('.');
                        if (parts[0] !== 'actor' || parts[1] !== 'item') return null;
                        if (!parts[2] || !parts[3]) return null;
                        return { actor_id: parts[2], item_id: parts[3] };
                    }

                    function get_item_at_path(path: string): any {
                        const parsed = parse_body_slots_path(path);
                        if (!parsed) return null;
                        const slot = body_slots[parsed.slot_name];
                        if (!slot) return null;
                        if (parsed.slot_type === 'armor') return slot.armor;
                        if (parsed.slot_type === 'tool') return slot.tool;
                        if (parsed.slot_type === 'garb') {
                            if (parsed.garb_index === null) return null;
                            return slot.garb?.[parsed.garb_index] ?? null;
                        }
                        return null;
                    }

                    function get_container_item(path: string): any {
                        const actor_item = parse_actor_item_container_id(path);
                        if (actor_item) {
                            if (actor_item.actor_id !== actor_id) return null;
                            const found = find_actor_item_by_id(actor_any, actor_item.item_id);
                            return found?.item ?? null;
                        }
                        return get_item_at_path(path);
                    }

                    function get_container_capacity_max_slots(container_item: any): number {
                        const cap = container_item?.container_capacity?.max_slots;
                        if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
                        const fallback = Array.isArray(container_item?.contents) ? container_item.contents.length : 0;
                        return Math.max(1, fallback);
                    }

                    function ensure_sparse_layout(container_item: any, reserved?: { x: number; y: number }): { ok: true } | { ok: false; error: string } {
                        if (!container_item || !Array.isArray(container_item.contents)) return { ok: false, error: 'container_not_found' };
                        const max_slots = get_container_capacity_max_slots(container_item);
                        const { cols } = calculate_grid_dimensions(max_slots);
                        const used = new Set<string>();
                        for (const it of container_item.contents) {
                            const x = (it as any)?.grid_x;
                            const y = (it as any)?.grid_y;
                            if (typeof x === 'number' && typeof y === 'number') {
                                used.add(`${x}_${y}`);
                            }
                        }
                        if (reserved) used.add(`${reserved.x}_${reserved.y}`);
                        for (const it of container_item.contents) {
                            const x = (it as any)?.grid_x;
                            const y = (it as any)?.grid_y;
                            if (typeof x === 'number' && typeof y === 'number') continue;
                            let placed = false;
                            for (let idx = 0; idx < max_slots; idx++) {
                                const px = idx % cols;
                                const py = Math.floor(idx / cols);
                                const key = `${px}_${py}`;
                                if (used.has(key)) continue;
                                (it as any).grid_x = px;
                                (it as any).grid_y = py;
                                used.add(key);
                                placed = true;
                                break;
                            }
                            if (!placed) return { ok: false, error: 'container_full' };
                        }
                        return { ok: true };
                    }

                    // Add to destination
                    let add_ok: { ok: true; item_path: string } | { ok: false; error: string };
                    const dest_item = get_container_item(to_container);
                    if (has_container_tag(dest_item)) {
                        if (!Array.isArray(dest_item.contents)) dest_item.contents = [];
                        const max_slots = dest_item.container_capacity?.max_slots;
                        if (typeof max_slots === 'number' && dest_item.contents.length >= max_slots) {
                            add_ok = { ok: false, error: 'container_full' };
                        } else {
                            // Stabilize sparse layout and assign grid coords for the inserted item.
                            const sparse_res = ensure_sparse_layout(dest_item);
                            if (!sparse_res.ok) {
                                add_ok = { ok: false, error: sparse_res.error };
                            } else {
                                const max = get_container_capacity_max_slots(dest_item);
                                const { cols } = calculate_grid_dimensions(max);
                                const used = new Set<string>();
                                for (const it of dest_item.contents) {
                                    if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') used.add(`${it.grid_x}_${it.grid_y}`);
                                }
                                // find first free
                                for (let idx = 0; idx < max; idx++) {
                                    const px = idx % cols;
                                    const py = Math.floor(idx / cols);
                                    const key = `${px}_${py}`;
                                    if (used.has(key)) continue;
                                    (remove_result.item as any).grid_x = px;
                                    (remove_result.item as any).grid_y = py;
                                    break;
                                }
                                dest_item.contents.push(remove_result.item);
                                add_ok = { ok: true, item_path: `${to_container}.contents.${dest_item.contents.length - 1}` };
                            }
                        }
                    } else {
                        const parsed = parse_body_slots_path(to_container);
                        if (!parsed) {
                            add_ok = { ok: false, error: 'invalid_to_container' };
                        } else {
                            const add_slot_res = add_item_to_body_slot(actor_result.actor, parsed.slot_name, parsed.slot_type, remove_result.item);
                            add_ok = add_slot_res.ok ? { ok: true, item_path: add_slot_res.path } : add_slot_res;
                        }
                    }

                    if (!add_ok.ok) {
                        // Roll back to ground
                        if (found.position) {
                            add_item_to_ground(place_result.place, found.position.x, found.position.y, remove_result.item);
                        } else {
                            add_item_to_main_ground(place_result.place, remove_result.item);
                        }
                        save_place_with_ground(data_slot_number, place_id, place_result.place);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: add_ok.error }));
                        return;
                    }

                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        // Roll back actor to avoid item loss/duplication
                        const rollback = save_actor_with_items(data_slot_number, actor_id, actor_before);
                        if (!rollback.ok) {
                            debug_error("API", "pickup_to rollback failed", rollback.error);
                        }
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, item_path: add_ok.item_path }));
                } catch (err) {
                    debug_error("API", "/api/place/items/pickup_to error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/drop - Drop item from actor to ground
        if (url.pathname === "/api/place/items/drop") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, item_id, x, y, elevation } = data;

                    if (!actor_id || !place_id || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    // Load actor
                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    // Load place
                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    debug_log("API", `[DROP] request actor=${actor_id} item=${item_id} place=${place_id}`);

                    // Remove from actor (recursive)
                    const removed = remove_actor_item_by_id(actor_result.actor, item_id);
                    if (!removed.ok) {
                        debug_log("API", `[DROP] not_found actor=${actor_id} item=${item_id}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: removed.error }));
                        return;
                    }
                    debug_log("API", `[DROP] removed path=${removed.path}`);

                    // Get drop position (use actor position if not specified)
                    const actor = actor_result.actor as any;
                    const drop_x = x ?? actor.location?.tile?.x ?? 0;
                    const drop_y = y ?? actor.location?.tile?.y ?? 0;

                    const place_any = place_result.place as any;
                    const base_z = get_place_base_z(place_any);
                    const actor_z = (typeof actor?.location?.elevation === 'number' && Number.isFinite(actor.location.elevation))
                        ? Math.floor(actor.location.elevation)
                        : base_z;
                    const target_wz = (typeof elevation === 'number' && Number.isFinite(elevation))
                        ? Math.floor(elevation)
                        : actor_z;

                    // Place into world with shared legality: container -> occupied -> ground.
                    const placed = place_item_into_place_legal(place_any, place_id, Math.floor(drop_x), Math.floor(drop_y), target_wz, removed.item);
                    if (!placed.ok) {
                        // Put item back on actor (best-effort)
                        add_item_to_body_slot(actor_result.actor, 'hand_right', 'tool', removed.item);
                        save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: placed.error }));
                        return;
                    }

                    // Save both
                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        const rollback = save_actor_with_items(data_slot_number, actor_id, actor_before);
                        if (!rollback.ok) {
                            debug_error("API", "drop rollback failed", rollback.error);
                        }
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    const dropped_name = (resolve_inline_item(String(removed.item.def_id ?? ''), removed.item) ?? null)?.name ?? String(removed.item.def_id ?? 'item');
                    debug_log("API", `Dropped ${dropped_name} at (${drop_x}, ${drop_y}, z=${target_wz}) placed=${placed.placed}`);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        item: removed.item,
                        position: { x: drop_x, y: drop_y },
                        elevation: target_wz,
                        placed: placed.placed,
                    }));
                } catch (err) {
                    debug_error("API", "/api/place/items/drop error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/deposit_to_container_item - Deposit an actor item into a ground container-item
        if (url.pathname === "/api/place/items/deposit_to_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, item_id, container_item_id, target_grid_x, target_grid_y } = data;

                    if (!actor_id || !place_id || !item_id || !container_item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    // Find container-item on ground
                    const all_ground = get_all_ground_items(place_result.place);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => item.id === container_item_id);
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    const container_item = found.item as any;
                    const container_payload = resolve_inline_item_payload_for_api(container_item);
                    const is_container = container_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }

                    if (!Array.isArray(container_item.contents)) container_item.contents = [];
                    const max_slots = container_item.container_capacity?.max_slots;
                    if (typeof max_slots === 'number' && container_item.contents.length >= max_slots) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_full" }));
                        return;
                    }

                    // Validate item exists on actor before mutating
                    const exists = find_actor_item_by_id(actor_result.actor, item_id);
                    if (!exists) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_actor" }));
                        return;
                    }

                    if (String(container_item_id) === String(item_id)) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "self_deposit" }));
                        return;
                    }

                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x, y: target_grid_y }
                        : null;


                    const max = typeof max_slots === 'number' && max_slots > 0 ? max_slots : Math.max(1, container_item.contents.length + 1);
                    const { cols } = calculate_grid_dimensions(max);

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && found.position) {
                        const base_z = get_place_base_z(place_result.place as any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const container_z = (typeof (found.item as any)?.elevation === 'number' && Number.isFinite((found.item as any).elevation))
                            ? Math.floor((found.item as any).elevation)
                            : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, found.position.x, found.position.y, container_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    // Ensure existing sparse layout (only assign missing)
                    const used = new Set<string>();
                    for (const it of container_item.contents) {
                        if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') {
                            used.add(`${it.grid_x}_${it.grid_y}`);
                        }
                    }

                    // Fill missing coords
                    for (const it of container_item.contents) {
                        if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') continue;
                        for (let idx = 0; idx < max; idx++) {
                            const px = idx % cols;
                            const py = Math.floor(idx / cols);
                            const key = `${px}_${py}`;
                            if (used.has(key)) continue;
                            it.grid_x = px;
                            it.grid_y = py;
                            used.add(key);
                            break;
                        }
                    }

                    // [LEGALITY] enforce container deposit legality after coords are stable
                    debug_log('API', `[LEGALITY] deposit_to_container_item req actor=${actor_id} item=${item_id} to_ground_container=${container_item_id} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'}`);
                    const legality = validate_deposit_into_container_item(container_item, exists.item, grid_target);
                    if (!legality.ok) {
                        debug_log('API', `[LEGALITY] deposit_to_container_item reject error=${legality.error}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }
                    debug_log('API', `[LEGALITY] deposit_to_container_item allow`);

                    // Choose target cell before mutating actor
                    let chosen_x: number | null = null;
                    let chosen_y: number | null = null;
                    const has_grid_target = typeof target_grid_x === 'number' && typeof target_grid_y === 'number';
                    if (has_grid_target) {
                        const key = `${target_grid_x}_${target_grid_y}`;
                        if (used.has(key)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "target_slot_occupied" }));
                            return;
                        }
                        chosen_x = target_grid_x;
                        chosen_y = target_grid_y;
                    } else {
                        for (let idx = 0; idx < max; idx++) {
                            const px = idx % cols;
                            const py = Math.floor(idx / cols);
                            const key = `${px}_${py}`;
                            if (used.has(key)) continue;
                            chosen_x = px;
                            chosen_y = py;
                            break;
                        }
                    }

                    if (chosen_x === null || chosen_y === null) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_full" }));
                        return;
                    }

                    // Remove item from actor (now safe)
                    const removed = remove_actor_item_by_id(actor_result.actor, item_id);
                    if (!removed.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: removed.error }));
                        return;
                    }

                    (removed.item as any).grid_x = chosen_x;
                    (removed.item as any).grid_y = chosen_y;
                    container_item.contents.push(removed.item);

                    // Save actor first, then place. Roll back actor if place save fails.
                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        const rollback = save_actor_with_items(data_slot_number, actor_id, actor_before);
                        if (!rollback.ok) {
                            debug_error("API", "deposit_to_container_item rollback failed", rollback.error);
                        }
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/deposit_to_container_item error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/deposit_to_tile_container - Deposit an actor item into a tile container
        if (url.pathname === "/api/place/items/deposit_to_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, item_id, x, y, target_grid_x, target_grid_y } = data;
                    if (!actor_id || !place_id || !item_id || typeof x !== 'number' || typeof y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }
                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }

                    const place = place_res.place as any;
                    const tx = Math.floor(x);
                    const ty = Math.floor(y);

                    const tile = place?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                    const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }

                    if (!Array.isArray(tile.contents)) tile.contents = [];
                    if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
                        tile.container_capacity = { max_slots: Math.max(12, tile.contents.length + 1) };
                    }

                    const max_slots = Math.floor(tile.container_capacity.max_slots);
                    if (tile.contents.length >= max_slots) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_full" }));
                        return;
                    }

                    // Remove item from actor (recursive)
                    const removed = remove_actor_item_by_id(actor_result.actor, item_id);
                    if (!removed.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: removed.error }));
                        return;
                    }

                    // Place into tile contents.
                    // Respect target grid if provided and unoccupied; otherwise normalize will assign.
                    if (typeof target_grid_x === 'number' && typeof target_grid_y === 'number') {
                        (removed.item as any).grid_x = Math.floor(target_grid_x);
                        (removed.item as any).grid_y = Math.floor(target_grid_y);
                    } else {
                        delete (removed.item as any).grid_x;
                        delete (removed.item as any).grid_y;
                    }
                    tile.contents.push(removed.item);

                    // Normalize grid (repairs collisions/out-of-bounds and assigns empties).
                    const normalized = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of tile.contents) {
                        const id = String(it?.id ?? '');
                        const c = coords_by_id.get(id);
                        if (!c) continue;
                        (it as any).grid_x = c.x;
                        (it as any).grid_y = c.y;
                    }

                    // Save both
                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    try {
                        save_place(data_slot_number, place as any);
                    } catch (err) {
                        // Roll back actor best-effort
                        save_actor_with_items(data_slot_number, actor_id, actor_before);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "save_place_failed" }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/deposit_to_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/move_within_tile_container - Move an item inside a tile container (grid reposition)
        if (url.pathname === "/api/place/items/move_within_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, x, y, item_id, target_grid_x, target_grid_y } = data;

                    if (!actor_id || !place_id || typeof x !== 'number' || typeof y !== 'number' || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }
                    if (typeof target_grid_x !== 'number' || typeof target_grid_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_target_grid" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }

                    const place_any = place_res.place as any;
                    const tx = Math.floor(x);
                    const ty = Math.floor(y);

                    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, tx, ty, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                    const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(tile.contents)) tile.contents = [];

                    const idx = tile.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container" }));
                        return;
                    }

                    if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
                        tile.container_capacity = { max_slots: Math.max(1, tile.contents.length) };
                    }
                    const max_slots = Math.floor(tile.container_capacity.max_slots);

                    const grid_ok = validate_grid_target(max_slots, { x: Math.floor(target_grid_x), y: Math.floor(target_grid_y) });
                    if (!grid_ok.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: grid_ok.error, detail: grid_ok.detail }));
                        return;
                    }

                    const moving = tile.contents[idx];
                    moving.grid_x = Math.floor(target_grid_x);
                    moving.grid_y = Math.floor(target_grid_y);

                    const normalized = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of tile.contents) {
                        const id = String(it?.id ?? '');
                        const c = coords_by_id.get(id);
                        if (!c) continue;
                        it.grid_x = c.x;
                        it.grid_y = c.y;
                    }

                    save_place(data_slot_number, place_any);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/move_within_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/withdraw_from_tile_container - Withdraw an item from a tile container into the actor
        if (url.pathname === "/api/place/items/withdraw_from_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, x, y, item_id, to_container, target_grid_x, target_grid_y } = data;

                    if (!actor_id || !place_id || typeof x !== 'number' || typeof y !== 'number' || !item_id || !to_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }
                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }

                    const place_any = place_res.place as any;
                    const tx = Math.floor(x);
                    const ty = Math.floor(y);
                    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, tx, ty, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                    const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(tile.contents)) tile.contents = [];

                    const idx = tile.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container" }));
                        return;
                    }

                    const moving_item = tile.contents[idx];
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    debug_log('API', `[LEGALITY] withdraw_from_tile_container req actor=${actor_id} item=${item_id} from_tile=${place_id}:${tx},${ty} to=${to_container} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'}`);
                    const legality = validate_transfer_destination(actor_result.actor, actor_id, moving_item, String(to_container), grid_target);
                    if (!legality.ok) {
                        debug_log('API', `[LEGALITY] withdraw_from_tile_container reject error=${legality.error}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    const removed_list = tile.contents.splice(idx, 1);
                    const removed = removed_list[0];
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    function place_into_container_item(dest_container_item: any, item: any, grid: GridTarget, log_ctx: string): { ok: true } | { ok: false; error: string; detail?: any } {
                        if (!has_tag(dest_container_item, 'CONTAINER')) return { ok: false, error: 'not_a_container' };
                        if (!Array.isArray(dest_container_item.contents)) dest_container_item.contents = [];

                        const max_slots = get_container_capacity_max_slots(dest_container_item);
                        const normalized = normalize_inline_container_grid(dest_container_item.contents, max_slots, log_ctx);
                        const coords_by_id = new Map<string, { x: number; y: number }>();
                        for (const e of normalized) {
                            const id = String(e.item?.id ?? '');
                            if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                        }
                        for (const it of dest_container_item.contents) {
                            const c = coords_by_id.get(String(it?.id ?? ''));
                            if (c) {
                                it.grid_x = c.x;
                                it.grid_y = c.y;
                            }
                        }

                        const used = new Set<string>();
                        for (const it of dest_container_item.contents) {
                            if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') used.add(`${it.grid_x}_${it.grid_y}`);
                        }

                        let chosen: { x: number; y: number } | null = null;
                        if (grid) {
                            const grid_ok = validate_grid_target(max_slots, grid);
                            if (!grid_ok.ok) return { ok: false, error: grid_ok.error, detail: grid_ok.detail };
                            const key = `${grid.x}_${grid.y}`;
                            if (used.has(key)) return { ok: false, error: 'target_slot_occupied' };
                            chosen = { x: grid.x, y: grid.y };
                        } else {
                            const { cols } = calculate_grid_dimensions(max_slots);
                            for (let idx = 0; idx < max_slots; idx++) {
                                const px = idx % cols;
                                const py = Math.floor(idx / cols);
                                const key = `${px}_${py}`;
                                if (used.has(key)) continue;
                                chosen = { x: px, y: py };
                                break;
                            }
                        }

                        if (!chosen) return { ok: false, error: 'container_full' };
                        (item as any).grid_x = chosen.x;
                        (item as any).grid_y = chosen.y;
                        dest_container_item.contents.push(item);
                        return { ok: true };
                    }

                    const t = resolve_target(String(to_container));
                    if (!t) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_to_path" }));
                        return;
                    }

                    if (t.kind === 'actor_item') {
                        const dest_item = resolve_actor_container_item(actor_result.actor, actor_id, t.item_id);
                        if (!dest_item) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "destination_not_found" }));
                            return;
                        }
                        const placed = place_into_container_item(dest_item, removed, grid_target, `withdraw_to_actor_item:${actor_id}:${t.item_id}`);
                        if (!placed.ok) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: placed.error, detail: placed.detail }));
                            return;
                        }
                    } else {
                        const body_slots = (actor_result.actor as any).body_slots || {};
                        (actor_result.actor as any).body_slots = body_slots;
                        const slot = body_slots[t.slot_name];
                        if (!slot) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "slot_not_found" }));
                            return;
                        }

                        let existing: any = null;
                        if (t.slot_type === 'armor') existing = slot.armor;
                        else if (t.slot_type === 'tool') existing = slot.tool;
                        else if (t.slot_type === 'garb' && t.garb_index !== null) existing = slot.garb?.[t.garb_index] ?? null;

                        if (existing && has_tag(existing, 'CONTAINER')) {
                            const placed = place_into_container_item(existing, removed, grid_target, `withdraw_to_body_slot_container:${actor_id}:${t.slot_name}:${t.slot_type}`);
                            if (!placed.ok) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: placed.error, detail: placed.detail }));
                                return;
                            }
                        } else {
                            if (t.slot_type === 'armor') {
                                if (slot.armor) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: "armor_slot_occupied" }));
                                    return;
                                }
                                slot.armor = removed;
                            } else if (t.slot_type === 'tool') {
                                if (slot.tool) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: "tool_slot_occupied" }));
                                    return;
                                }
                                slot.tool = removed;
                            } else if (t.slot_type === 'garb') {
                                if (!Array.isArray(slot.garb)) slot.garb = [];
                                if (t.garb_index === null) {
                                    slot.garb.push(removed);
                                } else {
                                    slot.garb.splice(t.garb_index, 0, removed);
                                }
                            }
                        }
                    }

                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    try {
                        save_place(data_slot_number, place_any);
                    } catch (err) {
                        save_actor_with_items(data_slot_number, actor_id, actor_before);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "save_place_failed" }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, place_id }));
                } catch (err) {
                    debug_error("API", "/api/place/items/withdraw_from_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/spill_from_tile_container - Spill an item from a tile container onto the ground
        if (url.pathname === "/api/place/items/spill_from_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, x, y, item_id, to_x, to_y, to_elevation } = data;
                    if (!actor_id || !place_id || typeof x !== 'number' || typeof y !== 'number' || !item_id || typeof to_x !== 'number' || typeof to_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }

                    const place_any = place_res.place as any;
                    if (!place_any.ground) place_any.ground = { main: [], scattered: {} };
                    if (!place_any.ground.scattered) place_any.ground.scattered = {};

                    const tx = Math.floor(x);
                    const ty = Math.floor(y);
                    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }
                    if (!Array.isArray(tile.contents)) tile.contents = [];

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, tx, ty, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const idx = tile.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container" }));
                        return;
                    }
                    const [removed] = tile.contents.splice(idx, 1);
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    const base_z = get_place_base_z(place_any);
                    const target_wz = (typeof to_elevation === 'number' && Number.isFinite(to_elevation))
                        ? Math.floor(to_elevation)
                        : base_z;

                    // Place into world with shared legality.
                    const placed = place_item_into_place_legal(place_any, place_id, Math.floor(to_x), Math.floor(to_y), target_wz, removed);
                    if (!placed.ok) {
                        // Roll back into the container best-effort.
                        tile.contents.push(removed);
                        save_place(data_slot_number, place_any);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: placed.error }));
                        return;
                    }
                    save_place(data_slot_number, place_any);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, placed: placed.placed }));
                } catch (err) {
                    debug_error("API", "/api/place/items/spill_from_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/deposit_ground_to_tile_container - Move a top-level ground item into a tile container
        if (url.pathname === "/api/place/items/deposit_ground_to_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, from_x, from_y, from_elevation, item_id, x, y, target_grid_x, target_grid_y } = data;
                    if (!actor_id || !place_id || typeof from_x !== 'number' || typeof from_y !== 'number' || !item_id || typeof x !== 'number' || typeof y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }

                    const place_any = place_res.place as any;
                    if (!place_any.ground) place_any.ground = { main: [], scattered: {} };
                    if (!place_any.ground.scattered) place_any.ground.scattered = {};

                    const tx = Math.floor(x);
                    const ty = Math.floor(y);
                    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, tx, ty, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                    const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(tile.contents)) tile.contents = [];
                    if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
                        tile.container_capacity = { max_slots: Math.max(12, tile.contents.length + 1) };
                    }
                    const max_slots = Math.floor(tile.container_capacity.max_slots);

                    // Remove from ground
                    const removed = remove_item_from_ground(place_any, String(item_id));
                    if (!removed.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: removed.error }));
                        return;
                    }
                    if (!removed.from_position || removed.from_position.x !== Math.floor(from_x) || removed.from_position.y !== Math.floor(from_y)) {
                        // Put back
                        if (removed.from_position) add_item_to_ground(place_any, removed.from_position.x, removed.from_position.y, removed.item);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_at_source_position" }));
                        return;
                    }

                    if (typeof from_elevation === 'number' && Number.isFinite(from_elevation)) {
                        const want = Math.floor(from_elevation);
                        const got = Math.floor(Number((removed.from_position as any).z));
                        if (Number.isFinite(got) && got !== want) {
                            add_item_to_ground(place_any, removed.from_position.x, removed.from_position.y, removed.item);
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "not_at_source_elevation" }));
                            return;
                        }
                    }

                    // Deposit with legality helper
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    const legality = validate_deposit_into_container_item(tile, removed.item, grid_target);
                    if (!legality.ok) {
                        // rollback to ground
                        add_item_to_ground(place_any, removed.from_position.x, removed.from_position.y, removed.item);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    tile.contents.push(removed.item);
                    const normalized = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    for (const it of tile.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) { (it as any).grid_x = c.x; (it as any).grid_y = c.y; }
                    }

                    save_place(data_slot_number, place_any);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/deposit_ground_to_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/transfer_between_tile_containers - Move an item between two tile containers
        if (url.pathname === "/api/place/items/transfer_between_tile_containers") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, from_x, from_y, to_x, to_y, item_id, target_grid_x, target_grid_y } = data;
                    if (!actor_id || !place_id || typeof from_x !== 'number' || typeof from_y !== 'number' || typeof to_x !== 'number' || typeof to_y !== 'number' || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_res = load_place(data_slot_number, place_id);
                    if (!place_res.ok) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                        return;
                    }
                    const place_any = place_res.place as any;

                    const sx = Math.floor(from_x);
                    const sy = Math.floor(from_y);
                    const dx = Math.floor(to_x);
                    const dy = Math.floor(to_y);

                    const src_tile = place_any?.tiles?.cells?.[sy]?.[sx];
                    const dst_tile = place_any?.tiles?.cells?.[dy]?.[dx];
                    if (!src_tile || !dst_tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    const src_tags = (resolve_place_tile(String(src_tile.kind ?? ''), src_tile) ?? null)?.effective_tags ?? (Array.isArray(src_tile.tags) ? src_tile.tags : []);
                    const dst_tags = (resolve_place_tile(String(dst_tile.kind ?? ''), dst_tile) ?? null)?.effective_tags ?? (Array.isArray(dst_tile.tags) ? dst_tile.tags : []);
                    const src_is_container = src_tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(src_tile.contents);
                    const dst_is_container = dst_tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(dst_tile.contents);
                    if (!src_is_container || !dst_is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }

                    if (!Array.isArray(src_tile.contents)) src_tile.contents = [];
                    if (!Array.isArray(dst_tile.contents)) dst_tile.contents = [];
                    if (!dst_tile.container_capacity || typeof dst_tile.container_capacity.max_slots !== 'number' || dst_tile.container_capacity.max_slots < 1) {
                        dst_tile.container_capacity = { max_slots: Math.max(12, dst_tile.contents.length + 1) };
                    }
                    const max_slots = Math.floor(dst_tile.container_capacity.max_slots);

                    const idx = src_tile.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container" }));
                        return;
                    }

                    const moving = src_tile.contents[idx];
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;
                    const legality = validate_deposit_into_container_item(dst_tile, moving, grid_target);
                    if (!legality.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    const [removed] = src_tile.contents.splice(idx, 1);
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    // Apply grid target if provided
                    if (grid_target) {
                        (removed as any).grid_x = grid_target.x;
                        (removed as any).grid_y = grid_target.y;
                    } else {
                        delete (removed as any).grid_x;
                        delete (removed as any).grid_y;
                    }
                    dst_tile.contents.push(removed);

                    const normalized = normalize_inline_container_grid(dst_tile.contents, max_slots, `place_tile_container:${place_id}:${dx},${dy}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    for (const it of dst_tile.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) { (it as any).grid_x = c.x; (it as any).grid_y = c.y; }
                    }

                    save_place(data_slot_number, place_any);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/transfer_between_tile_containers error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/transfer_from_container_item_to_tile_container - Move an item from a ground container-item into a tile container
        if (url.pathname === "/api/place/items/transfer_from_container_item_to_tile_container") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, from_container_item_id, to_x, to_y, item_id, target_grid_x, target_grid_y } = data;
                    if (!actor_id || !place_id || !from_container_item_id || !item_id || typeof to_x !== 'number' || typeof to_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const place_any = place_result.place as any;
                    const tx = Math.floor(to_x);
                    const ty = Math.floor(to_y);
                    const tile = place_any?.tiles?.cells?.[ty]?.[tx];
                    if (!tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, tx, ty, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                    const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                    if (!is_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(tile.contents)) tile.contents = [];
                    if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
                        tile.container_capacity = { max_slots: Math.max(12, tile.contents.length + 1) };
                    }
                    const max_slots = Math.floor(tile.container_capacity.max_slots);

                    const all_ground = get_all_ground_items(place_any);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => String(item?.id ?? '') === String(from_container_item_id));
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }
                    const container_item = found.item as any;
                    if (!has_tag(container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(container_item.contents)) container_item.contents = [];
                    const idx = container_item.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container_item" }));
                        return;
                    }

                    const moving_item = container_item.contents[idx];
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;
                    const legality = validate_deposit_into_container_item(tile, moving_item, grid_target);
                    if (!legality.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    const [removed] = container_item.contents.splice(idx, 1);
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }
                    if (grid_target) {
                        (removed as any).grid_x = grid_target.x;
                        (removed as any).grid_y = grid_target.y;
                    } else {
                        delete (removed as any).grid_x;
                        delete (removed as any).grid_y;
                    }
                    tile.contents.push(removed);

                    const normalized = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    for (const it of tile.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) { (it as any).grid_x = c.x; (it as any).grid_y = c.y; }
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_any);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/transfer_from_container_item_to_tile_container error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/transfer_from_tile_container_to_container_item - Move an item from a tile container into a ground container-item
        if (url.pathname === "/api/place/items/transfer_from_tile_container_to_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, from_x, from_y, to_container_item_id, item_id, target_grid_x, target_grid_y } = data;
                    if (!actor_id || !place_id || typeof from_x !== 'number' || typeof from_y !== 'number' || !to_container_item_id || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const place_any = place_result.place as any;

                    const sx = Math.floor(from_x);
                    const sy = Math.floor(from_y);
                    const src_tile = place_any?.tiles?.cells?.[sy]?.[sx];
                    if (!src_tile) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const tile_z = base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, sx, sy, tile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    if (!Array.isArray(src_tile.contents)) src_tile.contents = [];
                    const idx = src_tile.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container" }));
                        return;
                    }

                    const all_ground = get_all_ground_items(place_any);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => String(item?.id ?? '') === String(to_container_item_id));
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    const dest_container_item = found.item as any;
                    if (!has_tag(dest_container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(dest_container_item.contents)) dest_container_item.contents = [];

                    const moving_item = src_tile.contents[idx];
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    const legality = validate_deposit_into_container_item(dest_container_item, moving_item, grid_target);
                    if (!legality.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    const [removed] = src_tile.contents.splice(idx, 1);
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    if (grid_target) {
                        (removed as any).grid_x = grid_target.x;
                        (removed as any).grid_y = grid_target.y;
                    } else {
                        delete (removed as any).grid_x;
                        delete (removed as any).grid_y;
                    }
                    dest_container_item.contents.push(removed);

                    const max_slots = get_container_capacity_max_slots(dest_container_item);
                    const normalized = normalize_inline_container_grid(dest_container_item.contents, max_slots, `ground_container_item:${place_id}:${to_container_item_id}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                    for (const it of dest_container_item.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) { (it as any).grid_x = c.x; (it as any).grid_y = c.y; }
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_any);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/transfer_from_tile_container_to_container_item error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/move_within_container_item - Move an item inside a ground container-item (grid reposition)
        if (url.pathname === "/api/place/items/move_within_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, container_item_id, item_id, target_grid_x, target_grid_y } = data;

                    if (!actor_id || !place_id || !container_item_id || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    if (typeof target_grid_x !== 'number' || typeof target_grid_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_target_grid" }));
                        return;
                    }

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const all_ground = get_all_ground_items(place_result.place);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => item.id === container_item_id);
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && found.position) {
                        const base_z = get_place_base_z(place_result.place as any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const container_z = (typeof (found.item as any)?.elevation === 'number' && Number.isFinite((found.item as any).elevation))
                            ? Math.floor((found.item as any).elevation)
                            : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, found.position.x, found.position.y, container_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const container_item = found.item as any;
                    if (!has_tag(container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(container_item.contents)) container_item.contents = [];

                    // Ensure capacity + stable sparse layout.
                    const cap = resolve_inline_container_capacity(container_item, container_item.contents.length, `ground_container_item:${place_id}:${container_item_id}`);
                    const normalized = normalize_inline_container_grid(container_item.contents, cap.max_slots, `ground_container_item:${place_id}:${container_item_id}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        const id = String(e.item?.id ?? '');
                        if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of container_item.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) {
                            it.grid_x = c.x;
                            it.grid_y = c.y;
                        }
                    }

                    const grid_target: GridTarget = { x: target_grid_x, y: target_grid_y };
                    const grid_ok = validate_grid_target(cap.max_slots, grid_target);
                    if (!grid_ok.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: grid_ok.error, detail: grid_ok.detail }));
                        return;
                    }

                    const moving = container_item.contents.find((it: any) => String(it?.id ?? '') === String(item_id));
                    if (!moving) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container_item" }));
                        return;
                    }

                    const occupied = container_item.contents.find((it: any) =>
                        String(it?.id ?? '') !== String(item_id) && it?.grid_x === grid_target.x && it?.grid_y === grid_target.y
                    );
                    if (occupied) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "target_slot_occupied" }));
                        return;
                    }

                    moving.grid_x = grid_target.x;
                    moving.grid_y = grid_target.y;

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/move_within_container_item error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/withdraw_from_container_item - Withdraw an item from a ground container-item into the actor
        if (url.pathname === "/api/place/items/withdraw_from_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, container_item_id, item_id, to_container, target_grid_x, target_grid_y } = data;

                    if (!actor_id || !place_id || !container_item_id || !item_id || !to_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }
                    const actor_before = JSON.parse(JSON.stringify(actor_result.actor));

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const all_ground = get_all_ground_items(place_result.place);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => item.id === container_item_id);
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    // Distance validation (touch range) - 3D.
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && found.position) {
                        const base_z = get_place_base_z(place_result.place as any);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const container_z = (typeof (found.item as any)?.elevation === 'number' && Number.isFinite((found.item as any).elevation))
                            ? Math.floor((found.item as any).elevation)
                            : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, found.position.x, found.position.y, container_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const container_item = found.item as any;
                    if (!has_tag(container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(container_item.contents)) container_item.contents = [];

                    const idx = container_item.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container_item" }));
                        return;
                    }

                    const moving_item = container_item.contents[idx];
                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    // [LEGALITY] validate destination using snapshot instance tags (authoritative)
                    debug_log('API', `[LEGALITY] withdraw_from_container_item req actor=${actor_id} item=${item_id} from_ground_container=${container_item_id} to=${to_container} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'}`);
                    const legality = validate_transfer_destination(actor_result.actor, actor_id, moving_item, String(to_container), grid_target);
                    if (!legality.ok) {
                        debug_log('API', `[LEGALITY] withdraw_from_container_item reject error=${legality.error}`);
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }
                    debug_log('API', `[LEGALITY] withdraw_from_container_item allow`);

                    // Remove from ground container-item
                    const removed_list = container_item.contents.splice(idx, 1);
                    const removed = removed_list[0];
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    function place_into_container_item(dest_container_item: any, item: any, grid: GridTarget, log_ctx: string): { ok: true } | { ok: false; error: string; detail?: any } {
                        if (!has_tag(dest_container_item, 'CONTAINER')) return { ok: false, error: 'not_a_container' };
                        if (!Array.isArray(dest_container_item.contents)) dest_container_item.contents = [];

                        const max_slots = get_container_capacity_max_slots(dest_container_item);

                        // Sanitize + stabilize existing layout.
                        const normalized = normalize_inline_container_grid(dest_container_item.contents, max_slots, log_ctx);
                        const coords_by_id = new Map<string, { x: number; y: number }>();
                        for (const e of normalized) {
                            const id = String(e.item?.id ?? '');
                            if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                        }
                        for (const it of dest_container_item.contents) {
                            const c = coords_by_id.get(String(it?.id ?? ''));
                            if (c) {
                                it.grid_x = c.x;
                                it.grid_y = c.y;
                            }
                        }

                        const used = new Set<string>();
                        for (const it of dest_container_item.contents) {
                            if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') {
                                used.add(`${it.grid_x}_${it.grid_y}`);
                            }
                        }

                        let chosen: { x: number; y: number } | null = null;
                        if (grid) {
                            const grid_ok = validate_grid_target(max_slots, grid);
                            if (!grid_ok.ok) return { ok: false, error: grid_ok.error, detail: grid_ok.detail };
                            const key = `${grid.x}_${grid.y}`;
                            if (used.has(key)) return { ok: false, error: 'target_slot_occupied' };
                            chosen = { x: grid.x, y: grid.y };
                        } else {
                            const { cols } = calculate_grid_dimensions(max_slots);
                            for (let idx = 0; idx < max_slots; idx++) {
                                const px = idx % cols;
                                const py = Math.floor(idx / cols);
                                const key = `${px}_${py}`;
                                if (used.has(key)) continue;
                                chosen = { x: px, y: py };
                                break;
                            }
                        }

                        if (!chosen) return { ok: false, error: 'container_full' };
                        (item as any).grid_x = chosen.x;
                        (item as any).grid_y = chosen.y;
                        dest_container_item.contents.push(item);
                        return { ok: true };
                    }

                    // Add to destination
                    const t = resolve_target(String(to_container));
                    if (!t) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_to_path" }));
                        return;
                    }

                    if (t.kind === 'actor_item') {
                        const dest_item = resolve_actor_container_item(actor_result.actor, actor_id, t.item_id);
                        if (!dest_item) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "destination_not_found" }));
                            return;
                        }
                        const placed = place_into_container_item(dest_item, removed, grid_target, `withdraw_to_actor_item:${actor_id}:${t.item_id}`);
                        if (!placed.ok) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: placed.error, detail: placed.detail }));
                            return;
                        }
                    } else {
                        const body_slots = (actor_result.actor as any).body_slots || {};
                        (actor_result.actor as any).body_slots = body_slots;
                        const slot = body_slots[t.slot_name];
                        if (!slot) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "slot_not_found" }));
                            return;
                        }

                        let existing: any = null;
                        if (t.slot_type === 'armor') existing = slot.armor;
                        else if (t.slot_type === 'tool') existing = slot.tool;
                        else if (t.slot_type === 'garb' && t.garb_index !== null) existing = slot.garb?.[t.garb_index] ?? null;

                        // If dropping onto a body slot that contains a container-item, treat it as deposit.
                        if (existing && has_tag(existing, 'CONTAINER')) {
                            const placed = place_into_container_item(existing, removed, grid_target, `withdraw_to_body_slot_container:${actor_id}:${t.slot_name}:${t.slot_type}`);
                            if (!placed.ok) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: placed.error, detail: placed.detail }));
                                return;
                            }
                        } else {
                            // Equip into the slot.
                            if (t.slot_type === 'armor') {
                                if (slot.armor) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: "armor_slot_occupied" }));
                                    return;
                                }
                                slot.armor = removed;
                            } else if (t.slot_type === 'tool') {
                                if (slot.tool) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: "tool_slot_occupied" }));
                                    return;
                                }
                                slot.tool = removed;
                            } else {
                                if (!Array.isArray(slot.garb)) slot.garb = [];
                                const gi = t.garb_index;
                                if (gi === null || gi === slot.garb.length) {
                                    slot.garb.push(removed);
                                } else {
                                    if (gi < 0 || gi > slot.garb.length) {
                                        res.writeHead(400, { "Content-Type": "application/json" });
                                        res.end(JSON.stringify({ ok: false, error: "invalid_garb_index" }));
                                        return;
                                    }
                                    if (slot.garb[gi]) {
                                        res.writeHead(400, { "Content-Type": "application/json" });
                                        res.end(JSON.stringify({ ok: false, error: "garb_slot_occupied" }));
                                        return;
                                    }
                                    slot.garb.splice(gi, 0, removed);
                                }
                            }
                        }
                    }

                    // Save actor first, then place. Roll back actor if place save fails.
                    const save_actor_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_actor_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_actor_result.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        const rollback = save_actor_with_items(data_slot_number, actor_id, actor_before);
                        if (!rollback.ok) {
                            debug_error("API", "withdraw_from_container_item rollback failed", rollback.error);
                        }
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/withdraw_from_container_item error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/spill_from_container_item - Spill an item from a ground container-item onto a ground tile
        if (url.pathname === "/api/place/items/spill_from_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, container_item_id, item_id, x, y, to_elevation, action_cost } = data;

                    if (!actor_id || !place_id || !container_item_id || !item_id || typeof x !== 'number' || typeof y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    debug_log('API', `[INLINE] spill_from_container_item actor=${actor_id} place=${place_id} container=${container_item_id} item=${item_id} to=(${x},${y}) cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const all_ground = get_all_ground_items(place_result.place);
                    const found = all_ground.find(({ item }: { item: InlineItem }) => item.id === container_item_id);
                    if (!found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    // Range check: must be near BOTH the container-item and the drop voxel (3D).
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const place_any = place_result.place as any;
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);

                        if (found.position) {
                            const container_z = (typeof (found.item as any)?.elevation === 'number' && Number.isFinite((found.item as any).elevation))
                                ? Math.floor((found.item as any).elevation)
                                : base_z;
                            if (!within_range_xy_z(actor_pos, actor_z, found.position.x, found.position.y, container_z, 1.5, 1)) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: "too_far" }));
                                return;
                            }
                        }

                        const drop_z = (typeof to_elevation === 'number' && Number.isFinite(to_elevation)) ? Math.floor(to_elevation) : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, x, y, drop_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const container_item = found.item as any;
                    if (!has_tag(container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(container_item.contents)) container_item.contents = [];

                    const idx = container_item.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container_item" }));
                        return;
                    }

                    const removed_list = container_item.contents.splice(idx, 1);
                    const removed = removed_list[0] as any;
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    // Remove container-local grid coords when spilling to ground.
                    delete removed.grid_x;
                    delete removed.grid_y;

                    const place_any = place_result.place as any;
                    const base_z = get_place_base_z(place_any);
                    const target_wz = (typeof to_elevation === 'number' && Number.isFinite(to_elevation))
                        ? Math.floor(to_elevation)
                        : base_z;

                    const placed = place_item_into_place_legal(place_any, place_id, Math.floor(x), Math.floor(y), target_wz, removed);
                    if (!placed.ok) {
                        // Best-effort rollback
                        container_item.contents.splice(idx, 0, removed);
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: placed.error }));
                        return;
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        // Best-effort rollback
                        const pos_items = get_items_at_position(place_result.place, x, y);
                        const ground_idx = pos_items.findIndex((it: any) => String(it?.id ?? '') === String(removed.id));
                        if (ground_idx >= 0) pos_items.splice(ground_idx, 1);
                        container_item.contents.splice(idx, 0, removed);

                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, placed: placed.placed }));
                } catch (err) {
                    debug_error("API", "/api/place/items/spill_from_container_item error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/transfer_between_container_items - Move an item from one ground container-item to another
        if (url.pathname === "/api/place/items/transfer_between_container_items") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, from_container_item_id, to_container_item_id, item_id, target_grid_x, target_grid_y, action_cost } = data;

                    if (!actor_id || !place_id || !from_container_item_id || !to_container_item_id || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    if (String(from_container_item_id) === String(to_container_item_id)) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "self_deposit" }));
                        return;
                    }

                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    debug_log('API', `[INLINE] transfer_between_container_items actor=${actor_id} place=${place_id} from=${from_container_item_id} to=${to_container_item_id} item=${item_id} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'} cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const place_result = load_place_with_ground(data_slot_number, place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const all_ground = get_all_ground_items(place_result.place);
                    const from_found = all_ground.find(({ item }: { item: InlineItem }) => item.id === from_container_item_id);
                    const to_found = all_ground.find(({ item }: { item: InlineItem }) => item.id === to_container_item_id);
                    if (!from_found || !to_found) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    // Range check (B): must be near BOTH containers (3D).
                    const actor_any = actor_result.actor as any;
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos) {
                        const place_any = place_result.place as any;
                        const base_z = get_place_base_z(place_any);
                        const actor_z = get_actor_world_z(actor_any, base_z);

                        if (from_found.position) {
                            const from_z = (typeof (from_found.item as any)?.elevation === 'number' && Number.isFinite((from_found.item as any).elevation))
                                ? Math.floor((from_found.item as any).elevation)
                                : base_z;
                            if (!within_range_xy_z(actor_pos, actor_z, from_found.position.x, from_found.position.y, from_z, 1.5, 1)) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: "too_far" }));
                                return;
                            }
                        }

                        if (to_found.position) {
                            const to_z = (typeof (to_found.item as any)?.elevation === 'number' && Number.isFinite((to_found.item as any).elevation))
                                ? Math.floor((to_found.item as any).elevation)
                                : base_z;
                            if (!within_range_xy_z(actor_pos, actor_z, to_found.position.x, to_found.position.y, to_z, 1.5, 1)) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: "too_far" }));
                                return;
                            }
                        }
                    }

                    const from_container = from_found.item as any;
                    const to_container = to_found.item as any;
                    if (!has_tag(from_container, 'CONTAINER') || !has_tag(to_container, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(from_container.contents)) from_container.contents = [];
                    if (!Array.isArray(to_container.contents)) to_container.contents = [];

                    const from_idx = from_container.contents.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (from_idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_container_item" }));
                        return;
                    }

                    const moving_item = from_container.contents[from_idx];
                    if (!moving_item) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    // Stabilize destination grid + enforce legality BEFORE mutating.
                    const max_slots = get_container_capacity_max_slots(to_container);
                    const grid_ok = validate_grid_target(max_slots, grid_target);
                    if (!grid_ok.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: grid_ok.error, detail: grid_ok.detail }));
                        return;
                    }

                    const normalized = normalize_inline_container_grid(to_container.contents, max_slots, `ground_container_item:${place_id}:${to_container_item_id}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        const id = String(e.item?.id ?? '');
                        if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of to_container.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) {
                            it.grid_x = c.x;
                            it.grid_y = c.y;
                        }
                    }

                    const legality = validate_deposit_into_container_item(to_container, moving_item, grid_target);
                    if (!legality.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    // Choose target cell.
                    const used = new Set<string>();
                    for (const it of to_container.contents) {
                        if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') {
                            used.add(`${it.grid_x}_${it.grid_y}`);
                        }
                    }

                    let chosen_x: number | null = null;
                    let chosen_y: number | null = null;
                    if (grid_target) {
                        const key = `${grid_target.x}_${grid_target.y}`;
                        if (used.has(key)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "target_slot_occupied" }));
                            return;
                        }
                        chosen_x = grid_target.x;
                        chosen_y = grid_target.y;
                    } else {
                        const { cols } = calculate_grid_dimensions(max_slots);
                        for (let idx = 0; idx < max_slots; idx++) {
                            const px = idx % cols;
                            const py = Math.floor(idx / cols);
                            const key = `${px}_${py}`;
                            if (used.has(key)) continue;
                            chosen_x = px;
                            chosen_y = py;
                            break;
                        }
                    }

                    if (chosen_x === null || chosen_y === null) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_full" }));
                        return;
                    }

                    // Mutate: remove from source, add to destination.
                    const removed_list = from_container.contents.splice(from_idx, 1);
                    const removed = removed_list[0] as any;
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    removed.grid_x = chosen_x;
                    removed.grid_y = chosen_y;
                    to_container.contents.push(removed);

                    const save_place_result = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_result.ok) {
                        // Best-effort rollback
                        const to_idx = to_container.contents.findIndex((it: any) => String(it?.id ?? '') === String(removed.id));
                        if (to_idx >= 0) to_container.contents.splice(to_idx, 1);
                        from_container.contents.splice(from_idx, 0, removed);

                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("API", "/api/place/items/transfer_between_container_items error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/deposit_ground_to_container_item - Move a top-level ground item into a ground container-item
        if (url.pathname === "/api/place/items/deposit_ground_to_container_item") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const {
                        actor_id,
                        place_id,
                        from_x,
                        from_y,
                        from_elevation,
                        item_id,
                        container_item_id,
                        target_grid_x,
                        target_grid_y,
                        action_cost,
                    } = data;

                    if (!actor_id || !place_id || !item_id || !container_item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }
                    if (typeof from_x !== 'number' || typeof from_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_from_tile" }));
                        return;
                    }
                    if (String(item_id) === String(container_item_id)) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "self_deposit" }));
                        return;
                    }

                    const grid_target: GridTarget = (typeof target_grid_x === 'number' && typeof target_grid_y === 'number')
                        ? { x: target_grid_x as number, y: target_grid_y as number }
                        : null;

                    debug_log('API', `[INLINE] deposit_ground_to_container_item actor=${actor_id} place=${place_id} from=(${from_x},${from_y},${typeof from_elevation === 'number' ? Math.floor(from_elevation) : '?'}) item=${item_id} to_container_item=${container_item_id} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'} cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_any = actor_result.actor as any;
                    const actual_place_id = actor_any.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    if (actual_place_id !== place_id) {
                        debug_log('API', `[INLINE] deposit_ground_to_container_item place mismatch client=${place_id} actor=${actual_place_id}`);
                    }

                    const place_result = load_place_with_ground(data_slot_number, actual_place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    // Find destination container-item + its position.
                    const all_ground = get_all_ground_items(place_result.place);
                    const dest_found = all_ground.find(({ item }: { item: InlineItem }) => item.id === String(container_item_id));
                    if (!dest_found || !dest_found.position) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_item_not_found" }));
                        return;
                    }

                    // Range check: actor adjacent (Manhattan <= 1) to BOTH source tile and dest container tile.
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && typeof actor_pos.x === 'number' && typeof actor_pos.y === 'number') {
                        const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
                        if (manhattan(actor_pos.x, actor_pos.y, from_x, from_y) > 1) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                        if (manhattan(actor_pos.x, actor_pos.y, dest_found.position.x, dest_found.position.y) > 1) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const dest_container_item = dest_found.item as any;
                    if (!has_tag(dest_container_item, 'CONTAINER')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                        return;
                    }
                    if (!Array.isArray(dest_container_item.contents)) dest_container_item.contents = [];

                    // Source item must exist on that source tile.
                    const place_any = place_result.place as any;
                    const base_z = get_place_base_z(place_any);
                    const from_wz = (typeof from_elevation === 'number' && Number.isFinite(from_elevation)) ? Math.floor(from_elevation) : base_z;
                    const from_key = `${from_x}_${from_y}_${from_wz}`;
                    const from_items: any[] = Array.isArray(place_any.ground?.scattered?.[from_key]) ? place_any.ground.scattered[from_key] : [];
                    const src_idx = from_items.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (src_idx < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    const moving_item = from_items[src_idx];
                    if (!moving_item) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    // Stabilize destination layout and validate deposit legality BEFORE mutating.
                    const max_slots = get_container_capacity_max_slots(dest_container_item);
                    const grid_ok = validate_grid_target(max_slots, grid_target);
                    if (!grid_ok.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: grid_ok.error, detail: grid_ok.detail }));
                        return;
                    }

                    const normalized = normalize_inline_container_grid(dest_container_item.contents, max_slots, `ground_container_item:${actual_place_id}:${container_item_id}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        const id = String(e.item?.id ?? '');
                        if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of dest_container_item.contents) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) {
                            it.grid_x = c.x;
                            it.grid_y = c.y;
                        }
                    }

                    const legality = validate_deposit_into_container_item(dest_container_item, moving_item, grid_target);
                    if (!legality.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                        return;
                    }

                    const used = new Set<string>();
                    for (const it of dest_container_item.contents) {
                        if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') {
                            used.add(`${it.grid_x}_${it.grid_y}`);
                        }
                    }

                    let chosen_x: number | null = null;
                    let chosen_y: number | null = null;
                    if (grid_target) {
                        const key = `${grid_target.x}_${grid_target.y}`;
                        if (used.has(key)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "target_slot_occupied" }));
                            return;
                        }
                        chosen_x = grid_target.x;
                        chosen_y = grid_target.y;
                    } else {
                        const { cols } = calculate_grid_dimensions(max_slots);
                        for (let idx = 0; idx < max_slots; idx++) {
                            const px = idx % cols;
                            const py = Math.floor(idx / cols);
                            const key = `${px}_${py}`;
                            if (used.has(key)) continue;
                            chosen_x = px;
                            chosen_y = py;
                            break;
                        }
                    }

                    if (chosen_x === null || chosen_y === null) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "container_full" }));
                        return;
                    }

                    // Mutate: remove from ground tile and push into container-item.
                    const removed_list = from_items.splice(src_idx, 1);
                    const removed = removed_list[0] as any;
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }
                    if (from_items.length === 0) {
                        delete place_any.ground.scattered[from_key];
                    }

                    removed.grid_x = chosen_x;
                    removed.grid_y = chosen_y;
                    dest_container_item.contents.push(removed);

                    const save_place_result = save_place_with_ground(data_slot_number, actual_place_id, place_result.place);
                    if (!save_place_result.ok) {
                        // Best-effort rollback.
                        const back_idx = dest_container_item.contents.findIndex((it: any) => String(it?.id ?? '') === String(removed.id));
                        if (back_idx >= 0) dest_container_item.contents.splice(back_idx, 1);
                        if (!Array.isArray(place_any.ground.scattered[from_key])) place_any.ground.scattered[from_key] = [];
                        place_any.ground.scattered[from_key].push(removed);

                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error('API', '/api/place/items/deposit_ground_to_container_item error', err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/reorder_pile - Reorder items within a ground pile (persisted by scattered array order)
        if (url.pathname === "/api/place/items/reorder_pile") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, position_key, item_id, target_slot_index, action_cost } = data;

                    if (!actor_id || !place_id || !position_key || !item_id || typeof target_slot_index !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    debug_log('API', `[INLINE] reorder_pile actor=${actor_id} place=${place_id} key=${position_key} item=${item_id} target_slot=${target_slot_index} cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_any = actor_result.actor as any;
                    const actual_place_id = actor_any.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    if (actual_place_id !== place_id) {
                        debug_log('API', `[INLINE] reorder_pile place mismatch client=${place_id} actor=${actual_place_id}`);
                    }

                    const place_result = load_place_with_ground(data_slot_number, actual_place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const place_any0 = place_result.place as any;
                    const norm0 = normalize_voxel_position_key(place_any0, String(position_key));
                    const pile_x = norm0 ? norm0.x : parseInt(String(position_key).split('_')[0] || '0', 10);
                    const pile_y = norm0 ? norm0.y : parseInt(String(position_key).split('_')[1] || '0', 10);

                    // Range check (touch) - 3D.
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && typeof actor_pos.x === 'number' && typeof actor_pos.y === 'number') {
                        const base_z = get_place_base_z(place_any0);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const pile_z = norm0 ? norm0.z : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, pile_x, pile_y, pile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const place_any = place_result.place as any;
                    const norm = normalize_voxel_position_key(place_any, String(position_key));
                    if (!norm) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_position_key" }));
                        return;
                    }

                    const list: any[] = Array.isArray(place_any.ground?.scattered?.[norm.key]) ? place_any.ground.scattered[norm.key] : [];
                    if (list.length < 2) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_pile" }));
                        return;
                    }

                    const from_index = list.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                    if (from_index < 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    // Pile UI uses spacing; slot_index maps to intended item index by floor(slot/2).
                    const to_index = Math.max(0, Math.min(list.length - 1, Math.floor(Number(target_slot_index) / 2)));

                    const removed_list = list.splice(from_index, 1);
                    const removed = removed_list[0];
                    if (!removed) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "remove_failed" }));
                        return;
                    }

                    list.splice(to_index, 0, removed);
                    place_any.ground.scattered[norm.key] = list;

                    const save_place_result = save_place_with_ground(data_slot_number, actual_place_id, place_result.place);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error('API', '/api/place/items/reorder_pile error', err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/move_within_pile - Move an item inside a ground pile (grid reposition)
        if (url.pathname === "/api/place/items/move_within_pile") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const { actor_id, place_id, position_key, item_id, target_grid_x, target_grid_y, action_cost } = data;

                    if (!actor_id || !place_id || !position_key || !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    if (typeof target_grid_x !== 'number' || typeof target_grid_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_target_grid" }));
                        return;
                    }

                    debug_log('API', `[INLINE] move_within_pile actor=${actor_id} place=${place_id} key=${position_key} item=${item_id} target=(${target_grid_x},${target_grid_y}) cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_any = actor_result.actor as any;
                    const actual_place_id = actor_any.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    if (actual_place_id !== place_id) {
                        debug_log('API', `[INLINE] move_within_pile place mismatch client=${place_id} actor=${actual_place_id}`);
                    }

                    const place_result = load_place_with_ground(data_slot_number, actual_place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    const place_any0 = place_result.place as any;
                    const norm0 = normalize_voxel_position_key(place_any0, String(position_key));
                    const pile_x = norm0 ? norm0.x : parseInt(String(position_key).split('_')[0] || '0', 10);
                    const pile_y = norm0 ? norm0.y : parseInt(String(position_key).split('_')[1] || '0', 10);

                    // Range check (touch) - 3D.
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && typeof actor_pos.x === 'number' && typeof actor_pos.y === 'number') {
                        const base_z = get_place_base_z(place_any0);
                        const actor_z = get_actor_world_z(actor_any, base_z);
                        const pile_z = norm0 ? norm0.z : base_z;
                        if (!within_range_xy_z(actor_pos, actor_z, pile_x, pile_y, pile_z, 1.5, 1)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    const place_any = place_result.place as any;
                    const norm = normalize_voxel_position_key(place_any, String(position_key));
                    if (!norm) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_position_key" }));
                        return;
                    }
                    const list: any[] = Array.isArray(place_any.ground?.scattered?.[norm.key]) ? place_any.ground.scattered[norm.key] : [];
                    if (list.length < 2) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "not_a_pile" }));
                        return;
                    }

                    // Ensure stable sparse layout for ground piles.
                    const max_slots = Math.max(10, list.length);
                    const normalized = normalize_inline_container_grid(list, max_slots, `ground_pile:${actual_place_id}:${norm.key}`);
                    const coords_by_id = new Map<string, { x: number; y: number }>();
                    for (const e of normalized) {
                        const id = String(e.item?.id ?? '');
                        if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                    }
                    for (const it of list) {
                        const c = coords_by_id.get(String(it?.id ?? ''));
                        if (c) {
                            it.grid_x = c.x;
                            it.grid_y = c.y;
                        }
                    }

                    const grid_target: GridTarget = { x: Math.floor(target_grid_x), y: Math.floor(target_grid_y) };
                    const grid_ok = validate_grid_target(max_slots, grid_target);
                    if (!grid_ok.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: grid_ok.error, detail: grid_ok.detail }));
                        return;
                    }

                    const moving = list.find((it: any) => String(it?.id ?? '') === String(item_id));
                    if (!moving) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    const occupied = list.find((it: any) =>
                        String(it?.id ?? '') !== String(item_id) && it?.grid_x === grid_target.x && it?.grid_y === grid_target.y
                    );
                    if (occupied) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "target_slot_occupied" }));
                        return;
                    }

                    moving.grid_x = grid_target.x;
                    moving.grid_y = grid_target.y;

                    const save_place_result = save_place_with_ground(data_slot_number, actual_place_id, place_result.place);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error('API', '/api/place/items/move_within_pile error', err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/place/items/drag - Drag ground item(s) to another ground tile (sweep)
        if (url.pathname === "/api/place/items/drag") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const {
                        actor_id,
                        place_id,
                        from_x,
                        from_y,
                        from_elevation,
                        to_x,
                        to_y,
                        to_elevation,
                        item_id,
                        mode,
                        action_cost,
                    } = data;

                    if (!actor_id || !place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    if (typeof from_x !== 'number' || typeof from_y !== 'number' || typeof to_x !== 'number' || typeof to_y !== 'number') {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_tile" }));
                        return;
                    }

                    const is_pile = String(mode ?? '') === 'pile';
                    if (!is_pile && !item_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_item_id" }));
                        return;
                    }

                    debug_log('API', `[INLINE] place_items_drag actor=${actor_id} place=${place_id} from=(${from_x},${from_y}) to=(${to_x},${to_y}) mode=${is_pile ? 'pile' : 'single'} item=${item_id ?? '-'} cost=${typeof action_cost === 'string' ? action_cost : '-'}`);

                    // Authoritative actor source.
                    const actor_result = load_actor(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor_any = actor_result.actor as any;
                    const actual_place_id = actor_any.location?.place_id;
                    if (!actual_place_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "actor_not_in_any_place" }));
                        return;
                    }
                    if (actual_place_id !== place_id) {
                        debug_log('API', `[INLINE] place_items_drag place mismatch client=${place_id} actor=${actual_place_id}`);
                    }

                    const place_result = load_place_with_ground(data_slot_number, actual_place_id);
                    if (!place_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: place_result.error }));
                        return;
                    }

                    // Bounds check
                    const tg: any = (place_result.place as any).tile_grid;
                    if (tg && typeof tg.width === 'number' && typeof tg.height === 'number') {
                        const in_bounds = (x: number, y: number) => x >= 0 && y >= 0 && x < tg.width && y < tg.height;
                        if (!in_bounds(from_x, from_y) || !in_bounds(to_x, to_y)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "out_of_bounds" }));
                            return;
                        }
                    }

                    // Cardinal touch-range: actor must be adjacent (Manhattan <= 1) to BOTH from and to.
                    const actor_pos = actor_any.location?.tile;
                    if (actor_pos && typeof actor_pos.x === 'number' && typeof actor_pos.y === 'number') {
                        const manhattan = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
                        if (manhattan(actor_pos.x, actor_pos.y, from_x, from_y) > 1) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                        if (manhattan(actor_pos.x, actor_pos.y, to_x, to_y) > 1) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "too_far" }));
                            return;
                        }
                    }

                    // No-op move
                    if (from_x === to_x && from_y === to_y) {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }

                    const place_any = place_result.place as any;
                    if (!place_any.ground) place_any.ground = { main: [], scattered: {} };
                    if (!place_any.ground.scattered) place_any.ground.scattered = {};

                    const base_z = get_place_base_z(place_any);
                    const from_wz = (typeof from_elevation === 'number' && Number.isFinite(from_elevation)) ? Math.floor(from_elevation) : base_z;

                    const from_key = `${from_x}_${from_y}_${from_wz}`;
                    
                    const from_items: any[] = Array.isArray(place_any.ground.scattered[from_key]) ? place_any.ground.scattered[from_key] : [];
                    if (from_items.length === 0) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                        return;
                    }

                    let moved: any[] = [];
                    if (is_pile) {
                        if (from_items.length < 2) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "not_a_pile" }));
                            return;
                        }
                        moved = from_items.splice(0, from_items.length);
                    } else {
                        const idx = from_items.findIndex((it: any) => String(it?.id ?? '') === String(item_id));
                        if (idx < 0) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: "item_not_found_on_ground" }));
                            return;
                        }
                        const removed_list = from_items.splice(idx, 1);
                        const removed = removed_list[0];
                        if (removed) moved = [removed];
                    }

                    if (from_items.length === 0) {
                        delete place_any.ground.scattered[from_key];
                    }

                    // Place into world with shared legality (container -> occupied -> ground).
                    // If to_elevation is not provided, preserve each item's elevation.
                    const fixed_wz = (typeof to_elevation === 'number' && Number.isFinite(to_elevation)) ? Math.floor(to_elevation) : null;

                    const placed_items: any[] = [];
                    for (const it of moved) {
                        const prev_z = (typeof (it as any)?.elevation === 'number' && Number.isFinite((it as any).elevation)) ? Math.floor((it as any).elevation) : base_z;
                        const target_wz = fixed_wz !== null ? fixed_wz : prev_z;
                        delete (it as any).grid_x;
                        delete (it as any).grid_y;
                        const placed = place_item_into_place_legal(place_any, actual_place_id, Math.floor(to_x), Math.floor(to_y), target_wz, it);
                        if (!placed.ok) {
                            // Roll back: put all moved items back to origin.
                            if (!Array.isArray(place_any.ground.scattered[from_key])) place_any.ground.scattered[from_key] = [];
                            for (const r of moved) {
                                (place_any.ground.scattered[from_key] as any[]).push(r);
                            }
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: placed.error }));
                            return;
                        }
                        placed_items.push({ id: String(it?.id ?? ''), placed: placed.placed });
                    }

                    const save_place_result = save_place_with_ground(data_slot_number, actual_place_id, place_result.place);
                    if (!save_place_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_place_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, placed: placed_items }));
                } catch (err) {
                    debug_error('API', '/api/place/items/drag error', err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // POST /api/transfer - Unified inline transfer (hard cutover)
        if (url.pathname === "/api/transfer") {
            if (req.method !== "POST") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const {
                        actor_id,
                        item_instance_id,
                        from_container,
                        to_container,
                        from_slot_index,
                        to_slot_index,
                        target_grid_x,
                        target_grid_y,
                    } = data;

                    debug_log("transfer", `[INLINE] /api/transfer request`, data);

                    if (!actor_id || !item_instance_id || !from_container || !to_container) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                        return;
                    }

                    const actor_result = load_actor_with_items(data_slot_number, actor_id);
                    if (!actor_result.ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                        return;
                    }

                    const actor = actor_result.actor as any;
                    if (!actor.body_slots) actor.body_slots = {};

                    const has_grid_target = typeof target_grid_x === 'number' && typeof target_grid_y === 'number';
                    const grid_target: GridTarget = has_grid_target ? { x: target_grid_x as number, y: target_grid_y as number } : null;

                    function get_slot(slot_name: string): any {
                        return (actor.body_slots as any)[slot_name];
                    }

                    function parse_body_slots_path(p: string): { slot_name: string; slot_type: 'armor'|'tool'|'garb'; garb_index: number | null } | null {
                        const parts = p.split('.');
                        if (parts[0] !== 'body_slots') return null;
                        if (!parts[1] || !parts[2]) return null;
                        const slot_name = parts[1];
                        const slot_type = parts[2] as any;
                        const garb_index = (slot_type === 'garb' && parts[3] !== undefined) ? parseInt(parts[3], 10) : null;
                        return { slot_name, slot_type, garb_index: isNaN(garb_index as any) ? null : garb_index };
                    }

                    function parse_actor_item_container_id(p: string): { actor_id: string; item_id: string } | null {
                        const parts = p.split('.');
                        // actor.item.<actor_id>.<item_id>
                        if (parts[0] !== 'actor' || parts[1] !== 'item') return null;
                        if (!parts[2] || !parts[3]) return null;
                        return { actor_id: parts[2], item_id: parts[3] };
                    }

                    // Prevent depositing a container into itself.
                    const self_dest = parse_actor_item_container_id(String(to_container));
                    if (self_dest && self_dest.actor_id === actor_id && self_dest.item_id === item_instance_id) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: 'self_deposit' }));
                        return;
                    }

                    // /api/transfer is actor-authoritative only.
                    // Place-sourced moves must go through /api/place/items/* endpoints.
                    if (String(from_container).startsWith('place.')) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: 'invalid_from_container_kind' }));
                        return;
                    }

                    // Peek the moving item without mutating.
                    function peek_item_in_source(container_path: string, child_id: string): any | null {
                        const container_item = get_container_item(container_path);
                        if (container_item?.id === child_id) return container_item;
                        if (container_item && Array.isArray(container_item.contents)) {
                            const found = container_item.contents.find((it: any) => it?.id === child_id);
                            if (found) return found;
                        }
                        const parsed = parse_body_slots_path(container_path);
                        if (parsed) {
                            const slot = get_slot(parsed.slot_name);
                            if (!slot) return null;
                            if (parsed.slot_type === 'armor' && slot.armor?.id === child_id) return slot.armor;
                            if (parsed.slot_type === 'tool' && slot.tool?.id === child_id) return slot.tool;
                            if (parsed.slot_type === 'garb' && parsed.garb_index !== null) {
                                const it = slot.garb?.[parsed.garb_index];
                                return it?.id === child_id ? it : null;
                            }
                        }
                        return null;
                    }

                    if (from_container !== to_container) {
                        // [LEGALITY] validate destination using snapshot instance tags (authoritative)
                        debug_log('transfer', `[LEGALITY] req actor=${actor_id} item=${item_instance_id} from=${from_container} to=${to_container} grid=${grid_target ? `${grid_target.x},${grid_target.y}` : '-'}`);

                        const peeked = peek_item_in_source(from_container, item_instance_id);
                        if (!peeked) {
                            debug_log('transfer', `[LEGALITY] reject error=item_not_found_in_source`);
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: 'item_not_found_in_source' }));
                            return;
                        }

                        // Validate destination legality before any mutation.
                        const legality = validate_transfer_destination(actor, actor_id, peeked, to_container, grid_target);
                        if (!legality.ok) {
                            debug_log('transfer', `[LEGALITY] reject error=${legality.error}`);
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: legality.error, detail: legality.detail }));
                            return;
                        }
                        debug_log('transfer', `[LEGALITY] allow`);
                    }

                    function get_item_at_path(path: string): any {
                        const parsed = parse_body_slots_path(path);
                        if (!parsed) return null;
                        const slot = get_slot(parsed.slot_name);
                        if (!slot) return null;
                        if (parsed.slot_type === 'armor') return slot.armor;
                        if (parsed.slot_type === 'tool') return slot.tool;
                        if (parsed.slot_type === 'garb') {
                            if (parsed.garb_index === null) return null;
                            return slot.garb?.[parsed.garb_index] ?? null;
                        }
                        return null;
                    }

                    function get_container_item(path: string): any {
                        const actor_item = parse_actor_item_container_id(path);
                        if (actor_item) {
                            // Prevent cross-actor writes
                            if (actor_item.actor_id !== actor_id) return null;
                            const found = find_actor_item_by_id(actor, actor_item.item_id);
                            return found?.item ?? null;
                        }
                        return get_item_at_path(path);
                    }

                    function remove_from_container(container_path: string, child_id: string): any {
                        const container_item = get_container_item(container_path);
                        if (!container_item || !Array.isArray(container_item.contents)) return null;
                        const idx = container_item.contents.findIndex((it: any) => it?.id === child_id);
                        if (idx < 0) return null;
                        const [removed] = container_item.contents.splice(idx, 1);
                        return removed;
                    }

                    function add_to_container(container_path: string, item: any, index: number | null): boolean {
                        const container_item = get_container_item(container_path);
                        if (!container_item) return false;
                        if (!Array.isArray(container_item.contents)) container_item.contents = [];
                        if (index === null || index >= container_item.contents.length) {
                            container_item.contents.push(item);
                        } else {
                            container_item.contents.splice(index, 0, item);
                        }
                        return true;
                    }

                    function get_container_capacity_max_slots(container_item: any): number {
                        const cap = container_item?.container_capacity?.max_slots;
                        if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
                        const fallback = Array.isArray(container_item?.contents) ? container_item.contents.length : 0;
                        return Math.max(1, fallback);
                    }

                    function ensure_sparse_layout(container_item: any, reserved?: { x: number; y: number }): { ok: true; cols: number; rows: number } | { ok: false; error: string } {
                        if (!container_item || !Array.isArray(container_item.contents)) return { ok: false, error: 'container_not_found' };
                        const max_slots = get_container_capacity_max_slots(container_item);
                        const { cols, rows } = calculate_grid_dimensions(max_slots);
                        const used = new Set<string>();

                        let repaired_invalid = 0;
                        let repaired_dupe = 0;

                        for (const it of container_item.contents) {
                            const x = (it as any)?.grid_x;
                            const y = (it as any)?.grid_y;
                            if (typeof x === 'number' && typeof y === 'number') {
                                const slot_index = (y * cols) + x;
                                const in_bounds = x >= 0 && y >= 0 && x < cols && y < rows && slot_index >= 0 && slot_index < max_slots;
                                const key = `${x}_${y}`;
                                if (!in_bounds) {
                                    delete (it as any).grid_x;
                                    delete (it as any).grid_y;
                                    repaired_invalid++;
                                    continue;
                                }
                                if (used.has(key)) {
                                    delete (it as any).grid_x;
                                    delete (it as any).grid_y;
                                    repaired_dupe++;
                                    continue;
                                }
                                used.add(key);
                            }
                        }

                        if (reserved) {
                            used.add(`${reserved.x}_${reserved.y}`);
                        }

                        for (const it of container_item.contents) {
                            const x = (it as any)?.grid_x;
                            const y = (it as any)?.grid_y;
                            if (typeof x === 'number' && typeof y === 'number') continue;

                            let placed = false;
                            for (let idx = 0; idx < max_slots; idx++) {
                                const px = idx % cols;
                                const py = Math.floor(idx / cols);
                                const key = `${px}_${py}`;
                                if (used.has(key)) continue;
                                (it as any).grid_x = px;
                                (it as any).grid_y = py;
                                used.add(key);
                                placed = true;
                                break;
                            }

                            if (!placed) {
                                return { ok: false, error: 'container_full' };
                            }
                        }

                        if (repaired_invalid > 0 || repaired_dupe > 0) {
                            debug_log('transfer', `[INLINE] grid_repair invalid=${repaired_invalid} dupe=${repaired_dupe}`);
                        }

                        return { ok: true, cols, rows };
                    }

                    function remove_from_body_slot(path: string, child_id: string): any {
                        const parsed = parse_body_slots_path(path);
                        if (!parsed) return null;
                        const slot = get_slot(parsed.slot_name);
                        if (!slot) return null;
                        if (parsed.slot_type === 'armor' && slot.armor?.id === child_id) {
                            const it = slot.armor; slot.armor = null; return it;
                        }
                        if (parsed.slot_type === 'tool' && slot.tool?.id === child_id) {
                            const it = slot.tool; slot.tool = null; return it;
                        }
                        if (parsed.slot_type === 'garb' && parsed.garb_index !== null) {
                            const it = slot.garb?.[parsed.garb_index];
                            if (it?.id !== child_id) return null;
                            slot.garb.splice(parsed.garb_index, 1);
                            return it;
                        }
                        return null;
                    }

                    function add_to_body_slot(path: string, item: any): { ok: true } | { ok: false; error: string } {
                        const parsed = parse_body_slots_path(path);
                        if (!parsed) return { ok: false, error: 'invalid_to_path' };
                        const slot = get_slot(parsed.slot_name);
                        if (!slot) return { ok: false, error: 'slot_not_found' };
                        if (parsed.slot_type === 'armor') {
                            if (slot.armor) return { ok: false, error: 'armor_slot_occupied' };
                            slot.armor = item; return { ok: true };
                        }
                        if (parsed.slot_type === 'tool') {
                            if (slot.tool) return { ok: false, error: 'tool_slot_occupied' };
                            slot.tool = item; return { ok: true };
                        }
                        if (parsed.slot_type === 'garb') {
                            if (!Array.isArray(slot.garb)) slot.garb = [];
                            const idx = parsed.garb_index;
                            if (idx === null || idx === slot.garb.length) {
                                slot.garb.push(item);
                                return { ok: true };
                            }
                            if (idx < 0 || idx > slot.garb.length) return { ok: false, error: 'invalid_garb_index' };
                            if (slot.garb[idx]) return { ok: false, error: 'garb_slot_occupied' };
                            slot.garb.splice(idx, 0, item);
                            return { ok: true };
                        }
                        return { ok: false, error: 'invalid_to_path' };
                    }

                    // Same-container move
                    if (from_container === to_container) {
                        const container_item = get_container_item(from_container);
                        if (!container_item || !Array.isArray(container_item.contents)) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: 'source_container_not_found' }));
                            return;
                        }

                        const moving = container_item.contents.find((it: any) => it?.id === item_instance_id);
                        if (!moving) {
                            res.writeHead(404, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: 'item_not_found_in_container' }));
                            return;
                        }

                        // Grid placement (sparse) has priority over packed reorder.
                        if (has_grid_target) {
                            const tx = target_grid_x as number;
                            const ty = target_grid_y as number;

                            // Validate target is within capacity.
                            const max_slots = get_container_capacity_max_slots(container_item);
                            const { cols, rows } = calculate_grid_dimensions(max_slots);
                            const slot_index = (ty * cols) + tx;
                            const in_bounds = tx >= 0 && ty >= 0 && tx < cols && ty < rows && slot_index >= 0 && slot_index < max_slots;
                            if (!in_bounds) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: 'target_out_of_bounds' }));
                                return;
                            }

                            // Ensure existing items are sparsified so the layout becomes stable.
                            // Reserve the target cell so sparsification doesn't claim it.
                            const sparse_res = ensure_sparse_layout(container_item, { x: tx, y: ty });
                            if (!sparse_res.ok) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: sparse_res.error }));
                                return;
                            }

                            // Allow moving onto its current position.
                            const occupied = container_item.contents.find((it: any) =>
                                it?.id !== item_instance_id && it?.grid_x === tx && it?.grid_y === ty
                            );
                            if (occupied) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: 'target_slot_occupied' }));
                                return;
                            }

                            (moving as any).grid_x = tx;
                            (moving as any).grid_y = ty;

                            const save_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                            if (!save_result.ok) {
                                res.writeHead(500, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: save_result.error }));
                                return;
                            }
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: true }));
                            return;
                        }

                        // Packed reorder (legacy behavior)
                        if (typeof from_slot_index === 'number' && typeof to_slot_index === 'number') {
                            debug_log("transfer", `[INLINE] Same-container reorder from ${from_slot_index} to ${to_slot_index}`);
                            const to_idx = to_slot_index;
                            const actual_from = container_item.contents.findIndex((it: any) => it?.id === item_instance_id);
                            container_item.contents.splice(actual_from, 1);
                            const clamped_to = Math.max(0, Math.min(to_idx, container_item.contents.length));
                            container_item.contents.splice(clamped_to, 0, moving);

                            const save_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                            if (!save_result.ok) {
                                res.writeHead(500, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: save_result.error }));
                                return;
                            }
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: true }));
                            return;
                        }
                    }

                    // Remove item from source
                    let removed: any = null;
                    if (from_container.startsWith('body_slots.') || from_container.startsWith('actor.item.')) {
                        // try container contents first
                        removed = remove_from_container(from_container, item_instance_id);
                        if (!removed && from_container.startsWith('body_slots.')) {
                            removed = remove_from_body_slot(from_container, item_instance_id);
                        }
                    }

                    if (!removed) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "item_not_found_in_source" }));
                        return;
                    }

                    // Add item to destination
                    let add_ok = false;
                    if (to_container.startsWith('body_slots.') || to_container.startsWith('actor.item.')) {
                        const dest_item = get_container_item(to_container);
                        const dest_payload = resolve_inline_item_payload_for_api(dest_item);
                        const is_dest_container = dest_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                        if (is_dest_container) {
                            if (!Array.isArray(dest_item.contents)) dest_item.contents = [];
                            const max_slots = get_container_capacity_max_slots(dest_item);
                            if (dest_item.contents.length >= max_slots) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: 'container_full' }));
                                return;
                            }

                            if (has_grid_target) {
                                const tx = target_grid_x as number;
                                const ty = target_grid_y as number;

                                // Validate target is within capacity.
                                const max_slots = get_container_capacity_max_slots(dest_item);
                                const { cols, rows } = calculate_grid_dimensions(max_slots);
                                const slot_index = (ty * cols) + tx;
                                const in_bounds = tx >= 0 && ty >= 0 && tx < cols && ty < rows && slot_index >= 0 && slot_index < max_slots;
                                if (!in_bounds) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: 'target_out_of_bounds' }));
                                    return;
                                }
                                // Stabilize container layout before placing into a specific cell.
                                const sparse_res = ensure_sparse_layout(dest_item, { x: tx, y: ty });
                                if (!sparse_res.ok) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: sparse_res.error }));
                                    return;
                                }
                                const occupied = dest_item.contents?.find((it: any) => it?.grid_x === tx && it?.grid_y === ty);
                                if (occupied) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: 'target_slot_occupied' }));
                                    return;
                                }
                                (removed as any).grid_x = tx;
                                (removed as any).grid_y = ty;
                            } else {
                                // Stabilize existing layout and choose first free cell for the inserted item.
                                const sparse_res = ensure_sparse_layout(dest_item);
                                if (!sparse_res.ok) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: sparse_res.error }));
                                    return;
                                }

                                const max = get_container_capacity_max_slots(dest_item);
                                const { cols } = calculate_grid_dimensions(max);
                                const used = new Set<string>();
                                for (const it of dest_item.contents) {
                                    if (typeof it.grid_x === 'number' && typeof it.grid_y === 'number') {
                                        used.add(`${it.grid_x}_${it.grid_y}`);
                                    }
                                }

                                // Find first free position
                                let placed = false;
                                for (let idx = 0; idx < max; idx++) {
                                    const px = idx % cols;
                                    const py = Math.floor(idx / cols);
                                    const key = `${px}_${py}`;
                                    if (used.has(key)) continue;
                                    (removed as any).grid_x = px;
                                    (removed as any).grid_y = py;
                                    placed = true;
                                    break;
                                }

                                if (!placed) {
                                    res.writeHead(400, { "Content-Type": "application/json" });
                                    res.end(JSON.stringify({ ok: false, error: 'container_full' }));
                                    return;
                                }
                            }
                            add_ok = add_to_container(to_container, removed, null);
                        } else {
                            if (!to_container.startsWith('body_slots.')) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: 'invalid_destination' }));
                                return;
                            }
                            const add_result = add_to_body_slot(to_container, removed);
                            if (!add_result.ok) {
                                res.writeHead(400, { "Content-Type": "application/json" });
                                res.end(JSON.stringify({ ok: false, error: add_result.error }));
                                return;
                            }
                            add_ok = true;
                        }
                    }

                    if (!add_ok) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "invalid_destination" }));
                        return;
                    }

                    const save_result = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_result.ok) {
                        res.writeHead(500, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: save_result.error }));
                        return;
                    }

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch (err) {
                    debug_error("transfer", "/api/transfer inline error", err);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
                }
            });
            return;
        }

        // GET /api/place/items?place_id=xxx - Get items on ground
        if (url.pathname === "/api/place/items") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            if (!place_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_place_id" }));
                return;
            }

            try {
                const result = load_place_with_ground(data_slot_number, place_id);
                if (!result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: result.error }));
                    return;
                }

                const items: Array<{ item: InlineItem; position?: { x: number; y: number }; position_key?: string }> = get_all_ground_items(result.place);

                // Resolve item display + tags from database definitions.
                
                res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        ok: true, 
                        place_id,
                        items: items.map(({ item, position, position_key }: { item: InlineItem; position?: { x: number; y: number }; position_key?: string }) => {
                            const resolved = resolve_inline_item(String(item.def_id ?? ''), item);
                            const display_char = resolved?.display_char ?? '·';
                            const display_color = resolved?.display_color ?? '#9da5ae';
                            const name = resolved?.name ?? String(item.def_id ?? '');
                            const weight = resolved?.unit_weight ?? 0;
                            const tags = resolved?.effective_tags ?? [];
                             const base_z = Math.floor(Number((result.place as any)?.coordinates?.elevation ?? 0)) || 0;
                             const elevation = (typeof (item as any)?.elevation === 'number' && Number.isFinite((item as any).elevation))
                                 ? Math.floor((item as any).elevation)
                                 : base_z;
                            return ({
                             id: item.id,
                             def_id: item.def_id,
                             name,
                             qty: item.qty,
                             weight,
                             display_char,
                             display_color,
                             tags,
                             elevation,
                             position,
                             position_key
                         });
                         })
                     }));

                 // Devlog test: ensure elevated ground item can be surfaced by the items endpoint.
                 try {
                     if (place_id === 'eden_crossroads_tavern') {
                         const base_z = Math.floor(Number((result.place as any)?.coordinates?.elevation ?? 0)) || 0;
                         const want_z = base_z + 1;
                         const any_wall_top = items.some(({ item }: any) => Math.floor(Number((item as any)?.elevation ?? base_z)) === want_z);
                         if (any_wall_top) {
                             debug_log('3DIFICATION_TEST', `PASS /api/place/items includes elevated ground item (place=${place_id} z=${want_z})`);
                         } else {
                             debug_warn('3DIFICATION_TEST', `FAIL /api/place/items missing elevated ground item (place=${place_id} z=${want_z})`);
                         }

                         // Verify voxelized piles: same (x,y) can hold items at multiple z.
                         const by_xy = new Map<string, Set<number>>();
                         for (const rec of (items as any[])) {
                             const item = (rec as any)?.item;
                             const position = (rec as any)?.position;
                             if (!position) continue;
                             const x = Number(position.x);
                             const y = Number(position.y);
                             if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                             const iz = Math.floor(Number((item as any)?.elevation ?? base_z));
                             const k = `${x}_${y}`;
                             const s = by_xy.get(k) ?? new Set<number>();
                             s.add(iz);
                             by_xy.set(k, s);
                         }
                          const multi = Array.from(by_xy.values()).some((s) => s.size >= 2);
                          if (multi) {
                              debug_log('3DIFICATION_TEST', `PASS /api/place/items supports multi-z piles (place=${place_id})`);
                          } else {
                              debug_warn('3DIFICATION_TEST', `FAIL /api/place/items missing multi-z pile scenario (place=${place_id})`);
                          }

                          // Verify stacked piles: two distinct z at the same (x,y) each with 2+ items.
                          const by_xy_z_count = new Map<string, Map<number, number>>();
                          for (const rec of (items as any[])) {
                              const item = (rec as any)?.item;
                              const position = (rec as any)?.position;
                              if (!position) continue;
                              const x = Number(position.x);
                              const y = Number(position.y);
                              if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                              const iz = Math.floor(Number((item as any)?.elevation ?? base_z));
                              const xy = `${x}_${y}`;
                              const mz = by_xy_z_count.get(xy) ?? new Map<number, number>();
                              mz.set(iz, (mz.get(iz) ?? 0) + 1);
                              by_xy_z_count.set(xy, mz);
                          }
                          const stacked_piles = Array.from(by_xy_z_count.values()).some((mz) => {
                              let pile_layers = 0;
                              for (const c of mz.values()) {
                                  if (c >= 2) pile_layers++;
                                  if (pile_layers >= 2) return true;
                              }
                              return false;
                          });
                          if (stacked_piles) {
                              debug_log('3DIFICATION_TEST', `PASS /api/place/items supports stacked piles (place=${place_id})`);
                          } else {
                              debug_warn('3DIFICATION_TEST', `FAIL /api/place/items missing stacked piles (place=${place_id})`);
                          }
                      }
                  } catch {
                      // ignore
                  }
            } catch (err) {
                debug_error("API", "/api/place/items error", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/place/pile_container?place_id=xxx&position_key=x_y_z - Open a ground pile (voxel) as a virtual container
        if (url.pathname === "/api/place/pile_container") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            const position_key = url.searchParams.get("position_key");
            if (!place_id || !position_key) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                const place_result = load_place_with_ground(data_slot_number, place_id);
                if (!place_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: place_result.error }));
                    return;
                }

                const place_any = place_result.place as any;

                const norm = normalize_voxel_position_key(place_any, String(position_key));
                if (!norm) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_position_key" }));
                    return;
                }

                const pile_x = norm.x;
                const pile_y = norm.y;

                const list: any[] = Array.isArray(place_any.ground?.scattered?.[norm.key]) ? place_any.ground.scattered[norm.key] : [];
                if (list.length < 2) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_pile" }));
                    return;
                }

                // Canonical container-like layout for piles.
                const max_slots = Math.max(10, list.length);
                const normalized = normalize_inline_container_grid(list, max_slots, `ground_pile:${place_id}:${norm.key}`);
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of normalized) {
                    const id = String(e.item?.id ?? '');
                    if (id) coords_by_id.set(id, { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                for (const it of list) {
                    const c = coords_by_id.get(String(it?.id ?? ''));
                    if (!c) continue;
                    if (it.grid_x !== c.x || it.grid_y !== c.y) {
                        it.grid_x = c.x;
                        it.grid_y = c.y;
                        repaired++;
                    }
                }
                if (repaired > 0) {
                    const save_res = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_res.ok) {
                        debug_error('API', `[GRID_SANITY] failed to save pile repair ${place_id}:${norm.key}`, save_res.error);
                    }
                    debug_log('API', `[GRID_SANITY] ground_pile:${place_id}:${norm.key} repaired=${repaired}`);
                }

                const container_id = `place.pile.${place_id}.${norm.key}`;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_id,
                        name: `Pile (${norm.key})`,
                        def_id: `place_pile.${place_id}.${norm.key}`,
                        capacity: { max_slots },
                        contents: normalized.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: { id: p.id, def_id: p.def_id, qty: p.qty, tags: p.tags },
                                definition: { id: p.def_id, name: p.name, weight: p.unit_weight, tags: p.tags, display_char: p.display_char, display_color: p.display_color },
                                grid_x,
                                grid_y,
                            };
                        }),
                        position_key: norm.key,
                        position: { x: pile_x, y: pile_y },
                    }
                }));
            } catch (err) {
                debug_error('API', '/api/place/pile_container error', err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/place/container_item?place_id=xxx&item_id=yyy - Open a container-item on the ground
        if (url.pathname === "/api/place/container_item") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            const item_id = url.searchParams.get("item_id");
            if (!place_id || !item_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                const place_result = load_place_with_ground(data_slot_number, place_id);
                if (!place_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: place_result.error }));
                    return;
                }

                const all_items = get_all_ground_items(place_result.place);
                const found = all_items.find(({ item }: { item: InlineItem }) => item.id === item_id);
                if (!found) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_not_found" }));
                    return;
                }

                const container_item = found.item as any;
                const container_payload = resolve_inline_item_payload_for_api(container_item);
                const is_container = container_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                if (!is_container) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                    return;
                }

                const contents_raw = Array.isArray(container_item.contents) ? container_item.contents : [];
                const cap_res = resolve_inline_container_capacity(container_item, contents_raw.length, `place_container_item:${place_id}:${item_id}`);
                const max_slots = cap_res.max_slots;
                const contents = normalize_inline_container_grid(contents_raw, max_slots, `place_container_item:${place_id}:${item_id}`);

                // Repair coords + capacity in-place.
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of contents) {
                    coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                for (const it of contents_raw) {
                    const id = String(it?.id ?? '');
                    const c = coords_by_id.get(id);
                    if (!c) continue;
                    if (it.grid_x !== c.x || it.grid_y !== c.y) {
                        it.grid_x = c.x;
                        it.grid_y = c.y;
                        repaired++;
                    }
                }
                if (cap_res.patched || repaired > 0) {
                    const save_place_res = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_res.ok) {
                        debug_error('API', `[CAPACITY_SANITY] failed to save place after patch ${place_id}`, save_place_res.error);
                    }
                    if (repaired > 0) {
                        debug_log('API', `[GRID_SANITY] place_container_item:${place_id}:${item_id} repaired=${repaired}`);
                    }
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_payload.id,
                        name: container_payload.name,
                        def_id: container_payload.def_id,
                        capacity: { max_slots },
                        contents: contents.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: { id: p.id, def_id: p.def_id, qty: p.qty, tags: p.tags },
                                definition: { id: p.def_id, name: p.name, weight: p.unit_weight, tags: p.tags, display_char: p.display_char, display_color: p.display_color },
                                grid_x,
                                grid_y,
                            };
                        }),
                    }
                }));
            } catch (err) {
                debug_error("API", "/api/place/container_item error", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/place/tile_container?place_id=xxx&x=0&y=0 - Open a tile container (inline system)
        if (url.pathname === "/api/place/tile_container") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            const x_raw = url.searchParams.get("x");
            const y_raw = url.searchParams.get("y");
            const x = x_raw !== null ? Number(x_raw) : NaN;
            const y = y_raw !== null ? Number(y_raw) : NaN;
            if (!place_id || !Number.isFinite(x) || !Number.isFinite(y)) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                const place_res = load_place(data_slot_number, place_id);
                if (!place_res.ok) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "place_not_found" }));
                    return;
                }

                const place = place_res.place as any;
                const tx = Math.floor(x);
                const ty = Math.floor(y);
                const tile = place?.tiles?.cells?.[ty]?.[tx];
                if (!tile) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "tile_not_found" }));
                    return;
                }

                const tags = (resolve_place_tile(String(tile.kind ?? ''), tile) ?? null)?.effective_tags ?? (Array.isArray(tile.tags) ? tile.tags : []);
                const is_container = tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray(tile.contents);
                if (!is_container) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                    return;
                }

                if (!Array.isArray(tile.contents)) tile.contents = [];
                if (!tile.container_capacity || typeof tile.container_capacity.max_slots !== 'number' || tile.container_capacity.max_slots < 1) {
                    tile.container_capacity = { max_slots: Math.max(12, tile.contents.length) };
                    // persist patch
                    save_place(data_slot_number, place as any);
                }

                const max_slots = Math.floor(tile.container_capacity.max_slots);
                const contents = normalize_inline_container_grid(tile.contents, max_slots, `place_tile_container:${place_id}:${tx},${ty}`);

                // Repair coords in-place and persist (like container-items).
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of contents) {
                    coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                for (const it of tile.contents) {
                    const id = String(it?.id ?? '');
                    const c = coords_by_id.get(id);
                    if (!c) continue;
                    if ((it as any).grid_x !== c.x || (it as any).grid_y !== c.y) {
                        (it as any).grid_x = c.x;
                        (it as any).grid_y = c.y;
                        repaired++;
                    }
                }
                if (repaired > 0) {
                    save_place(data_slot_number, place as any);
                    debug_log('API', `[GRID_SANITY] place_tile_container:${place_id}:${tx},${ty} repaired=${repaired}`);
                }

                const container_id = `place.tile.${place_id}.${tx}_${ty}`;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_id,
                        name: `Tile (${tx},${ty})`,
                        def_id: `place_tile.${place_id}.${tx}.${ty}`,
                        capacity: { max_slots },
                        contents: contents.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: { id: p.id, def_id: p.def_id, qty: p.qty, tags: p.tags },
                                definition: { id: p.def_id, name: p.name, weight: p.unit_weight, tags: p.tags, display_char: p.display_char, display_color: p.display_color },
                                grid_x,
                                grid_y,
                            };
                        }),
                    }
                }));
            } catch (err) {
                debug_error("API", "/api/place/tile_container error", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/actor/container_item?actor_id=xxx&item_id=yyy - Open an actor-owned container-item by id
        if (url.pathname === "/api/actor/container_item") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id");
            const item_id = url.searchParams.get("item_id");
            if (!actor_id || !item_id) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                const actor_result = load_actor_with_items(data_slot_number, actor_id);
                if (!actor_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                    return;
                }

                const found = find_actor_item_by_id(actor_result.actor, item_id);
                if (!found) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_not_found" }));
                    return;
                }

                const container_item = found.item as any;
                const container_payload = resolve_inline_item_payload_for_api(container_item);
                const is_container = container_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                if (!is_container) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                    return;
                }

                const contents_raw = Array.isArray(container_item.contents) ? container_item.contents : [];
                const cap_res = resolve_inline_container_capacity(container_item, contents_raw.length, `actor_container_item:${actor_id}:${item_id}`);
                const max_slots = cap_res.max_slots;
                const contents = normalize_inline_container_grid(contents_raw, max_slots, `actor_container_item:${actor_id}:${item_id}`);

                // Repair coords + capacity in-place and persist.
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of contents) {
                    coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                for (const it of contents_raw) {
                    const id = String(it?.id ?? '');
                    const c = coords_by_id.get(id);
                    if (!c) continue;
                    if (it.grid_x !== c.x || it.grid_y !== c.y) {
                        it.grid_x = c.x;
                        it.grid_y = c.y;
                        repaired++;
                    }
                }
                if (cap_res.patched || repaired > 0) {
                    const save_res = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_res.ok) {
                        debug_error('API', `[CAPACITY_SANITY] failed to save actor after patch ${actor_id}`, save_res.error);
                    }
                    if (repaired > 0) {
                        debug_log('API', `[GRID_SANITY] actor_container_item:${actor_id}:${item_id} repaired=${repaired}`);
                    }
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_payload.id,
                        name: container_payload.name,
                        def_id: container_payload.def_id,
                        capacity: { max_slots },
                        contents: contents.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: { id: p.id, def_id: p.def_id, qty: p.qty, tags: p.tags },
                                definition: { id: p.def_id, name: p.name, weight: p.unit_weight, tags: p.tags, display_char: p.display_char, display_color: p.display_color },
                                grid_x,
                                grid_y,
                            };
                        }),
                    }
                }));
            } catch (err) {
                debug_error("API", "/api/actor/container_item error", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/body_slot/container - Open container from body_slots (inline system)
        if (url.pathname === "/api/body_slot/container") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const actor_id = url.searchParams.get("actor_id");
            const container_path = url.searchParams.get("path"); // e.g., "leg_left.garb.0"

            if (!actor_id || !container_path) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                debug_log("API", `/api/body_slot/container: Opening ${container_path} for ${actor_id}`);

                // Load actor with inline items
                const actor_result = load_actor_with_items(data_slot_number, actor_id);
                if (!actor_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: actor_result.error }));
                    return;
                }

                // Parse path: slot_name.slot_type.index
                const path_parts = container_path.split('.');
                if (path_parts.length < 2) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_path_format" }));
                    return;
                }

                const slot_name = path_parts[0]!;
                const slot_type = path_parts[1]!;
                const slot_index = path_parts.length > 2 ? parseInt(path_parts[2]!, 10) : null;

                const body_slots = actor_result.actor.body_slots as Record<string, any>;
                const slot = body_slots?.[slot_name];

                if (!slot) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "slot_not_found" }));
                    return;
                }

                let container_item: any = null;

                // Find the container item based on slot type
                if (slot_type === 'armor' && slot.armor) {
                    container_item = slot.armor;
                } else if (slot_type === 'tool' && slot.tool) {
                    container_item = slot.tool;
                } else if (slot_type === 'garb' && slot.garb && slot_index !== null) {
                    container_item = slot.garb[slot_index];
                }

                if (!container_item) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "container_not_found" }));
                    return;
                }

                // Check if it's a container (resolved)
                const container_payload = resolve_inline_item_payload_for_api(container_item);
                const is_container = container_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER');
                if (!is_container) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                    return;
                }

                // Return container data with contents
                const contents_raw = container_item.contents || [];
                const cap_res = resolve_inline_container_capacity(container_item, Array.isArray(contents_raw) ? contents_raw.length : 0, `body_slot:${actor_id}:${container_path}`);
                const max_slots = cap_res.max_slots;
                const contents = normalize_inline_container_grid(contents_raw, max_slots, `body_slot:${actor_id}:${container_path}`);

                // Repair coords in-place so future operations are consistent.
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of contents) {
                    coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                if (Array.isArray(contents_raw)) {
                    for (const it of contents_raw) {
                        const id = String(it?.id ?? '');
                        const c = coords_by_id.get(id);
                        if (!c) continue;
                        if (it.grid_x !== c.x || it.grid_y !== c.y) {
                            it.grid_x = c.x;
                            it.grid_y = c.y;
                            repaired++;
                        }
                    }
                }

                if (cap_res.patched || repaired > 0) {
                    const save_res = save_actor_with_items(data_slot_number, actor_id, actor_result.actor);
                    if (!save_res.ok) {
                        debug_error('API', `[CAPACITY_SANITY] failed to save actor after patch ${actor_id}`, save_res.error);
                    }
                    if (repaired > 0) {
                        debug_log('API', `[GRID_SANITY] body_slot:${actor_id}:${container_path} repaired=${repaired}`);
                    }
                }
                
                debug_log("API", `/api/body_slot/container: Found container with ${contents.length} items`);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_payload.id,
                        name: container_payload.name,
                        def_id: container_payload.def_id,
                        path: container_path,
                        capacity: {
                            max_slots,
                        },
                        contents: contents.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: {
                                    id: p.id,
                                    def_id: p.def_id,
                                    qty: p.qty,
                                    tags: p.tags,
                                },
                                definition: {
                                    id: p.def_id,
                                    name: p.name,
                                    weight: p.unit_weight,
                                    tags: p.tags,
                                    display_char: p.display_char,
                                    display_color: p.display_color,
                                },
                                grid_x,
                                grid_y,
                            };
                        })
                    }
                }));
            } catch (err) {
                debug_error("API", `/api/body_slot/container error`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // GET /api/place/ground_container - Open container on ground (inline system)
        if (url.pathname === "/api/place/ground_container") {
            if (req.method !== "GET") {
                res.writeHead(405, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
                return;
            }

            const place_id = url.searchParams.get("place_id");
            const position_key = url.searchParams.get("position_key"); // e.g., "4_5_0"
            const item_index = url.searchParams.get("index");

            if (!place_id || !position_key || item_index === null) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "missing_parameters" }));
                return;
            }

            try {
                debug_log("API", `/api/place/ground_container: Opening container at ${position_key}[${item_index}] in ${place_id}`);

                // Load place with ground items
                const place_result = load_place_with_ground(data_slot_number, place_id);
                if (!place_result.ok) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: place_result.error }));
                    return;
                }

                const place_any = place_result.place as any;
                const norm = normalize_voxel_position_key(place_any, String(position_key));
                if (!norm) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "invalid_position_key" }));
                    return;
                }

                const ground = place_any.ground as any;
                if (!ground?.scattered?.[norm.key]) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "ground_items_not_found" }));
                    return;
                }

                const items_at_position = ground.scattered[norm.key];
                const index = parseInt(item_index, 10);

                if (isNaN(index) || index < 0 || index >= items_at_position.length) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "item_not_found" }));
                    return;
                }

                const container_item = items_at_position[index];

                const container_payload = resolve_inline_item_payload_for_api(container_item);
                const is_container = container_payload.tags.some((t: any) => String(t?.name ?? '').toUpperCase() === 'CONTAINER') || Array.isArray((container_item as any)?.contents);
                if (!is_container) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "not_a_container" }));
                    return;
                }

                const contents_raw = Array.isArray((container_item as any)?.contents) ? (container_item as any).contents : [];
                const cap_res = resolve_inline_container_capacity(container_item, contents_raw.length, `ground_container:${place_id}:${norm.key}[${index}]`);
                const max_slots = cap_res.max_slots;
                const contents = normalize_inline_container_grid(contents_raw, max_slots, `ground_container:${place_id}:${norm.key}[${index}]`);

                // Repair coords in-place and persist (same as other container endpoints).
                const coords_by_id = new Map<string, { x: number; y: number }>();
                for (const e of contents) {
                    coords_by_id.set(String(e.item?.id ?? ''), { x: e.grid_x, y: e.grid_y });
                }
                let repaired = 0;
                for (const it of contents_raw) {
                    const id = String(it?.id ?? '');
                    const c = coords_by_id.get(id);
                    if (!c) continue;
                    if (it.grid_x !== c.x || it.grid_y !== c.y) {
                        it.grid_x = c.x;
                        it.grid_y = c.y;
                        repaired++;
                    }
                }
                if (cap_res.patched || repaired > 0) {
                    const save_place_res = save_place_with_ground(data_slot_number, place_id, place_result.place);
                    if (!save_place_res.ok) {
                        debug_error('API', `[CAPACITY_SANITY] failed to save place after patch ${place_id}`, save_place_res.error);
                    }
                    if (repaired > 0) {
                        debug_log('API', `[GRID_SANITY] ground_container:${place_id}:${norm.key}[${index}] repaired=${repaired}`);
                    }
                }
                
                debug_log("API", `/api/place/ground_container: Found container with ${contents.length} items`);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    container: {
                        id: container_payload.id,
                        name: container_payload.name,
                        def_id: container_payload.def_id,
                        position_key: norm.key,
                        index: index,
                        capacity: {
                            max_slots,
                        },
                        contents: contents.map(({ item, grid_x, grid_y }: any) => {
                            const p = resolve_inline_item_payload_for_api(item);
                            return {
                                instance: { id: p.id, def_id: p.def_id, qty: p.qty, tags: p.tags },
                                definition: { id: p.def_id, name: p.name, weight: p.unit_weight, tags: p.tags, display_char: p.display_char, display_color: p.display_color },
                                grid_x,
                                grid_y,
                            };
                        })
                    }
                }));
            } catch (err) {
                debug_error("API", `/api/place/ground_container error`, err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "internal_error" }));
            }
            return;
        }

        // ============================================
        // END NEW INLINE ITEM API ENDPOINTS
        // ============================================

        if (url.pathname !== "/api/input") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not_found" }));
            return;
        }
    });

    server.listen(HTTP_PORT, () => {
        debug_log(`HTTP bridge listening on http://localhost:${HTTP_PORT}/api/input`);
    });
}

// repeatedly check tasks that take time using current_state (shell)
// Breath is the stage coordinator for routing and state transitions.
// Track which messages have been displayed to prevent duplicates
const displayedMessageIds = new Set<string>();

/**
 * Parse user input and create an ActionIntent for the ActionPipeline
 */
function Breath(log_path: string, inbox_path: string, outbox_path: string): void {
    try {
        flush_incoming_messages();

        // Read inbox without clearing
        const inbox = read_inbox(inbox_path);
        if (inbox.messages.length === 0) return;

        const messagesToKeep: typeof inbox.messages = [];
        const messagesToRemove: typeof inbox.messages = [];

        for (const msg of inbox.messages) {
            if (!msg) continue;

            // Renderer -> npc_ai position sync messages.
            // interface_program is not the consumer; do not log or remove.
            if (msg.type === "npc_position_update") {
                messagesToKeep.push(msg);
                continue;
            }

            // Renderer-sent perception events (movement, etc.).
            // These are system messages and should not display or route as user input.
            if (msg.type === "perception_event_batch") {
                try {
                    const parsed = JSON.parse(msg.content || "{}") as any;
                    const events = Array.isArray(parsed?.events) ? parsed.events : [];
                    for (const ev of events) {
                        if (ev?.observerRef && ev?.verb) {
                            process_witness_event(ev.observerRef, ev);
                        }
                    }
                } catch (err) {
                    console.error("[Breath] Failed to process perception_event_batch:", err);
                }

                displayedMessageIds.add(msg.id);
                messagesToRemove.push(msg);
                continue;
            }

            // Skip if already displayed
            if (displayedMessageIds.has(msg.id)) {
                messagesToRemove.push(msg);
                continue;
            }

            // Check if this is a displayable message (NPC response, renderer output)
            const isDisplayable = 
                msg.stage === "npc_response" ||
                msg.stage === "rendered_1" ||
                msg.sender?.startsWith("npc.") ||
                msg.sender === "renderer_ai";

            // Check if this is user input that needs routing
            // Exclude system messages like position updates
            const isUserInput = 
                msg.type === "user_input" ||
                msg.sender?.toLowerCase() === "j" ||
                (msg.type !== "npc_position_update" &&
                 msg.stage !== "npc_response" && 
                 msg.stage !== "rendered_1" &&
                 !msg.sender?.startsWith("npc.") &&
                 msg.sender !== "renderer_ai");

            if (isDisplayable) {
                // Displayable messages (renderer_ai output, npc_response) are already written to log.jsonc
                // by their originating services. Avoid duplicating them here.
                displayedMessageIds.add(msg.id);
                messagesToRemove.push(msg);
                 
                // Debug logging for NPC messages specifically
                if (msg.sender?.startsWith('npc.')) {
                    console.log(`[Breath] Displaying NPC message from ${msg.sender}: "${msg.content?.slice(0, 50)}..."`);
                }
                
                debug_log("Breath: displayed message to user", {
                    id: msg.id,
                    sender: msg.sender,
                    stage: msg.stage,
                    preview: msg.content?.slice(0, 50)
                });
            } else if (isUserInput) {
                const content = msg.content || "";

                const meta_any = (msg.meta as any) ?? {};
                const intent_verb_raw = typeof meta_any.intent_verb === "string" ? meta_any.intent_verb : "";
                const intent_verb = intent_verb_raw.trim().toUpperCase();

                // INSPECT: deterministic findings + optional renderer narration
                if (intent_verb === "INSPECT") {
                    const sender_id = (msg.sender ?? "").trim();
                    const actor_ref = sender_id.startsWith("actor.") ? sender_id : `actor.${sender_id}`;
                    const actor_id = actor_ref.replace(/^actor\./, "");

                    const target_ref = typeof meta_any.target_ref === "string" && meta_any.target_ref.trim().length > 0
                        ? meta_any.target_ref.trim()
                        : (getActorTarget(actor_ref)?.target_ref ?? null);

                    if (!target_ref) {
                        const err_msg = create_message({
                            sender: "inspection",
                            content: "INSPECT failed: no target selected",
                            stage: "inspection_result",
                            status: "sent",
                            reply_to: msg.id,
                            correlation_id: msg.correlation_id,
                            meta: { ...getSessionMeta(), action_verb: "INSPECT" },
                        });
                        append_log_envelope(log_path, err_msg);
                        displayedMessageIds.add(msg.id);
                        messagesToRemove.push(msg);
                        continue;
                    }

                    const actor_res = load_actor(data_slot_number, actor_id);
                    if (!actor_res.ok || !actor_res.actor) {
                        const err_msg = create_message({
                            sender: "inspection",
                            content: "INSPECT failed: actor data not found",
                            stage: "inspection_result",
                            status: "sent",
                            reply_to: msg.id,
                            correlation_id: msg.correlation_id,
                            meta: { ...getSessionMeta(), action_verb: "INSPECT" },
                        });
                        append_log_envelope(log_path, err_msg);
                        displayedMessageIds.add(msg.id);
                        messagesToRemove.push(msg);
                        continue;
                    }

                    const actor = actor_res.actor as any;
                    const loc = actor.location ?? {};
                    const actorLocation = {
                        world_x: loc?.world_tile?.x ?? loc?.world_x ?? 0,
                        world_y: loc?.world_tile?.y ?? loc?.world_y ?? 0,
                        region_x: loc?.region_tile?.x ?? loc?.region_x ?? 0,
                        region_y: loc?.region_tile?.y ?? loc?.region_y ?? 0,
                        x: loc?.tile?.x ?? loc?.x,
                        y: loc?.tile?.y ?? loc?.y,
                        place_id: loc?.place_id,
                    };

                    const inspector_data: InspectorData = {
                        ref: actor_ref,
                        location: {
                            world_x: actorLocation.world_x,
                            world_y: actorLocation.world_y,
                            region_x: actorLocation.region_x,
                            region_y: actorLocation.region_y,
                            x: typeof actorLocation.x === "number" ? actorLocation.x : 0,
                            y: typeof actorLocation.y === "number" ? actorLocation.y : 0,
                        },
                        senses: {
                            light: Number(actor?.senses?.light ?? 0) || 0,
                            pressure: Number(actor?.senses?.pressure ?? 0) || 0,
                            aroma: Number(actor?.senses?.aroma ?? 0) || 0,
                            thaumic: Number(actor?.senses?.thaumic ?? 0) || 0,
                        },
                        stats: (actor?.stats ?? {}) as Record<string, number>,
                        profs: (actor?.profs ?? actor?.proficiencies ?? {}) as Record<string, number>,
                    };

                    const lowered = content.toLowerCase();
                    const requested_keywords = extract_feature_keywords_for_inspection(lowered);
                    const body_slot = extract_body_slot_for_inspection(lowered);

                    // Optional UI-provided tile position (for inspecting tiles that aren't in availableTargets).
                    const ui_target_tile = meta_any.ui_target_tile;
                    const has_ui_xy = ui_target_tile && typeof ui_target_tile === "object" &&
                        Number.isFinite(Number(ui_target_tile.x)) && Number.isFinite(Number(ui_target_tile.y));

                    const targetLocation = has_ui_xy
                        ? {
                            ...actorLocation,
                            x: Math.round(Number(ui_target_tile.x)),
                            y: Math.round(Number(ui_target_tile.y)),
                          }
                        : undefined;

                    const cost_raw = typeof meta_any.action_cost === "string" ? meta_any.action_cost.trim().toUpperCase() : "";
                    const actionCost = (cost_raw === "FREE" || cost_raw === "FULL" || cost_raw === "PARTIAL" || cost_raw === "EXTENDED")
                        ? (cost_raw as any)
                        : "PARTIAL";

                    const intent = createIntent(actor_ref, "INSPECT" as any, "player_input", {
                        actorType: "player",
                        actorLocation,
                        targetRef: target_ref,
                        targetLocation,
                        actionCost,
                        parameters: {
                            inspector_data,
                            requested_keywords,
                            body_slot,
                            max_features: 5,
                            target_size_mag: 0,
                        },
                        originalInput: content,
                    });

                    processPlayerAction(data_slot_number, intent).then((result) => {
                        if (!result.success) {
                            const fail = create_message({
                                sender: "inspection",
                                content: `INSPECT failed: ${result.failureReason ?? "unknown"}`,
                                stage: "inspection_result",
                                status: "sent",
                                reply_to: msg.id,
                                correlation_id: msg.correlation_id,
                                meta: { ...getSessionMeta(), action_verb: "INSPECT" },
                            });
                            append_log_envelope(log_path, fail);
                            return;
                        }

                        const eff = result.effects.find((e: any) => e?.type === "INSPECT") as any;
                        const inspect_result = eff?.parameters?.inspection_result as InspectionResult | undefined;

                        if (inspect_result) {
                            const formatted = format_inspection_result(inspect_result);
                            const findings = create_message({
                                sender: "inspection",
                                content: formatted,
                                stage: "inspection_result",
                                status: "sent",
                                reply_to: msg.id,
                                correlation_id: msg.correlation_id,
                                meta: {
                                    ...getSessionMeta(),
                                    action_verb: "INSPECT",
                                    actor_ref,
                                    target_ref,
                                    clarity: inspect_result.clarity,
                                    sense_used: inspect_result.sense_used,
                                },
                            });
                            append_log_envelope(log_path, findings);
                        }

                        // Also queue a renderer narration pass that is constrained to the structured inspect result.
                        const outbox_msg: MessageEnvelope = {
                            ...msg,
                            status: "sent" as const,
                            stage: "applied_INSPECT" as const,
                            meta: {
                                ...(msg.meta || {}),
                                action_verb: "INSPECT",
                                actor_ref,
                                target_ref,
                                original_text: content,
                                processed_by_action_pipeline: true,
                                renderer_context: {
                                    actor_ref,
                                    target_ref,
                                    inspect_result: inspect_result || null,
                                },
                            },
                        };
                        append_outbox_message(outbox_path, outbox_msg);
                    }).catch((err) => {
                        console.error("[Breath] INSPECT pipeline error:", err);
                    });

                    displayedMessageIds.add(msg.id);
                    messagesToRemove.push(msg);
                    continue;
                }

                // NEW COMMUNICATION SYSTEM: All text input goes through COMMUNICATE action
                const volume_override = (msg.meta as any)?.intent_subtype;
                if (typeof volume_override === "string") {
                    const v = volume_override.toUpperCase();
                    if (v === "WHISPER" || v === "NORMAL" || v === "SHOUT") {
                        setVolume(v as VolumeLevel);
                    }
                }
                
                console.log(`[Breath] Processing user input: "${content.slice(0, 50)}"`);
                
                // Use new communication input system
                handleCommunicationSubmit(content, (intent) => {
                    console.log(`[Breath] Created COMMUNICATE intent:`, {
                        target: intent.targetRef || "(broadcast)",
                        volume: intent.volume,
                        message: intent.message.slice(0, 30)
                    });
                    
                    // Process through ActionPipeline
                     processPlayerAction(data_slot_number, intent).then(result => {
                        console.log(`[Breath] ActionPipeline completed:`, {
                            success: result.success,
                            observedBy: result.observedBy?.length || 0
                        });
                        
                        if (result.success) {
                            
                            // Write message to outbox so NPC_AI can generate an LLM response.
                            // ActionPipeline handles execution; this outbox envelope is the notification channel.
                              const lower = content.toLowerCase();
                              const conversation_phase = (/(\bbye\b|\bgoodbye\b|\bfarewell\b|\bsee you\b)/i).test(lower)
                                ? "exit"
                                : "mid";

                              const observed_by_list = Array.isArray(result.observedBy) ? result.observedBy : [];
                              const observed_npcs = observed_by_list
                                .filter((r): r is string => typeof r === "string")
                                .filter((r) => r.startsWith("npc."));

                              // If this COMMUNICATE had no explicit target, allow a single observed NPC to respond.
                              // This keeps early-game conversations flowing without enabling multi-NPC pile-on.
                              const eligible_default = get_response_eligible_by_action(result.intentId);
                              const direct_target = (
                                intent.targetRef && observed_by_list.includes(intent.targetRef)
                              ) ? [intent.targetRef] : [];

                              // Response eligibility rules:
                              // - If user explicitly targets an NPC, only that NPC may respond (prevents pile-on).
                              // - If no explicit target:
                              //   - If witness marked eligible responders, use that.
                              //   - Else if exactly one NPC observed, allow that single NPC to respond.
                              //   - Else if conversation_phase is exit and there are observed NPCs, allow exactly one observed NPC to respond
                              //     (prevents dead-air on goodbyes without enabling multi-NPC pile-on).
                              const response_eligible_by = intent.targetRef
                                ? direct_target
                                : (
                                  (eligible_default.length === 0 && observed_npcs.length === 1)
                                    ? observed_npcs
                                    : (
                                      (eligible_default.length === 0 && conversation_phase === "exit" && observed_npcs.length > 0)
                                        ? [observed_npcs[0] as string]
                                        : eligible_default
                                    )
                                );

                              const outbox_msg: MessageEnvelope = {
                                  ...msg,
                                  status: "sent" as const,
                                  // NOTE: `interpreter_ai` is archived. This is an ActionPipeline-driven COMMUNICATE.
                                  stage: "applied_COMMUNICATE" as const,
                                  meta: {
                                      ...(msg.meta || {}),
                                      action_verb: "COMMUNICATE",
                                      actor_ref: intent.actorRef,
                                      intent_verb: "COMMUNICATE",
                                      intent_subtype: intent.volume,
                                      target_ref: intent.targetRef,
                                      original_text: content,
                                      processed_by_action_pipeline: true,
                                      observed_by: observed_by_list,
                                      response_eligible_by,
                                      conversation_phase,
                                      renderer_context: {
                                        actor_ref: intent.actorRef,
                                        target_ref: intent.targetRef,
                                        intent_subtype: intent.volume,
                                        observed_by: observed_by_list,
                                        response_eligible_by,
                                        conversation_phase,
                                      },
                                  },
                              };
                            append_outbox_message(outbox_path, outbox_msg);
                            console.log(`[Breath] Message written to outbox for NPC_AI processing: ${msg.id}`);
                        }
                    }).catch(err => {
                        console.error(`[Breath] ActionPipeline error:`, err);
                    });
                });
                
                // Mark as processed - don't continue with normal routing to avoid duplicates
                // The outbox message will be written inside the callback after intent is created
                displayedMessageIds.add(msg.id);
                messagesToRemove.push(msg);
                
                // Note: We need to move the outbox writing into the callback below
                // where 'intent' is available. See handleCommunicationSubmit callback.
            } else {
                // Continue with normal routing (for non-COMMUNICATE messages)
                const normalized: MessageEnvelope = {
                    ...msg,
                    created_at: msg.created_at ?? new Date().toISOString(),
                };

                const is_user = msg.sender?.toLowerCase() === "j";
                if (normalized.correlation_id === undefined && is_user) {
                    normalized.correlation_id = create_correlation_id();
                }

                const routed = route_message(normalized);
                append_log_envelope(log_path, routed.log);

                debug_log("Breath: inbox message routed", {
                    id: routed.log.id,
                    sender: routed.log.sender,
                    stage: routed.log.stage,
                    hasOutbox: !!routed.outbox,
                    outboxStage: routed.outbox?.stage,
                });

                write_status_line(
                    get_status_path(data_slot_number),
                    "routing message to the pipeline",
                );

                if (routed.outbox) {
                    append_outbox_message(outbox_path, routed.outbox);
                    debug_log("Breath: outbox queued", {
                        id: routed.outbox.id,
                        stage: routed.outbox.stage,
                        status: routed.outbox.status,
                    });

                    write_status_line(
                        get_status_path(data_slot_number),
                        "queued for interpretation",
                    );
                }

                messagesToRemove.push(msg);
            }
        }

        // Rewrite inbox by removing only the ids we consumed.
        // This reduces cross-service clobbering when other services write to inbox concurrently.
        if (messagesToRemove.length > 0) {
            const remove_ids = new Set(messagesToRemove.map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length > 0));
            const latest = read_inbox(inbox_path);
            const before = latest.messages.length;
            latest.messages = latest.messages.filter((m) => !remove_ids.has(m.id));
            write_inbox(inbox_path, latest);

            debug_log("Breath: inbox cleaned", {
                removed: before - latest.messages.length,
                kept: latest.messages.length,
            });
        }

        // Prune displayed message IDs if getting too large
        if (displayedMessageIds.size > 1000) {
            const idsArray = Array.from(displayedMessageIds);
            displayedMessageIds.clear();
            idsArray.slice(-500).forEach(id => displayedMessageIds.add(id));
        }
        
        // Update facing for active conversations (keeps NPCs facing players during convo)
        update_conversation_facing().catch(err => {
            console.error("[Breath] Error updating conversation facing:", err);
        });

        // Advance witness-driven conversation timers and clean up ended conversations.
        // This must run in the interface_program process because witness reactions are executed here.
        try {
            update_witness_conversations();
        } catch (err) {
            console.error("[Breath] Error updating witness conversations:", err);
        }
    } catch (err) {
        current_state = "error";
        console.error(err);
    }
}

// NOTE: displayMessageToUser() removed.
// UI reads `log.jsonc`, and displayable messages are logged by their originating services.

// run on boot (shell)
function initialize(): { log_path: string; inbox_path: string; outbox_path: string } {
    const data_slot_dir = get_data_slot_dir(data_slot_number);
    const log_path = get_log_path(data_slot_number);
    const inbox_path = get_inbox_path(data_slot_number);
    const outbox_path = get_outbox_path(data_slot_number);
    const status_path = get_status_path(data_slot_number);
    const world_dir = get_world_dir(data_slot_number);
    const item_dir = get_item_dir(data_slot_number);
    const roller_status_path = get_roller_status_path(data_slot_number);

    ensure_dir_exists(data_slot_dir);
    ensure_log_exists(log_path);
    prune_log_noise(log_path);
    ensure_inbox_exists(inbox_path);
    ensure_outbox_exists(outbox_path);
    ensure_status_exists(status_path);
    ensure_dir_exists(world_dir);
    ensure_dir_exists(item_dir);
    ensure_roller_status_exists(roller_status_path);
    ensure_minimum_game_data(data_slot_number);
    
    // Initialize ActionPipeline for witness reactions and action processing
    initializeActionPipeline(data_slot_number);
    debug_log("Interface Program", "ActionPipeline initialized");

    write_status_line(status_path, "awaiting actor input");

    append_log_message(log_path, "SYSTEM", "INTERFACE_PROGRAM booted");

    // Verify session ID on startup
    debug_log(`[Session] Interface Program session: ${SESSION_ID}`);
    
    return { log_path, inbox_path, outbox_path };
}

// TEMP DEBUG CLI:
// This will be removed/replaced by monospace canvas UI.
// It is not responsible for screen rendering anymore and has been detatched. from powershell console use.
function run_cli(log_path: string): void {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const loop = () => {
        rl.question("> ", (user_text: string) => {
            const trimmed = user_text.trim();
            if (!trimmed) return loop();

            if (trimmed === "/help") {
                console.log("\nCommands:\n  /help\n  /exit (or /quit)\n");
                return loop();
            }

            if (trimmed === "/exit" || trimmed === "/quit") {
                console.log("Exiting...");
                rl.close();
                process.exit(0);
            }

            // CLI mode is preserved for manual smoke tests. The current build does not route through interpreter_ai.
            current_state = "processing";
            append_log_message(log_path, "J", trimmed);

            // stub response for now
            append_log_message(log_path, "ASSISTANT", `STUB (no AI yet). You said: ${trimmed}`);

            current_state = "awaiting_user";
            loop();
        });
    };

    loop();
}

// ---- boot ----
const { log_path, inbox_path, outbox_path } = initialize();
log_ai_config();
void boot_ai_services();
start_http_server(log_path);


// Live engine/UI tick (needed for external program inbox + log updates)
setInterval(() => {
    Breath(log_path, inbox_path, outbox_path);
}, 2000);


run_cli(log_path);

// ============================================================================
// CLICK HANDLERS (Called from frontend)
// ============================================================================

/**
 * Handle left click on entity (select target)
 * Called by frontend when user left-clicks an NPC, actor, or item
 */
export function handleEntityClick(entity_ref: string, entity_type: "npc" | "actor" | "item"): void {
    const actor_ref = "actor.henry_actor"; // TODO: Get from session
    
    debug_log("[CLICK]", `Left click on ${entity_type}: ${entity_ref}`);
    
    // Set as target for communication
    setActorTarget(actor_ref, entity_ref, entity_type);
    
    // TODO: Send command to frontend to update UI
    // "Talking to: Grenda"
}

/**
 * Handle right click (move/interact)
 * Called by frontend when user right-clicks
 */
export function handleRightClick(x: number, y: number, entity_ref?: string): void {
    if (entity_ref) {
        // Right-clicked on specific entity - use it
        debug_log("[CLICK]", `Right click on entity: ${entity_ref} at (${x}, ${y})`);
        // TODO: Implement USE action for doors, items, etc.
    } else {
        // Right-clicked on ground - move there
        debug_log("[CLICK]", `Right click on ground at (${x}, ${y})`);
        // TODO: Implement MOVE action
    }
}

/**
 * Handle volume button click
 * Called by frontend when user clicks volume buttons
 */
export function handleVolumeClick(volume: VolumeLevel): void {
    debug_log("[CLICK]", `Volume button clicked: ${volume}`);
    setVolume(volume);
    
    // TODO: Send command to frontend to update UI
    // Highlight selected volume button
}

/**
 * Handle submit communication
 * Called by frontend when user clicks Send or presses Enter
 */
export function handleSubmitCommunication(text: string): void {
    // This is handled in the Breath function via handleCommunicationSubmit
    // But we could add a direct route here for UI-triggered submissions
    debug_log("[CLICK]", `Submit communication: "${text.slice(0, 30)}"`);
}

// ============================================================================
// PROCESS LIFECYCLE
// ============================================================================

process.on("SIGINT", () => {
    shutdown_ollama_if_spawned();
    process.exit(0);
});

process.on("SIGTERM", () => {
    shutdown_ollama_if_spawned();
    process.exit(0);
});

process.on("exit", () => {
    shutdown_ollama_if_spawned();
});

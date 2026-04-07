// Ground Item Storage - Inline storage for items on the ground
// No more scattered containers, items stored directly in place.ground

import { debug_log, debug_error } from "../shared/debug.js";
import type { InlineItem, InlineGround } from "../types/inline_item.js";
import { randomUUID } from "node:crypto";
import { resolve_inline_item } from "../item_storage/resolve.js";
import { load_place, save_place } from "./store.js";
import { make_scattered_key, normalize_ground_scattered } from "./ground_normalize.js";

function get_place_base_z(place_any: any): number {
    const z = Number(place_any?.coordinates?.elevation);
    return (typeof z === 'number' && Number.isFinite(z)) ? Math.floor(z) : 0;
}

function parse_scattered_key(key: string): { x: number; y: number; z: number | null } | null {
    const parts = String(key ?? '').split('_');
    if (parts.length < 2) return null;
    const x = parseInt(parts[0] ?? '', 10);
    const y = parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const z = parts.length >= 3 ? parseInt(parts[2] ?? '', 10) : NaN;
    return { x, y, z: Number.isFinite(z) ? z : null };
}

/**
 * Load place with inline ground items
 */
export function load_place_with_ground(
    slot: number,
    place_id: string
): { ok: true; place: Record<string, unknown> } | { ok: false; error: string } {
    try {
        const place_result = load_place(slot, place_id);
        if (!place_result.ok) {
            return { ok: false, error: `${place_result.error}: ${place_id}` };
        }
        const place = place_result.place as Record<string, unknown>;
        debug_log("ground_items", `Loaded place ${place_id} with ground items`);
        return { ok: true, place };
    } catch (err) {
        debug_error("ground_items", `Failed to load place ${place_id}`, err);
        return { ok: false, error: `load_failed: ${String(err)}` };
    }
}

/**
 * Save place with inline ground items
 */
export function save_place_with_ground(
    slot: number,
    place_id: string,
    place: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
    try {
        const actual_place_id = String((place as any)?.id ?? place_id ?? '').trim();
        if (!actual_place_id) return { ok: false, error: 'missing_place_id' };
        save_place(slot, place as any);
        debug_log("ground_items", `Saved place ${place_id} with ground items`);
        return { ok: true };
    } catch (err) {
        debug_error("ground_items", `Failed to save place ${place_id}`, err);
        return { ok: false, error: `save_failed: ${String(err)}` };
    }
}

/**
 * Add item to ground at specific position
 * Creates scattered entry at "x_y" key
 */
export function add_item_to_ground(
    place: Record<string, unknown>,
    x: number,
    y: number,
    item: InlineItem
): { ok: true; position_key: string } | { ok: false; error: string } {
    const ground = place.ground as InlineGround;
    if (!ground) {
        return { ok: false, error: 'ground_not_initialized' };
    }

    const base_z = get_place_base_z(place as any);
    const iz_raw = (item as any).elevation;
    const iz = (typeof iz_raw === 'number' && Number.isFinite(iz_raw)) ? Math.floor(iz_raw) : base_z;
    (item as any).elevation = iz;

    const position_key = make_scattered_key(x, y, iz);
    
    if (!ground.scattered[position_key]) {
        ground.scattered[position_key] = [];
    }
    
    ground.scattered[position_key]!.push(item);

    const name = (resolve_inline_item(String(item.def_id ?? ''), item) ?? null)?.name ?? String(item.def_id ?? 'item');
    debug_log("ground_items", `Added ${name} to ground at (${x}, ${y})`);
    return { ok: true, position_key };
}

/**
 * Remove item from ground by ID
 * Searches scattered entries only
 */
export function remove_item_from_ground(
    place: Record<string, unknown>,
    item_id: string
): { ok: true; item: InlineItem; from_position?: { x: number; y: number; z?: number } } | { ok: false; error: string } {
    const ground = place.ground as InlineGround;
    if (!ground) {
        return { ok: false, error: 'ground_not_initialized' };
    }
    
    // Check scattered ground
    for (const [position_key, items] of Object.entries(ground.scattered)) {
        const index = items.findIndex(item => item.id === item_id);
        if (index >= 0) {
            const [item] = items.splice(index, 1);
            if (item) {
                // Clean up empty position keys
                if (items.length === 0) {
                    delete ground.scattered[position_key];
                }

                const p = parse_scattered_key(position_key);
                const position = p ? ({ x: p.x, y: p.y, z: p.z ?? (item as any)?.elevation } as any) : undefined;

                const name = (resolve_inline_item(String(item.def_id ?? ''), item) ?? null)?.name ?? String(item.def_id ?? 'item');
                debug_log("ground_items", `Removed ${name} from ground at ${position_key}`);
                return { ok: true, item, from_position: position };
            }
        }
    }
    
    return { ok: false, error: 'item_not_found' };
}

/**
 * Get all items at a specific position
 */
export function get_items_at_position(
    place: Record<string, unknown>,
    x: number,
    y: number
): InlineItem[] {
    const ground = place.ground as InlineGround;
    if (!ground) return [];

    const out: InlineItem[] = [];
    for (const [k, items] of Object.entries(ground.scattered)) {
        const p = parse_scattered_key(k);
        if (!p) continue;
        if (p.x === x && p.y === y) {
            for (const it of (items as any[])) out.push(it);
        }
    }
    return out;
}

/**
 * Get all ground items with position info
 */
export function get_all_ground_items(
    place: Record<string, unknown>
): Array<{
    item: InlineItem;
    position?: { x: number; y: number; z: number };
    position_key?: string;
}> {
    const result: Array<{
        item: InlineItem;
        position?: { x: number; y: number; z: number };
        position_key?: string;
    }> = [];
    
    const ground = place.ground as InlineGround;
    if (!ground) return result;

    // Scattered items
    for (const [position_key, items] of Object.entries(ground.scattered)) {
        const p = parse_scattered_key(position_key);
        if (!p) continue;
        const base_z = get_place_base_z(place as any);
        const z = p.z !== null ? p.z : base_z;
        const position = { x: p.x, y: p.y, z };
        
        for (const item of items) {
            if (typeof (item as any).elevation !== 'number' || !Number.isFinite((item as any).elevation)) {
                (item as any).elevation = z;
            }
            result.push({ item, position, position_key });
        }
    }
    
    return result;
}

/**
 * Find nearest items to a position
 * Returns items sorted by distance
 */
export function find_nearby_items(
    place: Record<string, unknown>,
    x: number,
    y: number,
    max_distance: number = 1.5
): Array<{
    item: InlineItem;
    distance: number;
    position?: { x: number; y: number; z: number };
}> {
    const all_items = get_all_ground_items(place);
    const nearby: Array<{
        item: InlineItem;
        distance: number;
        position?: { x: number; y: number; z: number };
    }> = [];
    
    for (const { item, position } of all_items) {
        if (position) {
            const dx = position.x - x;
            const dy = position.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= max_distance) {
                nearby.push({ item, distance, position });
            }
        } else {
            // Main ground items are always "nearby" for pickup purposes
            nearby.push({ item, distance: 0 });
        }
    }
    
    // Sort by distance
    nearby.sort((a, b) => a.distance - b.distance);
    
    return nearby;
}

/**
 * Get items for rendering at a position
 * Returns single character representation based on item count/value
 */
export function get_ground_render_char(
    place: Record<string, unknown>,
    x: number,
    y: number
): string | null {
    const items = get_items_at_position(place, x, y);
    
    if (items.length === 0) return null;
    if (items.length === 1) return '·';
    if (items.length <= 10) return '*';
    return '#';
}

/**
 * Create a new ground item
 */
export function create_ground_item(
    def_id: string,
    qty: number = 1,
): InlineItem {
    return {
        id: randomUUID(),
        def_id: String(def_id ?? ''),
        qty: Math.max(1, Math.floor(qty))
    };
}

/**
 * Pickup item from ground to actor
 * Combines ground removal and actor addition
 */
export function pickup_item_to_actor(
    place: Record<string, unknown>,
    actor: Record<string, unknown>,
    item_id: string
): { ok: true; item: InlineItem } | { ok: false; error: string } {
    // Remove from ground
    const remove_result = remove_item_from_ground(place, item_id);
    if (!remove_result.ok) {
        return remove_result;
    }
    
    // Find or create sack
    const { ensure_actor_has_sack, add_item_to_container } = require('../item_storage/inline_store.js');
    
    const sack_result = ensure_actor_has_sack(actor);
    if (!sack_result.ok) {
        // Put item back on ground
        if (remove_result.from_position) {
            add_item_to_ground(place, remove_result.from_position.x, remove_result.from_position.y, remove_result.item);
        } else {
            debug_error('ground_items', `Cannot roll back pickup of ${String(remove_result.item?.id ?? 'unknown')}: ground item has no coordinates`);
            return { ok: false, error: 'ground_item_missing_coordinates' };
        }
        return { ok: false, error: 'no_container_available' };
    }
    
    // Add to sack
    const add_result = add_item_to_container(actor, sack_result.sack_path, remove_result.item);
    if (!add_result.ok) {
        // Put item back on ground
        if (remove_result.from_position) {
            add_item_to_ground(place, remove_result.from_position.x, remove_result.from_position.y, remove_result.item);
        } else {
            debug_error('ground_items', `Cannot roll back pickup of ${String(remove_result.item?.id ?? 'unknown')}: ground item has no coordinates`);
            return { ok: false, error: 'ground_item_missing_coordinates' };
        }
        return { ok: false, error: add_result.error };
    }
    
    {
        const name = (resolve_inline_item(String(remove_result.item.def_id ?? ''), remove_result.item) ?? null)?.name ?? String(remove_result.item.def_id ?? 'item');
        debug_log("ground_items", `Picked up ${name} to actor`);
    }
    return { ok: true, item: remove_result.item };
}

/**
 * Drop item from actor to ground
 */
export function drop_item_to_ground(
    actor: Record<string, unknown>,
    place: Record<string, unknown>,
    item_id: string,
    x: number,
    y: number
): { ok: true; item: InlineItem } | { ok: false; error: string } {
    // Find and remove item from actor
    const { find_actor_item_by_id, remove_item_by_path } = require('../item_storage/inline_store.js');
    
    const find_result = find_actor_item_by_id(actor, item_id);
    if (!find_result) {
        return { ok: false, error: 'item_not_found_on_actor' };
    }
    
    const remove_result = remove_item_by_path(actor, find_result.path);
    if (!remove_result.ok) {
        return remove_result;
    }
    
    // Add to ground
    const add_result = add_item_to_ground(place, x, y, remove_result.item);
    if (!add_result.ok) {
        // Put item back on actor
        const { add_item_to_body_slot } = require('../item_storage/inline_store.js');
        const parts = find_result.path.split('.');
        add_item_to_body_slot(
            actor,
            parts[0]!,
            parts[1] as 'armor' | 'garb' | 'tool',
            remove_result.item
        );
        return { ok: false, error: add_result.error };
    }
    
    {
        const name = (resolve_inline_item(String(remove_result.item.def_id ?? ''), remove_result.item) ?? null)?.name ?? String(remove_result.item.def_id ?? 'item');
        debug_log("ground_items", `Dropped ${name} to ground at (${x}, ${y})`);
    }
    return { ok: true, item: remove_result.item };
}

/**
 * Initialize ground structure for a place
 */
export function initialize_ground(place: Record<string, unknown>): void {
    if (!place.ground) {
        place.ground = {
            scattered: {}
        };
    }
}

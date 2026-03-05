// Ground Item Storage - Inline storage for items on the ground
// No more scattered containers, items stored directly in place.ground

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { debug_log, debug_error } from "../shared/debug.js";
import type { InlineItem, InlineGround } from "../types/inline_item.js";
import type { TagInstance } from "../tag_system/registry.js";
import { randomUUID } from "node:crypto";
import { get_data_slot_dir } from "../engine/paths.js";

function get_place_path(slot: number, place_id: string): string {
    return path.join(get_data_slot_dir(slot), "places", `${place_id}.jsonc`);
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

function write_jsonc(pathname: string, data: unknown): void {
    ensure_dir_exists(path.dirname(pathname));
    fs.writeFileSync(pathname, JSON.stringify(data, null, 2));
}

/**
 * Load place with inline ground items
 */
export function load_place_with_ground(
    slot: number,
    place_id: string
): { ok: true; place: Record<string, unknown> } | { ok: false; error: string } {
    try {
        const place_path = get_place_path(slot, place_id);
        
        if (!fs.existsSync(place_path)) {
            return { ok: false, error: `place_not_found: ${place_id}` };
        }
        
        const place = read_jsonc(place_path);
        
        // Ensure ground structure exists
        if (!place.ground) {
            place.ground = { main: [], scattered: {} };
        }
        
        const ground = place.ground as InlineGround;
        if (!ground.main) ground.main = [];
        if (!ground.scattered) ground.scattered = {};
        
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
        const place_path = get_place_path(slot, place_id);
        write_jsonc(place_path, place);
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
    
    const position_key = `${x}_${y}`;
    
    if (!ground.scattered[position_key]) {
        ground.scattered[position_key] = [];
    }
    
    ground.scattered[position_key]!.push(item);
    
    debug_log("ground_items", `Added ${item.name} to ground at (${x}, ${y})`);
    return { ok: true, position_key };
}

/**
 * Add item to main ground (no specific position)
 */
export function add_item_to_main_ground(
    place: Record<string, unknown>,
    item: InlineItem
): { ok: true } | { ok: false; error: string } {
    const ground = place.ground as InlineGround;
    if (!ground) {
        return { ok: false, error: 'ground_not_initialized' };
    }
    
    ground.main.push(item);
    
    debug_log("ground_items", `Added ${item.name} to main ground`);
    return { ok: true };
}

/**
 * Remove item from ground by ID
 * Searches both main and scattered
 */
export function remove_item_from_ground(
    place: Record<string, unknown>,
    item_id: string
): { ok: true; item: InlineItem; from_position?: { x: number; y: number } } | { ok: false; error: string } {
    const ground = place.ground as InlineGround;
    if (!ground) {
        return { ok: false, error: 'ground_not_initialized' };
    }
    
    // Check main ground
    const main_index = ground.main.findIndex(item => item.id === item_id);
    if (main_index >= 0) {
        const [item] = ground.main.splice(main_index, 1);
        if (item) {
            debug_log("ground_items", `Removed ${item.name} from main ground`);
            return { ok: true, item };
        }
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
                
                const [x_str, y_str] = position_key.split('_');
                const position = { x: parseInt(x_str!, 10), y: parseInt(y_str!, 10) };
                
                debug_log("ground_items", `Removed ${item.name} from ground at ${position_key}`);
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
    
    const position_key = `${x}_${y}`;
    return ground.scattered[position_key] ?? [];
}

/**
 * Get all ground items (both main and scattered)
 * Returns with position info for scattered items
 */
export function get_all_ground_items(
    place: Record<string, unknown>
): Array<{
    item: InlineItem;
    position?: { x: number; y: number };
    position_key?: string;
}> {
    const result: Array<{
        item: InlineItem;
        position?: { x: number; y: number };
        position_key?: string;
    }> = [];
    
    const ground = place.ground as InlineGround;
    if (!ground) return result;
    
    // Main ground items
    for (const item of ground.main) {
        result.push({ item });
    }
    
    // Scattered items
    for (const [position_key, items] of Object.entries(ground.scattered)) {
        const [x_str, y_str] = position_key.split('_');
        const position = { x: parseInt(x_str!, 10), y: parseInt(y_str!, 10) };
        
        for (const item of items) {
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
    position?: { x: number; y: number };
}> {
    const all_items = get_all_ground_items(place);
    const nearby: Array<{
        item: InlineItem;
        distance: number;
        position?: { x: number; y: number };
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
    name: string,
    weight: number,
    qty: number = 1,
    tags: TagInstance[] = []
): InlineItem {
    return {
        id: randomUUID(),
        def_id,
        name,
        qty,
        weight,
        tags
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
            add_item_to_main_ground(place, remove_result.item);
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
            add_item_to_main_ground(place, remove_result.item);
        }
        return { ok: false, error: add_result.error };
    }
    
    debug_log("ground_items", `Picked up ${remove_result.item.name} to actor`);
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
    
    debug_log("ground_items", `Dropped ${remove_result.item.name} to ground at (${x}, ${y})`);
    return { ok: true, item: remove_result.item };
}

/**
 * Initialize ground structure for a place
 */
export function initialize_ground(place: Record<string, unknown>): void {
    if (!place.ground) {
        place.ground = {
            main: [],
            scattered: {}
        };
    }
}

// Inline Item Storage - Unified storage for items in body_slots
// No more container lookups, no more ID references
// Items stored as full objects directly in body_slots

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { get_actor_dir, get_actor_path } from "../engine/paths.js";
import { ensure_dir_exists } from "../engine/log_store.js";
import { debug_log, debug_error } from "../shared/debug.js";
import type { InlineItem, InlineBodySlot } from "../types/inline_item.js";
import type { TagInstance } from "../tag_system/registry.js";
import { randomUUID } from "node:crypto";

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

function write_jsonc(pathname: string, data: unknown): void {
    ensure_dir_exists(path.dirname(pathname));
    fs.writeFileSync(pathname, JSON.stringify(data, null, 2));
}

/**
 * Load actor with inline items from body_slots
 * Returns the actor object with body_slots containing full item objects
 */
export function load_actor_with_items(
    slot: number,
    actor_id: string
): { ok: true; actor: Record<string, unknown> } | { ok: false; error: string } {
    try {
        const actor_path = get_actor_path(slot, actor_id);
        
        if (!fs.existsSync(actor_path)) {
            return { ok: false, error: `actor_not_found: ${actor_id}` };
        }
        
        const actor = read_jsonc(actor_path);
        
        // Ensure body_slots exists
        if (!actor.body_slots) {
            actor.body_slots = {};
        }
        
        debug_log("inline_items", `Loaded actor ${actor_id} with inline items`);
        
        return { ok: true, actor };
    } catch (err) {
        debug_error("inline_items", `Failed to load actor ${actor_id}`, err);
        return { ok: false, error: `load_failed: ${String(err)}` };
    }
}

/**
 * Save actor with inline items atomically
 * All items in body_slots are saved together
 */
export function save_actor_with_items(
    slot: number,
    actor_id: string,
    actor: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
    try {
        const actor_path = get_actor_path(slot, actor_id);
        write_jsonc(actor_path, actor);
        debug_log("inline_items", `Saved actor ${actor_id} with inline items`);
        return { ok: true };
    } catch (err) {
        debug_error("inline_items", `Failed to save actor ${actor_id}`, err);
        return { ok: false, error: `save_failed: ${String(err)}` };
    }
}

/**
 * Get all items from an actor's body_slots
 * Returns flattened list with paths for easy iteration
 */
export function get_all_actor_items(
    actor: Record<string, unknown>
): Array<{
    item: InlineItem;
    path: string;
    slot_name: string;
    slot_type: 'armor' | 'garb' | 'tool';
}> {
    const items: Array<{
        item: InlineItem;
        path: string;
        slot_name: string;
        slot_type: 'armor' | 'garb' | 'tool';
    }> = [];
    
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    if (!body_slots) return items;
    
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        if (slot.armor) {
            items.push({
                item: slot.armor,
                path: `${slot_name}.armor`,
                slot_name,
                slot_type: 'armor'
            });
        }
        
        if (slot.tool) {
            items.push({
                item: slot.tool,
                path: `${slot_name}.tool`,
                slot_name,
                slot_type: 'tool'
            });
        }
        
        slot.garb.forEach((item, index) => {
            items.push({
                item,
                path: `${slot_name}.garb.${index}`,
                slot_name,
                slot_type: 'garb'
            });
        });
    }
    
    return items;
}

/**
 * Find an item in actor's body_slots by ID
 * Searches recursively through container contents
 */
export function find_actor_item_by_id(
    actor: Record<string, unknown>,
    item_id: string
): { item: InlineItem; path: string } | null {
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    if (!body_slots) return null;
    
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        // Check armor
        if (slot.armor?.id === item_id) {
            return { item: slot.armor, path: `${slot_name}.armor` };
        }

        // Check armor contents
        if (slot.armor?.contents) {
            const found = find_item_in_contents(slot.armor.contents, item_id, `${slot_name}.armor.contents`);
            if (found) return found;
        }
        
        // Check tool
        if (slot.tool?.id === item_id) {
            return { item: slot.tool, path: `${slot_name}.tool` };
        }

        // Check tool contents
        if (slot.tool?.contents) {
            const found = find_item_in_contents(slot.tool.contents, item_id, `${slot_name}.tool.contents`);
            if (found) return found;
        }
        
        // Check garb (including nested containers)
        for (let i = 0; i < slot.garb.length; i++) {
            const garb_item = slot.garb[i]!;
            if (garb_item.id === item_id) {
                return { item: garb_item, path: `${slot_name}.garb.${i}` };
            }
            
            if (garb_item.contents) {
                const found = find_item_in_contents(garb_item.contents, item_id, `${slot_name}.garb.${i}.contents`);
                if (found) return found;
            }
        }
    }
    
    return null;
}

/**
 * Remove an item from actor by id, searching recursively through all containers.
 * Returns removed item + a best-effort path for debugging.
 */
export function remove_actor_item_by_id(
    actor: Record<string, unknown>,
    item_id: string
): { ok: true; item: InlineItem; path: string } | { ok: false; error: string } {
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    if (!body_slots) return { ok: false, error: 'no_body_slots' };

    // Search each slot
    for (const [slot_name, slot] of Object.entries(body_slots)) {
        // Direct armor/tool
        if (slot.armor?.id === item_id) {
            const it = slot.armor;
            slot.armor = null;
            return { ok: true, item: it, path: `${slot_name}.armor` };
        }

        if (slot.tool?.id === item_id) {
            const it = slot.tool;
            slot.tool = null;
            return { ok: true, item: it, path: `${slot_name}.tool` };
        }

        // Garb direct
        for (let i = 0; i < slot.garb.length; i++) {
            const it = slot.garb[i]!;
            if (it.id === item_id) {
                slot.garb.splice(i, 1);
                return { ok: true, item: it, path: `${slot_name}.garb.${i}` };
            }
        }

        // Armor/tool contents
        if (slot.armor?.contents) {
            const removed = remove_item_in_contents(slot.armor.contents, item_id, `${slot_name}.armor.contents`);
            if (removed) return { ok: true, item: removed.item, path: removed.path };
        }

        if (slot.tool?.contents) {
            const removed = remove_item_in_contents(slot.tool.contents, item_id, `${slot_name}.tool.contents`);
            if (removed) return { ok: true, item: removed.item, path: removed.path };
        }

        // Garb contents
        for (let i = 0; i < slot.garb.length; i++) {
            const g = slot.garb[i]!;
            if (g.contents) {
                const removed = remove_item_in_contents(g.contents, item_id, `${slot_name}.garb.${i}.contents`);
                if (removed) return { ok: true, item: removed.item, path: removed.path };
            }
        }
    }

    return { ok: false, error: 'item_not_found_on_actor' };
}

function remove_item_in_contents(
    contents: InlineItem[],
    item_id: string,
    base_path: string
): { item: InlineItem; path: string } | null {
    for (let i = 0; i < contents.length; i++) {
        const it = contents[i]!;
        if (it.id === item_id) {
            const [removed] = contents.splice(i, 1);
            return removed ? { item: removed, path: `${base_path}.${i}` } : null;
        }
        if (it.contents) {
            const found = remove_item_in_contents(it.contents, item_id, `${base_path}.${i}.contents`);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Deep search within container contents
 */
function find_item_in_contents(
    contents: InlineItem[],
    item_id: string,
    base_path: string
): { item: InlineItem; path: string } | null {
    for (let i = 0; i < contents.length; i++) {
        const item = contents[i]!;
        if (item.id === item_id) {
            return { item, path: `${base_path}.${i}` };
        }
        
        if (item.contents) {
            const found = find_item_in_contents(item.contents, item_id, `${base_path}.${i}.contents`);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Add an item to a body slot
 * Creates the slot if it doesn't exist
 */
export function add_item_to_body_slot(
    actor: Record<string, unknown>,
    slot_name: string,
    slot_type: 'armor' | 'garb' | 'tool',
    item: InlineItem
): { ok: true; path: string } | { ok: false; error: string } {
    if (!actor.body_slots) {
        actor.body_slots = {};
    }
    
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    
    if (!body_slots[slot_name]) {
        body_slots[slot_name] = {
            name: slot_name,
            critical: false,
            armor: null,
            garb: [],
            tool: null
        };
    }
    
    const slot = body_slots[slot_name]!;
    
    if (slot_type === 'armor') {
        if (slot.armor) {
            return { ok: false, error: 'armor_slot_occupied' };
        }
        slot.armor = item;
        return { ok: true, path: `${slot_name}.armor` };
    }
    
    if (slot_type === 'tool') {
        if (slot.tool) {
            return { ok: false, error: 'tool_slot_occupied' };
        }
        slot.tool = item;
        return { ok: true, path: `${slot_name}.tool` };
    }
    
    if (slot_type === 'garb') {
        slot.garb.push(item);
        const index = slot.garb.length - 1;
        return { ok: true, path: `${slot_name}.garb.${index}` };
    }
    
    return { ok: false, error: 'invalid_slot_type' };
}

/**
 * Remove an item from a body slot by path
 * Path format: "slot_name.slot_type.index" (e.g., "leg_left.garb.0")
 */
export function remove_item_by_path(
    actor: Record<string, unknown>,
    item_path: string
): { ok: true; item: InlineItem } | { ok: false; error: string } {
    const parts = item_path.split('.');
    if (parts.length < 2) {
        return { ok: false, error: 'invalid_path' };
    }
    
    const slot_name = parts[0]!;
    const slot_type = parts[1] as 'armor' | 'garb' | 'tool';
    
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    const slot = body_slots?.[slot_name];
    
    if (!slot) {
        return { ok: false, error: 'slot_not_found' };
    }
    
    if (slot_type === 'armor') {
        if (!slot.armor) {
            return { ok: false, error: 'armor_slot_empty' };
        }
        const item = slot.armor;
        slot.armor = null;
        return { ok: true, item };
    }
    
    if (slot_type === 'tool') {
        if (!slot.tool) {
            return { ok: false, error: 'tool_slot_empty' };
        }
        const item = slot.tool;
        slot.tool = null;
        return { ok: true, item };
    }
    
    if (slot_type === 'garb') {
        const index = parseInt(parts[2] ?? '0', 10);
        if (isNaN(index) || index < 0 || index >= slot.garb.length) {
            return { ok: false, error: 'invalid_garb_index' };
        }
        const [item] = slot.garb.splice(index, 1);
        if (!item) {
            return { ok: false, error: 'item_not_found' };
        }
        return { ok: true, item };
    }
    
    return { ok: false, error: 'invalid_slot_type' };
}

/**
 * Transfer item between body slots
 * Handles moving items within the same actor's body_slots
 */
export function transfer_item_between_slots(
    actor: Record<string, unknown>,
    from_path: string,
    to_slot: string,
    to_slot_type: 'armor' | 'garb' | 'tool'
): { ok: true; to_path: string } | { ok: false; error: string } {
    // Remove from source
    const remove_result = remove_item_by_path(actor, from_path);
    if (!remove_result.ok) {
        return remove_result;
    }
    
    // Add to destination
    const add_result = add_item_to_body_slot(actor, to_slot, to_slot_type, remove_result.item);
    if (!add_result.ok) {
        // Rollback: put item back
        add_item_to_body_slot(
            actor,
            from_path.split('.')[0]!,
            from_path.split('.')[1] as 'armor' | 'garb' | 'tool',
            remove_result.item
        );
        return add_result;
    }
    
    debug_log("inline_items", `Transferred item from ${from_path} to ${add_result.path}`);
    return { ok: true, to_path: add_result.path };
}

/**
 * Add item to container within body_slots
 * Path points to a container item (e.g., "leg_left.garb.0")
 */
export function add_item_to_container(
    actor: Record<string, unknown>,
    container_path: string,
    item: InlineItem
): { ok: true; item_path: string } | { ok: false; error: string } {
    const parts = container_path.split('.');
    const slot_name = parts[0]!;
    const slot_type = parts[1] as 'garb';  // Only garb can have containers
    const index = parseInt(parts[2] ?? '0', 10);
    
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    const slot = body_slots?.[slot_name];
    
    if (!slot || slot_type !== 'garb') {
        return { ok: false, error: 'container_not_found' };
    }
    
    const container_item = slot.garb[index];
    if (!container_item) {
        return { ok: false, error: 'container_not_found' };
    }
    
    // Check if it's a container
    const has_container_tag = container_item.tags.some(tag => tag.name === 'CONTAINER');
    if (!has_container_tag) {
        return { ok: false, error: 'not_a_container' };
    }
    
    // Initialize contents if needed
    if (!container_item.contents) {
        container_item.contents = [];
    }
    
    // Check capacity
    const max_slots = container_item.container_capacity?.max_slots;
    if (max_slots && container_item.contents.length >= max_slots) {
        return { ok: false, error: 'container_full' };
    }
    
    // Add item
    container_item.contents.push(item);
    const item_index = container_item.contents.length - 1;
    
    debug_log("inline_items", `Added item ${item.id} to container ${container_path}`);
    return { ok: true, item_path: `${container_path}.contents.${item_index}` };
}

/**
 * Remove item from container within body_slots
 */
export function remove_item_from_container(
    actor: Record<string, unknown>,
    item_path: string  // Format: "slot.garb.index.contents.child_index"
): { ok: true; item: InlineItem } | { ok: false; error: string } {
    const parts = item_path.split('.');
    if (parts.length < 4 || parts[3] !== 'contents') {
        return { ok: false, error: 'invalid_container_path' };
    }
    
    const slot_name = parts[0]!;
    const garb_index = parseInt(parts[2] ?? '0', 10);
    const child_index = parseInt(parts[4] ?? '0', 10);
    
    const body_slots = actor.body_slots as Record<string, InlineBodySlot>;
    const slot = body_slots?.[slot_name];
    
    if (!slot) {
        return { ok: false, error: 'slot_not_found' };
    }
    
    const container = slot.garb[garb_index];
    if (!container || !container.contents) {
        return { ok: false, error: 'container_not_found' };
    }
    
    if (child_index < 0 || child_index >= container.contents.length) {
        return { ok: false, error: 'item_not_found_in_container' };
    }
    
    const [item] = container.contents.splice(child_index, 1);
    if (!item) {
        return { ok: false, error: 'item_not_found' };
    }
    
    debug_log("inline_items", `Removed item ${item.id} from container`);
    return { ok: true, item };
}

/**
 * Calculate total weight of all items actor is carrying
 */
export function calculate_actor_carry_weight(actor: Record<string, unknown>): number {
    let total = 0;
    
    const items = get_all_actor_items(actor);
    for (const { item } of items) {
        total += calculate_item_weight(item);
    }
    
    return total;
}

/**
 * Calculate weight of item including contents
 */
function calculate_item_weight(item: InlineItem): number {
    const base_weight = item.weight * item.qty;
    
    if (item.contents && item.contents.length > 0) {
        const contents_weight = item.contents.reduce((sum, child) => 
            sum + calculate_item_weight(child), 0
        );
        return base_weight + contents_weight;
    }
    
    return base_weight;
}

/**
 * Generate a unique item ID
 */
export function generate_item_id(): string {
    return randomUUID();
}

/**
 * Create a new inline item from definition
 */
export function create_inline_item(
    def_id: string,
    name: string,
    weight: number,
    qty: number = 1,
    tags: TagInstance[] = [],
    container_capacity?: { max_slots?: number; max_weight?: number }
): InlineItem {
    const item: InlineItem = {
        id: generate_item_id(),
        def_id,
        name,
        qty,
        weight,
        tags
    };
    
    if (container_capacity) {
        item.container_capacity = container_capacity;
        // Ensure CONTAINER tag exists
        if (!item.tags.some(tag => tag.name === 'CONTAINER')) {
            item.tags.push({ name: 'CONTAINER', mag: 1, meta: [] });
        }
    }
    
    return item;
}

/**
 * Find first container in actor's body_slots (for adding items)
 * Usually the sack on leg_left
 */
export function find_first_container(
    actor: Record<string, unknown>
): { item: InlineItem; path: string } | null {
    const items = get_all_actor_items(actor);
    
    for (const { item, path } of items) {
        const has_container_tag = item.tags.some(tag => tag.name === 'CONTAINER');
        if (has_container_tag) {
            return { item, path };
        }
    }
    
    return null;
}

/**
 * Find or create default sack for actor
 * Adds a small_sack to leg_left if no container exists
 */
export function ensure_actor_has_sack(
    actor: Record<string, unknown>
): { ok: true; sack_path: string } | { ok: false; error: string } {
    // First check if there's already a container
    const existing = find_first_container(actor);
    if (existing) {
        return { ok: true, sack_path: existing.path };
    }
    
    // Create default sack
    const sack = create_inline_item(
        'small_sack',
        'Small Sack',
        0.5,
        1,
        [{ name: 'CONTAINER', mag: 1, meta: [] }, { name: 'GARB', mag: 1, meta: [] }],
        { max_slots: 10, max_weight: 50 }
    );
    
    // Add to leg_left garb
    const result = add_item_to_body_slot(actor, 'leg_left', 'garb', sack);
    if (!result.ok) {
        // Try other slots
        for (const slot of ['leg_right', 'torso']) {
            const retry = add_item_to_body_slot(actor, slot, 'garb', sack);
            if (retry.ok) {
                return { ok: true, sack_path: retry.path };
            }
        }
        return { ok: false, error: 'no_space_for_sack' };
    }
    
    return { ok: true, sack_path: result.path };
}

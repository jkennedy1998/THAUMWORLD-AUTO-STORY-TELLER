import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_container_dir, get_container_path } from "../engine/paths.js";
import type { TagInstance } from "../tag_system/registry.js";
import type { ItemInstance } from "../item_instances/store.js";
import { debug_error, debug_log, debug_warn } from "../shared/debug.js";
import { calculate_grid_dimensions } from "../types/container.js";
import type { ContainerPosition, Container, ContainerContentEntry } from "../types/container.js";
import { ensure_grid_coordinates_recursive } from "../shared/migration.js";

// Re-export Container for backward compatibility
export type { Container };

export type ContainerLookupResult =
    | { ok: true; container: Container; path: string }
    | { ok: false; error: string; todo: string };

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

/**
 * Build container ID from components
 */
export function build_container_id(
    owner_type: "actor" | "npc" | "item" | "place",
    owner_id: string,
    name: string
): string {
    return `container.${owner_id}.${name}`;
}

/**
 * Build ground container ID for a place
 */
export function build_ground_container_id(place_id: string): string {
    return `container.place.${place_id}.ground`;
}

/**
 * Parse container ID to extract owner info
 */
export function parse_container_id(container_id: string): {
    owner_type: "actor" | "npc" | "item" | "place" | null;
    owner_id: string;
    name: string;
} {
    const parts = container_id.split(".");
    if (parts.length < 3 || parts[0] !== "container") {
        return { owner_type: null, owner_id: "", name: container_id };
    }
    
    // Handle place containers: container.place.<place_id>.ground
    if (parts[1] === "place" && parts.length >= 3) {
        const place_id = parts[2];
        const name = parts.slice(3).join(".") || "ground";
        return { owner_type: "place", owner_id: place_id ?? "", name };
    }
    
    const owner_id = parts[1];
    const name = parts.slice(2).join(".");
    
    // Try to determine owner type by checking which entity files exist
    const base_dir = `local_data/data_slot_${1}`; // Default to slot 1 for type detection
    
    if (fs.existsSync(path.join(base_dir, "actors", `${owner_id}.jsonc`))) {
        return { owner_type: "actor", owner_id: owner_id ?? "", name };
    } else if (fs.existsSync(path.join(base_dir, "npcs", `${owner_id}.jsonc`))) {
        return { owner_type: "npc", owner_id: owner_id ?? "", name };
    }
    
    // Fallback: return null owner_type - will fail gracefully
    return { owner_type: null, owner_id: owner_id ?? "", name };
}

export function ensure_container_dir(slot: number): string {
    const dir = get_container_dir(slot);
    ensure_dir_exists(dir);
    return dir;
}

export function create_container(
    slot: number,
    owner_ref: string,
    name: string,
    kind: Container["kind"],
    capacity?: Container["capacity"]
): ContainerLookupResult {
    const owner_id = owner_ref.replace(/^(actor|npc|place)\./, "");
    const container_id = build_container_id(kind, owner_id, name);

    const slot_count = capacity?.max_slots ?? 5;
    const container: Container = {
        id: container_id,
        kind,
        owner_ref,
        interaction_range: 1,
        capacity,
        contents: [],
        tags: [],
        is_open: true,
        is_locked: false,
    };

    const path = save_container(slot, container);
    return { ok: true, container, path };
}

export function load_container(slot: number, container_id: string): ContainerLookupResult {
    // Load from entity.containers (entity-centric storage only)
    const entity_container = load_container_from_entity(slot, container_id);
    if (entity_container.ok) {
        return entity_container;
    }

    // Container not found in entity
    return { 
        ok: false, 
        error: entity_container.error, 
        todo: `Verify entity has containers field with ${container_id}` 
    };
}

/**
 * Load container from entity.containers (entity-centric storage)
 */
function load_container_from_entity(slot: number, container_id: string): ContainerLookupResult {
    const parsed = parse_container_id(container_id);
    if (!parsed) {
        return { ok: false, error: "invalid_container_id", todo: "Check container ID format" };
    }

    const base_dir = `local_data/data_slot_${slot}`;
    let entity_path: string;
    let entity: any;

    // Determine entity file path based on owner type
    if (parsed.owner_type === "npc") {
        entity_path = path.join(base_dir, "npcs", `${parsed.owner_id}.jsonc`);
    } else if (parsed.owner_type === "actor") {
        entity_path = path.join(base_dir, "actors", `${parsed.owner_id}.jsonc`);
    } else if (parsed.owner_type === "place") {
        entity_path = path.join(base_dir, "places", `${parsed.owner_id}.jsonc`);
    } else {
        return { ok: false, error: "unknown_owner_type", todo: "Check container owner_ref" };
    }

    if (!fs.existsSync(entity_path)) {
        return { ok: false, error: "entity_not_found", todo: `Entity file not found: ${entity_path}` };
    }

    entity = read_jsonc(entity_path);
    if (!entity || !entity.containers) {
        return { ok: false, error: "no_containers_field", todo: "Entity has no containers field" };
    }

    const container_name = get_container_name_from_id(container_id);
    const container = entity.containers[container_name];

    if (!container) {
        return { ok: false, error: "container_not_in_entity", todo: `Container ${container_name} not found in entity` };
    }

    // MIGRATION: Ensure all items have grid coordinates
    const max_slots = container.capacity?.max_slots || container.contents.length || 10;
    debug_log("MIGRATION", `=== Starting migration for container: ${container_id} ===`);
    debug_log("MIGRATION", `Container has ${container.contents.length} items, max_slots: ${max_slots}`);
    
    // Log first few items BEFORE migration
    container.contents.slice(0, 3).forEach((entry: ContainerContentEntry, idx: number) => {
        debug_log("MIGRATION", `BEFORE MIGRATION - Item ${idx}: ${entry.instance.def_id}, grid_x: ${entry.grid_x}, grid_y: ${entry.grid_y}`);
    });
    
    const migrated_count = ensure_grid_coordinates_recursive(container.contents, container_id, max_slots);
    
    // Log first few items AFTER migration
    container.contents.slice(0, 3).forEach((entry: ContainerContentEntry, idx: number) => {
        debug_log("MIGRATION", `AFTER MIGRATION - Item ${idx}: ${entry.instance.def_id}, grid_x: ${entry.grid_x}, grid_y: ${entry.grid_y}`);
    });
    
    // CRITICAL FIX: Save container if migration made changes
    if (migrated_count > 0) {
        debug_log("MIGRATION", `Migration assigned coordinates to ${migrated_count} items. SAVING container...`);
        const save_result = save_container(slot, container);
        if (save_result) {
            debug_log("MIGRATION", `✅ Successfully saved container ${container_id} with ${migrated_count} migrated coordinates`);
            
            // VERIFICATION: Reload and check if coordinates persisted
            const verify_result = load_container_from_entity(slot, container_id);
            if (verify_result.ok) {
                const all_have_coords = verify_result.container.contents.every(e => e.grid_x !== undefined && e.grid_y !== undefined);
                debug_log("MIGRATION", `✅ VERIFICATION: All items have coordinates after save: ${all_have_coords}`);
                if (!all_have_coords) {
                    debug_error("MIGRATION", `❌ VERIFICATION FAILED: Some items missing coordinates after save!`);
                }
            }
        } else {
            debug_error("MIGRATION", `❌ FAILED to save container ${container_id} after migration!`);
        }
    } else {
        debug_log("MIGRATION", `No items needed migration (all already have coordinates)`);
    }
    
    debug_log("MIGRATION", `=== Migration complete for container: ${container_id} ===`);

    return { ok: true, container, path: entity_path };
}

/**
 * Get container name from container ID
 * e.g., "container.gunther.leg_left" -> "leg_left"
 */
function get_container_name_from_id(container_id: string): string {
    const parts = container_id.split(".");
    return parts[parts.length - 1] || "unknown";
}

/**
 * Save container to entity.containers (entity-centric storage)
 * This ensures containers persist within entity files
 */
function save_container_to_entity(slot: number, container: Container): { ok: boolean; error?: string } {
    const parsed = parse_container_id(container.id);
    if (!parsed.owner_type) {
        return { ok: false, error: "Cannot determine entity type from container ID" };
    }

    const base_dir = `local_data/data_slot_${slot}`;
    let entity_path: string;

    // Determine entity file path based on owner type
    if (parsed.owner_type === "npc") {
        entity_path = path.join(base_dir, "npcs", `${parsed.owner_id}.jsonc`);
    } else if (parsed.owner_type === "actor") {
        entity_path = path.join(base_dir, "actors", `${parsed.owner_id}.jsonc`);
    } else if (parsed.owner_type === "place") {
        entity_path = path.join(base_dir, "places", `${parsed.owner_id}.jsonc`);
    } else {
        return { ok: false, error: `Unsupported owner type: ${parsed.owner_type}` };
    }

    if (!fs.existsSync(entity_path)) {
        return { ok: false, error: `Entity file not found: ${entity_path}` };
    }

    try {
        // Read current entity
        const entity = read_jsonc(entity_path) as Record<string, any>;
        
        // Initialize containers field if not exists
        if (!entity.containers) {
            entity.containers = {};
        }

        // Update the specific container
        const container_name = get_container_name_from_id(container.id);
        entity.containers[container_name] = container;

        // Write back to file
        fs.writeFileSync(entity_path, JSON.stringify(entity, null, 2), "utf-8");
        
        return { ok: true };
    } catch (err) {
        const error_msg = err instanceof Error ? err.message : String(err);
        debug_error("Container", `Failed to save container to entity: ${error_msg}`);
        return { ok: false, error: `Failed to save container to entity: ${error_msg}` };
    }
}

export function ensure_container(
    slot: number,
    container_id: string,
    defaults: Partial<Container> = {}
): ContainerLookupResult {
    const existing = load_container(slot, container_id);
    if (existing.ok) return existing;
    
    // Parse owner from container ID
    const parsed = parse_container_id(container_id);
    
    const slot_count = defaults.capacity?.max_slots ?? 5;
    const container: Container = {
        id: container_id,
        kind: defaults.kind ?? "actor",
        owner_ref: defaults.owner_ref ?? `actor.${parsed.owner_id}`,
        interaction_range: defaults.interaction_range ?? 1,
        capacity: defaults.capacity,
        contents: [],
        tags: defaults.tags ?? [],
        is_open: defaults.is_open ?? true,
        is_locked: defaults.is_locked ?? false,
    };
    
    const path = save_container(slot, container);
    return { ok: true, container, path };
}

export function save_container(slot: number, container: Container): string {
    // Save to entity.containers only (entity-centric storage)
    // Container files are deprecated - all containers stored inline in entities
    const entity_save = save_container_to_entity(slot, container);
    if (!entity_save.ok) {
        debug_error("Container", `Failed to save container ${container.id}: ${entity_save.error}`);
        return "";
    }
    
    return container.id;
}

export function delete_container(slot: number, container_id: string): boolean {
    const container_path = get_container_path(slot, container_id);
    if (fs.existsSync(container_path)) {
        fs.unlinkSync(container_path);
        return true;
    }
    return false;
}

export function list_containers_for_owner(slot: number, owner_ref: string): Container[] {
    // Parse owner_ref to determine entity type and ID
    // Format: "actor.<id>", "npc.<id>", or "place.<id>"
    const parts = owner_ref.split(".");
    if (parts.length < 2) return [];
    
    const entity_type = parts[0];
    const entity_id = parts[1];
    
    const base_dir = `local_data/data_slot_${slot}`;
    let entity_path: string;
    
    // Determine entity file path
    if (entity_type === "npc") {
        entity_path = path.join(base_dir, "npcs", `${entity_id}.jsonc`);
    } else if (entity_type === "actor") {
        entity_path = path.join(base_dir, "actors", `${entity_id}.jsonc`);
    } else if (entity_type === "place") {
        entity_path = path.join(base_dir, "places", `${entity_id}.jsonc`);
    } else {
        return [];
    }
    
    if (!fs.existsSync(entity_path)) {
        return [];
    }
    
    try {
        const entity = read_jsonc(entity_path) as Record<string, any>;
        if (!entity.containers) {
            return [];
        }
        
        // Return all containers from entity.containers
        return Object.values(entity.containers) as Container[];
    } catch (err) {
        debug_error("Container", `Failed to list containers for ${owner_ref}: ${err}`);
        return [];
    }
}

export function get_container_contents(
    slot: number,
    container_id: string
): { instance: ItemInstance; definition: any; error?: string }[] {
    const result = load_container(slot, container_id);
    if (!result.ok) return [];
    
    // Contents are now in wrapped format {instance, definition}
    return result.container.contents.map(entry => ({ 
        instance: entry.instance,
        definition: entry.definition
    }));
}

/**
 * Calculate total weight of an item including its contents
 * For items with container_data, includes weight of nested items
 */
export function calculate_item_weight(item: ItemInstance): number {
    let weight = item.qty || 1;
    
    // Add weight of items inside this item (if it's a container)
    if (item.container_data?.contents) {
        for (const nested_entry of item.container_data.contents) {
            weight += calculate_item_weight(nested_entry.instance);
        }
    }
    
    return weight;
}

/**
 * Calculate total weight of a container content entry
 */
export function calculate_entry_weight(entry: { instance: ItemInstance; definition: any }): number {
    return calculate_item_weight(entry.instance);
}

/**
 * Check if two items can be stacked together
 * Requirements:
 * - Same def_id
 * - Both have stackable flag
 * - Combined quantity <= max_stack_size
 * - Tags match
 */
function can_stack_items(
    source_entry: { instance: ItemInstance; definition: any; grid_x?: number; grid_y?: number },
    dest_entry: { instance: ItemInstance; definition: any; grid_x?: number; grid_y?: number }
): boolean {
    const item_a = source_entry.instance;
    const item_b = dest_entry.instance;
    const def_a = source_entry.definition;
    const def_b = dest_entry.definition;
    
    // Must be same def_id
    if (item_a.def_id !== item_b.def_id) {
        return false;
    }
    
    // Must be stackable
    if (!def_a.stackable || !def_b.stackable) {
        return false;
    }
    
    // Check max stack size
    const max_stack = def_a.max_stack_size || 1;
    const combined_qty = (item_a.qty || 1) + (item_b.qty || 1);
    if (combined_qty > max_stack) {
        return false;
    }
    
    // Check tags match (simple comparison)
    const tags_a = item_a.tags || [];
    const tags_b = item_b.tags || [];
    if (tags_a.length !== tags_b.length) {
        return false;
    }
    
    // TODO: Deep tag comparison if needed
    
    return true;
}

/**
 * Check if a container ID represents a body slot container
 * Body slot containers follow pattern: container.{actor_id}.{slot_name}
 * where slot_name is one of the body slots
 */
function is_body_slot_container(container_id: string): boolean {
    const body_slots = ['head', 'torso', 'hand_left', 'hand_right', 'leg_left', 'leg_right'];
    const parts = container_id.split('.');
    if (parts.length < 3 || parts[0] !== 'container') {
        return false;
    }
    const slot_name = parts[parts.length - 1]!;
    return body_slots.includes(slot_name);
}

/**
 * Extract slot name from container ID
 * e.g., "container.henry_actor.torso" -> "torso"
 */
function get_slot_name(container_id: string): string {
    const parts = container_id.split('.');
    return parts[parts.length - 1] || '';
}

/**
 * Check if two items can be swapped between slots
 * Requirements:
 * - Item A fits in Slot B (via valid_body_slots)
 * - Item B fits in Slot A (via valid_body_slots)
 */
function can_swap_items(
    source_entry: { instance: ItemInstance; definition: any },
    target_entry: { instance: ItemInstance; definition: any },
    source_slot: string,
    target_slot: string
): boolean {
    const source_def = source_entry.definition;
    const target_def = target_entry.definition;
    
    // Check if source item fits in target slot
    const source_fits_target = source_def.valid_body_slots?.includes(target_slot) ?? false;
    
    // Check if target item fits in source slot
    const target_fits_source = target_def.valid_body_slots?.includes(source_slot) ?? false;
    
    const can_swap = source_fits_target && target_fits_source;
    
    if (can_swap) {
        debug_log("transfer", `Can swap: ${source_def.id} (${source_slot}) <-> ${target_def.id} (${target_slot})`);
    } else {
        debug_log("transfer", `Cannot swap: ${source_def.id} fits ${target_slot}? ${source_fits_target}, ${target_def.id} fits ${source_slot}? ${target_fits_source}`);
    }
    
    return can_swap;
}

/**
 * Check if an item is compatible with a body slot
 */
function is_item_compatible_with_slot(
    item_entry: { instance: ItemInstance; definition: any },
    slot_name: string
): boolean {
    const def = item_entry.definition;
    return def.valid_body_slots?.includes(slot_name) ?? false;
}

export function add_item_to_container(
    slot: number,
    container_id: string,
    entry: ContainerContentEntry
): ContainerLookupResult {
    const result = load_container(slot, container_id);
    if (!result.ok) return result;

    // Check if already in container (by instance id)
    const exists = result.container.contents.some(
        existing => existing.instance.id === entry.instance.id
    );

    if (exists) {
        return { ok: true, container: result.container, path: result.path };
    }

    // Check capacity constraints
    const container = result.container;
    const current_slots = container.contents.length;
    const capacity = container.capacity;

    if (capacity) {
        // Check max slots
        if (capacity.max_slots !== undefined) {
            if (current_slots >= capacity.max_slots) {
                debug_error("Container", `Container ${container_id} is overfull: ${current_slots}/${capacity.max_slots} slots, attempting to add ${entry.instance.id}`);
                return { ok: false, error: `Container ${container_id} is full (${current_slots}/${capacity.max_slots} slots)`, todo: "Transfer to container with more capacity" };
            }
        }

        // Check max weight (includes nested items if item has container_data)
        if (capacity.max_weight !== undefined) {
            const current_weight = container.contents.reduce((total, existing) => {
                return total + calculate_item_weight(existing.instance);
            }, 0);

            const item_weight = calculate_item_weight(entry.instance);
            if (current_weight + item_weight > capacity.max_weight) {
                debug_error("Container", `Container ${container_id} would exceed weight limit: ${current_weight}/${capacity.max_weight}, adding ${item_weight} (including contents)`);
                return { ok: false, error: `Container ${container_id} would exceed weight limit (${current_weight + item_weight}/${capacity.max_weight})`, todo: "Transfer to container with more weight capacity" };
            }
        }
    }

    // Add item entry to container
    container.contents.push(entry);
    save_container(slot, container);

    return { ok: true, container: container, path: result.path };
}

export function remove_item_from_container(
    slot: number,
    container_id: string,
    item_instance_id: string
): ContainerLookupResult {
    const result = load_container(slot, container_id);
    if (!result.ok) return result;

    result.container.contents = result.container.contents.filter(
        entry => entry.instance.id !== item_instance_id
    );

    save_container(slot, result.container);
    return { ok: true, container: result.container, path: result.path };
}

export function calculate_container_weight(
    slot: number,
    container_id: string
): { weight: number; error?: string } {
    const contents = get_container_contents(slot, container_id);
    let total_weight = 0;
    
    for (const { instance, error } of contents) {
        if (error) continue;
        // Note: This would need item def lookup to get actual weight
        // For now, just count instances
        total_weight += instance.qty || 1;
    }
    
    return { weight: total_weight };
}

export function transfer_item_between_containers(
    slot: number,
    item_instance_id: string,
    from_container_id: string,
    to_container_id: string,
    target_grid_x: number,
    target_grid_y: number,
    from_slot_index?: number,
    to_slot_index?: number
): { ok: boolean; error?: string } {
    debug_log("transfer", "[UNIFIED-TRANSFER] === START ===");
    debug_log("transfer", "[UNIFIED-TRANSFER] Transferring: " + item_instance_id);
    debug_log("transfer", "[UNIFIED-TRANSFER] From: " + from_container_id + " To: " + to_container_id);
    debug_log("transfer", "[UNIFIED-TRANSFER] Target position: grid(" + target_grid_x + "," + target_grid_y + ")");
    
    // Check for same-container transfer
    const is_same_container = from_container_id === to_container_id;
    
    if (is_same_container) {
        // Same container - only reject if dropping on the exact same grid position
        if (from_slot_index !== undefined && to_slot_index !== undefined && from_slot_index === to_slot_index) {
            debug_log("transfer", "[UNIFIED-TRANSFER] FAILED: Cannot drop item on the same slot");
            return { ok: false, error: "Cannot drop item on the same slot" };
        }
        // Otherwise allow the reorder/move operation
        debug_log("transfer", "[UNIFIED-TRANSFER] Same-container transfer to grid(" + target_grid_x + "," + target_grid_y + ")");
    }
    
    // Handle nested container source (item.{instance_id})
    let from_item_entry: { instance: ItemInstance; definition: any } | null = null;
    let from_parent_container: Container | null = null;
    let from_parent_container_id: string | null = null;
    
    if (from_container_id.startsWith("item.")) {
        const nested_item_id = from_container_id.slice(5); // Remove 'item.' prefix
        debug_log("transfer", `Source is nested container: ${nested_item_id}`);
        const found = find_item_and_parent_container(slot, nested_item_id);
        if (!found || !found.item.instance.container_data) {
            debug_error("transfer", `Nested container item ${nested_item_id} not found or has no container_data`);
            return { ok: false, error: `Nested container item ${nested_item_id} not found or has no container_data` };
        }
        from_item_entry = found.item;
        from_parent_container = found.parent_container;
        from_parent_container_id = found.container_id;
        debug_log("transfer", `Found nested item in parent container: ${from_parent_container_id}`);
    }
    
    // Handle nested container destination (item.{instance_id})
    let to_item_entry: { instance: ItemInstance; definition: any } | null = null;
    let to_parent_container: Container | null = null;
    let to_parent_container_id: string | null = null;
    
    if (to_container_id.startsWith("item.")) {
        const nested_item_id = to_container_id.slice(5); // Remove 'item.' prefix
        debug_log("transfer", `Destination is nested container: ${nested_item_id}`);
        const found = find_item_and_parent_container(slot, nested_item_id);
        if (!found || !found.item.instance.container_data) {
            debug_error("transfer", `Nested container item ${nested_item_id} not found or has no container_data`);
            return { ok: false, error: `Nested container item ${nested_item_id} not found or has no container_data` };
        }
        to_item_entry = found.item;
        to_parent_container = found.parent_container;
        to_parent_container_id = found.container_id;
        debug_log("transfer", `Found destination nested item in parent container: ${to_parent_container_id}`);
    }

    // Load source container (or use nested container data)
    let source_contents: { instance: ItemInstance; definition: any; grid_x?: number; grid_y?: number }[];
    let source_container_to_save: Container | null = null;
    
    if (from_item_entry && from_item_entry.instance.container_data) {
        // Source is a nested container
        source_contents = from_item_entry.instance.container_data.contents;
        debug_log("transfer", `Using nested container contents, count: ${source_contents.length}`);
    } else {
        // Source is a regular container
        debug_log("transfer", `Loading regular source container: ${from_container_id}`);
        const from_result = load_container(slot, from_container_id);
        if (!from_result.ok) {
            debug_error("transfer", `Failed to load source container: ${from_result.error}`);
            return { ok: false, error: `Failed to load source container: ${from_result.error}` };
        }
        source_contents = from_result.container.contents;
        source_container_to_save = from_result.container;
        debug_log("transfer", `Loaded regular container, contents count: ${source_contents.length}`);
    }

    // Find the item in source
    const item_index = source_contents.findIndex(entry => entry.instance.id === item_instance_id);
    if (item_index === -1) {
        debug_error("transfer", `Item ${item_instance_id} not found in source container`);
        return { ok: false, error: `Item ${item_instance_id} not found in source container` };
    }

    // Get the item entry (index check above guarantees this exists)
    const item_entry = source_contents[item_index]!;
    debug_log("transfer", `Found item to transfer: ${item_entry.instance.def_id} (${item_entry.instance.id})`);

    // Load destination container (or use nested container data)
    // BUG FIX: For same-container transfers, don't load twice - use the same array
    let dest_contents: { instance: ItemInstance; definition: any; grid_x?: number; grid_y?: number }[];
    let dest_capacity: Container["capacity"] | undefined;
    let dest_container_to_save: Container | null = null;
    
    if (is_same_container && !to_item_entry) {
        // Same container transfer with regular container - use same array reference
        debug_log("transfer", `Same-container transfer - reusing source contents array`);
        dest_contents = source_contents;
        dest_capacity = source_container_to_save?.capacity;
        dest_container_to_save = null; // Don't save destination separately
    } else if (to_item_entry && to_item_entry.instance.container_data) {
        // Destination is a nested container
        dest_contents = to_item_entry.instance.container_data.contents;
        dest_capacity = to_item_entry.instance.container_data.capacity;
        debug_log("transfer", `Using nested destination container, current count: ${dest_contents.length}, capacity: ${dest_capacity?.max_slots}`);
    } else {
        // Destination is a regular container (different from source)
        debug_log("transfer", `Loading regular destination container: ${to_container_id}`);
        const to_result = load_container(slot, to_container_id);
        if (!to_result.ok) {
            debug_error("transfer", `Failed to load destination container: ${to_result.error}`);
            return { ok: false, error: `Failed to load destination container: ${to_result.error}` };
        }
        dest_contents = to_result.container.contents;
        dest_capacity = to_result.container.capacity;
        dest_container_to_save = to_result.container;
        debug_log("transfer", `Loaded regular destination container, current count: ${dest_contents.length}`);
    }

    // Check destination capacity (includes weight calculation for items with container_data)
    if (dest_capacity?.max_slots !== undefined) {
        if (dest_contents.length >= dest_capacity.max_slots) {
            debug_error("transfer", `Destination container ${to_container_id} is full (${dest_contents.length}/${dest_capacity.max_slots})`);
            return { ok: false, error: `Destination container ${to_container_id} is full` };
        }
    }

    // Check weight capacity if applicable
    if (dest_capacity?.max_weight !== undefined) {
        const current_weight = dest_contents.reduce((total, entry) => {
            return total + calculate_item_weight(entry.instance);
        }, 0);
        // Item is guaranteed to exist here (we found it above)
        const item_weight = calculate_item_weight(source_contents[item_index]!.instance);
        
        if (current_weight + item_weight > dest_capacity.max_weight) {
            debug_error("transfer", `Destination container ${to_container_id} would exceed weight limit (${current_weight + item_weight}/${dest_capacity.max_weight})`);
            return { ok: false, error: `Destination container ${to_container_id} would exceed weight limit (${current_weight + item_weight}/${dest_capacity.max_weight})` };
        }
    }

    // Check for stacking opportunity in destination
    let stacked = false;
    let target_stack_index = -1;
    const source_item_entry = source_contents[item_index]!;  // Already validated above
    
    for (let i = 0; i < dest_contents.length; i++) {
        if (can_stack_items(source_item_entry, dest_contents[i]!)) {
            target_stack_index = i;
            break;
        }
    }
    
    if (target_stack_index >= 0) {
        // Stack with existing item
        const source_entry = source_contents[item_index]!;
        const target_entry = dest_contents[target_stack_index]!;
        const combined_qty = (source_entry.instance.qty || 1) + (target_entry.instance.qty || 1);
        
        debug_log("transfer", `Stacking ${source_entry.instance.def_id}: ${source_entry.instance.qty || 1} + ${target_entry.instance.qty || 1} = ${combined_qty}`);
        
        // Update target quantity
        target_entry.instance.qty = combined_qty;
        
        // Remove from source
        source_contents.splice(item_index, 1);
        
        stacked = true;
        debug_log("transfer", `Stacked item. Source now has ${source_contents.length} items, dest has ${dest_contents.length} items`);
    } else if (dest_contents.length >= 1 && is_body_slot_container(from_container_id) && is_body_slot_container(to_container_id)) {
        // SWAP: Both are body slot containers and destination has at least 1 item
        debug_log("DEBUG-GRID", `Taking body slot swap branch (dest has items and both are body slots)`);
        // Check if we can swap the first item in destination
        const target_entry = dest_contents[0]!;
        const source_slot = get_slot_name(from_container_id);
        const target_slot = get_slot_name(to_container_id);
        
        // Check if items can swap (both fit in each other's slots)
        if (can_swap_items(source_item_entry, target_entry, source_slot, target_slot)) {
            debug_log("transfer", `Swapping items: ${source_item_entry.instance.def_id} <-> ${target_entry.instance.def_id}`);
            
            // Update container_id and owner_ref for both items
            source_item_entry.instance.container_id = to_container_id;
            target_entry.instance.container_id = from_container_id;
            
            // Swap the entries in the arrays
            source_contents[item_index] = target_entry;
            dest_contents[0] = source_item_entry;
            
            debug_log("transfer", `Swapped items between ${source_slot} and ${target_slot}`);
        } else {
            // Can't swap - reject the transfer to prevent item duplication
            debug_log("transfer", `Swap rejected: ${source_item_entry.instance.def_id} and ${target_entry.instance.def_id} are not compatible for swapping`);
            return { ok: false, error: `Cannot swap: ${source_item_entry.definition.name || source_item_entry.instance.def_id} and ${target_entry.definition.name || target_entry.instance.def_id} cannot be exchanged between ${source_slot} and ${target_slot}` };
        }
    } else if (is_same_container) {
        // SAME CONTAINER: Always use grid coordinates (unified system)
        debug_log("transfer", "[UNIFIED-TRANSFER] ENTERING SAME-CONTAINER BRANCH");
        debug_log("transfer", "[UNIFIED-TRANSFER] Item: " + source_item_entry.instance.def_id + " Target: grid(" + target_grid_x + "," + target_grid_y + ")");
        
        const contents = source_contents; // Both point to same array
        const source_entry = contents[item_index];
        
        if (!source_entry) {
            debug_error("transfer", "[UNIFIED-TRANSFER] FAILED: Source item not found at index " + item_index);
            return { ok: false, error: `Source item not found` };
        }
        
        debug_log("transfer", "[UNIFIED-TRANSFER] Found source item at index " + item_index + ": " + source_entry.instance.def_id + " at grid(" + source_entry.grid_x + "," + source_entry.grid_y + ")");
        
        // Find if there's already an item at the target grid position
        const target_entry_index = contents.findIndex(entry => 
            entry.grid_x === target_grid_x && entry.grid_y === target_grid_y
        );
        
        debug_log("transfer", "[UNIFIED-TRANSFER] Target position check: target_entry_index=" + target_entry_index);
        
        if (target_entry_index >= 0) {
            debug_log("transfer", "[UNIFIED-TRANSFER] TARGET OCCUPIED - entering swap/stack logic");
            // There's an item at the target position
            const target_entry = contents[target_entry_index]!;
            debug_log("transfer", "[UNIFIED-TRANSFER] Target item: " + target_entry.instance.def_id + " at grid(" + target_entry.grid_x + "," + target_entry.grid_y + ")");
            
            // Check if items can stack
            const can_stack = can_stack_items(source_entry, target_entry);
            debug_log("transfer", "[UNIFIED-TRANSFER] can_stack_items result: " + can_stack);
            
            if (can_stack) {
                debug_log("transfer", "[UNIFIED-TRANSFER] ATTEMPTING TO STACK");
                // Stack them together
                const combined_qty = (source_entry.instance.qty || 1) + (target_entry.instance.qty || 1);
                const max_stack = target_entry.definition.max_stack_size || 1;
                
                debug_log("transfer", "[UNIFIED-TRANSFER] Stack check: combined_qty=" + combined_qty + " max_stack=" + max_stack);
                
                if (combined_qty <= max_stack) {
                    // Merge quantities
                    target_entry.instance.qty = combined_qty;
                    contents.splice(item_index, 1);
                    debug_log("transfer", "[UNIFIED-TRANSFER] STACKED: " + source_entry.instance.def_id + " onto item at (" + target_grid_x + "," + target_grid_y + "): qty=" + combined_qty);
                } else {
                    // Would exceed max stack - can't stack
                    debug_log("transfer", "[UNIFIED-TRANSFER] STACK REJECTED: would exceed max stack size (" + max_stack + ")");
                    return { ok: false, error: `Cannot stack: would exceed max stack size (${max_stack})` };
                }
            } else {
                debug_log("transfer", "[UNIFIED-TRANSFER] CANNOT STACK - attempting SWAP");
                // Items can't stack - check if we can swap
                // For containers (not body slots), we can swap any items
                // For body slots, check valid_body_slots
                const is_body_slot = is_body_slot_container(from_container_id);
                debug_log("transfer", "[UNIFIED-TRANSFER] is_body_slot: " + is_body_slot);
                
                if (is_body_slot) {
                    const slot_name = get_slot_name(from_container_id);
                    const source_fits = source_entry.definition.valid_body_slots?.includes(slot_name) ?? false;
                    const target_fits = target_entry.definition.valid_body_slots?.includes(slot_name) ?? false;
                    
                    debug_log("transfer", "[UNIFIED-TRANSFER] Body slot check: slot_name=" + slot_name + " source_fits=" + source_fits + " target_fits=" + target_fits);
                    
                    if (!source_fits || !target_fits) {
                        debug_log("transfer", "[UNIFIED-TRANSFER] SWAP REJECTED: items not compatible with " + slot_name);
                        return { ok: false, error: `Cannot swap: items not compatible with ${slot_name}` };
                    }
                }
                
                // Swap positions
                debug_log("transfer", "[UNIFIED-TRANSFER] EXECUTING SWAP");
                const temp_grid_x = source_entry.grid_x;
                const temp_grid_y = source_entry.grid_y;
                
                source_entry.grid_x = target_entry.grid_x;
                source_entry.grid_y = target_entry.grid_y;
                target_entry.grid_x = temp_grid_x;
                target_entry.grid_y = temp_grid_y;
                
                debug_log("transfer", "[UNIFIED-TRANSFER] SWAPPED: " + source_entry.instance.def_id + " <-> " + target_entry.instance.def_id + " at grid(" + target_grid_x + "," + target_grid_y + ")");
            }
        } else {
            debug_log("transfer", "[UNIFIED-TRANSFER] TARGET EMPTY - moving item");
            // Target grid position is empty - move item there
            source_entry.grid_x = target_grid_x;
            source_entry.grid_y = target_grid_y;
            debug_log("transfer", "[UNIFIED-TRANSFER] MOVED TO EMPTY: " + source_entry.instance.def_id + " to grid(" + target_grid_x + "," + target_grid_y + ")");
        }
        
        debug_log("transfer", "[UNIFIED-TRANSFER] === SAME-CONTAINER SUCCESS ===");
        // Log final positions of all items in container
        debug_log("transfer", "[UNIFIED-TRANSFER] Final container state:");
        contents.forEach((entry: any, idx: number) => {
            debug_log("transfer", `[UNIFIED-TRANSFER]   [${idx}] ${entry.instance.def_id} at grid(${entry.grid_x},${entry.grid_y})`);
        });
    } else {
        // CROSS-CONTAINER TRANSFER: Move to destination with grid coordinates
        debug_log("transfer", "[UNIFIED-TRANSFER] ENTERING CROSS-CONTAINER BRANCH");
        debug_log("transfer", "[UNIFIED-TRANSFER] Source: " + from_container_id + " -> Dest: " + to_container_id);
        debug_log("transfer", "[UNIFIED-TRANSFER] Target grid: (" + target_grid_x + "," + target_grid_y + ")");
        debug_log("transfer", "[UNIFIED-TRANSFER] Dest is nested: " + !!to_parent_container + ", Dest is regular: " + !!dest_container_to_save);
        
        const [removed_entry] = source_contents.splice(item_index, 1);
        if (!removed_entry) {
            debug_error("transfer", "[UNIFIED-TRANSFER] FAILED: Could not remove item from source");
            return { ok: false, error: `Failed to remove item ${item_instance_id} from source` };
        }
        debug_log("transfer", "[UNIFIED-TRANSFER] Removed item: " + removed_entry.instance.def_id + " (" + removed_entry.instance.id + ")");
        debug_log("transfer", "[UNIFIED-TRANSFER] Source now has " + source_contents.length + " items");

        // CRITICAL: Check what we're about to modify
        debug_log("transfer", "[UNIFIED-TRANSFER] About to modify dest_contents array");
        debug_log("transfer", "[UNIFIED-TRANSFER] dest_contents type: " + (to_parent_container ? "nested in parent" : "regular container"));
        debug_log("transfer", "[UNIFIED-TRANSFER] dest_contents.length BEFORE: " + dest_contents.length);
        
        // Verify the item doesn't already exist in destination (duplicate check)
        const already_exists = dest_contents.some((entry: any) => entry.instance.id === removed_entry.instance.id);
        if (already_exists) {
            debug_error("transfer", "[UNIFIED-TRANSFER] WARNING: Item " + removed_entry.instance.id + " already exists in destination!");
        }

        // Assign grid coordinates in destination
        debug_log("transfer", "[UNIFIED-TRANSFER] Assigning grid coordinates...");
        
        // CRITICAL FIX: Handle items from body slots that don't have grid coordinates
        // Body slots don't use grid coordinates, so we rely entirely on the target coordinates
        const is_from_body_slot = is_body_slot_container(from_container_id);
        debug_log("transfer", "[UNIFIED-TRANSFER] Source is body slot: " + is_from_body_slot);
        debug_log("transfer", "[UNIFIED-TRANSFER] Source item original grid: (" + removed_entry.grid_x + "," + removed_entry.grid_y + ")");
        debug_log("transfer", "[UNIFIED-TRANSFER] Target grid provided: (" + target_grid_x + "," + target_grid_y + ")");
        
        // Use provided target coordinates (these come from the frontend based on where user dropped)
        if (target_grid_x !== undefined && target_grid_y !== undefined) {
            removed_entry.grid_x = target_grid_x;
            removed_entry.grid_y = target_grid_y;
            debug_log("transfer", "[UNIFIED-TRANSFER] ASSIGNED TARGET GRID: Item now at grid(" + removed_entry.grid_x + "," + removed_entry.grid_y + ")");
        } else {
            // Fallback: if no target coordinates, place at first empty slot
            debug_warn("transfer", "[UNIFIED-TRANSFER] WARNING: No target grid coordinates provided! Using default placement.");
            // Find first empty grid position
            const max_slots = dest_capacity?.max_slots || 10;
            const { cols } = calculate_grid_dimensions(max_slots);
            const rows = Math.ceil(max_slots / cols);
            let placed = false;
            for (let y = 0; y < rows && !placed; y++) {
                for (let x = 0; x < cols && !placed; x++) {
                    const is_occupied = dest_contents.some((e: any) => e.grid_x === x && e.grid_y === y);
                    if (!is_occupied) {
                        removed_entry.grid_x = x;
                        removed_entry.grid_y = y;
                        placed = true;
                        debug_log("transfer", "[UNIFIED-TRANSFER] PLACED AT EMPTY SLOT: grid(" + x + "," + y + ")");
                    }
                }
            }
            if (!placed) {
                debug_error("transfer", "[UNIFIED-TRANSFER] ERROR: Could not find empty slot! Container may be full.");
                return { ok: false, error: "Destination container is full" };
            }
        }

        // CRITICAL FIX: Validate body slot compatibility before proceeding
        // If destination is a body slot, the item must be compatible with it
        const is_to_body_slot = is_body_slot_container(to_container_id);
        if (is_to_body_slot) {
            const target_slot_name = get_slot_name(to_container_id);
            const is_compatible = is_item_compatible_with_slot(removed_entry, target_slot_name);
            debug_log("transfer", `[UNIFIED-TRANSFER] Body slot compatibility check: ${removed_entry.instance.def_id} -> ${target_slot_name}: ${is_compatible}`);
            if (!is_compatible) {
                debug_log("transfer", `[UNIFIED-TRANSFER] REJECTING: ${removed_entry.instance.def_id} cannot be equipped to ${target_slot_name}`);
                return { ok: false, error: `${removed_entry.definition.name || removed_entry.instance.def_id} cannot be equipped to ${target_slot_name}` };
            }
            
            // CRITICAL FIX: Check if any slots that this item occupies are already filled
            const occupies_slots = removed_entry.definition.occupies_slots || [];
            if (occupies_slots.length > 0) {
                debug_log("transfer", `[UNIFIED-TRANSFER] Item occupies slots: ${occupies_slots.join(', ')}`);
                
                // Get all body slot containers for this actor
                const actor_id = parse_container_id(to_container_id).owner_id;
                if (actor_id) {
                    for (const occupied_slot_name of occupies_slots) {
                        // Skip the target slot - we'll handle that with normal occupancy check
                        if (occupied_slot_name === target_slot_name) continue;
                        
                        const occupied_slot_container_id = `container.${actor_id}.${occupied_slot_name}`;
                        const occupied_slot_result = load_container(slot, occupied_slot_container_id);
                        
                        if (occupied_slot_result.ok && occupied_slot_result.container?.contents?.length > 0) {
                            const occupying_item = occupied_slot_result.container.contents[0];
                            if (occupying_item) {
                                debug_log("transfer", `[UNIFIED-TRANSFER] REJECTING: ${removed_entry.instance.def_id} would occupy ${occupied_slot_name} which already has ${occupying_item.instance.def_id}`);
                                return { ok: false, error: `${removed_entry.definition.name || removed_entry.instance.def_id} cannot be equipped: ${occupied_slot_name} is already occupied by ${occupying_item.definition.name || occupying_item.instance.def_id}` };
                            }
                        }
                    }
                }
            }
        }

        // CRITICAL FIX: Check if target position is occupied and handle appropriately
        // Logic: Stack → Swap → Reject
        const target_occupied = dest_contents.find((entry: any) => 
            entry.grid_x === removed_entry.grid_x && entry.grid_y === removed_entry.grid_y && entry.instance.id !== removed_entry.instance.id
        );
        
        if (target_occupied) {
            debug_log("transfer", "[UNIFIED-TRANSFER] Target position occupied by: " + target_occupied.instance.def_id);
            
            // Step 1: Try to stack
            if (can_stack_items(removed_entry, target_occupied)) {
                debug_log("transfer", "[UNIFIED-TRANSFER] Stacking with existing item");
                const combined_qty = (removed_entry.instance.qty || 1) + (target_occupied.instance.qty || 1);
                const max_stack = target_occupied.definition.max_stack_size || 1;
                
                if (combined_qty <= max_stack) {
                    target_occupied.instance.qty = combined_qty;
                    // Don't add removed_entry to dest_contents since we merged it
                    debug_log("transfer", "[UNIFIED-TRANSFER] Stacked items: total qty = " + combined_qty);
                    // Skip the push since we stacked
                    debug_log("transfer", "[UNIFIED-TRANSFER] === CROSS-CONTAINER SUCCESS (stacked) ===");
                    
                    // Save changes (copy from end of function)
                    debug_log("transfer", "[UNIFIED-TRANSFER] BEGINNING SAVE PHASE");
                    if (source_container_to_save) {
                        const save_path = save_container(slot, source_container_to_save);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source container to: ${save_path}`);
                    } else if (from_parent_container) {
                        const save_path = save_container(slot, from_parent_container);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source parent container to: ${save_path}`);
                    }
                    if (dest_container_to_save) {
                        const save_path = save_container(slot, dest_container_to_save);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination container to: ${save_path}`);
                    } else if (to_parent_container && !is_same_container) {
                        const save_path = save_container(slot, to_parent_container);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination parent container to: ${save_path}`);
                    }
                    debug_log("transfer", "[UNIFIED-TRANSFER] SAVE PHASE COMPLETE");
                    return { ok: true };
                } else {
                    debug_log("transfer", "[UNIFIED-TRANSFER] Cannot stack: would exceed max stack size");
                    // Continue to swap/reject logic
                }
            }
            
            // Step 2: Try to swap between containers
            // Handle three cases:
            // 1. Body slot → Body slot (both directions)
            // 2. Container → Body slot (drag from inventory to equipped slot)
            // 3. Body slot → Container (drag from equipped slot to inventory)
            
            const is_dest_body_slot = is_body_slot_container(to_container_id);
            const is_source_body_slot = is_body_slot_container(from_container_id);
            
            if (is_dest_body_slot || is_source_body_slot) {
                // At least one side is a body slot, check if swap is possible
                const source_slot = is_source_body_slot ? get_slot_name(from_container_id) : null;
                const target_slot = is_dest_body_slot ? get_slot_name(to_container_id) : null;
                
                // For container ↔ body slot swaps:
                // - Item going TO body slot must be compatible with that slot
                // - Item going TO container just needs space (we have the removed item's position)
                let can_perform_swap = false;
                
                if (is_dest_body_slot && is_source_body_slot) {
                    // Case 1: Body slot ↔ Body slot - both must fit
                    can_perform_swap = can_swap_items(removed_entry, target_occupied, source_slot!, target_slot!);
                } else if (is_dest_body_slot && !is_source_body_slot) {
                    // Case 2: Container → Body slot - check dragged item fits in body slot
                    can_perform_swap = is_item_compatible_with_slot(removed_entry, target_slot!);
                    // Body slot item automatically fits in container (containers accept anything with space)
                } else if (!is_dest_body_slot && is_source_body_slot) {
                    // Case 3: Body slot → Container - check if body slot item is a container item
                    // Regular items can always go into containers
                    // Container items can also go into containers (nested)
                    can_perform_swap = true;
                }
                
                if (can_perform_swap) {
                    debug_log("transfer", "[UNIFIED-TRANSFER] Swapping items");
                    
                    // Update container references
                    removed_entry.instance.container_id = to_container_id;
                    target_occupied.instance.container_id = from_container_id;
                    
                    // For container ↔ body slot swaps:
                    // The body slot item takes the dragged item's original position in the container
                    // The dragged item goes to position (0,0) in the body slot (body slots use packed array)
                    if (!is_dest_body_slot && is_source_body_slot) {
                        // Body slot → Container: body slot item takes dragged item's grid position
                        target_occupied.grid_x = removed_entry.grid_x;
                        target_occupied.grid_y = removed_entry.grid_y;
                        // Dragged item goes to body slot
                        removed_entry.grid_x = 0;
                        removed_entry.grid_y = 0;
                    } else {
                        // Container → Body slot OR Body slot → Body slot: swap positions normally
                        const temp_grid_x = removed_entry.grid_x;
                        const temp_grid_y = removed_entry.grid_y;
                        removed_entry.grid_x = target_occupied.grid_x;
                        removed_entry.grid_y = target_occupied.grid_y;
                        target_occupied.grid_x = temp_grid_x;
                        target_occupied.grid_y = temp_grid_y;
                    }
                    
                    // Now push the target_occupied (which was originally in dest) back to source
                    source_contents.push(target_occupied);
                    // And push removed_entry (which now has the target's original position)
                    dest_contents.push(removed_entry);
                    
                    debug_log("transfer", "[UNIFIED-TRANSFER] Swapped items successfully");
                    debug_log("transfer", "[UNIFIED-TRANSFER] === CROSS-CONTAINER SUCCESS (swapped) ===");
                    
                    // Save changes
                    debug_log("transfer", "[UNIFIED-TRANSFER] BEGINNING SAVE PHASE");
                    if (source_container_to_save) {
                        const save_path = save_container(slot, source_container_to_save);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source container to: ${save_path}`);
                    } else if (from_parent_container) {
                        const save_path = save_container(slot, from_parent_container);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source parent container to: ${save_path}`);
                    }
                    if (dest_container_to_save) {
                        const save_path = save_container(slot, dest_container_to_save);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination container to: ${save_path}`);
                    } else if (to_parent_container && !is_same_container) {
                        const save_path = save_container(slot, to_parent_container);
                        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination parent container to: ${save_path}`);
                    }
                    debug_log("transfer", "[UNIFIED-TRANSFER] SAVE PHASE COMPLETE");
                    return { ok: true };
                } else {
                    debug_log("transfer", "[UNIFIED-TRANSFER] Cannot swap: items incompatible");
                }
            }
            
            // Step 3: Reject - can't stack or swap
            debug_log("transfer", "[UNIFIED-TRANSFER] REJECTING: Target slot occupied and cannot stack/swap");
            return { ok: false, error: `Target position is occupied by ${target_occupied.definition.name || target_occupied.instance.def_id}` };
        }
        
        // Add to destination (only if not handled by stacking/swap logic above)
        debug_log("transfer", "[UNIFIED-TRANSFER] Pushing item to dest_contents...");
        dest_contents.push(removed_entry);
        debug_log("transfer", "[UNIFIED-TRANSFER] dest_contents.length AFTER: " + dest_contents.length);
        
        // Verify the item is in the destination
        const found_in_dest = dest_contents.find((entry: any) => entry.instance.id === removed_entry.instance.id);
        if (found_in_dest) {
            debug_log("transfer", "[UNIFIED-TRANSFER] VERIFIED: Item found in destination at grid(" + found_in_dest.grid_x + "," + found_in_dest.grid_y + ")");
        } else {
            debug_error("transfer", "[UNIFIED-TRANSFER] ERROR: Item NOT found in destination after push!");
        }
        
        // If nested container, verify parent container has the updated data
        if (to_parent_container) {
            debug_log("transfer", "[UNIFIED-TRANSFER] Checking parent container data...");
            // Find the nested item in parent
            const nested_item = to_parent_container.contents?.find((c: any) => 
                c.instance?.container_data?.contents?.some((e: any) => e.instance?.id === removed_entry.instance.id)
            );
            if (nested_item?.instance?.container_data?.contents) {
                const found_in_nested = nested_item.instance.container_data.contents.find((e: any) => e.instance?.id === removed_entry.instance.id);
                debug_log("transfer", "[UNIFIED-TRANSFER] Parent container has item at grid(" + found_in_nested?.grid_x + "," + found_in_nested?.grid_y + ")");
            }
        }
        
        debug_log("transfer", "[UNIFIED-TRANSFER] === CROSS-CONTAINER SUCCESS ===");
    }

    // Save changes
    debug_log("transfer", "[UNIFIED-TRANSFER] BEGINNING SAVE PHASE");
    
    if (source_container_to_save) {
        // Regular container - save it
        debug_log("transfer", `[UNIFIED-TRANSFER] Saving regular source container: ${source_container_to_save.id}`);
        const save_path = save_container(slot, source_container_to_save);
        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source container to: ${save_path}`);
    } else if (from_parent_container) {
        // Nested container - save the parent container directly (don't reload!)
        debug_log("transfer", `[UNIFIED-TRANSFER] Saving parent container for nested source: ${from_parent_container.id}`);
        const save_path = save_container(slot, from_parent_container);
        debug_log("transfer", `[UNIFIED-TRANSFER] Saved source parent container to: ${save_path}`);
    } else {
        debug_log("transfer", "[UNIFIED-TRANSFER] No source container to save");
    }
    
    if (dest_container_to_save) {
        // Regular container - save it
        debug_log("transfer", `[UNIFIED-TRANSFER] Saving regular destination container: ${dest_container_to_save.id}`);
        const save_path = save_container(slot, dest_container_to_save);
        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination container to: ${save_path}`);
    } else if (to_parent_container && !is_same_container) {
        // Nested container - save the parent container directly (don't reload!)
        // Only save if not same-container (which would be handled by source save above)
        debug_log("transfer", `[UNIFIED-TRANSFER] Saving parent container for nested destination: ${to_parent_container.id}`);
        
        // Log what we're about to save
        const nested_item = to_parent_container.contents?.find((c: any) => c.instance?.id === to_container_id?.replace('item.', ''));
        if (nested_item?.instance?.container_data?.contents) {
            debug_log("transfer", "[UNIFIED-TRANSFER] About to save nested container with " + nested_item.instance.container_data.contents.length + " items");
            nested_item.instance.container_data.contents.forEach((e: any, i: number) => {
                debug_log("transfer", `[UNIFIED-TRANSFER]   [${i}] ${e.instance?.def_id} at grid(${e.grid_x},${e.grid_y})`);
            });
        }
        
        const save_path = save_container(slot, to_parent_container);
        debug_log("transfer", `[UNIFIED-TRANSFER] Saved destination parent container to: ${save_path}`);
    } else if (to_parent_container && is_same_container) {
        debug_log("transfer", "[UNIFIED-TRANSFER] Skipping duplicate save for same-container nested transfer");
    } else {
        debug_log("transfer", "[UNIFIED-TRANSFER] No destination container to save");
    }
    
    debug_log("transfer", "[UNIFIED-TRANSFER] SAVE PHASE COMPLETE");

    debug_log("transfer", `Transfer complete: ${item_instance_id} moved from ${from_container_id} to ${to_container_id}`);
    return { ok: true };
}

/**
 * Get or create ground container for a place
 */
export function get_or_create_ground_container(
    slot: number,
    place_id: string,
    capacity?: Container["capacity"]
): ContainerLookupResult {
    const container_id = build_ground_container_id(place_id);
    
    // Try to load existing
    const existing = load_container(slot, container_id);
    if (existing.ok) return existing;
    
    // Create new ground container
    const ground_capacity = capacity ?? { max_slots: 100, max_weight: 100000 };

    const container: Container = {
        id: container_id,
        kind: "place",
        owner_ref: "system",
        place_id: place_id,
        interaction_range: 1,
        capacity: ground_capacity,
        contents: [],
        tags: [],
        is_open: true,
        is_locked: false,
    };
    
    const path = save_container(slot, container);
    return { ok: true, container, path };
}

/**
 * List ground items in a place
 */
export function get_ground_items(
    slot: number,
    place_id: string
): { instance: ItemInstance; error?: string }[] {
    const container_id = build_ground_container_id(place_id);
    return get_container_contents(slot, container_id);
}

/**
 * Find scattered container at specific coordinates
 * Returns null if not found
 */
export function find_scattered_container(
    slot: number,
    place_id: string,
    x: number,
    y: number
): Container | null {
    const container_id = `container.place.${place_id}.scattered_${x}_${y}`;
    const result = load_container(slot, container_id);
    if (result.ok && result.container.subtype === "scattered") {
        return result.container;
    }
    return null;
}

/**
 * Get or create scattered container at specific coordinates
 * Auto-creates container if it doesn't exist
 */
export function get_or_create_scattered_container(
    slot: number,
    place_id: string,
    x: number,
    y: number
): ContainerLookupResult {
    const container_id = `container.place.${place_id}.scattered_${x}_${y}`;
    
    // Try to load existing
    const existing = load_container(slot, container_id);
    if (existing.ok) return existing;
    
    // Create new scattered container
    const container: Container = {
        id: container_id,
        kind: "place",
        subtype: "scattered",
        place_id: place_id,
        position: { x, y },
        owner_ref: "system",
        interaction_range: 1,
        capacity: { max_slots: 100, max_weight: 100000 },
        contents: [],
        tags: [],
        is_open: true,
        is_locked: false,
    };
    
    const path = save_container(slot, container);
    return { ok: true, container, path };
}

/**
 * List all scattered containers in a place
 * Returns array of containers with their contents
 */
export function list_scattered_containers(
    slot: number,
    place_id: string
): Container[] {
    const dir = ensure_container_dir(slot);
    if (!fs.existsSync(dir)) return [];
    
    const prefix = `container.place.${place_id}.scattered_`;
    const containers: Container[] = [];
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonc"));
    
    for (const file of files) {
        const container_id = file.replace(".jsonc", "");
        if (container_id.startsWith(prefix)) {
            const result = load_container(slot, container_id);
            if (result.ok && result.container.subtype === "scattered") {
                containers.push(result.container);
            }
        }
    }
    
    return containers;
}

/**
 * Delete scattered container if empty
 * Returns true if deleted, false if not empty or not found
 */
export function delete_scattered_container_if_empty(
    slot: number,
    container_id: string
): boolean {
    const result = load_container(slot, container_id);
    if (!result.ok) return false;
    
    const container = result.container;
    if (container.subtype !== "scattered") return false;
    if (container.contents.length > 0) return false;
    
    return delete_container(slot, container_id);
}

/**
 * Find an item instance by ID across all entity containers
 * Searches through all NPCs, actors, and places to find the item
 *
 * @param slot - Data slot number
 * @param instance_id - The item instance ID to search for
 * @returns The wrapped item entry and container info if found, null otherwise
 */
export function find_item_in_entity_containers(
    slot: number,
    instance_id: string
): { item: { instance: ItemInstance; definition: any }; container_id: string; entity_type: string; entity_id: string } | null {
    const base_dir = `local_data/data_slot_${slot}`;

    // Helper to search an entity's containers
    function search_entity_containers(entity_path: string, entity_type: string, entity_id: string) {
        if (!fs.existsSync(entity_path)) return null;

        try {
            const entity = read_jsonc(entity_path) as Record<string, any>;
            if (!entity.containers) return null;

            for (const [container_name, container] of Object.entries(entity.containers)) {
                const container_data = container as Container;
                const found_entry = container_data.contents.find(entry => entry.instance.id === instance_id);
                if (found_entry) {
                    return {
                        item: found_entry,
                        container_id: container_data.id,
                        entity_type,
                        entity_id
                    };
                }
            }
        } catch (err) {
            // Silently skip entities that can't be read
        }
        return null;
    }

    // Search NPCs
    const npcs_dir = path.join(base_dir, "npcs");
    if (fs.existsSync(npcs_dir)) {
        const npc_files = fs.readdirSync(npcs_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of npc_files) {
            const npc_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(npcs_dir, file),
                "npc",
                npc_id
            );
            if (result) return result;
        }
    }

    // Search Actors
    const actors_dir = path.join(base_dir, "actors");
    if (fs.existsSync(actors_dir)) {
        const actor_files = fs.readdirSync(actors_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of actor_files) {
            const actor_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(actors_dir, file),
                "actor",
                actor_id
            );
            if (result) return result;
        }
    }

    // Search Places
    const places_dir = path.join(base_dir, "places");
    if (fs.existsSync(places_dir)) {
        const place_files = fs.readdirSync(places_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of place_files) {
            const place_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(places_dir, file),
                "place",
                place_id
            );
            if (result) return result;
        }
    }

    return null;
}

/**
 * Find an item instance and its parent container by ID
 * Used for nested container operations to properly save parent containers
 * 
 * @param slot - Data slot number
 * @param instance_id - The item instance ID to search for
 * @returns The item, its parent container, and container info if found, null otherwise
 */
export function find_item_and_parent_container(
    slot: number,
    instance_id: string
): { 
    item: { instance: ItemInstance; definition: any }; 
    parent_container: Container;
    container_id: string; 
    entity_type: string; 
    entity_id: string;
    entity_path: string;
} | null {
    debug_log("find_item_and_parent", `Searching for item ${instance_id} in slot ${slot}`);
    
    const base_dir = `local_data/data_slot_${slot}`;

    // Helper to search an entity's containers
    function search_entity_containers(entity_path: string, entity_type: string, entity_id: string) {
        if (!fs.existsSync(entity_path)) {
            debug_log("find_item_and_parent", `Entity file not found: ${entity_path}`);
            return null;
        }

        try {
            const entity = read_jsonc(entity_path) as Record<string, any>;
            if (!entity.containers) {
                debug_log("find_item_and_parent", `No containers in entity: ${entity_id}`);
                return null;
            }

            for (const [container_name, container] of Object.entries(entity.containers)) {
                const container_data = container as Container;
                const found_entry = container_data.contents.find(entry => entry.instance.id === instance_id);
                if (found_entry) {
                    debug_log("find_item_and_parent", `Found item ${instance_id} in container ${container_data.id}`);
                    return {
                        item: found_entry,
                        parent_container: container_data,
                        container_id: container_data.id,
                        entity_type,
                        entity_id,
                        entity_path
                    };
                }
            }
        } catch (err) {
            debug_error("find_item_and_parent", `Error reading entity ${entity_id}`, err);
        }
        return null;
    }

    // Search NPCs
    const npcs_dir = path.join(base_dir, "npcs");
    if (fs.existsSync(npcs_dir)) {
        const npc_files = fs.readdirSync(npcs_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of npc_files) {
            const npc_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(npcs_dir, file),
                "npc",
                npc_id
            );
            if (result) return result;
        }
    }

    // Search Actors
    const actors_dir = path.join(base_dir, "actors");
    if (fs.existsSync(actors_dir)) {
        const actor_files = fs.readdirSync(actors_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of actor_files) {
            const actor_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(actors_dir, file),
                "actor",
                actor_id
            );
            if (result) return result;
        }
    }

    // Search Places
    const places_dir = path.join(base_dir, "places");
    if (fs.existsSync(places_dir)) {
        const place_files = fs.readdirSync(places_dir).filter(f => f.endsWith(".jsonc"));
        for (const file of place_files) {
            const place_id = file.replace(".jsonc", "");
            const result = search_entity_containers(
                path.join(places_dir, file),
                "place",
                place_id
            );
            if (result) return result;
        }
    }

    debug_log("find_item_and_parent", `Item ${instance_id} not found in any entity`);
    return null;
}

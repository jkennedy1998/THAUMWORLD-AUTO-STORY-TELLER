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
import { load_place, save_place } from "../place_storage/store.js";
import { load_actor, save_actor } from "../actor_storage/store.js";
import { load_master_item } from "../item_storage/store.js";
import { can_stack_items_with_spoil_policy, merge_item_stack_into_target } from "../item_storage/stacking.js";
import {
    check_tag_compatibility, 
    has_equipment_tags,
    get_primary_slot_type,
    get_compatible_slot_types
} from "../equipment/tag_validation.js";

// LEGACY MODULE
//
// This file still supports older container-oriented flows, but it is no longer the
// canonical source of truth for item tag behavior. Active runtime item tags should
// come from item definitions + tag deltas resolved through `src/item_storage/resolve.ts`.
// Avoid using this module as the model for new tag or container architecture work.

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

/**
 * Load body slot container from inline body_slots storage
 * Returns container object or null if not found
 */
function load_body_slot_container_inline(
    entity: any,
    container_id: string,
    slot_name: string
): any | null {
    // Check if this is a body slot container
    const body_slot = entity.body_slots?.[slot_name];
    if (!body_slot) return null;

    // Check all slot types for equipped items with container_data
    const equipped_items: any[] = [];

    // Check tool slot
    if (body_slot.tool) {
        const item = find_item_in_entity(entity, body_slot.tool);
        if (item) {
            equipped_items.push({
                instance: {
                    id: item.id,
                    def_id: item.def_id,
                    qty: 1,
                    condition: "good",
                    tags: item.tags || [],
                    container_id: container_id,
                    owner_ref: entity.id
                },
                definition: item,
                grid_x: 0,
                grid_y: 0
            });
        }
    }

    // Check armor slot
    if (body_slot.armor) {
        const item = find_item_in_entity(entity, body_slot.armor);
        if (item) {
            equipped_items.push({
                instance: {
                    id: item.id,
                    def_id: item.def_id,
                    qty: 1,
                    condition: "good",
                    tags: item.tags || [],
                    container_id: container_id,
                    owner_ref: entity.id
                },
                definition: item,
                grid_x: equipped_items.length,
                grid_y: 0
            });
        }
    }

    // Check garb slots (can have multiple)
    if (body_slot.garb && Array.isArray(body_slot.garb)) {
        for (const garb_id of body_slot.garb) {
            const item = find_item_in_entity(entity, garb_id);
            if (item) {
                equipped_items.push({
                    instance: {
                        id: item.id,
                        def_id: item.def_id,
                        qty: 1,
                        condition: "good",
                        tags: item.tags || [],
                        container_id: container_id,
                        owner_ref: entity.id
                    },
                    definition: item,
                    grid_x: equipped_items.length,
                    grid_y: 0
                });
            }
        }
    }

    // Return container structure (even if empty - allows transfers TO empty slots)
    return {
        id: container_id,
        kind: "actor",
        owner_ref: `actor.${entity.id}`,
        name: slot_name,
        capacity: {
            max_slots: 2,
            max_weight: 2000
        },
        contents: equipped_items,
        tags: [],
        is_open: true,
        is_locked: false
    };
}

/**
 * Find item definition in entity's containers or body_slots
 * Returns full item definition with tags for equipment validation
 */
function find_item_in_entity(entity: any, item_id: string): any {
    // Check entity.containers first
    if (entity.containers) {
        for (const container_name of Object.keys(entity.containers)) {
            const container = entity.containers[container_name];
            if (container?.contents) {
                for (const entry of container.contents) {
                    if (entry.instance?.id === item_id) {
                        return entry.definition;
                    }
                }
            }
        }
    }

    // Check inline body slot containers (items with container_data equipped to body slots)
    if (entity.body_slots) {
        for (const slot_name of Object.keys(entity.body_slots)) {
            const slot = entity.body_slots[slot_name];
            
            // Check tool slot - look for item with container_data
            if (slot.tool === item_id) {
                // Search in entity's equipped containers for this item
                const equipped_container = find_equipped_container_with_item(entity, item_id);
                if (equipped_container) return equipped_container;
                
                // Fallback: return minimal with TOOL tag
                return { 
                    id: item_id, 
                    def_id: item_id.replace("inst_", "").replace(/_\d+$/, ""),
                    tags: [{ name: "TOOL", mag: 1 }]
                };
            }
            
            // Check armor slot
            if (slot.armor === item_id) {
                const equipped_container = find_equipped_container_with_item(entity, item_id);
                if (equipped_container) return equipped_container;
                
                return { 
                    id: item_id, 
                    def_id: item_id.replace("inst_", "").replace(/_\d+$/, ""),
                    tags: [{ name: "ARMOR", mag: 1, meta: [slot_name] }]
                };
            }
            
            // Check garb slots
            if (slot.garb && slot.garb.includes(item_id)) {
                const equipped_container = find_equipped_container_with_item(entity, item_id);
                if (equipped_container) return equipped_container;
                
                return { 
                    id: item_id, 
                    def_id: item_id.replace("inst_", "").replace(/_\d+$/, ""),
                    tags: [{ name: "GARB", mag: 1, meta: [slot_name] }]
                };
            }
        }
    }

    return null;
}

/**
 * Helper to find item definition in equipped containers (body slots with container_data)
 */
function find_equipped_container_with_item(entity: any, item_id: string): any {
    if (!entity.body_slots) return null;
    
    for (const slot_name of Object.keys(entity.body_slots)) {
        const slot = entity.body_slots[slot_name];
        
        // Check if this slot has an equipped item with container_data
        const equipped_ids = [
            slot.tool,
            slot.armor,
            ...(slot.garb || [])
        ].filter(Boolean);
        
        for (const equipped_id of equipped_ids) {
            // This is a container item - check its container_data.contents
            const equipped_item = find_item_in_entity_recursive(entity, equipped_id);
            if (equipped_item?.container_data?.contents) {
                for (const entry of equipped_item.container_data.contents) {
                    if (entry.instance?.id === item_id) {
                        return entry.definition;
                    }
                }
            }
        }
    }
    
    return null;
}

/**
 * Recursively find item in entity (for nested containers)
 */
function find_item_in_entity_recursive(entity: any, item_id: string): any {
    // Check containers
    if (entity.containers) {
        for (const container_name of Object.keys(entity.containers)) {
            const container = entity.containers[container_name];
            if (container?.contents) {
                for (const entry of container.contents) {
                    if (entry.instance?.id === item_id) {
                        return entry;
                    }
                }
            }
        }
    }
    
    // Check inline sack in body_slots
    if (entity.body_slots) {
        for (const slot_name of Object.keys(entity.body_slots)) {
            const slot = entity.body_slots[slot_name];
            const equipped_ids = [slot.tool, slot.armor, ...(slot.garb || [])].filter(Boolean);
            
            for (const equipped_id of equipped_ids) {
                // Get the equipped item entry
                if (entity.containers) {
                    for (const container_name of Object.keys(entity.containers)) {
                        const container = entity.containers[container_name];
                        if (container?.contents) {
                            for (const entry of container.contents) {
                                if (entry.instance?.id === equipped_id) {
                                    // Check if this item has the target in its container_data
                                    if (entry.instance?.container_data?.contents) {
                                        for (const nested_entry of entry.instance.container_data.contents) {
                                            if (nested_entry.instance?.id === item_id) {
                                                return entry; // Return the container item
                                            }
                                        }
                                    }
                                    return entry;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    return null;
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
 * Load container from entity - checks both entity.containers and inline body_slots
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
    const container_name = get_container_name_from_id(container_id);
    let container: any;

    // Check 1: entity.containers (legacy/standard location)
    if (entity.containers && entity.containers[container_name]) {
        container = entity.containers[container_name];
        debug_log("container", `Loaded ${container_id} from entity.containers`);
    }
    // Check 2: inline body_slots for body slot containers
    else if (parsed.owner_type === "actor" || parsed.owner_type === "npc") {
        const slot_container = load_body_slot_container_inline(entity, container_id, container_name);
        if (slot_container) {
            container = slot_container;
            debug_log("container", `Loaded ${container_id} from inline body_slots`);
        }
    }

    if (!container) {
        return { ok: false, error: "container_not_found", todo: `Container ${container_name} not found in entity ${parsed.owner_id}` };
    }

    if (!container) {
        return { ok: false, error: "container_not_in_entity", todo: `Container ${container_name} not found in entity` };
    }

    // DEBUG: Log container load for troubleshooting
    debug_log("container", `[LOAD] Container ${container_id} loaded with ${container.contents.length} items`);
    container.contents.forEach((entry: ContainerContentEntry, idx: number) => {
        debug_log("container", `  [${idx}] ${entry.instance.def_id} (${entry.instance.id}) tags: [${entry.instance.tags?.map((t: any) => t.name).join(', ') || 'none'}]`);
    });

    return { ok: true, container, path: entity_path };
}

/**
 * Get slot type from container ID
 * e.g., "container.gunther.hand_left.tool" -> "tool"
 * e.g., "container.gunther.leg_left.armor" -> "armor"
 * e.g., "container.gunther.torso.garb.0" -> "garb"
 * Returns null if not a body slot container
 */
function get_slot_type_from_container_id(container_id: string): string | null {
    const parts = container_id.split(".");
    // Format: container.actor_id.slot_name.slot_type[.garb_index]
    if (parts.length >= 4) {
        const slot_type = parts[3]!;
        if (["tool", "armor", "garb"].includes(slot_type)) {
            return slot_type;
        }
    }
    return null;
}

/**
 * Get container name from container ID
 * e.g., "container.gunther.leg_left" -> "leg_left"
 * New format: "container.gunther.hand_left.tool" -> "hand_left"
 * New format: "container.gunther.hand_left.garb.0" -> "hand_left"
 * Place format: "container.place.<place_id>.<container_name>" -> "<container_name>"
 */
function get_container_name_from_id(container_id: string): string {
    const parts = container_id.split(".");
    // Old format: container.actor_id.slot_name
    // New format: container.actor_id.slot_name.slot_type[.garb_index]
    if (parts.length >= 3) {
        // Handle place containers: container.place.<place_id>.<container_name>
        if (parts[1] === "place") {
            return parts.slice(3).join(".") || "ground";
        }
        // For body slots, the slot_name is at index 2
        // Everything after is slot_type and optional garb_index
        return parts[2] || "unknown";
    }
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
        const container_name = get_container_name_from_id(container.id);
        
        // Check if this is a body slot container (hand_left, hand_right, head, torso, leg_left, leg_right)
        const body_slot_names = ["hand_left", "hand_right", "head", "torso", "leg_left", "leg_right"];
        const is_body_slot = body_slot_names.includes(container_name);
        
        if (is_body_slot && (parsed.owner_type === "actor" || parsed.owner_type === "npc")) {
            // Body slot containers are stored inline in body_slots
            if (!entity.body_slots) {
                entity.body_slots = {};
            }
            if (!entity.body_slots[container_name]) {
                entity.body_slots[container_name] = {
                    name: container_name,
                    critical: ["head", "torso"].includes(container_name),
                    armor: null,
                    garb: [],
                    tool: null
                };
            }
            
            // Update body_slots based on container contents
            // CRITICAL FIX: Only update the SPECIFIC slot type being saved, don't wipe others
            const slot_data = entity.body_slots[container_name];
            
            // Extract slot type from container ID (e.g., container.actor.leg_left.armor -> "armor")
            const target_slot_type = get_slot_type_from_container_id(container.id);
            debug_log("container", `[SAVE_BODY_SLOT] Target slot type from container ID: ${target_slot_type}`);
            
            // Only clear the specific slot type being saved
            if (target_slot_type === "tool") {
                slot_data.tool = null;
            } else if (target_slot_type === "armor") {
                slot_data.armor = null;
            } else if (target_slot_type === "garb") {
                // For garb, we need to rebuild the array from current state
                // First, collect all garb items from other containers on this body part
                slot_data.garb = [];
            }
            
            // Re-populate from container contents
            debug_log("container", `[SAVE_BODY_SLOT] Processing ${container.contents.length} items in ${container.id}`);
            for (const entry of container.contents) {
                const item_id = entry.instance?.id || 'unknown';
                const item_name = entry.definition?.name || entry.instance?.def_id || 'unknown';
                const has_tags = entry.definition?.tags ? `tags: [${entry.definition.tags.map((t: any) => t.name).join(', ')}]` : 'no tags';
                debug_log("container", `[SAVE_BODY_SLOT] Item: ${item_name} (${item_id}), ${has_tags}`);
                
                const item_slot_type = get_primary_slot_type(entry.definition as any);
                debug_log("container", `[SAVE_BODY_SLOT]   -> item_slot_type: ${item_slot_type}, target_slot_type: ${target_slot_type}`);
                
                // Only update if the item's slot type matches the target slot type
                if (item_slot_type === target_slot_type) {
                    if (item_slot_type === "tool") {
                        slot_data.tool = entry.instance.id;
                        debug_log("container", `[SAVE_BODY_SLOT]   -> ADDED to tool`);
                    } else if (item_slot_type === "armor") {
                        slot_data.armor = entry.instance.id;
                        debug_log("container", `[SAVE_BODY_SLOT]   -> ADDED to armor`);
                    } else if (item_slot_type === "garb") {
                        if (!slot_data.garb.includes(entry.instance.id)) {
                            slot_data.garb.push(entry.instance.id);
                            debug_log("container", `[SAVE_BODY_SLOT]   -> ADDED to garb, now: [${slot_data.garb.join(', ')}]`);
                        } else {
                            debug_log("container", `[SAVE_BODY_SLOT]   -> already in garb`);
                        }
                    }
                } else {
                    debug_log("container", `[SAVE_BODY_SLOT]   -> SKIPPED (item slot_type ${item_slot_type} doesn't match target ${target_slot_type})`);
                }
            }
            
            debug_log("container", `[SAVE_BODY_SLOT] Final state for ${container_name}: tool=${slot_data.tool}, armor=${slot_data.armor}, garb=[${slot_data.garb.join(', ') || 'empty'}]`);
            debug_log("container", `Saved ${container.id} references to inline body_slots`);
        }
        
        // CRITICAL FIX: Only save NON-body-slot containers to entity.containers
        // Body slot containers are stored inline in body_slots above, not in entity.containers
        // This prevents slot type overwrites (e.g., torso.armor overwriting torso.garb)
        if (!is_body_slot) {
            if (!entity.containers) {
                entity.containers = {};
            }
            entity.containers[container_name] = container;
            debug_log("container", `Saved ${container.id} data to entity.containers`);
        } else {
            debug_log("container", `Skipped saving ${container.id} to entity.containers (body slot containers stored inline in body_slots)`);
        }

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
        const containers: Container[] = [];
        
        // Add regular containers from entity.containers
        if (entity.containers) {
            containers.push(...Object.values(entity.containers) as Container[]);
        }
        
        // For actors and NPCs, also add body slot containers
        // Body slot containers are stored inline and need to be converted to Container format
        if ((entity_type === "actor" || entity_type === "npc") && entity.body_slots) {
            const body_slot_names = ["head", "torso", "hand_left", "hand_right", "leg_left", "leg_right"];
            
            for (const slot_name of body_slot_names) {
                const body_slot = entity.body_slots[slot_name];
                if (!body_slot) continue;
                
                // Get all equipped item IDs from this body slot
                const equipped_items: string[] = [];
                if (body_slot.tool) equipped_items.push(body_slot.tool);
                if (body_slot.armor) equipped_items.push(body_slot.armor);
                if (body_slot.garb && Array.isArray(body_slot.garb)) {
                    equipped_items.push(...body_slot.garb);
                }
                
                // If no items equipped, skip
                if (equipped_items.length === 0) continue;
                
                // Build container from body slot data
                // First check if we already have this container from entity.containers
                const existing_container = containers.find(c => c.id === `container.${owner_ref}.${slot_name}`);
                if (existing_container) {
                    // Already have it, skip
                    continue;
                }
                
                // Need to construct the container from equipped items
                // We need to load the full item data
                const container_id = `container.${owner_ref}.${slot_name}`;
                const container_result = load_container(slot, container_id);
                
                if (container_result.ok && container_result.container) {
                    containers.push(container_result.container);
                }
            }
        }
        
        return containers;
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
    const def = item?.def_id ? load_master_item(item.def_id) : null;
    const unit_weight = def?.ok ? Number(def.item.weight ?? 0) : Number((item as any)?.weight ?? 0);
    let weight = (Number.isFinite(unit_weight) ? unit_weight : 0) * Math.max(1, Number(item.qty ?? 1) || 1);
    
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
    
    return can_stack_items_with_spoil_policy(item_a, def_a, item_b, def_b);
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
 * Check if two items can be swapped between slots (tag-based)
 */
function can_swap_items(
    source_entry: { instance: ItemInstance; definition: any },
    target_entry: { instance: ItemInstance; definition: any },
    source_slot: string,
    target_slot: string
): boolean {
    const source_def = source_entry.definition;
    const target_def = target_entry.definition;
    
    // Check if source item fits in target slot (tag-based; allow any tool)
    const source_fits_target = (
        check_tag_compatibility(source_def, target_slot, "armor").compatible ||
        check_tag_compatibility(source_def, target_slot, "garb").compatible ||
        check_tag_compatibility(source_def, target_slot, "tool").compatible
    );
    
    // Check if target item fits in source slot
    const target_fits_source = (
        check_tag_compatibility(target_def, source_slot, "armor").compatible ||
        check_tag_compatibility(target_def, source_slot, "garb").compatible ||
        check_tag_compatibility(target_def, source_slot, "tool").compatible
    );
    
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
 * 
 * Tag-based validation (legacy slot lists removed)
 * 
 * @param item_entry - The item to check
 * @param slot_name - The body slot name (e.g., "hand_left", "torso")
 * @param slot_type - Optional: The slot type ("armor", "garb", "tool") for tag-based validation
 * @returns True if item can equip to the slot
 */
/**
 * Body part slot type mapping from the plan:
 * Head: armor, garb (no tool)
 * Torso: armor, garb (no tool)
 * Hand Left/Right: armor, garb, tool
 * Leg Left/Right: armor, garb (no tool)
 */
const BODY_SLOT_TYPE_MAPPING: Record<string, string[]> = {
    "head": ["armor", "garb"],
    "torso": ["armor", "garb"],
    "hand_left": ["armor", "garb", "tool"],
    "hand_right": ["armor", "garb", "tool"],
    "leg_left": ["armor", "garb"],
    "leg_right": ["armor", "garb"]
};

function is_item_compatible_with_slot(
    item_entry: { instance: ItemInstance; definition: any },
    slot_name: string,
    slot_type?: string
): boolean {
    const def = item_entry.definition;
    
    // Get available slot types for this body part
    const available_slot_types = BODY_SLOT_TYPE_MAPPING[slot_name];
    if (!available_slot_types) {
        debug_log("transfer", `[COMPATIBILITY] Unknown body slot: ${slot_name}`);
        return false;
    }
    
    // If item has equipment tags, use tag-based validation
    if (has_equipment_tags(def)) {
        // Get all compatible slot types for this item
        const item_slot_types = get_compatible_slot_types(def);
        
        // Check if item can go to ANY available slot on this body part
        const compatible_types = item_slot_types.filter(type => available_slot_types.includes(type));
        
        if (compatible_types.length === 0) {
            debug_log("transfer", `[COMPATIBILITY] REJECTED: ${def.name || def.id} has tags [${item_slot_types.join(', ')}] but ${slot_name} only supports [${available_slot_types.join(', ')}]`);
            return false;
        }
        
        // If specific slot_type requested, validate it
        if (slot_type) {
            // Check if the requested slot_type is available on this body part
            if (!available_slot_types.includes(slot_type)) {
                debug_log("transfer", `[COMPATIBILITY] REJECTED: ${slot_name} doesn't have ${slot_type} slot (available: [${available_slot_types.join(', ')}])`);
                return false;
            }
            
            // Check if item is compatible with this specific slot_type
            const tag_result = check_tag_compatibility(def, slot_name, slot_type);
            return tag_result.compatible;
        }
        
        // No specific slot_type requested - item is compatible if it can go to any slot
        return true;
    }
    
    // Items without equipment tags still can be held in tool slots.
    if (!has_equipment_tags(def)) {
        return slot_type === 'tool';
    }
    return false;
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

/**
 * Sync actor's body_slots with container contents after transfer
 * This ensures body_slots accurately reflect what's actually equipped
 */
function sync_body_slots_with_containers(
    slot: number,
    from_container_id: string,
    to_container_id: string,
    item_instance_id: string
): void {
    debug_log("transfer", `[SYNC] === START SYNC ===`);
    debug_log("transfer", `[SYNC] Item: ${item_instance_id}`);
    debug_log("transfer", `[SYNC] From: ${from_container_id} -> To: ${to_container_id}`);
    
    // Parse container IDs to get actor info
    // New format: container.{actor_id}.{slot_name}.{slot_type}[.{garb_index}]
    // Examples: container.henry_actor.hand_left.tool, container.henry_actor.hand_left.garb.0
    const from_match = from_container_id.match(/^container\.([^.]+)\.(\w+)\.(tool|armor|garb)(?:\.(\d+))?$/);
    const to_match = to_container_id.match(/^container\.([^.]+)\.(\w+)\.(tool|armor|garb)(?:\.(\d+))?$/);
    
    debug_log("transfer", `[SYNC] from_match: ${from_match ? `${from_match[1]}.${from_match[2]}.${from_match[3]}${from_match[4] ? '.' + from_match[4] : ''}` : 'null'}`);
    debug_log("transfer", `[SYNC] to_match: ${to_match ? `${to_match[1]}.${to_match[2]}.${to_match[3]}${to_match[4] ? '.' + to_match[4] : ''}` : 'null'}`);
    
    // Handle item moved FROM a body slot (remove from body_slots)
    if (from_match && from_match[1] && from_match[2]) {
        const actor_id = from_match[1];
        const slot_name = from_match[2];
        debug_log("transfer", `[SYNC] Processing removal from ${slot_name} for actor ${actor_id}`);
        
        const actor_result = load_actor(slot, actor_id);
        if (actor_result.ok) {
            const actor = actor_result.actor as any;
            debug_log("transfer", `[SYNC] Loaded actor, body_slots exists: ${!!actor.body_slots}`);
            
            if (actor.body_slots && actor.body_slots[slot_name]) {
                const body_slot = actor.body_slots[slot_name];
                debug_log("transfer", `[SYNC] BEFORE removal - ${slot_name}: tool=${body_slot.tool}, armor=${body_slot.armor}, garb=[${body_slot.garb?.join(', ') || 'empty'}]`);
                
                // Check all slot types and remove the item
                let removed = false;
                if (body_slot.tool === item_instance_id) {
                    body_slot.tool = null;
                    removed = true;
                    debug_log("transfer", `[SYNC] REMOVED from ${slot_name}.tool`);
                }
                if (body_slot.armor === item_instance_id) {
                    body_slot.armor = null;
                    removed = true;
                    debug_log("transfer", `[SYNC] REMOVED from ${slot_name}.armor`);
                }
                if (body_slot.garb && Array.isArray(body_slot.garb)) {
                    const idx = body_slot.garb.indexOf(item_instance_id);
                    if (idx >= 0) {
                        body_slot.garb.splice(idx, 1);
                        removed = true;
                        debug_log("transfer", `[SYNC] REMOVED from ${slot_name}.garb at index ${idx}`);
                    }
                }
                
                if (!removed) {
                    debug_log("transfer", `[SYNC] WARNING: Item ${item_instance_id} not found in ${slot_name} for removal`);
                }
                
                debug_log("transfer", `[SYNC] AFTER removal - ${slot_name}: tool=${body_slot.tool}, armor=${body_slot.armor}, garb=[${body_slot.garb?.join(', ') || 'empty'}]`);
                
                // Save the updated actor
                save_actor(slot, actor_id!, actor);
                debug_log("transfer", `[SYNC] Saved actor after removal`);
            } else {
                debug_log("transfer", `[SYNC] WARNING: body_slots or ${slot_name} not found`);
            }
        } else {
            debug_log("transfer", `[SYNC] ERROR: Failed to load actor ${actor_id}`);
        }
    }
    
    // Handle item moved TO a body slot (add to body_slots)
    if (to_match && to_match[1] && to_match[2] && to_match[3]) {
        const actor_id = to_match[1];
        const slot_name = to_match[2];
        const target_slot_type = to_match[3]; // tool, armor, or garb
        const target_garb_index = to_match[4] ? parseInt(to_match[4], 10) : null;
        debug_log("transfer", `[SYNC] Processing addition to ${slot_name}.${target_slot_type}${target_garb_index !== null ? '.' + target_garb_index : ''} for actor ${actor_id}`);
        
        const actor_result = load_actor(slot, actor_id);
        if (actor_result.ok) {
            const actor = actor_result.actor as any;
            debug_log("transfer", `[SYNC] Loaded actor, body_slots exists: ${!!actor.body_slots}`);
            
            if (actor.body_slots && actor.body_slots[slot_name]) {
                const body_slot = actor.body_slots[slot_name];
                debug_log("transfer", `[SYNC] BEFORE addition - ${slot_name}: tool=${body_slot.tool}, armor=${body_slot.armor}, garb=[${body_slot.garb?.join(', ') || 'empty'}]`);
                
                // Load the item to check its slot type (for validation)
                const container_result = load_container(slot, to_container_id);
                if (container_result.ok) {
                    const item_entry = container_result.container.contents.find(
                        entry => entry.instance.id === item_instance_id
                    );
                    
                    if (item_entry) {
                        const item_slot_type = get_primary_slot_type(item_entry.definition as any);
                        debug_log("transfer", `[SYNC] Item ${item_instance_id} has slot_type: ${item_slot_type}, target: ${target_slot_type}`);
                        
                        // Validate that item's slot type matches the target slot type
                        if (item_slot_type !== target_slot_type) {
                            debug_log("transfer", `[SYNC] WARNING: Item slot type ${item_slot_type} doesn't match target ${target_slot_type}`);
                        }
                        
                        // Add to appropriate slot type based on target
                        if (target_slot_type === "tool") {
                            body_slot.tool = item_instance_id;
                            debug_log("transfer", `[SYNC] ADDED to ${slot_name}.tool`);
                        } else if (target_slot_type === "armor") {
                            body_slot.armor = item_instance_id;
                            debug_log("transfer", `[SYNC] ADDED to ${slot_name}.armor`);
                        } else if (target_slot_type === "garb") {
                            if (!body_slot.garb) body_slot.garb = [];
                            // For garb, insert at specific index if provided, otherwise append
                            if (target_garb_index !== null && target_garb_index < body_slot.garb.length) {
                                // Insert at specific position (for reordering)
                                if (!body_slot.garb.includes(item_instance_id)) {
                                    body_slot.garb.splice(target_garb_index, 0, item_instance_id);
                                    debug_log("transfer", `[SYNC] INSERTED to ${slot_name}.garb at index ${target_garb_index}`);
                                }
                            } else {
                                // Append to end
                                if (!body_slot.garb.includes(item_instance_id)) {
                                    body_slot.garb.push(item_instance_id);
                                    debug_log("transfer", `[SYNC] ADDED to ${slot_name}.garb at end, now has ${body_slot.garb.length} items`);
                                } else {
                                    debug_log("transfer", `[SYNC] Item already in ${slot_name}.garb, skipping`);
                                }
                            }
                        } else {
                            debug_log("transfer", `[SYNC] WARNING: Unknown slot_type ${target_slot_type}, not adding to body_slots`);
                        }
                        
                        debug_log("transfer", `[SYNC] AFTER addition - ${slot_name}: tool=${body_slot.tool}, armor=${body_slot.armor}, garb=[${body_slot.garb?.join(', ') || 'empty'}]`);
                        
                        // Save the updated actor
                        save_actor(slot, actor_id!, actor);
                        debug_log("transfer", `[SYNC] Saved actor after addition`);
                    } else {
                        debug_log("transfer", `[SYNC] ERROR: Item ${item_instance_id} not found in container ${to_container_id}`);
                    }
                } else {
                    debug_log("transfer", `[SYNC] ERROR: Failed to load container ${to_container_id}`);
                }
            } else {
                debug_log("transfer", `[SYNC] WARNING: body_slots or ${slot_name} not found`);
            }
        } else {
            debug_log("transfer", `[SYNC] ERROR: Failed to load actor ${actor_id}`);
        }
    }
    
    debug_log("transfer", `[SYNC] === END SYNC ===`);
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
    let item_index = source_contents.findIndex(entry => entry.instance.id === item_instance_id);
    
    // If not found in expected container, try to locate it anywhere (inline storage)
    if (item_index === -1) {
        debug_log("transfer", `Item ${item_instance_id} not found in ${from_container_id}, searching inline storage...`);
        const location = find_item_location(slot, item_instance_id);
        
        if (location) {
            debug_log("transfer", `Found item in inline storage: ${location.container_id} (nested: ${location.is_nested})`);
            
            // Update source to the actual location
            if (location.container_id.startsWith("item.")) {
                // Item is in a nested container
                const nested_item_id = location.container_id.slice(5);
                const found = find_item_and_parent_container(slot, nested_item_id);
                if (found && found.item.instance.container_data) {
                    from_item_entry = found.item;
                    from_parent_container = found.parent_container;
                    from_parent_container_id = found.container_id;
                    source_contents = found.item.instance.container_data.contents;
                    source_container_to_save = null; // Will save parent instead
                    debug_log("transfer", `Switched to nested container: ${location.container_id}`);
                }
            } else {
                // Item is in a regular container
                const actual_result = load_container(slot, location.container_id);
                if (actual_result.ok) {
                    source_contents = actual_result.container.contents;
                    source_container_to_save = actual_result.container;
                    debug_log("transfer", `Switched to regular container: ${location.container_id}`);
                }
            }
            
            // Try to find the item again in the correct location
            item_index = source_contents.findIndex(entry => entry.instance.id === item_instance_id);
        }
    }
    
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

        merge_item_stack_into_target(target_entry.instance, source_entry.instance);
        
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
                    merge_item_stack_into_target(target_entry.instance, source_entry.instance);
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
                // For body slots, check tag-based compatibility
                const is_body_slot = is_body_slot_container(from_container_id);
                debug_log("transfer", "[UNIFIED-TRANSFER] is_body_slot: " + is_body_slot);
                
                if (is_body_slot) {
                    const slot_name = get_slot_name(from_container_id);
                    const source_fits = is_item_compatible_with_slot(source_entry as any, slot_name);
                    const target_fits = is_item_compatible_with_slot(target_entry as any, slot_name);
                    
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
            // Get slot_type from TARGET container ID (e.g., container.actor.hand_left.armor -> "armor")
            // NOT from the item's tags - we need to validate if item fits the specific slot being targeted
            const slot_type = get_slot_type_from_container_id(to_container_id);
            const is_compatible = is_item_compatible_with_slot(removed_entry, target_slot_name, slot_type || undefined);
            debug_log("transfer", `[UNIFIED-TRANSFER] Body slot compatibility check: ${removed_entry.instance.def_id} -> ${target_slot_name} (type: ${slot_type}): ${is_compatible}`);
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
                    merge_item_stack_into_target(target_occupied.instance, removed_entry.instance);
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
    debug_log("transfer", `[UNIFIED-TRANSFER] SAVE CHECK: source_container_to_save=${!!source_container_to_save}, from_parent_container=${!!from_parent_container}, to_parent_container=${!!to_parent_container}, is_same_container=${is_same_container}`);
    
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

    // SYNC BODY SLOTS: Update actor's body_slots to match container state
    sync_body_slots_with_containers(slot, from_container_id, to_container_id, item_instance_id);

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
 * Find scattered container at specific coordinates (inline storage in place.containers)
 * Returns null if not found
 */
export function find_scattered_container(
    slot: number,
    place_id: string,
    x: number,
    y: number
): Container | null {
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) return null;
    
    const place = place_result.place;
    if (!place.containers) return null;
    
    const container_name = `scattered_${x}_${y}`;
    const container = place.containers[container_name];
    
    if (container && container.subtype === "scattered") {
        return container;
    }
    return null;
}

/**
 * Get or create scattered container at specific coordinates (inline storage in place.containers)
 * Auto-creates container inline if it doesn't exist
 */
export function get_or_create_scattered_container(
    slot: number,
    place_id: string,
    x: number,
    y: number
): ContainerLookupResult {
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) {
        return { ok: false, error: "place_not_found", todo: `Place ${place_id} not found` };
    }
    
    const place = place_result.place;
    if (!place.containers) {
        place.containers = {};
    }
    
    const container_name = `scattered_${x}_${y}`;
    const container_id = `container.place.${place_id}.${container_name}`;
    
    // Check if already exists
    if (place.containers[container_name]) {
        return { ok: true, container: place.containers[container_name], path: `place:${place_id}` };
    }
    
    // Create new scattered container inline
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
    
    // Store inline in place.containers
    place.containers[container_name] = container;
    save_place(slot, place);
    
    return { ok: true, container, path: `place:${place_id}` };
}

/**
 * List all scattered containers in a place (inline storage in place.containers)
 * Returns array of containers with their contents
 */
export function list_scattered_containers(
    slot: number,
    place_id: string
): Container[] {
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) return [];
    
    const place = place_result.place;
    if (!place.containers) return [];
    
    const containers: Container[] = [];
    
    // Find all scattered containers in place.containers
    for (const [container_name, container] of Object.entries(place.containers)) {
        if (container_name.startsWith("scattered_") && container.subtype === "scattered") {
            containers.push(container);
        }
    }
    
    return containers;
}

/**
 * Delete scattered container if empty (inline storage in place.containers)
 * Returns true if deleted, false if not empty or not found
 */
export function delete_scattered_container_if_empty(
    slot: number,
    container_id: string
): boolean {
    // Parse container_id to get place_id and coordinates
    const match = container_id.match(/^container\.place\.(.+)\.scattered_(\d+)_(\d+)$/);
    if (!match) return false;
    
    const place_id = match[1]!;
    const container_name = `scattered_${match[2]}_${match[3]}`;
    
    const place_result = load_place(slot, place_id);
    if (!place_result.ok) return false;
    
    const place = place_result.place;
    if (!place.containers) return false;
    
    const container = place.containers[container_name];
    if (!container) return false;
    if (container.subtype !== "scattered") return false;
    if (container.contents.length > 0) return false;
    
    // Delete from inline storage
    delete place.containers[container_name];
    save_place(slot, place);
    return true;
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

/**
 * Find an item anywhere, including in nested containers (sacks, bags)
 * This handles the new inline storage architecture where items can be inside
 * container_data.contents of equipped items
 * 
 * @returns Full path information for where the item is located
 */
export function find_item_location(
    slot: number,
    instance_id: string
): {
    item: { instance: ItemInstance; definition: any };
    container_id: string;
    is_nested: boolean;
    parent_item_id?: string;
    entity_type: string;
    entity_id: string;
} | null {
    debug_log("find_item_location", `Searching for item ${instance_id} in slot ${slot}`);
    
    const base_dir = `local_data/data_slot_${slot}`;

    // Helper to search contents recursively including nested containers
    function search_contents_recursive(
        contents: ContainerContentEntry[], 
        container_id: string,
        entity_type: string,
        entity_id: string,
        parent_item_id?: string
): {
    item: { instance: ItemInstance; definition: any };
    container_id: string;
    is_nested: boolean;
    parent_item_id?: string;
    entity_type: string;
    entity_id: string;
} | null {
        for (const entry of contents) {
            // Check if this is the item we're looking for
            if (entry.instance.id === instance_id) {
                return {
                    item: entry,
                    container_id: container_id,
                    is_nested: !!parent_item_id,
                    parent_item_id,
                    entity_type,
                    entity_id
                };
            }
            
            // Check nested container
            if (entry.instance.container_data?.contents) {
                const nested = search_contents_recursive(
                    entry.instance.container_data.contents,
                    `item.${entry.instance.id}`,
                    entity_type,
                    entity_id,
                    entry.instance.id
                );
                if (nested) return nested;
            }
        }
        return null;
    }

    // Helper to search an entity's containers
    function search_entity_containers(entity_path: string, entity_type: string, entity_id: string) {
        if (!fs.existsSync(entity_path)) return null;

        try {
            const entity = read_jsonc(entity_path) as Record<string, any>;
            if (!entity.containers) return null;

            for (const [container_name, container] of Object.entries(entity.containers)) {
                const container_data = container as Container;
                const found = search_contents_recursive(
                    container_data.contents, 
                    container_data.id,
                    entity_type,
                    entity_id
                );
                if (found) return found;
            }
        } catch (err) {
            debug_error("find_item_location", `Error reading entity ${entity_id}`, err);
        }
        return null;
    }

    // Search Actors first (most common case for equipment)
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

    debug_log("find_item_location", `Item ${instance_id} not found anywhere`);
    return null;
}

import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_container_dir, get_container_path } from "../engine/paths.js";
import type { TagInstance } from "../tag_system/registry.js";
import { load_item_instance, update_item_instance_container, type ItemInstance } from "../item_instances/store.js";
import type { ContainerPosition } from "../types/container.js";

export type ContainerLookupResult =
    | { ok: true; container: Container; path: string }
    | { ok: false; error: string; todo: string };

export interface Container {
    id: string;
    kind: "actor" | "npc" | "place";
    
    /**
     * Subtype for place containers
     * - "scattered": Loose loot, auto-deletes when empty
     * - undefined: Furniture (chests, shelves), persists
     */
    subtype?: "scattered";
    
    /**
     * Position for scattered loot containers
     */
    position?: ContainerPosition;
    
    /**
     * Place ID for scattered loot containers
     */
    place_id?: string;
    
    owner_ref: string;
    
    /**
     * Interaction range in tiles (default: 1 for touch)
     */
    interaction_range: number;
    
    capacity?: {
        max_weight?: number;
        max_slots?: number;
    };
    contents: ContainerEntry[];
    tags: TagInstance[];
}

export interface ContainerEntry {
    item_instance_id: string;
}

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
    
    // Determine owner type from ID format or context
    // For now, we store it in the container itself
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
    
    const container: Container = {
        id: container_id,
        kind,
        owner_ref,
        interaction_range: 1,
        capacity,
        contents: [],
        tags: []
    };
    
    const path = save_container(slot, container);
    return { ok: true, container, path };
}

export function load_container(slot: number, container_id: string): ContainerLookupResult {
    const container_path = get_container_path(slot, container_id);
    if (!fs.existsSync(container_path)) {
        const todo = `Container cannot be found: ${container_id}`;
        return { ok: false, error: "container_not_found", todo };
    }

    const container = read_jsonc(container_path) as unknown as Container;
    return { ok: true, container, path: container_path };
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
    
    const container: Container = {
        id: container_id,
        kind: defaults.kind ?? "actor",
        owner_ref: defaults.owner_ref ?? `actor.${parsed.owner_id}`,
        interaction_range: defaults.interaction_range ?? 1,
        capacity: defaults.capacity,
        contents: [],
        tags: defaults.tags ?? []
    };
    
    const path = save_container(slot, container);
    return { ok: true, container, path };
}

export function save_container(slot: number, container: Container): string {
    ensure_container_dir(slot);
    const container_path = get_container_path(slot, container.id);
    fs.writeFileSync(container_path, JSON.stringify(container, null, 2), "utf-8");
    return container_path;
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
    const dir = ensure_container_dir(slot);
    if (!fs.existsSync(dir)) return [];
    
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".jsonc"));
    const containers: Container[] = [];
    
    for (const file of files) {
        const container_id = file.replace(".jsonc", "");
        const result = load_container(slot, container_id);
        if (result.ok && result.container.owner_ref === owner_ref) {
            containers.push(result.container);
        }
    }
    
    return containers;
}

export function get_container_contents(
    slot: number,
    container_id: string
): { instance: ItemInstance; error?: string }[] {
    const result = load_container(slot, container_id);
    if (!result.ok) return [];
    
    const contents: { instance: ItemInstance; error?: string }[] = [];
    
    for (const entry of result.container.contents) {
        const instance_result = load_item_instance(slot, entry.item_instance_id);
        if (instance_result.ok) {
            contents.push({ instance: instance_result.instance });
        } else {
            contents.push({ 
                instance: {} as ItemInstance, 
                error: `Failed to load instance ${entry.item_instance_id}` 
            });
        }
    }
    
    return contents;
}

export function add_item_to_container(
    slot: number,
    container_id: string,
    item_instance_id: string
): ContainerLookupResult {
    const result = load_container(slot, container_id);
    if (!result.ok) return result;
    
    // Check if already in container
    const exists = result.container.contents.some(
        entry => entry.item_instance_id === item_instance_id
    );
    
    if (!exists) {
        result.container.contents.push({ item_instance_id });
        save_container(slot, result.container);
    }
    
    return { ok: true, container: result.container, path: result.path };
}

export function remove_item_from_container(
    slot: number,
    container_id: string,
    item_instance_id: string
): ContainerLookupResult {
    const result = load_container(slot, container_id);
    if (!result.ok) return result;
    
    result.container.contents = result.container.contents.filter(
        entry => entry.item_instance_id !== item_instance_id
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
    to_container_id: string
): { ok: boolean; error?: string } {
    // Remove from source
    const remove_result = remove_item_from_container(slot, from_container_id, item_instance_id);
    if (!remove_result.ok) {
        return { ok: false, error: `Failed to remove from source: ${remove_result.error}` };
    }
    
    // Add to destination
    const add_result = add_item_to_container(slot, to_container_id, item_instance_id);
    if (!add_result.ok) {
        // Rollback - add back to source
        add_item_to_container(slot, from_container_id, item_instance_id);
        return { ok: false, error: `Failed to add to destination: ${add_result.error}` };
    }
    
    // Update item instance's container reference
    const update_result = update_item_instance_container(slot, item_instance_id, to_container_id);
    if (!update_result.ok) {
        // Rollback - remove from destination and add back to source
        remove_item_from_container(slot, to_container_id, item_instance_id);
        add_item_to_container(slot, from_container_id, item_instance_id);
        return { ok: false, error: `Failed to update item instance: ${update_result.error}` };
    }
    
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
    const container: Container = {
        id: container_id,
        kind: "place",
        owner_ref: "system",
        place_id: place_id,
        interaction_range: 1,
        capacity: capacity ?? { max_slots: 100, max_weight: 100000 },
        contents: [],
        tags: []
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
        tags: []
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

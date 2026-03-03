import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_item_dir, get_item_path, get_default_item_path, get_legacy_default_item_path, get_master_items_dir } from "../engine/paths.js";
import type { TagInstance } from "../tag_system/registry.js";

export type ItemDefLookupResult =
    | { ok: true; item: ItemDefinition; path: string }
    | { ok: false; error: string; todo: string };

export interface ItemDefinition {
    id: string;
    name: string;
    description: string;
    weight: number;
    weight_mag: number;
    mag: number;
    size_mag: number;
    hardness_mag: number;
    conductivity_mag: number;
    tags: TagInstance[];
    // New fields for inventory system
    max_stack_size: number;           // Max quantity per stack (default: 1)
    display_char: string;             // Single char for UI representation (default: "·")
    valid_body_slots: string[];       // ["hand_left", "chest", ...] (default: [])
    occupies_slots: string[];         // ["leg_left", "leg_right"] for multi-slot items
    slot_shape: number[][];           // [[1]] for 1x1, future tetris shapes
    fits_actor_kind: string[];        // ["naked_ape"] for race restrictions (default: ["*"])
    // Existing optional fields
    stackable?: boolean;
    container?: {
        capacity_weight?: number;
        capacity_slots?: number;
    };
    notes?: string;
}

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

/**
 * Normalize item reference to unified format (item.<id>)
 * Accepts: item.<id>, item_<id>, <id>
 * Returns: item.<id>
 */
export function normalize_item_ref(ref: string): string {
    if (!ref) return "";
    
    // Already in unified format
    if (ref.startsWith("item.")) return ref;
    
    // Legacy format with underscore
    if (ref.startsWith("item_")) {
        return `item.${ref.slice(5)}`;
    }
    
    // Bare ID - assume it's an item
    return `item.${ref}`;
}

/**
 * Extract just the ID part from a reference
 */
export function extract_item_id(ref: string): string {
    const normalized = normalize_item_ref(ref);
    return normalized.replace(/^item\./, "");
}

export function ensure_item_dir(slot: number): string {
    const dir = get_item_dir(slot);
    ensure_dir_exists(dir);
    return dir;
}

export function load_item_def(slot: number, def_id: string): ItemDefLookupResult {
    const item_path = get_item_path(slot, def_id);
    if (!fs.existsSync(item_path)) {
        const todo = `Item definition cannot be found: ${def_id}. Create new item JSONC at ${item_path}`;
        return { ok: false, error: "item_not_found", todo };
    }

    const raw = read_jsonc(item_path);
    
    // Apply defaults for new inventory system fields
    const item: ItemDefinition = {
        ...raw,
        id: String(raw.id ?? def_id),
        name: String(raw.name ?? def_id),
        description: String(raw.description ?? ""),
        weight: Number(raw.weight ?? 0),
        weight_mag: Number(raw.weight_mag ?? 0),
        mag: Number(raw.mag ?? 1),
        size_mag: Number(raw.size_mag ?? 0),
        hardness_mag: Number(raw.hardness_mag ?? 0),
        conductivity_mag: Number(raw.conductivity_mag ?? 0),
        tags: (raw.tags as TagInstance[]) ?? [],
        // New fields with defaults
        max_stack_size: Number(raw.max_stack_size ?? 1),
        display_char: String(raw.display_char ?? "·"),
        valid_body_slots: (raw.valid_body_slots as string[]) ?? [],
        occupies_slots: (raw.occupies_slots as string[]) ?? [],
        slot_shape: (raw.slot_shape as number[][]) ?? [[1]],
        fits_actor_kind: (raw.fits_actor_kind as string[]) ?? ["*"],
        // Optional fields
        stackable: raw.stackable as boolean | undefined,
        container: raw.container as { capacity_weight?: number; capacity_slots?: number } | undefined,
        notes: raw.notes as string | undefined,
    };
    
    return { ok: true, item, path: item_path };
}

/**
 * Load master item definition from categorized database
 * Searches all category directories for the item
 */
export function load_master_item(def_id: string): ItemDefLookupResult {
    const master_dir = get_master_items_dir();
    const categories = ['weapons', 'armor', 'clothing', 'containers', 'currency'];
    
    // Search all category directories
    for (const category of categories) {
        const item_path = path.join(master_dir, category, `${def_id}.jsonc`);
        if (fs.existsSync(item_path)) {
            const raw = read_jsonc(item_path);
            
            // Apply defaults
            const item: ItemDefinition = {
                ...raw,
                id: String(raw.id ?? def_id),
                name: String(raw.name ?? def_id),
                description: String(raw.description ?? ""),
                weight: Number(raw.weight ?? 0),
                weight_mag: Number(raw.weight_mag ?? 0),
                mag: Number(raw.mag ?? 1),
                size_mag: Number(raw.size_mag ?? 0),
                hardness_mag: Number(raw.hardness_mag ?? 0),
                conductivity_mag: Number(raw.conductivity_mag ?? 0),
                tags: (raw.tags as TagInstance[]) ?? [],
                max_stack_size: Number(raw.max_stack_size ?? 1),
                display_char: String(raw.display_char ?? "·"),
                valid_body_slots: [],
                occupies_slots: [],
                slot_shape: [[1]],
                fits_actor_kind: ["*"],
            };
            
            return { ok: true, item, path: item_path };
        }
    }
    
    return { 
        ok: false, 
        error: "master_item_not_found", 
        todo: `Master item definition not found: ${def_id}. Create in local_data/items/{category}/${def_id}.jsonc` 
    };
}

export function load_default_item(): ItemDefLookupResult {
    const template_path = get_default_item_path();
    if (!fs.existsSync(template_path)) {
        const legacy_path = get_legacy_default_item_path();
        if (fs.existsSync(legacy_path)) {
            const item = read_jsonc(legacy_path) as unknown as ItemDefinition;
            return { ok: true, item, path: legacy_path };
        } else {
            const todo = `Default item template missing. Create ${template_path}`;
            return { ok: false, error: "default_item_missing", todo };
        }
    }

    const item = read_jsonc(template_path) as unknown as ItemDefinition;
    return { ok: true, item, path: template_path };
}

export function ensure_item_def(slot: number, def_id: string): ItemDefLookupResult {
    const existing = load_item_def(slot, def_id);
    if (existing.ok) return existing;
    
    const template = load_default_item();
    if (!template.ok) return template;
    
    const item = { ...template.item, id: def_id, name: def_id };
    const item_path = save_item_def(slot, def_id, item);
    return { ok: true, item, path: item_path };
}

export function save_item_def(slot: number, def_id: string, item: ItemDefinition): string {
    ensure_item_dir(slot);
    const item_path = get_item_path(slot, def_id);
    fs.writeFileSync(item_path, JSON.stringify(item, null, 2), "utf-8");
    return item_path;
}

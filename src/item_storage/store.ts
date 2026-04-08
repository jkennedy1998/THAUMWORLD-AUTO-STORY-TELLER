import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_item_dir, get_item_path, get_default_item_path, get_legacy_default_item_path, get_master_items_dir } from "../engine/paths.js";
import type { TagInstance } from "../tag_system/registry.js";
import { get_max_stack_size_from_size_mag, is_size_mag_stackable, normalize_size_mag } from "../mag/size.js";
import type { GraphicsModel, MaterialOptionsBySlot } from "../render_shaders/graphics_contract.js";

export type ItemDefLookupResult =
    | { ok: true; item: ItemDefinition; path: string }
    | { ok: false; error: string; todo: string };

export interface ItemDefinition {
    id: string;
    name: string;
    description: string;
    base_value_mag?: number;
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
    display_color?: string;           // Hex color code (e.g., "#FF6B00") for rendering
    occupies_slots: string[];         // ["leg_left", "leg_right"] for multi-slot items
    slot_shape: number[][];           // [[1]] for 1x1, future tetris shapes
    fits_actor_kind: string[];        // ["naked_ape"] for race restrictions (default: ["*"])
    // Existing optional fields
    stackable?: boolean;
    container?: {
        capacity_weight?: number;
        capacity_slots?: number;
    };
    container_glyphs?: {              // Open/closed glyphs for container items
        closed: string;
        open: string;
    };
    graphics?: GraphicsModel;
    materials?: MaterialOptionsBySlot;
    notes?: string;
}

function apply_item_runtime_defaults(raw: Record<string, unknown>, def_id: string): ItemDefinition {
    const size_mag = normalize_size_mag(raw.size_mag ?? 0, 0);
    const derived_max_stack_size = get_max_stack_size_from_size_mag(size_mag);
    const derived_stackable = is_size_mag_stackable(size_mag);
    return {
        ...raw,
        id: String(raw.id ?? def_id),
        name: String(raw.name ?? def_id),
        description: String(raw.description ?? ""),
        base_value_mag: Number((raw as any).base_value_mag ?? raw.mag ?? 0),
        weight: Number(raw.weight ?? 0),
        weight_mag: Number(raw.weight_mag ?? 0),
        mag: Number(raw.mag ?? 1),
        size_mag,
        hardness_mag: Number(raw.hardness_mag ?? 0),
        conductivity_mag: Number(raw.conductivity_mag ?? 0),
        tags: (raw.tags as TagInstance[]) ?? [],
        max_stack_size: derived_max_stack_size,
        display_char: String(raw.display_char ?? "·"),
        display_color: typeof (raw as any).display_color === 'string' ? String((raw as any).display_color) : undefined,
        occupies_slots: (raw.occupies_slots as string[]) ?? [],
        slot_shape: (raw.slot_shape as number[][]) ?? [[1]],
        fits_actor_kind: (raw.fits_actor_kind as string[]) ?? ["*"],
        stackable: derived_stackable,
        container: raw.container as { capacity_weight?: number; capacity_slots?: number } | undefined,
        container_glyphs: (raw as any).container_glyphs as any,
        graphics: (raw as any).graphics as GraphicsModel | undefined,
        materials: (raw as any).materials as MaterialOptionsBySlot | undefined,
        notes: raw.notes as string | undefined,
    };
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
    const item: ItemDefinition = apply_item_runtime_defaults(raw, def_id);
    
    return { ok: true, item, path: item_path };
}

/**
 * Load master item definition from categorized database
 * Searches all category directories for the item
 */
export function load_master_item(def_id: string): ItemDefLookupResult {
    const master_dir = get_master_items_dir();
    const categories = ['weapons', 'armor', 'clothing', 'containers', 'currency', 'food'];
    
    // Search all category directories
    for (const category of categories) {
        const item_path = path.join(master_dir, category, `${def_id}.jsonc`);
        if (fs.existsSync(item_path)) {
            const raw = read_jsonc(item_path);
            
            // Apply defaults
            const item: ItemDefinition = apply_item_runtime_defaults(raw, def_id);
            
            return { ok: true, item, path: item_path };
        }
    }
    
    return { 
        ok: false, 
        error: "master_item_not_found", 
        todo: `Master item definition not found: ${def_id}. Create in local_data/items/{category}/${def_id}.jsonc` 
    };
}

export function list_master_items(): Array<{ id: string; item: ItemDefinition; path: string }> {
    const master_dir = get_master_items_dir();
    const categories = ['weapons', 'armor', 'clothing', 'containers', 'currency', 'food'];
    const results: Array<{ id: string; item: ItemDefinition; path: string }> = [];
    for (const category of categories) {
        const dir = path.join(master_dir, category);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (!name.toLowerCase().endsWith('.jsonc')) continue;
            const def_id = name.replace(/\.jsonc$/i, '');
            const loaded = load_master_item(def_id);
            if (loaded.ok) {
                results.push({ id: def_id, item: loaded.item, path: loaded.path });
            }
        }
    }
    results.sort((a, b) => a.id.localeCompare(b.id));
    return results;
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

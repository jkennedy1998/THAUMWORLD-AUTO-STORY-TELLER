import * as fs from "node:fs";
import { parse } from "jsonc-parser";
import { ensure_dir_exists } from "../engine/log_store.js";
import { get_item_dir, get_item_path, get_default_item_path, get_legacy_default_item_path } from "../engine/paths.js";
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

    const item = read_jsonc(item_path) as unknown as ItemDefinition;
    return { ok: true, item, path: item_path };
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

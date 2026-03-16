// Tile Storage Module
// Loads and manages tile definitions from categorized database
// Mirrors the item_storage/store.ts pattern

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import { get_master_tiles_dir } from "../engine/paths.js";
import type { TileDefinition, TileDefLookupResult } from "./types.js";

function read_jsonc(pathname: string): Record<string, unknown> {
    const raw = fs.readFileSync(pathname, "utf-8");
    return (parse(raw) as Record<string, unknown>) ?? {};
}

/**
 * Normalize tile reference to unified format (tile.<id>)
 * Accepts: tile.<id>, tile_<id>, <id>
 * Returns: tile.<id>
 */
export function normalize_tile_ref(ref: string): string {
    if (!ref) return "";
    
    // Already in unified format
    if (ref.startsWith("tile.")) return ref;
    
    // Legacy format with underscore
    if (ref.startsWith("tile_")) {
        return `tile.${ref.slice(5)}`;
    }
    
    // Bare ID - assume it's a tile
    return `tile.${ref}`;
}

/**
 * Extract just the ID part from a reference
 */
export function extract_tile_id(ref: string): string {
    const normalized = normalize_tile_ref(ref);
    return normalized.replace(/^tile\./, "");
}

/**
 * Load master tile definition from categorized database
 * EXACT MIRROR of load_master_item() from item_storage/store.ts
 */
export function load_master_tile(def_id: string): TileDefLookupResult {
    const master_dir = get_master_tiles_dir();
    // Categories are loose - just for programmer organization
    const categories = ['structures', 'foliage', 'terrain', 'water', 'features', 'special'];
    
    // Search all category directories
    for (const category of categories) {
        const tile_path = path.join(master_dir, category, `${def_id}.jsonc`);
        if (fs.existsSync(tile_path)) {
            const raw = read_jsonc(tile_path);
            
            // Debug: log if display_char is missing
            if (!raw.display_char) {
                console.warn(`[TILE_STORAGE] Tile ${def_id} missing display_char, defaulting to "?"`);
            }
            
            // Apply defaults (CRITICAL PATTERN - mirrors items)
            const tile: TileDefinition = {
                ...raw,
                id: String(raw.id ?? def_id),
                name: String(raw.name ?? def_id),
                description: String(raw.description ?? ""),
                weight: Number(raw.weight),
                display_char: String(raw.display_char ?? "?"),
                display_color: String(raw.display_color ?? "#888888"),
                tags: (raw.tags as TileDefinition["tags"]) ?? [],
            };
            
            // Apply container_capacity defaults if present
            if (raw.container_capacity) {
                tile.container_capacity = {
                    max_slots: Number((raw.container_capacity as Record<string, unknown>).max_slots ?? 10),
                    max_weight: Number((raw.container_capacity as Record<string, unknown>).max_weight ?? 5000),
                };
            }
            
            return { ok: true, tile, path: tile_path };
        }
    }
    
    console.warn(`[TILE_STORAGE] Tile definition not found: ${def_id}`);
    return { 
        ok: false, 
        error: "master_tile_not_found", 
        todo: `Master tile definition not found: ${def_id}. Create in local_data/tiles/{category}/${def_id}.jsonc` 
    };
}

/**
 * Check if a tile definition exists
 */
export function has_master_tile(def_id: string): boolean {
    const result = load_master_tile(def_id);
    return result.ok;
}

/**
 * Get all available tile IDs from the database
 */
export function get_all_tile_ids(): string[] {
    const master_dir = get_master_tiles_dir();
    const categories = ['structures', 'foliage', 'terrain', 'water', 'features', 'special'];
    const ids: string[] = [];
    
    for (const category of categories) {
        const category_dir = path.join(master_dir, category);
        if (!fs.existsSync(category_dir)) continue;
        
        const files = fs.readdirSync(category_dir);
        for (const file of files) {
            if (file.endsWith('.jsonc')) {
                ids.push(file.replace('.jsonc', ''));
            }
        }
    }
    
    return ids;
}

/**
 * Alias for load_master_tile for backward compatibility with inspection system
 */
export const get_tile_definition = load_master_tile;

/**
 * Get tiles by category (loose organization)
 */
export function get_tiles_by_category(category: string): TileDefinition[] {
    const master_dir = get_master_tiles_dir();
    const category_dir = path.join(master_dir, category);
    const tiles: TileDefinition[] = [];
    
    if (!fs.existsSync(category_dir)) return tiles;
    
    const files = fs.readdirSync(category_dir);
    for (const file of files) {
        if (file.endsWith('.jsonc')) {
            const def_id = file.replace('.jsonc', '');
            const result = load_master_tile(def_id);
            if (result.ok) {
                tiles.push(result.tile);
            }
        }
    }
    
    return tiles;
}

/**
 * Find tiles by tag
 */
export function get_tiles_by_tag(tag_name: string): TileDefinition[] {
    const all_ids = get_all_tile_ids();
    const tiles: TileDefinition[] = [];
    
    for (const def_id of all_ids) {
        const result = load_master_tile(def_id);
        if (result.ok && result.tile.tags.some(t => t.name === tag_name)) {
            tiles.push(result.tile);
        }
    }
    
    return tiles;
}

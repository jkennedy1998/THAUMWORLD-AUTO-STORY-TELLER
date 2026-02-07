// Tile Storage Module
// Loads and manages tile definitions from databank

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "jsonc-parser";
import type { TileDefinition, TileDatabank } from "./types.js";

const DEFAULT_TILES_PATH = "local_data/shared/tiles/default_tiles.jsonc";

let tileCache: Map<string, TileDefinition> | null = null;

/**
 * Load the tile databank from disk
 */
export function load_tile_databank(): TileDatabank | null {
  try {
    const fullPath = path.resolve(DEFAULT_TILES_PATH);
    
    if (!fs.existsSync(fullPath)) {
      console.warn(`[TileStorage] Tile databank not found: ${fullPath}`);
      return null;
    }

    const raw = fs.readFileSync(fullPath, "utf-8");
    const databank = parse(raw) as TileDatabank;
    
    if (!databank || !Array.isArray(databank.tiles)) {
      console.error("[TileStorage] Invalid tile databank format");
      return null;
    }

    return databank;
  } catch (error) {
    console.error("[TileStorage] Error loading tile databank:", error);
    return null;
  }
}

/**
 * Load all tiles into cache
 */
export function load_tile_cache(): Map<string, TileDefinition> {
  if (tileCache) {
    return tileCache;
  }

  tileCache = new Map();
  const databank = load_tile_databank();
  
  if (databank) {
    for (const tile of databank.tiles) {
      tileCache.set(tile.id, tile);
    }
  }

  return tileCache;
}

/**
 * Get a tile definition by ID
 */
export function get_tile_definition(tile_id: string): TileDefinition | null {
  const cache = load_tile_cache();
  return cache.get(tile_id) || null;
}

/**
 * Get a deterministic variant character for a tile based on position
 * This ensures the same tile at the same position always looks the same
 */
export function get_tile_variant(tile_id: string, x: number, y: number): string {
  const tile = get_tile_definition(tile_id);
  if (!tile) return "?";

  // Use position to deterministically select variant
  if (tile.display.variant_chars && tile.display.variant_chars.length > 0) {
    const variantIndex = Math.abs((x * 31 + y * 17) % tile.display.variant_chars.length);
    return tile.display.variant_chars[variantIndex]!;
  }

  return tile.display.char;
}

/**
 * Get all tiles by category
 */
export function get_tiles_by_category(category: string): TileDefinition[] {
  const cache = load_tile_cache();
  return Array.from(cache.values()).filter(tile => tile.category === category);
}

/**
 * Search tiles by tag
 */
export function get_tiles_by_tag(tag: string): TileDefinition[] {
  const cache = load_tile_cache();
  return Array.from(cache.values()).filter(tile => tile.tags.includes(tag));
}

/**
 * Clear the tile cache (useful for reloading)
 */
export function clear_tile_cache(): void {
  tileCache = null;
}

/**
 * Get all available tile IDs
 */
export function get_all_tile_ids(): string[] {
  const cache = load_tile_cache();
  return Array.from(cache.keys());
}

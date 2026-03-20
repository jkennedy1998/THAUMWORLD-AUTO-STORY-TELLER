import type { Place, PlaceTile, PlaceTiles } from "../types/place.js";
import { load_master_tile } from "../tile_storage/store.js";
import { has_tag_name, resolve_tile_physics_tags } from "../shared/physics_tags.js";

function clamp_int(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function interior_bounds(place: Place): { min_x: number; max_x: number; min_y: number; max_y: number } {
  // Interior excludes the perimeter ring.
  const w = place.tile_grid.width;
  const h = place.tile_grid.height;
  if (w <= 2 || h <= 2) {
    return { min_x: 0, max_x: Math.max(0, w - 1), min_y: 0, max_y: Math.max(0, h - 1) };
  }
  return { min_x: 1, max_x: w - 2, min_y: 1, max_y: h - 2 };
}

/**
 * Create a PlaceTile instance from a tile definition.
 * Copies base tags and container capacity from the definition.
 */
function create_tile_from_definition(def_id: string, overrides?: Partial<PlaceTile>): PlaceTile {
  const tile: PlaceTile = {
    kind: def_id,
  };

  const result = load_master_tile(def_id);

  if (result.ok && result.tile.container_capacity) {
    tile.container_capacity = { ...result.tile.container_capacity };
  }

  if (overrides) Object.assign(tile, overrides);
  return tile;
}

function make_tiles(w: number, h: number): PlaceTiles {
  const cells: (PlaceTile | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row: (PlaceTile | null)[] = [];
    for (let x = 0; x < w; x++) row.push(null);
    cells.push(row);
  }
  return { width: w, height: h, cells: cells as any };
}

function make_filled_tiles(w: number, h: number, def_id: string): PlaceTiles {
  const cells: (PlaceTile | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row: (PlaceTile | null)[] = [];
    for (let x = 0; x < w; x++) row.push(create_tile_from_definition(def_id));
    cells.push(row);
  }
  return { width: w, height: h, cells: cells as any };
}

function set_tile(tiles: PlaceTiles, x: number, y: number, t: PlaceTile | null): void {
  const row = (tiles.cells as any)?.[y];
  if (!row) return;
  if (x < 0 || x >= tiles.width) return;
  row[x] = t;
}

function get_tile(tiles: PlaceTiles, x: number, y: number): PlaceTile | null {
  const row = (tiles.cells as any)?.[y];
  if (!row) return null;
  const t = row[x];
  return t ?? null;
}

export function tile_blocks_movement(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  return resolve_tile_physics_tags(tile).occupies;
}

export function tile_blocks_los(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  return has_tag_name(resolve_tile_physics_tags(tile).effective_tags, "COVER");
}

export function tile_is_door(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  return has_tag_name(resolve_tile_physics_tags(tile).effective_tags, "DOOR");
}

export function tile_is_connector(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  return has_tag_name(resolve_tile_physics_tags(tile).effective_tags, "CONNECTOR");
}

export function tile_is_container(tile: PlaceTile | null): boolean {
  if (!tile) return false;
  return resolve_tile_physics_tags(tile).container;
}

export function ensure_place_tiles(place: Place): { changed: boolean } {
  const w = Math.max(1, Math.floor(place.tile_grid.width));
  const h = Math.max(1, Math.floor(place.tile_grid.height));
  let changed = false;

  // Do not auto-generate a support-floor layer.
  // Bottom/support visuals must come from authored content or explicit structures.

  const needs_new =
    !place.tiles ||
    place.tiles.width !== w ||
    place.tiles.height !== h ||
    !Array.isArray((place.tiles as any).cells) ||
    (place.tiles as any).cells.length !== h;

  if (needs_new) {
    place.tiles = make_tiles(w, h);
    changed = true;
  }

  const tiles = place.tiles!;

  // Ensure every row is correct length; preserve existing cells.
  for (let y = 0; y < h; y++) {
    const row = (tiles.cells as any)?.[y];
    if (!row || row.length !== w) {
      const next: (PlaceTile | null)[] = [];
      for (let x = 0; x < w; x++) {
        const cur = row && Array.isArray(row) ? row[x] : null;
        next.push(cur ?? null);
      }
      (tiles.cells as any)[y] = next;
      changed = true;
    }
  }

  // Do not auto-stamp an interior perimeter wall ring.
  // Border walls/connectors now live in scene-space border rendering, not in authored place tiles.

  // Legacy derived door stamping removed.
  // Connector rendering will be driven by canonical place/region connector topology.

  // Keep default entry in-bounds.
  const b = { min_x: 0, max_x: Math.max(0, w - 1), min_y: 0, max_y: Math.max(0, h - 1) };
  const ex = clamp_int(place.tile_grid.default_entry.x, b.min_x, b.max_x);
  const ey = clamp_int(place.tile_grid.default_entry.y, b.min_y, b.max_y);
  if (ex !== place.tile_grid.default_entry.x || ey !== place.tile_grid.default_entry.y) {
    place.tile_grid.default_entry = { x: ex, y: ey };
    changed = true;
  }

  return { changed };
}

export function ensure_place_entities_not_on_walls(place: Place): { changed: boolean } {
  // Border walls are scene-space only now; authored place interiors may use edge tiles.
  void place;
  return { changed: false };
}

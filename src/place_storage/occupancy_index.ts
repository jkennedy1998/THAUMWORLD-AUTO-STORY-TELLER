import type { Place } from "../types/place.js";
import type { PlaceTile } from "../types/place.js";
import { tile_blocks_los, tile_blocks_movement } from "./tiles.js";

export type PlaceOccupancyIndex = {
  width: number;
  height: number;

  // Movement blockers on the walking plane (z=1).
  blocks_movement_z1: boolean[][];

  // LOS blockers on z=1 (initially same as OCCUPIES semantics).
  blocks_los_z1: boolean[][];

  // Support map for z=0 (true means solid support exists).
  supports_z0: boolean[][] | null;
};

const cache = new WeakMap<Place, PlaceOccupancyIndex>();

function make_bool_grid(w: number, h: number, fill: boolean): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) row.push(fill);
    rows.push(row);
  }
  return rows;
}

function get_tile(tiles_obj: any, x: number, y: number): PlaceTile | null {
  try {
    const t = tiles_obj?.cells?.[y]?.[x];
    return (t as any) ?? null;
  } catch {
    return null;
  }
}

export function get_place_occupancy_index(place: Place): PlaceOccupancyIndex {
  const hit = cache.get(place);
  if (hit) return hit;

  const w = Math.max(1, Math.floor(place.tile_grid.width));
  const h = Math.max(1, Math.floor(place.tile_grid.height));

  const blocks_z1 = make_bool_grid(w, h, false);
  const blocks_los_z1 = make_bool_grid(w, h, false);
  const supports_z0 = (place as any)?.tiles_z0 ? make_bool_grid(w, h, false) : null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t1 = get_tile((place as any)?.tiles, x, y);
      const b = tile_blocks_movement(t1);
      blocks_z1[y]![x] = b;
      blocks_los_z1[y]![x] = tile_blocks_los(t1);

      if (supports_z0) {
        const t0 = get_tile((place as any)?.tiles_z0, x, y);
        supports_z0[y]![x] = tile_blocks_movement(t0);
      }
    }
  }

  const idx: PlaceOccupancyIndex = {
    width: w,
    height: h,
    blocks_movement_z1: blocks_z1,
    blocks_los_z1,
    supports_z0,
  };
  cache.set(place, idx);
  return idx;
}

export function place_tile_blocks_movement(place: Place, x: number, y: number): boolean {
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;
  if (idx.blocks_movement_z1[y]?.[x]) return true;
  if (idx.supports_z0 && !idx.supports_z0[y]?.[x]) return true;
  return false;
}

export function place_tile_blocks_los(place: Place, x: number, y: number): boolean {
  const idx = get_place_occupancy_index(place);
  if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;
  return !!idx.blocks_los_z1[y]?.[x];
}

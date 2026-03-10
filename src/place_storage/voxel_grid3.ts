import type { Place } from "../types/place.js";
import type { PlaceTile } from "../types/place.js";
import { get_place_occupancy_index, place_tile_blocks_los, place_tile_blocks_movement } from "./occupancy_index.js";

export type WorldZ = 0 | 1 | 2;

export type PlaceVoxelGrid3 = {
  width: number;
  height: number;

  // Tile instances live on z=0 (support) and z=1 (structures).
  get_tile: (x: number, y: number, z: WorldZ) => PlaceTile | null;

  // Semantics (initial):
  // - movement: walking plane is z=1; z=0 must support
  // - LOS: uses z=1 blockers
  blocks_movement: (x: number, y: number, z: WorldZ) => boolean;
  blocks_los: (x: number, y: number, z: WorldZ) => boolean;
};

function get_tile(place: Place, x: number, y: number, z: WorldZ): PlaceTile | null {
  try {
    if (z === 0) return ((place as any)?.tiles_z0?.cells?.[y]?.[x] ?? null) as any;
    if (z === 1) return ((place as any)?.tiles?.cells?.[y]?.[x] ?? null) as any;
    return null;
  } catch {
    return null;
  }
}

export function make_place_voxel_grid3(place: Place): PlaceVoxelGrid3 {
  const idx = get_place_occupancy_index(place);
  return {
    width: idx.width,
    height: idx.height,
    get_tile: (x, y, z) => get_tile(place, x, y, z),

    blocks_movement: (x, y, z) => {
      if (z === 1) return place_tile_blocks_movement(place, x, y);
      if (z === 0) {
        // Support layer: "blocked" means there's no support.
        if (!idx.supports_z0) return false;
        if (x < 0 || y < 0 || x >= idx.width || y >= idx.height) return true;
        return !idx.supports_z0[y]?.[x];
      }
      return false;
    },

    blocks_los: (x, y, z) => {
      if (z !== 1) return false;
      return place_tile_blocks_los(place, x, y);
    },
  };
}

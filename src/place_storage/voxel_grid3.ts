import type { Place } from "../types/place.js";
import type { PlaceTile } from "../types/place.js";
import { get_place_occupancy_index, place_voxel_blocks_los, place_voxel_blocks_movement } from "./occupancy_index.js";

// Absolute world-z.
export type WorldZ = number;

export type PlaceVoxelGrid3 = {
  width: number;
  height: number;

  // Tile instances are authored on:
  // - tiles_z0 at world_z = base_z - 1
  // - tiles at world_z = base_z
  get_tile: (x: number, y: number, world_z: WorldZ) => PlaceTile | null;

  // Semantics (initial):
  // - movement: walking plane is z=1; z=0 must support
  // - LOS: uses z=1 blockers
  blocks_movement: (x: number, y: number, world_z: WorldZ) => boolean;
  blocks_los: (x: number, y: number, world_z: WorldZ) => boolean;
};

function get_place_base_z(place: Place): number {
  try {
    const z = Number((place as any)?.coordinates?.elevation);
    return Number.isFinite(z) ? Math.floor(z) : 0;
  } catch {
    return 0;
  }
}

function get_tile(place: Place, x: number, y: number, world_z: WorldZ): PlaceTile | null {
  try {
    const base_z = get_place_base_z(place);
    const wz = Math.floor(Number(world_z));
    if (!Number.isFinite(wz)) return null;
    if (wz === base_z - 1) return ((place as any)?.tiles_z0?.cells?.[y]?.[x] ?? null) as any;
    if (wz === base_z) return ((place as any)?.tiles?.cells?.[y]?.[x] ?? null) as any;
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
    get_tile: (x, y, world_z) => get_tile(place, x, y, world_z),

    blocks_movement: (x, y, world_z) => place_voxel_blocks_movement(place, x, y, world_z),
    blocks_los: (x, y, world_z) => place_voxel_blocks_los(place, x, y, world_z),
  };
}

import type { Place } from "../types/place.js";
import type { PlaceTile } from "../types/place.js";
import { get_place_tile_at_world_z } from "../shared/place_layers.js";
import { get_place_occupancy_index, place_voxel_blocks_los, place_voxel_blocks_movement } from "./occupancy_index.js";

// Absolute world-z.
export type WorldZ = number;

export type PlaceVoxelGrid3 = {
  width: number;
  height: number;

  // Tile instances are authored on:
  // - tiles_z0 at world_z = base_z - 1
  // - tiles_z1 at world_z = base_z + 1, etc.
  // - tiles at world_z = base_z
  get_tile: (x: number, y: number, world_z: WorldZ) => PlaceTile | null;

  // Semantics (initial):
  // - movement and LOS currently consult authored blockers on the base layer
  blocks_movement: (x: number, y: number, world_z: WorldZ) => boolean;
  blocks_los: (x: number, y: number, world_z: WorldZ) => boolean;
};

function get_tile(place: Place, x: number, y: number, world_z: WorldZ): PlaceTile | null {
  return get_place_tile_at_world_z(place, x, y, world_z);
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

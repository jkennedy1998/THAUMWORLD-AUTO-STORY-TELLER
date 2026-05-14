import type { Voxel3 } from '../coords.js';
import { trunc_voxel3, voxel3 } from '../coords.js';

export type Raster3<T> = {
  origin: Voxel3;
  width: number;
  height: number;
  depth: number;
  data: T[];
};

export function create_raster3<T>(args: {
  origin?: Voxel3;
  width: number;
  height: number;
  depth: number;
  fill: T;
}): Raster3<T> {
  const width = Math.max(0, Math.trunc(args.width));
  const height = Math.max(0, Math.trunc(args.height));
  const depth = Math.max(0, Math.trunc(args.depth));
  return {
    origin: trunc_voxel3(args.origin ?? voxel3(0, 0, 0)),
    width,
    height,
    depth,
    data: Array.from({ length: width * height * depth }, () => args.fill),
  };
}

export function raster3_index<T>(raster: Raster3<T>, x: number, y: number, z: number): number | null {
  const tx = Math.trunc(x);
  const ty = Math.trunc(y);
  const tz = Math.trunc(z);
  const local_x = tx - raster.origin.x;
  const local_y = ty - raster.origin.y;
  const local_z = tz - raster.origin.z;
  if (
    local_x < 0 ||
    local_y < 0 ||
    local_z < 0 ||
    local_x >= raster.width ||
    local_y >= raster.height ||
    local_z >= raster.depth
  ) {
    return null;
  }
  return local_z * raster.width * raster.height + local_y * raster.width + local_x;
}

export function raster3_in_bounds<T>(raster: Raster3<T>, x: number, y: number, z: number): boolean {
  return raster3_index(raster, x, y, z) != null;
}

export function raster3_get<T>(raster: Raster3<T>, x: number, y: number, z: number): T | undefined {
  const index = raster3_index(raster, x, y, z);
  return index == null ? undefined : raster.data[index];
}

export function raster3_set<T>(raster: Raster3<T>, x: number, y: number, z: number, value: T): boolean {
  const index = raster3_index(raster, x, y, z);
  if (index == null) return false;
  raster.data[index] = value;
  return true;
}

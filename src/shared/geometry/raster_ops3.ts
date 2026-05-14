import { trace_line_3d } from '../math3d.js';
import type { Voxel3 } from '../coords.js';
import type { Raster3 } from './raster3.js';
import { raster3_set } from './raster3.js';

export function draw_line_3d<T>(
  raster: Raster3<T>,
  value: T,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  trace_line_3d(
    { x: Math.trunc(x0), y: Math.trunc(y0), z: Math.trunc(z0) },
    { x: Math.trunc(x1), y: Math.trunc(y1), z: Math.trunc(z1) },
    (point) => {
      raster3_set(raster, point.x, point.y, point.z, value);
    },
  );
}

export function draw_box_volume_3d<T>(
  raster: Raster3<T>,
  value: T,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const min_x = Math.min(Math.trunc(x0), Math.trunc(x1));
  const max_x = Math.max(Math.trunc(x0), Math.trunc(x1));
  const min_y = Math.min(Math.trunc(y0), Math.trunc(y1));
  const max_y = Math.max(Math.trunc(y0), Math.trunc(y1));
  const min_z = Math.min(Math.trunc(z0), Math.trunc(z1));
  const max_z = Math.max(Math.trunc(z0), Math.trunc(z1));
  for (let z = min_z; z <= max_z; z += 1) {
    for (let y = min_y; y <= max_y; y += 1) {
      for (let x = min_x; x <= max_x; x += 1) {
        raster3_set(raster, x, y, z, value);
      }
    }
  }
}

export function draw_box_outline_3d<T>(
  raster: Raster3<T>,
  value: T,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const min_x = Math.min(Math.trunc(x0), Math.trunc(x1));
  const max_x = Math.max(Math.trunc(x0), Math.trunc(x1));
  const min_y = Math.min(Math.trunc(y0), Math.trunc(y1));
  const max_y = Math.max(Math.trunc(y0), Math.trunc(y1));
  const min_z = Math.min(Math.trunc(z0), Math.trunc(z1));
  const max_z = Math.max(Math.trunc(z0), Math.trunc(z1));
  for (let z = min_z; z <= max_z; z += 1) {
    for (let y = min_y; y <= max_y; y += 1) {
      for (let x = min_x; x <= max_x; x += 1) {
        let boundary_axes = 0;
        if (x === min_x || x === max_x) boundary_axes += 1;
        if (y === min_y || y === max_y) boundary_axes += 1;
        if (z === min_z || z === max_z) boundary_axes += 1;
        if (boundary_axes < 2) continue;
        raster3_set(raster, x, y, z, value);
      }
    }
  }
}

export function raster3_active_voxels<T>(raster: Raster3<T>, is_active: (value: T) => boolean): Voxel3[] {
  const voxels: Voxel3[] = [];
  for (let local_z = 0; local_z < raster.depth; local_z += 1) {
    for (let local_y = 0; local_y < raster.height; local_y += 1) {
      for (let local_x = 0; local_x < raster.width; local_x += 1) {
        const index = local_z * raster.width * raster.height + local_y * raster.width + local_x;
        const value = raster.data[index]!;
        if (!is_active(value)) continue;
        voxels.push({
          x: raster.origin.x + local_x,
          y: raster.origin.y + local_y,
          z: raster.origin.z + local_z,
        });
      }
    }
  }
  return voxels;
}

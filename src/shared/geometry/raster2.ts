import type { Point2 } from '../coords.js';
import { point2, trunc_point2 } from '../coords.js';

export type Raster2<T> = {
  origin: Point2;
  width: number;
  height: number;
  data: T[];
};

export function create_raster2<T>(args: {
  origin?: Point2;
  width: number;
  height: number;
  fill: T;
}): Raster2<T> {
  const width = Math.max(0, Math.trunc(args.width));
  const height = Math.max(0, Math.trunc(args.height));
  return {
    origin: trunc_point2(args.origin ?? point2(0, 0)),
    width,
    height,
    data: Array.from({ length: width * height }, () => args.fill),
  };
}

export function raster2_index<T>(raster: Raster2<T>, x: number, y: number): number | null {
  const tx = Math.trunc(x);
  const ty = Math.trunc(y);
  const local_x = tx - raster.origin.x;
  const local_y = ty - raster.origin.y;
  if (local_x < 0 || local_y < 0 || local_x >= raster.width || local_y >= raster.height) return null;
  return local_y * raster.width + local_x;
}

export function raster2_in_bounds<T>(raster: Raster2<T>, x: number, y: number): boolean {
  return raster2_index(raster, x, y) != null;
}

export function raster2_get<T>(raster: Raster2<T>, x: number, y: number): T | undefined {
  const index = raster2_index(raster, x, y);
  return index == null ? undefined : raster.data[index];
}

export function raster2_set<T>(raster: Raster2<T>, x: number, y: number, value: T): boolean {
  const index = raster2_index(raster, x, y);
  if (index == null) return false;
  raster.data[index] = value;
  return true;
}

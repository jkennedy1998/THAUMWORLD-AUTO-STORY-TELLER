import type { Point2 } from '../coords.js';
import { trace_line_2d } from '../math3d.js';
import type { Raster2 } from './raster2.js';
import { raster2_set } from './raster2.js';

export function draw_line_2d<T>(raster: Raster2<T>, value: T, x0: number, y0: number, x1: number, y1: number): void {
  trace_line_2d({ x: x0, y: y0 }, { x: x1, y: y1 }, (point) => {
    raster2_set(raster, point.x, point.y, value);
  });
}

export function draw_rect_fill_2d<T>(
  raster: Raster2<T>,
  value: T,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const min_x = Math.min(Math.trunc(x0), Math.trunc(x1));
  const max_x = Math.max(Math.trunc(x0), Math.trunc(x1));
  const min_y = Math.min(Math.trunc(y0), Math.trunc(y1));
  const max_y = Math.max(Math.trunc(y0), Math.trunc(y1));
  for (let y = min_y; y <= max_y; y += 1) {
    for (let x = min_x; x <= max_x; x += 1) {
      raster2_set(raster, x, y, value);
    }
  }
}

export function draw_rect_stroke_2d<T>(
  raster: Raster2<T>,
  value: T,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const min_x = Math.min(Math.trunc(x0), Math.trunc(x1));
  const max_x = Math.max(Math.trunc(x0), Math.trunc(x1));
  const min_y = Math.min(Math.trunc(y0), Math.trunc(y1));
  const max_y = Math.max(Math.trunc(y0), Math.trunc(y1));
  for (let x = min_x; x <= max_x; x += 1) {
    raster2_set(raster, x, min_y, value);
    if (max_y !== min_y) raster2_set(raster, x, max_y, value);
  }
  for (let y = min_y + 1; y < max_y; y += 1) {
    raster2_set(raster, min_x, y, value);
    if (max_x !== min_x) raster2_set(raster, max_x, y, value);
  }
}

export function raster2_active_points<T>(raster: Raster2<T>, is_active: (value: T) => boolean): Point2[] {
  const points: Point2[] = [];
  for (let local_y = 0; local_y < raster.height; local_y += 1) {
    for (let local_x = 0; local_x < raster.width; local_x += 1) {
      const index = local_y * raster.width + local_x;
      const value = raster.data[index]!;
      if (!is_active(value)) continue;
      points.push({
        x: raster.origin.x + local_x,
        y: raster.origin.y + local_y,
      });
    }
  }
  return points;
}

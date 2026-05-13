import { trace_line_2d } from '../math3d.js';
import type { PlaneId, PlanePoint, Point2, Voxel3 } from '../coords.js';
import { unproject_plane_to_voxel } from '../plane_coords.js';

export type RasterPoint2 = Point2;

export function normalize_rect_2d(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { min_x: number; max_x: number; min_y: number; max_y: number } {
  return {
    min_x: Math.min(Math.trunc(x0), Math.trunc(x1)),
    max_x: Math.max(Math.trunc(x0), Math.trunc(x1)),
    min_y: Math.min(Math.trunc(y0), Math.trunc(y1)),
    max_y: Math.max(Math.trunc(y0), Math.trunc(y1)),
  };
}

export function get_line_points(x0: number, y0: number, x1: number, y1: number): RasterPoint2[] {
  const points: RasterPoint2[] = [];
  trace_line_2d({ x: x0, y: y0 }, { x: x1, y: y1 }, (point) => {
    points.push(point);
  });
  return points;
}

export function get_rect_stroke_points(x0: number, y0: number, x1: number, y1: number): RasterPoint2[] {
  const { min_x, max_x, min_y, max_y } = normalize_rect_2d(x0, y0, x1, y1);
  const points: RasterPoint2[] = [];
  for (let x = min_x; x <= max_x; x += 1) {
    points.push({ x, y: min_y });
    if (max_y !== min_y) points.push({ x, y: max_y });
  }
  for (let y = min_y + 1; y < max_y; y += 1) {
    points.push({ x: min_x, y });
    if (max_x !== min_x) points.push({ x: max_x, y });
  }
  return points;
}

export function get_rect_fill_points(x0: number, y0: number, x1: number, y1: number): RasterPoint2[] {
  const { min_x, max_x, min_y, max_y } = normalize_rect_2d(x0, y0, x1, y1);
  const points: RasterPoint2[] = [];
  for (let y = min_y; y <= max_y; y += 1) {
    for (let x = min_x; x <= max_x; x += 1) {
      points.push({ x, y });
    }
  }
  return points;
}

export function get_line_plane_points(start: PlanePoint, end: PlanePoint): PlanePoint[] {
  return get_line_points(start.u, start.v, end.u, end.v).map((point) => ({ u: point.x, v: point.y }));
}

export function get_rect_stroke_plane_points(start: PlanePoint, end: PlanePoint): PlanePoint[] {
  return get_rect_stroke_points(start.u, start.v, end.u, end.v).map((point) => ({ u: point.x, v: point.y }));
}

export function get_rect_fill_plane_points(start: PlanePoint, end: PlanePoint): PlanePoint[] {
  return get_rect_fill_points(start.u, start.v, end.u, end.v).map((point) => ({ u: point.x, v: point.y }));
}

export function map_plane_points_to_voxels(points: PlanePoint[], plane: PlaneId, depth: number): Voxel3[] {
  return points.map((point) => unproject_plane_to_voxel(point, plane, depth));
}

import type { PlaneId, PlanePoint, Point2, Voxel3 } from '../coords.js';
import { unproject_plane_to_voxel } from '../plane_coords.js';
import { rasterize_line2_to_points, rasterize_rect2_to_points } from './shape_rasterize2.js';

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
  return rasterize_line2_to_points({ x0, y0, x1, y1 });
}

export function get_rect_stroke_points(x0: number, y0: number, x1: number, y1: number): RasterPoint2[] {
  return rasterize_rect2_to_points({ x0, y0, x1, y1 }, 'edge');
}

export function get_rect_fill_points(x0: number, y0: number, x1: number, y1: number): RasterPoint2[] {
  return rasterize_rect2_to_points({ x0, y0, x1, y1 }, 'fill');
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

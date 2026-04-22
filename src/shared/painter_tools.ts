import { trace_line_2d, trace_line_3d } from './math3d.js';
import type { PlaneId, PlanePoint, Point2, Voxel3 } from './coords.js';
import { key_point2, key_voxel3, trunc_voxel3, voxel3 } from './coords.js';
import { unproject_plane_to_voxel } from './plane_coords.js';

export type PainterPoint = Point2;

export function normalize_painter_rect(
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

export function get_line_points(x0: number, y0: number, x1: number, y1: number): PainterPoint[] {
  const points: PainterPoint[] = [];
  trace_line_2d({ x: x0, y: y0 }, { x: x1, y: y1 }, (point) => {
    points.push(point);
  });
  return points;
}

export type PainterLineRenderMethod = 'voxel_dda';

export function get_line_voxels_3d(
  start: Voxel3,
  end: Voxel3,
  method: PainterLineRenderMethod = 'voxel_dda',
): Voxel3[] {
  const normalizedStart = trunc_voxel3(start);
  const normalizedEnd = trunc_voxel3(end);
  const voxels: Voxel3[] = [];
  const seen = new Set<string>();

  switch (method) {
    case 'voxel_dda':
    default:
      trace_line_3d(normalizedStart, normalizedEnd, (point) => {
        const voxel = voxel3(point.x, point.y, point.z);
        const key = key_voxel3(voxel);
        if (seen.has(key)) return;
        seen.add(key);
        voxels.push(voxel);
      });
      return voxels;
  }
}

export function get_rect_stroke_points(x0: number, y0: number, x1: number, y1: number): PainterPoint[] {
  const { min_x, max_x, min_y, max_y } = normalize_painter_rect(x0, y0, x1, y1);
  const points: PainterPoint[] = [];
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

export function get_rect_fill_points(x0: number, y0: number, x1: number, y1: number): PainterPoint[] {
  const { min_x, max_x, min_y, max_y } = normalize_painter_rect(x0, y0, x1, y1);
  const points: PainterPoint[] = [];
  for (let y = min_y; y <= max_y; y += 1) {
    for (let x = min_x; x <= max_x; x += 1) {
      points.push({ x, y });
    }
  }
  return points;
}

export function get_flood_fill_points<T>(
  start_x: number,
  start_y: number,
  sample: (x: number, y: number) => T | null,
  matches: (candidate: T, target: T) => boolean,
): PainterPoint[] {
  const target = sample(start_x, start_y);
  if (target == null) return [];

  const out: PainterPoint[] = [];
  const stack: Array<[number, number]> = [[Math.trunc(start_x), Math.trunc(start_y)]];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const candidate = sample(x, y);
    if (candidate == null || !matches(candidate, target)) continue;

    out.push({ x, y });
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  return out;
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

export function dedupe_painter_points(points: PainterPoint[]): PainterPoint[] {
  const out: PainterPoint[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    const key = key_point2(point);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out;
}

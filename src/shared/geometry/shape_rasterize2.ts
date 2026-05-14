import type { Point2 } from '../coords.js';
import type { Raster2 } from './raster2.js';
import { create_raster2 } from './raster2.js';
import { draw_line_2d, draw_rect_fill_2d, draw_rect_stroke_2d, raster2_active_points } from './raster_ops2.js';
import type { Line2Spec, Polygon2Spec, Rect2Spec, ShapeRenderMode2 } from './shape_specs.js';

function normalize_line2_spec(spec: Line2Spec): { min_x: number; max_x: number; min_y: number; max_y: number } {
  return {
    min_x: Math.min(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    max_x: Math.max(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    min_y: Math.min(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    max_y: Math.max(Math.trunc(spec.y0), Math.trunc(spec.y1)),
  };
}

function normalize_polygon2_spec(spec: Polygon2Spec): { min_x: number; max_x: number; min_y: number; max_y: number } {
  const points = spec.points.map((point) => ({ x: Math.trunc(point.x), y: Math.trunc(point.y) }));
  const first = points[0] ?? { x: 0, y: 0 };
  let min_x = first.x;
  let max_x = first.x;
  let min_y = first.y;
  let max_y = first.y;
  for (const point of points) {
    min_x = Math.min(min_x, point.x);
    max_x = Math.max(max_x, point.x);
    min_y = Math.min(min_y, point.y);
    max_y = Math.max(max_y, point.y);
  }
  return { min_x, max_x, min_y, max_y };
}

function normalize_rect2_spec(spec: Rect2Spec): { min_x: number; max_x: number; min_y: number; max_y: number } {
  return {
    min_x: Math.min(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    max_x: Math.max(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    min_y: Math.min(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    max_y: Math.max(Math.trunc(spec.y0), Math.trunc(spec.y1)),
  };
}

export function rasterize_line2_into_raster<T>(
  raster: Raster2<T>,
  spec: Line2Spec,
  value: T,
): void {
  draw_line_2d(raster, value, spec.x0, spec.y0, spec.x1, spec.y1);
}

export function rasterize_line2_to_points(spec: Line2Spec): Point2[] {
  const { min_x, max_x, min_y, max_y } = normalize_line2_spec(spec);
  const raster = create_raster2<boolean>({
    origin: { x: min_x, y: min_y },
    width: max_x - min_x + 1,
    height: max_y - min_y + 1,
    fill: false,
  });
  rasterize_line2_into_raster(raster, spec, true);
  return raster2_active_points(raster, Boolean);
}

export function rasterize_polygon2_into_raster<T>(
  raster: Raster2<T>,
  spec: Polygon2Spec,
  mode: ShapeRenderMode2,
  value: T,
): void {
  const points = spec.points.map((point) => ({ x: Math.trunc(point.x), y: Math.trunc(point.y) }));
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    draw_line_2d(raster, value, p1.x, p1.y, p2.x, p2.y);
  }
  if (mode !== 'fill' || points.length < 3) return;
  const { min_y, max_y } = normalize_polygon2_spec(spec);
  for (let y = min_y; y <= max_y; y += 1) {
    const intersections: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const p1 = points[i]!;
      const p2 = points[(i + 1) % points.length]!;
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        const x = p1.x + t * (p2.x - p1.x);
        intersections.push(Math.round(x));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      draw_rect_fill_2d(raster, value, intersections[i]!, y, intersections[i + 1]!, y);
    }
  }
}

export function rasterize_polygon2_to_points(spec: Polygon2Spec, mode: ShapeRenderMode2): Point2[] {
  const { min_x, max_x, min_y, max_y } = normalize_polygon2_spec(spec);
  const raster = create_raster2<boolean>({
    origin: { x: min_x, y: min_y },
    width: max_x - min_x + 1,
    height: max_y - min_y + 1,
    fill: false,
  });
  rasterize_polygon2_into_raster(raster, spec, mode, true);
  return raster2_active_points(raster, Boolean);
}

export function rasterize_rect2_into_raster<T>(
  raster: Raster2<T>,
  spec: Rect2Spec,
  mode: ShapeRenderMode2,
  value: T,
): void {
  switch (mode) {
    case 'edge':
      draw_rect_stroke_2d(raster, value, spec.x0, spec.y0, spec.x1, spec.y1);
      return;
    case 'fill':
    default:
      draw_rect_fill_2d(raster, value, spec.x0, spec.y0, spec.x1, spec.y1);
      return;
  }
}

export function rasterize_rect2_to_points(spec: Rect2Spec, mode: ShapeRenderMode2): Point2[] {
  const { min_x, max_x, min_y, max_y } = normalize_rect2_spec(spec);
  const raster = create_raster2<boolean>({
    origin: { x: min_x, y: min_y },
    width: max_x - min_x + 1,
    height: max_y - min_y + 1,
    fill: false,
  });
  rasterize_rect2_into_raster(raster, spec, mode, true);
  return raster2_active_points(raster, Boolean);
}

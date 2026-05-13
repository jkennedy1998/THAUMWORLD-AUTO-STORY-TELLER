import type { Point2, Voxel3 } from './coords.js';
import { key_point2 } from './coords.js';
import type { EditChannels } from '../ascii_painter/edit_mask.js';
import {
  get_line_plane_points,
  get_line_points,
  get_rect_fill_plane_points,
  get_rect_fill_points,
  get_rect_stroke_plane_points,
  get_rect_stroke_points,
  map_plane_points_to_voxels,
  normalize_rect_2d,
} from './geometry/plane_raster.js';
import { get_flood_fill_voxels, get_line_voxels_3d, type VoxelLineRenderMethod } from './geometry/voxel_raster.js';

export type PainterPoint = Point2;

export function normalize_painter_rect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { min_x: number; max_x: number; min_y: number; max_y: number } {
  return normalize_rect_2d(x0, y0, x1, y1);
}

export { get_line_points, get_rect_stroke_points, get_rect_fill_points, get_line_plane_points, get_rect_stroke_plane_points, get_rect_fill_plane_points, map_plane_points_to_voxels };

export type PainterLineRenderMethod = VoxelLineRenderMethod;

export { get_line_voxels_3d, get_flood_fill_voxels };

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

type PainterMatchGraphic = {
  graphic_id: string;
  view_direction?: string;
  facing?: string;
  weight_index?: number;
  variant?: string;
  frame?: string;
};

type PainterMatchAppearanceSlot = {
  kind: string;
  material_id?: string;
  rgb?: { r: number; g: number; b: number };
};

type PainterMatchCell = {
  char: string;
  rgb: { r: number; g: number; b: number };
  weight: number;
  graphic?: PainterMatchGraphic;
  appearance_slots?: Record<number, PainterMatchAppearanceSlot>;
  materials?: Record<number, string>;
};

function rgb_equal(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function graphics_equal(a: PainterMatchGraphic | undefined, b: PainterMatchGraphic | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function appearance_slots_equal(
  a: Record<number, PainterMatchAppearanceSlot> | undefined,
  b: Record<number, PainterMatchAppearanceSlot> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function materials_equal(a: Record<number, string> | undefined, b: Record<number, string> | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function cells_match_edit_channels<T extends PainterMatchCell>(
  candidate: T,
  target: T,
  channels: EditChannels,
): boolean {
  if (channels.char) {
    if (candidate.char !== target.char) return false;
    if (!graphics_equal(candidate.graphic, target.graphic)) return false;
  }
  if (channels.color) {
    if (candidate.appearance_slots || target.appearance_slots) {
      if (!appearance_slots_equal(candidate.appearance_slots, target.appearance_slots)) return false;
    } else if (candidate.materials || target.materials) {
      if (!materials_equal(candidate.materials, target.materials)) return false;
    } else if (!rgb_equal(candidate.rgb, target.rgb)) {
      return false;
    }
  }
  if (channels.weight && candidate.weight !== target.weight) return false;
  return true;
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

import { trace_line_2d, trace_line_3d } from './math3d.js';
import type { PlaneId, PlanePoint, Point2, Voxel3 } from './coords.js';
import { key_point2, key_voxel3, trunc_voxel3, voxel3 } from './coords.js';
import { unproject_plane_to_voxel } from './plane_coords.js';
import type { EditChannels } from '../ascii_painter/edit_mask.js';

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

function get_plane_neighbor_offsets(axis: 'x' | 'y' | 'z', allow_diagonal: boolean): Voxel3[] {
  const offsets: Voxel3[] = [];
  const values = [-1, 0, 1];
  for (const a of values) {
    for (const b of values) {
      if (a === 0 && b === 0) continue;
      if (!allow_diagonal && Math.abs(a) + Math.abs(b) !== 1) continue;
      switch (axis) {
        case 'x':
          offsets.push(voxel3(0, a, b));
          break;
        case 'y':
          offsets.push(voxel3(a, 0, b));
          break;
        case 'z':
        default:
          offsets.push(voxel3(a, b, 0));
          break;
      }
    }
  }
  return offsets;
}

function get_volume_neighbor_offsets(allow_diagonal: boolean): Voxel3[] {
  const offsets: Voxel3[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (!allow_diagonal && distance !== 1) continue;
        offsets.push(voxel3(dx, dy, dz));
      }
    }
  }
  return offsets;
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

export function get_flood_fill_voxels<T>(args: {
  start: Voxel3;
  sample: (world: Voxel3) => T | null;
  matches: (candidate: T, target: T) => boolean;
  enumerate_domain: () => Iterable<Voxel3>;
  same_depth_only: boolean;
  allow_diagonal: boolean;
  continuous: boolean;
  plane_axis: 'x' | 'y' | 'z';
}): Voxel3[] {
  const start = trunc_voxel3(args.start);
  const target = args.sample(start);
  if (target == null) return [];
  const out: Voxel3[] = [];
  if (!args.continuous) {
    const seen = new Set<string>();
    const startPlane = start[args.plane_axis];
    for (const raw of args.enumerate_domain()) {
      const point = trunc_voxel3(raw);
      const key = key_voxel3(point);
      if (seen.has(key)) continue;
      seen.add(key);
      if (args.same_depth_only && point[args.plane_axis] !== startPlane) continue;
      const candidate = args.sample(point);
      if (candidate == null || !args.matches(candidate, target)) continue;
      out.push(point);
    }
    return out;
  }

  const neighborOffsets = args.same_depth_only
    ? get_plane_neighbor_offsets(args.plane_axis, args.allow_diagonal)
    : get_volume_neighbor_offsets(args.allow_diagonal);
  const stack: Voxel3[] = [start];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const point = stack.pop()!;
    const key = key_voxel3(point);
    if (visited.has(key)) continue;
    visited.add(key);
    const candidate = args.sample(point);
    if (candidate == null || !args.matches(candidate, target)) continue;
    out.push(point);
    for (const delta of neighborOffsets) {
      stack.push(voxel3(point.x + delta.x, point.y + delta.y, point.z + delta.z));
    }
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

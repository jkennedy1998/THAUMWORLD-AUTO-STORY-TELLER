import { trace_line_3d } from '../math3d.js';
import type { Voxel3 } from '../coords.js';
import { key_voxel3, trunc_voxel3, voxel3 } from '../coords.js';

export type VoxelLineRenderMethod = 'voxel_dda';

export function get_line_voxels_3d(
  start: Voxel3,
  end: Voxel3,
  method: VoxelLineRenderMethod = 'voxel_dda',
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

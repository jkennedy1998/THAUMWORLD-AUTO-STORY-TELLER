import type { Point2, Voxel3 } from './coords.js';
import { point2, voxel3 } from './coords.js';

export type VoxelPos = Voxel3;

export type Vec3 = VoxelPos;

export function add3(a: VoxelPos, b: VoxelPos): VoxelPos {
  return voxel3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub3(a: VoxelPos, b: VoxelPos): VoxelPos {
  return voxel3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function dist3_sq(a: VoxelPos, b: VoxelPos): number {
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  const dz = Number(b.z) - Number(a.z);
  return dx * dx + dy * dy + dz * dz;
}

export function dist3(a: VoxelPos, b: VoxelPos): number {
  return Math.sqrt(dist3_sq(a, b));
}

// Radius of the circle produced by intersecting a sphere with a plane.
// Returns null when the plane misses the sphere.
export function sphere_plane_intersection_radius(sphere_r: number, dz: number): number | null {
  const r = Number(sphere_r);
  const d = Math.abs(Number(dz));
  if (!Number.isFinite(r) || !Number.isFinite(d) || r < 0) return null;
  if (d > r) return null;
  const v = r * r - d * d;
  if (v <= 0) return 0;
  return Math.sqrt(v);
}

// Integer grid traversal along a 2D line segment (Bresenham).
// Visits inclusive endpoints. If visit() returns false, traversal stops.
export function trace_grid_2d(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => boolean | void,
): void {
  let x = Math.trunc(x0);
  let y = Math.trunc(y0);
  const tx = Math.trunc(x1);
  const ty = Math.trunc(y1);

  let dx = Math.abs(tx - x);
  let sx = x < tx ? 1 : -1;
  let dy = -Math.abs(ty - y);
  let sy = y < ty ? 1 : -1;
  let err = dx + dy;

  // Handle degenerate and general case in one loop.
  while (true) {
    const keep = visit(x, y);
    if (keep === false) return;
    if (x === tx && y === ty) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function trace_line_2d(
  start: Point2,
  end: Point2,
  visit: (point: Point2) => boolean | void,
): void {
  trace_grid_2d(start.x, start.y, end.x, end.y, (x, y) => visit(point2(x, y)));
}

function intbound(s: number, ds: number): number {
  // Find smallest positive t such that s + t*ds is an integer.
  if (ds < 0) return intbound(-s, -ds);
  const s_fract = s - Math.floor(s);
  return (1 - s_fract) / ds;
}

export function normalize3(v: Vec3): Vec3 {
  const x = Number(v.x);
  const y = Number(v.y);
  const z = Number(v.z);
  const m = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(m) || m <= 0) return { x: 0, y: 0, z: 0 };
  return { x: x / m, y: y / m, z: z / m };
}

// 3D voxel traversal (Amanatides & Woo) for a ray.
// origin is continuous space (voxel boundaries at integers).
// dir does not need to be normalized, but traversal assumes constant direction.
// max_dist is in the same units as origin/dir after normalization.
// visit() gets voxel coords + traveled distance t; return false to stop.
export function trace_voxel_ray_3d(
  origin: Vec3,
  dir_in: Vec3,
  max_dist: number,
  visit: (x: number, y: number, z: number, t: number) => boolean | void,
): void {
  const md = Number(max_dist);
  if (!Number.isFinite(md) || md <= 0) return;

  const dir = normalize3(dir_in);
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;
  if (dx === 0 && dy === 0 && dz === 0) return;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;

  let tMaxX = stepX !== 0 ? intbound(origin.x, dx) : Number.POSITIVE_INFINITY;
  let tMaxY = stepY !== 0 ? intbound(origin.y, dy) : Number.POSITIVE_INFINITY;
  let tMaxZ = stepZ !== 0 ? intbound(origin.z, dz) : Number.POSITIVE_INFINITY;

  // Safety: upper bound on visited voxels.
  const max_steps = Math.min(20000, Math.max(8, Math.ceil(md * 3) + 16));
  let steps = 0;
  let t = 0;

  while (steps++ < max_steps) {
    const keep = visit(x, y, z, t);
    if (keep === false) return;

    // Advance to next boundary.
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        if (t > md) return;
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        t = tMaxZ;
        if (t > md) return;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        t = tMaxY;
        if (t > md) return;
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        t = tMaxZ;
        if (t > md) return;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
  }
}

// 3D voxel traversal along a segment using Amanatides & Woo DDA.
// Start/end are voxel coordinates (treated as voxel centers).
// Visits inclusive endpoints. If visit() returns false, traversal stops.
export function trace_grid_3d(
  start: VoxelPos,
  end: VoxelPos,
  visit: (x: number, y: number, z: number) => boolean | void,
): void {
  let x = Math.trunc(start.x);
  let y = Math.trunc(start.y);
  let z = Math.trunc(start.z);
  const ex = Math.trunc(end.x);
  const ey = Math.trunc(end.y);
  const ez = Math.trunc(end.z);

  const ox = x + 0.5;
  const oy = y + 0.5;
  const oz = z + 0.5;
  const tx = ex + 0.5;
  const ty = ey + 0.5;
  const tz = ez + 0.5;

  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;

  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;

  let tMaxX = stepX !== 0 ? intbound(ox, dx) : Number.POSITIVE_INFINITY;
  let tMaxY = stepY !== 0 ? intbound(oy, dy) : Number.POSITIVE_INFINITY;
  let tMaxZ = stepZ !== 0 ? intbound(oz, dz) : Number.POSITIVE_INFINITY;

  while (true) {
    const keep = visit(x, y, z);
    if (keep === false) return;
    if (x === ex && y === ey && z === ez) return;

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
  }
}

export function trace_line_3d(
  start: VoxelPos,
  end: VoxelPos,
  visit: (voxel: VoxelPos) => boolean | void,
): void {
  trace_grid_3d(start, end, (x, y, z) => visit(voxel3(x, y, z)));
}

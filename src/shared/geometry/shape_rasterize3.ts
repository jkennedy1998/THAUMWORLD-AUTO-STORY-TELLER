import type { Voxel3 } from '../coords.js';
import { key_voxel3 } from '../coords.js';
import type { Raster3 } from './raster3.js';
import { create_raster3, raster3_in_bounds, raster3_set } from './raster3.js';
import { draw_box_outline_3d, draw_box_volume_3d, draw_line_3d, raster3_active_voxels } from './raster_ops3.js';
import type { AxisVector3, Box3SessionSpec, Box3Spec, Cone3SessionSpec, Cylinder3SessionSpec, Line3Spec, OrthoBasis3, ShapeRenderMode3, Sphere3SessionSpec } from './shape_specs.js';

function normalize_line3_spec(spec: Line3Spec): {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  min_z: number;
  max_z: number;
} {
  return {
    min_x: Math.min(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    max_x: Math.max(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    min_y: Math.min(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    max_y: Math.max(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    min_z: Math.min(Math.trunc(spec.z0), Math.trunc(spec.z1)),
    max_z: Math.max(Math.trunc(spec.z0), Math.trunc(spec.z1)),
  };
}

function normalize_box3_spec(spec: Box3Spec): {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  min_z: number;
  max_z: number;
} {
  return {
    min_x: Math.min(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    max_x: Math.max(Math.trunc(spec.x0), Math.trunc(spec.x1)),
    min_y: Math.min(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    max_y: Math.max(Math.trunc(spec.y0), Math.trunc(spec.y1)),
    min_z: Math.min(Math.trunc(spec.z0), Math.trunc(spec.z1)),
    max_z: Math.max(Math.trunc(spec.z0), Math.trunc(spec.z1)),
  };
}

const IDENTITY_BASIS_3: OrthoBasis3 = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
};

function clamp_box3_session_size(value: number): number {
  const size = Math.max(1, Math.trunc(value));
  return Number.isFinite(size) ? size : 1;
}

function scale_axis(axis: AxisVector3, amount: number): Voxel3 {
  return {
    x: axis.x * amount,
    y: axis.y * amount,
    z: axis.z * amount,
  };
}

function add_voxel3(a: Voxel3, b: Voxel3): Voxel3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function get_box3_session_basis(spec: Box3SessionSpec): OrthoBasis3 {
  return spec.basis ?? IDENTITY_BASIS_3;
}

function get_box3_session_corner_voxels(spec: Box3SessionSpec): Voxel3[] {
  const anchor = {
    x: Math.trunc(spec.anchor.x),
    y: Math.trunc(spec.anchor.y),
    z: Math.trunc(spec.anchor.z),
  };
  const size_x = clamp_box3_session_size(spec.size.x);
  const size_y = clamp_box3_session_size(spec.size.y);
  const size_z = clamp_box3_session_size(spec.size.z);
  const basis = get_box3_session_basis(spec);
  const dx = scale_axis(basis.right, size_x - 1);
  const dy = scale_axis(basis.up, size_y - 1);
  const dz = scale_axis(basis.forward, size_z - 1);
  return [
    anchor,
    add_voxel3(anchor, dx),
    add_voxel3(anchor, dy),
    add_voxel3(anchor, dz),
    add_voxel3(add_voxel3(anchor, dx), dy),
    add_voxel3(add_voxel3(anchor, dx), dz),
    add_voxel3(add_voxel3(anchor, dy), dz),
    add_voxel3(add_voxel3(add_voxel3(anchor, dx), dy), dz),
  ];
}

function normalize_box3_session_spec(spec: Box3SessionSpec): {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  min_z: number;
  max_z: number;
  size_x: number;
  size_y: number;
  size_z: number;
  anchor: Voxel3;
  basis: OrthoBasis3;
} {
  const corners = get_box3_session_corner_voxels(spec);
  return {
    min_x: Math.min(...corners.map((v) => v.x)),
    max_x: Math.max(...corners.map((v) => v.x)),
    min_y: Math.min(...corners.map((v) => v.y)),
    max_y: Math.max(...corners.map((v) => v.y)),
    min_z: Math.min(...corners.map((v) => v.z)),
    max_z: Math.max(...corners.map((v) => v.z)),
    size_x: clamp_box3_session_size(spec.size.x),
    size_y: clamp_box3_session_size(spec.size.y),
    size_z: clamp_box3_session_size(spec.size.z),
    anchor: { x: Math.trunc(spec.anchor.x), y: Math.trunc(spec.anchor.y), z: Math.trunc(spec.anchor.z) },
    basis: get_box3_session_basis(spec),
  };
}

export function rasterize_line3_into_raster<T>(
  raster: Raster3<T>,
  spec: Line3Spec,
  value: T,
): void {
  draw_line_3d(raster, value, spec.x0, spec.y0, spec.z0, spec.x1, spec.y1, spec.z1);
}

export function rasterize_line3_to_voxels(spec: Line3Spec): Voxel3[] {
  const { min_x, max_x, min_y, max_y, min_z, max_z } = normalize_line3_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: min_x, y: min_y, z: min_z },
    width: max_x - min_x + 1,
    height: max_y - min_y + 1,
    depth: max_z - min_z + 1,
    fill: false,
  });
  rasterize_line3_into_raster(raster, spec, true);
  return raster3_active_voxels(raster, Boolean);
}

export function rasterize_box3_into_raster<T>(
  raster: Raster3<T>,
  spec: Box3Spec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  switch (mode) {
    case 'outline':
      draw_box_outline_3d(raster, value, spec.x0, spec.y0, spec.z0, spec.x1, spec.y1, spec.z1);
      return;
    case 'volume':
    default:
      draw_box_volume_3d(raster, value, spec.x0, spec.y0, spec.z0, spec.x1, spec.y1, spec.z1);
      return;
  }
}

export function rasterize_box3_to_voxels(spec: Box3Spec, mode: ShapeRenderMode3): Voxel3[] {
  const { min_x, max_x, min_y, max_y, min_z, max_z } = normalize_box3_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: min_x, y: min_y, z: min_z },
    width: max_x - min_x + 1,
    height: max_y - min_y + 1,
    depth: max_z - min_z + 1,
    fill: false,
  });
  rasterize_box3_into_raster(raster, spec, mode, true);
  return raster3_active_voxels(raster, Boolean);
}

function is_local_sphere_voxel_occupied(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const radius_x = Math.max(0.5, size_x / 2);
  const radius_y = Math.max(0.5, size_y / 2);
  const radius_z = Math.max(0.5, size_z / 2);
  const local_x = ((ix + 0.5) - radius_x) / radius_x;
  const local_y = ((iy + 0.5) - radius_y) / radius_y;
  const local_z = ((iz + 0.5) - radius_z) / radius_z;
  return (local_x * local_x) + (local_y * local_y) + (local_z * local_z) <= 1;
}

function normalize_sphere3_session_spec(spec: Sphere3SessionSpec): ReturnType<typeof normalize_box3_session_spec> {
  return normalize_box3_session_spec(spec);
}

function normalize_cylinder3_session_spec(spec: Cylinder3SessionSpec): ReturnType<typeof normalize_box3_session_spec> {
  return normalize_box3_session_spec(spec);
}

function normalize_cone3_session_spec(spec: Cone3SessionSpec): ReturnType<typeof normalize_box3_session_spec> {
  return normalize_box3_session_spec(spec);
}

export function rasterize_box3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Box3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  const normalized = normalize_box3_session_spec(spec);
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const voxel = add_voxel3(
          add_voxel3(
            add_voxel3(normalized.anchor, scale_axis(normalized.basis.right, ix)),
            scale_axis(normalized.basis.up, iy),
          ),
          scale_axis(normalized.basis.forward, iz),
        );
        if (mode === 'outline') {
          let boundary_axes = 0;
          if (ix === 0 || ix === normalized.size_x - 1) boundary_axes += 1;
          if (iy === 0 || iy === normalized.size_y - 1) boundary_axes += 1;
          if (iz === 0 || iz === normalized.size_z - 1) boundary_axes += 1;
          if (boundary_axes < 2) continue;
        }
        if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) {
          raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
        }
      }
    }
  }
}

export function rasterize_box3_session_to_voxels(spec: Box3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  const normalized = normalize_box3_session_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: normalized.min_x, y: normalized.min_y, z: normalized.min_z },
    width: normalized.max_x - normalized.min_x + 1,
    height: normalized.max_y - normalized.min_y + 1,
    depth: normalized.max_z - normalized.min_z + 1,
    fill: false,
  });
  rasterize_box3_session_into_raster(raster, spec, mode, true);
  return raster3_active_voxels(raster, Boolean);
}

function is_local_cylinder_voxel_occupied(size_x: number, size_y: number, ix: number, iy: number): boolean {
  const radius_x = Math.max(0.5, size_x / 2);
  const radius_y = Math.max(0.5, size_y / 2);
  const local_x = ((ix + 0.5) - radius_x) / radius_x;
  const local_y = ((iy + 0.5) - radius_y) / radius_y;
  return (local_x * local_x) + (local_y * local_y) <= 1;
}

function is_local_cone_voxel_occupied(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const t = size_z <= 1 ? 1 : 1 - (iz / (size_z - 1));
  const radius_x = Math.max(0.5, (size_x / 2) * t);
  const radius_y = Math.max(0.5, (size_y / 2) * t);
  const center_x = size_x / 2;
  const center_y = size_y / 2;
  const local_x = ((ix + 0.5) - center_x) / radius_x;
  const local_y = ((iy + 0.5) - center_y) / radius_y;
  return (local_x * local_x) + (local_y * local_y) <= 1;
}

export function rasterize_sphere3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Sphere3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  const normalized = normalize_sphere3_session_spec(spec);
  const occupied = new Set<string>();
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        if (!is_local_sphere_voxel_occupied(normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) continue;
        occupied.add(`${ix},${iy},${iz}`);
      }
    }
  }
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode === 'outline') {
          const neighbors: Array<[number, number, number]> = [
            [ix - 1, iy, iz],
            [ix + 1, iy, iz],
            [ix, iy - 1, iz],
            [ix, iy + 1, iz],
            [ix, iy, iz - 1],
            [ix, iy, iz + 1],
          ];
          const is_surface = neighbors.some(([nx, ny, nz]) => !occupied.has(`${nx},${ny},${nz}`));
          if (!is_surface) continue;
        }
        const voxel = add_voxel3(
          add_voxel3(
            add_voxel3(normalized.anchor, scale_axis(normalized.basis.right, ix)),
            scale_axis(normalized.basis.up, iy),
          ),
          scale_axis(normalized.basis.forward, iz),
        );
        if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) {
          raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
        }
      }
    }
  }
}

export function rasterize_sphere3_session_to_voxels(spec: Sphere3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  const normalized = normalize_sphere3_session_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: normalized.min_x, y: normalized.min_y, z: normalized.min_z },
    width: normalized.max_x - normalized.min_x + 1,
    height: normalized.max_y - normalized.min_y + 1,
    depth: normalized.max_z - normalized.min_z + 1,
    fill: false,
  });
  rasterize_sphere3_session_into_raster(raster, spec, mode, true);
  return raster3_active_voxels(raster, Boolean);
}

export function rasterize_cylinder3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Cylinder3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  const normalized = normalize_cylinder3_session_spec(spec);
  const occupied = new Set<string>();
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      if (!is_local_cylinder_voxel_occupied(normalized.size_x, normalized.size_y, ix, iy)) continue;
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        occupied.add(`${ix},${iy},${iz}`);
      }
    }
  }
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode === 'outline') {
          const neighbors: Array<[number, number, number]> = [
            [ix - 1, iy, iz],
            [ix + 1, iy, iz],
            [ix, iy - 1, iz],
            [ix, iy + 1, iz],
            [ix, iy, iz - 1],
            [ix, iy, iz + 1],
          ];
          const is_surface = neighbors.some(([nx, ny, nz]) => !occupied.has(`${nx},${ny},${nz}`));
          if (!is_surface) continue;
        }
        const voxel = add_voxel3(
          add_voxel3(
            add_voxel3(normalized.anchor, scale_axis(normalized.basis.right, ix)),
            scale_axis(normalized.basis.up, iy),
          ),
          scale_axis(normalized.basis.forward, iz),
        );
        if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) {
          raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
        }
      }
    }
  }
}

export function rasterize_cylinder3_session_to_voxels(spec: Cylinder3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  const normalized = normalize_cylinder3_session_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: normalized.min_x, y: normalized.min_y, z: normalized.min_z },
    width: normalized.max_x - normalized.min_x + 1,
    height: normalized.max_y - normalized.min_y + 1,
    depth: normalized.max_z - normalized.min_z + 1,
    fill: false,
  });
  rasterize_cylinder3_session_into_raster(raster, spec, mode, true);
  return raster3_active_voxels(raster, Boolean);
}

export function rasterize_cone3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Cone3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  const normalized = normalize_cone3_session_spec(spec);
  const occupied = new Set<string>();
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        if (!is_local_cone_voxel_occupied(normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) continue;
        occupied.add(`${ix},${iy},${iz}`);
      }
    }
  }
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode === 'outline') {
          const neighbors: Array<[number, number, number]> = [
            [ix - 1, iy, iz],
            [ix + 1, iy, iz],
            [ix, iy - 1, iz],
            [ix, iy + 1, iz],
            [ix, iy, iz - 1],
            [ix, iy, iz + 1],
          ];
          const is_surface = neighbors.some(([nx, ny, nz]) => !occupied.has(`${nx},${ny},${nz}`));
          if (!is_surface) continue;
        }
        const voxel = add_voxel3(
          add_voxel3(
            add_voxel3(normalized.anchor, scale_axis(normalized.basis.right, ix)),
            scale_axis(normalized.basis.up, iy),
          ),
          scale_axis(normalized.basis.forward, iz),
        );
        if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) {
          raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
        }
      }
    }
  }
}

export function rasterize_cone3_session_to_voxels(spec: Cone3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  const normalized = normalize_cone3_session_spec(spec);
  const raster = create_raster3<boolean>({
    origin: { x: normalized.min_x, y: normalized.min_y, z: normalized.min_z },
    width: normalized.max_x - normalized.min_x + 1,
    height: normalized.max_y - normalized.min_y + 1,
    depth: normalized.max_z - normalized.min_z + 1,
    fill: false,
  });
  rasterize_cone3_session_into_raster(raster, spec, mode, true);
  return raster3_active_voxels(raster, Boolean);
}

export function box3_session_to_box3_spec(spec: Box3SessionSpec): Box3Spec | null {
  const basis = get_box3_session_basis(spec);
  const is_identity = key_voxel3(basis.right) === '1,0,0' && key_voxel3(basis.up) === '0,1,0' && key_voxel3(basis.forward) === '0,0,1';
  if (!is_identity) return null;
  const normalized = normalize_box3_session_spec(spec);
  return {
    x0: normalized.anchor.x,
    y0: normalized.anchor.y,
    z0: normalized.anchor.z,
    x1: normalized.anchor.x + normalized.size_x - 1,
    y1: normalized.anchor.y + normalized.size_y - 1,
    z1: normalized.anchor.z + normalized.size_z - 1,
  };
}

import type { Voxel3 } from '../coords.js';
import { key_voxel3 } from '../coords.js';
import { rasterize_polygon2_to_points } from './shape_rasterize2.js';
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
    case 'wireframe':
      draw_box_outline_3d(raster, value, spec.x0, spec.y0, spec.z0, spec.x1, spec.y1, spec.z1);
      return;
    case 'surfaces': {
      const min_x = Math.min(Math.trunc(spec.x0), Math.trunc(spec.x1));
      const max_x = Math.max(Math.trunc(spec.x0), Math.trunc(spec.x1));
      const min_y = Math.min(Math.trunc(spec.y0), Math.trunc(spec.y1));
      const max_y = Math.max(Math.trunc(spec.y0), Math.trunc(spec.y1));
      const min_z = Math.min(Math.trunc(spec.z0), Math.trunc(spec.z1));
      const max_z = Math.max(Math.trunc(spec.z0), Math.trunc(spec.z1));
      for (let z = min_z; z <= max_z; z += 1) {
        for (let y = min_y; y <= max_y; y += 1) {
          for (let x = min_x; x <= max_x; x += 1) {
            if (x !== min_x && x !== max_x && y !== min_y && y !== max_y && z !== min_z && z !== max_z) continue;
            if (raster3_in_bounds(raster, x, y, z)) raster3_set(raster, x, y, z, value);
          }
        }
      }
      return;
    }
    case 'filled':
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

function get_active_local_axes(size_x: number, size_y: number, size_z: number): Array<'x' | 'y' | 'z'> {
  const axes: Array<'x' | 'y' | 'z'> = [];
  if (size_x > 1) axes.push('x');
  if (size_y > 1) axes.push('y');
  if (size_z > 1) axes.push('z');
  return axes;
}

function is_local_surface_voxel(
  occupied: Set<string>,
  size_x: number,
  size_y: number,
  size_z: number,
  ix: number,
  iy: number,
  iz: number,
): boolean {
  const axes = get_active_local_axes(size_x, size_y, size_z);
  if (axes.length < 1) return true;
  const neighbors: Array<[number, number, number]> = [];
  if (axes.includes('x')) {
    neighbors.push([ix - 1, iy, iz], [ix + 1, iy, iz]);
  }
  if (axes.includes('y')) {
    neighbors.push([ix, iy - 1, iz], [ix, iy + 1, iz]);
  }
  if (axes.includes('z')) {
    neighbors.push([ix, iy, iz - 1], [ix, iy, iz + 1]);
  }
  return neighbors.some(([nx, ny, nz]) => !occupied.has(`${nx},${ny},${nz}`));
}

function is_local_box_surface_voxel(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const axes = get_active_local_axes(size_x, size_y, size_z);
  if (axes.length < 1) return true;
  if (axes.includes('x') && (ix === 0 || ix === size_x - 1)) return true;
  if (axes.includes('y') && (iy === 0 || iy === size_y - 1)) return true;
  if (axes.includes('z') && (iz === 0 || iz === size_z - 1)) return true;
  return false;
}

function is_local_box_wireframe_voxel(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const axes = get_active_local_axes(size_x, size_y, size_z);
  if (axes.length <= 2) {
    return is_local_box_surface_voxel(size_x, size_y, size_z, ix, iy, iz);
  }
  let boundary_axes = 0;
  if (ix === 0 || ix === size_x - 1) boundary_axes += 1;
  if (iy === 0 || iy === size_y - 1) boundary_axes += 1;
  if (iz === 0 || iz === size_z - 1) boundary_axes += 1;
  return boundary_axes >= 2;
}

function clamp_segment_count(value: number | undefined, fallback: number = 5): number {
  const count = Math.max(3, Math.trunc(value ?? fallback));
  return Number.isFinite(count) ? count : fallback;
}

function local_point3_to_world(anchor: Voxel3, basis: OrthoBasis3, x: number, y: number, z: number): Voxel3 {
  return {
    x: anchor.x + Math.round((basis.right.x * x) + (basis.up.x * y) + (basis.forward.x * z)),
    y: anchor.y + Math.round((basis.right.y * x) + (basis.up.y * y) + (basis.forward.y * z)),
    z: anchor.z + Math.round((basis.right.z * x) + (basis.up.z * y) + (basis.forward.z * z)),
  };
}

function write_line_voxels<T>(raster: Raster3<T>, from: Voxel3, to: Voxel3, value: T): void {
  for (const voxel of rasterize_line3_to_voxels({ x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z })) {
    if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
  }
}

function get_regular_ring_points(size_x: number, size_y: number, segments: number, scale: number = 1): Array<{ x: number; y: number }> {
  const center_x = (size_x - 1) / 2;
  const center_y = (size_y - 1) / 2;
  const radius_x = Math.max(0, center_x * scale);
  const radius_y = Math.max(0, center_y * scale);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push({
      x: center_x + (Math.cos(angle) * radius_x),
      y: center_y + (Math.sin(angle) * radius_y),
    });
  }
  return points;
}

function rasterize_cylinder_wireframe_into_raster<T>(raster: Raster3<T>, normalized: ReturnType<typeof normalize_cylinder3_session_spec>, radial_segments: number, value: T): void {
  const ring0 = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1);
  const z0 = 0;
  const z1 = normalized.size_z - 1;
  for (let i = 0; i < ring0.length; i += 1) {
    const next = (i + 1) % ring0.length;
    const baseA = local_point3_to_world(normalized.anchor, normalized.basis, ring0[i]!.x, ring0[i]!.y, z0);
    const baseB = local_point3_to_world(normalized.anchor, normalized.basis, ring0[next]!.x, ring0[next]!.y, z0);
    write_line_voxels(raster, baseA, baseB, value);
    if (z1 !== z0) {
      const topA = local_point3_to_world(normalized.anchor, normalized.basis, ring0[i]!.x, ring0[i]!.y, z1);
      const topB = local_point3_to_world(normalized.anchor, normalized.basis, ring0[next]!.x, ring0[next]!.y, z1);
      write_line_voxels(raster, topA, topB, value);
      write_line_voxels(raster, baseA, topA, value);
    }
  }
}

function rasterize_cone_wireframe_into_raster<T>(raster: Raster3<T>, normalized: ReturnType<typeof normalize_cone3_session_spec>, radial_segments: number, value: T): void {
  const baseRing = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1);
  const tip = local_point3_to_world(normalized.anchor, normalized.basis, (normalized.size_x - 1) / 2, (normalized.size_y - 1) / 2, normalized.size_z - 1);
  for (let i = 0; i < baseRing.length; i += 1) {
    const next = (i + 1) % baseRing.length;
    const baseA = local_point3_to_world(normalized.anchor, normalized.basis, baseRing[i]!.x, baseRing[i]!.y, 0);
    const baseB = local_point3_to_world(normalized.anchor, normalized.basis, baseRing[next]!.x, baseRing[next]!.y, 0);
    write_line_voxels(raster, baseA, baseB, value);
    write_line_voxels(raster, baseA, tip, value);
  }
}

function rasterize_sphere_wireframe_into_raster<T>(raster: Raster3<T>, normalized: ReturnType<typeof normalize_sphere3_session_spec>, u_segments: number, v_segments: number, value: T): void {
  const cx = (normalized.size_x - 1) / 2;
  const cy = (normalized.size_y - 1) / 2;
  const cz = (normalized.size_z - 1) / 2;
  const rx = Math.max(0.5, cx);
  const ry = Math.max(0.5, cy);
  const rz = Math.max(0.5, cz);
  const pointAt = (uIndex: number, vIndex: number): Voxel3 => {
    const phi = ((uIndex % u_segments) / u_segments) * Math.PI * 2;
    const theta = (vIndex / v_segments) * Math.PI - (Math.PI / 2);
    const x = cx + (Math.cos(theta) * Math.cos(phi) * rx);
    const y = cy + (Math.cos(theta) * Math.sin(phi) * ry);
    const z = cz + (Math.sin(theta) * rz);
    return local_point3_to_world(normalized.anchor, normalized.basis, x, y, z);
  };
  for (let v = 1; v < v_segments; v += 1) {
    for (let u = 0; u < u_segments; u += 1) {
      write_line_voxels(raster, pointAt(u, v), pointAt(u + 1, v), value);
    }
  }
  for (let u = 0; u < u_segments; u += 1) {
    for (let v = 0; v < v_segments; v += 1) {
      write_line_voxels(raster, pointAt(u, v), pointAt(u, v + 1), value);
    }
  }
}

function get_local_polygon_slice_points(
  points: Array<{ x: number; y: number }>,
  local_z: number,
  mode: 'edge' | 'fill',
): Voxel3[] {
  if (points.length < 1) return [];
  if (points.length === 1) {
    return [{ x: Math.round(points[0]!.x), y: Math.round(points[0]!.y), z: Math.round(local_z) }];
  }
  return rasterize_polygon2_to_points({ points }, mode).map((point) => ({ x: point.x, y: point.y, z: Math.round(local_z) }));
}

function get_local_polygon_slice_occupied_points(
  points: Array<{ x: number; y: number }>,
  local_z: number,
): Voxel3[] {
  const occupied = new Map<string, Voxel3>();
  for (const point of get_local_polygon_slice_points(points, local_z, 'fill')) occupied.set(`${point.x},${point.y},${point.z}`, point);
  const roundedVertices = points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y), z: Math.round(local_z) }));
  if (roundedVertices.length === 1) occupied.set(`${roundedVertices[0]!.x},${roundedVertices[0]!.y},${roundedVertices[0]!.z}`, roundedVertices[0]!);
  for (let i = 0; i < roundedVertices.length; i += 1) {
    const from = roundedVertices[i]!;
    const to = roundedVertices[(i + 1) % roundedVertices.length]!;
    for (const voxel of rasterize_line3_to_voxels({ x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z })) {
      occupied.set(`${voxel.x},${voxel.y},${voxel.z}`, voxel);
    }
  }
  return Array.from(occupied.values());
}

function write_local_polygon_slice<T>(
  raster: Raster3<T>,
  anchor: Voxel3,
  basis: OrthoBasis3,
  points: Array<{ x: number; y: number }>,
  local_z: number,
  mode: 'edge' | 'fill',
  value: T,
): void {
  for (const point of get_local_polygon_slice_points(points, local_z, mode)) {
    const voxel = local_point3_to_world(anchor, basis, point.x, point.y, point.z);
    if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
  }
}

function get_sphere_slice_scale(size_z: number, iz: number): number {
  if (size_z <= 1) return 1;
  const center_z = (size_z - 1) / 2;
  const radius_z = Math.max(0.5, center_z);
  const local_z = (iz - center_z) / radius_z;
  return Math.max(0, Math.sqrt(Math.max(0, 1 - (local_z * local_z))));
}

function collect_local_segmented_cylinder_occupied(normalized: ReturnType<typeof normalize_cylinder3_session_spec>, radial_segments: number): Set<string> {
  const occupied = new Set<string>();
  const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1);
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    for (const point of get_local_polygon_slice_occupied_points(ring, iz)) {
      occupied.add(`${point.x},${point.y},${point.z}`);
    }
  }
  return occupied;
}

function collect_local_segmented_cone_occupied(normalized: ReturnType<typeof normalize_cone3_session_spec>, radial_segments: number): Set<string> {
  const occupied = new Set<string>();
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    const scale = normalized.size_z <= 1 ? 1 : Math.max(0, 1 - (iz / (normalized.size_z - 1)));
    const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, scale);
    for (const point of get_local_polygon_slice_occupied_points(ring, iz)) {
      occupied.add(`${point.x},${point.y},${point.z}`);
    }
  }
  return occupied;
}

function collect_local_segmented_sphere_occupied(normalized: ReturnType<typeof normalize_sphere3_session_spec>, u_segments: number, _v_segments: number): Set<string> {
  const occupied = new Set<string>();
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    const scale = get_sphere_slice_scale(normalized.size_z, iz);
    const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, u_segments, scale);
    for (const point of get_local_polygon_slice_occupied_points(ring, iz)) {
      occupied.add(`${point.x},${point.y},${point.z}`);
    }
  }
  return occupied;
}

function write_local_occupied_set_to_raster<T>(
  raster: Raster3<T>,
  anchor: Voxel3,
  basis: OrthoBasis3,
  occupied: Set<string>,
  size_x: number,
  size_y: number,
  size_z: number,
  mode: 'filled' | 'surfaces',
  value: T,
): void {
  for (let ix = 0; ix < size_x; ix += 1) {
    for (let iy = 0; iy < size_y; iy += 1) {
      for (let iz = 0; iz < size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode === 'surfaces' && !is_local_surface_voxel(occupied, size_x, size_y, size_z, ix, iy, iz)) continue;
        const voxel = local_point3_to_world(anchor, basis, ix, iy, iz);
        if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
      }
    }
  }
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
        if (mode === 'surfaces' && !is_local_box_surface_voxel(normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) {
          continue;
        }
        if (mode === 'wireframe' && !is_local_box_wireframe_voxel(normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) {
          continue;
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
  const activeAxes = get_active_local_axes(normalized.size_x, normalized.size_y, normalized.size_z);
  if (mode === 'wireframe' && activeAxes.length >= 3) {
    rasterize_sphere_wireframe_into_raster(raster, normalized, clamp_segment_count(spec.u_segments, 5), clamp_segment_count(spec.v_segments, 5), value);
    return;
  }
  if (activeAxes.length >= 3 && normalized.size_x >= 5 && normalized.size_y >= 5 && normalized.size_z >= 5) {
    const occupied = collect_local_segmented_sphere_occupied(normalized, clamp_segment_count(spec.u_segments, 5), clamp_segment_count(spec.v_segments, 5));
    write_local_occupied_set_to_raster(raster, normalized.anchor, normalized.basis, occupied, normalized.size_x, normalized.size_y, normalized.size_z, mode === 'filled' ? 'filled' : 'surfaces', value);
    return;
  }
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
        if (mode !== 'filled' && !is_local_surface_voxel(occupied, normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) {
          continue;
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
  const activeAxes = get_active_local_axes(normalized.size_x, normalized.size_y, normalized.size_z);
  if (mode === 'wireframe' && activeAxes.length >= 3) {
    rasterize_cylinder_wireframe_into_raster(raster, normalized, clamp_segment_count(spec.radial_segments, 5), value);
    return;
  }
  const occupied = activeAxes.length >= 3
    ? collect_local_segmented_cylinder_occupied(normalized, clamp_segment_count(spec.radial_segments, 5))
    : (() => {
      const legacyOccupied = new Set<string>();
      for (let ix = 0; ix < normalized.size_x; ix += 1) {
        for (let iy = 0; iy < normalized.size_y; iy += 1) {
          if (!is_local_cylinder_voxel_occupied(normalized.size_x, normalized.size_y, ix, iy)) continue;
          for (let iz = 0; iz < normalized.size_z; iz += 1) {
            legacyOccupied.add(`${ix},${iy},${iz}`);
          }
        }
      }
      return legacyOccupied;
    })();
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode !== 'filled' && !is_local_surface_voxel(occupied, normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) {
          continue;
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
  const activeAxes = get_active_local_axes(normalized.size_x, normalized.size_y, normalized.size_z);
  if (mode === 'wireframe' && activeAxes.length >= 3) {
    rasterize_cone_wireframe_into_raster(raster, normalized, clamp_segment_count(spec.radial_segments, 5), value);
    return;
  }
  const occupied = activeAxes.length >= 3
    ? collect_local_segmented_cone_occupied(normalized, clamp_segment_count(spec.radial_segments, 5))
    : (() => {
      const legacyOccupied = new Set<string>();
      for (let ix = 0; ix < normalized.size_x; ix += 1) {
        for (let iy = 0; iy < normalized.size_y; iy += 1) {
          for (let iz = 0; iz < normalized.size_z; iz += 1) {
            if (!is_local_cone_voxel_occupied(normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) continue;
            legacyOccupied.add(`${ix},${iy},${iz}`);
          }
        }
      }
      return legacyOccupied;
    })();
  for (let ix = 0; ix < normalized.size_x; ix += 1) {
    for (let iy = 0; iy < normalized.size_y; iy += 1) {
      for (let iz = 0; iz < normalized.size_z; iz += 1) {
        const key = `${ix},${iy},${iz}`;
        if (!occupied.has(key)) continue;
        if (mode !== 'filled' && !is_local_surface_voxel(occupied, normalized.size_x, normalized.size_y, normalized.size_z, ix, iy, iz)) {
          continue;
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

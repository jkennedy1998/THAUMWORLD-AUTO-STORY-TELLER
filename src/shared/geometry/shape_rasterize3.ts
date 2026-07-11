import type { Voxel3 } from '../coords.js';
import { key_voxel3 } from '../coords.js';
import { rasterize_polygon2_to_points } from './shape_rasterize2.js';
import type { Raster3 } from './raster3.js';
import { create_raster3, raster3_in_bounds, raster3_set } from './raster3.js';
import { draw_box_outline_3d, draw_box_volume_3d, draw_line_3d, raster3_active_voxels } from './raster_ops3.js';
import type { AxisVector3, Box3SessionSpec, Box3Spec, Cone3SessionSpec, Cylinder3SessionSpec, Line3Spec, OrthoBasis3, ShapeRenderMode3, Sphere3SessionSpec } from './shape_specs.js';

type ShapeSessionFrame3 = ReturnType<typeof normalize_box3_session_spec>;

export type EvaluatedShape3CellSets = {
  frame: ShapeSessionFrame3;
  bodyCellKeys: Set<string>;
  shellCellKeys: Set<string>;
  wireframeCellKeys: Set<string>;
};

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

function get_local_shape_session_frame(spec: Box3SessionSpec): ShapeSessionFrame3 {
  return normalize_box3_session_spec(spec);
}

function get_active_local_axes(size_x: number, size_y: number, size_z: number): Array<'x' | 'y' | 'z'> {
  const axes: Array<'x' | 'y' | 'z'> = [];
  if (size_x > 1) axes.push('x');
  if (size_y > 1) axes.push('y');
  if (size_z > 1) axes.push('z');
  return axes;
}

function is_local_shell_cell(
  bodyCells: Set<string>,
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
  return neighbors.some(([nx, ny, nz]) => !bodyCells.has(`${nx},${ny},${nz}`));
}

function is_local_box_shell_cell(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const axes = get_active_local_axes(size_x, size_y, size_z);
  if (axes.length < 1) return true;
  if (axes.includes('x') && (ix === 0 || ix === size_x - 1)) return true;
  if (axes.includes('y') && (iy === 0 || iy === size_y - 1)) return true;
  if (axes.includes('z') && (iz === 0 || iz === size_z - 1)) return true;
  return false;
}

function is_local_box_wireframe_cell(size_x: number, size_y: number, size_z: number, ix: number, iy: number, iz: number): boolean {
  const axes = get_active_local_axes(size_x, size_y, size_z);
  if (axes.length <= 2) {
    return is_local_box_shell_cell(size_x, size_y, size_z, ix, iy, iz);
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

function get_local_polygon_slice_body_cells(
  points: Array<{ x: number; y: number }>,
  local_z: number,
): Voxel3[] {
  const bodyCells = new Map<string, Voxel3>();
  for (const point of get_local_polygon_slice_points(points, local_z, 'fill')) bodyCells.set(`${point.x},${point.y},${point.z}`, point);
  const roundedVertices = points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y), z: Math.round(local_z) }));
  if (roundedVertices.length === 1) bodyCells.set(`${roundedVertices[0]!.x},${roundedVertices[0]!.y},${roundedVertices[0]!.z}`, roundedVertices[0]!);
  for (let i = 0; i < roundedVertices.length; i += 1) {
    const from = roundedVertices[i]!;
    const to = roundedVertices[(i + 1) % roundedVertices.length]!;
    for (const voxel of rasterize_line3_to_voxels({ x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z })) {
      bodyCells.set(`${voxel.x},${voxel.y},${voxel.z}`, voxel);
    }
  }
  return Array.from(bodyCells.values());
}

function local_key(ix: number, iy: number, iz: number): string {
  return `${ix},${iy},${iz}`;
}

function parse_local_key(key: string): Voxel3 {
  const [x = 0, y = 0, z = 0] = key.split(',').map((value) => Number.parseInt(value, 10));
  return { x, y, z };
}

export function local_cell_key_set_to_voxels(keys: Set<string>): Voxel3[] {
  return Array.from(keys, parse_local_key);
}

export function map_local_voxels_to_world(frame: ShapeSessionFrame3, localVoxels: Voxel3[]): Voxel3[] {
  return localVoxels.map((voxel) => local_point3_to_world(frame.anchor, frame.basis, voxel.x, voxel.y, voxel.z));
}

export function map_local_cell_key_set_to_world_voxels(frame: ShapeSessionFrame3, keys: Set<string>): Voxel3[] {
  return map_local_voxels_to_world(frame, local_cell_key_set_to_voxels(keys));
}

function get_sphere_slice_scale(size_z: number, iz: number, v_segments: number): number {
  if (size_z <= 1) return 1;
  const normalized = iz / (size_z - 1);
  const quantized = Math.round(normalized * v_segments) / v_segments;
  const theta = (quantized * Math.PI) - (Math.PI / 2);
  return Math.max(0, Math.cos(theta));
}

function collect_local_box_body_cells(size_x: number, size_y: number, size_z: number): Set<string> {
  const bodyCells = new Set<string>();
  for (let ix = 0; ix < size_x; ix += 1) {
    for (let iy = 0; iy < size_y; iy += 1) {
      for (let iz = 0; iz < size_z; iz += 1) {
        bodyCells.add(local_key(ix, iy, iz));
      }
    }
  }
  return bodyCells;
}

function collect_local_segmented_cylinder_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  const bodyCells = new Set<string>();
  const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1);
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    for (const point of get_local_polygon_slice_body_cells(ring, iz)) {
      bodyCells.add(local_key(point.x, point.y, point.z));
    }
  }
  return bodyCells;
}

function collect_local_segmented_cone_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  const bodyCells = new Set<string>();
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    const scale = normalized.size_z <= 1 ? 1 : Math.max(0, 1 - (iz / (normalized.size_z - 1)));
    const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, scale);
    for (const point of get_local_polygon_slice_body_cells(ring, iz)) {
      bodyCells.add(local_key(point.x, point.y, point.z));
    }
  }
  return bodyCells;
}

function collect_local_segmented_sphere_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, u_segments: number, v_segments: number): Set<string> {
  const bodyCells = new Set<string>();
  for (let iz = 0; iz < normalized.size_z; iz += 1) {
    const scale = get_sphere_slice_scale(normalized.size_z, iz, v_segments);
    const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, u_segments, scale);
    for (const point of get_local_polygon_slice_body_cells(ring, iz)) {
      bodyCells.add(local_key(point.x, point.y, point.z));
    }
  }
  return bodyCells;
}

function collect_local_sphere_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, u_segments: number, v_segments: number): Set<string> {
  return collect_local_segmented_sphere_body_cells(normalized, u_segments, v_segments);
}

function collect_local_cylinder_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  return collect_local_segmented_cylinder_body_cells(normalized, radial_segments);
}

function collect_local_cone_body_cells(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  return collect_local_segmented_cone_body_cells(normalized, radial_segments);
}

function collect_local_shell_cell_keys(bodyCells: Set<string>, size_x: number, size_y: number, size_z: number): Set<string> {
  const shellCells = new Set<string>();
  for (const key of bodyCells) {
    const { x, y, z } = parse_local_key(key);
    if (is_local_shell_cell(bodyCells, size_x, size_y, size_z, x, y, z)) shellCells.add(key);
  }
  return shellCells;
}

function collect_local_box_wireframe_cell_keys(size_x: number, size_y: number, size_z: number): Set<string> {
  const wireframe = new Set<string>();
  for (let ix = 0; ix < size_x; ix += 1) {
    for (let iy = 0; iy < size_y; iy += 1) {
      for (let iz = 0; iz < size_z; iz += 1) {
        if (is_local_box_wireframe_cell(size_x, size_y, size_z, ix, iy, iz)) wireframe.add(local_key(ix, iy, iz));
      }
    }
  }
  return wireframe;
}

function collect_local_line_hint_keys(points: Voxel3[], closed: boolean): Set<string> {
  const hint = new Set<string>();
  if (points.length === 1) {
    hint.add(local_key(points[0]!.x, points[0]!.y, points[0]!.z));
    return hint;
  }
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    const from = points[i]!;
    const to = points[(i + 1) % points.length]!;
    for (const voxel of rasterize_line3_to_voxels({ x0: from.x, y0: from.y, z0: from.z, x1: to.x, y1: to.y, z1: to.z })) {
      hint.add(local_key(voxel.x, voxel.y, voxel.z));
    }
  }
  return hint;
}

function union_local_key_sets(...sets: Set<string>[]): Set<string> {
  const result = new Set<string>();
  for (const set of sets) {
    for (const key of set) result.add(key);
  }
  return result;
}

function intersect_local_key_sets(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const key of a) {
    if (b.has(key)) result.add(key);
  }
  return result;
}

function collect_local_cylinder_wireframe_hint_keys(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1)
    .map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const baseHint = collect_local_line_hint_keys(ring.map((point) => ({ x: point.x, y: point.y, z: 0 })), true);
  const topHint = collect_local_line_hint_keys(ring.map((point) => ({ x: point.x, y: point.y, z: normalized.size_z - 1 })), true);
  const railHint = union_local_key_sets(...ring.map((point) => collect_local_line_hint_keys([
    { x: point.x, y: point.y, z: 0 },
    { x: point.x, y: point.y, z: normalized.size_z - 1 },
  ], false)));
  return union_local_key_sets(baseHint, topHint, railHint);
}

function collect_local_cone_wireframe_hint_keys(normalized: ReturnType<typeof get_local_shape_session_frame>, radial_segments: number): Set<string> {
  const ring = get_regular_ring_points(normalized.size_x, normalized.size_y, radial_segments, 1)
    .map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const tip = { x: Math.round((normalized.size_x - 1) / 2), y: Math.round((normalized.size_y - 1) / 2), z: normalized.size_z - 1 };
  const baseHint = collect_local_line_hint_keys(ring.map((point) => ({ x: point.x, y: point.y, z: 0 })), true);
  const railHint = union_local_key_sets(...ring.map((point) => collect_local_line_hint_keys([
    { x: point.x, y: point.y, z: 0 },
    tip,
  ], false)));
  return union_local_key_sets(baseHint, railHint);
}

function collect_local_sphere_wireframe_hint_keys(normalized: ReturnType<typeof get_local_shape_session_frame>, u_segments: number, v_segments: number): Set<string> {
  const cx = (normalized.size_x - 1) / 2;
  const cy = (normalized.size_y - 1) / 2;
  const cz = (normalized.size_z - 1) / 2;
  const rx = Math.max(0.5, cx);
  const ry = Math.max(0.5, cy);
  const rz = Math.max(0.5, cz);
  const pointAt = (uIndex: number, vIndex: number): Voxel3 => {
    const phi = ((uIndex % u_segments) / u_segments) * Math.PI * 2;
    const theta = (vIndex / v_segments) * Math.PI - (Math.PI / 2);
    const x = Math.round(cx + (Math.cos(theta) * Math.cos(phi) * rx));
    const y = Math.round(cy + (Math.cos(theta) * Math.sin(phi) * ry));
    const z = Math.round(cz + (Math.sin(theta) * rz));
    return { x, y, z };
  };
  const hints: Set<string>[] = [];
  for (let v = 1; v < v_segments; v += 1) {
    const ring: Voxel3[] = [];
    for (let u = 0; u < u_segments; u += 1) ring.push(pointAt(u, v));
    hints.push(collect_local_line_hint_keys(ring, true));
  }
  for (let u = 0; u < u_segments; u += 1) {
    const rail: Voxel3[] = [];
    for (let v = 0; v <= v_segments; v += 1) rail.push(pointAt(u, v));
    hints.push(collect_local_line_hint_keys(rail, false));
  }
  return union_local_key_sets(...hints);
}

export function select_evaluated_shape_mode_cell_keys(result: EvaluatedShape3CellSets, mode: ShapeRenderMode3): Set<string> {
  if (mode === 'filled') return result.bodyCellKeys;
  if (mode === 'surfaces') return result.shellCellKeys;
  if (result.wireframeCellKeys.size > 0) return result.wireframeCellKeys;
  return result.shellCellKeys;
}

function write_local_cell_key_set_to_raster<T>(
  raster: Raster3<T>,
  anchor: Voxel3,
  basis: OrthoBasis3,
  keys: Set<string>,
  value: T,
): void {
  for (const key of keys) {
    const { x, y, z } = parse_local_key(key);
    const voxel = local_point3_to_world(anchor, basis, x, y, z);
    if (raster3_in_bounds(raster, voxel.x, voxel.y, voxel.z)) raster3_set(raster, voxel.x, voxel.y, voxel.z, value);
  }
}

function create_shape_session_voxel_raster(normalized: ShapeSessionFrame3): Raster3<boolean> {
  return create_raster3<boolean>({
    origin: { x: normalized.min_x, y: normalized.min_y, z: normalized.min_z },
    width: normalized.max_x - normalized.min_x + 1,
    height: normalized.max_y - normalized.min_y + 1,
    depth: normalized.max_z - normalized.min_z + 1,
    fill: false,
  });
}

function create_evaluated_shape3_cell_sets(
  frame: ShapeSessionFrame3,
  bodyCellKeys: Set<string>,
  wireframeHintKeys?: Set<string>,
  explicitWireframeCellKeys?: Set<string>,
): EvaluatedShape3CellSets {
  const shellCellKeys = collect_local_shell_cell_keys(bodyCellKeys, frame.size_x, frame.size_y, frame.size_z);
  const wireframeCellKeys = explicitWireframeCellKeys
    ? intersect_local_key_sets(explicitWireframeCellKeys, shellCellKeys)
    : (wireframeHintKeys ? intersect_local_key_sets(wireframeHintKeys, shellCellKeys) : shellCellKeys);
  return {
    frame,
    bodyCellKeys,
    shellCellKeys,
    wireframeCellKeys,
  };
}

export function write_evaluated_shape_mode_to_raster<T>(
  raster: Raster3<T>,
  result: EvaluatedShape3CellSets,
  mode: ShapeRenderMode3,
  value: T,
): void {
  const keys = select_evaluated_shape_mode_cell_keys(result, mode);
  write_local_cell_key_set_to_raster(raster, result.frame.anchor, result.frame.basis, keys, value);
}

export function evaluated_shape_mode_to_world_voxels(result: EvaluatedShape3CellSets, mode: ShapeRenderMode3): Voxel3[] {
  return map_local_cell_key_set_to_world_voxels(result.frame, select_evaluated_shape_mode_cell_keys(result, mode))
    .sort((a, b) => (a.z - b.z) || (a.y - b.y) || (a.x - b.x));
}

export function evaluate_box3_session_cell_sets(spec: Box3SessionSpec): EvaluatedShape3CellSets {
  const frame = get_local_shape_session_frame(spec);
  const bodyCellKeys = collect_local_box_body_cells(frame.size_x, frame.size_y, frame.size_z);
  const explicitWireframeCellKeys = collect_local_box_wireframe_cell_keys(frame.size_x, frame.size_y, frame.size_z);
  return create_evaluated_shape3_cell_sets(frame, bodyCellKeys, undefined, explicitWireframeCellKeys);
}

export function evaluate_sphere3_session_cell_sets(spec: Sphere3SessionSpec): EvaluatedShape3CellSets {
  const frame = get_local_shape_session_frame(spec);
  const activeAxes = get_active_local_axes(frame.size_x, frame.size_y, frame.size_z);
  const u_segments = clamp_segment_count(spec.u_segments, 5);
  const v_segments = clamp_segment_count(spec.v_segments, 5);
  const bodyCellKeys = collect_local_sphere_body_cells(frame, u_segments, v_segments);
  const wireframeHintKeys = activeAxes.length >= 3 ? collect_local_sphere_wireframe_hint_keys(frame, u_segments, v_segments) : undefined;
  return create_evaluated_shape3_cell_sets(frame, bodyCellKeys, wireframeHintKeys);
}

export function evaluate_cylinder3_session_cell_sets(spec: Cylinder3SessionSpec): EvaluatedShape3CellSets {
  const frame = get_local_shape_session_frame(spec);
  const activeAxes = get_active_local_axes(frame.size_x, frame.size_y, frame.size_z);
  const radial_segments = clamp_segment_count(spec.radial_segments, 5);
  const bodyCellKeys = collect_local_cylinder_body_cells(frame, radial_segments);
  const wireframeHintKeys = activeAxes.length >= 3 ? collect_local_cylinder_wireframe_hint_keys(frame, radial_segments) : undefined;
  return create_evaluated_shape3_cell_sets(frame, bodyCellKeys, wireframeHintKeys);
}

export function evaluate_cone3_session_cell_sets(spec: Cone3SessionSpec): EvaluatedShape3CellSets {
  const frame = get_local_shape_session_frame(spec);
  const activeAxes = get_active_local_axes(frame.size_x, frame.size_y, frame.size_z);
  const radial_segments = clamp_segment_count(spec.radial_segments, 5);
  const bodyCellKeys = collect_local_cone_body_cells(frame, radial_segments);
  const wireframeHintKeys = activeAxes.length >= 3 ? collect_local_cone_wireframe_hint_keys(frame, radial_segments) : undefined;
  return create_evaluated_shape3_cell_sets(frame, bodyCellKeys, wireframeHintKeys);
}

export function rasterize_box3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Box3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  write_evaluated_shape_mode_to_raster(raster, evaluate_box3_session_cell_sets(spec), mode, value);
}

export function rasterize_box3_session_to_voxels(spec: Box3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  return evaluated_shape_mode_to_world_voxels(evaluate_box3_session_cell_sets(spec), mode);
}

export function rasterize_sphere3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Sphere3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  write_evaluated_shape_mode_to_raster(raster, evaluate_sphere3_session_cell_sets(spec), mode, value);
}

export function rasterize_sphere3_session_to_voxels(spec: Sphere3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  return evaluated_shape_mode_to_world_voxels(evaluate_sphere3_session_cell_sets(spec), mode);
}

export function rasterize_cylinder3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Cylinder3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  write_evaluated_shape_mode_to_raster(raster, evaluate_cylinder3_session_cell_sets(spec), mode, value);
}

export function rasterize_cylinder3_session_to_voxels(spec: Cylinder3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  return evaluated_shape_mode_to_world_voxels(evaluate_cylinder3_session_cell_sets(spec), mode);
}

export function rasterize_cone3_session_into_raster<T>(
  raster: Raster3<T>,
  spec: Cone3SessionSpec,
  mode: ShapeRenderMode3,
  value: T,
): void {
  write_evaluated_shape_mode_to_raster(raster, evaluate_cone3_session_cell_sets(spec), mode, value);
}

export function rasterize_cone3_session_to_voxels(spec: Cone3SessionSpec, mode: ShapeRenderMode3): Voxel3[] {
  return evaluated_shape_mode_to_world_voxels(evaluate_cone3_session_cell_sets(spec), mode);
}

export function box3_session_to_box3_spec(spec: Box3SessionSpec): Box3Spec | null {
  const basis = get_box3_session_basis(spec);
  const is_identity = key_voxel3(basis.right) === '1,0,0' && key_voxel3(basis.up) === '0,1,0' && key_voxel3(basis.forward) === '0,0,1';
  if (!is_identity) return null;
  const normalized = get_local_shape_session_frame(spec);
  return {
    x0: normalized.anchor.x,
    y0: normalized.anchor.y,
    z0: normalized.anchor.z,
    x1: normalized.anchor.x + normalized.size_x - 1,
    y1: normalized.anchor.y + normalized.size_y - 1,
    z1: normalized.anchor.z + normalized.size_z - 1,
  };
}

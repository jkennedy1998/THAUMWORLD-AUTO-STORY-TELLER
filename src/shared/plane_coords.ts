import type { PlaneAxis, PlaneId, PlanePoint, Voxel3 } from './coords.js';
import { voxel3 } from './coords.js';

export function get_plane_axes(plane: PlaneId): {
  u_axis: PlaneAxis;
  v_axis: PlaneAxis;
  depth_axis: PlaneAxis;
} {
  if (plane === 'yz') return { u_axis: 'y', v_axis: 'z', depth_axis: 'x' };
  if (plane === 'xz') return { u_axis: 'x', v_axis: 'z', depth_axis: 'y' };
  return { u_axis: 'x', v_axis: 'y', depth_axis: 'z' };
}

export function project_voxel_to_plane(voxel: Voxel3, plane: PlaneId): {
  point: PlanePoint;
  depth: number;
} {
  if (plane === 'yz') return { point: { u: voxel.y, v: voxel.z }, depth: voxel.x };
  if (plane === 'xz') return { point: { u: voxel.x, v: voxel.z }, depth: voxel.y };
  return { point: { u: voxel.x, v: voxel.y }, depth: voxel.z };
}

export function unproject_plane_to_voxel(point: PlanePoint, plane: PlaneId, depth: number): Voxel3 {
  if (plane === 'yz') return voxel3(depth, point.u, point.v);
  if (plane === 'xz') return voxel3(point.u, depth, point.v);
  return voxel3(point.u, point.v, depth);
}

export function remap_point2_to_plane(x: number, y: number, plane: PlaneId, depth: number): Voxel3 {
  return unproject_plane_to_voxel({ u: x, v: y }, plane, depth);
}

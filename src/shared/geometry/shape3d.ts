import { sphere_plane_intersection_radius } from '../math3d.js';
import { evaluate_visual_los } from '../perception_los.js';
import { evaluate_cone3_session_cell_sets, evaluate_sphere3_session_cell_sets, evaluated_shape_mode_to_world_voxels, local_cell_key_set_to_voxels, select_evaluated_shape_mode_cell_keys } from './shape_rasterize3.js';

export type Shape3DWorldPos = { x: number; y: number; z: number };
export type Shape3DPlaneSlice = {
  plane_index: number;
  plane_z: number;
  radius: number | null;
  quantized_radius: number;
  keys: Set<string>;
};

export type Shape3DLosBlocker = (x: number, y: number, world_z: number) => boolean;

export type VisionConePlaneProjection = {
  visible_by_plane: Set<string>[];
  outline_by_plane: Set<string>[];
  stats: {
    rays_cast: number;
    rays_blocked: number;
    vox_steps: number;
  };
};

function add_circle_points(keys: Set<string>, cx: number, cy: number, x: number, y: number): void {
  keys.add(`${cx + x},${cy + y}`);
  keys.add(`${cx - x},${cy + y}`);
  keys.add(`${cx + x},${cy - y}`);
  keys.add(`${cx - x},${cy - y}`);
  keys.add(`${cx + y},${cy + x}`);
  keys.add(`${cx - y},${cy + x}`);
  keys.add(`${cx + y},${cy - x}`);
  keys.add(`${cx - y},${cy - x}`);
}

export function get_circle_outline_keys(cx: number, cy: number, r: number): Set<string> {
  const rr = Math.max(0, Math.floor(r));
  const keys = new Set<string>();
  if (rr <= 0) {
    keys.add(`${cx},${cy}`);
    return keys;
  }
  let x = rr;
  let y = 0;
  let err = 0;
  while (x >= y) {
    add_circle_points(keys, cx, cy, x, y);
    y++;
    if (err <= 0) err += 2 * y + 1;
    if (err > 0) {
      x--;
      err -= 2 * x + 1;
    }
  }
  return keys;
}

export function get_sphere_outline_plane_slices(opts: {
  origin: Shape3DWorldPos;
  radius: number;
  visible_planes_z: readonly number[];
}): Shape3DPlaneSlice[] {
  const origin_x = Math.round(Number(opts.origin.x));
  const origin_y = Math.round(Number(opts.origin.y));
  const origin_z = Number(opts.origin.z);
  const radius = Number(opts.radius);
  if (!Number.isFinite(origin_x) || !Number.isFinite(origin_y) || !Number.isFinite(origin_z) || !Number.isFinite(radius) || radius <= 0) {
    return [];
  }

  const voxelRadius = Math.max(1, Math.floor(radius));
  const sphere = evaluate_sphere3_session_cell_sets({
    anchor: { x: origin_x - voxelRadius, y: origin_y - voxelRadius, z: Math.round(origin_z) - voxelRadius },
    size: { x: (voxelRadius * 2) + 1, y: (voxelRadius * 2) + 1, z: (voxelRadius * 2) + 1 },
    u_segments: Math.max(5, Math.min(24, voxelRadius * 2)),
    v_segments: Math.max(5, Math.min(24, voxelRadius * 2)),
  });
  const shellWorldVoxels = evaluated_shape_mode_to_world_voxels(sphere, 'surfaces');
  const keysByPlaneZ = new Map<number, Set<string>>();
  for (const voxel of shellWorldVoxels) {
    const planeZ = Math.floor(voxel.z);
    let keys = keysByPlaneZ.get(planeZ);
    if (!keys) {
      keys = new Set<string>();
      keysByPlaneZ.set(planeZ, keys);
    }
    keys.add(`${voxel.x},${voxel.y}`);
  }

  return opts.visible_planes_z.map((plane_z_raw, plane_index) => {
    const plane_z = Number(plane_z_raw);
    const radius_on_plane = sphere_plane_intersection_radius(radius, plane_z - origin_z);
    const quantized_radius = radius_on_plane === null ? 0 : Math.max(0, Math.floor(radius_on_plane + 1e-6));
    return {
      plane_index,
      plane_z,
      radius: radius_on_plane,
      quantized_radius,
      keys: keysByPlaneZ.get(Math.floor(plane_z)) ?? new Set<string>(),
    };
  });
}

export function project_vision_cone_to_planes(opts: {
  origin: Shape3DWorldPos;
  center_yaw_rad: number;
  yaw_fov_deg: number;
  pitch_fov_deg: number;
  range: number;
  visible_planes_z: readonly number[];
  include_boundary?: boolean;
  blocks_los_at?: Shape3DLosBlocker;
}): VisionConePlaneProjection {
  const range = Math.max(0, Math.floor(Number(opts.range)));
  const center_yaw = Number(opts.center_yaw_rad);
  const yaw_fov_deg = Number(opts.yaw_fov_deg);
  const pitch_fov_deg = Number(opts.pitch_fov_deg);
  const include_boundary = opts.include_boundary !== false;

  const visible_by_plane = opts.visible_planes_z.map(() => new Set<string>());
  const outline_by_plane = opts.visible_planes_z.map(() => new Set<string>());
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(center_yaw) || !Number.isFinite(yaw_fov_deg) || yaw_fov_deg <= 0 || !Number.isFinite(pitch_fov_deg) || pitch_fov_deg <= 0) {
    return { visible_by_plane, outline_by_plane, stats: { rays_cast: 0, rays_blocked: 0, vox_steps: 0 } };
  }

  const slot_by_world_z = new Map<number, number>();
  for (let i = 0; i < opts.visible_planes_z.length; i += 1) {
    const wz = Number(opts.visible_planes_z[i]);
    if (Number.isFinite(wz)) slot_by_world_z.set(Math.floor(wz), i);
  }

  const half_yaw = (yaw_fov_deg * Math.PI) / 180 / 2;
  const half_pitch = (pitch_fov_deg * Math.PI) / 180 / 2;
  const radius_x = Math.max(0, Math.ceil(Math.tan(half_yaw) * range));
  const radius_y = Math.max(0, Math.ceil(Math.tan(half_pitch) * range));
  const size_x = (radius_x * 2) + 1;
  const size_y = (radius_y * 2) + 1;
  const size_z = range + 1;
  const radial_segments = Math.max(5, Math.min(24, Math.floor(range * 2)));
  const cone = evaluate_cone3_session_cell_sets({
    anchor: { x: 0, y: 0, z: 0 },
    size: { x: size_x, y: size_y, z: size_z },
    radial_segments,
  });
  const bodyKeys = select_evaluated_shape_mode_cell_keys(cone, 'filled');
  const boundaryKeys = include_boundary ? select_evaluated_shape_mode_cell_keys(cone, 'wireframe') : new Set<string>();
  const center_x = (size_x - 1) / 2;
  const center_y = (size_y - 1) / 2;
  const max_local_z = size_z - 1;
  const forward = { x: Math.cos(center_yaw), y: Math.sin(center_yaw) };
  const right = { x: Math.cos(center_yaw + (Math.PI / 2)), y: Math.sin(center_yaw + (Math.PI / 2)) };
  const world_origin = {
    x: Math.round(Number(opts.origin.x)),
    y: Math.round(Number(opts.origin.y)),
    z: Math.round(Number(opts.origin.z)),
  };
  const project_local_to_world = (local: { x: number; y: number; z: number }): Shape3DWorldPos => {
    const forward_depth = max_local_z - local.z;
    const lateral = local.x - center_x;
    const vertical = local.y - center_y;
    return {
      x: Math.round(world_origin.x + (forward.x * forward_depth) + (right.x * lateral)),
      y: Math.round(world_origin.y + (forward.y * forward_depth) + (right.y * lateral)),
      z: Math.round(world_origin.z + vertical),
    };
  };

  const visibleWorldKeys = new Set<string>();
  let rays_cast = 0;
  let rays_blocked = 0;
  let vox_steps = 0;

  const is_visible_world_voxel = (target: Shape3DWorldPos): boolean => {
    const los = evaluate_visual_los({
      observer: world_origin,
      target,
      center_yaw_rad: center_yaw,
      yaw_fov_deg,
      range_tiles: range,
      blocks_los_at: opts.blocks_los_at,
    });
    vox_steps += los.vox_steps;
    if (!los.visible && los.reason === 'blocked') {
      rays_blocked++;
    }
    return los.visible;
  };

  for (const local of local_cell_key_set_to_voxels(bodyKeys)) {
    const world = project_local_to_world(local);
    rays_cast++;
    if (!is_visible_world_voxel(world)) continue;
    visibleWorldKeys.add(`${world.x},${world.y},${world.z}`);
    const slot = slot_by_world_z.get(world.z);
    if (slot !== undefined) visible_by_plane[slot]?.add(`${world.x},${world.y}`);
  }

  if (include_boundary) {
    for (const local of local_cell_key_set_to_voxels(boundaryKeys)) {
      const world = project_local_to_world(local);
      if (!visibleWorldKeys.has(`${world.x},${world.y},${world.z}`)) continue;
      const slot = slot_by_world_z.get(world.z);
      if (slot !== undefined) outline_by_plane[slot]?.add(`${world.x},${world.y}`);
    }
  }

  const originSlot = slot_by_world_z.get(world_origin.z);
  if (originSlot !== undefined) {
    visible_by_plane[originSlot]?.add(`${world_origin.x},${world_origin.y}`);
    if (include_boundary) outline_by_plane[originSlot]?.add(`${world_origin.x},${world_origin.y}`);
  }

  return { visible_by_plane, outline_by_plane, stats: { rays_cast, rays_blocked, vox_steps } };
}

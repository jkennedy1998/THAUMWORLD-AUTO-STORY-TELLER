import { sphere_plane_intersection_radius, trace_voxel_ray_3d } from '../math3d.js';

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

  return opts.visible_planes_z.map((plane_z_raw, plane_index) => {
    const plane_z = Number(plane_z_raw);
    const radius_on_plane = sphere_plane_intersection_radius(radius, plane_z - origin_z);
    const quantized_radius = radius_on_plane === null ? 0 : Math.max(0, Math.floor(radius_on_plane + 1e-6));
    return {
      plane_index,
      plane_z,
      radius: radius_on_plane,
      quantized_radius,
      keys: radius_on_plane === null || radius_on_plane <= 0
        ? new Set<string>()
        : get_circle_outline_keys(origin_x, origin_y, quantized_radius),
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
  const range = Number(opts.range);
  const center_yaw = Number(opts.center_yaw_rad);
  const yaw_fov_deg = Number(opts.yaw_fov_deg);
  const pitch_fov_deg = Number(opts.pitch_fov_deg);
  const include_boundary = opts.include_boundary !== false;

  const fallback_slot = Math.floor(opts.visible_planes_z.length / 2);
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

  const sets_for_slot = (slot: number): Set<string> => visible_by_plane[slot] ?? visible_by_plane[fallback_slot] ?? new Set<string>();
  const outline_for_slot = (slot: number): Set<string> => outline_by_plane[slot] ?? outline_by_plane[fallback_slot] ?? new Set<string>();

  const half_yaw = (yaw_fov_deg * Math.PI) / 180 / 2;
  const half_pitch = (pitch_fov_deg * Math.PI) / 180 / 2;
  const yaw_steps = Math.max(30, Math.min(90, Math.floor(range * 6)));
  let pitch_steps = Math.max(5, Math.min(13, Math.floor(pitch_fov_deg / 8)));
  if (pitch_steps % 2 === 0) pitch_steps += 1;

  const origin_cont = {
    x: Number(opts.origin.x) + 0.5,
    y: Number(opts.origin.y) + 0.5,
    z: Number(opts.origin.z) + 0.5,
  };
  const oxv = Math.floor(origin_cont.x);
  const oyv = Math.floor(origin_cont.y);
  const ozv = Math.floor(origin_cont.z);

  let rays_cast = 0;
  let rays_blocked = 0;
  let vox_steps = 0;

  const cast_ray = (yaw: number, pitch: number, boundary: boolean) => {
    const cp = Math.cos(pitch);
    const dir = { x: cp * Math.cos(yaw), y: cp * Math.sin(yaw), z: Math.sin(pitch) };
    let blocked = false;

    trace_voxel_ray_3d(origin_cont, dir, range, (vx, vy, vz) => {
      vox_steps++;
      const slot = slot_by_world_z.get(vz);
      if (slot !== undefined) {
        const key = `${vx},${vy}`;
        sets_for_slot(slot).add(key);
        if (boundary) outline_for_slot(slot).add(key);
      }
      if (vx === oxv && vy === oyv && vz === ozv) return;
      if (opts.blocks_los_at && opts.blocks_los_at(vx, vy, vz)) {
        blocked = true;
        return false;
      }
    });

    if (blocked) rays_blocked++;
  };

  for (let iy = 0; iy <= yaw_steps; iy++) {
    const ty = yaw_steps > 0 ? (iy / yaw_steps) : 0;
    const yaw = center_yaw + (-half_yaw + (2 * half_yaw) * ty);
    for (let ip = 0; ip <= pitch_steps; ip++) {
      const tp = pitch_steps > 0 ? (ip / pitch_steps) : 0;
      const pitch = -half_pitch + (2 * half_pitch) * tp;
      const boundary = include_boundary && (iy === 0 || iy === yaw_steps || ip === 0 || ip === pitch_steps);
      rays_cast++;
      cast_ray(yaw, pitch, boundary);
    }
  }

  return { visible_by_plane, outline_by_plane, stats: { rays_cast, rays_blocked, vox_steps } };
}

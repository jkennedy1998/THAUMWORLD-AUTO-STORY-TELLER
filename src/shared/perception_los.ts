import { trace_grid_3d } from './math3d.js';

export type PerceptionLosWorldPos = {
  x: number;
  y: number;
  z?: number;
};

export type PerceptionLosBlocker = (x: number, y: number, world_z: number) => boolean;

export type VisualLosResult = {
  visible: boolean;
  reason: 'visible' | 'same_origin' | 'out_of_range' | 'outside_fov' | 'blocked' | 'invalid';
  distance: number;
  vox_steps: number;
};

function normalize_angle(angle: number): number {
  let out = Number(angle);
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

function to_world_voxel(pos: PerceptionLosWorldPos): { x: number; y: number; z: number } | null {
  const x = Number(pos?.x);
  const y = Number(pos?.y);
  const z_raw = Number(pos?.z ?? 0);
  const z = Number.isFinite(z_raw) ? z_raw : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
  };
}

export function is_within_yaw_fov(opts: {
  observer: PerceptionLosWorldPos;
  target: PerceptionLosWorldPos;
  center_yaw_rad: number;
  yaw_fov_deg: number;
  range_tiles: number;
}): VisualLosResult {
  const observer = to_world_voxel(opts.observer);
  const target = to_world_voxel(opts.target);
  const center_yaw_rad = Number(opts.center_yaw_rad);
  const yaw_fov_deg = Number(opts.yaw_fov_deg);
  const range_tiles = Number(opts.range_tiles);
  if (!observer || !target || !Number.isFinite(center_yaw_rad) || !Number.isFinite(yaw_fov_deg) || !Number.isFinite(range_tiles)) {
    return { visible: false, reason: 'invalid', distance: Number.POSITIVE_INFINITY, vox_steps: 0 };
  }

  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const dz = target.z - observer.z;
  const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  if (distance <= 0.0001) return { visible: true, reason: 'same_origin', distance: 0, vox_steps: 0 };
  if (range_tiles <= 0 || distance > range_tiles) return { visible: false, reason: 'out_of_range', distance, vox_steps: 0 };

  const half_yaw_rad = ((yaw_fov_deg * Math.PI) / 180) / 2;
  const target_yaw_rad = Math.atan2(dy, dx);
  const yaw_delta_rad = normalize_angle(target_yaw_rad - center_yaw_rad);
  if (Math.abs(yaw_delta_rad) > half_yaw_rad) {
    return { visible: false, reason: 'outside_fov', distance, vox_steps: 0 };
  }

  return { visible: true, reason: 'visible', distance, vox_steps: 0 };
}

export function has_voxel_line_of_sight(opts: {
  observer: PerceptionLosWorldPos;
  target: PerceptionLosWorldPos;
  blocks_los_at?: PerceptionLosBlocker;
}): VisualLosResult {
  const observer = to_world_voxel(opts.observer);
  const target = to_world_voxel(opts.target);
  if (!observer || !target) {
    return { visible: false, reason: 'invalid', distance: Number.POSITIVE_INFINITY, vox_steps: 0 };
  }

  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const dz = target.z - observer.z;
  const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
  if (distance <= 0.0001) return { visible: true, reason: 'same_origin', distance: 0, vox_steps: 0 };
  if (!opts.blocks_los_at) return { visible: true, reason: 'visible', distance, vox_steps: 0 };

  let blocked = false;
  let vox_steps = 0;
  trace_grid_3d(observer, target, (x, y, z) => {
    vox_steps += 1;
    if (x === observer.x && y === observer.y && z === observer.z) return;
    if (x === target.x && y === target.y && z === target.z) return false;
    if (opts.blocks_los_at?.(x, y, z)) {
      blocked = true;
      return false;
    }
  });

  return blocked
    ? { visible: false, reason: 'blocked', distance, vox_steps }
    : { visible: true, reason: 'visible', distance, vox_steps };
}

export function evaluate_visual_los(opts: {
  observer: PerceptionLosWorldPos;
  target: PerceptionLosWorldPos;
  center_yaw_rad: number;
  yaw_fov_deg: number;
  range_tiles: number;
  blocks_los_at?: PerceptionLosBlocker;
}): VisualLosResult {
  const directional = is_within_yaw_fov(opts);
  if (!directional.visible) return directional;
  const los = has_voxel_line_of_sight(opts);
  if (!los.visible) return los;
  return {
    visible: true,
    reason: directional.reason === 'same_origin' ? 'same_origin' : 'visible',
    distance: directional.distance,
    vox_steps: los.vox_steps,
  };
}

import type { CameraConfig } from '../../ascii_painter/voxel_space.js';

export type CameraSettingsAppId = 'thaum_painter' | 'thaum_world';

export type CameraSliderLimit = {
  min: number;
  max: number;
  step: number;
  digits: number;
};

export type CameraLimitProfile = {
  movement_per_layer: CameraSliderLimit;
  scale_per_layer: CameraSliderLimit;
  mouse_angle_yaw_deg: CameraSliderLimit;
  mouse_angle_pitch_deg: CameraSliderLimit;
  mouse_angle_spring: CameraSliderLimit;
  render_distance_planes: CameraSliderLimit;
  calibration_x: CameraSliderLimit;
  calibration_y: CameraSliderLimit;
  base_layer_scale: CameraSliderLimit;
  char_spacing_x: CameraSliderLimit;
  char_spacing_y: CameraSliderLimit;
  pan_x: CameraSliderLimit;
  pan_y: CameraSliderLimit;
};

export const CAMERA_LIMIT_PROFILES: Record<CameraSettingsAppId, CameraLimitProfile> = {
  thaum_painter: {
    movement_per_layer: { min: -500, max: 500, step: 1, digits: 0 },
    scale_per_layer: { min: -1, max: 1, step: 0.01, digits: 2 },
    mouse_angle_yaw_deg: { min: -45, max: 45, step: 0.5, digits: 1 },
    mouse_angle_pitch_deg: { min: -45, max: 45, step: 0.5, digits: 1 },
    mouse_angle_spring: { min: 1, max: 30, step: 0.5, digits: 1 },
    render_distance_planes: { min: 0, max: 8, step: 1, digits: 0 },
    calibration_x: { min: -500, max: 500, step: 1, digits: 0 },
    calibration_y: { min: -500, max: 500, step: 1, digits: 0 },
    base_layer_scale: { min: 0.2, max: 1.5, step: 0.01, digits: 2 },
    char_spacing_x: { min: 0.5, max: 2.0, step: 0.01, digits: 2 },
    char_spacing_y: { min: 0.5, max: 2.0, step: 0.01, digits: 2 },
    pan_x: { min: -100, max: 100, step: 1, digits: 0 },
    pan_y: { min: -100, max: 100, step: 1, digits: 0 },
  },
  thaum_world: {
    movement_per_layer: { min: -500, max: 500, step: 1, digits: 0 },
    scale_per_layer: { min: -1, max: 1, step: 0.01, digits: 2 },
    mouse_angle_yaw_deg: { min: -45, max: 45, step: 0.5, digits: 1 },
    mouse_angle_pitch_deg: { min: -45, max: 45, step: 0.5, digits: 1 },
    mouse_angle_spring: { min: 1, max: 30, step: 0.5, digits: 1 },
    render_distance_planes: { min: 0, max: 8, step: 1, digits: 0 },
    calibration_x: { min: -500, max: 500, step: 1, digits: 0 },
    calibration_y: { min: -500, max: 500, step: 1, digits: 0 },
    base_layer_scale: { min: 0.2, max: 1.5, step: 0.01, digits: 2 },
    char_spacing_x: { min: 0.5, max: 2.0, step: 0.01, digits: 2 },
    char_spacing_y: { min: 0.5, max: 2.0, step: 0.01, digits: 2 },
    pan_x: { min: -100, max: 100, step: 1, digits: 0 },
    pan_y: { min: -100, max: 100, step: 1, digits: 0 },
  },
};

export function get_camera_limit_profile(app_id: CameraSettingsAppId): CameraLimitProfile {
  return CAMERA_LIMIT_PROFILES[app_id];
}

function clamp(value: number, limit: CameraSliderLimit): number {
  return Math.max(limit.min, Math.min(limit.max, value));
}

export function sanitize_camera_config_for_app(app_id: CameraSettingsAppId, config: Partial<CameraConfig> | null | undefined): Partial<CameraConfig> {
  if (!config) return {};
  const limits = get_camera_limit_profile(app_id);
  const next: Partial<CameraConfig> = { ...config };
  if (typeof next.movement_per_layer === 'number') next.movement_per_layer = clamp(next.movement_per_layer, limits.movement_per_layer);
  if (typeof next.scale_per_layer === 'number') next.scale_per_layer = clamp(next.scale_per_layer, limits.scale_per_layer);
  if (typeof next.mouse_angle_yaw_deg === 'number') next.mouse_angle_yaw_deg = clamp(next.mouse_angle_yaw_deg, limits.mouse_angle_yaw_deg);
  if (typeof next.mouse_angle_pitch_deg === 'number') next.mouse_angle_pitch_deg = clamp(next.mouse_angle_pitch_deg, limits.mouse_angle_pitch_deg);
  if (typeof next.mouse_angle_spring === 'number') next.mouse_angle_spring = clamp(next.mouse_angle_spring, limits.mouse_angle_spring);
  if (typeof next.render_distance_planes === 'number') next.render_distance_planes = Math.round(clamp(next.render_distance_planes, limits.render_distance_planes));
  if (typeof next.base_layer_scale === 'number') next.base_layer_scale = clamp(next.base_layer_scale, limits.base_layer_scale);
  if (typeof next.char_spacing_x === 'number') next.char_spacing_x = clamp(next.char_spacing_x, limits.char_spacing_x);
  if (typeof next.char_spacing_y === 'number') next.char_spacing_y = clamp(next.char_spacing_y, limits.char_spacing_y);
  if (typeof next.pan_x === 'number') next.pan_x = Math.round(clamp(next.pan_x, limits.pan_x));
  if (typeof next.pan_y === 'number') next.pan_y = Math.round(clamp(next.pan_y, limits.pan_y));
  if (next.calibration) {
    next.calibration = {
      x: Math.round(clamp(next.calibration.x ?? 0, limits.calibration_x)),
      y: Math.round(clamp(next.calibration.y ?? 0, limits.calibration_y)),
    };
  }
  return next;
}

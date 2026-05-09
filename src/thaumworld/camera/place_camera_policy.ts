import type { CameraFollowPolicy, CameraMotionStyle } from '../../engine/camera/camera_types.js';

export type CameraPolicyPreset = {
  follow_policy: CameraFollowPolicy;
  motion_style: CameraMotionStyle;
};

export function get_thaumworld_place_camera_world_sim_policy(): CameraPolicyPreset {
  return {
    follow_policy: { kind: 'track_until_any_manual_camera_input' },
    motion_style: { kind: 'smooth', lerp: 1 },
  };
}

export function get_thaumworld_place_camera_turn_start_policy(): CameraPolicyPreset {
  return {
    follow_policy: { kind: 'snap_once' },
    motion_style: { kind: 'snap' },
  };
}

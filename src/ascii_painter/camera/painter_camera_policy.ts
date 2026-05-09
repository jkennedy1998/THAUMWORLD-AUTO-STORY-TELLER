import type { CameraFollowPolicy, CameraMotionStyle } from '../../engine/camera/camera_types.js';

export type PainterCameraPolicyPreset = {
  follow_policy: CameraFollowPolicy;
  motion_style: CameraMotionStyle;
};

export function get_painter_camera_boot_policy(): PainterCameraPolicyPreset {
  return {
    follow_policy: { kind: 'snap_once' },
    motion_style: { kind: 'snap' },
  };
}

export function get_painter_camera_text_cursor_policy(): PainterCameraPolicyPreset {
  return {
    follow_policy: { kind: 'track_until_manual_pan' },
    motion_style: { kind: 'smooth', lerp: 1 },
  };
}

export function get_painter_camera_detached_policy(): PainterCameraPolicyPreset {
  return {
    follow_policy: { kind: 'detached' },
    motion_style: { kind: 'snap' },
  };
}

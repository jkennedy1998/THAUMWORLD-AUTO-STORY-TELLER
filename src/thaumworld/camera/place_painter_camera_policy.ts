import type { CameraPolicyPreset } from './place_camera_policy.js';

export function get_thaumworld_place_painter_boot_policy(): CameraPolicyPreset {
  return {
    follow_policy: { kind: 'snap_once' },
    motion_style: { kind: 'snap' },
  };
}

export function get_thaumworld_place_painter_detached_policy(): CameraPolicyPreset {
  return {
    follow_policy: { kind: 'detached' },
    motion_style: { kind: 'snap' },
  };
}

import type { PanBounds2, PanBounds3 } from './pan_types.js';

export function clamp_pan_2(value: { x: number; y: number }, bounds: PanBounds2): { x: number; y: number } {
  return {
    x: Math.max(bounds.min_x, Math.min(bounds.max_x, value.x)),
    y: Math.max(bounds.min_y, Math.min(bounds.max_y, value.y)),
  };
}

export function clamp_pan_3(value: { x: number; y: number; z: number }, bounds: PanBounds3): { x: number; y: number; z: number } {
  return {
    x: bounds.min_x !== undefined || bounds.max_x !== undefined
      ? Math.max(bounds.min_x ?? value.x, Math.min(bounds.max_x ?? value.x, value.x))
      : value.x,
    y: bounds.min_y !== undefined || bounds.max_y !== undefined
      ? Math.max(bounds.min_y ?? value.y, Math.min(bounds.max_y ?? value.y, value.y))
      : value.y,
    z: bounds.min_z !== undefined || bounds.max_z !== undefined
      ? Math.max(bounds.min_z ?? value.z, Math.min(bounds.max_z ?? value.z, value.z))
      : value.z,
  };
}

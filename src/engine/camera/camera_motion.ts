import type { CameraMotionStyle, WorldPoint3 } from './camera_types.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function move_camera_anchor_toward(current: WorldPoint3, target: WorldPoint3, motion: CameraMotionStyle, dt_ms: number): WorldPoint3 {
  if (motion.kind === 'snap') return { ...target };
  if (motion.kind === 'smooth') {
    const lerp = clamp01(motion.lerp);
    return {
      x: current.x + (target.x - current.x) * lerp,
      y: current.y + (target.y - current.y) * lerp,
      z: current.z + (target.z - current.z) * lerp,
    };
  }
  const dt = Math.max(0, Number.isFinite(dt_ms) ? dt_ms : 0) / 1000;
  const stiffness = Math.max(0, Number.isFinite(motion.stiffness) ? motion.stiffness : 0);
  const damping = Math.max(0, Number.isFinite(motion.damping) ? motion.damping : 0);
  const factor = clamp01(dt * stiffness * Math.max(0.05, damping));
  return {
    x: current.x + (target.x - current.x) * factor,
    y: current.y + (target.y - current.y) * factor,
    z: current.z + (target.z - current.z) * factor,
  };
}

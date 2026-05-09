import type { PanMotionStyle } from './pan_types.js';

export function is_snap_pan_motion(style: PanMotionStyle): boolean {
  return style.kind === 'snap';
}

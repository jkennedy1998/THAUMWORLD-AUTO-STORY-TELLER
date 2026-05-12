import type { IPanTargetAdapter } from '../../../engine/pan/pan_target.js';

export function create_flat_module_pan_adapter(args: {
  get_offset: () => { x: number; y: number };
  set_offset: (x: number, y: number) => void;
  clamp?: (x: number, y: number) => { x: number; y: number };
  persist?: () => void;
  pixel_to_pan_scale?: number;
}): IPanTargetAdapter {
  return {
    getKind: () => 'module_2d',
    getCapabilities: () => ({
      axes: { x: true, y: true },
      space: 'module_cells',
      motion_style: { kind: 'snap' },
    }),
    applyScreenDelta(dx, dy) {
      const current = args.get_offset();
      const scale = args.pixel_to_pan_scale ?? 1;
      const next_raw_x = current.x + (dx * scale);
      const next_raw_y = current.y + (dy * scale);
      const next = args.clamp ? args.clamp(next_raw_x, next_raw_y) : { x: next_raw_x, y: next_raw_y };
      args.set_offset(next.x, next.y);
    },
    applyAxisDelta(delta) {
      const current = args.get_offset();
      const next_raw_x = current.x + (delta.x ?? 0);
      const next_raw_y = current.y + (delta.y ?? 0);
      const next = args.clamp ? args.clamp(next_raw_x, next_raw_y) : { x: next_raw_x, y: next_raw_y };
      args.set_offset(next.x, next.y);
      args.persist?.();
    },
    endGesture() {
      args.persist?.();
    },
  };
}

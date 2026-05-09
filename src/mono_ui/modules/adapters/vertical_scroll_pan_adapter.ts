import type { IPanTargetAdapter } from '../../../engine/pan/pan_target.js';

export function create_vertical_scroll_pan_adapter(args: {
  get_scroll_y: () => number;
  set_scroll_y: (y: number) => void;
  clamp: (y: number) => number;
}): IPanTargetAdapter {
  return {
    getKind: () => 'scroll_1d',
    getCapabilities: () => ({
      axes: { y: true },
      space: 'module_cells',
      motion_style: { kind: 'snap' },
    }),
    applyAxisDelta(delta) {
      const next = args.clamp(args.get_scroll_y() + (delta.y ?? 0));
      args.set_scroll_y(next);
    },
  };
}

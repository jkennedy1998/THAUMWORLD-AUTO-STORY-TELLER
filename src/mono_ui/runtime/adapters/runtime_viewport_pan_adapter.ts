import type { IPanTargetAdapter } from '../../../engine/pan/pan_target.js';

export function create_runtime_viewport_pan_adapter(opts: {
  begin?: () => void;
  apply_screen_delta: (dx: number, dy: number) => void;
  end?: () => void;
}): IPanTargetAdapter {
  return {
    getKind: () => 'viewport',
    getCapabilities: () => ({
      axes: { x: true, y: true },
      space: 'screen_tiles',
      motion_style: { kind: 'snap' },
    }),
    beginGesture() {
      opts.begin?.();
    },
    applyScreenDelta(dx, dy) {
      opts.apply_screen_delta(dx, dy);
    },
    endGesture() {
      opts.end?.();
    },
  };
}

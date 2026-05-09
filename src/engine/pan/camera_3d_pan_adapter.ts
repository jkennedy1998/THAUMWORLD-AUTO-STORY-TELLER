import type { IPanTargetAdapter } from './pan_target.js';

export type Camera3DPanWorldAnchor = { x: number; y: number; z: number };
export type Camera3DPanDirection = 'right' | 'up';
export type Camera3DPanSource = 'screen_drag' | 'axis_step';

export function create_camera_3d_pan_adapter<TViewState>(args: {
  get_view_state: () => TViewState;
  get_anchor: () => Camera3DPanWorldAnchor;
  set_anchor: (anchor: Camera3DPanWorldAnchor, context: { source: Camera3DPanSource; detach_follow: boolean }) => void;
  map_screen_direction_to_world_delta: (view: TViewState, direction: Camera3DPanDirection) => Camera3DPanWorldAnchor;
  get_screen_step_size_px: () => { x: number; y: number };
  normalize_anchor?: (anchor: Camera3DPanWorldAnchor, view: TViewState) => Camera3DPanWorldAnchor;
  clamp_anchor?: (anchor: Camera3DPanWorldAnchor, view: TViewState) => Camera3DPanWorldAnchor;
  on_after_pan?: (context: { source: Camera3DPanSource; anchor: Camera3DPanWorldAnchor }) => void;
  on_gesture_end?: () => void;
  detach_follow_on_manual_pan?: boolean;
}): IPanTargetAdapter {
  let remainder_px_x = 0;
  let remainder_px_y = 0;

  function normalize(anchor: Camera3DPanWorldAnchor, view: TViewState): Camera3DPanWorldAnchor {
    const normalized = args.normalize_anchor ? args.normalize_anchor(anchor, view) : anchor;
    return args.clamp_anchor ? args.clamp_anchor(normalized, view) : normalized;
  }

  function apply_axis_pan(delta_x: number, delta_y: number, source: Camera3DPanSource): void {
    const step_x = Number.isFinite(delta_x) ? Math.trunc(delta_x) : 0;
    const step_y = Number.isFinite(delta_y) ? Math.trunc(delta_y) : 0;
    if (step_x === 0 && step_y === 0) return;
    const view = args.get_view_state();
    const right = args.map_screen_direction_to_world_delta(view, 'right');
    const up = args.map_screen_direction_to_world_delta(view, 'up');
    const current = args.get_anchor();
    const next = normalize({
      x: current.x - (right.x * step_x) - (up.x * step_y),
      y: current.y - (right.y * step_x) - (up.y * step_y),
      z: current.z - (right.z * step_x) - (up.z * step_y),
    }, view);
    args.set_anchor(next, {
      source,
      detach_follow: args.detach_follow_on_manual_pan !== false,
    });
    args.on_after_pan?.({ source, anchor: next });
  }

  return {
    getKind: () => 'camera_3d',
    getCapabilities: () => ({
      axes: { x: true, y: true },
      space: 'world',
      motion_style: { kind: 'snap' },
      can_detach_follow: true,
    }),
    beginGesture() {
      remainder_px_x = 0;
      remainder_px_y = 0;
    },
    applyScreenDelta(dx, dy) {
      const step_size = args.get_screen_step_size_px();
      const step_w = Number.isFinite(step_size.x) && step_size.x > 0 ? step_size.x : 0;
      const step_h = Number.isFinite(step_size.y) && step_size.y > 0 ? step_size.y : 0;
      if (!(step_w > 0) || !(step_h > 0)) {
        apply_axis_pan(dx, -dy, 'screen_drag');
        return;
      }
      remainder_px_x += Number.isFinite(dx) ? dx : 0;
      remainder_px_y += Number.isFinite(dy) ? dy : 0;
      const step_x = Math.trunc(remainder_px_x / step_w);
      const step_y = Math.trunc(remainder_px_y / step_h);
      if (step_x === 0 && step_y === 0) return;
      remainder_px_x -= step_x * step_w;
      remainder_px_y -= step_y * step_h;
      apply_axis_pan(step_x, -step_y, 'screen_drag');
    },
    applyAxisDelta(delta) {
      apply_axis_pan(delta.x ?? 0, delta.y ?? 0, 'axis_step');
    },
    endGesture() {
      remainder_px_x = 0;
      remainder_px_y = 0;
      args.on_gesture_end?.();
    },
    cancelGesture() {
      remainder_px_x = 0;
      remainder_px_y = 0;
    },
  };
}

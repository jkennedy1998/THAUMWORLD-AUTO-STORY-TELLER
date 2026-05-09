import { create_camera_3d_pan_adapter, type Camera3DPanSource } from '../../../engine/pan/camera_3d_pan_adapter.js';
import { map_screen_direction_to_world_delta, type PlaceViewState } from '../../runtime/place_view_projection.js';

export function create_place_module_pan_adapter(args: {
  get_world_anchor: () => { x: number; y: number; z: number };
  set_world_anchor: (anchor: { x: number; y: number; z: number }, context: { source: 'screen_drag' | 'axis_step'; detach_follow: boolean }) => void;
  get_view_state: () => PlaceViewState;
  get_screen_step_size_px: () => { x: number; y: number };
  on_after_pan?: (context: { source: Camera3DPanSource; anchor: { x: number; y: number; z: number } }) => void;
  on_gesture_end?: () => void;
}) {
  return create_camera_3d_pan_adapter({
    get_view_state: args.get_view_state,
    get_anchor: args.get_world_anchor,
    set_anchor: args.set_world_anchor,
    map_screen_direction_to_world_delta,
    get_screen_step_size_px: args.get_screen_step_size_px,
    on_after_pan: args.on_after_pan,
    on_gesture_end: args.on_gesture_end,
  });
}

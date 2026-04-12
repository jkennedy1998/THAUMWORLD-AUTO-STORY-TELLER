import {
  make_place_view_state,
  rotate_place_view_roll,
  swing_place_view,
  type PlaceViewState,
} from './place_view_projection.js';
import { sample_place_camera_transition, type PlaceCameraTransition } from './place_camera_pose.js';

export type PlaceViewTransitionFrame = {
  hard_view: PlaceViewState;
  target_view: PlaceViewState;
  transition_kind: 'swing' | 'roll' | null;
  phase: 'pre_snap' | 'post_snap' | null;
  euler: { x: number; y: number; z: number };
  active: boolean;
  committed_this_frame: boolean;
};

export type PlaceViewTransitionResolution = {
  frame: PlaceViewTransitionFrame;
  hard_view: PlaceViewState;
  target_view: PlaceViewState;
  transition: PlaceCameraTransition | null;
};

export function get_place_view_render_euler(state: PlaceViewState): { x: number; y: number; z: number } {
  const current = make_place_view_state(state.principal_view, state.roll_quarter_turn);
  const roll_z = current.roll_quarter_turn * 90;
  switch (current.principal_view) {
    case 'bottom':
      return { x: 180, y: 0, z: roll_z };
    case 'north':
      return { x: 90, y: 0, z: roll_z };
    case 'south':
      return { x: -90, y: 180, z: roll_z };
    case 'east':
      return { x: 0, y: -90, z: roll_z };
    case 'west':
      return { x: 0, y: 90, z: roll_z };
    case 'top':
    default:
      return { x: 0, y: 0, z: roll_z };
  }
}

export function resolve_place_view_transition_frame(args: {
  target_view: PlaceViewState;
  hard_view?: PlaceViewState | null;
  transition: PlaceCameraTransition | null | undefined;
  now_ms: number;
}): PlaceViewTransitionResolution {
  const target_before = make_place_view_state(args.target_view.principal_view, args.target_view.roll_quarter_turn);
  const hard_before = args.hard_view
    ? make_place_view_state(args.hard_view.principal_view, args.hard_view.roll_quarter_turn)
    : target_before;
  const transition = args.transition ?? null;

  if (!transition) {
    return {
      frame: {
        hard_view: hard_before,
        target_view: target_before,
        transition_kind: null,
        phase: null,
        euler: { x: 0, y: 0, z: 0 },
        active: false,
        committed_this_frame: false,
      },
      hard_view: hard_before,
      target_view: target_before,
      transition: null,
    };
  }

  const sample = sample_place_camera_transition(transition, args.now_ms);
  let committed_this_frame = false;
  let next_target_view = target_before;
  let next_hard_view = hard_before;
  let next_transition: PlaceCameraTransition | null = transition;
  let phase: 'pre_snap' | 'post_snap' | null = transition.phase;
  let euler = sample.euler_rotation;

  if (transition.phase === 'pre_snap' && sample.should_commit_snap) {
    next_target_view = transition.kind === 'roll'
      ? rotate_place_view_roll(target_before, transition.direction as 'left' | 'right')
      : swing_place_view(target_before, transition.direction as 'left' | 'right' | 'up' | 'down');
    next_hard_view = next_target_view;
    committed_this_frame = true;
    phase = 'post_snap';
    next_transition = { ...transition, phase: 'post_snap', started_at_ms: args.now_ms };
    euler = sample_place_camera_transition(next_transition, args.now_ms).euler_rotation;
  } else if (transition.phase === 'post_snap' && sample.done) {
    next_transition = null;
    phase = null;
    euler = { x: 0, y: 0, z: 0 };
  }

  return {
    frame: {
      hard_view: next_hard_view,
      target_view: next_target_view,
      transition_kind: phase ? (next_transition?.kind ?? transition.kind) : null,
      phase,
      euler,
      active: phase !== null,
      committed_this_frame,
    },
    hard_view: next_hard_view,
    target_view: next_target_view,
    transition: next_transition,
  };
}

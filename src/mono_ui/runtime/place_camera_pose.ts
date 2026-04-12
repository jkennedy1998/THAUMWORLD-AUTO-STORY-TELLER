export type PlaceCameraTransitionPhase = 'pre_snap' | 'post_snap';
export type PlaceCameraTransitionKind = 'swing' | 'roll';
export type PlaceCameraSwingDirection = 'left' | 'right' | 'up' | 'down';
export type PlaceCameraRollDirection = 'left' | 'right';

export type PlaceCameraTransition = {
  kind: PlaceCameraTransitionKind;
  direction: PlaceCameraSwingDirection | PlaceCameraRollDirection;
  roll_quarter_turn: 0 | 1 | 2 | 3;
  full_euler: { x: number; y: number; z: number };
  phase: PlaceCameraTransitionPhase;
  started_at_ms: number;
  pre_duration_ms: number;
  post_duration_ms: number;
  breakpoint_deg: number;
};

export type TransitionSample = {
  euler_rotation: { x: number; y: number; z: number };
  should_commit_snap: boolean;
  done: boolean;
};

function ease_out_cubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function ease_in_cubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * clamped;
}

export function start_swing_transition(direction: PlaceCameraSwingDirection, now_ms: number, full_euler: { x: number; y: number; z: number }): PlaceCameraTransition {
  return {
    kind: 'swing',
    direction,
    roll_quarter_turn: 0,
    full_euler,
    phase: 'pre_snap',
    started_at_ms: now_ms,
    pre_duration_ms: 280,
    post_duration_ms: 280,
    breakpoint_deg: 45,
  };
}

export function start_roll_transition(direction: PlaceCameraRollDirection, now_ms: number, roll_quarter_turn: 0 | 1 | 2 | 3 = 0, full_euler: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): PlaceCameraTransition {
  return {
    kind: 'roll',
    direction,
    roll_quarter_turn,
    full_euler,
    phase: 'pre_snap',
    started_at_ms: now_ms,
    pre_duration_ms: 280,
    post_duration_ms: 280,
    breakpoint_deg: 45,
  };
}

export function sample_place_camera_transition(transition: PlaceCameraTransition | null | undefined, now_ms: number): TransitionSample {
  if (!transition) {
    return { euler_rotation: { x: 0, y: 0, z: 0 }, should_commit_snap: false, done: true };
  }
  if (transition.phase === 'pre_snap') {
    const local_t = Math.max(0, Math.min(1, (now_ms - transition.started_at_ms) / Math.max(1, transition.pre_duration_ms)));
    const k = ease_in_cubic(local_t);
    return {
      euler_rotation: { x: transition.full_euler.x * k, y: transition.full_euler.y * k, z: transition.full_euler.z * k },
      should_commit_snap: local_t >= 1,
      done: false,
    };
  }

  const local_t = Math.max(0, Math.min(1, (now_ms - transition.started_at_ms) / Math.max(1, transition.post_duration_ms)));
  const k = 1 - ease_out_cubic(local_t);
  return {
    euler_rotation: {
      x: -transition.full_euler.x * k,
      y: -transition.full_euler.y * k,
      z: -transition.full_euler.z * k,
    },
    should_commit_snap: false,
    done: local_t >= 1,
  };
}

export type WorldPoint3 = {
  x: number;
  y: number;
  z: number;
};

export type CameraViewport = {
  width: number;
  height: number;
};

export type CameraFollowPolicy =
  | { kind: 'detached' }
  | { kind: 'snap_once' }
  | { kind: 'track' }
  | { kind: 'track_until_manual_pan' }
  | { kind: 'track_until_manual_depth' }
  | { kind: 'track_until_any_manual_camera_input' };

export type CameraMotionStyle =
  | { kind: 'snap' }
  | { kind: 'smooth'; lerp: number }
  | { kind: 'spring'; stiffness: number; damping: number };

export type Module3DCameraView<TSubject = unknown, TOrientation = string> = {
  subject: TSubject | null;
  follow_policy: CameraFollowPolicy;
  follow_active: boolean;
  frame_anchor_world: WorldPoint3;
  focus_target_world: WorldPoint3 | null;
  focus_plane: number;
  orientation: TOrientation;
  viewport: CameraViewport;
  motion_style: CameraMotionStyle;
  transition_state: unknown;
  last_resolved_subject_world: WorldPoint3 | null;
};

export type Module3DCameraState<TSubject = unknown, TOrientation = string> = {
  semantic: {
    subject: TSubject | null;
    follow_policy: CameraFollowPolicy;
    follow_active: boolean;
    last_resolved_subject_world: WorldPoint3 | null;
  };
  framing: {
    frame_anchor_world: WorldPoint3;
    focus_plane: number;
    orientation: TOrientation;
    viewport: CameraViewport;
  };
  presentation: {
    motion_style: CameraMotionStyle;
    transition_state: unknown;
  };
};

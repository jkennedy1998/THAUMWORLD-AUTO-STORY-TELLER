import { move_camera_anchor_toward } from './camera_motion.js';
import { is_camera_follow_policy_active, is_camera_snap_once_policy, should_detach_camera_follow_for_manual_depth, should_detach_camera_follow_for_manual_input, should_detach_camera_follow_for_manual_pan } from './camera_policy.js';
import type { CameraSubjectResolver } from './camera_subject.js';
import type { CameraFollowPolicy, CameraMotionStyle, CameraViewport, Module3DCameraState, Module3DCameraView, WorldPoint3 } from './camera_types.js';

export type Module3DCameraOptions<TSubject, TOrientation> = {
  resolver: CameraSubjectResolver<TSubject>;
  initial_frame_anchor_world?: WorldPoint3;
  initial_focus_plane?: number;
  initial_orientation: TOrientation;
  initial_viewport?: CameraViewport;
  initial_follow_policy?: CameraFollowPolicy;
  initial_motion_style?: CameraMotionStyle;
  initial_subject?: TSubject | null;
  initial_transition_state?: unknown;
};

export type Module3DCamera<TSubject, TOrientation> = {
  setSubject(subject: TSubject | null): void;
  clearSubject(): void;
  setFollowPolicy(policy: CameraFollowPolicy): void;
  setMotionStyle(style: CameraMotionStyle): void;
  recenterOnSubject(now_ms?: number): boolean;
  setFrameAnchor(world: WorldPoint3): void;
  panFrameBy(delta: Partial<WorldPoint3>): void;
  setFocusPlane(plane: number): void;
  stepFocusPlane(dir: number): void;
  setOrientation(orientation: TOrientation): void;
  setViewport(viewport: CameraViewport): void;
  setTransitionState(transition_state: unknown): void;
  notifyManualPan(): void;
  notifyManualDepthChange(): void;
  notifyManualCameraInput(): void;
  tick(now_ms?: number): boolean;
  getState(): Module3DCameraState<TSubject, TOrientation>;
  getProjectionView(): Module3DCameraView<TSubject, TOrientation>;
};

function normalize_world(world: WorldPoint3 | null | undefined, fallback: WorldPoint3): WorldPoint3 {
  const x = Number(world?.x);
  const y = Number(world?.y);
  const z = Number(world?.z);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    z: Number.isFinite(z) ? z : fallback.z,
  };
}

export function create_module_3d_camera<TSubject, TOrientation>(options: Module3DCameraOptions<TSubject, TOrientation>): Module3DCamera<TSubject, TOrientation> {
  const fallbackAnchor = normalize_world(options.initial_frame_anchor_world, { x: 0, y: 0, z: 0 });
  const state: Module3DCameraState<TSubject, TOrientation> = {
    semantic: {
      subject: options.initial_subject ?? null,
      follow_policy: options.initial_follow_policy ?? { kind: 'detached' },
      follow_active: is_camera_follow_policy_active(options.initial_follow_policy ?? { kind: 'detached' }),
      last_resolved_subject_world: null,
    },
    framing: {
      frame_anchor_world: fallbackAnchor,
      focus_plane: Number.isFinite(options.initial_focus_plane) ? Math.floor(options.initial_focus_plane as number) : Math.floor(fallbackAnchor.z),
      orientation: options.initial_orientation,
      viewport: {
        width: Math.max(0, Math.floor(options.initial_viewport?.width ?? 0)),
        height: Math.max(0, Math.floor(options.initial_viewport?.height ?? 0)),
      },
    },
    presentation: {
      motion_style: options.initial_motion_style ?? { kind: 'snap' },
      transition_state: options.initial_transition_state ?? null,
    },
  };
  let last_tick_ms = Date.now();

  function refresh_follow_active(): void {
    state.semantic.follow_active = is_camera_follow_policy_active(state.semantic.follow_policy);
  }

  function resolve_current_subject() {
    const resolved = options.resolver.resolveSubject(state.semantic.subject);
    state.semantic.last_resolved_subject_world = resolved?.world ? { ...resolved.world } : null;
    return resolved;
  }

  function move_anchor_to_target(target: WorldPoint3, now_ms: number): boolean {
    const dt_ms = Math.max(0, now_ms - last_tick_ms);
    const next = move_camera_anchor_toward(state.framing.frame_anchor_world, target, state.presentation.motion_style, dt_ms);
    const changed = next.x !== state.framing.frame_anchor_world.x || next.y !== state.framing.frame_anchor_world.y || next.z !== state.framing.frame_anchor_world.z;
    state.framing.frame_anchor_world = next;
    last_tick_ms = now_ms;
    return changed;
  }

  return {
    setSubject(subject) {
      state.semantic.subject = subject;
      const resolved = resolve_current_subject();
      if (resolved && Number.isFinite(resolved.preferred_focus_plane)) {
        state.framing.focus_plane = Math.floor(resolved.preferred_focus_plane as number);
      }
    },
    clearSubject() {
      state.semantic.subject = null;
      state.semantic.last_resolved_subject_world = null;
      state.semantic.follow_active = false;
    },
    setFollowPolicy(policy) {
      state.semantic.follow_policy = policy;
      refresh_follow_active();
    },
    setMotionStyle(style) {
      state.presentation.motion_style = style;
    },
    recenterOnSubject(now_ms = Date.now()) {
      const resolved = resolve_current_subject();
      if (!resolved) return false;
      if (Number.isFinite(resolved.preferred_focus_plane)) {
        state.framing.focus_plane = Math.floor(resolved.preferred_focus_plane as number);
      }
      const changed = move_anchor_to_target(resolved.world, now_ms);
      if (is_camera_snap_once_policy(state.semantic.follow_policy)) {
        state.semantic.follow_active = false;
      }
      return changed;
    },
    setFrameAnchor(world) {
      state.framing.frame_anchor_world = normalize_world(world, state.framing.frame_anchor_world);
    },
    panFrameBy(delta) {
      state.framing.frame_anchor_world = {
        x: state.framing.frame_anchor_world.x + (Number.isFinite(delta.x) ? Number(delta.x) : 0),
        y: state.framing.frame_anchor_world.y + (Number.isFinite(delta.y) ? Number(delta.y) : 0),
        z: state.framing.frame_anchor_world.z + (Number.isFinite(delta.z) ? Number(delta.z) : 0),
      };
    },
    setFocusPlane(plane) {
      if (!Number.isFinite(plane)) return;
      state.framing.focus_plane = Math.floor(plane);
    },
    stepFocusPlane(dir) {
      if (!Number.isFinite(dir) || dir === 0) return;
      state.framing.focus_plane = Math.floor(state.framing.focus_plane + Math.sign(dir));
    },
    setOrientation(orientation) {
      state.framing.orientation = orientation;
    },
    setViewport(viewport) {
      state.framing.viewport = {
        width: Math.max(0, Math.floor(viewport.width)),
        height: Math.max(0, Math.floor(viewport.height)),
      };
    },
    setTransitionState(transition_state) {
      state.presentation.transition_state = transition_state;
    },
    notifyManualPan() {
      if (should_detach_camera_follow_for_manual_pan(state.semantic.follow_policy)) state.semantic.follow_active = false;
    },
    notifyManualDepthChange() {
      if (should_detach_camera_follow_for_manual_depth(state.semantic.follow_policy)) state.semantic.follow_active = false;
    },
    notifyManualCameraInput() {
      if (should_detach_camera_follow_for_manual_input(state.semantic.follow_policy)) state.semantic.follow_active = false;
    },
    tick(now_ms = Date.now()) {
      if (!state.semantic.follow_active) {
        last_tick_ms = now_ms;
        resolve_current_subject();
        return false;
      }
      const resolved = resolve_current_subject();
      if (!resolved) {
        last_tick_ms = now_ms;
        return false;
      }
      if (Number.isFinite(resolved.preferred_focus_plane)) {
        state.framing.focus_plane = Math.floor(resolved.preferred_focus_plane as number);
      }
      const changed = move_anchor_to_target(resolved.world, now_ms);
      if (is_camera_snap_once_policy(state.semantic.follow_policy)) {
        state.semantic.follow_active = false;
      }
      return changed;
    },
    getState() {
      return {
        semantic: {
          subject: state.semantic.subject,
          follow_policy: state.semantic.follow_policy,
          follow_active: state.semantic.follow_active,
          last_resolved_subject_world: state.semantic.last_resolved_subject_world ? { ...state.semantic.last_resolved_subject_world } : null,
        },
        framing: {
          frame_anchor_world: { ...state.framing.frame_anchor_world },
          focus_plane: state.framing.focus_plane,
          orientation: state.framing.orientation,
          viewport: { ...state.framing.viewport },
        },
        presentation: {
          motion_style: state.presentation.motion_style,
          transition_state: state.presentation.transition_state,
        },
      };
    },
    getProjectionView() {
      return {
        subject: state.semantic.subject,
        follow_policy: state.semantic.follow_policy,
        follow_active: state.semantic.follow_active,
        frame_anchor_world: { ...state.framing.frame_anchor_world },
        focus_target_world: state.semantic.last_resolved_subject_world ? { ...state.semantic.last_resolved_subject_world } : null,
        focus_plane: state.framing.focus_plane,
        orientation: state.framing.orientation,
        viewport: { ...state.framing.viewport },
        motion_style: state.presentation.motion_style,
        transition_state: state.presentation.transition_state,
        last_resolved_subject_world: state.semantic.last_resolved_subject_world ? { ...state.semantic.last_resolved_subject_world } : null,
      };
    },
  };
}

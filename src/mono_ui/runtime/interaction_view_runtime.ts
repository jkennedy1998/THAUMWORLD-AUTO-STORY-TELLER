import type { Rect } from '../types.js';

export type InteractionSpaceKind = '2d' | '3d' | 'hybrid';

export type ViewInteractionCapabilities = {
  resolves_2d_targets?: boolean;
  resolves_3d_targets?: boolean;
  accepts_drag_payloads?: boolean;
  produces_drag_payloads?: boolean;
  supports_text_input?: boolean;
  supports_wheel_depth?: boolean;
  owns_view_instances?: boolean;
};

export type CameraProjectionMode = 'orthographic' | 'rotated_ortho' | 'perspective' | 'custom';

export type ViewCameraState = {
  frame_anchor?: { x: number; y: number; z: number } | null;
  focus_target?: { x: number; y: number; z: number } | null;
  focus_plane?: number | null;
  orientation?: string | null;
  projection_mode?: CameraProjectionMode;
  transition_state?: Record<string, unknown> | null;
  parallax_settings?: Record<string, unknown> | null;
  soft_rotation_settings?: Record<string, unknown> | null;
};

export type ViewInstance = {
  module_id: string;
  view_id: string;
  space_kind: InteractionSpaceKind;
  viewport_rect: Rect;
  z_index?: number;
  hit_test_priority?: number;
  capabilities?: ViewInteractionCapabilities;
  camera_state?: ViewCameraState;
  projection_state?: Record<string, unknown> | null;
  content_ref?: string | null;
  metadata?: Record<string, unknown>;
};

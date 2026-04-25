import type { ViewInstance, ViewCameraState, ViewInteractionCapabilities, InteractionSpaceKind } from './interaction_view_runtime.js';
import type { Rect } from '../types.js';

export function build_view_instance(args: {
  module_id: string;
  view_id: string;
  space_kind: InteractionSpaceKind;
  viewport_rect: Rect;
  capabilities?: ViewInteractionCapabilities;
  camera_state?: ViewCameraState;
  projection_state?: Record<string, unknown> | null;
  content_ref?: string | null;
  metadata?: Record<string, unknown>;
  z_index?: number;
  hit_test_priority?: number;
}): ViewInstance {
  return {
    module_id: args.module_id,
    view_id: args.view_id,
    space_kind: args.space_kind,
    viewport_rect: { ...args.viewport_rect },
    capabilities: args.capabilities,
    camera_state: args.camera_state,
    projection_state: args.projection_state,
    content_ref: args.content_ref,
    metadata: args.metadata,
    z_index: args.z_index,
    hit_test_priority: args.hit_test_priority,
  };
}

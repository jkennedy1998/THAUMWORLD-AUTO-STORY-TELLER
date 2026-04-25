import type { DragPayload } from './interaction_payload_runtime.js';
import type { OrderedResolvedTargets, ResolvedTarget } from './interaction_target_runtime.js';

export type InteractionInputPhase = 'hover' | 'down' | 'drag' | 'up' | 'wheel' | 'key' | 'cancel';

export type InteractionStatus = 'hovering' | 'active' | 'ended' | 'canceled';

export type InteractionKind = 'hover' | 'drag' | 'click' | 'draw' | 'text' | 'custom';

export type WheelRoutingPolicy = 'module_defined' | 'depth_only' | 'blocked';

export type InteractionPointerState = {
  x: number;
  y: number;
  button?: number;
  buttons?: number;
  pointer_id?: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  timestamp_ms?: number;
};

export type InteractionCaptureOwner = {
  module_id: string;
  view_id: string;
};

export type InteractionHoverState = {
  pointer: InteractionPointerState;
  resolved_targets: OrderedResolvedTargets;
};

export type InteractionSession = {
  session_id: string;
  interaction_kind: InteractionKind;
  status: InteractionStatus;
  source_module_id: string;
  source_view_id: string;
  capture_owner: InteractionCaptureOwner;
  pointer_id?: number;
  wheel_policy?: WheelRoutingPolicy;
  started_at_ms?: number;
  updated_at_ms?: number;
  ended_at_ms?: number;
  pointer_start: InteractionPointerState;
  pointer_current: InteractionPointerState;
  pointer_end?: InteractionPointerState | null;
  resolved_start_target: ResolvedTarget | null;
  resolved_current_target: ResolvedTarget | null;
  resolved_end_target?: ResolvedTarget | null;
  resolved_start_targets: readonly ResolvedTarget[];
  resolved_current_targets: readonly ResolvedTarget[];
  resolved_end_targets?: readonly ResolvedTarget[];
  drag_payload?: DragPayload | null;
  metadata?: Record<string, unknown>;
  cancel_reason?: string | null;
};

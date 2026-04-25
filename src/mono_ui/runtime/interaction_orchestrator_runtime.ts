import type { DragPayload } from './interaction_payload_runtime.js';
import type {
  InteractionCaptureOwner,
  InteractionHoverState,
  InteractionKind,
  InteractionPointerState,
  InteractionSession,
  InteractionStatus,
  WheelRoutingPolicy,
} from './interaction_session_runtime.js';
import type { OrderedResolvedTargets } from './interaction_target_runtime.js';

function clone_pointer_state(pointer: InteractionPointerState): InteractionPointerState {
  return { ...pointer };
}

export function build_interaction_pointer_state(args: {
  x: number;
  y: number;
  pointer_id?: number;
  button?: number;
  buttons?: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  timestamp_ms?: number;
}): InteractionPointerState {
  return {
    x: args.x,
    y: args.y,
    pointer_id: args.pointer_id,
    button: args.button,
    buttons: args.buttons,
    shift: args.shift,
    ctrl: args.ctrl,
    alt: args.alt,
    meta: args.meta,
    timestamp_ms: args.timestamp_ms ?? Date.now(),
  };
}

function clone_ordered_targets(targets: OrderedResolvedTargets): OrderedResolvedTargets {
  return {
    primary: targets.primary ?? null,
    ordered: [...targets.ordered],
  };
}

export function create_hover_state(pointer: InteractionPointerState, resolved_targets: OrderedResolvedTargets): InteractionHoverState {
  return {
    pointer: clone_pointer_state(pointer),
    resolved_targets: clone_ordered_targets(resolved_targets),
  };
}

export function begin_interaction_session(args: {
  session_id: string;
  interaction_kind: InteractionKind;
  source_module_id: string;
  source_view_id: string;
  capture_owner?: InteractionCaptureOwner;
  pointer: InteractionPointerState;
  resolved_targets: OrderedResolvedTargets;
  drag_payload?: DragPayload | null;
  metadata?: Record<string, unknown>;
  wheel_policy?: WheelRoutingPolicy;
  started_at_ms?: number;
}): InteractionSession {
  const startedAt = args.started_at_ms ?? Date.now();
  const captureOwner = args.capture_owner ?? {
    module_id: args.source_module_id,
    view_id: args.source_view_id,
  };
  const resolved = clone_ordered_targets(args.resolved_targets);
  return {
    session_id: args.session_id,
    interaction_kind: args.interaction_kind,
    status: 'active',
    source_module_id: args.source_module_id,
    source_view_id: args.source_view_id,
    capture_owner: captureOwner,
    pointer_id: args.pointer.pointer_id,
    wheel_policy: args.wheel_policy ?? 'module_defined',
    started_at_ms: startedAt,
    updated_at_ms: startedAt,
    pointer_start: clone_pointer_state(args.pointer),
    pointer_current: clone_pointer_state(args.pointer),
    pointer_end: null,
    resolved_start_target: resolved.primary,
    resolved_current_target: resolved.primary,
    resolved_end_target: null,
    resolved_start_targets: [...resolved.ordered],
    resolved_current_targets: [...resolved.ordered],
    resolved_end_targets: [],
    drag_payload: args.drag_payload ?? null,
    metadata: args.metadata ? { ...args.metadata } : undefined,
    cancel_reason: null,
  };
}

export function update_interaction_session(session: InteractionSession, args: {
  pointer: InteractionPointerState;
  resolved_targets: OrderedResolvedTargets;
  updated_at_ms?: number;
  status?: Extract<InteractionStatus, 'active' | 'hovering'>;
}): InteractionSession {
  const resolved = clone_ordered_targets(args.resolved_targets);
  return {
    ...session,
    status: args.status ?? session.status,
    updated_at_ms: args.updated_at_ms ?? Date.now(),
    pointer_current: clone_pointer_state(args.pointer),
    resolved_current_target: resolved.primary,
    resolved_current_targets: [...resolved.ordered],
  };
}

export function end_interaction_session(session: InteractionSession, args: {
  pointer: InteractionPointerState;
  resolved_targets: OrderedResolvedTargets;
  ended_at_ms?: number;
}): InteractionSession {
  const resolved = clone_ordered_targets(args.resolved_targets);
  return {
    ...session,
    status: 'ended',
    updated_at_ms: args.ended_at_ms ?? Date.now(),
    ended_at_ms: args.ended_at_ms ?? Date.now(),
    pointer_current: clone_pointer_state(args.pointer),
    pointer_end: clone_pointer_state(args.pointer),
    resolved_current_target: resolved.primary,
    resolved_end_target: resolved.primary,
    resolved_current_targets: [...resolved.ordered],
    resolved_end_targets: [...resolved.ordered],
  };
}

export function cancel_interaction_session(session: InteractionSession, args?: {
  pointer?: InteractionPointerState | null;
  resolved_targets?: OrderedResolvedTargets | null;
  ended_at_ms?: number;
  reason?: string | null;
}): InteractionSession {
  const endedAt = args?.ended_at_ms ?? Date.now();
  const resolved = args?.resolved_targets ? clone_ordered_targets(args.resolved_targets) : null;
  return {
    ...session,
    status: 'canceled',
    updated_at_ms: endedAt,
    ended_at_ms: endedAt,
    pointer_current: args?.pointer ? clone_pointer_state(args.pointer) : session.pointer_current,
    pointer_end: args?.pointer ? clone_pointer_state(args.pointer) : session.pointer_end,
    resolved_current_target: resolved?.primary ?? session.resolved_current_target,
    resolved_end_target: resolved?.primary ?? session.resolved_end_target,
    resolved_current_targets: resolved ? [...resolved.ordered] : session.resolved_current_targets,
    resolved_end_targets: resolved ? [...resolved.ordered] : session.resolved_end_targets,
    cancel_reason: args?.reason ?? session.cancel_reason ?? 'canceled',
  };
}

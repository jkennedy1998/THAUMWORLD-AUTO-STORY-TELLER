import type { InteractionHoverResolution, InteractionSessionResolution } from './interaction_registry_runtime.js';
import type { ResolvedTarget, ResolvedTargetType } from './interaction_target_runtime.js';

export function select_current_resolved_target(args: {
  session_state?: InteractionSessionResolution | null;
  hover_state?: InteractionHoverResolution | null;
}): ResolvedTarget | null {
  return args.session_state?.session.resolved_end_target
    ?? args.session_state?.session.resolved_current_target
    ?? args.hover_state?.resolved_targets.primary
    ?? null;
}

export function select_current_resolved_target_of_type<T extends ResolvedTargetType>(args: {
  session_state?: InteractionSessionResolution | null;
  hover_state?: InteractionHoverResolution | null;
  target_type: T;
  module_id?: string;
}): Extract<ResolvedTarget, { target_type: T }> | null {
  const target = select_current_resolved_target(args);
  if (!target || target.target_type !== args.target_type) return null;
  if (args.module_id && target.module_id !== args.module_id) return null;
  return target as Extract<ResolvedTarget, { target_type: T }>;
}

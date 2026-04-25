import type { OrderedResolvedTargets, ResolvedTarget } from './interaction_target_runtime.js';

function get_target_priority(target: ResolvedTarget): number {
  const explicit = Number.isFinite(target.priority) ? Number(target.priority) : Number.POSITIVE_INFINITY;
  return explicit;
}

function compare_resolved_targets(a: ResolvedTarget, b: ResolvedTarget): number {
  const priorityDiff = get_target_priority(a) - get_target_priority(b);
  if (priorityDiff !== 0) return priorityDiff;
  if (a.target_type !== b.target_type) return a.target_type.localeCompare(b.target_type);
  if (a.target_ref !== b.target_ref) return a.target_ref.localeCompare(b.target_ref);
  if (a.view_id !== b.view_id) return a.view_id.localeCompare(b.view_id);
  return a.module_id.localeCompare(b.module_id);
}

export function order_resolved_targets(targets: readonly ResolvedTarget[]): OrderedResolvedTargets {
  const ordered = [...targets].sort(compare_resolved_targets);
  return {
    primary: ordered[0] ?? null,
    ordered,
  };
}

export function append_resolved_targets(base: OrderedResolvedTargets, additions: readonly ResolvedTarget[]): OrderedResolvedTargets {
  return order_resolved_targets([...base.ordered, ...additions]);
}

export function same_resolved_target(a: ResolvedTarget | null | undefined, b: ResolvedTarget | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.module_id === b.module_id
    && a.view_id === b.view_id
    && a.target_type === b.target_type
    && a.target_ref === b.target_ref;
}

import { resolve_inline_item } from "./resolve.js";
import { build_tag_delta_from_base_and_desired } from "../tag_system/effective_tags.js";
import { merge_stackable_item_tags } from "../tag_system/item_stack.js";

export type ItemStackCheckResult = {
  ok: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
};

function get_item_qty(item: any): number {
  const qty = Number(item?.qty ?? 1);
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
}

function get_resolved_item(item: any) {
  const def_id = String(item?.def_id ?? "").trim();
  if (!def_id) return null;
  return resolve_inline_item(def_id, item);
}

export function evaluate_item_stack_policy(item_a: any, def_a: any, item_b: any, def_b: any): ItemStackCheckResult {
  if (!item_a || !item_b || !def_a || !def_b) return { ok: false, reason: "missing_item_or_definition" };
  if (String(item_a.def_id ?? "") !== String(item_b.def_id ?? "")) return { ok: false, reason: "different_def_id" };
  if (String(def_a.id ?? "") !== String(def_b.id ?? "")) return { ok: false, reason: "different_definition" };
  if (!def_a.stackable || !def_b.stackable) return { ok: false, reason: "not_stackable" };
  if (Array.isArray(item_a.contents) && item_a.contents.length > 0) return { ok: false, reason: "target_has_contents" };
  if (Array.isArray(item_b.contents) && item_b.contents.length > 0) return { ok: false, reason: "source_has_contents" };

  const max_stack = Number(def_a.max_stack_size ?? 1);
  const combined_qty = get_item_qty(item_a) + get_item_qty(item_b);
  if (!Number.isFinite(max_stack) || combined_qty > Math.max(1, Math.floor(max_stack))) {
    return { ok: false, reason: "max_stack_exceeded", detail: { max_stack: Math.max(1, Math.floor(max_stack) || 1), combined_qty } };
  }

  const resolved_a = get_resolved_item(item_a);
  const resolved_b = get_resolved_item(item_b);
  if (!resolved_a || !resolved_b) return { ok: false, reason: "resolve_failed" };

  const merged = merge_stackable_item_tags({
    target_item: item_a,
    source_item: item_b,
    target_effective_tags: resolved_a.effective_tags ?? [],
    source_effective_tags: resolved_b.effective_tags ?? [],
    target_resolved_states: resolved_a.resolved_tag_states ?? [],
    source_resolved_states: resolved_b.resolved_tag_states ?? [],
    target_qty: get_item_qty(item_a),
    moved_qty: get_item_qty(item_b),
  });
  if (!merged.ok) {
    return {
      ok: false,
      reason: "tag_stack_blocked",
      detail: {
        stack_reason: merged.reason ?? "unknown",
        target_def_id: String(item_a?.def_id ?? ""),
        source_def_id: String(item_b?.def_id ?? ""),
        ...(merged.detail ?? {}),
      },
    };
  }
  return { ok: true };
}

export function can_stack_items_with_spoil_policy(item_a: any, def_a: any, item_b: any, def_b: any): boolean {
  return evaluate_item_stack_policy(item_a, def_a, item_b, def_b).ok;
}

export function merge_item_stack_into_target(target: any, source: any, moved_qty?: number): number {
  const target_qty = get_item_qty(target);
  const source_qty = get_item_qty(source);
  const qty_to_move_raw = typeof moved_qty === "number" && Number.isFinite(moved_qty) ? Math.floor(moved_qty) : source_qty;
  const qty_to_move = Math.max(0, Math.min(source_qty, qty_to_move_raw));
  if (qty_to_move <= 0) return 0;

  const target_resolved = get_resolved_item(target);
  const source_resolved = get_resolved_item(source);
  if (!target_resolved || !source_resolved) return 0;

  const merged = merge_stackable_item_tags({
    target_item: target,
    source_item: source,
    target_effective_tags: target_resolved.effective_tags ?? [],
    source_effective_tags: source_resolved.effective_tags ?? [],
    target_resolved_states: target_resolved.resolved_tag_states ?? [],
    source_resolved_states: source_resolved.resolved_tag_states ?? [],
    target_qty,
    moved_qty: qty_to_move,
  });
  if (!merged.ok || !merged.desired_effective_tags) return 0;

  const total_qty = target_qty + qty_to_move;
  const delta = build_tag_delta_from_base_and_desired(target_resolved.def.tags ?? [], merged.desired_effective_tags);
  target.tag_add = delta.tag_add;
  target.tag_remove = delta.tag_remove;
  target.qty = total_qty;
  source.qty = source_qty - qty_to_move;

  if (merged.item_last_breath_processed !== undefined) {
    if (merged.item_last_breath_processed === null) delete target.last_breath_processed;
    else target.last_breath_processed = merged.item_last_breath_processed;
  }

  if (Array.isArray(merged.tag_lifecycle_updates) && merged.tag_lifecycle_updates.length > 0) {
    const next_runtime = { ...(target.tag_lifecycle && typeof target.tag_lifecycle === "object" ? target.tag_lifecycle : {}) } as Record<string, { last_processed_breath?: number }>;
    for (const update of merged.tag_lifecycle_updates) {
      for (const old_key of update.old_keys) delete next_runtime[old_key];
      if (update.new_key && update.last_processed_breath !== null) {
        next_runtime[update.new_key] = { last_processed_breath: update.last_processed_breath };
      }
    }
    target.tag_lifecycle = next_runtime;
  }

  return qty_to_move;
}

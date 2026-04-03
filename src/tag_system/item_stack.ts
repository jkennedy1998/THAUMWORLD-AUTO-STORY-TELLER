import type { NormalizedTagItemStack, TagItemStackMergeQuantity, TagItemStackMatchMode, TagItemStackPresence } from "./definitions.js";
import { get_tag_definition, get_tag_item_stack } from "./definitions.js";
import { clone_tag_instance, normalize_tag_instances } from "./effective_tags.js";
import type { TagInstance } from "./registry.js";
import type { ResolvedTagState } from "./resolved.js";
import { tag_key } from "./tag_key.js";

type TagSide = {
  tag: TagInstance;
  state: ResolvedTagState;
};

export type ItemTagStackMergeResult = {
  ok: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
  desired_effective_tags?: TagInstance[];
  item_last_breath_processed?: number | null;
  tag_lifecycle_updates?: Array<{ old_keys: string[]; new_key: string | null; last_processed_breath: number | null }>;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stable(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalize_int(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function get_tag_qty(tag: TagInstance): number {
  return Math.max(1, normalize_int(tag?.mag, 1));
}

function get_state_dim_signature(state: ResolvedTagState, mode: TagItemStackMatchMode): string {
  if (mode === "ignore") return "";
  const def = get_tag_definition(state.name);
  const quantity_dimension_id = def?.quantity_dimension_id ?? null;
  const entries = Object.entries(state.dim_mag ?? {})
    .filter(([dim_id]) => mode !== "exact_except_quantity" || dim_id !== quantity_dimension_id)
    .sort(([a], [b]) => a.localeCompare(b));
  return stable(entries);
}

function get_state_info_signature(state: ResolvedTagState, mode: TagItemStackMatchMode): string {
  if (mode === "ignore") return "";
  return stable(state.info ?? null);
}

function get_matching_signature(state: ResolvedTagState, policy: NormalizedTagItemStack): string {
  return `${get_state_dim_signature(state, policy.dimensions_match)}|${get_state_info_signature(state, policy.info_match)}`;
}

function build_state_maps(tags: TagInstance[], states: ResolvedTagState[]): Map<string, TagSide[]> {
  const by_name = new Map<string, TagSide[]>();
  const state_by_key = new Map<string, ResolvedTagState>();
  for (const state of Array.isArray(states) ? states : []) state_by_key.set(String(state.key ?? ""), state);
  for (const tag of normalize_tag_instances(tags)) {
    const key = tag_key(tag);
    const state = key ? state_by_key.get(key) ?? null : null;
    const name = String(tag?.name ?? "").trim().toUpperCase();
    if (!name || !state) continue;
    const list = by_name.get(name) ?? [];
    list.push({ tag, state });
    by_name.set(name, list);
  }
  return by_name;
}

function copy_non_name_tags(target_tags: TagInstance[], blocked_name: string): TagInstance[] {
  return target_tags
    .filter((tag) => String(tag?.name ?? "").trim().toUpperCase() !== blocked_name)
    .map((tag) => clone_tag_instance(tag));
}

function merge_quantity(tag: TagInstance, source_tag: TagInstance, quantity_dimension_id: string | null, merge_mode: TagItemStackMergeQuantity): TagInstance {
  const next = clone_tag_instance(tag);
  if (merge_mode === "preserve") return next;
  const left_mag = get_tag_qty(tag);
  const right_mag = get_tag_qty(source_tag);
  const merged_mag = merge_mode === "sum"
    ? left_mag + right_mag
    : merge_mode === "min"
      ? Math.min(left_mag, right_mag)
      : Math.max(left_mag, right_mag);
  next.mag = merged_mag;
  if (quantity_dimension_id) {
    const left_dim = normalize_int(next.dim_mag?.[quantity_dimension_id], left_mag);
    const right_dim = normalize_int(source_tag.dim_mag?.[quantity_dimension_id], right_mag);
    const merged_dim = merge_mode === "sum"
      ? left_dim + right_dim
      : merge_mode === "min"
        ? Math.min(left_dim, right_dim)
        : Math.max(left_dim, right_dim);
    next.dim_mag = { ...(next.dim_mag ?? {}), [quantity_dimension_id]: merged_dim };
  }
  return next;
}

function pick_pair(left: TagSide[], right: TagSide[], policy: NormalizedTagItemStack): { left: TagSide | null; right: TagSide | null; ok: boolean } {
  if (left.length === 0 && right.length === 0) return { left: null, right: null, ok: true };
  if (policy.presence === "exact_match") {
    if (left.length !== right.length) return { left: null, right: null, ok: false };
    if (left.length === 0) return { left: null, right: null, ok: true };
  }
  if (policy.presence === "both_required" && (left.length === 0 || right.length === 0)) return { left: null, right: null, ok: false };
  if (left.length > 1 || right.length > 1) return { left: null, right: null, ok: false };
  return { left: left[0] ?? null, right: right[0] ?? null, ok: true };
}

function merge_ticker_value(kind: NormalizedTagItemStack["ticker"]["kind"], target_value: number | null, source_value: number | null, target_qty: number, moved_qty: number): number | null {
  if (kind === "none") return null;
  if (kind === "inherit_present_side") return target_value ?? source_value;
  if (kind === "minimum") {
    if (target_value === null) return source_value;
    if (source_value === null) return target_value;
    return Math.min(target_value, source_value);
  }
  if (kind === "average") {
    if (target_value === null) return source_value;
    if (source_value === null) return target_value;
    const total = Math.max(1, target_qty + moved_qty);
    return Math.floor(((target_qty * target_value) + (moved_qty * source_value)) / total);
  }
  return null;
}

function get_tag_lifecycle_breath(item: any, tag_key: string): number | null {
  const raw = Number(item?.tag_lifecycle?.[tag_key]?.last_processed_breath);
  return Number.isFinite(raw) ? Math.floor(raw) : null;
}

function build_tag_merge(opts: {
  name: string;
  target_pair: TagSide | null;
  source_pair: TagSide | null;
  policy: NormalizedTagItemStack;
  target_item: any;
  source_item: any;
  target_qty: number;
  moved_qty: number;
}): { ok: boolean; merged_tag: TagInstance | null; item_last_breath_processed?: number | null; tag_lifecycle_update?: { old_keys: string[]; new_key: string | null; last_processed_breath: number | null } } {
  const { target_pair, source_pair, policy, target_item, source_item, target_qty, moved_qty } = opts;
  if (policy.presence === "exact_match") {
    if ((target_pair === null) !== (source_pair === null)) return { ok: false, merged_tag: null };
  }
  if (policy.presence === "both_required" && (!target_pair || !source_pair)) return { ok: false, merged_tag: null };
  if (policy.presence === "either_allowed" && !target_pair && !source_pair) return { ok: true, merged_tag: null };

  const active = target_pair ?? source_pair;
  if (!active) return { ok: true, merged_tag: null };

  if (target_pair && source_pair) {
    const left_sig = get_matching_signature(target_pair.state, policy);
    const right_sig = get_matching_signature(source_pair.state, policy);
    if (left_sig !== right_sig) return { ok: false, merged_tag: null };
  }

  const definition = get_tag_definition(active.state.name);
  const quantity_dimension_id = definition?.quantity_dimension_id ?? null;
  const merged_tag = target_pair && source_pair
    ? merge_quantity(target_pair.tag, source_pair.tag, quantity_dimension_id, policy.merge_quantity)
    : clone_tag_instance((target_pair ?? source_pair)!.tag);

  const old_keys = [target_pair?.state.key, source_pair?.state.key].filter((value): value is string => !!value);
  if (policy.ticker.source === "item_last_breath_processed") {
    const target_value = Number.isFinite(Number(target_item?.last_breath_processed)) ? Math.floor(Number(target_item.last_breath_processed)) : null;
    const source_value = Number.isFinite(Number(source_item?.last_breath_processed)) ? Math.floor(Number(source_item.last_breath_processed)) : null;
    return {
      ok: true,
      merged_tag,
      item_last_breath_processed: merge_ticker_value(policy.ticker.kind, target_value, source_value, target_qty, moved_qty),
    };
  }

  const target_lifecycle = target_pair ? get_tag_lifecycle_breath(target_item, target_pair.state.key) : null;
  const source_lifecycle = source_pair ? get_tag_lifecycle_breath(source_item, source_pair.state.key) : null;
  return {
    ok: true,
    merged_tag,
    tag_lifecycle_update: {
      old_keys,
      new_key: merged_tag ? tag_key(merged_tag) : null,
      last_processed_breath: merge_ticker_value(policy.ticker.kind, target_lifecycle, source_lifecycle, target_qty, moved_qty),
    },
  };
}

function build_pairing_failure_detail(name: string, left: TagSide[], right: TagSide[], policy: NormalizedTagItemStack): Record<string, unknown> {
  return {
    tag_name: name,
    tag_presence: policy.presence,
    target_tag_count: left.length,
    source_tag_count: right.length,
    target_has_tag: left.length > 0,
    source_has_tag: right.length > 0,
  };
}

function build_illegal_failure_detail(name: string, target_pair: TagSide | null, source_pair: TagSide | null, policy: NormalizedTagItemStack): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    tag_name: name,
    tag_presence: policy.presence,
    dimensions_match: policy.dimensions_match,
    info_match: policy.info_match,
    target_has_tag: !!target_pair,
    source_has_tag: !!source_pair,
  };
  if (target_pair && source_pair) {
    const target_dim_signature = get_state_dim_signature(target_pair.state, policy.dimensions_match);
    const source_dim_signature = get_state_dim_signature(source_pair.state, policy.dimensions_match);
    const target_info_signature = get_state_info_signature(target_pair.state, policy.info_match);
    const source_info_signature = get_state_info_signature(source_pair.state, policy.info_match);
    if (target_dim_signature !== source_dim_signature) detail.mismatch = "dimensions";
    else if (target_info_signature !== source_info_signature) detail.mismatch = "info";
    else detail.mismatch = "unknown";
  }
  return detail;
}

export function merge_stackable_item_tags(opts: {
  target_item: any;
  source_item: any;
  target_effective_tags: TagInstance[];
  source_effective_tags: TagInstance[];
  target_resolved_states: ResolvedTagState[];
  source_resolved_states: ResolvedTagState[];
  target_qty: number;
  moved_qty: number;
}): ItemTagStackMergeResult {
  const target_by_name = build_state_maps(opts.target_effective_tags, opts.target_resolved_states);
  const source_by_name = build_state_maps(opts.source_effective_tags, opts.source_resolved_states);
  const all_names = new Set<string>([...target_by_name.keys(), ...source_by_name.keys()]);
  let desired = normalize_tag_instances(opts.target_effective_tags);
  let item_last_breath_processed: number | null | undefined = undefined;
  const tag_lifecycle_updates: Array<{ old_keys: string[]; new_key: string | null; last_processed_breath: number | null }> = [];

  for (const name of all_names) {
    const policy = get_tag_item_stack(name);
    const pair = pick_pair(target_by_name.get(name) ?? [], source_by_name.get(name) ?? [], policy);
    if (!pair.ok) {
      return {
        ok: false,
        reason: `tag_stack_pairing_failed:${name}`,
        detail: build_pairing_failure_detail(name, target_by_name.get(name) ?? [], source_by_name.get(name) ?? [], policy),
      };
    }

    const merged = build_tag_merge({
      name,
      target_pair: pair.left,
      source_pair: pair.right,
      policy,
      target_item: opts.target_item,
      source_item: opts.source_item,
      target_qty: opts.target_qty,
      moved_qty: opts.moved_qty,
    });
    if (!merged.ok) {
      return {
        ok: false,
        reason: `tag_stack_illegal:${name}`,
        detail: build_illegal_failure_detail(name, pair.left, pair.right, policy),
      };
    }

    desired = copy_non_name_tags(desired, name);
    if (merged.merged_tag) desired.push(merged.merged_tag);

    if (merged.item_last_breath_processed !== undefined) item_last_breath_processed = merged.item_last_breath_processed;
    if (merged.tag_lifecycle_update) tag_lifecycle_updates.push(merged.tag_lifecycle_update);
  }

  return {
    ok: true,
    desired_effective_tags: desired,
    item_last_breath_processed,
    tag_lifecycle_updates,
  };
}

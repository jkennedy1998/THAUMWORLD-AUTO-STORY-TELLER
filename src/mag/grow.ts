import type { TagInstance } from "../tag_system/registry.js";
import type { ResolvedTagState } from "../tag_system/resolved.js";
import { get_tag_dim_mag, resolve_tag_state_from_instance } from "../tag_system/resolved.js";
import { normalize_nonnegative_mag, normalize_signed_mag } from "./core.js";

export const GROW_DEFAULT_PERIOD_BREATHS = 300;
export const GROW_MAX_EVENTS_PER_PULSE = 200;
export const GROW_DEFAULT_MAX_SLOTS = 12;
export const GROW_DEFAULT_YIELD_QTY = 1;

export type GrowTagConfig = {
  tag_key: string;
  contributor_name: string;
  item_def_ids: string[];
  period_breaths: number;
  max_grow_slots: number;
  yield_qty: number;
  yield_chance_denominator: number;
};

function normalize_item_def_ids(info: unknown): string[] {
  const entries = Array.isArray(info) ? info : [info];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry === "string") {
      const id = String(entry ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const any_entry = entry as Record<string, unknown>;
    const raw_ids = [
      ...(Array.isArray(any_entry.item_def_ids) ? any_entry.item_def_ids : []),
      ...(Array.isArray(any_entry.def_ids) ? any_entry.def_ids : []),
      ...(typeof any_entry.item_def_id === "string" ? [any_entry.item_def_id] : []),
      ...(typeof any_entry.def_id === "string" ? [any_entry.def_id] : []),
    ];
    for (const raw_id of raw_ids) {
      const id = String(raw_id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function project_grow_period_breaths(speed_mag: number): number {
  const speed = normalize_nonnegative_mag(speed_mag, 0);
  if (speed <= 0) return GROW_DEFAULT_PERIOD_BREATHS;
  return Math.max(1, Math.floor(GROW_DEFAULT_PERIOD_BREATHS / (speed + 1)));
}

export function project_grow_max_slots(capacity_mag: number): number {
  const capacity = normalize_nonnegative_mag(capacity_mag, 0);
  return Math.max(1, capacity);
}

export function project_grow_yield(yield_mag: number): { yield_qty: number; yield_chance_denominator: number } {
  const yield_value = normalize_signed_mag(yield_mag, 0);
  if (yield_value >= 1) {
    return { yield_qty: yield_value, yield_chance_denominator: 1 };
  }
  return { yield_qty: 1, yield_chance_denominator: Math.max(1, 2 ** Math.abs(yield_value)) };
}

export function build_grow_tag_config(tag_state: ResolvedTagState): GrowTagConfig | null {
  if (String(tag_state?.name ?? "").toUpperCase() !== "GROW") return null;
  const item_def_ids = normalize_item_def_ids(tag_state.info);
  if (item_def_ids.length <= 0) return null;
  const contributor_name = tag_state.definition?.contributes_surfaces?.[0]?.contributor_name ?? "GROW";
  const speed_mag = get_tag_dim_mag(tag_state, "grow_speed_mag");
  const capacity_mag = get_tag_dim_mag(tag_state, "grow_capacity_mag");
  const yield_mag = get_tag_dim_mag(tag_state, "grow_yield_mag");
  const projected_yield = project_grow_yield(yield_mag);
  return {
    tag_key: tag_state.key,
    contributor_name,
    item_def_ids,
    period_breaths: project_grow_period_breaths(speed_mag),
    max_grow_slots: project_grow_max_slots(capacity_mag),
    yield_qty: projected_yield.yield_qty,
    yield_chance_denominator: projected_yield.yield_chance_denominator,
  };
}

export function resolve_grow_tag_config_from_instance(tag: TagInstance): GrowTagConfig | null {
  return build_grow_tag_config(resolve_tag_state_from_instance(tag));
}

export function resolve_grow_tag_configs(tag_states: ResolvedTagState[]): GrowTagConfig[] {
  const out: GrowTagConfig[] = [];
  for (const tag_state of Array.isArray(tag_states) ? tag_states : []) {
    const config = build_grow_tag_config(tag_state);
    if (config) out.push(config);
  }
  return out;
}

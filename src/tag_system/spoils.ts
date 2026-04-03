import type { TagInstance } from "./registry.js";
import { project_spoil_period_breaths } from "../mag/lifecycle.js";
import {
  get_tag_dim_mag,
  resolve_tag_state_from_instance,
  resolve_tag_states_from_instances,
  type ResolvedTagState,
} from "./resolved.js";

export type SpoilsTagConfig = {
  period_breaths: number;
  result_item_def_id: string | null;
};

function normalize_result_item_def_id(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : null;
}

export function build_spoils_tag_config(tag_state: ResolvedTagState): SpoilsTagConfig | null {
  if (String(tag_state?.name ?? "").toUpperCase() !== "SPOILS") return null;
  const entry = Array.isArray(tag_state.info) ? tag_state.info[0] : tag_state.info;
  const any_entry = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
  const spoil_time_mag = get_tag_dim_mag(tag_state, "spoil_time_mag");
  const period_breaths = project_spoil_period_breaths(spoil_time_mag);
  if (period_breaths <= 0) return null;
  return {
    period_breaths,
    result_item_def_id: normalize_result_item_def_id(any_entry.result_item_def_id ?? any_entry.result_def_id ?? any_entry.def_id),
  };
}

export function resolve_spoils_tag_config_from_instance(tag: TagInstance): SpoilsTagConfig | null {
  return build_spoils_tag_config(resolve_tag_state_from_instance(tag));
}

export function resolve_spoils_tag_config_from_states(tag_states: ResolvedTagState[]): SpoilsTagConfig | null {
  for (const tag_state of Array.isArray(tag_states) ? tag_states : []) {
    const config = build_spoils_tag_config(tag_state);
    if (config) return config;
  }
  return null;
}

export function resolve_spoils_tag_config_from_tags(tags: TagInstance[]): SpoilsTagConfig | null {
  return resolve_spoils_tag_config_from_states(resolve_tag_states_from_instances(tags));
}

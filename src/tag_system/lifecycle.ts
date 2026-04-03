import {
  DISPERSE_MAX_EVENTS_PER_PULSE,
  project_disperse_period_breaths,
} from "../mag/lifecycle.js";
import type { NormalizedTagDispersal } from "./definitions.js";
import { get_tag_dim_mag, type ResolvedTagState } from "./resolved.js";
import type { TagInstance } from "./registry.js";

export type ResolvedTagDispersal = {
  config: NormalizedTagDispersal;
  period_breaths: number;
  current_value: number;
};

export type TagDispersalStepResult = {
  next_tag: TagInstance | null;
  old_value: number;
  new_value: number;
  advanced_breaths: number;
  events: number;
};

function clone_tag_from_state(tag_state: ResolvedTagState): TagInstance {
  return {
    name: tag_state.name,
    mag: tag_state.stored_mag,
    dim_mag: { ...(tag_state.dim_mag ?? {}) },
    meta: Array.isArray(tag_state.meta) ? [...tag_state.meta] : [],
    info: Array.isArray(tag_state.info) ? [...tag_state.info] : tag_state.info,
    source: tag_state.source ?? undefined,
    expiry: tag_state.expiry ?? undefined,
    scope: Array.isArray(tag_state.scope) ? [...tag_state.scope] as any : undefined,
  };
}

export function get_resolved_tag_dispersal(tag_state: ResolvedTagState): ResolvedTagDispersal | null {
  const config = tag_state.definition?.lifecycle?.dispersal ?? null;
  if (!config) return null;
  const time_mag = get_tag_dim_mag(tag_state, config.time_dimension_id);
  return {
    config,
    period_breaths: project_disperse_period_breaths(time_mag),
    current_value: get_tag_dim_mag(tag_state, config.target_dimension_id),
  };
}

export function apply_resolved_tag_dispersal_step(tag_state: ResolvedTagState, elapsed_breaths: number): TagDispersalStepResult | null {
  const dispersal = get_resolved_tag_dispersal(tag_state);
  if (!dispersal) return null;
  const elapsed = Math.max(0, Math.floor(Number(elapsed_breaths) || 0));
  if (elapsed < dispersal.period_breaths) return null;

  const events = Math.min(DISPERSE_MAX_EVENTS_PER_PULSE, Math.floor(elapsed / dispersal.period_breaths));
  if (events <= 0) return null;

  const { config, current_value } = dispersal;
  const target_value = Math.floor(Number(config.target_value) || 0);
  const step_size = Math.max(1, Math.floor(Number(config.step) || 1));
  const delta = target_value - current_value;
  const max_shift = events * step_size;
  const shift = delta === 0 ? 0 : Math.min(Math.abs(delta), max_shift) * Math.sign(delta);
  const next_value = current_value + shift;
  const reached_target = next_value === target_value;
  const advanced_breaths = events * dispersal.period_breaths;

  if (reached_target && config.remove_on_target) {
    return {
      next_tag: null,
      old_value: current_value,
      new_value: next_value,
      advanced_breaths,
      events,
    };
  }

  if (shift === 0) {
    return {
      next_tag: clone_tag_from_state(tag_state),
      old_value: current_value,
      new_value: next_value,
      advanced_breaths,
      events,
    };
  }

  const next_tag = clone_tag_from_state(tag_state);
  const next_dim_mag = { ...(next_tag.dim_mag ?? {}) };
  next_dim_mag[config.target_dimension_id] = next_value;
  next_tag.dim_mag = next_dim_mag;
  if (tag_state.definition?.quantity_dimension_id === config.target_dimension_id) {
    next_tag.mag = next_value;
  }

  return {
    next_tag,
    old_value: current_value,
    new_value: next_value,
    advanced_breaths,
    events,
  };
}
